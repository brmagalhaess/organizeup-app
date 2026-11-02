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
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
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
import { systemTextOf } from "@/i18n/system-text";
import { deleteEntry, stopPlan } from "./actions";
import { cardLinesInFilter } from "./card-filter";
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
  const locale = useLocale();
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
                <th scope="col" className="py-2 pl-5 pr-3 font-medium sm:pl-6">
                  {t("table.date")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
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
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.key} className="border-b border-line last:border-0">
                  <td className="py-3 pl-5 pr-3 align-top tabular-nums text-muted sm:pl-6">
                    {formatDayMonth(entry.date, locale)}
                  </td>
                  <td className="min-w-40 px-3 py-3 align-top">
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
                    <div className="mt-1 sm:hidden">
                      <StatusBadge entry={entry} today={today} />
                    </div>
                    {writable ? (
                      <div className="mt-2 sm:hidden">
                        <RowActions
                          shown={describe(entry)}
                          entry={entry}
                          month={month}
                          onEdit={openEdit}
                          onRemove={setRemoving}
                          onStop={setStopping}
                        />
                      </div>
                    ) : null}
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
              ))}
            </tbody>
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
