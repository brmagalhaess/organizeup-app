import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listSmartFiles, listSmartItems } from "@organizeup/agents";
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
  money,
  SMART_DESTINATION_MODULE,
  smartFlow,
  toDbAmount,
} from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { Card, PageHeader } from "@/components/ui";
import { requireTenant } from "@/lib/session";
import { ReviewBoard, type FileView, type ItemView } from "./review-board";

const MAX_ROWS_PER_GROUP = 200;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("importador");
  return { title: t("review.metaTitle") };
}

export default async function SmartImportReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireTenant();
  const t = await getTranslations("importador");
  const data = await tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const [lot] = await tx.select().from(smartImports).where(eq(smartImports.id, id));
        if (!lot) return { lot: null };
        return {
          lot,
          files: await listSmartFiles(tx, id),
          items: await listSmartItems(tx, id),
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
  const { lot, files, items } = data;
  const access = await readFamilyAccess(ctx);
  const fileOf = new Map(files.map((file) => [file.id, file]));
  const allViews: ItemView[] = items.map((item) => {
    const file = fileOf.get(item.fileId);
    const owner = SMART_DESTINATION_MODULE[item.destination];
    return {
      id: item.id,
      fileId: item.fileId,
      destination: item.destination,
      status: item.status,
      selected: item.selected,
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
  // Um lote pode ter dezenas de milhares de itens: a tela mostra o começo de cada grupo, e as contas valem para todos.
  const groupTotals: Record<string, number> = {};
  const views = allViews.filter((item) => {
    const key = `${item.fileId}:${item.destination}`;
    groupTotals[key] = (groupTotals[key] ?? 0) + 1;
    return groupTotals[key] <= MAX_ROWS_PER_GROUP;
  });
  const open = allViews.filter((item) => !item.saved);
  const chosen = open.filter((item) => item.selected && !item.blockedModule);
  const summary = {
    novo: open.filter((item) => item.duplicate === "novo").length,
    possivel: open.filter((item) => item.duplicate === "possivel").length,
    jaLancado: open.filter((item) => item.duplicate === "ja_lancado").length,
    blocked: open.filter((item) => item.blockedModule || item.missing.length > 0).length,
    selected: chosen.length,
  };
  const sum = (inflow: boolean) =>
    toDbAmount(
      chosen.reduce(
        (acc, item) => (item.flow && item.flow.in === inflow ? acc.plus(item.flow.amount) : acc),
        money(0),
      ),
    );

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
        totals={{ in: sum(true), out: sum(false) }}
        summary={summary}
        groupTotals={groupTotals}
        writable={canWrite(ctx)}
      />
    </div>
  );
}
