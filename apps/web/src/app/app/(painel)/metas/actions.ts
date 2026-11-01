"use server";
import { getLocale, getTranslations } from "next-intl/server";
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
import { isYearMonth, money, parseMoney, toDbAmount, todayIn } from "@organizeup/domain";
import type { Locale } from "@/i18n/locales";
import { audit } from "@/lib/audit";
import { reportActionFailure } from "@/lib/diagnostics";
import { requireTenant } from "@/lib/session";

export interface FormState {
  ok: boolean;
  message: string | null;
}

const blocked = async (): Promise<FormState> => ({
  ok: false,
  message: (await getTranslations("settings"))("noPermission"),
});

const reais = (message: string, locale: Locale) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseMoney(value, locale);
      if (parsed.lte(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

type ErrorTexts = Awaited<ReturnType<typeof getTranslations<"metas.errors">>>;

const goalSchema = (t: ErrorTexts, locale: Locale) =>
  z.object({
    id: z.string(),
    name: z.string().trim().min(1, t("name")).max(80),
    kind: z.enum(GOAL_KINDS, { message: t("kind") }),
    targetAmount: reais(t("amount"), locale),
    desiredMonth: z
      .string()
      .refine((value) => value === "" || isYearMonth(value), t("month"))
      .transform((value) => value || null),
    priority: z.coerce
      .number({ message: t("priority") })
      .int(t("priority"))
      .min(1, t("priority"))
      .max(5, t("priority")),
    planDay: z.coerce
      .number({ message: t("planDay") })
      .int(t("planDay"))
      .min(1, t("planDay"))
      .max(28, t("planDay")),
    accountId: z.string().min(1, t("account")),
    destinationAccountId: z.string().transform((value) => value || null),
  });

/** Cria uma meta ou edita a do `id`. Só o que a família informa; o plano é do assistente. */
export async function saveGoal(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await Promise.all([getTranslations("metas.errors"), getLocale()]);
  const parsed = goalSchema(t, locale).safeParse({
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
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  const { id, ...values } = parsed.data;

  const failure = await withHousehold(ctx, async (tx) => {
    const chosen = [values.accountId, values.destinationAccountId].filter(
      (value): value is string => value !== null,
    );
    const known = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(inArray(accounts.id, chosen), eq(accounts.archived, false)));
    if (known.length !== new Set(chosen).size) return t("validAccount");

    if (id) {
      const updated = await tx
        .update(goals)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(goals.id, id))
        .returning({ id: goals.id });
      if (updated.length === 0) return t("notFound");
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
    reportActionFailure("goal_replan_failed", error);
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
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await Promise.all([getTranslations("metas.errors"), getLocale()]);
  const id = String(form.get("id") ?? "");
  const amount = reais(t("savedAmount"), locale).safeParse(form.get("amount") ?? "");
  if (!amount.success) return { ok: false, message: amount.error.issues[0]?.message ?? t("check") };
  const failure = await withHousehold(ctx, async (tx) => {
    const [goal] = await tx.select().from(goals).where(eq(goals.id, id)).for("update");
    if (!goal) return t("notFound");
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
  if (!canWrite(ctx)) return blocked();
  await replan(ctx);
  revalidatePath("/app", "layout");
  return { ok: true, message: (await getTranslations("metas.replan"))("done") };
}
