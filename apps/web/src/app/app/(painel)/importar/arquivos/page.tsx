import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { listSmartFilesOf, listSmartImports } from "@organizeup/agents";
import { importerGate, importerUsage, serviceDay } from "@organizeup/ai";
import { canWrite, tolerateSchemaLag, withHousehold } from "@organizeup/db";
import { SMART_MODEL_FILES_PER_MONTH } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatInstant } from "@/i18n/format";
import { resolveLocale } from "@/i18n/resolve";
import { requireSmartImport } from "@/lib/importador/access";
import { DeleteImport } from "./delete-import";
import { UploadPanel } from "./upload-panel";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("importador");
  return { title: t("metaTitle") };
}

export default async function SmartImportPage() {
  const { ctx } = await requireSmartImport();
  const [t, locale] = await Promise.all([getTranslations("importador"), resolveLocale()]);
  const lots = await tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const imports = await listSmartImports(tx);
        const files = await listSmartFilesOf(
          tx,
          imports.map((row) => row.id),
        );
        return imports.map((row) => ({
          ...row,
          files: files.filter((file) => file.importId === row.id),
        }));
      }),
    null,
  );
  const [gate, usage] = await Promise.all([
    importerGate({ ctx }),
    importerUsage(ctx, serviceDay()),
  ]);
  const writable = canWrite(ctx);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      {lots === null ? (
        <Card>
          <p className="text-sm text-muted">{t("updating")}</p>
        </Card>
      ) : writable ? (
        <UploadPanel gate={gate} used={usage.files} limit={SMART_MODEL_FILES_PER_MONTH} />
      ) : (
        <Card>
          <p className="text-sm text-muted">{t("noPermission")}</p>
        </Card>
      )}
      {lots && lots.length === 0 ? (
        <EmptyState title={t("empty.title")} text={t("empty.text")} />
      ) : null}
      {lots && lots.length > 0 ? (
        <Card title={t("list.title")}>
          <ul className="flex flex-col divide-y divide-line">
            {lots.map((lot) => (
              <li
                key={lot.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="m-0 font-medium">
                    {formatInstant(lot.createdAt, locale)}
                    {" · "}
                    {t("list.files", { count: lot.files.length })}
                  </p>
                  <p className="m-0 truncate text-sm text-muted">
                    {lot.files.map((file) => file.fileName).join(", ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={lot.status === "concluido" ? "success" : "neutral"}>
                    {t(`status.${lot.status}`)}
                  </Badge>
                  <Link
                    href={`/app/importar/arquivos/${lot.id}`}
                    className={buttonClass("secondary", true)}
                  >
                    {t("list.open")}
                  </Link>
                  {writable ? <DeleteImport id={lot.id} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
