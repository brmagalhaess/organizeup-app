import { assistantState, type AssistantState } from "@organizeup/ai";
import {
  accounts,
  activeNotices,
  asc,
  canWrite,
  categories,
  creditCards,
  ensureFinanceDefaults,
  eq,
  household,
  householdSettings,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { AppShell, type ShellBanner, type ShellNotice } from "@/components/shell/app-shell";
import { onboardingStatus } from "@/lib/onboarding";
import { platformFlags, requireTenant } from "@/lib/session";
import { countPending, noticeCookie, tolerateSchemaLag } from "@/lib/suggestions";

const ONBOARDING_KEY = "onboarding";

/** Aviso e contagem do menu. Sem a migração ainda aplicada, o painel abre sem os dois. */
async function shellStatus(ctx: TenantContext, writable: boolean) {
  const t = await getTranslations("shell");
  const dismissed = (await cookies()).has(noticeCookie(ONBOARDING_KEY));
  const onboarding: ShellNotice = {
    key: ONBOARDING_KEY,
    text: t("onboardingNotice"),
    href: "/app/completar",
    linkLabel: t("onboardingLink"),
  };
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const pendingSuggestions = await countPending(tx);
        const invite = writable && !dismissed && (await onboardingStatus(tx)).pending;
        return { notice: invite ? onboarding : null, pendingSuggestions };
      }),
    { notice: null, pendingSuggestions: 0 },
  );
}

/** Faixas do serviço: manutenção (sempre visível) e avisos valendo agora, que dá para dispensar. */
async function platformBanners(): Promise<ShellBanner[]> {
  const t = await getTranslations("shell");
  const flags = await platformFlags();
  const store = await cookies();
  const banners: ShellBanner[] = activeNotices(flags)
    .map((notice) => ({ key: `aviso-${notice.id}`, text: notice.text, dismissible: true }))
    .filter((banner) => !store.has(noticeCookie(banner.key)));
  if (flags.maintenance) {
    banners.unshift({
      key: "manutencao",
      text: flags.maintenanceMessage ?? t("maintenance"),
      dismissible: false,
    });
  }
  return banners;
}

/** O botão do assistente nunca pode derrubar o painel. Conferência de verdade: runChatTurn. */
async function assistantStatus(ctx: TenantContext): Promise<AssistantState> {
  try {
    return await assistantState({ ctx, flags: await platformFlags() });
  } catch {
    return "desligado";
  }
}

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { session, ctx } = await requireTenant();
  const writable = canWrite(ctx);
  const [status, banners, assistant] = await Promise.all([
    shellStatus(ctx, writable),
    platformBanners(),
    assistantStatus(ctx),
  ]);
  const t = await getTranslations("shell");
  const data = await withHousehold(ctx, async (tx) => {
    if (writable) await ensureFinanceDefaults(tx, ctx.householdId);
    const [family] = await tx
      .select({ name: household.name })
      .from(household)
      .where(eq(household.id, ctx.householdId));
    const [settings] = await tx
      .select({ timezone: householdSettings.timezone })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    const accountRows = await tx
      .select({ id: accounts.id, name: accounts.name, archived: accounts.archived })
      .from(accounts)
      .orderBy(asc(accounts.createdAt));
    const categoryRows = await tx
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        archived: categories.archived,
      })
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.name));
    const cardRows = await tx
      .select({ id: creditCards.id, name: creditCards.name })
      .from(creditCards)
      .where(eq(creditCards.archived, false))
      .orderBy(asc(creditCards.createdAt));
    return {
      family: family?.name ?? t("fallbackFamily"),
      timezone: settings?.timezone,
      accounts: accountRows,
      categories: categoryRows,
      cards: cardRows,
    };
  });

  return (
    <AppShell
      userName={session.user.name}
      familyName={data.family}
      writable={writable}
      today={todayIn(data.timezone)}
      accounts={data.accounts}
      categories={data.categories}
      cards={data.cards}
      notice={status.notice}
      banners={banners}
      pendingSuggestions={status.pendingSuggestions}
      assistant={assistant}
    >
      {children}
    </AppShell>
  );
}
