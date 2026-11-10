"use client";
import { Plus, Target, Trash2, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { cameFromFile, money, netDividend } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
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
import { addDividend, deleteDividend, saveGoal, type FormState } from "./actions";
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

function OutlookTiles({ outlook }: { outlook: Outlook }) {
  const t = useTranslations("proventos.outlook");
  const locale = useLocale();
  const moneyText = useMoney();
  return (
    <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-3">
      <StatTile
        label={t("yield")}
        value={
          outlook.yieldUsed === null
            ? t("noData")
            : formatPercentExact(money(outlook.yieldUsed).toDecimalPlaces(1).toNumber(), locale, 1)
        }
        hint={t(`yieldBasis.${outlook.yieldBasis}`, { months: outlook.yieldMonthsBasis ?? 0 })}
      />
      <StatTile
        label={t("currentIncome")}
        value={moneyText(outlook.currentIncome)}
        hint={t("currentIncomeHint")}
      />
      <StatTile
        label={t("target")}
        value={outlook.targetIncome ? moneyText(outlook.targetIncome) : t("noData")}
        hint={
          outlook.targetIncome
            ? t(`targetHint.${outlook.targetBasis}`, {
                percent: formatPercent(outlook.coverage, locale),
              })
            : t.rich("targetMissing", {
                link: (chunks) => (
                  <Link href="/app/aposentadoria" className="font-medium underline">
                    {chunks}
                  </Link>
                ),
              })
        }
      />
    </dl>
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
  const chartState = monthlyChartState(summary.months, data.upcoming.length);
  const canAdd = writable && data.investments.length > 0;

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
            </>
          ) : null
        }
      />
      {insights}

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
            <StatTile label={t("stats.thisYear")} value={moneyText(summary.thisYear)} />
            <StatTile
              label={t("stats.withheld")}
              value={moneyText(summary.withheld12)}
              hint={t("stats.last12Months")}
            />
            <StatTile
              label={t("stats.goal")}
              value={data.goal ? moneyText(data.goal) : t("stats.noGoal")}
              hint={
                summary.goalPercent === null
                  ? undefined
                  : t("stats.goalCoverage", {
                      percent: formatPercent(summary.goalPercent, locale),
                    })
              }
            />
          </dl>

          {outlook ? <OutlookTiles outlook={outlook} /> : null}

          <Card
            title={t("monthly.title")}
            actions={
              writable ? (
                <Button variant="secondary" small onClick={() => open("goal")}>
                  <Target className="size-4" aria-hidden="true" />
                  {t("monthly.setGoal")}
                </Button>
              ) : null
            }
          >
            {chartState === "barras" ? (
              <DividendsChart points={summary.months} />
            ) : chartState === "a_receber" ? (
              <EmptyState
                title={t("monthly.emptyTitle")}
                text={t("monthly.emptyUpcoming", {
                  amount: moneyText(data.upcomingNet),
                  date: formatDate(data.upcoming[0]!.paidOn, locale),
                })}
              />
            ) : (
              <EmptyState title={t("monthly.emptyTitle")} text={t("monthly.emptyText")} />
            )}
          </Card>

          {outlook ? <ForecastCard months={outlook.forecast} /> : null}

          {data.upcoming.length > 0 ? (
            <Card
              title={t("upcoming.title")}
              description={t("upcoming.description", {
                amount: moneyText(data.upcomingNet),
              })}
            >
              <UpcomingByDay
                rows={data.upcoming}
                today={data.today}
                writable={writable}
                onRemove={setRemoving}
              />
            </Card>
          ) : null}

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            <Card title={t("received.title")}>
              {data.rows.length === 0 ? (
                <EmptyState title={t("received.emptyTitle")} text={t("received.emptyText")} />
              ) : (
                <ul
                  aria-label={t("received.list")}
                  className="m-0 list-none divide-y divide-line p-0"
                >
                  {data.rows.map((row) => (
                    <DividendLine
                      key={row.id}
                      row={row}
                      writable={writable}
                      onRemove={setRemoving}
                    />
                  ))}
                </ul>
              )}
            </Card>

            <Card title={t("byInvestment.title")} description={t("byInvestment.description")}>
              {data.byInvestment.length === 0 ? (
                <p className="text-sm text-muted">{t("byInvestment.empty")}</p>
              ) : (
                <ul
                  aria-label={t("byInvestment.title")}
                  className="m-0 list-none divide-y divide-line p-0"
                >
                  {data.byInvestment.map((item) => (
                    <li
                      key={item.investmentId}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate font-medium">{item.label}</span>
                      <span className="whitespace-nowrap tabular-nums">
                        {moneyText(item.net)}
                        {item.yieldOnCost !== null
                          ? ` · ${formatPercentExact(item.yieldOnCost, locale)}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
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
