"use client";
import { Plus, RefreshCw, Target, Trash2, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import {
  cameFromFile,
  DIVIDEND_PERIODS,
  money,
  netDividend,
  type DividendPeriod,
} from "@organizeup/domain";
import { buttonClass, cx } from "@/components/styles";
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
  submitKeeping,
} from "@/components/ui";
import {
  formatDate,
  formatMonthYear,
  formatPercent,
  formatPercentExact,
  formatWeekdayName,
  toFieldValue,
} from "@/i18n/format";
import type { loadDividends } from "@/lib/investments";
import { addDividend, checkDividends, deleteDividend, saveGoal, type FormState } from "./actions";
import { DividendsChart } from "./dividends-chart";
import { monthlyChartState } from "@/lib/dividends-chart-state";
import type { loadDividendOutlook } from "./outlook";
import { useMoney } from "@/i18n/money";

type Data = Awaited<ReturnType<typeof loadDividends>>;
type Row = Data["rows"][number];
type Outlook = NonNullable<Awaited<ReturnType<typeof loadDividendOutlook>>>;

const KINDS = ["dividendo", "jcp", "rendimento"] as const;

const initial: FormState = { ok: false, message: null };

function DividendForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const t = useTranslations("proventos");
  const [state, action, pending] = useActionState(addDividend, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <Field label={t("form.investment")}>
        <Select name="investmentId" required>
          {data.investments.map((investment) => (
            <option key={investment.id} value={investment.id}>
              {investment.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("form.kind")}>
          <Select name="kind" defaultValue="dividendo">
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kindOptions.${kind}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("form.paidOn")}>
          <Input name="paidOn" type="date" required defaultValue={data.today} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("form.gross")}>
          <Input
            name="gross"
            inputMode="decimal"
            required
            placeholder={t("form.amountPlaceholder")}
          />
        </Field>
        <Field label={t("form.withheld")} hint={t("form.withheldHint")}>
          <Input name="withheld" inputMode="decimal" placeholder={t("form.amountPlaceholder")} />
        </Field>
      </div>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("form.save")}
      </Button>
    </form>
  );
}

function DividendLine({
  row,
  writable,
  onRemove,
  hideDate = false,
}: {
  row: Row;
  writable: boolean;
  onRemove: (row: Row) => void;
  /** Dentro do grupo por dia a data já está no cabeçalho. */
  hideDate?: boolean;
}) {
  const t = useTranslations("proventos");
  const locale = useLocale();
  const moneyText = useMoney();
  const details = [
    hideDate ? null : formatDate(row.paidOn, locale),
    money(row.withheld).gt(0) ? t("line.gross", { amount: moneyText(row.gross) }) : null,
    row.market
      ? t("line.market", {
          date: formatDate(row.market.comDate, locale),
          source: row.market.source,
        })
      : null,
  ].filter((part): part is string => part !== null);
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {row.label}
          <Badge>{t(`kinds.${row.kind}`)}</Badge>
          {row.source === "agente" ? <Badge tone="success">{t("line.automatic")}</Badge> : null}
          {cameFromFile(row) ? <Badge>{t("line.imported")}</Badge> : null}
        </p>
        {details.length > 0 ? <p className="text-xs text-muted">{details.join(" · ")}</p> : null}
      </div>
      <span className="whitespace-nowrap font-medium tabular-nums">
        {moneyText(netDividend(row))}
      </span>
      {writable ? (
        <IconButton label={t("line.remove", { name: row.label })} onClick={() => onRemove(row)}>
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      ) : null}
    </li>
  );
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * A receber, agrupado pelo dia do pagamento: cabeçalho com a data por extenso, quando falta e quanto
 * entra naquele dia; dentro, um ativo por linha. Olhando, dá para saber o que cai em cada dia.
 */
function UpcomingByDay({
  rows,
  today,
  writable,
  onRemove,
}: {
  rows: Row[];
  today: string;
  writable: boolean;
  onRemove: (row: Row) => void;
}) {
  const t = useTranslations("proventos");
  const locale = useLocale();
  const moneyText = useMoney();
  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(row.paidOn, [...(groups.get(row.paidOn) ?? []), row]);
  return (
    <ol aria-label={t("upcoming.list")} className="m-0 flex list-none flex-col gap-4 p-0">
      {[...groups.entries()].map(([paidOn, items]) => {
        const days = daysBetween(today, paidOn);
        const total = items.reduce((acc, row) => acc.plus(netDividend(row)), money(0));
        return (
          <li key={paidOn} className="rounded-lg border border-line">
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line bg-card-soft px-3 py-2">
              <div className="min-w-0">
                <p className="m-0 text-sm font-semibold capitalize">
                  {formatWeekdayName(paidOn, locale)}
                </p>
                <p className="m-0 text-xs text-muted">
                  {formatDate(paidOn, locale)} ·{" "}
                  {days === 1 ? t("upcoming.tomorrow") : t("upcoming.inDays", { days })}
                </p>
              </div>
              <p className="m-0 text-sm font-semibold tabular-nums">
                {t("upcoming.dayTotal", { amount: moneyText(total.toFixed(2)) })}
              </p>
            </header>
            <ul className="m-0 list-none divide-y divide-line p-0 px-3">
              {items.map((row) => (
                <DividendLine
                  key={row.id}
                  row={row}
                  writable={writable}
                  onRemove={onRemove}
                  hideDate
                />
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

function GoalForm({ data, onDone }: { data: Data; onDone: () => void }) {
  const t = useTranslations("proventos");
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveGoal, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <Field label={t("goal.label")} hint={t("goal.hint")}>
        <Input
          name="monthlyAmount"
          inputMode="decimal"
          placeholder={t("goal.placeholder")}
          defaultValue={toFieldValue(data.goal, locale)}
        />
      </Field>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("goal.save")}
      </Button>
    </form>
  );
}

/** Renda passiva: o que a carteira rende hoje, a renda alvo e quanto dela já está coberta. */
function PassiveIncomeCard({ outlook }: { outlook: Outlook }) {
  const t = useTranslations("proventos");
  const locale = useLocale();
  const moneyText = useMoney();
  const coverage = Math.max(0, Math.min(100, outlook.coverage));
  return (
    <Card title={t("passive.title")} description={t("passive.description")}>
      <dl className="m-0 flex flex-col divide-y divide-line">
        <div className="flex items-start justify-between gap-4 py-3 first:pt-0">
          <div className="min-w-0">
            <dt className="text-sm font-medium">{t("outlook.yield")}</dt>
            <dd className="m-0 text-xs text-muted">
              {t(`outlook.yieldBasis.${outlook.yieldBasis}`, {
                months: outlook.yieldMonthsBasis ?? 0,
              })}
            </dd>
          </div>
          <dd className="m-0 whitespace-nowrap text-lg font-semibold tabular-nums">
            {outlook.yieldUsed === null
              ? t("outlook.noData")
              : formatPercentExact(
                  money(outlook.yieldUsed).toDecimalPlaces(1).toNumber(),
                  locale,
                  1,
                )}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <dt className="text-sm font-medium">{t("outlook.currentIncome")}</dt>
            <dd className="m-0 text-xs text-muted">{t("outlook.currentIncomeHint")}</dd>
          </div>
          <dd className="m-0 whitespace-nowrap text-lg font-semibold tabular-nums">
            {moneyText(outlook.currentIncome)}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4 py-3 last:pb-0">
          <div className="min-w-0">
            <dt className="text-sm font-medium">{t("outlook.target")}</dt>
            <dd className="m-0 text-xs text-muted">
              {outlook.targetIncome
                ? t(`outlook.targetHint.${outlook.targetBasis}`, {
                    percent: formatPercent(outlook.coverage, locale),
                  })
                : t.rich("outlook.targetMissing", {
                    link: (chunks) => (
                      <Link href="/app/aposentadoria" className="font-medium underline">
                        {chunks}
                      </Link>
                    ),
                  })}
            </dd>
          </div>
          <dd className="m-0 whitespace-nowrap text-lg font-semibold tabular-nums">
            {outlook.targetIncome ? moneyText(outlook.targetIncome) : t("outlook.noData")}
          </dd>
        </div>
      </dl>
      {outlook.targetIncome ? (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs text-muted">
            <span>
              {t("passive.coverage", { percent: formatPercent(outlook.coverage, locale) })}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-brand-50" aria-hidden="true">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${coverage}%` }} />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function ForecastCard({ months }: { months: Outlook["forecast"] }) {
  const t = useTranslations("proventos.forecast");
  const locale = useLocale();
  const moneyText = useMoney();
  return (
    <Card title={t("title")} description={t("description")}>
      {months.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1.5 font-medium">
                {t("month")}
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                {t("amount")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {months.map((row) => (
              <tr key={row.month}>
                <td className="py-1.5 first-letter:uppercase">
                  {formatMonthYear(row.month, locale)}
                </td>
                <td className="py-1.5 text-right font-medium tabular-nums">
                  {moneyText(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Quem paga mais: barra por ativo, do maior para o menor, com o rendimento sobre o custo. */
function ByInvestment({ items }: { items: Data["byInvestment"] }) {
  const t = useTranslations("proventos.byInvestment");
  const locale = useLocale();
  const moneyText = useMoney();
  const top = items.reduce(
    (acc, item) => (money(item.net).gt(acc) ? money(item.net) : acc),
    money(0),
  );
  return (
    <ul aria-label={t("title")} className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map((item) => {
        const width = top.isZero() ? 0 : money(item.net).dividedBy(top).times(100).toNumber();
        return (
          <li key={item.investmentId} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-medium">{item.label}</span>
              <span className="whitespace-nowrap tabular-nums">
                {moneyText(item.net)}
                {item.yieldOnCost !== null ? (
                  <span className="text-muted">
                    {" "}
                    · {formatPercentExact(item.yieldOnCost, locale)}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-brand-50" aria-hidden="true">
              <div
                className="h-1.5 rounded-full bg-brand-500"
                style={{ width: `${Math.max(2, width)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Histórico agrupado por mês, com o total do mês no cabeçalho. */
function History({
  rows,
  writable,
  onRemove,
}: {
  rows: Row[];
  writable: boolean;
  onRemove: (row: Row) => void;
}) {
  const t = useTranslations("proventos");
  const locale = useLocale();
  const moneyText = useMoney();
  const months = new Map<string, Row[]>();
  for (const row of rows) {
    const month = row.paidOn.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), row]);
  }
  return (
    <div className="flex flex-col gap-4">
      {[...months.entries()].map(([month, items]) => {
        const total = items.reduce((acc, row) => acc.plus(netDividend(row)), money(0));
        return (
          <section key={month} aria-label={formatMonthYear(month, locale)}>
            <header className="flex items-baseline justify-between gap-3 rounded-lg bg-card-soft px-3 py-2 text-sm">
              <h3 className="m-0 font-semibold first-letter:uppercase">
                {formatMonthYear(month, locale)}
              </h3>
              <p className="m-0 tabular-nums text-muted">
                {t("history.monthTotal", { amount: moneyText(total.toFixed(2)) })}
              </p>
            </header>
            <ul
              aria-label={t("received.list")}
              className="m-0 list-none divide-y divide-line p-0 px-3"
            >
              {items.map((row) => (
                <DividendLine key={row.id} row={row} writable={writable} onRemove={onRemove} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function DividendsBoard({
  data,
  outlook,
  writable,
  insights,
}: {
  data: Data;
  outlook: Outlook | null;
  writable: boolean;
  insights: ReactNode;
}) {
  const t = useTranslations("proventos");
  const locale = useLocale();
  const moneyText = useMoney();
  const [sheet, setSheet] = useState<{ type: "new" | "goal"; nonce: number } | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const close = () => setSheet(null);
  const open = (type: "new" | "goal") => setSheet((s) => ({ type, nonce: (s?.nonce ?? 0) + 1 }));
  const { summary } = data;
  const [period, setPeriod] = useState<DividendPeriod>("12m");
  const points = data.chart[period];
  const chartState = monthlyChartState(points);
  const canAdd = writable && data.investments.length > 0;
  const [checkState, checkAction, checking] = useActionState(checkDividends, initial);
  const nextPayment = data.upcoming[0]?.paidOn ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={moneyText(summary.last12)}
        description={t("description")}
        actions={
          canAdd ? (
            <>
              <Link href="/app/proventos/importar" className={buttonClass("secondary")}>
                <Upload className="size-4" aria-hidden="true" />
                {t("importLink")}
              </Link>
              <Button variant="secondary" onClick={() => open("new")}>
                <Plus className="size-4" aria-hidden="true" />
                {t("add")}
              </Button>
              <form action={checkAction} className="contents">
                <Button type="submit" disabled={checking}>
                  <RefreshCw
                    className={cx("size-4", checking && "animate-spin")}
                    aria-hidden="true"
                  />
                  {checking ? t("check.pending") : t("check.button")}
                </Button>
              </form>
            </>
          ) : null
        }
      />
      {insights}
      {checkState.message ? (
        <p role="status" className="m-0 rounded-xl bg-brand-50 px-4 py-3 text-sm text-ink">
          {checkState.message}
        </p>
      ) : null}

      {data.investments.length === 0 ? (
        <Card>
          <EmptyState
            title={t("noInvestments.title")}
            text={t("noInvestments.text")}
            action={
              <Link href="/app/investimentos" className={buttonClass("secondary", true)}>
                {t("noInvestments.action")}
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatTile
              label={t("stats.average")}
              value={moneyText(summary.monthlyAverage)}
              hint={t("stats.last12Months")}
            />
            <StatTile
              label={t("stats.thisYear")}
              value={moneyText(summary.thisYear)}
              hint={t("stats.withheldYear", { amount: moneyText(summary.withheld12) })}
            />
            <StatTile
              label={t("stats.upcoming")}
              value={moneyText(data.upcomingNet)}
              hint={
                nextPayment
                  ? t("stats.upcomingNext", { date: formatDate(nextPayment, locale) })
                  : t("stats.upcomingNone")
              }
            />
            <StatTile
              label={t("stats.goal")}
              value={data.goal ? moneyText(data.goal) : t("stats.noGoal")}
              hint={
                summary.goalPercent === null
                  ? t("stats.goalHint")
                  : t("stats.goalCoverage", {
                      percent: formatPercent(summary.goalPercent, locale),
                    })
              }
            />
          </dl>

          <Card
            title={t("monthly.title")}
            description={t("monthly.description")}
            actions={
              writable ? (
                <Button variant="secondary" small onClick={() => open("goal")}>
                  <Target className="size-4" aria-hidden="true" />
                  {t("monthly.setGoal")}
                </Button>
              ) : null
            }
          >
            <div
              role="group"
              aria-label={t("monthly.periodLabel")}
              className="mb-4 flex flex-wrap gap-2"
            >
              {DIVIDEND_PERIODS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={period === value}
                  onClick={() => setPeriod(value)}
                  className={cx(
                    "inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium transition",
                    period === value
                      ? "border-brand-500 bg-brand-900 text-white"
                      : "border-line bg-card text-ink hover:bg-brand-50",
                  )}
                >
                  {t(`monthly.periods.${value}`)}
                </button>
              ))}
            </div>
            {chartState === "barras" ? (
              <DividendsChart points={points} />
            ) : (
              <EmptyState title={t(`monthly.empty.${period}`)} text={t("monthly.emptyText")} />
            )}
          </Card>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            <Card
              title={t("upcoming.title")}
              description={
                data.upcoming.length > 0
                  ? t("upcoming.description", { amount: moneyText(data.upcomingNet) })
                  : undefined
              }
            >
              {data.upcoming.length > 0 ? (
                <UpcomingByDay
                  rows={data.upcoming}
                  today={data.today}
                  writable={writable}
                  onRemove={setRemoving}
                />
              ) : (
                <p className="m-0 text-sm text-muted">{t("upcoming.empty")}</p>
              )}
            </Card>
            <Card title={t("byInvestment.title")} description={t("byInvestment.description")}>
              {data.byInvestment.length === 0 ? (
                <p className="m-0 text-sm text-muted">{t("byInvestment.empty")}</p>
              ) : (
                <ByInvestment items={data.byInvestment} />
              )}
            </Card>
          </div>

          {outlook ? (
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
              <PassiveIncomeCard outlook={outlook} />
              <ForecastCard months={outlook.forecast} />
            </div>
          ) : null}

          <Card title={t("history.title")} description={t("history.description")}>
            {data.rows.length === 0 ? (
              <EmptyState title={t("received.emptyTitle")} text={t("received.emptyText")} />
            ) : (
              <History rows={data.rows} writable={writable} onRemove={setRemoving} />
            )}
          </Card>
          <p className="text-xs text-muted">{t("automaticNote")}</p>
        </>
      )}

      <Sheet
        open={sheet !== null}
        onClose={close}
        title={sheet?.type === "goal" ? t("goal.title") : t("add")}
      >
        {sheet?.type === "new" ? (
          <DividendForm key={sheet.nonce} data={data} onDone={close} />
        ) : null}
        {sheet?.type === "goal" ? <GoalForm key={sheet.nonce} data={data} onDone={close} /> : null}
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("remove.title")}
        text={
          removing?.source === "agente"
            ? t("remove.textAutomatic", { name: removing.label })
            : t("remove.text", { name: removing?.label ?? "" })
        }
        confirmLabel={t("remove.confirm")}
        action={deleteDividend}
        hidden={{ id: removing?.id ?? "" }}
      />
    </div>
  );
}
