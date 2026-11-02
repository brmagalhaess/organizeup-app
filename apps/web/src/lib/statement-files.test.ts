import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import {
  buildResumo,
  money,
  STATEMENT_COLUMNS,
  STATEMENT_FIGURES,
  STATEMENT_KINDS,
  STATEMENT_LABELS,
  STATEMENT_NOTES,
  STATEMENT_SECTIONS,
  toDbAmount,
  type Currency,
} from "@organizeup/domain";
import type { Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { systemTextOf } from "@/i18n/system-text";
import { statementCsv } from "./statement-csv";
import { statementFile, type StoredStatement } from "./statement-file";
import { pdfText, statementPdf } from "./statement-pdf";
import { statementWriter, type ReportTranslate } from "./statement-text";

const LOCALES: Locale[] = ["pt-BR", "en", "es"];

const translate = (locale: Locale, namespace: string) =>
  createTranslator({ locale, messages: messagesFor(locale), namespace: namespace as never });

function writerFor(locale: Locale, currency: Currency = "BRL") {
  const t = translate(locale, "relatorios") as unknown as ReportTranslate;
  const system = systemTextOf(translate(locale, "sistema") as never);
  return { t, writer: statementWriter(t, system, locale, currency) };
}

const summary = (received: string, spent: string) => ({
  received,
  spent,
  balance: toDbAmount(money(received).minus(spent)),
  plannedIncome: "0.00",
  plannedExpense: "0.00",
  projectedBalance: toDbAmount(money(received).minus(spent)),
});

const draft = buildResumo({
  month: "2026-10",
  asOf: "2026-10-31",
  summary: summary("1234.50", "500.00"),
  previous: summary("1000.00", "600.00"),
  history: [{ month: "2026-09", received: "1000.00", spent: "600.00", balance: "400.00" }],
  largest: [{ description: "=SOMA(A1)", date: "2026-10-05", amount: "500.00" }],
})!;

const stored = (over: Partial<StoredStatement> = {}): StoredStatement => ({
  kind: "resumo",
  period: "2026-10",
  status: "fechado",
  data: draft.data,
  messageKey: draft.message.key,
  messageParams: draft.message.params,
  whatChanged: null,
  revisedAt: null,
  ...over,
});

describe("catálogo dos relatórios", () => {
  it.each(LOCALES)("%s tem texto para todo número, coluna, seção e nota", (locale) => {
    const { t } = writerFor(locale);
    const keys = [
      ...STATEMENT_KINDS.flatMap((id) => [`tipos.${id}`, `mensagens.${id}`]),
      ...STATEMENT_FIGURES.map((id) => `numeros.${id}`),
      ...STATEMENT_SECTIONS.map((id) => `secoes.${id}`),
      ...STATEMENT_COLUMNS.map((id) => `colunas.${id}`),
      ...STATEMENT_LABELS.map((id) => `rotulos.${id}`),
      ...STATEMENT_NOTES.map((id) => `notas.${id}`),
    ];
    expect(keys.filter((key) => !t.has(key))).toEqual([]);
  });
});

describe("texto do relatório", () => {
  it("usa o idioma da pessoa e a moeda da família", () => {
    expect(writerFor("pt-BR").writer.amount("1234.50")).toContain("1.234,50");
    expect(writerFor("en", "USD").writer.amount("1234.50")).toBe("$1,234.50");
    expect(writerFor("es", "EUR").writer.amount("1234.50")).toContain("€");
    expect(writerFor("en").writer.headline(draft.message.key, draft.message.params)).toBe(
      "R$1,234.50 came in, R$500.00 went out and R$734.50 was left.",
    );
  });

  it("chave que esta versão não conhece fica sem frase", () => {
    expect(writerFor("pt-BR").writer.headline("chaveNova", {})).toBeNull();
    expect(writerFor("pt-BR").writer.headline(null, null)).toBeNull();
  });

  it("anual deixa claro que não é orientação fiscal, nos três idiomas", () => {
    expect(writerFor("pt-BR").writer.note("anualNaoFiscal")).toMatch(/orientação fiscal/);
    expect(writerFor("en").writer.note("anualNaoFiscal")).toMatch(/tax advice/);
    expect(writerFor("es").writer.note("anualNaoFiscal")).toMatch(/asesoría fiscal/);
  });
});

describe("CSV", () => {
  const csvOf = (locale: Locale, over?: Partial<StoredStatement>) => {
    const { t, writer } = writerFor(locale);
    return statementCsv(statementFile(stored(over), writer, t), writer);
  };

  it("abre certo na planilha de cada idioma", () => {
    expect(csvOf("pt-BR")).toMatch(/^\uFEFF/);
    expect(csvOf("pt-BR")).toContain("Entrou;1234,50");
    expect(csvOf("en")).toContain("Came in,1234.50");
    expect(csvOf("en")).toContain("Currency,BRL");
  });

  it("texto digitado não vira fórmula", () => {
    expect(csvOf("pt-BR")).toContain("'=SOMA(A1)");
    expect(csvOf("pt-BR")).not.toMatch(/(^|;)=SOMA/m);
  });

  it("aspas e separador no texto não quebram a linha", () => {
    const { t, writer } = writerFor("pt-BR");
    const file = statementFile(stored({ whatChanged: 'Mês "bom"; sobrou' }), writer, t);
    expect(statementCsv(file, writer)).toContain('"Mês ""bom""; sobrou"');
  });

  it("parcial e atualizado aparecem no arquivo", () => {
    expect(csvOf("pt-BR", { status: "parcial" })).toContain("O período ainda não acabou");
    expect(csvOf("en", { revisedAt: new Date("2026-11-20T12:00:00Z") })).toContain("Updated on");
  });
});

describe("PDF", () => {
  const pdfOf = (locale: Locale, currency: Currency = "BRL") => {
    const { t, writer } = writerFor(locale, currency);
    return statementPdf(
      statementFile(stored({ status: "parcial", whatChanged: "Mês bom." }), writer, t),
      writer,
      (page, total) => t("arquivo.rodape", { page, total }),
    );
  };

  it.each(LOCALES)("%s gera um PDF de verdade", (locale) => {
    const bytes = pdfOf(locale, locale === "es" ? "EUR" : "BRL");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("troca o que a fonte padrão não tem, sem perder acento nem euro", () => {
    expect(pdfText("Café € 1\u00A0234 \u2212 😀")).toBe("Café € 1 234 - ?");
  });
});
