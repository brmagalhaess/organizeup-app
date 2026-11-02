import { isStatementKind, isStatementPeriod } from "@organizeup/domain";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/locales";
import { systemTextOf } from "@/i18n/system-text";
import { requireTenant } from "@/lib/session";
import { statementCsv } from "@/lib/statement-csv";
import { statementFile } from "@/lib/statement-file";
import { statementPdf } from "@/lib/statement-pdf";
import { statementWriter, type ReportTranslate } from "@/lib/statement-text";
import { loadReportFile } from "@/lib/statements";

export const dynamic = "force-dynamic";

const TYPES = {
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
} as const;

/**
 * GET /app/relatorios/baixar?tipo=&periodo=&formato=pdf|csv: o relatório no idioma de quem baixa e na
 * moeda da família. A leitura passa pela RLS: relatório de outra família simplesmente não existe aqui.
 */
export async function GET(request: Request) {
  const { ctx } = await requireTenant();
  const query = new URL(request.url).searchParams;
  const kind = query.get("tipo") ?? "";
  const period = query.get("periodo") ?? "";
  const format = query.get("formato");
  if (!isStatementKind(kind) || !isStatementPeriod(period)) {
    return new Response(null, { status: 400 });
  }
  if (format !== "pdf" && format !== "csv") return new Response(null, { status: 400 });

  const found = await loadReportFile(ctx, kind, period);
  if (!found) return new Response(null, { status: 404 });

  const [t, tSystem, locale] = await Promise.all([
    getTranslations("relatorios"),
    getTranslations("sistema"),
    getLocale(),
  ]);
  const translate = t as unknown as ReportTranslate;
  const writer = statementWriter(
    translate,
    systemTextOf(tSystem),
    locale as Locale,
    found.currency,
  );
  const file = statementFile(found.statement, writer, translate);
  const name = `organizeup-${kind}-${period}.${format}`;
  const body =
    format === "csv"
      ? statementCsv(file, writer)
      : statementPdf(file, writer, (page, total) => translate("arquivo.rodape", { page, total }));
  return new Response(typeof body === "string" ? body : Buffer.from(body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
