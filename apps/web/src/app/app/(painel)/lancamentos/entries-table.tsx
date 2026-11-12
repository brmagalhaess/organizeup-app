"use client";
import { amountClass, confirmAction, cx, isGoalEntry } from "@/components/styles";
import {
  AlertCircle,
  ArrowRight,
  CalendarX2,
  Check,
  Clock,
  Pencil,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  addDays,
  linesTotal,
  type EntryFlow,
  type MonthEntry,
  type StatementLine,
} from "@organizeup/domain";
import { ConfirmEntryButton } from "@/components/confirm-entry-button";
import { useEntryDialog } from "@/components/shell/entry-context";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
} from "@/components/ui";
import { formatDayMonth } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { systemTextOf } from "@/i18n/system-text";
import { deleteEntry, stopPlan } from "./actions";
import { cardLinesInFilter } from "./card-filter";
import { listTotals, openSummary, orderEntries } from "./entry-order";
import { PlanLink } from "./plan-link";
import { useMoney } from "@/i18n/money";

interface Named {
  id: string;
  name: string;
}

/** Previsões que vêm de outra tela: lá é que se edita. */
const SCHEDULED_PAGES: Partial<Record<MonthEntry["source"], string>> = {
  parcela: "/app/dividas",
  fatura: "/app/cartoes",
  renda: "/app/renda",
  meta: "/app/metas",
};

function StatusBadge({ entry, today }: { entry: MonthEntry; today: string }) {
  const t = useTranslations("lancamentos.status");
  if (entry.status === "realizado")
    return (
      <Badge tone="success">
        <Check className="size-3" aria-hidden="true" />
        {t(
          `done.${confirmAction({
            kind: entry.kind,
            source: isGoalEntry(entry.description) ? "meta" : entry.source,
          })}`,
        )}
      </Badge>
    );
  if (entry.date < today)
    return (
      <Badge tone="danger">
        <AlertCircle className="size-3" aria-hidden="true" />
        {t("overdue")}
      </Badge>
    );
  return (
    <Badge>
      <Clock className="size-3" aria-hidden="true" />
      {t("planned")}
    </Badge>
  );
}

function RowActions({
  entry,
  shown,
  month,
  onEdit,
  onRemove,
  onStop,
}: {
  entry: MonthEntry;
  /** Descrição como a pessoa a vê. */
  shown: string;
  month: string;
  onEdit: (entry: MonthEntry) => void;
  onRemove: (entry: MonthEntry) => void;
  onStop: (entry: MonthEntry) => void;
}) {
  const t = useTranslations("lancamentos.row");
  const tConfirm = useTranslations("dashboard.confirm");
  const name = shown;
  return (
    <div className="flex items-center gap-1 sm:justify-end">
      {entry.status === "previsto" ? (
        <ConfirmEntryButton
          entryKey={entry.key}
          month={month}
          label={tConfirm(confirmAction(entry))}
        />
      ) : null}
      {entry.source === "meta" ? (
        <PlanLink description={entry.description} />
      ) : SCHEDULED_PAGES[entry.source] ? (
        <Link
          href={SCHEDULED_PAGES[entry.source]!}
          aria-label={t("open", { name })}
          title={t("openShort")}
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-brand-50 hover:text-ink"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      ) : (
        <IconButton label={t("edit", { name })} onClick={() => onEdit(entry)}>
          <Pencil className="size-4" aria-hidden="true" />
        </IconButton>
      )}
      {SCHEDULED_PAGES[entry.source] ? null : entry.source === "lancamento" ? (
        <IconButton label={t("delete", { name })} onClick={() => onRemove(entry)}>
          <Trash2 className="size-4" aria-hidden="true" />
        </IconButton>
      ) : (
        <IconButton label={t("stop", { name })} onClick={() => onStop(entry)}>
          <CalendarX2 className="size-4" aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}

/** Dia da semana curto, sem ponto: "qua". */
const weekday = (date: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(".", "");

export function EntriesTable({
  month,
  today,
  entries,
  flows,
  savingCategoryIds,
  categories,
  accounts,
  filters,
  cardLines,
}: {
  month: string;
  today: string;
  entries: MonthEntry[];
  /** Receita, despesa, aporte ou resgate, pela chave da entrada. */
  flows: Record<string, EntryFlow>;
  savingCategoryIds: string[];
  categories: Named[];
  accounts: Named[];
  /** Filtros que já vêm do endereço, como nos links do painel. */
  filters: { kind: string; category: string; account: string };
  /** Compras na fatura do mês: a lista mostra só a fatura, e a categoria delas fica aqui. */
  cardLines: Array<Pick<StatementLine, "categoryId" | "amount">>;
}) {
  const t = useTranslations("lancamentos");
  const locale = useLocale() as Locale;
  const moneyText = useMoney();
  const { openNew, openEdit, writable } = useEntryDialog();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState(filters.kind);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState(filters.category);
  const [account, setAccount] = useState(filters.account);
  const [removing, setRemoving] = useState<MonthEntry | null>(null);
  const [stopping, setStopping] = useState<MonthEntry | null>(null);

  const tSystem = useTranslations("sistema");
  const system = useMemo(() => systemTextOf(tSystem), [tSystem]);
  const savedCategory = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, system.name(c.name)])),
    [categories, system],
  );
  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id, system.name(a.name)])),
    [accounts, system],
  );
  const describe = (entry: MonthEntry) =>
    system.description(entry.description, {
      category: savedCategory.get(entry.categoryId),
      bill: entry.source === "fatura",
    });

  const flowOf = (entry: MonthEntry) => flows[entry.key] ?? entry.kind;
  const search = query.trim().toLocaleLowerCase(locale);
  const visible = entries.filter(
    (entry) =>
      (!kind || flowOf(entry) === kind) &&
      (!status || entry.status === status) &&
      (!category || entry.categoryId === category) &&
      (!account || entry.accountId === account) &&
      (!search || describe(entry).toLocaleLowerCase(locale).includes(search)),
  );
  const usedCategories = categories.filter(
    (c) =>
      entries.some((e) => e.categoryId === c.id) || cardLines.some((l) => l.categoryId === c.id),
  );
  const usedAccounts = accounts.filter((a) => entries.some((e) => e.accountId === a.id));
  const onCard = cardLinesInFilter(cardLines, { category, kind }, savingCategoryIds);
  // Hoje no topo: o que já aconteceu do mais recente para o mais antigo, e depois o que ainda vai vencer.
  const { recent, upcoming } = orderEntries(visible, today);
  const open = openSummary(entries, today);
  const totals = listTotals(visible);
  const filtering = Boolean(query.trim() || kind || status || category || account);
  const clearFilters = () => {
    setQuery("");
    setKind("");
    setStatus("");
    setCategory("");
    setAccount("");
  };
  const yesterday = addDays(today, -1);
  const dayTag = (date: string) =>
    date === today
      ? t("day.today")
      : date === yesterday
        ? t("day.yesterday")
        : weekday(date, locale);

  if (entries.length === 0 && cardLines.length === 0)
    return (
      <Card>
        <EmptyState
          title={t("empty.title")}
          text={t("empty.text")}
          action={writable ? <Button onClick={() => openNew()}>{t("empty.action")}</Button> : null}
        />
      </Card>
    );

  return (
    <Card>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-[minmax(0,1fr)_repeat(4,10rem)]">
        <div className="col-span-2 xl:col-span-1">
          <Field label={t("filters.search")}>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("filters.searchPlaceholder")}
            />
          </Field>
        </div>
        <Field label={t("filters.type")}>
          <Select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">{t("filters.allTypes")}</option>
            <option value="receita">{t("filters.income")}</option>
            <option value="despesa">{t("filters.expenses")}</option>
            <option value="aporte">{t("filters.contributions")}</option>
            <option value="resgate">{t("filters.redemptions")}</option>
          </Select>
        </Field>
        <Field label={t("filters.status")}>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t("filters.allStatuses")}</option>
            <option value="realizado">{t("filters.settled")}</option>
            <option value="previsto">{t("filters.open")}</option>
          </Select>
        </Field>
        <Field label={t("filters.category")}>
          <Select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">{t("filters.allCategories")}</option>
            {usedCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {system.name(c.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("filters.account")}>
          <Select value={account} onChange={(event) => setAccount(event.target.value)}>
            <option value="">{t("filters.allAccounts")}</option>
            {usedAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {system.name(a.name)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {open.count > 0 && status !== "previsto" ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-line bg-card-soft px-4 py-3 text-sm">
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5 font-semibold">
              <Clock className="size-4 text-muted" aria-hidden="true" />
              {t("open.summary", { count: open.count })}
            </span>
            {open.toPay !== "0.00" ? (
              <span className="text-muted">{t("open.pay", { amount: moneyText(open.toPay) })}</span>
            ) : null}
            {open.toReceive !== "0.00" ? (
              <span className="text-muted">
                {t("open.receive", { amount: moneyText(open.toReceive) })}
              </span>
            ) : null}
            {open.overdue > 0 ? (
              <Badge tone="danger">
                <AlertCircle className="size-3" aria-hidden="true" />
                {t("open.overdue", { count: open.overdue })}
              </Badge>
            ) : null}
          </p>
          <Button variant="secondary" small onClick={() => setStatus("previsto")}>
            {t("open.show")}
          </Button>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-muted">
        <p className="m-0" aria-live="polite">
          {t("results.count", { count: visible.length, total: entries.length })}
          {/* Com filtro, a soma do que ficou na lista; sem filtro, os números do mês já estão no topo. */}
          {filtering && visible.length > 0 ? (
            <>
              {" · "}
              {t("results.incoming", { amount: moneyText(totals.incoming) })}
              {" · "}
              {t("results.outgoing", { amount: moneyText(totals.outgoing) })}
            </>
          ) : null}
        </p>
        {filtering ? (
          <Button variant="ghost" small onClick={clearFilters}>
            <X className="size-4" aria-hidden="true" />
            {t("filters.clear")}
          </Button>
        ) : null}
      </div>

      {onCard.length > 0 ? (
        <p className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl bg-brand-50 px-4 py-3 text-sm">
          <span>
            {t("cardLines.total", {
              count: onCard.length,
              amount: moneyText(linesTotal(onCard)),
            })}
          </span>
          <Link href="/app/cartoes" className="font-medium underline underline-offset-2">
            {t("cardLines.open")}
          </Link>
        </p>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState title={t("empty.noResultsTitle")} text={t("empty.noResultsText")} />
      ) : (
        <div className="relative -mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("table.caption")}</caption>
            <thead>
              <tr className="border-y border-line text-left text-xs text-muted">
                <th scope="col" className="hidden py-2 pl-6 pr-3 font-medium sm:table-cell">
                  {t("table.date")}
                </th>
                <th scope="col" className="py-2 pl-5 pr-3 font-medium sm:px-3">
                  {t("table.description")}
                </th>
                <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                  {t("table.category")}
                </th>
                <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">
                  {t("table.account")}
                </th>
                <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                  {t("table.status")}
                </th>
                <th scope="col" className="py-2 pl-3 pr-5 text-right font-medium sm:pr-3">
                  {t("table.amount")}
                </th>
                {writable ? (
                  <th
                    scope="col"
                    className="hidden py-2 pl-3 pr-5 text-right font-medium sm:table-cell sm:pr-6"
                  >
                    <span className="sr-only">{t("table.actions")}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            {[
              { id: "recent", rows: recent },
              { id: "upcoming", rows: upcoming },
            ].map((part) =>
              part.rows.length === 0 ? null : (
                <tbody key={part.id}>
                  {/* Só separa quando há as duas partes: a lista continua sendo uma tabela só. */}
                  {part.id === "upcoming" && recent.length > 0 ? (
                    <tr className="border-t-2 border-line bg-card-soft">
                      <th
                        scope="colgroup"
                        colSpan={writable ? 7 : 6}
                        className="px-5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted sm:px-6"
                      >
                        {t("sections.upcoming")}
                      </th>
                    </tr>
                  ) : null}
                  {part.rows.map((entry, index) => {
                    const first = index === 0 || part.rows[index - 1]!.date !== entry.date;
                    return (
                      <tr
                        key={entry.key}
                        className={cx(
                          "border-line",
                          // Linha mais forte quando o dia muda: os lançamentos do mesmo dia ficam juntos.
                          first && index > 0
                            ? "border-t-2"
                            : index > 0
                              ? "border-t border-dashed"
                              : "",
                        )}
                      >
                        <td className="hidden py-3 pl-6 pr-3 align-top sm:table-cell">
                          {/* A data aparece na primeira linha de cada dia; nas outras fica só para leitor de tela. */}
                          <span
                            className={cx("block tabular-nums", first ? "font-medium" : "sr-only")}
                          >
                            {formatDayMonth(entry.date, locale)}
                          </span>
                          {first ? (
                            <span
                              className={cx(
                                "block text-xs",
                                entry.date === today
                                  ? "font-semibold text-brand-700"
                                  : "text-muted",
                              )}
                            >
                              {dayTag(entry.date)}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3 pl-5 pr-3 align-top sm:min-w-40 sm:px-3">
                          {/* No celular não há coluna de data: o dia vem em cima da primeira linha dele. */}
                          <p
                            className={cx(
                              "mb-1 text-xs tabular-nums sm:hidden",
                              !first && "sr-only",
                              entry.date === today ? "font-semibold text-brand-700" : "text-muted",
                            )}
                          >
                            {formatDayMonth(entry.date, locale)} · {dayTag(entry.date)}
                          </p>
                          <p className="flex items-center gap-1.5 font-medium">
                            {describe(entry)}
                            {entry.recurring ? (
                              <Repeat
                                className="size-3.5 shrink-0 text-muted"
                                role="img"
                                aria-label={t("row.repeats")}
                              />
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-muted md:hidden">
                            {categoryName.get(entry.categoryId)}
                          </p>
                          {flowOf(entry) === "aporte" || flowOf(entry) === "resgate" ? (
                            <div className="mt-1">
                              <Badge>{t(`flow.${flowOf(entry) as "aporte" | "resgate"}`)}</Badge>
                            </div>
                          ) : null}
                          {/* No celular, a situação e as ações dividem uma linha só. */}
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                            <StatusBadge entry={entry} today={today} />
                            {writable ? (
                              <RowActions
                                shown={describe(entry)}
                                entry={entry}
                                month={month}
                                onEdit={openEdit}
                                onRemove={setRemoving}
                                onStop={setStopping}
                              />
                            ) : null}
                          </div>
                        </td>
                        <td className="hidden px-3 py-3 align-top text-muted md:table-cell">
                          {categoryName.get(entry.categoryId)}
                        </td>
                        <td className="hidden px-3 py-3 align-top text-muted lg:table-cell">
                          {accountName.get(entry.accountId)}
                        </td>
                        <td className="hidden px-3 py-3 align-top sm:table-cell">
                          <StatusBadge entry={entry} today={today} />
                        </td>
                        <td
                          className={cx(
                            "whitespace-nowrap py-3 pl-3 pr-5 text-right align-top font-semibold tabular-nums sm:pr-3",
                            flowOf(entry) === entry.kind ? amountClass(entry.kind) : "text-ink",
                          )}
                        >
                          {entry.kind === "receita" ? "+ " : "− "}
                          {entry.originalAmount && entry.originalCurrency ? (
                            <>
                              {moneyText(entry.originalAmount, "full", entry.originalCurrency)}
                              <span className="block text-xs font-normal text-muted">
                                ≈ {moneyText(entry.amount)}
                              </span>
                            </>
                          ) : (
                            moneyText(entry.amount)
                          )}
                        </td>
                        {writable ? (
                          <td className="hidden py-2 pl-3 pr-5 align-top sm:table-cell sm:pr-6">
                            <RowActions
                              shown={describe(entry)}
                              entry={entry}
                              month={month}
                              onEdit={openEdit}
                              onRemove={setRemoving}
                              onStop={setStopping}
                            />
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              ),
            )}
          </table>
        </div>
      )}

      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("remove.title")}
        text={t("remove.text", { name: removing ? describe(removing) : "" })}
        confirmLabel={t("remove.confirm")}
        action={deleteEntry}
        hidden={{ id: removing?.id ?? "" }}
      />
      <ConfirmSheet
        open={stopping !== null}
        onClose={() => setStopping(null)}
        title={t("stop.title")}
        text={t("stop.text", { name: stopping ? describe(stopping) : "" })}
        confirmLabel={t("stop.confirm")}
        action={stopPlan}
        hidden={{ id: stopping?.id ?? "", month }}
      />
    </Card>
  );
}
