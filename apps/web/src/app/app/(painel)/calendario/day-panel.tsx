"use client";
import { AlertCircle, CalendarPlus, Check, Clock, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { CONTRIBUTION_CATEGORY, money, yearMonthOf, type CalendarItem } from "@organizeup/domain";
import { ConfirmEntryButton } from "@/components/confirm-entry-button";
import { useEntryDialog } from "@/components/shell/entry-context";
import { amountClass, buttonClass, confirmAction, cx, isGoalEntry } from "@/components/styles";
import {
  Badge,
  Button,
  Field,
  FormMessage,
  IconButton,
  Input,
  Sheet,
  submitKeeping,
} from "@/components/ui";
import { formatAmount, formatWeekdayName } from "@/i18n/format";
import type { loadCalendar } from "@/lib/calendar-data";
import { systemTextOf } from "@/i18n/system-text";
import { PlanLink } from "../lancamentos/plan-link";
import { deleteEvent, saveEvent, type EventFormState } from "./actions";
import { isOverdue, itemHref, typeOf, type CalendarFilter } from "./calendar-model";
import { TYPE_ICON, TYPE_TEXT } from "./item-types";

type Data = Awaited<ReturnType<typeof loadCalendar>>;

const initial: EventFormState = { ok: false, message: null };

function ItemStatus({ item, today }: { item: CalendarItem; today: string }) {
  const t = useTranslations("calendario.day");
  const tStatus = useTranslations("lancamentos.status");
  if (item.type === "compromisso") return item.yearly ? <Badge>{t("yearly")}</Badge> : null;
  if (item.type === "fechamento") return <Badge>{t("closingBadge")}</Badge>;
  if (item.status === "realizado")
    return (
      <Badge tone="success">
        <Check className="size-3" aria-hidden="true" />
        {tStatus(
          `done.${confirmAction({
            kind: item.kind,
            source: isGoalEntry(item.title) ? "meta" : item.source,
          })}`,
        )}
      </Badge>
    );
  if (isOverdue(item, today))
    return (
      <Badge tone="danger">
        <AlertCircle className="size-3" aria-hidden="true" />
        {tStatus("overdue")}
      </Badge>
    );
  return (
    <Badge>
      <Clock className="size-3" aria-hidden="true" />
      {tStatus("planned")}
    </Badge>
  );
}

function DayItem({ item, data, writable }: { item: CalendarItem; data: Data; writable: boolean }) {
  const t = useTranslations("calendario");
  const tConfirm = useTranslations("dashboard.confirm");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const type = typeOf(item, data.types);
  // O fechamento do cartão chega pronto do agente, como "Fecha <nome>".
  const title =
    item.type === "fechamento"
      ? t("day.closes", { name: item.title.replace(/^Fecha /, "") })
      : system.description(item.title, {
          bill: type === "cartao",
          trip: type === "viagem",
          category: data.contributions.includes(item.key) ? CONTRIBUTION_CATEGORY : null,
        });
  const Icon = TYPE_ICON[type];
  const href = itemHref(item, type);
  const open = item.type === "lancamento" && item.status === "previsto";
  const removable = item.type === "compromisso";
  return (
    <li className="flex gap-3 py-3">
      <span
        aria-hidden="true"
        className={cx(
          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50",
          TYPE_TEXT[type],
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="break-words text-sm font-medium">{title}</p>
        {item.type === "lancamento" ? (
          <p className={cx("text-sm font-semibold tabular-nums", amountClass(item.kind))}>
            {item.kind === "receita" ? "+ " : "− "}
            {formatAmount(item.amount, locale)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{t(`types.${type}`)}</Badge>
          <ItemStatus item={item} today={data.today} />
          {item.type === "lancamento" && item.source === "meta" ? (
            <PlanLink description={item.title} />
          ) : null}
        </div>
        {(writable && (open || removable)) || href ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {writable && open ? (
              <ConfirmEntryButton
                entryKey={item.key}
                month={yearMonthOf(item.date)}
                label={tConfirm(confirmAction(item))}
                variant="primary"
              />
            ) : null}
            {href ? (
              <Link
                href={href}
                aria-label={t("day.openItem", { name: title })}
                className={buttonClass("secondary", true)}
              >
                {t("day.open")}
              </Link>
            ) : null}
            {writable && item.type === "compromisso" ? (
              <form action={deleteEvent}>
                <input type="hidden" name="id" value={item.id} />
                <IconButton type="submit" label={t("day.deleteItem", { name: title })}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function EventForm({ date, onDone }: { date: string; onDone: () => void }) {
  const t = useTranslations("calendario.event");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(saveEvent, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <input type="hidden" name="date" value={date} />
      <Field label={t("name")}>
        <Input name="title" required maxLength={120} placeholder={t("nameExample")} />
      </Field>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" name="yearly" className="size-5 accent-brand-500" />
        {t("yearly")}
      </label>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("save")}
      </Button>
    </form>
  );
}

export function DayPanel({
  date,
  items,
  hidden,
  filter,
  data,
  writable,
}: {
  date: string;
  /** Itens do dia que passam pelo filtro. */
  items: CalendarItem[];
  /** Quantos itens do dia o filtro escondeu. */
  hidden: number;
  filter: CalendarFilter;
  data: Data;
  writable: boolean;
}) {
  const t = useTranslations("calendario");
  const locale = useLocale();
  const { openNew } = useEntryDialog();
  const [creating, setCreating] = useState<number | null>(null);
  const close = () => setCreating(null);
  const balance = data.balances[date];
  const negative = balance !== undefined && money(balance).lt(0);
  const label = formatWeekdayName(date, locale);
  const monthEmpty = Object.keys(data.items).length === 0;

  return (
    <section
      aria-label={t("day.label")}
      className="min-w-0 rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6 xl:sticky xl:top-6"
    >
      <div aria-live="polite">
        <h2 className="font-display text-xl font-medium first-letter:uppercase">{label}</h2>
        {date === data.today ? <p className="text-sm text-muted">{t("today")}</p> : null}
      </div>
      {balance ? (
        <p className="mt-3 rounded-xl bg-card-soft p-3 text-sm">
          <span className="text-muted">{t("day.balance")} </span>
          <span className={cx("font-semibold tabular-nums", negative && "text-danger")}>
            {formatAmount(balance, locale)}
          </span>
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {hidden > 0
            ? t("day.hidden", { count: hidden })
            : t(monthEmpty ? "day.monthEmpty" : "day.empty")}
        </p>
      ) : (
        <>
          <ul aria-label={t("day.items")} className="m-0 mt-2 list-none divide-y divide-line p-0">
            {items.map((item) => (
              <DayItem key={item.key} item={item} data={data} writable={writable} />
            ))}
          </ul>
          {hidden > 0 && filter !== "todos" ? (
            <p className="mt-1 text-xs text-muted">{t("day.more", { count: hidden })}</p>
          ) : null}
        </>
      )}

      {writable ? (
        <div className="mt-4 grid grid-cols-1 gap-2 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-1">
          <Button variant="secondary" onClick={() => openNew("despesa", undefined, date)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("day.addEntry")}
          </Button>
          <Button variant="secondary" onClick={() => setCreating((nonce) => (nonce ?? 0) + 1)}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            {t("day.addEvent")}
          </Button>
        </div>
      ) : null}

      <Sheet open={creating !== null} onClose={close} title={t("event.new")}>
        <p className="mb-4 text-sm text-muted first-letter:uppercase">{label}</p>
        <EventForm key={creating} date={date} onDone={close} />
      </Sheet>
    </section>
  );
}
