import { describe, expect, it } from "vitest";
import { distributeContribution, money } from "../src/index";

const classes = [
  { assetClass: "acao", value: "6000.00", target: 50 },
  { assetClass: "fii", value: "2000.00", target: 30 },
  { assetClass: "renda_fixa", value: "2000.00", target: 20 },
];

describe("divisão do aporte", () => {
  it("vai só para o que está abaixo da meta", () => {
    expect(distributeContribution(classes, "2000.00")).toEqual({
      rows: [
        { assetClass: "fii", amount: "1600.00" },
        { assetClass: "renda_fixa", amount: "400.00" },
      ],
      leftover: "0.00",
    });
  });

  it("aporte pequeno divide em proporção ao que falta", () => {
    const { rows, leftover } = distributeContribution(classes, "100.00");
    const total = rows.reduce((acc, row) => acc.plus(row.amount), money(0));
    expect(total.toFixed(2)).toBe("100.00");
    expect(leftover).toBe("0.00");
    expect(money(rows[0]!.amount).gt(rows[1]!.amount)).toBe(true);
  });

  it("classe sem meta fica de fora e o resto sobra", () => {
    const plan = distributeContribution(
      [
        { assetClass: "acao", value: "1000.00", target: 100 },
        { assetClass: "outro", value: "9000.00", target: null },
      ],
      "500.00",
    );
    expect(plan.rows).toEqual([{ assetClass: "acao", amount: "500.00" }]);
  });

  it("sem classe abaixo da meta, sobra tudo", () => {
    const plan = distributeContribution(
      [{ assetClass: "acao", value: "1000.00", target: null }],
      "500.00",
    );
    expect(plan).toEqual({ rows: [], leftover: "500.00" });
  });
});
