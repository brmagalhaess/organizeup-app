"use client";
import {
  ArrowLeftRight,
  BadgeDollarSign,
  CalendarDays,
  Compass,
  CreditCard,
  Gem,
  HandCoins,
  LayoutDashboard,
  Landmark,
  LogOut,
  Megaphone,
  Menu,
  Palmtree,
  PiggyBank,
  Plus,
  Settings,
  Sparkles,
  Sunset,
  Tags,
  Target,
  TrendingUp,
  Upload,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { AssistantState } from "@organizeup/ai";
import { skipOnboarding } from "@/app/app/(inicio)/completar/actions";
import { dismissNotice } from "@/app/app/(painel)/sugestoes/actions";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { cx } from "@/components/styles";
import { Button, IconButton, Sheet } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { EntryDialogProvider, useEntryDialog } from "./entry-context";
import type { EntryOptions } from "./entry-form";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface ShellNotice {
  key: string;
  text: string;
  href: string;
  linkLabel: string;
}

/** Faixa do serviço, escrita no painel: manutenção ou aviso para todos. */
export interface ShellBanner {
  key: string;
  text: string;
  dismissible: boolean;
}

const SUGGESTIONS_HREF = "/app/sugestoes";

const groups: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Dia a dia",
    items: [
      { href: "/app", label: "Painel", icon: LayoutDashboard },
      { href: "/app/plano", label: "Seu plano", icon: Compass },
      { href: SUGGESTIONS_HREF, label: "Sugestões", icon: Sparkles },
      { href: "/app/lancamentos", label: "Lançamentos", icon: ArrowLeftRight },
      { href: "/app/calendario", label: "Calendário", icon: CalendarDays },
      { href: "/app/renda", label: "Renda", icon: BadgeDollarSign },
      { href: "/app/importar", label: "Importar extrato", icon: Upload },
      { href: "/app/contas", label: "Contas", icon: Landmark },
      { href: "/app/cartoes", label: "Cartões", icon: CreditCard },
      { href: "/app/dividas", label: "Dívidas", icon: WalletCards },
      { href: "/app/categorias", label: "Categorias", icon: Tags },
    ],
  },
  {
    title: "Patrimônio",
    items: [
      { href: "/app/reserva", label: "Reserva", icon: PiggyBank },
      { href: "/app/patrimonio", label: "Patrimônio", icon: Gem },
      { href: "/app/investimentos", label: "Investimentos", icon: TrendingUp },
      { href: "/app/proventos", label: "Proventos", icon: HandCoins },
      { href: "/app/metas", label: "Metas", icon: Target },
      { href: "/app/aposentadoria", label: "Aposentadoria", icon: Sunset },
      { href: "/app/viagens", label: "Viagens", icon: Palmtree },
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

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function Navigation({
  pendingSuggestions,
  onNavigate,
}: {
  pendingSuggestions: number;
  onNavigate?: () => void;
}) {
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
                    {href === SUGGESTIONS_HREF && pendingSuggestions > 0 ? (
                      <span
                        role="img"
                        aria-label={
                          pendingSuggestions === 1
                            ? "1 sugestão pendente"
                            : `${pendingSuggestions} sugestões pendentes`
                        }
                        className="ml-auto min-w-5 rounded-full bg-peach px-1.5 text-center text-xs font-semibold text-night"
                      >
                        {pendingSuggestions}
                      </span>
                    ) : null}
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

function NoticeBanner({ notice }: { notice: ShellNotice }) {
  return (
    <section role="region" aria-label="Aviso" className="bg-warning-soft text-ink">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm sm:px-6 lg:px-10 2xl:px-14">
        <p className="min-w-0 flex-1 basis-60">{notice.text}</p>
        <Link href={notice.href} className="font-semibold underline underline-offset-2">
          {notice.linkLabel}
        </Link>
        <form action={skipOnboarding}>
          <Button type="submit" variant="ghost" small>
            Não mostrar mais
          </Button>
        </form>
        <form action={dismissNotice}>
          <input type="hidden" name="key" value={notice.key} />
          <IconButton type="submit" label="Fechar aviso" className="text-ink">
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </form>
      </div>
    </section>
  );
}

function ServiceBanner({ banner }: { banner: ShellBanner }) {
  return (
    <section role="region" aria-label="Aviso do serviço" className="bg-brand-100 text-ink">
      <div className="flex items-center gap-3 px-4 py-2 text-sm sm:px-6 lg:px-10 2xl:px-14">
        <Megaphone className="size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">{banner.text}</p>
        {banner.dismissible ? (
          <form action={dismissNotice}>
            <input type="hidden" name="key" value={banner.key} />
            <IconButton type="submit" label="Fechar aviso" className="text-ink">
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          </form>
        ) : null}
      </div>
    </section>
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
  notice = null,
  banners = [],
  pendingSuggestions,
  assistant,
}: {
  children: ReactNode;
  userName: string;
  familyName: string;
  writable: boolean;
  today: string;
  accounts: EntryOptions["accounts"];
  categories: EntryOptions["categories"];
  cards: EntryOptions["cards"];
  notice?: ShellNotice | null;
  banners?: ShellBanner[];
  pendingSuggestions: number;
  assistant: AssistantState;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <EntryDialogProvider
      writable={writable}
      today={today}
      options={{ accounts, categories, cards }}
    >
      <div className="min-h-dvh lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-dvh flex-col gap-4 bg-pine p-4 lg:flex">
          <Link href="/app" className="px-3 pt-2 font-display text-xl font-semibold text-white">
            OrganizeUp
          </Link>
          <QuickAdd className="w-full" />
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-color:rgb(255_255_255/0.3)_transparent] [scrollbar-width:thin]">
            <Navigation pendingSuggestions={pendingSuggestions} />
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
          {banners.map((banner) => (
            <ServiceBanner key={banner.key} banner={banner} />
          ))}
          {notice ? <NoticeBanner notice={notice} /> : null}
          <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-10 lg:pt-8 2xl:px-14">
            {children}
          </main>
        </div>
      </div>

      <AssistantPanel state={assistant} />
      <MobileBar onMore={() => setMenuOpen(true)} />
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <div className="-m-5 flex min-h-full flex-col gap-6 bg-pine p-5">
          <Navigation
            pendingSuggestions={pendingSuggestions}
            onNavigate={() => setMenuOpen(false)}
          />
          <UserFooter userName={userName} familyName={familyName} />
        </div>
      </Sheet>
    </EntryDialogProvider>
  );
}
