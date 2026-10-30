import type { Metadata } from "next";
import { asc, canWrite, categories, withHousehold } from "@organizeup/db";
import { PageHeader } from "@/components/ui";
import { requireTenant } from "@/lib/session";
import { CategoriesBoard } from "./categories-board";

export const metadata: Metadata = { title: "Categorias" };

export default async function CategoriesPage() {
  const { ctx } = await requireTenant();
  const rows = await withHousehold(ctx, (tx) =>
    tx
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        essential: categories.essential,
        archived: categories.archived,
      })
      .from(categories)
      .orderBy(asc(categories.position), asc(categories.name)),
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Categorias"
        description="Como seus lançamentos são agrupados nos relatórios."
      />
      <CategoriesBoard rows={rows} writable={canWrite(ctx)} />
    </div>
  );
}
