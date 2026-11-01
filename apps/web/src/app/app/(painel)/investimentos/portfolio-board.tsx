"use client";
import { History, Pencil, Plus, Tag, Trash2, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { isUnitPriced, money, stockEventKind } from "@organizeup/domain";
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
import { formatAmount, formatDate } from "@/i18n/format";
import type { PendingItem } from "@/lib/suggestions";
import {
  DecisionButtons,
  SuggestionFeedback,
  useSuggestionActions,
} from "../sugestoes/suggestion-controls";
import { AddAssetForm } from "./add-asset-form";
import { deleteInvestment, saveInvestment, updateValue } from "./actions";
import {
  ASSET_CLASSES,
  initial,
  percentText,
  quantityText,
  toInput,
  useCloseOnSuccess,
  type Data,
  type Row,
} from "./shared";
import { TradeForm } from "./trade-form";

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
  useCloseOnSuccess(state, onDone);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={row?.id ?? ""} />
      <Field label={t("form.name")}>
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={t("portfolio.investmentForm.namePlaceholder")}
          defaultValue={row?.name}
        />
      </Field>
      <Field label={t("portfolio.investmentForm.class")}>
        <Select name="assetClass" defaultValue={row?.assetClass ?? "acao"}>
          {ASSET_CLASSES.map((value) => (
            <option key={value} value={value}>
              {t(`classes.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("form.code")} hint={t("portfolio.investmentForm.codeHint")}>
        <Input name="ticker" maxLength={12} defaultValue={row?.ticker ?? ""} />
      </Field>
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
  { type: "new"; nonce: number } | { type: "edit" | "trade" | "value"; nonce: number; id: string };

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
  const t = useTranslations("investimentos");
  const locale = useLocale();
  const [sheet, setSheet] = useState<Sheet_ | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const close = () => setSheet(null);
  const open = (type: "new") => setSheet((s) => ({ type, nonce: (s?.nonce ?? 0) + 1 }));
  const openRow = (type: "edit" | "trade" | "value", id: string) =>
    setSheet((s) => ({ type, id, nonce: (s?.nonce ?? 0) + 1 }));
  const selected =
    sheet && "id" in sheet ? (data.rows.find((row) => row.id === sheet.id) ?? null) : null;
  const { summary } = data;
  const gain = money(summary.gain);

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={formatAmount(summary.total, locale)}
        description={t("portfolio.description")}
        actions={
          writable ? (
            <Button variant="secondary" onClick={() => open("new")}>
              <Plus className="size-4" aria-hidden="true" />
              {t("portfolio.newInvestment")}
            </Button>
          ) : null
        }
      />
      {insights}

      <PortfolioSuggestions items={suggestions} writable={writable} />

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState
            title={t("portfolio.empty.title")}
            text={t("portfolio.empty.text")}
            action={
              writable ? (
                <Button variant="secondary" small onClick={() => open("new")}>
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
              value={formatAmount(summary.cost, locale)}
              hint={t("portfolio.stats.costHint")}
            />
            <StatTile
              label={t("portfolio.stats.gain")}
              value={formatAmount(summary.gain, locale)}
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
              value={formatAmount(summary.realized, locale)}
              hint={t("portfolio.stats.realizedHint")}
            />
            <StatTile
              label={t("portfolio.stats.dividends")}
              value={formatAmount(data.dividends12, locale)}
              hint={t("portfolio.stats.dividendsHint")}
            />
          </dl>

          <div>
            <Card title={t("portfolio.list")}>
              <ul
                aria-label={t("portfolio.list")}
                className="m-0 list-none divide-y divide-line p-0"
              >
                {data.rows.map((row) => {
                  const unit = isUnitPriced(row.assetClass);
                  const rowGain = money(row.gain);
                  // Com cotação automática, o aviso de preço velho não vale.
                  const hasQuote = row.quoteState === "automatico";
                  const priceAge =
                    row.valuedOn && !row.estimated && !hasQuote
                      ? daysSince(row.valuedOn, data.today)
                      : 0;
                  return (
                    <li key={row.id} className="py-3 first:pt-0">
                      <div className="flex items-start gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                          <TrendingUp className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="flex flex-wrap items-center gap-2 font-medium">
                            {row.name}
                            {row.ticker ? <Badge>{row.ticker}</Badge> : null}
                            {priceAge > stalePriceDays ? (
                              <Badge tone="warning">
                                {t("portfolio.staleBadge", { count: priceAge })}
                              </Badge>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted">
                            {t(`classes.${row.assetClass}`)}
                            {unit && money(row.position.quantity).gt(0)
                              ? ` · ${t("portfolio.position", {
                                  quantity: quantityText(row.position.quantity, locale),
                                  price: formatAmount(row.position.averagePrice, locale),
                                })}`
                              : ""}
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
                        <div className="text-right text-sm">
                          <p className="whitespace-nowrap font-medium tabular-nums">
                            {formatAmount(row.value, locale)}
                          </p>
                          {!row.estimated && row.gainPercent !== null ? (
                            <p className="whitespace-nowrap text-xs tabular-nums text-muted">
                              {rowGain.gt(0) ? "+" : ""}
                              {percentText(row.gainPercent, locale)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1 pl-12">
                        {writable ? (
                          <>
                            <Button
                              variant="secondary"
                              small
                              aria-label={t("portfolio.actions.tradeLabel", { name: row.name })}
                              onClick={() => openRow("trade", row.id)}
                            >
                              {t("portfolio.actions.trade")}
                            </Button>
                            <Button
                              variant="secondary"
                              small
                              aria-label={t("portfolio.actions.valueLabel", { name: row.name })}
                              onClick={() => openRow("value", row.id)}
                            >
                              <Tag className="size-4" aria-hidden="true" />
                              {t("portfolio.actions.value")}
                            </Button>
                          </>
                        ) : null}
                        <Link
                          href={`/app/investimentos/lancamentos?ativo=${row.id}`}
                          aria-label={t("portfolio.actions.historyLabel", { name: row.name })}
                          className={buttonClass("ghost", true)}
                        >
                          <History className="size-4" aria-hidden="true" />
                        </Link>
                        {writable ? (
                          <>
                            <IconButton
                              label={t("portfolio.actions.editLabel", { name: row.name })}
                              onClick={() => openRow("edit", row.id)}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </IconButton>
                            <IconButton
                              label={t("portfolio.actions.deleteLabel", { name: row.name })}
                              onClick={() => setRemoving(row)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </IconButton>
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </>
      )}

      <p className="text-xs text-muted">
        {t.rich("portfolio.disclaimer", {
          link: (chunks) => (
            <Link href="/app/proventos" className="font-semibold text-brand-700 underline">
              {chunks}
            </Link>
          ),
        })}
      </p>

      <Sheet
        open={sheet !== null}
        onClose={close}
        title={sheet ? t(`portfolio.sheets.${sheet.type}`) : ""}
      >
        {sheet?.type === "new" ? (
          <AddAssetForm
            key={sheet.nonce}
            today={data.today}
            accounts={data.accounts}
            onDone={close}
          />
        ) : null}
        {sheet?.type === "edit" && selected ? (
          <InvestmentForm key={sheet.nonce} row={selected} onDone={close} />
        ) : null}
        {sheet?.type === "trade" && selected ? (
          <TradeForm
            key={sheet.nonce}
            row={selected}
            accounts={data.accounts}
            today={data.today}
            onDone={close}
          />
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
