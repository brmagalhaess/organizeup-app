"use client";
import { OwnerField, ownerOf, type OwnerChoices } from "@/components/owner-field";
import { PersonDot } from "@/components/person";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Lock,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import {
  addMonths,
  linesTotal,
  money,
  percentOf,
  statementClosingDate,
  statementDueDate,
  statementStatus,
  toDbAmount,
} from "@organizeup/domain";
import { useEntryDialog } from "@/components/shell/entry-context";
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
} from "@/components/ui";
import { formatDayMonth, formatMonthYear, toAmountInput } from "@/i18n/format";
import type { loadCards } from "@/lib/commitments";
import { systemTextOf } from "@/i18n/system-text";
import {
  deletePurchase,
  payStatement,
  saveCard,
  setCardArchived,
  type CardFormState,
} from "./actions";
import { useMoney } from "@/i18n/money";
import { CardUsageChart } from "./card-usage-chart";

type Data = Awaited<ReturnType<typeof loadCards>>;
type CardView = Data["cards"][number];
type Line = CardView["lines"][number];

const initial: CardFormState = { ok: false, message: null };

const STATUS = {
  aberta: { tone: "neutral", icon: Clock },
  fechada: { tone: "warning", icon: Lock },
  atrasada: { tone: "danger", icon: AlertCircle },
  paga: { tone: "success", icon: Check },
} as const;

function CardForm({
  card,
  accounts,
  owners,
  onDone,
}: {
  card: CardView | null;
  accounts: Data["accounts"];
  owners: OwnerChoices;
  onDone: () => void;
}) {
  const t = useTranslations("cartoes.form");
  const tCommon = useTranslations("common");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const [state, action, pending] = useActionState(saveCard, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={card?.id ?? ""} />
      <Field label={t("name")}>
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={t("nameExample")}
          defaultValue={card?.name}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("closingDay")} hint={t("closingDayHint")}>
          <Input
            name="closingDay"
            type="number"
            min={1}
            max={31}
            required
            defaultValue={card?.closingDay}
          />
        </Field>
        <Field label={t("dueDay")} hint={t("dueDayHint")}>
          <Input
            name="dueDay"
            type="number"
            min={1}
            max={31}
            required
            defaultValue={card?.dueDay}
          />
        </Field>
      </div>
      <Field label={t("limit")} hint={t("limitHint")}>
        <Input
          name="limit"
          inputMode="decimal"
          placeholder={toAmountInput("0.00", locale)}
          defaultValue={card?.limitAmount ? toAmountInput(card.limitAmount, locale) : undefined}
        />
      </Field>
      <Field label={t("payingAccount")}>
        <Select name="payingAccountId" required defaultValue={card?.payingAccountId}>
          {accounts
            .filter((a) => !a.archived || a.id === card?.payingAccountId)
            .map((account) => (
              <option key={account.id} value={account.id}>
                {system.name(account.name)}
              </option>
            ))}
        </Select>
      </Field>
      <OwnerField owners={owners} target="cards" id={card?.id} />
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("save")}
      </Button>
    </form>
  );
}

function CardTile({
  card,
  selected,
  owner,
}: {
  card: CardView;
  selected: boolean;
  owner: { name: string; slot: number } | undefined;
}) {
  const t = useTranslations("cartoes.tile");
  const moneyText = useMoney();
  return (
    <Link
      href={`/app/cartoes?c=${card.id}`}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "flex h-full flex-col gap-3 rounded-2xl border bg-card p-5 shadow-card transition hover:border-brand-500",
        selected ? "border-brand-500 ring-1 ring-brand-500" : "border-line",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <CreditCard className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{card.name}</p>
          <p className="text-xs text-muted">
            {t("days", { closing: card.closingDay, due: card.dueDay })}
          </p>
          {owner ? (
            <p className="mt-0.5 flex text-xs text-muted">
              <PersonDot name={owner.name} slot={owner.slot} />
            </p>
          ) : null}
        </div>
      </div>
      <div>
        <p className="text-xs text-muted">{t("current")}</p>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">
          {moneyText(card.openTotal)}
        </p>
      </div>
      {card.limitAmount && card.available ? (
        <div>
          <div aria-hidden="true" className="h-2 rounded-full bg-brand-50">
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${Math.min(100, percentOf(card.used, card.limitAmount))}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            {t("available", { value: moneyText(card.available) })}
          </p>
        </div>
      ) : null}
    </Link>
  );
}

/** Paga a fatura inteira ou em parte: o que faltar vai para a fatura seguinte. */
function PayStatement(props: { cardId: string; month: string; total: string; today: string }) {
  const t = useTranslations("cartoes.pay");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("open")}</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("title")}>
        <PayStatementForm {...props} onDone={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

function PayStatementForm({
  cardId,
  month,
  total,
  today,
  onDone,
}: {
  cardId: string;
  month: string;
  total: string;
  today: string;
  onDone: () => void;
}) {
  const t = useTranslations("cartoes.pay");
  const locale = useLocale();
  const moneyText = useMoney();
  const [state, action, pending] = useActionState(payStatement, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="cardId" value={cardId} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="total" value={total} />
      <p className="m-0 text-sm text-muted">{t("text", { total: moneyText(total) })}</p>
      <Field label={t("amountLabel")} hint={t("amountHint")}>
        <Input
          name="amount"
          inputMode="decimal"
          required
          defaultValue={toAmountInput(total, locale)}
        />
      </Field>
      <Field label={t("dateLabel")}>
        <Input name="paidOn" type="date" required defaultValue={today} />
      </Field>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("confirm")}
      </Button>
    </form>
  );
}

function Statement({
  card,
  month,
  today,
  accountName,
  writable,
  onEdit,
}: {
  card: CardView;
  month: string;
  today: string;
  accountName: string;
  writable: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations("cartoes");
  const tStatement = useTranslations("cartoes.statement");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const moneyText = useMoney();
  const { openNew } = useEntryDialog();
  const [removing, setRemoving] = useState<Line | null>(null);
  const lines = card.lines
    .filter((line) => line.statementMonth === month)
    .sort((a, b) => a.purchasedOn.localeCompare(b.purchasedOn));
  const total = linesTotal(lines);
  const paid = card.paidMonths.includes(month);
  const carried = paid ? card.carried[month] : undefined;
  const statusKey = statementStatus(month, card, today, paid);
  const status = STATUS[statusKey];
  const StatusIcon = status.icon;
  const monthLink = (target: string) => `/app/cartoes?c=${card.id}&m=${target}`;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold first-letter:uppercase">
              {formatMonthYear(month, locale)}
            </h2>
            <Badge tone={status.tone}>
              <StatusIcon className="size-3" aria-hidden="true" />
              {t(`status.${statusKey}`)}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted">{tStatement("of", { name: card.name })}</p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={monthLink(addMonths(month, -1))}
            aria-label={tStatement("previous")}
            className={buttonClass("secondary", true)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
          <Link
            href={monthLink(addMonths(month, 1))}
            aria-label={tStatement("next")}
            className={buttonClass("secondary", true)}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          {writable ? (
            <>
              <IconButton label={t("actions.edit", { name: card.name })} onClick={onEdit}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
              <form action={setCardArchived}>
                <input type="hidden" name="id" value={card.id} />
                <input type="hidden" name="archived" value="true" />
                <IconButton type="submit" label={t("actions.archive", { name: card.name })}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </form>
            </>
          ) : null}
        </div>
      </div>

      <dl className="m-0 mt-4 grid grid-cols-3 gap-3 rounded-xl bg-card-soft p-4 text-sm">
        <div>
          <dt className="text-xs text-muted">{tStatement("total")}</dt>
          <dd className="m-0 font-semibold tabular-nums">{moneyText(total)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{tStatement("closes")}</dt>
          <dd className="m-0 font-semibold tabular-nums">
            {formatDayMonth(statementClosingDate(month, card), locale)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{tStatement("due")}</dt>
          <dd className="m-0 font-semibold tabular-nums">
            {formatDayMonth(statementDueDate(month, card), locale)}
          </dd>
        </div>
      </dl>

      {carried ? (
        <p className="m-0 mt-3 text-sm text-muted">
          {tStatement("partial", {
            paid: moneyText(toDbAmount(money(total).minus(carried))),
            rest: moneyText(carried),
          })}
        </p>
      ) : null}

      {writable ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => openNew("despesa", card.id)}>
            <Plus className="size-4" aria-hidden="true" />
            {tStatement("newPurchase")}
          </Button>
          {!paid && lines.length > 0 ? (
            <PayStatement cardId={card.id} month={month} total={linesTotal(lines)} today={today} />
          ) : null}
          {!paid && lines.length > 0 ? (
            <span className="text-xs text-muted">
              {tStatement("paidFrom", { account: system.name(accountName) })}
            </span>
          ) : null}
        </div>
      ) : null}

      {lines.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={tStatement("emptyTitle")} text={tStatement("emptyText")} />
        </div>
      ) : (
        <div className="relative -mx-5 mt-4 sm:-mx-6">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{tStatement("caption")}</caption>
            <thead>
              <tr className="border-y border-line text-left text-xs text-muted">
                <th scope="col" className="py-2 pl-5 pr-3 font-medium sm:pl-6">
                  {tStatement("date")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {tStatement("description")}
                </th>
                <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                  {tStatement("category")}
                </th>
                <th scope="col" className="py-2 pl-3 pr-5 text-right font-medium sm:pr-3">
                  {tStatement("amount")}
                </th>
                {writable ? (
                  <th scope="col" className="hidden py-2 pr-6 sm:table-cell">
                    <span className="sr-only">{tStatement("actions")}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const remove =
                  writable && !line.locked ? (
                    <IconButton
                      label={t("actions.delete", { name: line.description })}
                      onClick={() => setRemoving(line)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </IconButton>
                  ) : null;
                return (
                  <tr key={line.purchaseId} className="border-b border-line last:border-0">
                    <td className="py-3 pl-5 pr-3 align-top tabular-nums text-muted sm:pl-6">
                      {formatDayMonth(line.purchasedOn, locale)}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <p className="font-medium">{line.description}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {line.installments > 1
                          ? tStatement("installment", {
                              number: line.installment,
                              total: line.installments,
                            })
                          : tStatement("singlePayment")}
                        <span className="md:hidden"> · {system.name(line.categoryName)}</span>
                      </p>
                      {remove ? <div className="mt-1 sm:hidden">{remove}</div> : null}
                    </td>
                    <td className="hidden px-3 py-3 align-top text-muted md:table-cell">
                      {system.name(line.categoryName)}
                    </td>
                    <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right align-top font-semibold tabular-nums sm:pr-3">
                      {moneyText(line.amount)}
                    </td>
                    {writable ? (
                      <td className="hidden py-2 pr-6 text-right align-top sm:table-cell">
                        {remove}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("remove.title")}
        text={t("remove.text", { name: removing?.description ?? "" })}
        confirmLabel={t("remove.confirm")}
        action={deletePurchase}
        hidden={{ id: removing?.purchaseId ?? "" }}
      />
    </Card>
  );
}

export function CardsBoard({
  data,
  selectedId,
  month,
  writable,
  owners,
}: {
  owners: OwnerChoices;
  data: Data;
  selectedId: string | null;
  month: string | null;
  writable: boolean;
}) {
  const t = useTranslations("cartoes");
  const [editing, setEditing] = useState<{ nonce: number; card: CardView | null } | null>(null);
  const active = data.cards.filter((card) => !card.archived);
  const archived = data.cards.filter((card) => card.archived);
  const selected = active.find((card) => card.id === selectedId) ?? active[0];
  const close = () => setEditing(null);
  const open = (card: CardView | null) => setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, card }));

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

      {active.length === 0 ? (
        <Card>
          <EmptyState
            title={t("empty.title")}
            text={t("empty.text")}
            action={
              writable ? <Button onClick={() => open(null)}>{t("empty.action")}</Button> : null
            }
          />
        </Card>
      ) : (
        <>
          <ul
            aria-label={t("listLabel")}
            className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          >
            {active.map((card) => (
              <li key={card.id}>
                <CardTile
                  card={card}
                  selected={card.id === selected?.id}
                  owner={ownerOf(owners, "cards", card.id)}
                />
              </li>
            ))}
          </ul>
          {selected ? (
            <Statement
              card={selected}
              month={month ?? selected.openMonth}
              today={data.today}
              accountName={
                data.accounts.find((a) => a.id === selected.payingAccountId)?.name ??
                t("statement.fallbackAccount")
              }
              writable={writable}
              onEdit={() => open(selected)}
            />
          ) : null}
          {selected ? (
            <CardUsageChart
              cards={active}
              selected={selected}
              viewing={month ?? selected.openMonth}
            />
          ) : null}
        </>
      )}

      {archived.length > 0 ? (
        <Card title={t("archived.title")} description={t("archived.text")}>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {archived.map((card) => (
              <li key={card.id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-sm">{card.name}</span>
                {writable ? (
                  <form action={setCardArchived}>
                    <input type="hidden" name="id" value={card.id} />
                    <input type="hidden" name="archived" value="false" />
                    <IconButton type="submit" label={t("actions.restore", { name: card.name })}>
                      <ArchiveRestore className="size-4" aria-hidden="true" />
                    </IconButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Sheet
        open={editing !== null}
        onClose={close}
        title={t(editing?.card ? "sheet.edit" : "sheet.new")}
      >
        <CardForm
          key={editing?.nonce}
          card={editing?.card ?? null}
          accounts={data.accounts}
          owners={owners}
          onDone={close}
        />
      </Sheet>
    </div>
  );
}
