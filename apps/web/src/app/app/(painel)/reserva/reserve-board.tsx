"use client";
import { ArrowRight, ChevronDown, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  useActionState,
  useEffect,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { addMonths, money, monthsToReserve, parseMoney, reserveStatus } from "@organizeup/domain";
import { FxNote } from "@/components/fx-note";
import { buttonClass, cx } from "@/components/styles";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  Input,
  PageHeader,
  Sheet,
  submitKeeping,
} from "@/components/ui";
import { formatAmount, formatMonthYear, formatPercent, toFieldValue } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import type { loadReserve } from "@/lib/wealth";
import { systemTextOf } from "@/i18n/system-text";
import {
  saveReserveContribution,
  saveReserveEssential,
  saveReserveMonths,
  toggleReserveAccount,
  type ReserveFormState,
} from "./actions";
import { reserveNextStep, type NextStep } from "./next-step";

type Data = Awaited<ReturnType<typeof loadReserve>>;
type Status = Data["status"];

const initial: ReserveFormState = { ok: false, message: null };

/** Valor do banco de volta ao campo, com as duas casas: "500.00" vira "500,00" em português. */
/** Número de meses digitado, ou null enquanto não for um valor aceito. */
function parseMonths(text: string) {
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= 60 ? value : null;
}

/** Valor digitado em banco ("500.00"), null em branco e "invalid" se não der para ler. */
function parseAmount(text: string, locale: Locale) {
  if (!text.trim()) return null;
  try {
    const value = parseMoney(text, locale);
    return value.lte(0) ? "invalid" : value.toFixed(2);
  } catch {
    return "invalid";
  }
}

function EssentialForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const t = useTranslations("reserva");
  const common = useTranslations("common");
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveReserveEssential, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("essential.intro")}</p>
      <Field label={t("essential.label")} hint={t("essential.hint")}>
        <Input
          name="monthly"
          inputMode="decimal"
          placeholder={t("amountPlaceholder")}
          defaultValue={toFieldValue(data.informedMonthly, locale)}
        />
      </Field>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? common("saving") : t("essential.submit")}
      </Button>
    </form>
  );
}

function SaveInline({ pending, label }: { pending: boolean; label: string }) {
  const t = useTranslations("reserva");
  const common = useTranslations("common");
  return (
    <Button type="submit" variant="secondary" disabled={pending} aria-label={label}>
      {pending ? common("saving") : t("save")}
    </Button>
  );
}

function MonthsField({
  saved,
  text,
  onChange,
  writable,
}: {
  saved: number;
  text: string;
  onChange: (text: string) => void;
  writable: boolean;
}) {
  const t = useTranslations("reserva");
  const [state, action, pending] = useActionState(saveReserveMonths, initial);
  const typed = parseMonths(text);
  const dirty = typed !== null && typed !== saved;
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-wrap items-end gap-2">
      <div className="w-36">
        <Field
          label={t("months.label")}
          hint={t("months.hint")}
          error={typed === null ? t("errors.months") : undefined}
        >
          <Input
            name="targetMonths"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            required
            disabled={!writable}
            value={text}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      </div>
      {writable && dirty ? (
        <div className="pb-5">
          <SaveInline pending={pending} label={t("months.saveLabel")} />
        </div>
      ) : null}
      <div className="w-full">
        <FormMessage message={state.ok ? null : state.message} />
      </div>
    </form>
  );
}

function AccountToggle({
  account,
  writable,
}: {
  account: Data["accounts"][number];
  writable: boolean;
}) {
  const locale = useLocale();
  const system = systemTextOf(useTranslations("sistema"));
  const [selected, setSelected] = useOptimistic(account.selected);
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: boolean) => {
    setError(null);
    start(async () => {
      setSelected(next);
      const result = await toggleReserveAccount(account.id, next);
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <li className="py-1">
      <label
        className={cx(
          "flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 text-sm",
          writable && "cursor-pointer hover:bg-brand-50",
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          disabled={!writable}
          onChange={(event) => toggle(event.target.checked)}
          className="size-5 shrink-0 accent-brand-500"
        />
        <span className={cx("min-w-0 flex-1 break-words", selected && "font-medium")}>
          {system.name(account.name)}
        </span>
        <span className="tabular-nums text-muted">{formatAmount(account.balance, locale)}</span>
      </label>
      <FormMessage message={error} />
    </li>
  );
}

function NeedCard({
  data,
  status,
  monthsText,
  onMonths,
  writable,
  onEdit,
}: {
  data: Data;
  status: Status;
  monthsText: string;
  onMonths: (text: string) => void;
  writable: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations("reserva");
  const locale = useLocale();
  if (data.baseline.basis === "sem_dados")
    return (
      <Card title={t("need.title")}>
        <p className="font-semibold">{t("need.unknownTitle")}</p>
        <p className="mt-1 text-sm text-muted">{t("need.unknownText")}</p>
        {writable ? (
          <Button variant="secondary" className="mt-4" onClick={onEdit}>
            {t("need.inform")}
          </Button>
        ) : null}
      </Card>
    );

  const used = parseMonths(monthsText) ?? data.targetMonths;
  const { basis, months } = data.baseline;
  return (
    <Card title={t("need.title")}>
      <p className="font-display text-4xl font-medium tabular-nums">
        {formatAmount(status.target, locale)}
      </p>
      <p className="mt-2 text-sm">
        {t("need.summary", {
          count: used,
          amount: formatAmount(data.baseline.monthly, locale),
        })}
      </p>
      <p className="mt-1 text-sm text-muted">
        {basis === "informado"
          ? t("need.basis.informed")
          : basis === "media"
            ? t("need.basis.average", { months })
            : t("need.basis.estimate")}
      </p>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <MonthsField
          saved={data.targetMonths}
          text={monthsText}
          onChange={onMonths}
          writable={writable}
        />
        {writable ? (
          <Button variant="ghost" onClick={onEdit}>
            {t("need.adjust")}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function HaveCard({ data, status, writable }: { data: Data; status: Status; writable: boolean }) {
  const t = useTranslations("reserva.have");
  const locale = useLocale();
  const selected = data.accounts.filter((account) => account.selected);
  return (
    <Card title={t("title")}>
      <p className="font-display text-4xl font-medium tabular-nums">
        {formatAmount(status.saved, locale)}
      </p>
      <FxNote fx={data.fx} className="m-0 mt-1 text-xs text-muted" />
      <p className="mt-2 text-sm">
        {t("status", { count: selected.length, name: selected[0]?.name ?? "" })}
      </p>
      <p className="mt-1 text-sm text-muted">{t("text")}</p>
      {data.accounts.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={t("emptyTitle")}
            text={t("emptyText")}
            action={
              writable ? (
                <Link href="/app/contas" className={buttonClass("secondary")}>
                  {t("emptyAction")}
                </Link>
              ) : null
            }
          />
        </div>
      ) : (
        <ul
          aria-label={t("listLabel")}
          className="m-0 mt-3 list-none divide-y divide-line border-y border-line p-0"
        >
          {data.accounts.map((account) => (
            <AccountToggle key={account.id} account={account} writable={writable} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ContributionForm({
  data,
  text,
  onChange,
  suggested,
  writable,
}: {
  data: Data;
  text: string;
  onChange: (text: string) => void;
  suggested: string | null;
  writable: boolean;
}) {
  const t = useTranslations("reserva");
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveReserveContribution, initial);
  const typed = parseAmount(text, locale);
  const saved = data.contribution === null ? null : money(data.contribution).toFixed(2);
  const dirty = typed !== "invalid" && typed !== saved;
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-wrap items-end gap-2">
      <div className="w-72 max-w-full">
        <Field
          label={t("contribution.label")}
          hint={
            suggested && !saved
              ? t("contribution.hint", { amount: formatAmount(suggested, locale) })
              : undefined
          }
          error={typed === "invalid" ? t("errors.amountExample") : undefined}
        >
          <Input
            name="contribution"
            inputMode="decimal"
            placeholder={t("amountPlaceholder")}
            value={text}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      </div>
      {writable && dirty ? (
        <div className={suggested && !saved ? "pb-5" : undefined}>
          <SaveInline pending={pending} label={t("contribution.saveLabel")} />
        </div>
      ) : null}
      <div className="w-full">
        <FormMessage message={state.ok ? null : state.message} />
      </div>
    </form>
  );
}

function MissingCard({
  data,
  status,
  done,
  percent,
  amount,
  contributionText,
  onContribution,
  suggested,
  writable,
}: {
  data: Data;
  status: Status;
  done: boolean;
  percent: number;
  amount: string | null;
  contributionText: string;
  onContribution: (text: string) => void;
  suggested: string | null;
  writable: boolean;
}) {
  const t = useTranslations("reserva.missing");
  const locale = useLocale();
  if (data.baseline.basis === "sem_dados")
    return (
      <Card title={t("title")}>
        <p className="text-sm text-muted">{t("unknownText")}</p>
      </Card>
    );

  const left = amount === null ? null : monthsToReserve(status.missing, amount);
  return (
    <Card title={t("title")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="font-display text-4xl font-medium tabular-nums">
          {formatAmount(status.missing, locale)}
        </p>
        {done ? (
          <Badge tone="success">
            <ShieldCheck className="size-3" aria-hidden="true" />
            {t("complete")}
          </Badge>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label={t("progressLabel")}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-4 h-3 rounded-full bg-brand-100"
      >
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-sm text-muted">
        {t("progress", {
          percent: formatPercent(percent, locale),
          count: status.coveredMonths,
        })}
      </p>
      {done ? null : (
        <div className="mt-5 border-t border-line pt-4">
          <ContributionForm
            data={data}
            text={contributionText}
            onChange={onContribution}
            suggested={suggested}
            writable={writable}
          />
          {left !== null && amount !== null ? (
            <p role="status" className="mt-3 text-sm">
              {t.rich("forecast", {
                amount: formatAmount(amount, locale),
                date: formatMonthYear(addMonths(data.month, left), locale),
                count: left,
                b: (chunks) => <span className="font-semibold">{chunks}</span>,
              })}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function NextStepCard({ step, writable }: { step: NextStep; writable: boolean }) {
  const t = useTranslations("reserva.nextStep");
  const locale = useLocale();
  const { action, key } = step;
  const values = {
    amount: step.amount ? formatAmount(step.amount, locale) : "",
    place: step.place ?? "",
  };
  const className = cx(buttonClass("accent"), "shrink-0");
  const content = (
    <>
      {t(`${key}.action`)}
      <ArrowRight className="size-4" aria-hidden="true" />
    </>
  );
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-brand-900 p-5 text-white shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="min-w-0">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-sand-200">
          {t("heading")}
        </h2>
        <p className="mt-1 font-display text-2xl font-medium">{t(`${key}.title`, values)}</p>
        <p className="mt-1 max-w-2xl text-sm text-sand-100">{t(`${key}.text`, values)}</p>
      </div>
      {!action.writes || writable ? (
        action.href.startsWith("#") ? (
          <a href={action.href} className={className}>
            {content}
          </a>
        ) : (
          <Link href={action.href} className={className}>
            {content}
          </Link>
        )
      ) : null}
    </section>
  );
}

function HowItWorks() {
  const t = useTranslations("reserva.how");
  const b = (chunks: ReactNode) => <span className="font-semibold">{chunks}</span>;
  return (
    <details className="group rounded-2xl border border-line bg-card shadow-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 font-semibold sm:px-6 [&::-webkit-details-marker]:hidden">
        <span>{t("title")}</span>
        <ChevronDown
          className="size-5 shrink-0 text-muted transition group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="flex flex-col gap-3 px-5 pb-5 text-sm sm:px-6 sm:pb-6">
        <p>{t.rich("source", { b })}</p>
        <p>
          {t.rich("mark", {
            b,
            link: (chunks) => (
              <Link href="/app/categorias" className="font-medium underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
        <p>{t.rich("money", { b })}</p>
      </div>
    </details>
  );
}

export function ReserveBoard({
  data,
  suggested,
  writable,
  insights,
}: {
  data: Data;
  suggested: string | null;
  writable: boolean;
  insights: ReactNode;
}) {
  const t = useTranslations("reserva");
  const locale = useLocale();
  const [editing, setEditing] = useState<number | null>(null);
  const close = () => setEditing(null);
  const open = () => setEditing((nonce) => (nonce ?? 0) + 1);

  const [monthsText, setMonthsText] = useState(String(data.targetMonths));
  const [contributionText, setContributionText] = useState(toFieldValue(data.contribution, locale));

  // O alvo acompanha o número digitado antes de salvar.
  const status = useMemo(
    () =>
      reserveStatus(
        data.status.saved,
        data.baseline.monthly,
        parseMonths(monthsText) ?? data.targetMonths,
      ),
    [data.status.saved, data.baseline.monthly, data.targetMonths, monthsText],
  );

  const typed = parseAmount(contributionText, locale);
  const amount = typed === "invalid" ? null : (typed ?? suggested);
  const hasBaseline = data.baseline.basis !== "sem_dados";
  const done = hasBaseline && money(status.missing).isZero();
  // Arredondar não pode mostrar 100% enquanto ainda falta dinheiro.
  const percent = done ? 100 : Math.min(status.percent, 99);
  const step = reserveNextStep({
    hasBaseline,
    hasExpenses: data.hasExpenses,
    accounts: data.accounts,
    status,
    contribution: amount,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      {insights}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <NeedCard
          data={data}
          status={status}
          monthsText={monthsText}
          onMonths={setMonthsText}
          writable={writable}
          onEdit={open}
        />
        <div id="quanto-tenho" className="scroll-mt-6">
          <HaveCard data={data} status={status} writable={writable} />
        </div>
      </div>

      <div id="quanto-falta" className="scroll-mt-6">
        <MissingCard
          data={data}
          status={status}
          done={done}
          percent={percent}
          amount={amount}
          contributionText={contributionText}
          onContribution={setContributionText}
          suggested={suggested}
          writable={writable}
        />
      </div>

      <NextStepCard step={step} writable={writable} />
      <HowItWorks />

      <Sheet open={editing !== null} onClose={close} title={t("essential.sheetTitle")}>
        <EssentialForm key={editing} data={data} onDone={close} />
      </Sheet>
    </div>
  );
}
