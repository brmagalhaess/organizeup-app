"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/app", label: "Início" },
  { href: "/app/mes", label: "Dinheiro do mês" },
  { href: "/app/contas", label: "Contas" },
];

/** Barra inferior no celular, linha sob o cabeçalho no computador (ADR-0003). */
export function AppNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Módulos"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:static md:border-t-0 md:border-b md:pb-0"
    >
      <ul className="m-0 mx-auto grid max-w-5xl list-none grid-cols-3 p-0 md:flex md:gap-2 md:px-6">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 items-center justify-center px-2 text-center text-sm md:min-h-11 md:px-3 ${
                  active ? "font-semibold text-brand-700" : "text-muted"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
