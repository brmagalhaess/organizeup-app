"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  and,
  canWrite,
  eq,
  findMarketAsset,
  householdTimezone,
  INVESTMENT_CLASSES,
  investments,
  investmentTargets,
  investmentTrades,
  loadStockEvents,
  TRADE_SIDES,
  withHousehold,
} from "@organizeup/db";
import {
  isUnitPriced,
  money,
  parseBRL,
  positionOf,
  redemptionOf,
  toDbAmount,
  todayIn,
  type TradeInput,
} from "@organizeup/domain";
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

const positive = (message: string, zeroAllowed = false) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseBRL(value);
      if (parsed.lt(0) || (!zeroAllowed && parsed.isZero()) || parsed.gte("100000000000"))
        throw new RangeError("fora do limite");
      return parsed.toFixed(8);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Data inválida.");

const investmentSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "Informe o nome.").max(80),
  ticker: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9.]{0,12}$/, "Use só letras e números no código.")
    .transform((value) => value || null),
  assetClass: z.enum(INVESTMENT_CLASSES, { message: "Escolha a classe." }),
});

function refresh() {
  revalidatePath("/app", "layout");
}

/** Cria um investimento ou edita o do `id`. */
export async function saveInvestment(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const parsed = investmentSchema.safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    ticker: form.get("ticker") ?? "",
    assetClass: form.get("assetClass"),
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  const { id, ...values } = parsed.data;
  try {
    await withHousehold(ctx, async (tx) => {
      if (id) {
        await tx.update(investments).set(values).where(eq(investments.id, id));
        await audit(tx, ctx, "update", "investments", id);
      } else {
        const [created] = await tx
          .insert(investments)
          .values({ householdId: ctx.householdId, ...values })
          .returning({ id: investments.id });
        await audit(tx, ctx, "create", "investments", created!.id);
      }
    });
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === "23505")
      return { ok: false, message: "Já existe um investimento com este código." };
    throw error;
  }
  refresh();
  return { ok: true, message: null };
}

const assetSchema = z.object({
  ticker: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9.]{0,12}$/, "Use só letras e números no código."),
  name: z.string().trim().max(80),
  assetClass: z.enum(INVESTMENT_CLASSES).nullable(),
  occurredOn: dateSchema,
});

/**
 * Cadastro único: cria o investimento e a primeira compra na mesma transação. Com código do catálogo,
 * nome, tipo e preço de hoje vêm de lá. Código que a família já tem vira uma compra a mais.
 */
export async function addAsset(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const parsed = assetSchema.safeParse({
    ticker: form.get("ticker") ?? "",
    name: form.get("name") ?? "",
    assetClass: form.get("assetClass"),
    occurredOn: form.get("occurredOn") ?? "",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  const { ticker, occurredOn } = parsed.data;
  const catalog = ticker ? await findMarketAsset(ticker) : null;
  const name = catalog?.name.slice(0, 80) ?? parsed.data.name;
  const assetClass = catalog?.assetClass ?? parsed.data.assetClass;
  const fees = positive("Informe as taxas como 4,90.", true).safeParse(form.get("fees") || "0");
  if (!fees.success) return { ok: false, message: fees.error.issues[0]?.message ?? "Verifique." };
  if (!name) return { ok: false, message: "Informe o nome." };
  if (!assetClass) return { ok: false, message: "Escolha o tipo." };

  let quantity: string;
  let unitPrice: string;
  let currentValue: string | null = null;
  if (isUnitPriced(assetClass)) {
    const fields = z
      .object({
        quantity: positive("Informe a quantidade."),
        unitPrice: positive("Informe o preço pago."),
      })
      .safeParse({ quantity: form.get("quantity") ?? "", unitPrice: form.get("unitPrice") ?? "" });
    if (!fields.success)
      return { ok: false, message: fields.error.issues[0]?.message ?? "Verifique." };
    ({ quantity, unitPrice } = fields.data);
  } else {
    const amount = positive("Informe o valor aplicado.").safeParse(form.get("amount") ?? "");
    if (!amount.success)
      return { ok: false, message: amount.error.issues[0]?.message ?? "Verifique." };
    quantity = amount.data;
    unitPrice = "1";
    const raw = form.get("currentValue");
    if (raw) {
      const value = positive("Informe o valor de hoje como 1.050,00.").safeParse(raw);
      if (!value.success)
        return { ok: false, message: value.error.issues[0]?.message ?? "Verifique." };
      currentValue = toDbAmount(value.data);
    } else {
      currentValue = toDbAmount(amount.data);
    }
  }

  await withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const [existing] = ticker
      ? await tx
          .select({ id: investments.id })
          .from(investments)
          .where(eq(investments.ticker, ticker))
      : [];
    let investmentId = existing?.id;
    if (!investmentId) {
      const [created] = await tx
        .insert(investments)
        .values({
          householdId: ctx.householdId,
          name,
          assetClass,
          ticker: ticker || null,
          ...(catalog?.close
            ? { currentPrice: catalog.close, valuedOn: today, priceSource: "mercado" as const }
            : {}),
          ...(currentValue ? { currentValue, valuedOn: today } : {}),
        })
        .returning({ id: investments.id });
      investmentId = created!.id;
      await audit(tx, ctx, "create", "investments", investmentId);
    }
    await tx.insert(investmentTrades).values({
      householdId: ctx.householdId,
      investmentId,
      side: "compra",
      occurredOn,
      quantity,
      unitPrice,
      fees: fees.data,
    });
  });
  refresh();
  return { ok: true, message: null };
}

export async function deleteInvestment(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const removed = await tx
      .delete(investments)
      .where(eq(investments.id, id))
      .returning({ id: investments.id });
    if (removed.length > 0) await audit(tx, ctx, "delete", "investments", id);
  });
  refresh();
}

const tradeSchema = z.object({
  investmentId: z.string().min(1),
  side: z.enum(TRADE_SIDES, { message: "Escolha compra ou venda." }),
  occurredOn: dateSchema,
  fees: positive("Informe as taxas como 4,90.", true),
});

/** Com preço unitário vem quantidade e preço; nas demais classes, só o valor. */
export async function addTrade(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const parsed = tradeSchema.safeParse({
    investmentId: form.get("investmentId") ?? "",
    side: form.get("side"),
    occurredOn: form.get("occurredOn") ?? "",
    fees: form.get("fees") || "0",
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Verifique." };
  const { investmentId, side, occurredOn } = parsed.data;
  const fees = toDbAmount(parsed.data.fees);

  const failure = await withHousehold(ctx, async (tx) => {
    const [investment] = await tx
      .select()
      .from(investments)
      .where(eq(investments.id, investmentId));
    if (!investment) return "Investimento não encontrado.";
    const trades = await tx
      .select()
      .from(investmentTrades)
      .where(eq(investmentTrades.investmentId, investmentId));
    const events = (await loadStockEvents(tx)).filter(
      (event) => event.investmentId === investmentId,
    );

    let quantity: string;
    let unitPrice: string;
    let currentValue = investment.currentValue;
    if (isUnitPriced(investment.assetClass)) {
      const fields = z
        .object({
          quantity: positive("Informe a quantidade."),
          unitPrice: positive("Informe o preço como 32,50."),
        })
        .safeParse({
          quantity: form.get("quantity") ?? "",
          unitPrice: form.get("unitPrice") ?? "",
        });
      if (!fields.success) return fields.error.issues[0]?.message ?? "Verifique.";
      ({ quantity, unitPrice } = fields.data);
    } else {
      const field = positive("Informe o valor como 1.000,00.").safeParse(form.get("amount") ?? "");
      if (!field.success) return field.error.issues[0]?.message ?? "Verifique.";
      if (side === "compra") {
        quantity = field.data;
        unitPrice = "1";
        if (currentValue !== null) currentValue = toDbAmount(money(currentValue).plus(field.data));
      } else {
        const held = positionOf(trades, events);
        if (money(held.quantity).isZero()) return "Não há valor aplicado para resgatar.";
        const value = currentValue ?? held.cost;
        const redemption = redemptionOf(held.quantity, value, field.data);
        ({ quantity, unitPrice } = redemption);
        currentValue = redemption.remaining;
      }
    }

    const next: TradeInput = { side, occurredOn, quantity, unitPrice, fees };
    if (positionOf([...trades, next], events).oversold)
      return "Você não tinha essa quantidade nessa data.";

    const [created] = await tx
      .insert(investmentTrades)
      .values({ householdId: ctx.householdId, investmentId, ...next })
      .returning({ id: investmentTrades.id });
    if (currentValue !== investment.currentValue)
      await tx.update(investments).set({ currentValue }).where(eq(investments.id, investmentId));
    await audit(tx, ctx, "create", "investment_trades", created!.id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  refresh();
  return { ok: true, message: null };
}

export async function deleteTrade(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const removed = await tx
      .delete(investmentTrades)
      .where(eq(investmentTrades.id, id))
      .returning({ id: investmentTrades.id });
    if (removed.length > 0) await audit(tx, ctx, "delete", "investment_trades", id);
  });
  refresh();
}

/** Atualiza o preço ou, sem preço unitário, o valor total de hoje. */
export async function updateValue(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const id = String(form.get("id") ?? "");
  const value = positive("Informe o valor como 32,50.", true).safeParse(form.get("value") ?? "");
  const valuedOn = dateSchema.safeParse(form.get("valuedOn") ?? "");
  if (!value.success) return { ok: false, message: value.error.issues[0]?.message ?? "Verifique." };
  if (!valuedOn.success)
    return { ok: false, message: valuedOn.error.issues[0]?.message ?? "Verifique." };

  const failure = await withHousehold(ctx, async (tx) => {
    const [investment] = await tx
      .select({ assetClass: investments.assetClass })
      .from(investments)
      .where(eq(investments.id, id));
    if (!investment) return "Investimento não encontrado.";
    await tx
      .update(investments)
      .set(
        isUnitPriced(investment.assetClass)
          ? { currentPrice: value.data, valuedOn: valuedOn.data, priceSource: "familia" }
          : { currentValue: toDbAmount(value.data), valuedOn: valuedOn.data },
      )
      .where(eq(investments.id, id));
    await audit(tx, ctx, "update", "investments", id);
    return null;
  });
  if (failure) return { ok: false, message: failure };
  refresh();
  return { ok: true, message: null };
}

/** Grava a meta de cada classe. Campo vazio tira a classe das metas. */
export async function saveTargets(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return blocked;
  const targets: Array<{ assetClass: (typeof INVESTMENT_CLASSES)[number]; percent: string }> = [];
  for (const assetClass of INVESTMENT_CLASSES) {
    const raw = String(form.get(assetClass) ?? "").trim();
    if (!raw) continue;
    const percent = positive("Use percentuais como 30 ou 12,5.", true).safeParse(raw);
    if (!percent.success)
      return { ok: false, message: percent.error.issues[0]?.message ?? "Verifique." };
    if (money(percent.data).gt(100)) return { ok: false, message: "Cada classe vai até 100%." };
    if (money(percent.data).gt(0)) targets.push({ assetClass, percent: toDbAmount(percent.data) });
  }
  const sum = targets.reduce((acc, target) => acc.plus(target.percent), money(0));
  if (sum.gt(100)) return { ok: false, message: "A soma das metas passa de 100%." };

  await withHousehold(ctx, async (tx) => {
    await tx
      .delete(investmentTargets)
      .where(and(eq(investmentTargets.householdId, ctx.householdId)));
    if (targets.length > 0)
      await tx
        .insert(investmentTargets)
        .values(targets.map((target) => ({ householdId: ctx.householdId, ...target })));
    await audit(tx, ctx, "update", "investment_targets");
  });
  refresh();
  return { ok: true, message: null };
}
