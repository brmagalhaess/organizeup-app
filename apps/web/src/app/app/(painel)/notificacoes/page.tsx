import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { canWrite } from "@organizeup/db";
import {
  countUnread,
  loadNotifications,
  NOTIFICATION_FILTERS,
  type NotificationFilter,
} from "@/lib/notifications";
import { requireTenant } from "@/lib/session";
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
  const { ctx } = await requireTenant();
  const { filtro } = await searchParams;
  const filter = NOTIFICATION_FILTERS.find((item) => item === filtro) ?? "todas";
  const [items, unread] = await Promise.all([loadNotifications(ctx, filter), countUnread(ctx)]);
  return (
    <NotificationsBoard
      items={items}
      filter={filter satisfies NotificationFilter}
      unread={unread}
      writable={canWrite(ctx)}
    />
  );
}
