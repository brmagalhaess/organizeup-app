"use client";
// Seções "13º salário" e "Férias" do cadastro de renda CLT, com o resultado ao vivo. A conta é a mesma
// do domínio que gera as previsões. A escolha vale do ano em diante. Spec: docs/specs/decimo-e-ferias.md.
import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState, type ReactNode } from "react";
import {
  incomeYearView,
  inheritedFrom,
  MAX_VACATION_PERIODS,
  money,
  parseMoney,
  planForYear,
  thirteenthDate,
  toDbAmount,
  validateIncomePlan,
  vacationEvents,
  type IncomeSourceInput,
  type IncomeYearPlan,
  type IncomeYearView,
  type PlanIssueCode,
  type ThirteenthMode,
} from "@organizeup/domain";
import { cx } from "@/components/styles";
import { Button, Field, IconButton, Input, Select } from "@/components/ui";
import { formatDayMonth, formatMonthYear, monthNames, toAmountInput } from "@/i18n/format";
import { useMoney } from "@/i18n/money";
import type { loadIncome } from "@/lib/income-data";
import { planFromFields, type PeriodFields } from "./plan-fields";

type Data = Awaited<ReturnType<typeof loadIncome>>;
type Source = Data["sources"][number];

/** O que o resto do formulário já tem: salário, descontos e dia do pagamento. */
export interface LivePay {
  amount: string | null;
  invalid: boolean;
  dependents: number;
  pension: string;
  otherDiscounts: string;
  payDay: number;
}

interface Row extends PeriodFields {
  id: number;
  /** Pessoa mexeu na marca "Já recebi". */
  touched: boolean;
  /** Mês ou dia mudou nesta edição: a marca passa a depender só da data nova. */
  changed: boolean;
}

const toRow = (id: number, period?: IncomeYearPlan["periods"][number]): Row => ({
  id,
  month: String(period?.month ?? 0),
  day: period?.startDay ? String(period.startDay) : "",
  days: String(period?.days ?? 30),
  received: period?.received ?? false,
  touched: false,
  changed: false,
});

/** Data de pagamento de um período, sozinho: decide se a marca "Já recebi" vale. */
function rowDate(
  plan: IncomeYearPlan,
  row: PeriodFields,
  payDay: number,
  year: number,
): string | null {
  const month = Number(row.month);
  if (!(month >= 1 && month <= 12)) return null;
  // Enquanto a pessoa digita, o dia pode não ser válido: a validação avisa, e a tela não pode quebrar.
  const day = Number(row.day);
  const startDay = row.day.trim() && Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
  const period = { month, startDay, days: 1, received: false };
  return vacationEvents({ ...plan, periods: [period] }, payDay, year)[0]?.payDate ?? null;
}

function Check({
  name,
  label,
  hint,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm">
      <input
        type="checkbox"
        name={name}
        className="mt-0.5 size-5 shrink-0 accent-brand-500"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 rounded-xl border border-line p-4">
      <legend className="px-1 text-base font-semibold">{title}</legend>
      <p className="text-xs text-muted">{hint}</p>
      {children}
    </fieldset>
  );
}

function MonthOptions({ from = 1, to = 12 }: { from?: number; to?: number }) {
  const locale = useLocale();
  return monthNames(locale).map((month, index) =>
    index + 1 >= from && index + 1 <= to ? (
      <option key={month} value={index + 1}>
        {month}
      </option>
    ) : null,
  );
}

function ModeOption({
  value,
  label,
  mode,
  onChange,
}: {
  value: ThirteenthMode;
  label: string;
  mode: ThirteenthMode;
  onChange: (mode: ThirteenthMode) => void;
}) {
  return (
    <label
      className={cx(
        "flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium",
        mode === value ? "border-brand-500 bg-brand-50" : "border-line",
      )}
    >
      <input
        type="radio"
        name="thirteenthMode"
        value={value}
        className="size-4 accent-brand-500"
        checked={mode === value}
        onChange={() => onChange(value)}
      />
      {label}
    </label>
  );
}

interface ResultLine {
  key: string;
  date: string;
  label: string;
  amount: string;
  received: boolean;
  notes: string[];
}

/** O que entra no ano, em ordem de data. */
function resultLines(
  view: IncomeYearView,
  texts: {
    first: string;
    second: string;
    single: string;
    sold: (days: number) => string;
    noDay: string;
    early: string;
    vacation: (days: number) => string;
    salary: (month: string, days: number) => string;
    advance: (value: string) => string;
    covered: (value: string) => string;
  },
  receivedParts: string[],
): ResultLine[] {
  const lines: ResultLine[] = [];
  const { thirteenth } = view;
  if (thirteenth?.first)
    lines.push({
      key: "13-1",
      date: thirteenth.first.date,
      label: texts.first,
      amount: thirteenth.first.amount,
      received: thirteenth.first.received || receivedParts.includes("13-1"),
      notes: [],
    });
  if (thirteenth) {
    const covered = money(thirteenth.second.amount).lte(0);
    const notes = covered
      ? [texts.covered(thirteenth.net)]
      : !thirteenth.first && money(thirteenth.advance).gt(0)
        ? [texts.advance(thirteenth.advance)]
        : [];
    lines.push({
      key: "13-2",
      date: thirteenth.second.date,
      label: thirteenth.first ? texts.second : texts.single,
      amount: covered ? "0.00" : thirteenth.second.amount,
      received: thirteenth.second.received || receivedParts.includes("13-2"),
      notes,
    });
  }
  for (const payout of view.vacations) {
    const notes = payout.soldDays > 0 ? [texts.sold(payout.soldDays)] : [];
    if (!payout.dayKnown) notes.push(texts.noDay);
    else if (payout.payDate.slice(0, 7) < payout.start.slice(0, 7)) notes.push(texts.early);
    lines.push({
      key: payout.part,
      date: payout.payDate,
      label: texts.vacation(payout.days),
      amount: payout.net,
      received: payout.received || receivedParts.includes(payout.part),
      notes,
    });
  }
  for (const row of view.salaryMonths)
    if (row.workedDays > 0)
      lines.push({
        key: `salario-${row.month}`,
        date: `${row.month}-99`,
        label: texts.salary(row.month, row.workedDays),
        amount: row.net,
        received: false,
        notes: [],
      });
  return lines.sort((a, b) => a.date.localeCompare(b.date));
}

/** Escolhas de um ano. Trocar o ano remonta tudo: nada digitado passa de um ano para o outro. */
function YearChoices({
  source,
  data,
  year,
  live,
  errors,
}: {
  source: Source | null;
  data: Data;
  year: number;
  live: LivePay;
  errors: Record<string, string>;
}) {
  const t = useTranslations("renda.choices");
  const tPlan = useTranslations("renda.planErrors");
  const tForm = useTranslations("renda.form");
  const tErrors = useTranslations("renda.errors");
  const locale = useLocale();
  const moneyText = useMoney();
  const groupId = useId();
  const saved = useMemo(
    () => planForYear(source?.plans, year, source?.vacationMonth ?? null),
    [source, year],
  );
  const isThisYear = year === data.year;
  const receivedParts = useMemo(
    () => (isThisYear ? source?.receivedParts : source?.receivedNext) ?? [],
    [isThisYear, source],
  );
  const firstOnFile = receivedParts.includes("13-1");
  const singleOnFile = receivedParts.includes("13-2");
  const integralSaved = saved.thirteenthMode === "integral";

  const [mode, setMode] = useState<ThirteenthMode>(saved.thirteenthMode);
  const [firstMonth, setFirstMonth] = useState(String(saved.firstMonth));
  const [secondMonth, setSecondMonth] = useState(String(integralSaved ? 12 : saved.secondMonth));
  const [singleMonth, setSingleMonth] = useState(String(integralSaved ? saved.secondMonth : 12));
  const [withVacation, setWithVacation] = useState(saved.withVacation);
  const [firstMark, setFirstMark] = useState<boolean | null>(null);
  const [singleMark, setSingleMark] = useState<boolean | null>(null);
  const [firstAmount, setFirstAmount] = useState(
    saved.firstAmount ? toAmountInput(saved.firstAmount, locale) : "",
  );
  const [registerFirst, setRegisterFirst] = useState(false);
  const [jobStartedOn, setJobStartedOn] = useState(saved.jobStartedOn ?? "");
  const [sell, setSell] = useState(saved.soldDays > 0);
  const [soldDays, setSoldDays] = useState(String(saved.soldDays || 10));
  const [rows, setRows] = useState<Row[]>(() =>
    saved.periods.length > 0
      ? saved.periods.map((period, index) => toRow(index, period))
      : [toRow(0)],
  );
  const [nextId, setNextId] = useState(saved.periods.length + 1);

  const patchRow = (id: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  /** Em branco é null; undefined é texto que não é valor. */
  const typedFirst = useMemo(() => {
    if (!firstAmount.trim()) return null;
    try {
      const value = parseMoney(firstAmount, locale);
      return value.lt(0) ? undefined : toDbAmount(value);
    } catch {
      return undefined;
    }
  }, [firstAmount, locale]);

  const dateIn = (month: string) =>
    thirteenthDate(`${year}-${month.padStart(2, "0")}`, live.payDay);
  const singlePassed = dateIn(singleMonth) < data.today;

  /**
   * Plano com as marcas automáticas: mudar para uma data que já passou liga "Já recebi". A marca de um
   * período é da data: com pagamento por vir, nunca fica ligada.
   */
  const plan = useMemo(() => {
    const periods = rows.map((row) => {
      const payDate = rowDate(saved, row, live.payDay, year);
      const passed = payDate !== null && payDate < data.today;
      const wanted = row.touched ? row.received : row.changed || row.received;
      return { ...row, received: passed && wanted };
    });
    const firstDate = thirteenthDate(`${year}-${firstMonth.padStart(2, "0")}`, live.payDay);
    const moved = firstMonth !== String(saved.firstMonth) && firstDate < data.today;
    const firstReceived = firstMark ?? (saved.firstReceived || moved);
    const singleDate = thirteenthDate(`${year}-${singleMonth.padStart(2, "0")}`, live.payDay);
    const singleMoved =
      (!integralSaved || singleMonth !== String(saved.secondMonth)) && singleDate < data.today;
    const singleReceived = singleMark ?? (saved.singleReceived || singleMoved);
    return {
      periods,
      firstReceived,
      singleReceived,
      built: planFromFields(
        {
          mode,
          firstMonth,
          secondMonth,
          singleMonth,
          withVacation,
          firstReceived,
          firstAmount: typedFirst ?? null,
          singleReceived,
          jobStartedOn,
          sell,
          soldDays,
          periods,
        },
        year,
      ),
    };
  }, [
    mode,
    firstMonth,
    secondMonth,
    singleMonth,
    withVacation,
    firstMark,
    singleMark,
    typedFirst,
    jobStartedOn,
    sell,
    soldDays,
    rows,
    live.payDay,
    data.today,
    year,
    saved,
    integralSaved,
  ]);

  const issues = validateIncomePlan(plan.built);
  const hasPeriod = plan.built.periods.length > 0;
  const messageOf = (codes: PlanIssueCode[]) => {
    const found = issues.find((issue) => codes.includes(issue.code));
    return found ? tPlan(found.code) : undefined;
  };
  const thirteenthError = errors.thirteenth ?? messageOf(["first_after_second"]);
  const jobError = errors.jobStartedOn ?? messageOf(["bad_job_date"]);
  const vacationError =
    errors.vacation ??
    messageOf([
      "too_many_periods",
      "period_too_short",
      "needs_long_period",
      "bad_period",
      "bad_month",
      "bad_day",
      "overlap",
    ]);
  const soldError = errors.soldDays ?? messageOf(["sold_over", "days_over", "bad_sold"]);

  const view = useMemo(() => {
    if (!live.amount || issues.length > 0) return null;
    const preview: IncomeSourceInput = {
      id: "previa",
      name: "",
      kind: "clt",
      amount: live.amount,
      isGross: true,
      dependents: live.dependents,
      pensionAmount: live.pension,
      otherDiscounts: live.otherDiscounts,
      vacationMonth: null,
      payDay: live.payDay,
      startMonth: "2000-01",
      endMonth: null,
      categoryId: "",
      accountId: "",
      plans: [plan.built],
      firstPaid: source?.firstPaid ?? {},
    };
    return incomeYearView(preview, data.tables, year);
  }, [live, issues.length, plan.built, data.tables, year, source]);

  const lines = view
    ? resultLines(
        view,
        {
          first: t("resultFirst"),
          second: t("resultSecond"),
          single: t("resultSingle"),
          sold: (days) => t("resultSold", { days }),
          noDay: t("noDay"),
          early: t("earlyPay"),
          vacation: (days) => t("resultVacation", { days }),
          salary: (month, days) =>
            t("resultSalary", { month: formatMonthYear(month, locale), days }),
          advance: (value) => t("integralAdvance", { value: moneyText(value) }),
          covered: (value) => t("secondCovered", { value: moneyText(value) }),
        },
        receivedParts,
      )
    : [];

  return (
    <>
      <Section title={t("thirteenth")} hint={t("thirteenthHint")}>
        <div role="radiogroup" aria-labelledby={`${groupId}-how`} className="flex flex-col gap-1.5">
          <span id={`${groupId}-how`} className="text-sm font-medium">
            {t("how")}
          </span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <ModeOption value="parcelas" label={t("twoParts")} mode={mode} onChange={setMode} />
            <ModeOption value="integral" label={t("oneTime")} mode={mode} onChange={setMode} />
          </div>
        </div>

        {mode === "parcelas" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("firstMonth")} error={thirteenthError}>
                <Select
                  name="firstMonth"
                  value={firstMonth}
                  onChange={(event) => setFirstMonth(event.target.value)}
                >
                  <MonthOptions from={2} to={11} />
                </Select>
              </Field>
              <Field label={t("secondMonth")}>
                <Select
                  name="secondMonth"
                  value={secondMonth}
                  onChange={(event) => setSecondMonth(event.target.value)}
                >
                  <MonthOptions from={3} />
                </Select>
              </Field>
            </div>
            <p className="text-xs text-muted">{t("twoPartsNote")}</p>
            {hasPeriod ? (
              <Check
                name="withVacation"
                label={t("withVacation")}
                hint={t("withVacationHint")}
                checked={withVacation}
                onChange={setWithVacation}
              />
            ) : null}
            {firstOnFile ? (
              <>
                <p className="rounded-xl bg-brand-50 p-3 text-sm text-muted">
                  {t("firstRegistered")}
                </p>
                <input type="hidden" name="firstAmount" value={firstAmount} />
              </>
            ) : isThisYear ? (
              <>
                <Check
                  name="firstReceived"
                  label={t("firstReceived")}
                  hint={t("registeredNote")}
                  checked={plan.firstReceived}
                  onChange={setFirstMark}
                />
                {plan.firstReceived ? (
                  <>
                    <Field
                      label={t("firstAmount")}
                      hint={t("firstAmountHint")}
                      error={
                        errors.firstAmount ??
                        (typedFirst === undefined ? tErrors("firstAmount") : undefined)
                      }
                    >
                      <Input
                        name="firstAmount"
                        inputMode="decimal"
                        placeholder={toAmountInput("0.00", locale)}
                        value={firstAmount}
                        onChange={(event) => setFirstAmount(event.target.value)}
                      />
                    </Field>
                    <Check
                      name="registerFirst"
                      label={t("registerFirst")}
                      checked={registerFirst}
                      onChange={setRegisterFirst}
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <>
            <Field label={t("singleMonth")}>
              <Select
                name="singleMonth"
                value={singleMonth}
                onChange={(event) => setSingleMonth(event.target.value)}
              >
                <MonthOptions />
              </Select>
            </Field>
            <p className="text-xs text-muted">{t("oneTimeNote")}</p>
            <input type="hidden" name="firstMonth" value={firstMonth} />
            {/* A marca da 1ª segue valendo: o valor sai deste pagamento. */}
            {plan.firstReceived ? <input type="hidden" name="firstReceived" value="on" /> : null}
            <input type="hidden" name="firstAmount" value={firstAmount} />
            {singleOnFile ? (
              <p className="rounded-xl bg-brand-50 p-3 text-sm text-muted">
                {t("singleRegistered")}
              </p>
            ) : isThisYear && (singlePassed || plan.singleReceived) ? (
              <>
                <Check
                  name="singleReceived"
                  label={t("singleReceived")}
                  hint={t("registeredNote")}
                  checked={plan.singleReceived}
                  onChange={setSingleMark}
                />
                {plan.singleReceived ? (
                  <Check
                    name="registerFirst"
                    label={t("registerFirst")}
                    checked={registerFirst}
                    onChange={setRegisterFirst}
                  />
                ) : null}
              </>
            ) : null}
          </>
        )}
        <Field label={t("jobStarted")} hint={t("jobStartedHint")} error={jobError}>
          <Input
            name="jobStartedOn"
            type="date"
            value={jobStartedOn}
            onChange={(event) => setJobStartedOn(event.target.value)}
          />
        </Field>
      </Section>

      <Section title={t("vacation")} hint={t("vacationHint")}>
        {rows.map((row, index) => {
          const shown = plan.periods[index]!;
          const payDate = rowDate(saved, shown, live.payDay, year);
          return (
            <div
              key={row.id}
              role="group"
              aria-label={t("periodTitle", { number: index + 1 })}
              className="flex flex-col gap-2 border-b border-line pb-3 last:border-b-0 last:pb-0"
            >
              {rows.length > 1 ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {t("periodTitle", { number: index + 1 })}
                  </span>
                  <IconButton
                    label={t("removePeriod", { number: index + 1 })}
                    onClick={() =>
                      setRows((current) => current.filter((item) => item.id !== row.id))
                    }
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </div>
              ) : null}
              <Field label={tForm("vacationMonth")}>
                <Select
                  name="periodMonth"
                  value={row.month}
                  onChange={(event) =>
                    patchRow(row.id, { month: event.target.value, changed: true })
                  }
                >
                  <option value={0}>{tForm("notSure")}</option>
                  <MonthOptions />
                </Select>
              </Field>
              <div
                className={cx("grid grid-cols-2 gap-3", row.month === "0" && "hidden")}
                aria-hidden={row.month === "0" ? true : undefined}
              >
                <Field label={t("startDay")}>
                  <Input
                    name="periodDay"
                    type="number"
                    min={1}
                    max={31}
                    placeholder={t("startDayPlaceholder")}
                    value={row.day}
                    onChange={(event) =>
                      patchRow(row.id, { day: event.target.value, changed: true })
                    }
                  />
                </Field>
                <Field label={t("days")}>
                  <Input
                    name="periodDays"
                    type="number"
                    min={1}
                    max={30}
                    value={row.days}
                    onChange={(event) => patchRow(row.id, { days: event.target.value })}
                  />
                </Field>
              </div>
              <input type="hidden" name="periodReceived" value={shown.received ? "1" : ""} />
              {payDate && payDate < data.today ? (
                <Check
                  name={`periodReceivedBox-${row.id}`}
                  label={t("periodReceived")}
                  hint={t("periodReceivedHint")}
                  checked={shown.received}
                  onChange={(checked) => patchRow(row.id, { received: checked, touched: true })}
                />
              ) : null}
            </div>
          );
        })}
        {rows.length < MAX_VACATION_PERIODS ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRows((current) => [...current, toRow(nextId)]);
                setNextId((value) => value + 1);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("addPeriod")}
            </Button>
          </div>
        ) : null}
        {vacationError ? (
          <p role="alert" className="text-xs text-danger">
            {vacationError}
          </p>
        ) : null}
        {hasPeriod ? (
          <>
            <Check name="sell" label={t("sell")} checked={sell} onChange={setSell} />
            {sell ? (
              <Field label={t("soldDays")} hint={t("soldDaysHint")} error={soldError}>
                <Input
                  name="soldDays"
                  type="number"
                  min={1}
                  max={10}
                  value={soldDays}
                  onChange={(event) => setSoldDays(event.target.value)}
                />
              </Field>
            ) : null}
          </>
        ) : null}
      </Section>

      <section
        aria-label={t("resultTitle")}
        aria-live="polite"
        className="rounded-xl bg-card-soft p-4"
      >
        <h3 className="text-sm font-semibold">{t("resultTitle")}</h3>
        {!live.amount || live.invalid ? (
          <p className="mt-1 text-sm text-muted">
            {t(live.invalid ? "resultInvalid" : "resultPrompt")}
          </p>
        ) : issues.length > 0 ? (
          <p className="mt-1 text-sm text-muted">{t("resultFix")}</p>
        ) : (
          <>
            {view?.thirteenth ? null : <p className="mt-1 text-sm text-muted">{t("resultNone")}</p>}
            <ul className="m-0 mt-1 list-none p-0">
              {lines.map((line) => (
                <li key={line.key} className="border-t border-line py-2 first:border-t-0">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{line.label}</span>
                      <span className="block text-xs text-muted">
                        {line.received
                          ? t("resultReceived")
                          : line.date.endsWith("-99")
                            ? null
                            : formatDayMonth(line.date, locale)}
                      </span>
                    </span>
                    <span
                      className={cx(
                        "whitespace-nowrap font-medium tabular-nums",
                        money(line.amount).lte(0) && "text-muted",
                      )}
                    >
                      {moneyText(line.amount)}
                    </span>
                  </div>
                  {line.notes.map((note) => (
                    <p key={note} className="mt-0.5 text-xs text-muted">
                      {note}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            {view && view.thirteenth && view.thirteenth.serviceMonths < 12 ? (
              <p className="mt-1 text-xs text-muted">
                {t("proportional", { months: view.thirteenth.serviceMonths })}
              </p>
            ) : null}
            {view && view.remainingDays > 0 ? (
              <p className="mt-1 text-xs text-muted">
                {t("missingDays", { days: view.remainingDays })}
              </p>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

export function PayChoices({
  source,
  data,
  live,
  errors,
}: {
  source: Source | null;
  data: Data;
  live: LivePay;
  errors: Record<string, string>;
}) {
  const t = useTranslations("renda.choices");
  const tExtra = useTranslations("renda.extra");
  const [year, setYear] = useState(data.year);
  const inherited = inheritedFrom(source?.plans, year);
  return (
    <>
      <Field label={t("year")} hint={t("yearHint")}>
        <Select
          name="planYear"
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
        >
          <option value={data.year}>{data.year}</option>
          <option value={data.year + 1}>{data.year + 1}</option>
        </Select>
      </Field>
      {inherited ? (
        <p className="text-xs text-muted">{tExtra("sameChoice", { year: inherited })}</p>
      ) : null}
      <YearChoices key={year} source={source} data={data} year={year} live={live} errors={errors} />
    </>
  );
}
