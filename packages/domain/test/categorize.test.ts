import { describe, expect, it } from "vitest";
import {
  categorizeRow,
  importReport,
  memoryKey,
  merchantKey,
  type CategoryMemory,
  type CategoryOption,
} from "../src";

const categories: CategoryOption[] = [
  { id: "m", name: "Mercado", kind: "despesa" },
  { id: "l", name: "Lazer", kind: "despesa" },
  { id: "o", name: "Outras despesas", kind: "despesa" },
  { id: "s", name: "Salário", kind: "receita" },
  { id: "x", name: "Outras receitas", kind: "receita" },
];
const empty: CategoryMemory = { history: new Map(), learned: new Map() };
const despesa = (description: string) => ({ description, kind: "despesa" as const });

describe("estabelecimento", () => {
  it("ignora meio de pagamento, datas e números", () => {
    const key = "padaria sao jose";
    expect(merchantKey("COMPRA CARTAO PADARIA SAO JOSE 15/10")).toBe(key);
    expect(merchantKey("Pix enviado Padaria São José")).toBe(key);
    expect(merchantKey("PIX 123456")).toBe("");
  });
});

describe("agente de categorização", () => {
  it("usa palavra conhecida, sem acento e sem caixa", () => {
    expect(categorizeRow(despesa("SUPERMERCADO BOM PREÇO"), categories, empty)).toEqual({
      categoryId: "m",
      newCategory: null,
      source: "palavra",
    });
    const salary = { description: "PAGTO SALÁRIO", kind: "receita" as const };
    expect(categorizeRow(salary, categories, empty).categoryId).toBe("s");
  });

  it("propõe criar a categoria que a família não tem", () => {
    expect(categorizeRow(despesa("IFOOD *RESTAURANTE"), categories, empty)).toEqual({
      categoryId: null,
      newCategory: { name: "Restaurantes", essential: false },
      source: "nova",
    });
    expect(categorizeRow(despesa("Seguro do carro"), categories, empty).newCategory).toEqual({
      name: "Seguros",
      essential: true,
    });
  });

  it("não cria categoria que já existe com outra grafia", () => {
    const own = [...categories, { id: "r", name: "RESTAURANTES", kind: "despesa" as const }];
    expect(categorizeRow(despesa("Pizzaria Exemplo"), own, empty).categoryId).toBe("r");
  });

  it("a memória da família vem antes das palavras", () => {
    const key = memoryKey("despesa", "supermercado");
    const learned = { history: new Map(), learned: new Map([[key, "l"]]) };
    expect(categorizeRow(despesa("Supermercado 123"), categories, learned)).toMatchObject({
      categoryId: "l",
      source: "memoria",
    });
  });

  it("o que a família mudou depois vence o que o agente guardou", () => {
    const key = memoryKey("despesa", "supermercado");
    const memory = { history: new Map([[key, "m"]]), learned: new Map([[key, "l"]]) };
    expect(categorizeRow(despesa("Supermercado"), categories, memory).categoryId).toBe("m");
  });

  it("ignora memória de categoria arquivada ou de outro tipo", () => {
    const key = memoryKey("despesa", "supermercado");
    const memory = { history: new Map([[key, "s"]]), learned: new Map([[key, "sumiu"]]) };
    expect(categorizeRow(despesa("Supermercado"), categories, memory)).toMatchObject({
      categoryId: "m",
      source: "palavra",
    });
  });

  it("sem pista, usa Outras e pede revisão", () => {
    expect(categorizeRow(despesa("XPTO"), categories, empty)).toMatchObject({
      categoryId: "o",
      source: "revisar",
    });
    const income = { description: "XPTO", kind: "receita" as const };
    expect(categorizeRow(income, categories, empty).categoryId).toBe("x");
  });
});

describe("relatório da importação", () => {
  it("resume o que o agente fez e o que a família corrigiu", () => {
    const row = { kind: "despesa" as const, amount: "10.00", category: "Mercado" };
    const report = importReport(
      [
        { ...row, source: "memoria", corrected: false },
        { ...row, source: "palavra", corrected: false },
        { ...row, source: "nova", corrected: false },
        { ...row, source: "revisar", corrected: true },
      ],
      ["Pets"],
      { start: "2026-10-01", end: "2026-10-31" },
    );
    expect(report.title).toBe("Extrato de 2026-10-01 a 2026-10-31");
    expect(report.summary).toBe(
      "4 lançamentos, 1 pela memória da família, 2 por palavras do extrato, 1 sem pista. Categorias criadas: Pets. A família corrigiu 1.",
    );
    expect(report.data.corrected).toBe(1);
  });
});
