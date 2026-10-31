"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordDividendRemoval } from "@organizeup/agents";
import {
  canWrite,
  DIVIDEND_KINDS,
  dividendGoals,
  dividends,
  eq,
  investments,
  withHousehold,
} from "@organizeup/db";
import { money, parseBRL, toDbAmount } from "@organizeup/domain";
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

const amount = (message: string) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseBRL(value);
      if (parsed.lt(0) || parsed.gte("1000000000000")) throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const schema = z.object({
  investmentId: z.string().min(1, "Escolha o investimento."),
  kind: z.enum(DIVIDEND_KINDS, { message: "Escolha o tipo." }),
  paidOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida."),
  gross: amount("Informe o valor como 120,50."),
  withheld: amount("Informe o imposto como 18,00."),
});

export async function addDividend(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const parsed = schema.safeParse({
    investmentId: form.get("investmentId") ?? "",
    kind: form.get("kind"),
    paidOn: form.get("paidOn") ?? "",
    gross: form.get("gross") ?? "",
    withheld: form.get("withheld") || "0",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  if (money(parsed.data.gross).isZero()) return { ok: false, message: "Informe o valor recebido." };
  if (money(parsed.data.withheld).gt(parsed.data.gross))
    return { ok: false, message: "O imposto não pode passar do valor bruto." };

  const failure = await withHousehold(ctx, async (tx) => {
    const [investment] = await tx
      .select({ id: investments.id })
      .from(investments)
      .where(eq(investments.id, parsed.data.investmentId));
    if (!investment) return "Escolha um investimento válido.";
    const [created] = await tx
      .insert(dividends)
      .values({ householdId: ctx.householdId, ...parsed.data })
      .returning({ id: dividends.id });
    await audit(tx, ctx, "create", "dividends", created!.id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}

export async function deleteDividend(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const [removed] = await tx.delete(dividends).where(eq(dividends.id, id)).returning({
      id: dividends.id,
      investmentId: dividends.investmentId,
      marketDividendId: dividends.marketDividendId,
    });
    if (!removed) return;
    await audit(tx, ctx, "delete", "dividends", id);
    // Provento automático excluído não volta na próxima rodada (ADR-0017).
    if (removed.marketDividendId) {
      await recordDividendRemoval(tx, ctx, {
        dividendId: removed.id,
        investmentId: removed.investmentId,
        marketDividendId: removed.marketDividendId,
      });
    }
  });
  revalidatePath("/app", "layout");
}

/** Meta de renda mensal com proventos. Campo vazio tira a meta. */
export async function saveGoal(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const raw = String(form.get("monthlyAmount") ?? "").trim();
  const parsed = amount("Informe a meta como 1.500,00.").safeParse(raw || "0");
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  await withHousehold(ctx, async (tx) => {
    if (money(parsed.data).isZero()) {
      await tx.delete(dividendGoals).where(eq(dividendGoals.householdId, ctx.householdId));
    } else {
      await tx
        .insert(dividendGoals)
        .values({ householdId: ctx.householdId, monthlyAmount: parsed.data })
        .onConflictDoUpdate({
          target: dividendGoals.householdId,
          set: { monthlyAmount: parsed.data, updatedAt: new Date() },
        });
    }
    await audit(tx, ctx, "update", "dividend_goals", ctx.householdId);
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: null };
}
