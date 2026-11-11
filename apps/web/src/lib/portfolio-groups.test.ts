import { describe, expect, it } from "vitest";
import { groupByClass } from "./portfolio-groups";

const rows = [
  { id: "a", assetClass: "acao", value: "300.00", position: { cost: "250.00" } },
  { id: "b", assetClass: "fii", value: "1500.00", position: { cost: "1480.00" } },
  { id: "c", assetClass: "acao", value: "200.00", position: { cost: "210.00" } },
];

describe("carteira por tipo", () => {
  it("ordena os tipos e os ativos do maior para o menor", () => {
    const groups = groupByClass(rows);
    expect(groups.map((g) => g.assetClass)).toEqual(["fii", "acao"]);
    expect(groups[1]!.rows.map((r) => r.row.id)).toEqual(["a", "c"]);
  });

  it("fatia do tipo e do ativo sobre a carteira somam 100", () => {
    const groups = groupByClass(rows);
    expect(groups.map((g) => g.percent)).toEqual([75, 25]);
    expect(groups[1]).toMatchObject({ value: "500.00", cost: "460.00" });
    expect(groups[1]!.rows.map((r) => r.percent)).toEqual([15, 10]);
  });

  it("fatia dentro do tipo é a barra: soma 100 no cartão", () => {
    const [, acoes] = groupByClass(rows);
    expect(acoes!.rows.map((r) => r.inClass)).toEqual([60, 40]);
  });

  it("arredonda a uma casa", () => {
    const groups = groupByClass([
      { assetClass: "acao", value: "1.00" },
      { assetClass: "fii", value: "2.00" },
    ]);
    expect(groups.map((g) => g.percent)).toEqual([66.7, 33.3]);
  });

  it("carteira zerada não divide por zero", () => {
    const groups = groupByClass([{ assetClass: "acao", value: "0.00" }]);
    expect(groups[0]).toMatchObject({ percent: 0 });
    expect(groups[0]!.rows[0]).toMatchObject({ percent: 0, inClass: 0 });
  });
});
