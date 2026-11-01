"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/styles";

const TABS = [
  { href: "/app/investimentos", label: "portfolio" },
  { href: "/app/investimentos/lancamentos", label: "trades" },
  { href: "/app/investimentos/balanceamento", label: "rebalance" },
] as const;

export function InvestmentTabs() {
  const t = useTranslations("investimentos.tabs");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium",
              active ? "border-brand-700 text-brand-700" : "border-transparent text-muted",
            )}
          >
            {t(label)}
          </Link>
        );
      })}
    </nav>
  );
}
