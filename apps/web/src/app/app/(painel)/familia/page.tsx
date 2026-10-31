import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  asc,
  canWrite,
  eq,
  household,
  householdSettings,
  people,
  withHousehold,
} from "@organizeup/db";
import { ageFromBirth, todayIn } from "@organizeup/domain";
import { PageHeader } from "@/components/ui";
import { getAuth } from "@/lib/auth";
import { requireTenant } from "@/lib/session";
import { MembersBoard } from "./members-board";
import { PeopleBoard } from "./people-board";
import { WeddingForm } from "./wedding-form";

export const metadata: Metadata = { title: "Família" };

export default async function FamilyPage() {
  const { session, ctx } = await requireTenant();
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
    return { family, settings, rows };
  });
  const [year, month] = todayIn(data.settings?.timezone).split("-").map(Number) as [number, number];
  const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: data.settings?.timezone });
  const members = memberRows.map((member) => ({
    id: member.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    self: member.userId === session.user.id,
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
      <PageHeader eyebrow="Família" title={data.family?.name ?? "Família"} />
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
              expectedPension: person.expectedPension?.replace(".", ",") ?? "",
              retirementAge: person.retirementAge,
            }))}
          />
          <WeddingForm
            writable={writable}
            values={{
              day: data.settings?.weddingDay ?? null,
              month: data.settings?.weddingMonth ?? null,
              year: data.settings?.weddingYear ?? null,
            }}
          />
        </div>
        <MembersBoard members={members} invites={invites} isOwner={isOwner} />
      </div>
    </div>
  );
}
