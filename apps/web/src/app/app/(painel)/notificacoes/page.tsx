import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import {
  countUnread,
  loadNotifications,
  NOTIFICATION_FILTERS,
  type NotificationFilter,
} from "@/lib/notifications";
import { emailCanSend } from "@/lib/email";
import { loadReminderPrefs, remindersOpen } from "@/lib/reminders";
import { platformFlags, requireTenant } from "@/lib/session";
import { NotificationsBoard } from "./notifications-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notificacoes");
  return { title: t("metaTitle") };
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const { ctx, session } = await requireTenant();
  const { filtro } = await searchParams;
  const filter = NOTIFICATION_FILTERS.find((item) => item === filtro) ?? "todas";
  const [items, unread, reminders, flags] = await Promise.all([
    loadNotifications(ctx, filter),
    countUnread(ctx),
    loadReminderPrefs(ctx),
    platformFlags(),
  ]);
  const open = remindersOpen(flags, session.user);
  return (
    <NotificationsBoard
      items={items}
      filter={filter satisfies NotificationFilter}
      unread={unread}
      writable={canWrite(ctx)}
      reminders={
        open
          ? {
              enabled: reminders.enabled,
              bills: reminders.bills,
              income: reminders.income,
              dividends: reminders.dividends,
              expenses: reminders.expenses,
              retirement: reminders.retirement,
              daysAhead: reminders.daysAhead,
            }
          : null
      }
      email={{
        address: session.user.email,
        verified: session.user.emailVerified,
        canSend: emailCanSend(),
      }}
    />
  );
}
