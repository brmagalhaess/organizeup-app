import { AlertCircle, Download, History } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { InsightScreen } from "@organizeup/db";
import {
  compareFigures,
  isYearPeriod,
  percentChange,
  STATEMENT_KINDS,
  type ReportKind,
  type StatementCell,
  type StatementFigure,
  type StatementSection,
} from "@organizeup/domain";
import { buttonClass, amountClass, cx } from "@/components/styles";
import { Insights } from "@/components/insights/insights";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import type { Locale } from "@/i18n/locales";
import { systemTextOf } from "@/i18n/system-text";
import { requireTenant } from "@/lib/session";
import { statementNotices, type StoredStatement } from "@/lib/statement-file";
import { statementWriter, type ReportTranslate, type StatementWriter } from "@/lib/statement-text";
import { loadReports } from "@/lib/statements";
import { BarsChart, ColumnsChart } from "./report-chart";
import { ReportPicker } from "./report-picker";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("relatorios");
  return { title: t("metaTitle") };
}

/** A dica de cada relatório é a da tela que trata do mesmo assunto. */
const INSIGHT_SCREEN: Record<ReportKind, InsightScreen> = {
  resumo: "painel",
  categorias: "lancamentos",
  fluxo: "calendario",
  patrimonio: "reserva",
  investimentos: "investimentos",
  proventos: "proventos",
  dividas: "dividas",
  metas: "metas",
  aposentadoria: "aposentadoria",
  anual: "painel",
};

const isNumeric = (cell: StatementCell) =>
  cell !== null && ("money" in cell || "percent" in cell || "count" in cell);

function FigureTile({ figure, writer }: { figure: StatementFigure; writer: StatementWriter }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5">
      <dt className="text-sm text-muted">{writer.figure(figure.id)}</dt>
      <dd className="m-0 mt-2">
        <span
          className={cx(
            "block text-lg font-semibold tabular-nums tracking-tight first-letter:uppercase [overflow-wrap:anywhere] sm:text-xl",
            figure.tone && amountClass(figure.tone),
          )}
        >
          {writer.cell(figure.value)}
        </span>
      </dd>
    </div>
  );
}

/** Tabela larga rola sozinha: a página não transborda em 375 px. */
function ReportTable({
  caption,
  columns,
  rows,
  scrollLabel,
}: {
  caption: string;
  columns: string[];
  rows: Array<Array<{ text: string; numeric: boolean }>>;
  scrollLabel: string;
}) {
  return (
    <div
      role="region"
      aria-label={scrollLabel}
      tabIndex={0}
      className="-mx-1 overflow-x-auto px-1 focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={cx(
                  "whitespace-nowrap py-2 pr-4 font-medium last:pr-0",
                  index > 0 && rows.some((row) => row[index]?.numeric) && "text-right",
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line last:border-0">
              {row.map((cell, index) =>
                index === 0 ? (
                  <th
                    key={index}
                    scope="row"
                    className="max-w-52 py-2 pr-4 text-left font-medium [overflow-wrap:anywhere] first-letter:uppercase"
                  >
                    {cell.text}
                  </th>
                ) : (
                  <td
                    key={index}
                    className={cx(
                      "py-2 pr-4 last:pr-0",
                      cell.numeric ? "whitespace-nowrap text-right tabular-nums" : "",
                    )}
                  >
                    {cell.text}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionCard({
  section,
  writer,
  scrollLabel,
}: {
  section: StatementSection;
  writer: StatementWriter;
  scrollLabel: string;
}) {
  const title = writer.section(section.id);
  const chart = section.chart;
  const listOnly = chart?.type === "bars" && section.columns.length <= 3;
  return (
    <Card title={title}>
      {chart?.type === "columns" ? (
        <ColumnsChart section={section} series={chart.series} writer={writer} />
      ) : null}
      {chart?.type === "bars" ? (
        <BarsChart section={section} column={chart.series[0]!} writer={writer} />
      ) : null}
      <div className={listOnly ? "sr-only" : undefined}>
        <ReportTable
          caption={title}
          columns={section.columns.map(writer.column)}
          scrollLabel={`${title}. ${scrollLabel}`}
          rows={section.rows.map((row) =>
            row.map((cell) => ({ text: writer.cell(cell) || "—", numeric: isNumeric(cell) })),
          )}
        />
      </div>
    </Card>
  );
}

function ComparisonCard({
  statement,
  comparison,
  writer,
  t,
}: {
  statement: StoredStatement;
  comparison: StoredStatement;
  writer: StatementWriter;
  t: ReportTranslate;
}) {
  const rows = compareFigures(statement.data, comparison.data);
  if (rows.length === 0) return null;
  const a = writer.period(statement.period);
  const b = writer.period(comparison.period);
  const title = t("comparar.titulo", { a, b });
  return (
    <Card title={title} description={t("comparar.descricao")}>
      <ReportTable
        caption={title}
        columns={[t("comparar.numero"), a, b, t("colunas.difference"), t("colunas.change")]}
        scrollLabel={`${title}. ${t("rolavel")}`}
        rows={rows.map((row) => {
          const change =
            "money" in row.current && "money" in row.other
              ? percentChange(row.current.money, row.other.money)
              : null;
          return [
            { text: writer.figure(row.id), numeric: false },
            { text: writer.cell(row.current), numeric: true },
            { text: writer.cell(row.other), numeric: true },
            { text: writer.cell(row.delta), numeric: true },
            {
              text: change === null ? "—" : writer.cell({ percent: change }),
              numeric: true,
            },
          ];
        })}
      />
    </Card>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx } = await requireTenant();
  const query = await searchParams;
  const one = (name: string) => {
    const value = query[name];
    return typeof value === "string" ? value : undefined;
  };
  const report = await loadReports(ctx, {
    tipo: one("tipo"),
    periodo: one("periodo"),
    comparar: one("comparar"),
  });
  const [translate, tSystem, locale] = await Promise.all([
    getTranslations("relatorios"),
    getTranslations("sistema"),
    getLocale(),
  ]);
  const t = translate as unknown as ReportTranslate;
  const writer = statementWriter(t, systemTextOf(tSystem), locale as Locale, report.currency);
  const { kind, period, statement, comparison, periods } = report;
  const scrollLabel = t("rolavel");

  const fileHref = (format: "pdf" | "csv") =>
    `/app/relatorios/baixar?${new URLSearchParams({ tipo: kind, periodo: period, formato: format })}`;
  const headline = statement
    ? writer.headline(statement.messageKey, statement.messageParams)
    : null;
  // A nota do anual já aparece em destaque, no topo.
  const notices = statement
    ? statementNotices({ ...statement, status: "fechado", revisedAt: null }, writer, t).filter(
        (notice) => notice !== writer.note("anualNaoFiscal"),
      )
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <Insights screen={INSIGHT_SCREEN[kind]} />

      {!report.hasAny ? (
        <EmptyState
          title={t("vazio.titulo")}
          text={t("vazio.texto")}
          action={
            <Link href="/app/lancamentos" className={buttonClass("secondary")}>
              {t("vazio.acao")}
            </Link>
          }
        />
      ) : (
        <>
          <Card>
            <ReportPicker
              kind={kind}
              period={period}
              compare={comparison?.period ?? "nenhum"}
              kinds={STATEMENT_KINDS.map((value) => ({ value, label: writer.kind(value) }))}
              periods={periods.map((item) => ({
                value: item.period,
                label:
                  item.status === "parcial"
                    ? t("periodoParcial", { period: writer.period(item.period) })
                    : writer.period(item.period),
              }))}
              labels={{
                kind: t("campos.tipo"),
                period: isYearPeriod(period || "2026-01") ? t("campos.ano") : t("campos.periodo"),
                compare: t("campos.comparar"),
                none: t("campos.semComparar"),
              }}
            />
          </Card>

          {!statement ? (
            <EmptyState title={t("semPeriodo.titulo")} text={t("semPeriodo.texto")} />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1 basis-64">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-2xl font-medium first-letter:uppercase">
                      {writer.period(statement.period)}
                    </h2>
                    {statement.status === "parcial" ? (
                      <Badge tone="warning">{t("situacao.parcial")}</Badge>
                    ) : (
                      <Badge tone="success">{t("situacao.fechado")}</Badge>
                    )}
                  </div>
                  {headline ? <p className="mt-1 text-sm text-muted">{headline}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={fileHref("pdf")} className={buttonClass("secondary")} download>
                    <Download className="size-4" aria-hidden="true" />
                    {t("baixar.pdf")}
                  </a>
                  <a href={fileHref("csv")} className={buttonClass("secondary")} download>
                    <Download className="size-4" aria-hidden="true" />
                    {t("baixar.csv")}
                  </a>
                </div>
              </div>

              {statement.status === "parcial" ? (
                <p
                  role="status"
                  className="m-0 flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-sm text-warning"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <strong className="font-semibold">{t("parcial.titulo")}</strong>{" "}
                    {statementNotices(statement, writer, t)[0]}
                  </span>
                </p>
              ) : null}
              {statement.revisedAt ? (
                <p className="m-0 flex items-start gap-2 text-sm text-muted">
                  <History className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {statementNotices({ ...statement, status: "fechado" }, writer, t)[0]}
                </p>
              ) : null}

              {statement.data.notes.includes("anualNaoFiscal") ? (
                <p className="m-0 rounded-xl border border-line bg-card p-3 text-sm font-medium">
                  {writer.note("anualNaoFiscal")}
                </p>
              ) : null}

              {statement.whatChanged ? (
                <Card title={t("oQueMudou")}>
                  <p lang={statement.whatChangedLocale ?? undefined} className="m-0 text-sm">
                    {statement.whatChanged}
                  </p>
                </Card>
              ) : null}

              <dl className="m-0 grid grid-cols-2 gap-4 xl:grid-cols-4">
                {statement.data.figures.map((figure) => (
                  <FigureTile key={figure.id} figure={figure} writer={writer} />
                ))}
              </dl>

              {comparison ? (
                <ComparisonCard
                  statement={statement}
                  comparison={comparison}
                  writer={writer}
                  t={t}
                />
              ) : null}

              {statement.data.sections.map((section) => (
                <SectionCard
                  key={section.id}
                  section={section}
                  writer={writer}
                  scrollLabel={scrollLabel}
                />
              ))}

              {notices.length > 0 ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-muted">
                  {notices.map((notice) => (
                    <li key={notice}>{notice}</li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
