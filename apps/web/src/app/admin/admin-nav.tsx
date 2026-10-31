"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/styles";

const links = [
  { href: "/admin", label: "Visão geral" },
  { href: "/admin/familias", label: "Famílias" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Seções do painel" className="flex flex-wrap gap-2">
      {links.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium transition hover:bg-brand-50 hover:text-ink",
              active ? "bg-brand-50 text-ink" : "text-muted",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
