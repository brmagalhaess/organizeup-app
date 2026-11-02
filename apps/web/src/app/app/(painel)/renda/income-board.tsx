"use client";
import { AlertTriangle, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  calculatePayslip,
  calculateThirteenth,
  calculateVacation,
  money,
  parseMoney,
  toDbAmount,
  type IncomeKind,
  type Payslip,
  type ThirteenthSalary,
  type VacationPay,
} from "@organizeup/domain";
import { cx } from "@/components/styles";
import {
  Badge,
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
import { formatMonthYear, monthName, monthNames, toAmountInput } from "@/i18n/format";
import type { loadIncome } from "@/lib/income-data";
import { systemTextOf } from "@/i18n/system-text";
import { saveIncome, stopIncome, type IncomeFormState } from "./actions";
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

function ExtraPay({
  thirteenth,
  vacation,
}: {
  thirteenth: ThirteenthSalary;
  vacation: VacationPay;
}) {
  const t = useTranslations("renda.extra");
  const tSlip = useTranslations("renda.slip");
  const moneyText = useMoney();
  const uncertain = !money(vacation.net).equals(vacation.netWithReduction);
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
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  const errors = state.fieldErrors ?? {};
  const defaultCategory = data.categories.find((c) => c.name === DEFAULT_CATEGORY[kind])?.id;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={source?.id ?? ""} />
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
          <div className="grid grid-cols-2 gap-3">
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
            <Field label={tForm("vacationMonth")} error={errors.vacationMonth}>
              <Select name="vacationMonth" defaultValue={source?.vacationMonth ?? 0}>
                <option value={0}>{tForm("notSure")}</option>
                {monthNames(locale).map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
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
      {source.payslip && source.thirteenth && source.vacation ? (
        <div className="mt-3 flex flex-col gap-3">
          <PayslipLines slip={source.payslip} />
          <TaxNote slip={source.payslip} className="text-xs text-muted" />
          <ExtraPay thirteenth={source.thirteenth} vacation={source.vacation} />
          {source.vacationMonth ? (
            <div>
              <Badge>
                {t("extra.vacationIn", { month: monthName(source.vacationMonth, locale) })}
              </Badge>
            </div>
          ) : (
            <p className="text-xs text-muted">{t("extra.noVacation")}</p>
          )}
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
