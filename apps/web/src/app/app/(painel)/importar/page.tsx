import type { Metadata } from "next";
import {
  accounts,
  asc,
  canWrite,
  categories,
  desc,
  eq,
  householdSettings,
  importBatches,
  withHousehold,
} from "@organizeup/db";
import { CARD_CATEGORY, todayIn } from "@organizeup/domain";
import { Card, PageHeader } from "@/components/ui";
import { requireTenant } from "@/lib/session";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Importar extrato" };

export default async function ImportPage() {
  const { ctx } = await requireTenant();
  const data = await withHousehold(ctx, async (tx) => {
    const accountRows = await tx
      .select({ id: accounts.id, name: accounts.name, archived: accounts.archived })
      .from(accounts)
      .orderBy(asc(accounts.createdAt));
    const categoryRows = await tx
      .select({ id: categories.id, name: categories.name, kind: categories.kind })
      .from(categories)
      .where(eq(categories.archived, false))
      .orderBy(asc(categories.position), asc(categories.name));
    const batchRows = await tx
      .select()
      .from(importBatches)
      .orderBy(desc(importBatches.createdAt))
      .limit(10);
    const [settings] = await tx
      .select({ timezone: householdSettings.timezone })
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    return { accountRows, categoryRows, batchRows, timezone: settings?.timezone };
  });
  const accountName = new Map(data.accountRows.map((a) => [a.id, a.name]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Importar extrato"
        title="Traga o extrato do banco"
        description="Você revisa tudo antes. O que já foi importado não entra de novo."
      />
      {canWrite(ctx) ? (
        <ImportWizard
          accounts={data.accountRows
            .filter((account) => !account.archived)
            .map(({ id, name }) => ({ id, name }))}
          categories={data.categoryRows.filter((category) => category.name !== CARD_CATEGORY)}
          batches={data.batchRows.map((batch) => ({
            id: batch.id,
            accountName: accountName.get(batch.accountId) ?? "Conta",
            source: batch.source,
            rowCount: batch.rowCount,
            periodStart: batch.periodStart,
            periodEnd: batch.periodEnd,
            createdAt: todayIn(data.timezone, batch.createdAt),
          }))}
        />
      ) : (
        <Card>
          <p className="text-sm text-muted">Seu papel nesta família não permite importar.</p>
        </Card>
      )}
    </div>
  );
}
