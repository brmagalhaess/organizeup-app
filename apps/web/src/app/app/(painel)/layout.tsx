import {
  accounts,
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
import { cookies } from "next/headers";
import { AppShell, type ShellNotice } from "@/components/shell/app-shell";
import { onboardingStatus } from "@/lib/onboarding";
import { requireTenant } from "@/lib/session";
import { countPending, noticeCookie, tolerateSchemaLag } from "@/lib/suggestions";

const ONBOARDING_NOTICE: ShellNotice = {
  key: "onboarding",
  text: "Faltam alguns dados para montar o plano de aposentadoria, as viagens e as metas.",
  href: "/app/completar",
  linkLabel: "Completar agora",
};

/** Aviso e contagem do menu. Sem a migração ainda aplicada, o painel abre sem os dois. */
async function shellStatus(ctx: TenantContext, writable: boolean) {
  const dismissed = (await cookies()).has(noticeCookie(ONBOARDING_NOTICE.key));
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const pendingSuggestions = await countPending(tx);
        const invite = writable && !dismissed && (await onboardingStatus(tx)).pending;
        return { notice: invite ? ONBOARDING_NOTICE : null, pendingSuggestions };
      }),
    { notice: null, pendingSuggestions: 0 },
  );
}

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { session, ctx } = await requireTenant();
  const writable = canWrite(ctx);
  const status = await shellStatus(ctx, writable);
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
      family: family?.name ?? "Família",
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
      pendingSuggestions={status.pendingSuggestions}
    >
      {children}
    </AppShell>
  );
}
