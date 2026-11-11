"use client";
import { History, Pencil, Plus, Tag, Trash2, TrendingUp, Upload } from "lucide-react";
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
import { groupByClass } from "@/lib/portfolio-groups";
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

const ROW_GRID =
  "xl:grid xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] xl:items-center xl:gap-4";

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

  /** Uma linha de ativo: no computador vira colunas; no celular, blocos empilhados. */
  const renderRow = (row: Row, share: { percent: number; inClass: number }) => {
    const unit = isUnitPriced(row.assetClass);
    // Com cotação automática, o aviso de preço velho não vale.
    const hasQuote = row.quoteState === "automatico";
    const priceAge =
      row.valuedOn && !row.estimated && !hasQuote ? daysSince(row.valuedOn, data.today) : 0;
    const menu = [
      ...(writable
        ? [
            {
              label: t("portfolio.actions.value"),
              icon: <Tag className="size-4" aria-hidden="true" />,
              onClick: () => openRow("value", row.id),
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
              onClick: () => openRow("edit", row.id),
            },
            {
              label: t("portfolio.actions.delete"),
              icon: <Trash2 className="size-4" aria-hidden="true" />,
              onClick: () => setRemoving(row),
              tone: "danger" as const,
            },
          ]
        : []),
    ];
    return (
      <li key={row.id} className={cx("py-3 text-sm", ROW_GRID)}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <TrendingUp className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {row.name}
              {row.ticker ? <Badge>{row.ticker}</Badge> : null}
              {priceAge > stalePriceDays ? (
                <Badge tone="warning">{t("portfolio.staleBadge", { count: priceAge })}</Badge>
              ) : null}
            </p>
            {row.events.map((event) => {
              const kind = stockEventKind(event.note);
              const code = EVENT_KINDS[kind];
              return (
                <p key={event.id} className="text-xs text-muted">
                  {t("portfolio.adjusted", {
                    kind: code ? t(`portfolio.eventKinds.${code}`) : kind,
                    date: formatDate(event.comDate, locale),
                  })}
                </p>
              );
            })}
            {row.position.oversold ? (
              <p className="text-xs text-danger">{t("portfolio.oversold")}</p>
            ) : null}
            {row.estimated ? (
              <p className="text-xs text-muted">{t("portfolio.estimated")}</p>
            ) : row.valuedOn && !hasQuote ? (
              <p className="text-xs text-muted">
                {t("portfolio.valuedOn", { date: formatDate(row.valuedOn, locale) })}
              </p>
            ) : null}
            <QuoteNote row={row} today={data.today} />
          </div>
        </div>
        <div className="mt-2 pl-12 xl:mt-0 xl:pl-0">
          <span className="text-xs text-muted xl:hidden">{t("portfolio.columns.position")}: </span>
          {unit && money(row.position.quantity).gt(0) ? (
            <span className="tabular-nums">
              {t("portfolio.positionShort", {
                quantity: quantityText(row.position.quantity, locale),
                price: moneyText(row.position.averagePrice),
              })}
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
          <span className="block text-xs text-muted">
            {t("portfolio.invested", { amount: moneyText(row.position.cost) })}
          </span>
        </div>
        <div className="mt-2 pl-12 xl:mt-0 xl:pl-0">
          <span className="block font-medium tabular-nums">{moneyText(row.value)}</span>
          <span className="block text-xs tabular-nums text-brand-700">
            {t("portfolio.byType.share", { percent: percentText(share.percent, locale) })}
          </span>
          <div
            className="mt-1 h-1 max-w-40 rounded-full bg-brand-50"
            role="img"
            aria-label={t("portfolio.byType.shareOf", {
              percent: percentText(share.inClass, locale),
              type: t(`classes.${row.assetClass as AssetClass}`),
            })}
          >
            <div
              className="h-1 rounded-full bg-brand-500"
              style={{ width: `${Math.min(100, share.inClass)}%` }}
            />
          </div>
        </div>
        <div className="mt-2 pl-12 xl:mt-0 xl:pl-0">
          <span className="text-xs text-muted xl:hidden">{t("portfolio.columns.result")}: </span>
          <GainCell row={row} locale={locale} />
        </div>
        <div className="mt-2 flex items-center gap-1 pl-12 xl:mt-0 xl:justify-end xl:pl-0">
          {writable ? (
            <Button
              variant="secondary"
              small
              aria-label={t("portfolio.actions.tradeLabel", { name: row.name })}
              onClick={() => openOperation(row.id)}
            >
              {t("portfolio.actions.trade")}
            </Button>
          ) : null}
          <ActionMenu label={t("portfolio.actions.more", { name: row.name })} items={menu} />
        </div>
      </li>
    );
  };

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
            <div
              aria-hidden="true"
              className={cx(
                "hidden border-b border-line pb-2 text-xs font-medium uppercase tracking-wide text-muted",
                ROW_GRID,
              )}
            >
              <span>{t("portfolio.columns.asset")}</span>
              <span>{t("portfolio.columns.position")}</span>
              <span>{t("portfolio.columns.value")}</span>
              <span>{t("portfolio.columns.result")}</span>
              <span className="sr-only">{t("portfolio.columns.actions")}</span>
            </div>
            {groups.map((group) => (
              <section
                key={group.assetClass}
                aria-label={t(`classes.${group.assetClass as AssetClass}`)}
              >
                <header className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg bg-card-soft px-3 py-2 text-sm">
                  <h3 className="m-0 font-semibold">
                    {t(`classes.${group.assetClass as AssetClass}`)}
                    <span className="ml-2 font-normal text-muted">
                      {t("portfolio.byType.count", { count: group.rows.length })}
                    </span>
                  </h3>
                  <p className="m-0 flex flex-wrap gap-x-2 tabular-nums text-muted">
                    <span className="font-medium text-ink">{moneyText(group.value)}</span>
                    <span>
                      {t("portfolio.byType.share", {
                        percent: percentText(group.percent, locale),
                      })}
                    </span>
                    <span>{t("portfolio.byType.invested", { amount: moneyText(group.cost) })}</span>
                  </p>
                </header>
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {group.rows.map(({ row, ...share }) => renderRow(row, share))}
                </ul>
              </section>
            ))}
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
