import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { asc, canWrite, categories, withHousehold } from "@organizeup/db";
import { PageHeader } from "@/components/ui";
import { requireTenant } from "@/lib/session";
import { CategoriesBoard } from "./categories-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("categorias");
  return { title: t("metaTitle") };
}

export default async function CategoriesPage() {
  const { ctx } = await requireTenant();
  const t = await getTranslations("categorias");
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
      <PageHeader title={t("title")} description={t("description")} />
      <CategoriesBoard rows={rows} writable={canWrite(ctx)} />
    </div>
  );
}
