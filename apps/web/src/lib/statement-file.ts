// O que os dois arquivos têm em comum: título, situação e avisos no idioma de quem baixa.
import {
  SAVINGS_STATEMENT_KINDS,
  STATEMENT_RULE_VERSION,
  type StatementData,
} from "@organizeup/domain";
import { formatDate, formatInstant } from "@/i18n/format";
import type { StatementFileInfo } from "./statement-csv";
import type { ReportTranslate, StatementWriter } from "./statement-text";

export interface StoredStatement {
  kind: StatementData["kind"];
  period: string;
  status: "parcial" | "fechado";
  data: StatementData;
  messageKey: string | null;
  messageParams: Record<string, unknown> | null;
  whatChanged: string | null;
  revisedAt: Date | null;
}

export function statementNotices(
  row: Pick<StoredStatement, "status" | "data" | "revisedAt">,
  writer: StatementWriter,
  t: ReportTranslate,
) {
  return [
    ...(row.status === "parcial"
      ? [t("parcial.texto", { date: formatDate(row.data.asOf, writer.locale) })]
      : []),
    ...(row.revisedAt
      ? [
          t(row.data.notes.includes("aporteSeparado") ? "atualizadoRegra" : "atualizado", {
            date: formatInstant(row.revisedAt, writer.locale),
          }),
        ]
      : []),
    ...(SAVINGS_STATEMENT_KINDS.includes(row.data.kind) && row.data.version < STATEMENT_RULE_VERSION
      ? [t("regraAntiga")]
      : []),
    ...row.data.notes.map(writer.note),
  ];
}

export function statementFile(
  row: StoredStatement,
  writer: StatementWriter,
  t: ReportTranslate,
): StatementFileInfo {
  const headline = writer.headline(row.messageKey, row.messageParams);
  return {
    data: row.data,
    title: `${writer.kind(row.kind)} · ${writer.period(row.period)}`,
    status: t(`situacao.${row.status}`),
    notices: [...(headline ? [headline] : []), ...statementNotices(row, writer, t)],
    whatChanged: row.whatChanged,
    labels: { currency: t("arquivo.moeda"), figures: t("arquivo.numeros") },
  };
}
