"use server";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  and,
  canWrite,
  eq,
  findMarketAsset,
  householdCurrency,
  householdTimezone,
  inArray,
  INVESTMENT_CLASSES,
  investments,
  investmentTargets,
  investmentTrades,
  loadStockEvents,
  TRADE_SIDES,
  transactions,
  withHousehold,
} from "@organizeup/db";
import {
  brazilRulesApply,
  investmentClassAllowed,
  isUnitPriced,
  money,
  parseMoney,
  positionOf,
  redemptionOf,
  toDbAmount,
  todayIn,
  type TradeInput,
} from "@organizeup/domain";
import type { Locale } from "@/i18n/locales";
import { audit } from "@/lib/audit";
import { requireModule } from "@/lib/billing/plan-gate";
import { MissingQuote, recordTradeCash } from "@/lib/trade-cash";

export interface FormState {
  ok: boolean;
  message: string | null;
}

type Errors = Awaited<ReturnType<typeof getTranslations<"investimentos.errors">>>;

const blocked = async (): Promise<FormState> => ({
  ok: false,
  message: (await getTranslations("settings"))("noPermission"),
});

/** Textos de erro e idioma da pessoa: números digitados seguem o idioma. */
const texts = () => Promise.all([getTranslations("investimentos.errors"), getLocale()]);

const positive = (message: string, locale: Locale, zeroAllowed = false) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = parseMoney(value, locale);
      if (parsed.lt(0) || (!zeroAllowed && parsed.isZero()) || parsed.gte("100000000000"))
        throw new RangeError("fora do limite");
      return parsed.toFixed(8);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const dateSchema = (t: Errors) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, t("dateRequired"))
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), t("dateInvalid"));

/** Campo opcional de referência: vazio vira null; preenchido segue a regra de valor positivo. */
const optionalPositive = (message: string, locale: Locale) =>
  z.string().transform((value, ctx) => {
    if (!value.trim()) return null;
    const parsed = positive(message, locale).safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return parsed.data;
  });

/** Fatia ideal de 0 a 100, com até duas casas; vazio vira null. */
const optionalPercent = (message: string, locale: Locale) =>
  z.string().transform((value, ctx) => {
    if (!value.trim()) return null;
    try {
      const parsed = parseMoney(value, locale);
      if (parsed.lt(0) || parsed.gt(100)) throw new RangeError("fora do limite");
      return parsed.toFixed(2);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const investmentSchema = (t: Errors, locale: Locale) =>
  z.object({
    id: z.string(),
    bookValuePerShare: optionalPositive(t("bookValueFormat"), locale),
    targetPrice: optionalPositive(t("targetPriceFormat"), locale),
    targetPercent: optionalPercent(t("targetPercentFormat"), locale),
    name: z.string().trim().min(1, t("nameRequired")).max(80),
    ticker: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9.]{0,12}$/, t("tickerFormat"))
      .transform((value) => value || null),
    assetClass: z.enum(INVESTMENT_CLASSES, { message: t("classRequired") }),
  });

function refresh() {
  revalidatePath("/app", "layout");
}

/** Cria um investimento ou edita o do `id`. */
export async function saveInvestment(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await texts();
  const parsed = investmentSchema(t, locale).safeParse({
    id: form.get("id") ?? "",
    bookValuePerShare: form.get("bookValuePerShare") ?? "",
    targetPrice: form.get("targetPrice") ?? "",
    targetPercent: form.get("targetPercent") ?? "",
    name: form.get("name") ?? "",
    ticker: form.get("ticker") ?? "",
    assetClass: form.get("assetClass"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  const { id, ...values } = parsed.data;
  const currency = await withHousehold(ctx, householdCurrency);
  if (!investmentClassAllowed(values.assetClass, currency))
    return { ok: false, message: t("classNotAllowed") };
  if (!brazilRulesApply(currency)) values.ticker = null;
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
      return { ok: false, message: t("duplicateTicker") };
    throw error;
  }
  refresh();
  return { ok: true, message: null };
}

const assetSchema = (t: Errors) =>
  z.object({
    ticker: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9.]{0,12}$/, t("tickerFormat")),
    name: z.string().trim().max(80),
    assetClass: z.enum(INVESTMENT_CLASSES).nullable(),
    occurredOn: dateSchema(t),
  });

/**
 * Cadastro único: cria o investimento e a primeira compra na mesma transação. Com código do catálogo,
 * nome, tipo e preço de hoje vêm de lá. Código que a família já tem vira uma compra a mais.
 */
export async function addAsset(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await texts();
  const parsed = assetSchema(t).safeParse({
    ticker: form.get("ticker") ?? "",
    name: form.get("name") ?? "",
    assetClass: form.get("assetClass"),
    occurredOn: form.get("occurredOn") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  const { occurredOn } = parsed.data;
  const currency = await withHousehold(ctx, householdCurrency);
  const brazil = brazilRulesApply(currency);
  const ticker = brazil ? parsed.data.ticker : "";
  const accountId = String(form.get("accountId") ?? "");
  const catalog = ticker ? await findMarketAsset(ticker) : null;
  const name = catalog?.name.slice(0, 80) ?? parsed.data.name;
  const assetClass = catalog?.assetClass ?? parsed.data.assetClass;
  const fees = positive(t("feesFormat"), locale, true).safeParse(form.get("fees") || "0");
  if (!fees.success) return { ok: false, message: fees.error.issues[0]?.message ?? t("check") };
  if (!name) return { ok: false, message: t("nameRequired") };
  if (!assetClass) return { ok: false, message: t("typeRequired") };
  if (!investmentClassAllowed(assetClass, currency))
    return { ok: false, message: t("classNotAllowed") };

  let quantity: string;
  let unitPrice: string;
  let currentValue: string | null = null;
  if (isUnitPriced(assetClass)) {
    const fields = z
      .object({
        quantity: positive(t("quantityRequired"), locale),
        unitPrice: positive(t("pricePaidRequired"), locale),
      })
      .safeParse({ quantity: form.get("quantity") ?? "", unitPrice: form.get("unitPrice") ?? "" });
    if (!fields.success)
      return { ok: false, message: fields.error.issues[0]?.message ?? t("check") };
    ({ quantity, unitPrice } = fields.data);
  } else {
    const amount = positive(t("amountRequired"), locale).safeParse(form.get("amount") ?? "");
    if (!amount.success)
      return { ok: false, message: amount.error.issues[0]?.message ?? t("check") };
    quantity = amount.data;
    unitPrice = "1";
    const raw = form.get("currentValue");
    if (raw) {
      const value = positive(t("currentValueFormat"), locale).safeParse(raw);
      if (!value.success)
        return { ok: false, message: value.error.issues[0]?.message ?? t("check") };
      currentValue = toDbAmount(value.data);
    } else {
      currentValue = toDbAmount(amount.data);
    }
  }

  const saved = await withHousehold(ctx, async (tx) => {
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
    const trade: TradeInput = { side: "compra", occurredOn, quantity, unitPrice, fees: fees.data };
    const transactionId = accountId
      ? await recordTradeCash(tx, ctx, { accountId, side: "compra", name: ticker || name, trade })
      : null;
    await tx.insert(investmentTrades).values({
      householdId: ctx.householdId,
      investmentId,
      transactionId,
      ...trade,
    });
    return true;
  }).catch((error: unknown) => {
    if (error instanceof MissingQuote) return false;
    throw error;
  });
  if (!saved) return { ok: false, message: t("noQuote") };
  refresh();
  return { ok: true, message: null };
}

export async function deleteInvestment(form: FormData): Promise<void> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const linked = await tx
      .select({ id: investmentTrades.transactionId })
      .from(investmentTrades)
      .where(eq(investmentTrades.investmentId, id));
    const removed = await tx
      .delete(investments)
      .where(eq(investments.id, id))
      .returning({ id: investments.id });
    if (removed.length === 0) return;
    const ids = linked.flatMap((row) => row.id ?? []);
    if (ids.length > 0) await tx.delete(transactions).where(inArray(transactions.id, ids));
    await audit(tx, ctx, "delete", "investments", id);
  });
  refresh();
}

const tradeSchema = (t: Errors, locale: Locale) =>
  z.object({
    investmentId: z.string().min(1),
    side: z.enum(TRADE_SIDES, { message: t("sideRequired") }),
    occurredOn: dateSchema(t),
    fees: positive(t("feesFormat"), locale, true),
  });

/** Com preço unitário vem quantidade e preço; nas demais classes, só o valor. */
export async function addTrade(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await texts();
  const parsed = tradeSchema(t, locale).safeParse({
    investmentId: form.get("investmentId") ?? "",
    side: form.get("side"),
    occurredOn: form.get("occurredOn") ?? "",
    fees: form.get("fees") || "0",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  const { investmentId, side, occurredOn } = parsed.data;
  const fees = toDbAmount(parsed.data.fees);

  const failure = await withHousehold(ctx, async (tx) => {
    const [investment] = await tx
      .select()
      .from(investments)
      .where(eq(investments.id, investmentId));
    if (!investment) return t("notFound");
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
          quantity: positive(t("quantityRequired"), locale),
          unitPrice: positive(t("priceFormat"), locale),
        })
        .safeParse({
          quantity: form.get("quantity") ?? "",
          unitPrice: form.get("unitPrice") ?? "",
        });
      if (!fields.success) return fields.error.issues[0]?.message ?? t("check");
      ({ quantity, unitPrice } = fields.data);
    } else {
      const field = positive(t("amountFormat"), locale).safeParse(form.get("amount") ?? "");
      if (!field.success) return field.error.issues[0]?.message ?? t("check");
      if (side === "compra") {
        quantity = field.data;
        unitPrice = "1";
        if (currentValue !== null) currentValue = toDbAmount(money(currentValue).plus(field.data));
      } else {
        const held = positionOf(trades, events);
        if (money(held.quantity).isZero()) return t("nothingToRedeem");
        const value = currentValue ?? held.cost;
        const redemption = redemptionOf(held.quantity, value, field.data);
        ({ quantity, unitPrice } = redemption);
        currentValue = redemption.remaining;
      }
    }

    // Venda maior que a posição entra: a compra pode ainda não estar cadastrada. A carteira avisa.
    const next: TradeInput = { side, occurredOn, quantity, unitPrice, fees };

    const accountId = String(form.get("accountId") ?? "");
    const transactionId = accountId
      ? await recordTradeCash(tx, ctx, {
          accountId,
          side,
          name: investment.ticker ?? investment.name,
          trade: next,
        })
      : null;
    const [created] = await tx
      .insert(investmentTrades)
      .values({ householdId: ctx.householdId, investmentId, transactionId, ...next })
      .returning({ id: investmentTrades.id });
    if (currentValue !== investment.currentValue)
      await tx.update(investments).set({ currentValue }).where(eq(investments.id, investmentId));
    await audit(tx, ctx, "create", "investment_trades", created!.id);
    return null;
  }).catch((error: unknown) => {
    if (error instanceof MissingQuote) return t("noQuote");
    throw error;
  });
  if (failure) return { ok: false, message: failure };
  refresh();
  return { ok: true, message: null };
}

/**
 * Edita uma operação já gravada. Com preço unitário muda quantidade e preço; nas demais classes, o valor
 * (a quantidade fica e o preço acompanha). O lançamento da conta é refeito: sai o antigo e entra o novo.
 */
export async function updateTrade(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await texts();
  const parsed = tradeSchema(t, locale).safeParse({
    investmentId: form.get("investmentId") ?? "",
    side: form.get("side"),
    occurredOn: form.get("occurredOn") ?? "",
    fees: form.get("fees") || "0",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? t("check") };
  const id = String(form.get("id") ?? "");
  const { investmentId, side, occurredOn } = parsed.data;
  const fees = toDbAmount(parsed.data.fees);

  const failure = await withHousehold(ctx, async (tx) => {
    const [investment] = await tx
      .select()
      .from(investments)
      .where(eq(investments.id, investmentId));
    const [current] = await tx
      .select()
      .from(investmentTrades)
      .where(and(eq(investmentTrades.id, id), eq(investmentTrades.investmentId, investmentId)));
    if (!investment || !current) return t("notFound");

    let quantity: string;
    let unitPrice: string;
    if (isUnitPriced(investment.assetClass)) {
      const fields = z
        .object({
          quantity: positive(t("quantityRequired"), locale),
          unitPrice: positive(t("priceFormat"), locale),
        })
        .safeParse({
          quantity: form.get("quantity") ?? "",
          unitPrice: form.get("unitPrice") ?? "",
        });
      if (!fields.success) return fields.error.issues[0]?.message ?? t("check");
      ({ quantity, unitPrice } = fields.data);
    } else {
      const field = positive(t("amountFormat"), locale).safeParse(form.get("amount") ?? "");
      if (!field.success) return field.error.issues[0]?.message ?? t("check");
      quantity = current.quantity;
      unitPrice = toDbAmount(money(field.data).dividedBy(current.quantity));
    }

    const next: TradeInput = { side, occurredOn, quantity, unitPrice, fees };
    if (current.transactionId) {
      await tx.delete(transactions).where(eq(transactions.id, current.transactionId));
    }
    const accountId = String(form.get("accountId") ?? "");
    const transactionId = accountId
      ? await recordTradeCash(tx, ctx, {
          accountId,
          side,
          name: investment.ticker ?? investment.name,
          trade: next,
        })
      : null;
    await tx
      .update(investmentTrades)
      .set({ ...next, transactionId })
      .where(eq(investmentTrades.id, id));
    await audit(tx, ctx, "update", "investment_trades", id);
    return null;
  }).catch((error: unknown) => {
    if (error instanceof MissingQuote) return t("noQuote");
    throw error;
  });
  if (failure) return { ok: false, message: failure };
  refresh();
  return { ok: true, message: null };
}

export async function deleteTrade(form: FormData): Promise<void> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const removed = await tx
      .delete(investmentTrades)
      .where(eq(investmentTrades.id, id))
      .returning({ id: investmentTrades.id, transactionId: investmentTrades.transactionId });
    const [trade] = removed;
    if (!trade) return;
    if (trade.transactionId) {
      await tx.delete(transactions).where(eq(transactions.id, trade.transactionId));
    }
    await audit(tx, ctx, "delete", "investment_trades", id);
  });
  refresh();
}

/** Atualiza o preço ou, sem preço unitário, o valor total de hoje. */
export async function updateValue(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await texts();
  const id = String(form.get("id") ?? "");
  const value = positive(t("valueFormat"), locale, true).safeParse(form.get("value") ?? "");
  const valuedOn = dateSchema(t).safeParse(form.get("valuedOn") ?? "");
  if (!value.success) return { ok: false, message: value.error.issues[0]?.message ?? t("check") };
  if (!valuedOn.success)
    return { ok: false, message: valuedOn.error.issues[0]?.message ?? t("check") };

  const failure = await withHousehold(ctx, async (tx) => {
    const [investment] = await tx
      .select({ assetClass: investments.assetClass })
      .from(investments)
      .where(eq(investments.id, id));
    if (!investment) return t("notFound");
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
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return blocked();
  const [t, locale] = await texts();
  const targets: Array<{ assetClass: (typeof INVESTMENT_CLASSES)[number]; percent: string }> = [];
  for (const assetClass of INVESTMENT_CLASSES) {
    const raw = String(form.get(assetClass) ?? "").trim();
    if (!raw) continue;
    const percent = positive(t("percentFormat"), locale, true).safeParse(raw);
    if (!percent.success)
      return { ok: false, message: percent.error.issues[0]?.message ?? t("check") };
    if (money(percent.data).gt(100)) return { ok: false, message: t("percentMax") };
    if (money(percent.data).gt(0)) targets.push({ assetClass, percent: toDbAmount(percent.data) });
  }
  const sum = targets.reduce((acc, target) => acc.plus(target.percent), money(0));
  if (sum.gt(100)) return { ok: false, message: t("percentSum") };

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
