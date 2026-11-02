import { describe, expect, it } from "vitest";
import { cardLinesInFilter } from "./card-filter";

const lines = [
  { categoryId: "mercado", amount: "100.00" },
  { categoryId: "aportes", amount: "300.00" },
];
const savings = ["aportes"];

describe("compras de cartão no filtro de lançamentos", () => {
  it("o filtro Aportes mostra a compra de aporte que a fatura esconde", () => {
    expect(cardLinesInFilter(lines, { category: "", kind: "aporte" }, savings)).toEqual([lines[1]]);
  });

  it("o filtro Despesas mostra só as compras que são despesa", () => {
    expect(cardLinesInFilter(lines, { category: "", kind: "despesa" }, savings)).toEqual([]);
  });

  it("filtro por categoria continua como era", () => {
    expect(cardLinesInFilter(lines, { category: "mercado", kind: "" }, savings)).toEqual([
      lines[0],
    ]);
  });

  it("sem filtro, nada a abrir", () => {
    expect(cardLinesInFilter(lines, { category: "", kind: "" }, savings)).toEqual([]);
  });
});
