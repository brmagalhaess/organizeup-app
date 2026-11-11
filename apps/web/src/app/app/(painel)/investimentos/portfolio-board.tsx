"use client";
import { History, Pencil, Plus, Tag, Trash2, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { brazilRulesApply, isUnitPriced, money, stockEventKind } from "@organizeup/domain";
import { buttonClass, cx } from "@/components/styles";
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  FormMessage,
  Input,
  PageHeader,
  Select,
  Sheet,
  StatTile,
  submitKeeping,
} from "@/components/ui";
import { formatDate } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { groupByClass } from "@/lib/portfolio-groups";
import { tableCells, tableTotals } from "@/lib/portfolio-table";
import { splitZeroed } from "@/lib/portfolio-zeroed";
import type { PendingItem } from "@/lib/suggestions";
import {
  DecisionButtons,
  SuggestionFeedback,
  useSuggestionActions,
} from "../sugestoes/suggestion-controls";
import { deleteInvestment, saveInvestment, updateValue } from "./actions";
import { OperationForm } from "./operation-form";
import {
  classesFor,
  initial,
  percentText,
  quantityText,
  toInput,
  useCloseOnSuccess,
  type AssetClass,
  type Data,
  type Row,
} from "./shared";
import { useBrazilRules, useFamilyCurrency, useMoney } from "@/i18n/money";

const daysSince = (date: string, today: string) =>
  Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);

/** Tipo do evento em ações, como a fonte de cotações escreve na nota, para a chave do texto. */
const EVENT_KINDS: Record<string, "split" | "reverseSplit" | "bonus"> = {
  desdobramento: "split",
  grupamento: "reverseSplit",
  bonificação: "bonus",
};

/** Linha sob o investimento dizendo de onde vem o preço, ou o que falta para ele vir sozinho. */
function QuoteNote({ row, today }: { row: Row; today: string }) {
  const t = useTranslations("investimentos.quote");
  const locale = useLocale();
  switch (row.quoteState) {
    case "automatico": {
      const age = row.quoteDate ? daysSince(row.quoteDate, today) : 0;
      return (
        <p className="text-xs text-muted">
          {[
            t("auto", { date: formatDate(row.valuedOn ?? today, locale) }),
            row.quoteSource ? t("source", { source: row.quoteSource }) : null,
            age > 0 ? t("age", { count: age }) : t("delayed"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      );
    }
    case "sem_ticker":
      return <p className="text-xs text-muted">{t("noTicker")}</p>;
    case "ticker_invalido":
      return (
        <p className="text-xs text-danger">{t("invalidTicker", { ticker: row.ticker ?? "" })}</p>
      );
    case "aguardando":
      return <p className="text-xs text-muted">{t("waiting")}</p>;
    case "sem_plano":
      return <p className="text-xs text-muted">{t("noPlan")}</p>;
    default:
      return null;
  }
}

function InvestmentForm({ row, onDone }: { row: Row | null; onDone: () => void }) {
  const t = useTranslations("investimentos");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveInvestment, initial);
  const currency = useFamilyCurrency();
  const brazil = brazilRulesApply(currency);
  const classes = classesFor(currency);
  useCloseOnSuccess(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={row?.id ?? ""} />
      <Field label={t("form.name")}>
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={t(
            brazil
              ? "portfolio.investmentForm.namePlaceholder"
              : "portfolio.investmentForm.namePlaceholderAnywhere",
          )}
          defaultValue={row?.name}
        />
      </Field>
      <Field label={t("portfolio.investmentForm.class")}>
        <Select name="assetClass" defaultValue={row?.assetClass ?? classes[0]}>
          {classes.map((value) => (
            <option key={value} value={value}>
              {t(`classes.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      {brazil ? (
        <Field label={t("form.code")} hint={t("portfolio.investmentForm.codeHint")}>
          <Input name="ticker" maxLength={12} defaultValue={row?.ticker ?? ""} />
        </Field>
      ) : null}
      <fieldset className="m-0 flex flex-col gap-4 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-medium">
          {t("portfolio.investmentForm.references")}
        </legend>
        <p className="m-0 -mt-2 text-xs text-muted">
          {t("portfolio.investmentForm.referencesHint")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("portfolio.investmentForm.bookValue")}
            hint={t("portfolio.investmentForm.bookValueHint")}
          >
            <Input
              name="bookValuePerShare"
              inputMode="decimal"
              placeholder={t("form.pricePlaceholder")}
              defaultValue={toInput(row?.bookValuePerShare ?? null, locale)}
            />
          </Field>
          <Field
            label={t("portfolio.investmentForm.targetPrice")}
            hint={t("portfolio.investmentForm.targetPriceHint")}
          >
            <Input
              name="targetPrice"
              inputMode="decimal"
              placeholder={t("form.pricePlaceholder")}
              defaultValue={toInput(row?.targetPrice ?? null, locale)}
            />
          </Field>
        </div>
        <Field
          label={t("portfolio.investmentForm.targetPercent")}
          hint={t("portfolio.investmentForm.targetPercentHint")}
        >
          <Input
            name="targetPercent"
            inputMode="decimal"
            placeholder="10"
            defaultValue={toInput(row?.targetPercent ?? null, locale)}
          />
        </Field>
      </fieldset>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("portfolio.investmentForm.submit")}
      </Button>
    </form>
  );
}

function ValueForm({ row, today, onDone }: { row: Row; today: string; onDone: () => void }) {
  const t = useTranslations("investimentos");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [state, action, pending] = useActionState(updateValue, initial);
  useCloseOnSuccess(state, onDone);
  const unit = isUnitPriced(row.assetClass);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={row.id} />
      <div className="grid grid-cols-[3fr_2fr] gap-3">
        <Field
          label={t(unit ? "portfolio.valueForm.price" : "portfolio.valueForm.total")}
          hint={t(
            row.quoteState === "automatico" || row.quoteState === "informado"
              ? "portfolio.valueForm.hintAuto"
              : unit
                ? "portfolio.valueForm.hintUnit"
                : "portfolio.valueForm.hintStatement",
          )}
        >
          <Input
            name="value"
            inputMode="decimal"
            required
            placeholder={t("form.zeroPlaceholder")}
            defaultValue={toInput(unit ? row.currentPrice : row.currentValue, locale)}
          />
        </Field>
        <Field label={t("form.date")}>
          <Input name="valuedOn" type="date" required defaultValue={today} />
        </Field>
      </div>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("portfolio.valueForm.submit")}
      </Button>
    </form>
  );
}

/** Avisos do assistente. Fica montado depois da última decisão para mostrar a mensagem. */
function PortfolioSuggestions({ items, writable }: { items: PendingItem[]; writable: boolean }) {
  const t = useTranslations("investimentos.portfolio");
  const actions = useSuggestionActions();
  if (items.length === 0) return <SuggestionFeedback result={actions.result} />;
  return (
    <Card title={t("suggestions")}>
      <SuggestionFeedback result={actions.result} />
      <ul aria-label={t("suggestions")} className="m-0 list-none divide-y divide-line p-0">
        {items.map((item) => (
          <li key={item.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium">{item.title}</p>
            <p className="mt-1 text-sm text-muted">{item.body}</p>
            {writable ? (
              <DecisionButtons id={item.id} title={item.title} actions={actions} />
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

type Sheet_ =
  | { type: "operation"; nonce: number; id: string | null }
  | { type: "edit" | "value"; nonce: number; id: string };

/** Resultado do ativo: valor e percentual, com a cor dizendo o sinal. */
function GainCell({ row, locale }: { row: Row; locale: ReturnType<typeof useLocale> }) {
  const moneyText = useMoney();
  const gain = money(row.gain);
  if (row.estimated || row.gainPercent === null) return <span className="text-muted">—</span>;
  const tone = gain.gt(0) ? "text-success" : gain.lt(0) ? "text-danger" : "text-muted";
  return (
    <span className={cx("whitespace-nowrap tabular-nums", tone)}>
      <span className="block font-medium">
        {gain.gt(0) ? "+" : ""}
        {moneyText(row.gain)}
      </span>
      <span className="block text-xs">
        {gain.gt(0) ? "+" : ""}
        {percentText(row.gainPercent, locale)}
      </span>
    </span>
  );
}

const NUM = "whitespace-nowrap px-2 py-3 text-right tabular-nums";
const HEAD =
  "whitespace-nowrap px-2 pb-2 text-right text-xs font-medium uppercase tracking-wide text-muted";

function PercentCell({ value, locale }: { value: number | null; locale: Locale }) {
  if (value === null) return <span className="text-muted">—</span>;
  const tone = value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-muted";
  return (
    <span className={tone}>
      {value > 0 ? "+" : ""}
      {percentText(value, locale)}
    </span>
  );
}

/**
 * A carteira como tabela: as 13 colunas que a família acompanha, com uma faixa por tipo e os totais no pé.
 * Rola de lado no celular; a coluna do ativo fica fixa.
 */
function HoldingsTable({
  groups,
  total,
  today,
  stalePriceDays,
  writable,
  onOperation,
  onValue,
  onEdit,
  onRemove,
}: {
  groups: ReturnType<typeof groupByClass<Row>>;
  total: string;
  today: string;
  stalePriceDays: number;
  writable: boolean;
  onOperation: (id: string) => void;
  onValue: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (row: Row) => void;
}) {
  const t = useTranslations("investimentos");
  const locale = useLocale();
  const moneyText = useMoney();
  const ratio = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const rows = groups.flatMap((group) => group.rows.map(({ row }) => row));
  const cells = new Map(rows.map((row) => [row.id, tableCells(row, total)]));
  const totals = tableTotals(
    rows,
    rows.map((row) => cells.get(row.id)!),
  );
  const columns = [
    "price",
    "quantity",
    "equity",
    "average",
    "gain",
    "priceToBook",
    "upside",
    "dividendMonth",
    "cost",
    "ideal",
    "contribution",
    "share",
  ] as const;
  const dash = <span className="text-muted">—</span>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[70rem] border-collapse text-sm">
        <caption className="sr-only">{t("portfolio.table.caption")}</caption>
        <thead>
          <tr className="border-b border-line">
            <th
              scope="col"
              className="sticky left-0 z-10 bg-card px-2 pb-2 text-left text-xs font-medium uppercase tracking-wide text-muted"
            >
              {t("portfolio.table.asset")}
            </th>
            {columns.map((column) => (
              <th key={column} scope="col" className={HEAD}>
                {t(`portfolio.table.${column}`)}
              </th>
            ))}
            <th scope="col" className="px-2 pb-2">
              <span className="sr-only">{t("portfolio.columns.actions")}</span>
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.assetClass} className="divide-y divide-line border-b border-line">
            <tr className="bg-card-soft">
              <th
                scope="colgroup"
                colSpan={columns.length + 2}
                className="px-2 py-2 text-left text-sm font-semibold"
              >
                <span className="sticky left-2 inline-flex flex-wrap items-baseline gap-x-2">
                  <span>{t(`classes.${group.assetClass as AssetClass}`)}</span>
                  <span className="font-normal text-muted">
                    {t("portfolio.byType.count", { count: group.rows.length })} ·{" "}
                    {moneyText(group.value)} ·{" "}
                    {t("portfolio.byType.share", { percent: percentText(group.percent, locale) })} ·{" "}
                    {t("portfolio.byType.invested", { amount: moneyText(group.cost) })}
                  </span>
                </span>
              </th>
            </tr>
            {group.rows.map(({ row }) => {
              const cell = cells.get(row.id)!;
              const unit = isUnitPriced(row.assetClass);
              const hasQuote = row.quoteState === "automatico";
              const priceAge =
                row.valuedOn && !row.estimated && !hasQuote ? daysSince(row.valuedOn, today) : 0;
              const held = money(row.position.quantity).gt(0);
              const menu = [
                ...(writable
                  ? [
                      {
                        label: t("portfolio.actions.value"),
                        icon: <Tag className="size-4" aria-hidden="true" />,
                        onClick: () => onValue(row.id),
                      },
                    ]
                  : []),
                {
                  label: t("portfolio.actions.history"),
                  icon: <History className="size-4" aria-hidden="true" />,
                  href: `/app/investimentos/lancamentos?ativo=${row.id}`,
                },
                ...(writable
                  ? [
                      {
                        label: t("portfolio.actions.edit"),
                        icon: <Pencil className="size-4" aria-hidden="true" />,
                        onClick: () => onEdit(row.id),
                      },
                      {
                        label: t("portfolio.actions.delete"),
                        icon: <Trash2 className="size-4" aria-hidden="true" />,
                        onClick: () => onRemove(row),
                        tone: "danger" as const,
                      },
                    ]
                  : []),
              ];
              return (
                <tr key={row.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 min-w-48 bg-card px-2 py-3 text-left font-normal"
                  >
                    <p className="m-0 flex flex-wrap items-center gap-2 font-medium">
                      {row.ticker ?? row.name}
                      {row.ticker ? (
                        <Badge>{t(`classes.${row.assetClass as AssetClass}`)}</Badge>
                      ) : null}
                      {priceAge > stalePriceDays ? (
                        <Badge tone="warning">
                          {t("portfolio.staleBadge", { count: priceAge })}
                        </Badge>
                      ) : null}
                    </p>
                    {row.ticker ? <p className="m-0 text-xs text-muted">{row.name}</p> : null}
                    {row.events.map((event) => {
                      const kind = stockEventKind(event.note);
                      const code = EVENT_KINDS[kind];
                      return (
                        <p key={event.id} className="m-0 text-xs text-muted">
                          {t("portfolio.adjusted", {
                            kind: code ? t(`portfolio.eventKinds.${code}`) : kind,
                            date: formatDate(event.comDate, locale),
                          })}
                        </p>
                      );
                    })}
                    {row.position.oversold ? (
                      <p className="m-0 text-xs text-danger">{t("portfolio.oversold")}</p>
                    ) : null}
                    {row.estimated ? (
                      <p className="m-0 text-xs text-muted">{t("portfolio.estimated")}</p>
                    ) : null}
                    {hasQuote ? null : <QuoteNote row={row} today={today} />}
                  </th>
                  <td className={NUM}>
                    {unit && row.currentPrice ? (
                      <>
                        <span className="block">{moneyText(row.currentPrice)}</span>
                        {row.quoteDate || row.valuedOn ? (
                          <span className="block text-xs text-muted">
                            {formatDate(row.quoteDate ?? row.valuedOn!, locale)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      dash
                    )}
                  </td>
                  <td className={NUM}>
                    {unit && held ? quantityText(row.position.quantity, locale) : dash}
                  </td>
                  <td className={cx(NUM, "font-medium")}>{moneyText(row.value)}</td>
                  <td className={NUM}>
                    {unit && held ? moneyText(row.position.averagePrice) : dash}
                  </td>
                  <td className={NUM}>
                    <GainCell row={row} locale={locale} />
                  </td>
                  <td className={NUM}>
                    {cell.priceToBook === null ? dash : ratio.format(cell.priceToBook)}
                  </td>
                  <td className={NUM}>
                    <PercentCell value={cell.upside} locale={locale} />
                  </td>
                  <td className={NUM}>{moneyText(cell.dividendMonthly)}</td>
                  <td className={NUM}>{moneyText(row.position.cost)}</td>
                  <td className={NUM}>
                    {cell.idealPercent === null ? dash : percentText(cell.idealPercent, locale)}
                  </td>
                  <td className={NUM}>
                    {cell.contribution === null ? dash : moneyText(cell.contribution)}
                  </td>
                  <td className={cx(NUM, "font-medium text-brand-700")}>
                    {percentText(cell.sharePercent, locale)}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {writable ? (
                        <Button
                          variant="secondary"
                          small
                          aria-label={t("portfolio.actions.tradeLabel", { name: row.name })}
                          onClick={() => onOperation(row.id)}
                        >
                          {t("portfolio.actions.trade")}
                        </Button>
                      ) : null}
                      <ActionMenu
                        label={t("portfolio.actions.more", { name: row.name })}
                        items={menu}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
        <tfoot>
          <tr className="font-semibold">
            <th scope="row" className="sticky left-0 z-10 bg-card px-2 py-3 text-left">
              {t("portfolio.table.total")}
            </th>
            <td className={NUM} />
            <td className={NUM} />
            <td className={NUM}>{moneyText(totals.value)}</td>
            <td className={NUM} />
            <td className={NUM}>
              <span
                className={
                  money(totals.gain).gt(0)
                    ? "text-success"
                    : money(totals.gain).lt(0)
                      ? "text-danger"
                      : undefined
                }
              >
                {moneyText(totals.gain)}
              </span>
            </td>
            <td className={NUM} />
            <td className={NUM} />
            <td className={NUM}>{moneyText(totals.dividendMonthly)}</td>
            <td className={NUM}>{moneyText(totals.cost)}</td>
            <td className={NUM}>{percentText(totals.idealPercent, locale)}</td>
            <td className={NUM}>{moneyText(totals.contribution)}</td>
            <td className={cx(NUM, "text-brand-700")}>{percentText(100, locale)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function PortfolioBoard({
  data,
  suggestions,
  stalePriceDays,
  writable,
  insights,
}: {
  data: Data;
  suggestions: PendingItem[];
  /** A partir de quantos dias o valor informado conta como velho. */
  stalePriceDays: number;
  writable: boolean;
  insights: ReactNode;
}) {
  const brazil = useBrazilRules();
  const t = useTranslations("investimentos");
  const locale = useLocale();
  const moneyText = useMoney();
  const [sheet, setSheet] = useState<Sheet_ | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const close = () => setSheet(null);
  // Uma operação só: com `id` nulo a pessoa escolhe o investimento (ou cria um) dentro do painel.
  const openOperation = (id: string | null = null) =>
    setSheet((s) => ({ type: "operation", id, nonce: (s?.nonce ?? 0) + 1 }));
  const openRow = (type: "edit" | "value", id: string) =>
    setSheet((s) => ({ type, id, nonce: (s?.nonce ?? 0) + 1 }));
  const selected =
    sheet && sheet.id ? (data.rows.find((row) => row.id === sheet.id) ?? null) : null;
  const { summary } = data;
  const gain = money(summary.gain);
  // Vendido ou resgatado por inteiro sai da lista; um botão traz de volta para editar ou ver o histórico.
  const { visible, zeroed } = splitZeroed(data.rows);
  const [showZeroed, setShowZeroed] = useState(false);
  const listed = showZeroed ? data.rows : visible;
  const groups = groupByClass(listed);

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={moneyText(summary.total)}
        description={t("portfolio.description")}
        actions={
          <>
            <Link href="/app/investimentos/importar" className={buttonClass("secondary")}>
              <Upload className="size-4" aria-hidden="true" />
              {t("tabs.import")}
            </Link>
            {writable ? (
              <Button onClick={() => openOperation()}>
                <Plus className="size-4" aria-hidden="true" />
                {t("portfolio.newInvestment")}
              </Button>
            ) : null}
          </>
        }
      />
      {insights}

      <PortfolioSuggestions items={suggestions} writable={writable} />

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState
            title={t("portfolio.empty.title")}
            text={t(brazil ? "portfolio.empty.text" : "portfolio.empty.textAnywhere")}
            action={
              writable ? (
                <Button variant="secondary" small onClick={() => openOperation()}>
                  {t("portfolio.empty.action")}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatTile
              label={t("portfolio.stats.cost")}
              value={moneyText(summary.cost)}
              hint={t("portfolio.stats.costHint")}
            />
            <StatTile
              label={t("portfolio.stats.gain")}
              value={moneyText(summary.gain)}
              hint={
                summary.gainPercent === null
                  ? undefined
                  : t("portfolio.stats.gainHint", {
                      percent: `${gain.gt(0) ? "+" : ""}${percentText(summary.gainPercent, locale)}`,
                    })
              }
            />
            <StatTile
              label={t("portfolio.stats.realized")}
              value={moneyText(summary.realized)}
              hint={t("portfolio.stats.realizedHint")}
            />
            <StatTile
              label={t("portfolio.stats.dividends")}
              value={moneyText(data.dividends12)}
              hint={
                money(data.dividendsUpcomingNet).gt(0)
                  ? t("portfolio.stats.dividendsUpcoming", {
                      amount: moneyText(data.dividendsUpcomingNet),
                    })
                  : t("portfolio.stats.dividendsHint")
              }
            />
          </dl>

          <Card title={t("portfolio.byType.title")} description={t("portfolio.byType.hint")}>
            <ul
              aria-label={t("portfolio.byType.list")}
              className="m-0 grid list-none gap-x-8 gap-y-4 p-0 lg:grid-cols-2"
            >
              {groups.map((group) => (
                <li key={group.assetClass} className="text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 font-medium">
                      {t(`classes.${group.assetClass as AssetClass}`)}
                    </span>
                    <span className="whitespace-nowrap tabular-nums">
                      {moneyText(group.value)} · {percentText(group.percent, locale)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-brand-50" aria-hidden="true">
                    <div
                      className="h-2 rounded-full bg-brand-500"
                      style={{ width: `${Math.min(100, group.percent)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {t("portfolio.byType.invested", { amount: moneyText(group.cost) })}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title={t("portfolio.list")}
            description={t("portfolio.listHint", { count: listed.length })}
            actions={
              zeroed.length > 0 ? (
                <Button variant="ghost" small onClick={() => setShowZeroed((value) => !value)}>
                  {t(showZeroed ? "portfolio.zeroed.hide" : "portfolio.zeroed.show")} (
                  {zeroed.length})
                </Button>
              ) : null
            }
          >
            <HoldingsTable
              groups={groups}
              total={summary.total}
              today={data.today}
              stalePriceDays={stalePriceDays}
              writable={writable}
              onOperation={openOperation}
              onValue={(id) => openRow("value", id)}
              onEdit={(id) => openRow("edit", id)}
              onRemove={setRemoving}
            />
            <p className="mt-3 text-xs text-muted">{t("portfolio.table.footnote")}</p>
          </Card>
        </>
      )}

      <p className="text-xs text-muted">
        {brazil
          ? t.rich("portfolio.disclaimer", {
              link: (chunks) => (
                <Link href="/app/proventos" className="font-semibold text-brand-700 underline">
                  {chunks}
                </Link>
              ),
            })
          : t("portfolio.disclaimerAnywhere")}
      </p>

      <Sheet
        open={sheet !== null}
        onClose={close}
        title={sheet ? t(`portfolio.sheets.${sheet.type}`) : ""}
      >
        {sheet?.type === "operation" ? (
          <OperationForm key={sheet.nonce} data={data} assetId={sheet.id} onDone={close} />
        ) : null}
        {sheet?.type === "edit" && selected ? (
          <InvestmentForm key={sheet.nonce} row={selected} onDone={close} />
        ) : null}
        {sheet?.type === "value" && selected ? (
          <ValueForm key={sheet.nonce} row={selected} today={data.today} onDone={close} />
        ) : null}
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("portfolio.remove.title")}
        text={t("portfolio.remove.text", { name: removing?.name ?? "" })}
        confirmLabel={t("portfolio.remove.confirm")}
        action={deleteInvestment}
        hidden={{ id: removing?.id ?? "" }}
      />
    </>
  );
}
