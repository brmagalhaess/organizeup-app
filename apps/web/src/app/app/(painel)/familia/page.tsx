import type { Metadata } from "next";
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
import { Card, PageHeader } from "@/components/ui";
import { requireTenant } from "@/lib/session";
import { PeopleBoard } from "./people-board";

export const metadata: Metadata = { title: "Família" };

export default async function FamilyPage() {
  const { ctx } = await requireTenant();
  const data = await withHousehold(ctx, async (tx) => {
    const [family] = await tx
      .select({ name: household.name })
      .from(household)
      .where(eq(household.id, ctx.householdId));
    const [settings] = await tx
      .select({ timezone: householdSettings.timezone })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    const rows = await tx.select().from(people).orderBy(asc(people.createdAt));
    return { family, settings, rows };
  });
  const [year, month] = todayIn(data.settings?.timezone).split("-").map(Number) as [number, number];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Família" title={data.family?.name ?? "Família"} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <PeopleBoard
          writable={canWrite(ctx)}
          rows={data.rows.map((person) => ({
            id: person.id,
            name: person.name,
            relation: person.relation,
            age:
              person.birthYear && person.birthMonth
                ? ageFromBirth(person.birthYear, person.birthMonth, { year, month })
                : null,
          }))}
        />
        <Card title="Usar junto" description="Em construção.">
          <p className="text-sm text-muted">
            Em breve você poderá convidar outra pessoa para acessar a mesma família, cada uma com
            seu login.
          </p>
        </Card>
      </div>
    </div>
  );
}
