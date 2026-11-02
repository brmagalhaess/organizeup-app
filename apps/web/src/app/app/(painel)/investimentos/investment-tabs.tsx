"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cx } from "@/components/styles";

const TABS = [
  { href: "/app/investimentos", label: "portfolio" },
  { href: "/app/investimentos/lancamentos", label: "trades" },
  { href: "/app/investimentos/balanceamento", label: "rebalance" },
  { href: "/app/investimentos/importar", label: "import" },
] as const;

export function InvestmentTabs() {
  const t = useTranslations("investimentos.tabs");
  const pathname = usePathname();
  const active = useRef<HTMLAnchorElement>(null);
  // No celular a barra rola de lado: a aba aberta não pode ficar escondida.
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  return (
    <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map(({ href, label }) => {
        const current = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            ref={current ? active : undefined}
            aria-current={current ? "page" : undefined}
            className={cx(
              "-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium",
              current ? "border-brand-700 text-brand-700" : "border-transparent text-muted",
            )}
          >
            {t(label)}
          </Link>
        );
      })}
    </nav>
  );
}
