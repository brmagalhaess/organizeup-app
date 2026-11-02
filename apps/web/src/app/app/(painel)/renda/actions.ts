"use server";
import type { Messages } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  canWrite,
  categories,
  eq,
  householdCurrency,
  householdTimezone,
  INCOME_KINDS,
  incomeSources,
  incomeYearPlans,
  people,
  withHousehold,
  type TenantTx,
} from "@organizeup/db";
import {
  addMonths,
  brazilRulesApply,
  carryVacationKeys,
  firstIncomeMonth,
  incomeKey,
  parseMoney,
  planForYear,
  settleReceived,
  thirteenthPlan,
  toDbAmount,
  todayIn,
  validateIncomePlan,
  yearMonthOf,
  type IncomeYearPlan,
  type PlanIssueCode,
} from "@organizeup/domain";
import {
  incomePlansBySource,
  incomeReceiptRows,
  loadFiscalTables,
  withIncomePlans,
} from "@organizeup/agents";
import type { Locale } from "@/i18n/locales";
import { audit } from "@/lib/audit";
import { confirmCommitment } from "@/lib/confirm-entry";
import { incomePlanStoreReady } from "@/lib/income-data";
import { requireTenant } from "@/lib/session";
import { planFromFields, samePlan, type PeriodFields } from "./plan-fields";

export interface IncomeFormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
  /** Renda já gravada, quando algo depois dela falhou: salvar de novo edita em vez de criar outra. */
  savedId?: string;
}

const LIMIT = "1000000000000";

const amountField = (message: string, locale: Locale, optional = false) =>
  z.string().transform((value, ctx) => {
    if (optional && !value.trim()) return "0.00";
    try {
      const parsed = parseMoney(value, locale);
      if (parsed.lt(0) || parsed.gte(LIMIT) || (!optional && parsed.isZero()))
        throw new RangeError("fora do limite");
      return toDbAmount(parsed);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

const schema = (errors: Messages["renda"]["errors"], locale: Locale) =>
  z.object({
    id: z.string(),
    name: z.string().trim().min(1, errors.name).max(80),
    kind: z.enum(INCOME_KINDS, { message: errors.kind }),
    amount: amountField(errors.amount, locale),
    dependents: z.coerce
      .number({ message: errors.dependents })
      .int(errors.dependents)
      .min(0, errors.dependents)
      .max(20, errors.dependents),
    pensionAmount: amountField(errors.pension, locale, true),
    otherDiscounts: amountField(errors.otherDiscounts, locale, true),
    payDay: z.coerce
      .number({ message: errors.payDay })
      .int(errors.payDay)
      .min(1, errors.payDay)
      .max(31, errors.payDay),
    accountId: z.string().min(1, errors.account),
    categoryId: z.string().min(1, errors.category),
    personId: z.string(),
  });

/** Em qual campo cada erro das escolhas aparece. */
const ISSUE_FIELD: Record<PlanIssueCode, string> = {
  too_many_periods: "vacation",
  period_too_short: "vacation",
  needs_long_period: "vacation",
  bad_period: "vacation",
  bad_day: "vacation",
  overlap: "vacation",
  days_over: "soldDays",
  sold_over: "soldDays",
  bad_sold: "soldDays",
  bad_month: "vacation",
  first_after_second: "thirteenth",
  bad_job_date: "jobStartedOn",
};

function parseFirstAmount(text: string, locale: Locale): string | null | undefined {
  if (!text.trim()) return null;
  try {
    const parsed = parseMoney(text, locale);
    return parsed.lt(0) || parsed.gte(LIMIT) ? undefined : toDbAmount(parsed);
  } catch {
    return undefined;
  }
}

function planFieldsOf(form: FormData, firstAmount: string | null, year: number) {
  const text = (name: string, fallback = "") => String(form.get(name) ?? fallback);
  const list = (name: string) => form.getAll(name).map(String);
  const months = list("periodMonth");
  const days = list("periodDay");
  const lengths = list("periodDays");
  const received = list("periodReceived");
  const periods: PeriodFields[] = months.map((month, index) => ({
    month,
    day: days[index] ?? "",
    days: lengths[index] ?? "",
    received: received[index] === "1",
  }));
  return planFromFields(
    {
      mode: text("thirteenthMode") === "integral" ? "integral" : "parcelas",
      firstMonth: text("firstMonth", "11"),
      secondMonth: text("secondMonth", "12"),
      singleMonth: text("singleMonth", "12"),
      withVacation: form.get("withVacation") === "on",
      firstReceived: form.get("firstReceived") === "on",
      firstAmount,
      singleReceived: form.get("singleReceived") === "on",
      jobStartedOn: text("jobStartedOn"),
      sell: form.get("sell") === "on",
      soldDays: text("soldDays", "0"),
      periods,
    },
    year,
  );
}

/** Uma linha por renda e ano. Só a família grava aqui: o agente lê e nunca muda (regra 7). */
async function writeIncomePlan(
  tx: TenantTx,
  householdId: string,
  id: string,
  plan: IncomeYearPlan,
) {
  const values = {
    thirteenthMode: plan.thirteenthMode,
    thirteenthFirstMonth: plan.firstMonth,
    thirteenthSecondMonth: plan.secondMonth,
    thirteenthWithVacation: plan.withVacation,
    thirteenthFirstReceived: plan.firstReceived,
    thirteenthFirstAmount: plan.firstAmount,
    thirteenthSingleReceived: plan.singleReceived,
    jobStartedOn: plan.jobStartedOn,
    vacationSoldDays: plan.soldDays,
    vacationPeriods: plan.periods,
  };
  await tx
    .insert(incomeYearPlans)
    .values({ ...values, householdId, incomeSourceId: id, year: plan.year })
    .onConflictDoUpdate({
      target: [incomeYearPlans.householdId, incomeYearPlans.incomeSourceId, incomeYearPlans.year],
      set: { ...values, updatedAt: new Date() },
    });
}

interface SaveOutcome {
  failure?: string;
  savedId?: string;
}

/** Cria uma renda ou edita a do `id`. Só a CLT é calculada pelo bruto. */
export async function saveIncome(_prev: IncomeFormState, form: FormData): Promise<IncomeFormState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx))
    return { ok: false, message: (await getTranslations("settings"))("noPermission") };
  const [t, locale, messages] = await Promise.all([
    getTranslations("renda"),
    getLocale(),
    getMessages(),
  ]);
  const parsed = schema(messages.renda.errors, locale).safeParse({
    id: form.get("id") ?? "",
    name: form.get("name") ?? "",
    kind: form.get("kind"),
    amount: form.get("amount") ?? "",
    dependents: form.get("dependents") || "0",
    pensionAmount: form.get("pensionAmount") ?? "",
    otherDiscounts: form.get("otherDiscounts") ?? "",
    payDay: form.get("payDay"),
    accountId: form.get("accountId") ?? "",
    categoryId: form.get("categoryId") ?? "",
    personId: form.get("personId") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: null, fieldErrors };
  }
  const data = parsed.data;
  const clt = data.kind === "clt";
  if (clt && !brazilRulesApply(await withHousehold(ctx, householdCurrency)))
    return { ok: false, message: null, fieldErrors: { kind: t("errors.kindNotHere") } };

  const today = await withHousehold(ctx, async (tx) =>
    todayIn(await householdTimezone(tx, ctx.householdId)),
  );
  const thisYear = Number(today.slice(0, 4));
  const year = Number(form.get("planYear") || thisYear);
  if (year !== thisYear && year !== thisYear + 1)
    return { ok: false, message: t("errors.invalid") };
  const firstAmount = parseFirstAmount(String(form.get("firstAmount") ?? ""), locale);
  if (firstAmount === undefined)
    return { ok: false, message: null, fieldErrors: { firstAmount: t("errors.firstAmount") } };
  const typed = planFieldsOf(form, firstAmount, year);
  if (clt) {
    const issues = validateIncomePlan(typed);
    if (issues.some((issue) => issue.code === "bad_month"))
      return { ok: false, message: t("errors.invalid") };
    const fieldErrors: Record<string, string> = {};
    for (const issue of issues)
      fieldErrors[ISSUE_FIELD[issue.code]] ??= t(`planErrors.${issue.code}`);
    if (Object.keys(fieldErrors).length > 0) return { ok: false, message: null, fieldErrors };
  }
  const values = {
    name: data.name,
    kind: data.kind,
    amount: data.amount,
    isGross: clt,
    dependents: clt ? data.dependents : 0,
    pensionAmount: clt ? data.pensionAmount : "0",
    otherDiscounts: clt ? data.otherDiscounts : "0",
    vacationMonth:
      clt && year === thisYear
        ? (typed.periods.map((period) => period.month).sort((a, b) => a - b)[0] ?? null)
        : null,
    payDay: data.payDay,
    accountId: data.accountId,
    categoryId: data.categoryId,
    personId: data.personId || null,
  };

  const outcome = await withHousehold(ctx, async (tx): Promise<SaveOutcome> => {
    const refuse = (message: string): SaveOutcome => ({ failure: message });
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, data.accountId));
    if (!account) return refuse(t("errors.invalidAccount"));
    const [category] = await tx
      .select({ kind: categories.kind })
      .from(categories)
      .where(eq(categories.id, data.categoryId));
    if (category?.kind !== "receita") return refuse(t("errors.incomeCategory"));
    if (values.personId) {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(eq(people.id, values.personId));
      if (!person) return refuse(t("errors.invalidPerson"));
    }

    const [existing] = data.id
      ? await tx.select().from(incomeSources).where(eq(incomeSources.id, data.id))
      : [];
    if (data.id && !existing) return refuse(t("errors.invalid"));

    const onFile = data.id ? ((await incomePlansBySource(tx)).get(data.id) ?? []) : [];
    const current = planForYear(onFile, year, existing?.vacationMonth ?? values.vacationMonth);
    const receipts = data.id
      ? (await incomeReceiptRows(tx)).filter(
          (row) => row.incomeSourceId === data.id && row.month.startsWith(`${year}-`),
        )
      : [];
    const hasReceipt = (part: string) => receipts.some((row) => row.part === part);
    const single = typed.thirteenthMode === "integral";
    const part = single ? "13-2" : "13-1";
    const already = hasReceipt(part);
    const wantsEntry =
      clt &&
      form.get("registerFirst") === "on" &&
      (single ? typed.singleReceived : typed.firstReceived) &&
      !already;
    const months = new Set(
      receipts.filter((row) => row.part.startsWith("ferias")).map((row) => row.month.slice(5)),
    );
    // Com a baixa no banco, a marca sobra; a marca nunca fica à frente da data do pagamento.
    const settled = carryVacationKeys(current, settleReceived(typed, data.payDay, today), months);
    const plan = {
      ...settled,
      firstReceived: settled.firstReceived && !hasReceipt("13-1"),
      singleReceived: settled.singleReceived && !hasReceipt("13-2"),
    };
    // Sem nada novo não nasce linha: quem não escolheu fica no padrão de sempre.
    const planChanged = clt && (wantsEntry || !samePlan(plan, current));
    if (planChanged && !(await incomePlanStoreReady(tx))) return refuse(t("errors.planLater"));

    let sourceId = data.id;
    if (data.id) {
      // `vacation_month` é o padrão dos anos sem escolha: escolher um ano não pode mudar os outros.
      const { vacationMonth, ...rest } = values;
      await tx
        .update(incomeSources)
        .set(clt ? rest : { ...rest, vacationMonth })
        .where(eq(incomeSources.id, data.id));
      await audit(tx, ctx, "update", "income_sources", data.id);
    } else {
      const [created] = await tx
        .insert(incomeSources)
        .values({
          ...values,
          householdId: ctx.householdId,
          startMonth: firstIncomeMonth(today, data.payDay),
        })
        .returning({ id: incomeSources.id });
      await audit(tx, ctx, "create", "income_sources", created!.id);
      sourceId = created!.id;
    }
    if (!planChanged) return {};

    // Com lançamento, quem tira a previsão é a baixa: apagar o lançamento a devolve.
    const unmarked = {
      ...plan,
      firstReceived: single && plan.firstReceived,
      singleReceived: false,
    };
    await writeIncomePlan(tx, ctx.householdId, sourceId, wantsEntry ? unmarked : plan);
    await audit(tx, ctx, "update", "income_year_plans", sourceId);
    if (!wantsEntry) return {};

    const [row] = await tx.select().from(incomeSources).where(eq(incomeSources.id, sourceId));
    const paid = await withIncomePlans(tx, [row!]);
    const thirteenth = thirteenthPlan(paid[0]!, await loadFiscalTables(tx), year);
    const payment = single ? thirteenth?.second : thirteenth?.first;
    const result = payment
      ? await confirmCommitment(
          tx,
          ctx,
          incomeKey(sourceId, payment.month, part),
          payment.month,
          {},
          payment.date < today ? payment.date : today,
        )
      : { done: false };
    if (result.done) return {};
    // Sem lançamento, a marca segura a previsão.
    await writeIncomePlan(tx, ctx.householdId, sourceId, plan);
    return { failure: t("errors.registerFailed"), savedId: sourceId };
  });
  // Mesmo com falha no lançamento, a renda ficou salva: a tela precisa saber.
  if (outcome.savedId) revalidatePath("/app", "layout");
  if (outcome.failure) {
    return {
      ok: false,
      message: outcome.failure,
      ...(outcome.savedId ? { savedId: outcome.savedId } : {}),
    };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: t("saved") };
}

/** Sem nada recebido, apaga. Com histórico, para de prever a partir deste mês. */
export async function stopIncome(form: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  const id = String(form.get("id") ?? "");
  await withHousehold(ctx, async (tx) => {
    const received = (await incomeReceiptRows(tx)).filter((row) => row.incomeSourceId === id);
    if (received.length === 0) {
      await tx.delete(incomeSources).where(eq(incomeSources.id, id));
      await audit(tx, ctx, "delete", "income_sources", id);
      return;
    }
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    await tx
      .update(incomeSources)
      .set({ endMonth: addMonths(yearMonthOf(today), -1) })
      .where(eq(incomeSources.id, id));
    await audit(tx, ctx, "stop", "income_sources", id);
  });
  revalidatePath("/app", "layout");
}
