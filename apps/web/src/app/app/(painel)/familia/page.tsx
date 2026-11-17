import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import {
  asc,
  canWrite,
  eq,
  household,
  householdSettings,
  inArray,
  people,
  user,
  withHousehold,
} from "@organizeup/db";
import { ageFromBirth, todayIn } from "@organizeup/domain";
import { PageHeader } from "@/components/ui";
import { getAccountFeatures } from "@/i18n/account-server";
import { toFieldValue } from "@/i18n/format";
import { getAuth } from "@/lib/auth";
import { loadMembersReminders } from "@/lib/reminders";
import { requireTenant } from "@/lib/session";
import { MembersBoard } from "./members-board";
import { PeopleBoard } from "./people-board";
import { WeddingForm } from "./wedding-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pessoas");
  return { title: t("metaTitle") };
}

export default async function FamilyPage() {
  const { session, ctx } = await requireTenant();
  const [t, locale, features] = await Promise.all([
    getTranslations("pessoas"),
    getLocale(),
    getAccountFeatures(),
  ]);
  const isOwner = ctx.role === "owner";
  const writable = canWrite(ctx);
  const requestHeaders = await headers();
  const auth = getAuth();
  const query = { organizationId: ctx.householdId };
  const { members: memberRows } = await auth.api.listMembers({ headers: requestHeaders, query });
  const pending = isOwner
    ? (await auth.api.listInvitations({ headers: requestHeaders, query })).filter(
        (invite) => invite.status === "pending" && invite.expiresAt > new Date(),
      )
    : [];
  const origin = process.env.BETTER_AUTH_URL ?? "";
  const data = await withHousehold(ctx, async (tx) => {
    const [family] = await tx
      .select({ name: household.name })
      .from(household)
      .where(eq(household.id, ctx.householdId));
    const [settings] = await tx
      .select({
        timezone: householdSettings.timezone,
        weddingDay: householdSettings.weddingDay,
        weddingMonth: householdSettings.weddingMonth,
        weddingYear: householdSettings.weddingYear,
      })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    const rows = await tx.select().from(people).orderBy(asc(people.createdAt));
    const ids = memberRows.map((member) => member.userId);
    const verified = isOwner
      ? await tx
          .select({ id: user.id, emailVerified: user.emailVerified })
          .from(user)
          .where(inArray(user.id, ids.length > 0 ? ids : [""]))
      : [];
    return { family, settings, rows, verified };
  });
  const emailOn = isOwner ? await loadMembersReminders(ctx) : new Map<string, boolean>();
  const verifiedIds = new Set(
    data.verified.filter((row) => row.emailVerified).map((row) => row.id),
  );
  const [year, month] = todayIn(data.settings?.timezone).split("-").map(Number) as [number, number];
  const dateFormat = new Intl.DateTimeFormat(locale, { timeZone: data.settings?.timezone });
  // Com os centavos, como em "2500,00": `toFieldValue` os tira.
  const members = memberRows.map((member) => ({
    id: member.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    self: member.userId === session.user.id,
    // Sem escolha guardada, vale o padrão: ligado.
    emails: emailOn.get(member.userId) ?? true,
    verified: verifiedIds.has(member.userId),
  }));
  const invites = pending.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role ?? "",
    expires: dateFormat.format(invite.expiresAt),
    link: `${origin}/convite/${invite.id}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={data.family?.name ?? t("fallbackName")} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <PeopleBoard
            writable={writable}
            rows={data.rows.map((person) => ({
              id: person.id,
              name: person.name,
              relation: person.relation,
              age:
                person.birthYear && person.birthMonth
                  ? ageFromBirth(person.birthYear, person.birthMonth, { year, month })
                  : null,
              birth:
                person.birthYear && person.birthMonth
                  ? `${person.birthYear}-${String(person.birthMonth).padStart(2, "0")}`
                  : "",
              workStatus: person.workStatus ?? "",
              inssContributor: person.inssContributor,
              expectedPension: toFieldValue(person.expectedPension, locale),
              retirementAge: person.retirementAge,
              // Percentual, não dinheiro: sem os zeros do fim, como "12,5".
              ownership: person.ownershipPercent
                ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
                    Number(person.ownershipPercent),
                  )
                : "",
            }))}
          />
          {features.wedding ? (
            <WeddingForm
              writable={writable}
              values={{
                day: data.settings?.weddingDay ?? null,
                month: data.settings?.weddingMonth ?? null,
                year: data.settings?.weddingYear ?? null,
              }}
            />
          ) : null}
        </div>
        <MembersBoard members={members} invites={invites} isOwner={isOwner} />
      </div>
    </div>
  );
}
