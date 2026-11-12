"use client";
import type { ApplyResult } from "@organizeup/agents";
import type { ReminderSettings } from "@organizeup/domain";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition } from "react";
import { cx } from "@/components/styles";
import { Button, Card, EmptyState, FormMessage, PageHeader } from "@/components/ui";
import { formatInstant } from "@/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import type { NotificationFilter, NotificationItem } from "@/lib/notifications";
import { markAllRead, undoNotification } from "./actions";
import { ReminderSettingsCard, type ReminderEmailInfo } from "./reminder-settings";

const FILTERS: Array<{ value: NotificationFilter; label: "all" | "unread" | "read" }> = [
  { value: "todas", label: "all" },
  { value: "nao-lidas", label: "unread" },
  { value: "lidas", label: "read" },
];

const hrefOf = (filter: NotificationFilter) =>
  filter === "todas" ? "/app/notificacoes" : `/app/notificacoes?filtro=${filter}`;

function NotificationRow({
  item,
  writable,
  busy,
  onUndo,
}: {
  item: NotificationItem;
  writable: boolean;
  busy: boolean;
  onUndo: (id: string) => void;
}) {
  const t = useTranslations("notificacoes");
  const locale = useLocale() as Locale;
  const { title } = item;
  const lang = item.translated ? undefined : DEFAULT_LOCALE;
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        {item.read ? null : (
          <span className="rounded-full bg-peach px-2 py-0.5 text-xs font-semibold text-night">
            {t("unreadTag")}
          </span>
        )}
        <p lang={lang} className="min-w-0 break-words text-sm font-medium">
          {title}
        </p>
        {item.isNew ? (
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-ink">
            {t("newCategory")}
          </span>
        ) : null}
      </div>
      <p lang={lang} className="mt-1 break-words text-sm text-muted first-letter:uppercase">
        {item.body}
      </p>
      <p className="mt-1 text-xs text-muted">{formatInstant(item.createdAt, locale)}</p>
      {item.undo === "desfeita" ? <p className="mt-2 text-sm font-medium">{t("undone")}</p> : null}
      {item.undo === "aplicada" && writable ? (
        <Button
          variant="secondary"
          small
          className="mt-3"
          disabled={busy}
          aria-label={t("undoLabel", { title })}
          onClick={() => onUndo(item.id)}
        >
          {t("undo")}
        </Button>
      ) : null}
      {item.href ? (
        <Link
          href={item.href}
          className="mt-2 inline-block text-sm font-medium underline underline-offset-2"
        >
          {t("open")}
        </Link>
      ) : null}
    </li>
  );
}

export function NotificationsBoard({
  items,
  filter,
  unread,
  writable,
  reminders,
  email,
}: {
  items: NotificationItem[] | null;
  filter: NotificationFilter;
  unread: number;
  writable: boolean;
  /** Null enquanto os lembretes não estão liberados para este login. */
  reminders: ReminderSettings | null;
  email: ReminderEmailInfo;
}) {
  const t = useTranslations("notificacoes");
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, startTransition] = useTransition();

  function run(action: () => Promise<ApplyResult>) {
    startTransition(async () => {
      try {
        setResult(await action());
      } catch {
        setResult({ ok: false, message: t("failed") });
      }
    });
  }

  function undo(id: string) {
    const form = new FormData();
    form.set("id", id);
    run(() => undoNotification(form));
  }

  const empty = filter === "todas" ? "all" : filter === "lidas" ? "read" : "unread";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          writable && unread > 0 ? (
            <Button variant="secondary" disabled={busy} onClick={() => run(markAllRead)}>
              {t("markAll")}
            </Button>
          ) : undefined
        }
      />
      <FormMessage message={result?.message} tone={result?.ok ? "ok" : "error"} />

      {reminders ? <ReminderSettingsCard settings={reminders} email={email} /> : null}

      <nav aria-label={t("filterLabel")} className="flex flex-wrap gap-2">
        {FILTERS.map(({ value, label }) => (
          <Link
            key={value}
            href={hrefOf(value)}
            aria-current={filter === value ? "page" : undefined}
            className={cx(
              "inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium",
              filter === value ? "bg-pine text-white" : "bg-card text-ink hover:bg-brand-50",
            )}
          >
            {t(`filters.${label}`)}
          </Link>
        ))}
      </nav>

      <Card>
        {items === null ? (
          <EmptyState title={t("unavailableTitle")} text={t("unavailableText")} />
        ) : items.length === 0 ? (
          <EmptyState title={t(`empty.${empty}.title`)} text={t(`empty.${empty}.text`)} />
        ) : (
          <ul aria-label={t("title")} className="m-0 list-none divide-y divide-line p-0">
            {items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                writable={writable}
                busy={busy}
                onUndo={undo}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
