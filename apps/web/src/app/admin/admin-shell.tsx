"use client";
import {
  ArrowLeft,
  Bot,
  CreditCard,
  Crown,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  Server,
  SlidersHorizontal,
  Tags,
  TrendingUp,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cx } from "@/components/styles";
import { Sheet } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

interface Section {
  href: string;
  label: string;
  icon: LucideIcon;
}

const groups: Array<{ title: string; items: Section[] }> = [
  {
    title: "Acompanhar",
    items: [
      { href: "/admin", label: "Visão geral", icon: LayoutDashboard },
      { href: "/admin/familias", label: "Famílias", icon: Users },
      { href: "/admin/usuarios", label: "Usuários", icon: UserRound },
    ],
  },
  {
    title: "Operar",
    items: [
      { href: "/admin/agentes", label: "Agentes", icon: Bot },
      { href: "/admin/sistema", label: "Sistema", icon: Server },
      { href: "/admin/controles", label: "Controles", icon: SlidersHorizontal },
      { href: "/admin/auditoria", label: "Auditoria", icon: ScrollText },
    ],
  },
  {
    title: "Cobrança",
    items: [
      { href: "/admin/assinaturas", label: "Assinaturas", icon: CreditCard },
      { href: "/admin/vip", label: "VIP", icon: Crown },
      { href: "/admin/catalogo", label: "Catálogo", icon: Tags },
      { href: "/admin/receita", label: "Receita e uso", icon: TrendingUp },
      { href: "/admin/cobranca", label: "Chave", icon: KeyRound },
    ],
  },
];

const shortcuts = [
  groups[0]!.items[0]!,
  groups[0]!.items[1]!,
  groups[0]!.items[2]!,
  groups[1]!.items[0]!,
];

const isActive = (pathname: string, href: string) =>
  href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Seções do painel" className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
            {group.title}
          </p>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition",
                      active ? "bg-white text-night" : "text-white hover:bg-white/10",
                    )}
                  >
                    <Icon className="size-4.5 shrink-0" aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Footer({ userName }: { userName: string }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-3 border-t border-white/15 pt-4">
      <Link
        href="/app"
        className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-white hover:bg-white/10"
      >
        <ArrowLeft className="size-4.5 shrink-0" aria-hidden="true" />
        Voltar ao app
      </Link>
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate px-3 text-sm text-white/85">{userName}</p>
        <button
          type="button"
          aria-label="Sair"
          title="Sair"
          onClick={async () => {
            await authClient.signOut();
            router.replace("/entrar");
            router.refresh();
          }}
          className="flex size-9 items-center justify-center rounded-lg text-white hover:bg-white/10"
        >
          <LogOut className="size-4.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/admin" className="px-3 pt-2 text-white">
      <span className="block font-display text-xl font-semibold">OrganizeUp</span>
      <span className="block text-xs text-white/75">Painel do serviço</span>
    </Link>
  );
}

function MobileBar({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  const tab = "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";
  return (
    <nav
      aria-label="Atalhos do painel"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {shortcuts.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(tab, active ? "text-brand-700" : "text-muted")}
          >
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
      <button type="button" onClick={onMore} className={cx(tab, "text-muted")}>
        <Menu className="size-5" aria-hidden="true" />
        Mais
      </button>
    </nav>
  );
}

/** Moldura do painel: mesma família visual do app, com menu lateral e barra próprios. */
export function AdminShell({
  children,
  userName,
  banner,
}: {
  children: ReactNode;
  userName: string;
  banner?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <div className="min-h-dvh lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col gap-6 bg-pine p-4 lg:flex">
          <Brand />
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            <Navigation />
          </div>
          <Footer userName={userName} />
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="flex items-center justify-between gap-3 bg-pine px-4 py-3 lg:hidden">
            <Link href="/admin" className="font-display text-lg font-semibold text-white">
              OrganizeUp
            </Link>
            <span className="truncate text-sm text-white/85">Painel do serviço</span>
          </header>
          {banner}
          <main className="flex flex-1 flex-col gap-6 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-10 lg:pt-8 2xl:px-14">
            {children}
          </main>
        </div>
      </div>

      <MobileBar onMore={() => setMenuOpen(true)} />
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu do painel">
        <div className="-m-5 flex min-h-full flex-col gap-6 bg-pine p-5">
          <Navigation onNavigate={() => setMenuOpen(false)} />
          <Footer userName={userName} />
        </div>
      </Sheet>
    </>
  );
}
