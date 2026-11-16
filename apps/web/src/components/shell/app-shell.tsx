"use client";
import {
  ArrowLeftRight,
  BadgeCheck,
  Bell,
  BadgeDollarSign,
  Cable,
  CalendarDays,
  ChartColumn,
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
  PanelLeftClose,
  PanelLeftOpen,
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
import { useTranslations, type Messages } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { AssistantState } from "@organizeup/ai";
import { skipDocument, skipOnboarding } from "@/app/app/(inicio)/completar/actions";
import { dismissNotice } from "@/app/app/(painel)/sugestoes/actions";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { Brand, BrandMark } from "@/components/brand";
import { ConfirmEmailButton } from "@/components/confirm-email-button";
import { cx } from "@/components/styles";
import { Button, IconButton, Sheet } from "@/components/ui";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { useBrazilRules } from "@/i18n/money";
import { authClient } from "@/lib/auth-client";
import { EntryDialogProvider, useEntryDialog } from "./entry-context";
import type { EntryOptions } from "./entry-form";
import { MENU_COOKIE } from "./menu-cookie";
import { MonthBar, monthOnScreen, withMonth, type MonthRange } from "./month-bar";
import { NotificationBell } from "./notification-bell";

interface NavItem {
  href: string;
  label: NavKey;
  icon: LucideIcon;
}

type NavKey = keyof Messages["shell"]["nav"];

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
  href?: string;
  linkLabel?: string;
}

const SUGGESTIONS_HREF = "/app/sugestoes";
const DIVIDENDS_HREF = "/app/proventos";
const BILLING_HREF = "/app/assinatura";
const BANK_HREF = "/app/contas/conexoes";

/** Telas já traduzidas. As outras seguem em português e avisam isso ao leitor de tela. */
const TRANSLATED_SCREENS = new Set([
  "/app",
  "/app/configuracoes",
  "/app/notificacoes",
  "/app/lancamentos",
  "/app/contas",
  BANK_HREF,
  "/app/cartoes",
  "/app/dividas",
  "/app/dividas/importar",
  "/app/categorias",
  "/app/importar",
  "/app/renda",
  "/app/calendario",
  "/app/sugestoes",
  "/app/assinatura",
]);
const TRANSLATED_AREAS = [
  "/app/plano",
  "/app/reserva",
  "/app/patrimonio",
  "/app/investimentos",
  "/app/proventos",
  "/app/metas",
  "/app/aposentadoria",
  "/app/viagens",
  "/app/familia",
  "/app/relatorios",
];
const isTranslated = (pathname: string) =>
  TRANSLATED_SCREENS.has(pathname) ||
  TRANSLATED_AREAS.some((area) => pathname === area || pathname.startsWith(`${area}/`));

const groups: Array<{ title: keyof Messages["shell"]["groups"]; items: NavItem[] }> = [
  {
    title: "daily",
    items: [
      { href: "/app", label: "panel", icon: LayoutDashboard },
      { href: "/app/plano", label: "plan", icon: Compass },
      { href: SUGGESTIONS_HREF, label: "suggestions", icon: Sparkles },
      { href: "/app/lancamentos", label: "entries", icon: ArrowLeftRight },
      { href: "/app/calendario", label: "calendar", icon: CalendarDays },
      { href: "/app/relatorios", label: "reports", icon: ChartColumn },
      { href: "/app/renda", label: "income", icon: BadgeDollarSign },
      { href: "/app/importar", label: "import", icon: Upload },
      { href: "/app/contas", label: "accounts", icon: Landmark },
      { href: BANK_HREF, label: "bank", icon: Cable },
      { href: "/app/cartoes", label: "cards", icon: CreditCard },
      { href: "/app/dividas", label: "debts", icon: WalletCards },
      { href: "/app/categorias", label: "categories", icon: Tags },
    ],
  },
  {
    title: "wealth",
    items: [
      { href: "/app/reserva", label: "reserve", icon: PiggyBank },
      { href: "/app/patrimonio", label: "wealth", icon: Gem },
      { href: "/app/investimentos", label: "investments", icon: TrendingUp },
      { href: DIVIDENDS_HREF, label: "dividends", icon: HandCoins },
      { href: "/app/metas", label: "goals", icon: Target },
      { href: "/app/aposentadoria", label: "retirement", icon: Sunset },
      { href: "/app/viagens", label: "trips", icon: Palmtree },
    ],
  },
  {
    title: "family",
    items: [
      { href: "/app/familia", label: "people", icon: Users },
      { href: BILLING_HREF, label: "subscription", icon: BadgeCheck },
      { href: "/app/configuracoes", label: "settings", icon: Settings },
    ],
  },
];

/**
 * Proventos são da B3, com IR e JCP: fora das regras brasileiras, o menu não oferece. A conexão com bancos só
 * aparece para quem pode usá-la (ADR-0038).
 */
const groupsFor = (brazil: boolean, billing: boolean, bank: boolean) =>
  groups.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (brazil || item.href !== DIVIDENDS_HREF) &&
        (billing || item.href !== BILLING_HREF) &&
        (bank || item.href !== BANK_HREF),
    ),
  }));

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
  billing,
  bank,
  compact = false,
  hrefOf,
  onNavigate,
}: {
  /** Menu recolhido: só os ícones, com o nome na dica. */
  compact?: boolean;
  /** Endereço de cada tela, já no mês escolhido no cabeçalho. */
  hrefOf: (href: string) => string;
  pendingSuggestions: number;
  /** Com a chave da cobrança desligada, a tela de planos só aparece para o admin. */
  billing: boolean;
  /** Conexão com bancos liberada para esta pessoa. */
  bank: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const brazil = useBrazilRules();
  return (
    <nav aria-label={t("modules")} className={cx("flex flex-col", compact ? "gap-3" : "gap-6")}>
      {groupsFor(brazil, billing, bank).map((group, index) => (
        <div key={group.title}>
          {compact ? (
            index > 0 ? (
              <hr className="mx-2 mb-3 border-0 border-t border-white/15" />
            ) : null
          ) : (
            <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
              {t(`groups.${group.title}`)}
            </p>
          )}
          <ul className="m-0 list-none space-y-0.5 p-0">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={hrefOf(href)}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    aria-label={compact ? t(`nav.${label}`) : undefined}
                    title={compact ? t(`nav.${label}`) : undefined}
                    className={cx(
                      "relative flex min-h-10 items-center rounded-xl text-sm font-medium transition",
                      compact ? "justify-center px-0" : "gap-3 px-3",
                      active ? "bg-white text-night" : "text-white hover:bg-white/10",
                    )}
                  >
                    <Icon className="size-4.5 shrink-0" aria-hidden="true" />
                    {compact ? null : t(`nav.${label}`)}
                    {href === SUGGESTIONS_HREF && pendingSuggestions > 0 ? (
                      <span
                        role="img"
                        aria-label={t("pendingSuggestions", { count: pendingSuggestions })}
                        className={cx(
                          "rounded-full bg-peach text-center text-xs font-semibold text-night",
                          compact
                            ? "absolute right-1.5 top-1 min-w-4 px-1 text-[10px] leading-4"
                            : "ml-auto min-w-5 px-1.5",
                        )}
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

function UserFooter({
  userName,
  familyName,
  compact = false,
}: {
  userName: string;
  familyName: string;
  compact?: boolean;
}) {
  const t = useTranslations("shell");
  const router = useRouter();
  return (
    <div
      className={cx(
        "flex items-center gap-3 border-t border-white/15 pt-4",
        compact && "flex-col gap-2",
      )}
    >
      <span
        aria-hidden={compact ? undefined : "true"}
        role={compact ? "img" : undefined}
        aria-label={compact ? `${userName}, ${familyName}` : undefined}
        title={compact ? `${userName} · ${familyName}` : undefined}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-peach text-sm font-semibold text-night"
      >
        {initials(userName)}
      </span>
      {compact ? null : (
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate font-medium text-white">{userName}</p>
          <p className="truncate text-xs text-white/75">{familyName}</p>
        </div>
      )}
      <button
        type="button"
        aria-label={t("signOut")}
        title={t("signOut")}
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

function QuickAdd({ className, compact = false }: { className?: string; compact?: boolean }) {
  const t = useTranslations("shell");
  const { openNew, writable } = useEntryDialog();
  if (!writable) return null;
  if (compact)
    return (
      <button
        type="button"
        aria-label={t("newEntry")}
        title={t("newEntry")}
        onClick={() => openNew()}
        className="mx-auto flex size-10 items-center justify-center rounded-xl bg-peach text-night transition hover:brightness-95"
      >
        <Plus className="size-5" aria-hidden="true" />
      </button>
    );
  return (
    <Button variant="accent" onClick={() => openNew()} className={className}>
      <Plus className="size-4.5" aria-hidden="true" />
      {t("newEntry")}
    </Button>
  );
}

function MobileBar({ onMore, hrefOf }: { onMore: () => void; hrefOf: (href: string) => string }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const { openNew, writable } = useEntryDialog();
  const tabs = [
    { href: "/app", label: t("nav.panel"), icon: LayoutDashboard },
    { href: "/app/lancamentos", label: t("nav.entries"), icon: ArrowLeftRight },
  ];
  const tab = "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";
  return (
    <nav
      aria-label={t("shortcuts")}
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {tabs.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={hrefOf(href)}
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
        {t("add")}
      </button>
      <button type="button" onClick={onMore} className={cx(tab, "text-muted")}>
        <Menu className="size-5" aria-hidden="true" />
        {t("more")}
      </button>
    </nav>
  );
}

function NoticeBanner({ notice }: { notice: ShellNotice }) {
  const t = useTranslations("shell");
  return (
    <section role="region" aria-label={t("notice")} className="bg-warning-soft text-ink">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm sm:px-6 lg:px-10 2xl:px-14">
        <p className="min-w-0 flex-1 basis-60">{notice.text}</p>
        <Link href={notice.href} className="font-semibold underline underline-offset-2">
          {notice.linkLabel}
        </Link>
        <form action={notice.key === "documento" ? skipDocument : skipOnboarding}>
          <Button type="submit" variant="ghost" small>
            {t("dontShowAgain")}
          </Button>
        </form>
        <form action={dismissNotice}>
          <input type="hidden" name="key" value={notice.key} />
          <IconButton type="submit" label={t("closeNotice")} className="text-ink">
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </form>
      </div>
    </section>
  );
}

/** Discreto de propósito: confirmar o e-mail não é obrigatório. Fechar não tira a opção de Configurações. */
function EmailBanner({ noticeKey }: { noticeKey: string }) {
  const t = useTranslations("shell");
  return (
    <section role="region" aria-label={t("emailNoticeLabel")} className="bg-card-soft text-ink">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6 lg:px-10 2xl:px-14">
        <p className="min-w-0 flex-1 basis-60">{t("emailNotice")}</p>
        <ConfirmEmailButton />
        <form action={dismissNotice}>
          <input type="hidden" name="key" value={noticeKey} />
          <IconButton type="submit" label={t("closeNotice")} className="text-ink">
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </form>
      </div>
    </section>
  );
}

function ServiceBanner({ banner }: { banner: ShellBanner }) {
  const t = useTranslations("shell");
  return (
    <section role="region" aria-label={t("serviceNotice")} className="bg-brand-100 text-ink">
      <div className="flex items-center gap-3 px-4 py-2 text-sm sm:px-6 lg:px-10 2xl:px-14">
        <Megaphone className="size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">{banner.text}</p>
        {banner.href ? (
          <Link href={banner.href} className="shrink-0 font-semibold underline">
            {banner.linkLabel}
          </Link>
        ) : null}
        {banner.dismissible ? (
          <form action={dismissNotice}>
            <input type="hidden" name="key" value={banner.key} />
            <IconButton type="submit" label={t("closeNotice")} className="text-ink">
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
  emailNotice = null,
  banners = [],
  billing = false,
  bank = false,
  pendingSuggestions,
  unreadNotifications,
  assistant,
  months,
  menuCollapsed = false,
}: {
  children: ReactNode;
  /** Mês de hoje e a faixa que o seletor do cabeçalho oferece. */
  months: MonthRange;
  /** Como a pessoa deixou o menu da última vez (cookie `ou_menu`). */
  menuCollapsed?: boolean;
  userName: string;
  familyName: string;
  writable: boolean;
  today: string;
  accounts: EntryOptions["accounts"];
  categories: EntryOptions["categories"];
  cards: EntryOptions["cards"];
  notice?: ShellNotice | null;
  /** Chave do aviso de confirmar o e-mail, quando ele aparece. */
  emailNotice?: string | null;
  banners?: ShellBanner[];
  billing?: boolean;
  bank?: boolean;
  pendingSuggestions: number;
  unreadNotifications: number;
  assistant: AssistantState;
}) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const params = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(menuCollapsed);
  // O mês escolhido acompanha a pessoa de uma tela para a outra, inclusive passando por telas sem mês.
  const onScreen = monthOnScreen(pathname, params, months.current);
  const [kept, setKept] = useState(months.current);
  if (onScreen !== null && onScreen !== kept) setKept(onScreen);
  const month = onScreen ?? kept;
  const hrefOf = (href: string) => withMonth(href, month, months.current);
  // Onde a pessoa está: a tela do menu que casa com o endereço, a mais específica primeiro.
  const tNotifications = useTranslations("notificacoes");
  const place = groups
    .flatMap((group) => group.items)
    // O Painel é a raiz de todas as telas: só vale para o endereço exato dele.
    .filter(
      (item) =>
        pathname === item.href || (item.href !== "/app" && pathname.startsWith(`${item.href}/`)),
    )
    .sort((a, b) => b.href.length - a.href.length)[0];
  const here = place
    ? { icon: place.icon, label: t(`nav.${place.label}`) }
    : pathname.startsWith("/app/notificacoes")
      ? { icon: Bell, label: tNotifications("title") }
      : { icon: LayoutDashboard, label: familyName };
  const toggleMenu = () => {
    const next = !collapsed;
    setCollapsed(next);
    // Preferência de tela, lida pelo servidor na próxima visita: o menu já chega no tamanho certo.
    document.cookie = `${MENU_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <EntryDialogProvider
      writable={writable}
      today={today}
      options={{ accounts, categories, cards }}
    >
      <div
        className={cx(
          "min-h-dvh lg:grid lg:transition-[grid-template-columns] lg:duration-200 motion-reduce:transition-none",
          collapsed
            ? "lg:grid-cols-[4.5rem_minmax(0,1fr)]"
            : "lg:grid-cols-[16.5rem_minmax(0,1fr)]",
        )}
      >
        {/* O menu fica preso na janela, e não na página: o lugar dele na grade é guardado por este vazio. */}
        <div aria-hidden="true" className="hidden lg:block" />
        <aside
          className={cx(
            "fixed inset-y-0 left-0 z-10 hidden flex-col gap-4 overflow-hidden bg-pine lg:flex lg:transition-[width] lg:duration-200 motion-reduce:transition-none",
            collapsed ? "w-[4.5rem] px-2 py-4" : "w-[16.5rem] p-4",
          )}
        >
          <div
            className={cx(
              "flex items-center pt-1",
              collapsed ? "flex-col gap-2" : "justify-between",
            )}
          >
            <Link
              href="/app"
              aria-label={collapsed ? "OrganizeUp" : undefined}
              title={collapsed ? "OrganizeUp" : undefined}
              className={cx("rounded-lg", collapsed ? "" : "px-2")}
            >
              {collapsed ? <BrandMark tone="dark" className="size-9" /> : <Brand tone="dark" />}
            </Link>
            <div className="flex items-center">
              <button
                type="button"
                aria-label={t(collapsed ? "expandMenu" : "collapseMenu")}
                aria-expanded={!collapsed}
                title={t(collapsed ? "expandMenu" : "collapseMenu")}
                onClick={toggleMenu}
                className="flex size-9 items-center justify-center rounded-lg text-white hover:bg-white/10"
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4.5" aria-hidden="true" />
                ) : (
                  <PanelLeftClose className="size-4.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          <QuickAdd className="w-full" compact={collapsed} />
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-color:rgb(255_255_255/0.3)_transparent] [scrollbar-width:thin]">
            <Navigation
              billing={billing}
              bank={bank}
              compact={collapsed}
              hrefOf={hrefOf}
              pendingSuggestions={pendingSuggestions}
            />
          </div>
          <UserFooter userName={userName} familyName={familyName} compact={collapsed} />
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="flex items-center justify-between gap-3 bg-pine px-4 py-2.5 lg:hidden">
            <Link href="/app">
              <Brand tone="dark" size="sm" />
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm text-white/85">{familyName}</span>
              <NotificationBell unread={unreadNotifications} />
            </div>
          </header>
          {banners.map((banner) => (
            <ServiceBanner key={banner.key} banner={banner} />
          ))}
          {notice ? <NoticeBanner notice={notice} /> : null}
          {emailNotice ? <EmailBanner noticeKey={emailNotice} /> : null}
          {/* Cabeçalho do computador: onde a pessoa está, o mês da tela e os avisos. Fica preso no topo. */}
          <header className="sticky top-0 z-10 hidden h-16 items-center gap-4 border-b border-line bg-surface/90 px-10 backdrop-blur lg:flex 2xl:px-14">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700"
              >
                <here.icon className="size-4.5" />
              </span>
              <p className="m-0 truncate font-display text-lg font-medium first-letter:uppercase">
                {here.label}
              </p>
            </div>
            {onScreen ? (
              <>
                <span aria-hidden="true" className="h-6 w-px shrink-0 bg-line" />
                <MonthBar range={months} month={onScreen} />
              </>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center gap-3">
              <span className="hidden max-w-56 truncate text-sm text-muted xl:block">
                {familyName}
              </span>
              <NotificationBell unread={unreadNotifications} tone="light" />
            </div>
          </header>
          {onScreen ? <MonthBar bar range={months} month={onScreen} /> : null}
          <main
            lang={isTranslated(pathname) ? undefined : DEFAULT_LOCALE}
            className="flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-10 lg:pt-8 2xl:px-14"
          >
            {children}
          </main>
        </div>
      </div>

      <AssistantPanel state={assistant} />
      <MobileBar onMore={() => setMenuOpen(true)} hrefOf={hrefOf} />
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={t("menu")}>
        <div className="-m-5 flex min-h-full flex-col gap-6 bg-pine p-5">
          <Navigation
            billing={billing}
            bank={bank}
            hrefOf={hrefOf}
            pendingSuggestions={pendingSuggestions}
            onNavigate={() => setMenuOpen(false)}
          />
          <UserFooter userName={userName} familyName={familyName} />
        </div>
      </Sheet>
    </EntryDialogProvider>
  );
}
