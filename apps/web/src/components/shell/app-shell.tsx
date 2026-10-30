"use client";
import {
  ArrowLeftRight,
  CalendarDays,
  CreditCard,
  HandCoins,
  LayoutDashboard,
  Landmark,
  LogOut,
  Menu,
  Palmtree,
  PiggyBank,
  Plus,
  Settings,
  Sunset,
  Tags,
  TrendingUp,
  Upload,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cx } from "@/components/styles";
import { Button, Sheet } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { EntryDialogProvider, useEntryDialog } from "./entry-context";
import type { EntryOptions } from "./entry-form";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const groups: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Dia a dia",
    items: [
      { href: "/app", label: "Painel", icon: LayoutDashboard },
      { href: "/app/lancamentos", label: "Lançamentos", icon: ArrowLeftRight },
      { href: "/app/importar", label: "Importar extrato", icon: Upload },
      { href: "/app/contas", label: "Contas", icon: Landmark },
      { href: "/app/cartoes", label: "Cartões", icon: CreditCard },
      { href: "/app/dividas", label: "Dívidas", icon: WalletCards },
      { href: "/app/categorias", label: "Categorias", icon: Tags },
    ],
  },
  {
    title: "Família",
    items: [
      { href: "/app/familia", label: "Pessoas", icon: Users },
      { href: "/app/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

const soon: Array<{ label: string; icon: LucideIcon }> = [
  { label: "Calendário", icon: CalendarDays },
  { label: "Reserva", icon: PiggyBank },
  { label: "Investimentos", icon: TrendingUp },
  { label: "Proventos", icon: HandCoins },
  { label: "Aposentadoria", icon: Sunset },
  { label: "Viagens", icon: Palmtree },
];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Módulos" className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
            {group.title}
          </p>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
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
      <div>
        <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
          Em construção
        </p>
        <ul className="m-0 list-none space-y-0.5 p-0">
          {soon.map(({ label, icon: Icon }) => (
            <li key={label} className="flex min-h-9 items-center gap-3 px-3 text-sm text-white/70">
              <Icon className="size-4.5 shrink-0" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function UserFooter({ userName, familyName }: { userName: string; familyName: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-3 border-t border-white/15 pt-4">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-peach text-sm font-semibold text-night"
      >
        {initials(userName)}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate font-medium text-white">{userName}</p>
        <p className="truncate text-xs text-white/75">{familyName}</p>
      </div>
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
  );
}

function QuickAdd({ className }: { className?: string }) {
  const { openNew, writable } = useEntryDialog();
  if (!writable) return null;
  return (
    <Button variant="accent" onClick={() => openNew()} className={className}>
      <Plus className="size-4.5" aria-hidden="true" />
      Novo lançamento
    </Button>
  );
}

function MobileBar({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  const { openNew, writable } = useEntryDialog();
  const tabs = [
    { href: "/app", label: "Painel", icon: LayoutDashboard },
    { href: "/app/lancamentos", label: "Lançamentos", icon: ArrowLeftRight },
  ];
  const tab = "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";
  return (
    <nav
      aria-label="Atalhos"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {tabs.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={cx(tab, pathname === href ? "text-brand-700" : "text-muted")}
        >
          <Icon className="size-5" aria-hidden="true" />
          {label}
        </Link>
      ))}
      <button
        type="button"
        disabled={!writable}
        onClick={() => openNew()}
        className={cx(tab, "text-brand-700 disabled:opacity-50")}
      >
        <Plus className="size-5" aria-hidden="true" />
        Lançar
      </button>
      <button type="button" onClick={onMore} className={cx(tab, "text-muted")}>
        <Menu className="size-5" aria-hidden="true" />
        Mais
      </button>
    </nav>
  );
}

export function AppShell({
  children,
  userName,
  familyName,
  writable,
  today,
  accounts,
  categories,
  cards,
}: {
  children: ReactNode;
  userName: string;
  familyName: string;
  writable: boolean;
  today: string;
  accounts: EntryOptions["accounts"];
  categories: EntryOptions["categories"];
  cards: EntryOptions["cards"];
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <EntryDialogProvider
      writable={writable}
      today={today}
      options={{ accounts, categories, cards }}
    >
      <div className="min-h-dvh lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto bg-pine p-4 lg:flex">
          <Link href="/app" className="px-3 pt-2 font-display text-xl font-semibold text-white">
            OrganizeUp
          </Link>
          <QuickAdd className="w-full" />
          <div className="flex-1">
            <Navigation />
          </div>
          <UserFooter userName={userName} familyName={familyName} />
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="flex items-center justify-between gap-3 bg-pine px-4 py-3 lg:hidden">
            <Link href="/app" className="font-display text-lg font-semibold text-white">
              OrganizeUp
            </Link>
            <span className="truncate text-sm text-white/85">{familyName}</span>
          </header>
          <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-10 lg:pt-8 2xl:px-14">
            {children}
          </main>
        </div>
      </div>

      <MobileBar onMore={() => setMenuOpen(true)} />
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <div className="-m-5 flex min-h-full flex-col gap-6 bg-pine p-5">
          <Navigation onNavigate={() => setMenuOpen(false)} />
          <UserFooter userName={userName} familyName={familyName} />
        </div>
      </Sheet>
    </EntryDialogProvider>
  );
}
