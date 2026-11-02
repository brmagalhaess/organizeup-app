"use client";
import { AlertTriangle, CalendarDays, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  calculatePayslip,
  calculateThirteenth,
  calculateVacation,
  money,
  parseMoney,
  toDbAmount,
  type IncomeKind,
  type Payslip,
  type IncomeYearView,
  type ThirteenthSalary,
  type VacationPay,
} from "@organizeup/domain";
import { cx } from "@/components/styles";
import {
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  PageHeader,
  Select,
  Sheet,
  StatTile,
} from "@/components/ui";
import { useAccountFeatures } from "@/i18n/account";
import { formatDayMonth, formatMonthYear, monthName, toAmountInput } from "@/i18n/format";
import type { loadIncome } from "@/lib/income-data";
import { systemTextOf } from "@/i18n/system-text";
import { saveIncome, stopIncome, type IncomeFormState } from "./actions";
import { PayChoices, type LivePay } from "./pay-choices";
import { useBrazilRules, useMoney } from "@/i18n/money";

type Data = Awaited<ReturnType<typeof loadIncome>>;
type Source = Data["sources"][number];

const KINDS: IncomeKind[] = ["clt", "pj_autonomo", "aposentadoria_pensao", "aluguel", "outro"];

/** Categoria padrão de cada tipo de renda, pelo nome gravado na criação da família. */
const DEFAULT_CATEGORY: Record<IncomeKind, string> = {
  clt: "Salário",
  pj_autonomo: "Trabalho autônomo",
  aposentadoria_pensao: "Outras receitas",
  aluguel: "Aluguel recebido",
  outro: "Outras receitas",
};

const initial: IncomeFormState = { ok: false, message: null };
const hasValue = (value: string) => !money(value).isZero();

interface Draft {
  gross: string;
  dependents: string;
  pension: string;
  otherDiscounts: string;
}

function Line({
  label,
  value,
  negative,
  strong,
}: {
  label: string;
  value: string;
  negative?: boolean;
  strong?: boolean;
}) {
  const moneyText = useMoney();
  return (
    <div
      className={cx(
        "flex justify-between gap-3 py-1.5 text-sm",
        strong && "border-t border-line font-semibold",
      )}
    >
      <dt className={strong ? "" : "text-muted"}>{label}</dt>
      <dd className="m-0 whitespace-nowrap font-medium tabular-nums">
        {negative ? "− " : ""}
        {moneyText(value)}
      </dd>
    </div>
  );
}

function PayslipLines({ slip }: { slip: Payslip }) {
  const t = useTranslations("renda.slip");
  return (
    <dl className="m-0">
      <Line label={t("gross")} value={slip.gross} />
      <Line label={t("inss")} value={slip.inss} negative />
      <Line label={t("tax")} value={slip.tax} negative />
      {hasValue(slip.pension) ? <Line label={t("pension")} value={slip.pension} negative /> : null}
      {hasValue(slip.otherDiscounts) ? (
        <Line label={t("otherDiscounts")} value={slip.otherDiscounts} negative />
      ) : null}
      <Line label={t("net")} value={slip.net} strong />
    </dl>
  );
}

function TaxNote({ slip, className }: { slip: Payslip; className: string }) {
  const t = useTranslations("renda.slip");
  const moneyText = useMoney();
  const deduction = t(slip.deduction === "simplificado" ? "simplified" : "legal");
  return (
    <p className={className}>
      {hasValue(slip.reduction)
        ? `${deduction} ${t("reduction", { value: moneyText(slip.reduction) })}`
        : deduction}
    </p>
  );
}

/** Bloco de férias de 30 dias, para o simulador e para quem ainda não escolheu o mês. */
function VacationEstimate({ vacation }: { vacation: VacationPay }) {
  const t = useTranslations("renda.extra");
  const tSlip = useTranslations("renda.slip");
  const moneyText = useMoney();
  const uncertain = !money(vacation.net).equals(vacation.netWithReduction);
  return (
    <section aria-label={t("vacationLabel")} className="rounded-xl bg-card-soft p-4">
      <h3 className="text-sm font-semibold">{t("vacation")}</h3>
      <dl className="m-0 mt-1">
        <Line label={t("vacationGross")} value={vacation.gross} />
        <Line label={tSlip("net")} value={vacation.net} strong />
      </dl>
      {uncertain ? (
        <p className="mt-2 text-xs text-muted">
          {t("uncertain", { value: moneyText(vacation.netWithReduction) })}
        </p>
      ) : null}
    </section>
  );
}

function ExtraPay({
  thirteenth,
  vacation,
}: {
  thirteenth: ThirteenthSalary;
  vacation: VacationPay;
}) {
  const t = useTranslations("renda.extra");
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <section aria-label={t("thirteenth")} className="rounded-xl bg-card-soft p-4">
        <h3 className="text-sm font-semibold">{t("thirteenth")}</h3>
        <dl className="m-0 mt-1">
          <Line label={t("first")} value={thirteenth.firstInstallment} />
          <Line label={t("second")} value={thirteenth.secondInstallment} />
          <Line label={t("total")} value={thirteenth.net} strong />
        </dl>
      </section>
      <VacationEstimate vacation={vacation} />
    </div>
  );
}

/** 13º e férias do ano, como vão cair nas previsões. */
function YearPay({
  view,
  vacation,
  receivedParts,
  title,
}: {
  view: IncomeYearView;
  vacation: VacationPay;
  receivedParts: string[];
  /** Só quando o cartão mostra mais de um ano. */
  title?: string;
}) {
  const t = useTranslations("renda.extra");
  const tChoices = useTranslations("renda.choices");
  const locale = useLocale();
  const moneyText = useMoney();
  const { thirteenth, vacations } = view;
  const monthOf = (month: string) => monthName(Number(month.slice(5)), locale);
  const label = (text: string, received: boolean) =>
    received ? `${text} (${t("receivedTag")})` : text;
  const best = vacations.reduce((acc, row) => acc.plus(row.netWithReduction), money(0));
  const forecast = vacations.reduce((acc, row) => acc.plus(row.net), money(0));
  const covered = thirteenth !== null && money(thirteenth.second.amount).lte(0);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {title ? <h3 className="text-sm font-semibold sm:col-span-2">{title}</h3> : null}
      {view.inheritedFrom ? (
        <p className="text-xs text-muted sm:col-span-2">
          {t("sameChoice", { year: view.inheritedFrom })}
        </p>
      ) : null}
      <section aria-label={t("thirteenth")} className="rounded-xl bg-card-soft p-4">
        <h3 className="text-sm font-semibold">{t("thirteenth")}</h3>
        {thirteenth ? (
          <>
            <dl className="m-0 mt-1">
              {thirteenth.first ? (
                <Line
                  label={label(
                    t("firstIn", { month: monthOf(thirteenth.first.month) }),
                    thirteenth.first.received || receivedParts.includes("13-1"),
                  )}
                  value={thirteenth.first.amount}
                />
              ) : null}
              <Line
                label={label(
                  t(thirteenth.first ? "secondIn" : "singleIn", {
                    month: monthOf(thirteenth.second.month),
                  }),
                  thirteenth.second.received || receivedParts.includes("13-2"),
                )}
                value={covered ? "0.00" : thirteenth.second.amount}
              />
              <Line label={t("total")} value={thirteenth.net} strong />
            </dl>
            {covered ? (
              <p className="mt-2 text-xs text-muted">
                {tChoices("secondCovered", { value: moneyText(thirteenth.net) })}
              </p>
            ) : !thirteenth.first && money(thirteenth.advance).gt(0) ? (
              <p className="mt-2 text-xs text-muted">
                {tChoices("integralAdvance", { value: moneyText(thirteenth.advance) })}
              </p>
            ) : null}
            {thirteenth.serviceMonths < 12 ? (
              <p className="mt-2 text-xs text-muted">
                {t("proportional", { months: thirteenth.serviceMonths })}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">{tChoices("resultNone")}</p>
        )}
      </section>
      {vacations.length === 0 ? (
        <VacationEstimate vacation={vacation} />
      ) : (
        <section aria-label={t("vacationLabel")} className="rounded-xl bg-card-soft p-4">
          <h3 className="text-sm font-semibold">{t("vacationPeriods")}</h3>
          <dl className="m-0 mt-1">
            {vacations.map((row) => (
              <Line
                key={row.part}
                label={label(
                  row.soldDays > 0
                    ? t("periodSold", {
                        days: row.days,
                        month: monthOf(row.keyMonth),
                        sold: row.soldDays,
                      })
                    : t("periodLine", { days: row.days, month: monthOf(row.keyMonth) }),
                  row.received || receivedParts.includes(row.part),
                )}
                value={row.net}
              />
            ))}
          </dl>
          <ul className="m-0 mt-1 list-none p-0 text-xs text-muted">
            {vacations.map((row) => (
              <li key={row.part}>
                {t("paidOn", { days: row.days, date: formatDayMonth(row.payDate, locale) })}
              </li>
            ))}
            {view.salaryMonths
              .filter((row) => row.workedDays > 0)
              .map((row) => (
                <li key={row.month}>
                  {t("salaryIn", { month: monthOf(row.month), days: row.workedDays })}
                </li>
              ))}
          </ul>
          {best.equals(forecast) ? null : (
            <p className="mt-2 text-xs text-muted">
              {t("uncertain", { value: moneyText(toDbAmount(best)) })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Simulator({
  data,
  writable,
  onRegister,
}: {
  data: Data;
  writable: boolean;
  onRegister: (draft: Draft) => void;
}) {
  const t = useTranslations("renda.simulator");
  const locale = useLocale();
  const features = useAccountFeatures();
  const zero = toAmountInput("0.00", locale);
  const [draft, setDraft] = useState<Draft>({
    gross: "",
    dependents: "0",
    pension: "",
    otherDiscounts: "",
  });
  const set = (field: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [field]: event.target.value }));

  const result = useMemo(() => {
    const read = (text: string) => {
      if (!text.trim()) return "0.00";
      const value = parseMoney(text, locale);
      if (value.lt(0)) throw new RangeError("negativo");
      return toDbAmount(value);
    };
    try {
      const gross = read(draft.gross);
      const dependents = Number(draft.dependents || "0");
      if (!Number.isInteger(dependents) || dependents < 0 || dependents > 20) return "invalid";
      if (money(gross).isZero()) return null;
      const input = {
        gross,
        dependents,
        pension: read(draft.pension),
        otherDiscounts: read(draft.otherDiscounts),
      };
      return {
        slip: calculatePayslip(input, data.table),
        thirteenth: calculateThirteenth(input, data.table),
        vacation: calculateVacation(input, data.table),
      };
    } catch {
      return "invalid";
    }
  }, [draft, data.table, locale]);

  return (
    <Card title={t("title")} description={t("text")}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-2 content-start gap-3">
          <Field label={t("gross")} error={result === "invalid" ? t("invalid") : undefined}>
            <Input
              inputMode="decimal"
              placeholder={zero}
              value={draft.gross}
              onChange={set("gross")}
            />
          </Field>
          {features.dependents ? (
            <Field label={t("dependents")}>
              <Input
                type="number"
                min={0}
                max={20}
                value={draft.dependents}
                onChange={set("dependents")}
              />
            </Field>
          ) : null}
          <Field label={t("pension")} hint={t("pensionHint")}>
            <Input
              inputMode="decimal"
              placeholder={zero}
              value={draft.pension}
              onChange={set("pension")}
            />
          </Field>
          <Field label={t("otherDiscounts")} hint={t("otherDiscountsHint")}>
            <Input
              inputMode="decimal"
              placeholder={zero}
              value={draft.otherDiscounts}
              onChange={set("otherDiscounts")}
            />
          </Field>
        </div>
        <div className="min-w-0">
          {result && result !== "invalid" ? (
            <>
              <PayslipLines slip={result.slip} />
              <TaxNote slip={result.slip} className="mt-2 text-xs text-muted" />
            </>
          ) : (
            <p className="rounded-xl bg-card-soft p-4 text-sm text-muted">{t("prompt")}</p>
          )}
        </div>
      </div>
      {result && result !== "invalid" ? (
        <div className="mt-4 flex flex-col gap-4">
          <ExtraPay thirteenth={result.thirteenth} vacation={result.vacation} />
          {writable ? (
            <div>
              <Button variant="secondary" onClick={() => onRegister(draft)}>
                <Plus className="size-4" aria-hidden="true" />
                {t("register")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function IncomeForm({
  source,
  draft,
  data,
  onDone,
}: {
  source: Source | null;
  draft: Draft | null;
  data: Data;
  onDone: () => void;
}) {
  const t = useTranslations("renda");
  const tForm = useTranslations("renda.form");
  const features = useAccountFeatures();
  const tCommon = useTranslations("common");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const zero = toAmountInput("0.00", locale);
  const [state, action, pending] = useActionState(saveIncome, initial);
  const brazil = useBrazilRules();
  const kinds = brazil ? KINDS : KINDS.filter((value) => value !== "clt");
  const [kind, setKind] = useState<IncomeKind>(
    source?.kind && kinds.includes(source.kind) ? source.kind : brazil ? "clt" : "outro",
  );
  const clt = kind === "clt";
  const readAmount = (text: string): string | null => {
    if (!text.trim()) return "0.00";
    try {
      const value = parseMoney(text, locale);
      return value.lt(0) ? null : toDbAmount(value);
    } catch {
      return null;
    }
  };
  const liveFrom = (fields: {
    amount: string;
    dependents: string;
    pension: string;
    otherDiscounts: string;
    payDay: string;
  }): LivePay => {
    const amount = readAmount(fields.amount);
    const pension = readAmount(fields.pension);
    const otherDiscounts = readAmount(fields.otherDiscounts);
    const payDay = Number(fields.payDay);
    const dependents = Number(fields.dependents || "0");
    const invalid =
      amount === null ||
      pension === null ||
      otherDiscounts === null ||
      !Number.isInteger(dependents) ||
      !Number.isInteger(payDay) ||
      payDay < 1 ||
      payDay > 31;
    return {
      amount: invalid || money(amount ?? "0").isZero() ? null : amount,
      invalid,
      dependents: invalid ? 0 : dependents,
      pension: pension ?? "0.00",
      otherDiscounts: otherDiscounts ?? "0.00",
      payDay: invalid ? 5 : payDay,
    };
  };
  const [live, setLive] = useState<LivePay>(() =>
    liveFrom({
      amount: source ? toAmountInput(source.amount, locale) : (draft?.gross ?? ""),
      dependents: String(source?.dependents ?? (draft?.dependents || 0)),
      pension: source ? toAmountInput(source.pensionAmount, locale) : (draft?.pension ?? ""),
      otherDiscounts: source
        ? toAmountInput(source.otherDiscounts, locale)
        : (draft?.otherDiscounts ?? ""),
      payDay: String(source?.payDay ?? 5),
    }),
  );
  const refreshLive = (event: FormEvent<HTMLFormElement>) => {
    const fields = new FormData(event.currentTarget);
    const text = (name: string) => String(fields.get(name) ?? "");
    setLive(
      liveFrom({
        amount: text("amount"),
        dependents: text("dependents"),
        pension: text("pensionAmount"),
        otherDiscounts: text("otherDiscounts"),
        payDay: text("payDay"),
      }),
    );
  };
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  const errors = state.fieldErrors ?? {};
  const defaultCategory = data.categories.find((c) => c.name === DEFAULT_CATEGORY[kind])?.id;

  return (
    <form action={action} onChange={refreshLive} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={source?.id ?? state.savedId ?? ""} />
      <Field label={tForm("kind")} error={errors.kind}>
        <Select
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as IncomeKind)}
        >
          {kinds.map((value) => (
            <option key={value} value={value}>
              {t(`kinds.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={tForm(clt ? "company" : "source")} error={errors.name}>
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={tForm(clt ? "companyExample" : "sourceExample")}
          defaultValue={source?.name}
        />
      </Field>
      <div className="grid grid-cols-[3fr_2fr] gap-3">
        <Field label={tForm(clt ? "gross" : "net")} error={errors.amount}>
          <Input
            name="amount"
            inputMode="decimal"
            required
            placeholder={zero}
            defaultValue={source ? toAmountInput(source.amount, locale) : draft?.gross}
          />
        </Field>
        <Field label={tForm("payDay")} error={errors.payDay}>
          <Input
            name="payDay"
            type="number"
            min={1}
            max={31}
            required
            defaultValue={source?.payDay ?? 5}
          />
        </Field>
      </div>
      {clt ? (
        <>
          {features.dependents ? (
            <Field label={tForm("dependents")} error={errors.dependents}>
              <Input
                name="dependents"
                type="number"
                min={0}
                max={20}
                defaultValue={source?.dependents ?? (draft?.dependents || 0)}
              />
            </Field>
          ) : (
            <input type="hidden" name="dependents" value="0" />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={tForm("pension")} error={errors.pensionAmount}>
              <Input
                name="pensionAmount"
                inputMode="decimal"
                placeholder={zero}
                defaultValue={source ? toAmountInput(source.pensionAmount, locale) : draft?.pension}
              />
            </Field>
            <Field label={tForm("otherDiscounts")} error={errors.otherDiscounts}>
              <Input
                name="otherDiscounts"
                inputMode="decimal"
                placeholder={zero}
                defaultValue={
                  source ? toAmountInput(source.otherDiscounts, locale) : draft?.otherDiscounts
                }
              />
            </Field>
          </div>
          <PayChoices source={source} data={data} live={live} errors={errors} />
        </>
      ) : null}
      <Field label={tForm("account")} error={errors.accountId}>
        <Select name="accountId" required defaultValue={source?.accountId}>
          {data.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {system.name(account.name)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tForm("category")} error={errors.categoryId}>
          <Select
            key={kind}
            name="categoryId"
            required
            defaultValue={source?.categoryId ?? defaultCategory}
          >
            {data.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {system.name(category.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tForm("person")} error={errors.personId}>
          <Select name="personId" defaultValue={source?.personId ?? ""}>
            <option value="">{tForm("family")}</option>
            {data.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {source?.hasReceipts ? (
        <p className="rounded-xl bg-brand-50 p-3 text-sm text-muted">{tForm("received")}</p>
      ) : null}
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : tForm("save")}
      </Button>
    </form>
  );
}

function SourceCard({
  source,
  data,
  writable,
  onEdit,
  onStop,
}: {
  source: Source;
  data: Data;
  writable: boolean;
  onEdit: () => void;
  onStop: () => void;
}) {
  const t = useTranslations("renda");
  const locale = useLocale();
  const moneyText = useMoney();
  const { name } = source;
  const person = data.people.find((p) => p.id === source.personId)?.name;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{source.name}</h2>
          <p className="text-xs text-muted">
            {t(`kinds.${source.kind}`)}
            {person ? ` · ${person}` : ""} · {t("card.payDay", { day: source.payDay })}
          </p>
        </div>
        {writable ? (
          <div className="flex shrink-0">
            <IconButton label={t("card.edit", { name })} onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={t(source.hasReceipts ? "card.close" : "card.delete", { name })}
              onClick={onStop}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        ) : null}
      </div>
      {source.payslip && source.yearView && source.vacation ? (
        <div className="mt-3 flex flex-col gap-3">
          <PayslipLines slip={source.payslip} />
          <TaxNote slip={source.payslip} className="text-xs text-muted" />
          <YearPay
            view={source.yearView}
            vacation={source.vacation}
            receivedParts={source.receivedParts}
            {...(source.nextYearView ? { title: t("extra.yearTitle", { year: data.year }) } : {})}
          />
          {source.yearView.vacations.length === 0 ? (
            <p className="text-xs text-muted">{t("extra.noVacation")}</p>
          ) : null}
          {source.orphanMonths.map((month) => (
            <p
              key={month}
              role="status"
              className="rounded-xl bg-warning-soft p-3 text-sm text-warning"
            >
              {t("choices.orphanReceipt", { month: formatMonthYear(month, locale) })}
            </p>
          ))}
          {source.nextYearView ? (
            <YearPay
              view={source.nextYearView}
              vacation={source.vacation}
              receivedParts={source.receivedNext}
              title={t("extra.yearTitle", { year: data.year + 1 })}
            />
          ) : null}
          {writable ? (
            <div>
              <Button variant="secondary" onClick={onEdit}>
                <CalendarDays className="size-4" aria-hidden="true" />
                {t("extra.adjust")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
          {moneyText(source.monthly)}
        </p>
      )}
    </Card>
  );
}

export function IncomeBoard({ data, writable }: { data: Data; writable: boolean }) {
  const t = useTranslations("renda");
  const locale = useLocale();
  const moneyText = useMoney();
  const [editing, setEditing] = useState<{
    nonce: number;
    source: Source | null;
    draft: Draft | null;
  } | null>(null);
  const [stopping, setStopping] = useState<Source | null>(null);
  const close = () => setEditing(null);
  const open = (source: Source | null, draft: Draft | null = null) =>
    setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, source, draft }));
  const hasPayroll = data.sources.some((source) => source.payslip);
  const brazil = useBrazilRules();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          writable ? (
            <Button variant="secondary" onClick={() => open(null)}>
              <Plus className="size-4" aria-hidden="true" />
              {t("new")}
            </Button>
          ) : null
        }
      />

      {brazil ? (
        <div className="flex items-start gap-2 rounded-xl bg-card p-3 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{t("estimate", { month: formatMonthYear(data.table.validFrom, locale) })}</p>
        </div>
      ) : null}

      {data.recurringIncome > 0 && data.sources.length > 0 ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{t("doubleCount")}</p>
        </div>
      ) : null}

      {data.sources.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatTile label={t("stats.net")} value={moneyText(data.summary.monthly)} />
          {brazil ? (
            <>
              <StatTile label={t("stats.gross")} value={moneyText(data.summary.gross)} />
              <StatTile label={t("stats.discounts")} value={moneyText(data.summary.discounts)} />
            </>
          ) : null}
          {hasPayroll ? (
            <StatTile label={t("stats.thirteenth")} value={moneyText(data.summary.thirteenth)} />
          ) : null}
        </dl>
      ) : null}

      {data.sources.length === 0 ? (
        <Card>
          <EmptyState
            title={t("empty.title")}
            text={t(brazil ? "empty.text" : "empty.textSimple")}
            action={
              writable ? <Button onClick={() => open(null)}>{t("empty.action")}</Button> : null
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          {data.sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              data={data}
              writable={writable}
              onEdit={() => open(source)}
              onStop={() => setStopping(source)}
            />
          ))}
        </div>
      )}

      {brazil ? (
        <Simulator data={data} writable={writable} onRegister={(draft) => open(null, draft)} />
      ) : null}

      <Sheet
        open={editing !== null}
        onClose={close}
        title={t(editing?.source ? "sheet.edit" : "sheet.new")}
      >
        <IncomeForm
          key={editing?.nonce}
          source={editing?.source ?? null}
          draft={editing?.draft ?? null}
          data={data}
          onDone={close}
        />
      </Sheet>
      <ConfirmSheet
        open={stopping !== null}
        onClose={() => setStopping(null)}
        title={t(stopping?.hasReceipts ? "stop.closeTitle" : "stop.deleteTitle")}
        text={t(stopping?.hasReceipts ? "stop.closeText" : "stop.deleteText", {
          name: stopping?.name ?? "",
        })}
        confirmLabel={t(stopping?.hasReceipts ? "stop.closeConfirm" : "stop.deleteConfirm")}
        action={stopIncome}
        hidden={{ id: stopping?.id ?? "" }}
      />
    </div>
  );
}
