"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAposentadoriaAgent, runMetasAgent } from "@organizeup/agents";
import {
  accounts,
  and,
  canWrite,
  eq,
  GOAL_KINDS,
  goals,
  householdSuggestions,
  householdTimezone,
  inArray,
  sql,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import { isYearMonth, money, parseBRL, toDbAmount, todayIn } from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireTenant } from "@/lib/session";

export interface FormState {
  ok: boolean;
  message: string | null;
}

const blocked: FormState = {
  ok: false,
  message: "Seu papel nesta família não permite alterações.",
};

const reais = (message: string) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseBRL(value);
      if (parsed.lte(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const goalSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "Informe o nome da meta.").max(80),
  kind: z.enum(GOAL_KINDS, { message: "Escolha o tipo da meta." }),
  targetAmount: reais("Informe o valor como 50.000,00."),
  desiredMonth: z
    .string()
    .refine((value) => value === "" || isYearMonth(value), "Informe o mês e o ano.")
    .transform((value) => value || null),
  priority: z.coerce
    .number({ message: "Escolha a prioridade." })
    .int("Escolha a prioridade.")
    .min(1, "Escolha a prioridade.")
    .max(5, "Escolha a prioridade."),
  planDay: z.coerce
    .number({ message: "Informe um dia de 1 a 28." })
    .int("Informe um dia de 1 a 28.")
    .min(1, "Informe um dia de 1 a 28.")
    .max(28, "Informe um dia de 1 a 28."),
  accountId: z.string().min(1, "Escolha de onde sai o dinheiro."),
  destinationAccountId: z.string().transform((value) => value || null),
});

/** Cria uma meta ou edita a do `id`. Só o que a família informa; o plano é do assistente. */
export async function saveGoal(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const parsed = goalSchema.safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    kind: form.get("kind"),
    targetAmount: form.get("targetAmount") ?? "",
    desiredMonth: form.get("desiredMonth") ?? "",
    priority: form.get("priority"),
    planDay: form.get("planDay"),
    accountId: form.get("accountId") ?? "",
    destinationAccountId: form.get("destinationAccountId") ?? "",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  const { id, ...values } = parsed.data;

  const failure = await withHousehold(ctx, async (tx) => {
    const chosen = [values.accountId, values.destinationAccountId].filter(
      (value): value is string => value !== null,
    );
    const known = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(inArray(accounts.id, chosen), eq(accounts.archived, false)));
    if (known.length !== new Set(chosen).size) return "Escolha uma conta válida.";

    if (id) {
      const updated = await tx
        .update(goals)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(goals.id, id))
        .returning({ id: goals.id });
      if (updated.length === 0) return "Meta não encontrada.";
      await audit(tx, ctx, "update", "goals", id);
      return null;
    }
    const [created] = await tx
      .insert(goals)
      .values({ ...values, householdId: ctx.householdId, createdBy: ctx.userId })
      .returning({ id: goals.id });
    await audit(tx, ctx, "create", "goals", created!.id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  // A meta já foi salva: se o plano falhar agora, ele sai na próxima madrugada.
  await replan(ctx).catch((error: unknown) => {
    const { name, code } = error as { name?: string; code?: string };
    console.error(JSON.stringify({ level: "error", msg: "goal_replan_failed", name, code }));
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

/** Apaga a meta e as parcelas previstas. O que já foi confirmado continua nos lançamentos. */
export async function deleteGoal(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const removed = await tx.delete(goals).where(eq(goals.id, id)).returning({ id: goals.id });
    if (removed.length === 0) return;
    await tx
      .delete(householdSuggestions)
      .where(
        and(
          eq(householdSuggestions.kind, "meta"),
          eq(householdSuggestions.status, "pendente"),
          sql`${householdSuggestions.dedupeKey} LIKE ${`meta:${id}:%`}`,
        ),
      );
    await audit(tx, ctx, "delete", "goals", id);
  });
  revalidatePath("/app", "layout");
}

/** Pausa ou retoma. Pausada não recebe parcelas; o plano volta na próxima conta. */
export async function setGoalStatus(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  const status = form.get("status") === "pausada" ? "pausada" : "planejando";
  await withHousehold(ctx, async (tx) => {
    const updated = await tx
      .update(goals)
      .set({ status, updatedAt: new Date() })
      .where(eq(goals.id, id))
      .returning({ id: goals.id });
    if (updated.length > 0)
      await audit(tx, ctx, status === "pausada" ? "pause" : "resume", "goals", id);
  });
  revalidatePath("/app", "layout");
}

/** Registra o que já foi separado por fora das parcelas. Não mexe em contas. */
export async function addSavedToGoal(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const id = String(form.get("id") ?? "");
  const amount = reais("Informe o valor como 500,00.").safeParse(form.get("amount") ?? "");
  if (!amount.success)
    return { ok: false, message: amount.error.issues[0]?.message ?? "Verifique." };
  const failure = await withHousehold(ctx, async (tx) => {
    const [goal] = await tx.select().from(goals).where(eq(goals.id, id)).for("update");
    if (!goal) return "Meta não encontrada.";
    const saved = money(goal.saved).plus(amount.data);
    await tx
      .update(goals)
      .set({
        saved: toDbAmount(saved),
        status: saved.gte(goal.targetAmount) ? "concluida" : goal.status,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, id));
    await audit(tx, ctx, "update", "goals", id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

/** Refaz a divisão do que sobra e, com ela, o plano das metas, sem esperar a madrugada. */
function replan(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) => {
    const input = {
      today: todayIn(await householdTimezone(tx, ctx.householdId)),
      householdId: ctx.householdId,
    };
    const { allocation } = await runAposentadoriaAgent(tx, input);
    await runMetasAgent(tx, { ...input, allocation });
  });
}

/** Botão "Recalcular agora". */
export async function replanNow(): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  await replan(ctx);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Plano atualizado." };
}
