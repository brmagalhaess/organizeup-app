"use client";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

const HREF = "/app/notificacoes";

/** Sininho do topo. O número fica no nome do link, para o leitor de tela. */
export function NotificationBell({ unread }: { unread: number }) {
  const t = useTranslations("notificacoes");
  const pathname = usePathname();
  const label = t("bell", { count: unread });
  return (
    <Link
      href={HREF}
      aria-label={label}
      title={label}
      aria-current={pathname === HREF ? "page" : undefined}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-white hover:bg-white/10"
    >
      <Bell className="size-5" aria-hidden="true" />
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 min-w-5 rounded-full bg-peach px-1 text-center text-xs font-semibold text-night"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
