import { describe, expect, it } from "vitest";
import { debtShare, netWorthChange, netWorthParts } from "./net-worth-view";

describe("contas da tela de patrimônio", () => {
  it("divide o que a pessoa tem em fatias que somam 100", () => {
    const parts = netWorthParts({
      accounts: "15000.00",
      investments: "60000.00",
      assets: "420000.00",
      goals: "5000.00",
    });
    expect(parts.map((part) => [part.key, part.percent])).toEqual([
      ["accounts", 3],
      ["investments", 12],
      ["assets", 84],
      ["goals", 1],
    ]);
  });

  it("conta negativa não ganha fatia, e o valor dela continua aparecendo", () => {
    const parts = netWorthParts({
      accounts: "-200.00",
      investments: "750.00",
      assets: "0.00",
      goals: "250.00",
    });
    expect(parts[0]).toEqual({ key: "accounts", value: "-200.00", percent: 0 });
    expect(parts[1]!.percent).toBe(75);
    expect(parts[3]!.percent).toBe(25);
  });

  it("sem nada, todas as fatias são zero", () => {
    const zero = { accounts: "0.00", investments: "0.00", assets: "0.00", goals: "0.00" };
    expect(netWorthParts(zero).every((part) => part.percent === 0)).toBe(true);
  });

  it("compara com a foto mais recente de um mês anterior", () => {
    const history = [
      { month: "2026-09", net: "90000.00" },
      { month: "2026-10", net: "100000.00" },
      // A foto do mês atual é a de hoje: não serve de comparação.
      { month: "2026-11", net: "104000.00" },
    ];
    expect(netWorthChange(history, "2026-11", "105500.00")).toEqual({
      month: "2026-10",
      amount: "5500.00",
      direction: "subiu",
    });
    expect(netWorthChange(history, "2026-11", "99000.00")).toMatchObject({
      amount: "-1000.00",
      direction: "caiu",
    });
    expect(netWorthChange(history, "2026-11", "100000.00")?.direction).toBe("igual");
    expect(netWorthChange([{ month: "2026-11", net: "1.00" }], "2026-11", "1.00")).toBeNull();
    expect(netWorthChange([], "2026-11", "1.00")).toBeNull();
  });

  it("mostra o peso do que a pessoa deve sobre o que ela tem", () => {
    expect(debtShare("200000.00", "50000.00")).toBe(25);
    expect(debtShare("200000.00", "0.00")).toBe(0);
    // Deve mais do que tem: não há percentual que faça sentido.
    expect(debtShare("1000.00", "1500.00")).toBeNull();
    expect(debtShare("0.00", "10.00")).toBeNull();
  });
});
