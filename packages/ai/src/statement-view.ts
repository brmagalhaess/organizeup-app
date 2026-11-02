// O relatório como o modelo o vê: números crus, com todo texto livre marcado como dado não confiável.
// A ferramenta `ver_relatorio` e o parágrafo "O que mudou" leem por aqui.
import type { StatementCell, StatementData } from "@organizeup/domain";
import { untrusted } from "./privacy";

type Scrub = (text: string) => string;

function cellValue(cell: StatementCell, scrub: Scrub): unknown {
  if (!cell) return null;
  if ("money" in cell) return cell.money;
  if ("percent" in cell) return cell.percent;
  if ("count" in cell) return cell.count;
  if ("month" in cell) return cell.month;
  if ("date" in cell) return cell.date;
  if ("year" in cell) return cell.year;
  if ("label" in cell) return cell.label;
  if ("category" in cell) return untrusted(scrub(cell.category));
  return untrusted(scrub(cell.text));
}

export function statementView(data: StatementData, scrub: Scrub = (text) => text) {
  return {
    numeros: Object.fromEntries(
      data.figures.map((figure) => [figure.id, cellValue(figure.value, scrub)]),
    ),
    tabelas: data.sections.map((section) => ({
      tabela: section.id,
      colunas: section.columns,
      linhas: section.rows.map((row) => row.map((cell) => cellValue(cell, scrub))),
    })),
    notas: data.notes,
  };
}
