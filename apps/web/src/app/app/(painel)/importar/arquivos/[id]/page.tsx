import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listSmartFiles, listSmartItemsPage, summarizeSmartItems } from "@organizeup/agents";
import {
  accounts,
  asc,
  canWrite,
  categories,
  creditCards,
  eq,
  readFamilyAccess,
  smartImports,
  tolerateSchemaLag,
  withHousehold,
} from "@organizeup/db";
import {
  canUse,
  CARD_CATEGORY,
  missingSmartFields,
  SMART_DESTINATION_MODULE,
  SMART_DESTINATIONS,
  SMART_REVIEW_PAGE_SIZE,
  smartFlow,
} from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { Card, PageHeader } from "@/components/ui";
import { requireSmartImport } from "@/lib/importador/access";
import { ReviewBoard, type FileView, type ItemView } from "./review-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("importador");
  return { title: t("review.metaTitle") };
}

export default async function SmartImportReview({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pagina?: string | string[] }>;
}) {
  const { id } = await params;
  const { pagina } = await searchParams;
  const asked = Number(Array.isArray(pagina) ? pagina[0] : pagina);
  const { ctx } = await requireSmartImport();
  const t = await getTranslations("importador");
  const access = await readFamilyAccess(ctx);
  const blocked = SMART_DESTINATIONS.filter((destination) => {
    const owner = SMART_DESTINATION_MODULE[destination];
    return owner !== null && !canUse(access, owner);
  });
  const data = await tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const [lot] = await tx.select().from(smartImports).where(eq(smartImports.id, id));
        if (!lot) return { lot: null };
        const summary = await summarizeSmartItems(tx, id, blocked);
        const pages = Math.max(Math.ceil(summary.total / SMART_REVIEW_PAGE_SIZE), 1);
        const page = Number.isInteger(asked) ? Math.min(Math.max(asked, 1), pages) : 1;
        return {
          lot,
          summary,
          page,
          pages,
          files: await listSmartFiles(tx, id),
          items: await listSmartItemsPage(tx, id, page),
          accounts: await tx
            .select({ id: accounts.id, name: accounts.name })
            .from(accounts)
            .where(eq(accounts.archived, false))
            .orderBy(asc(accounts.createdAt)),
          cards: await tx
            .select({ id: creditCards.id, name: creditCards.name })
            .from(creditCards)
            .where(eq(creditCards.archived, false))
            .orderBy(asc(creditCards.createdAt)),
          categories: await tx
            .select({ id: categories.id, name: categories.name, kind: categories.kind })
            .from(categories)
            .where(eq(categories.archived, false))
            .orderBy(asc(categories.position), asc(categories.name)),
        };
      }),
    null,
  );
  if (!data) {
    return (
      <Card>
        <p className="text-sm text-muted">{t("updating")}</p>
      </Card>
    );
  }
  if (!data.lot) notFound();
  const { lot, files, items, summary, page, pages } = data;
  const fileOf = new Map(files.map((file) => [file.id, file]));
  const views: ItemView[] = items.map((item) => {
    const file = fileOf.get(item.fileId);
    const owner = SMART_DESTINATION_MODULE[item.destination];
    return {
      id: item.id,
      fileId: item.fileId,
      destination: item.destination,
      status: item.status,
      selected: item.selected,
      seen: item.seen,
      duplicate: item.duplicate,
      duplicateReason: item.duplicateReason,
      otherFile: item.duplicateFileId ? (fileOf.get(item.duplicateFileId)?.fileName ?? null) : null,
      confidence: item.confidence,
      excerpt: item.excerpt,
      payload: item.payload,
      failure: item.failure,
      saved: item.status === "gravado",
      flow: smartFlow(item.payload),
      missing: missingSmartFields(item.payload, {
        accountId: file?.accountId ?? null,
        cardId: file?.cardId ?? null,
      }),
      blockedModule: owner !== null && !canUse(access, owner) ? owner : null,
    };
  });
  const fileViews: FileView[] = files.map((file) => ({
    id: file.id,
    fileName: file.fileName,
    status: file.status,
    docType: file.docType,
    issuer: file.issuer,
    confidence: file.confidence,
    method: file.method,
    failure: file.failure,
    truncated: file.truncated,
    notes: file.notes,
    fields: file.fields,
    accountId: file.accountId,
    cardId: file.cardId,
  }));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("review.title")}
        description={t("review.description")}
        actions={
          <Link href="/app/importar/arquivos" className={buttonClass("secondary")}>
            {t("review.back")}
          </Link>
        }
      />
      <ReviewBoard
        importId={lot.id}
        status={lot.status}
        files={fileViews}
        items={views}
        accounts={data.accounts}
        cards={data.cards}
        categories={data.categories.filter((category) => category.name !== CARD_CATEGORY)}
        summary={summary}
        page={page}
        pages={pages}
        writable={canWrite(ctx)}
      />
    </div>
  );
}
