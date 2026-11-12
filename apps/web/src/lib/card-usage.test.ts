import { describe, expect, it } from "vitest";
import { axisTop, cardUsage, USAGE_AHEAD, USAGE_PAST } from "./card-usage";

const line = (statementMonth: string, amount: string) => ({ statementMonth, amount });

describe("uso do cartão mês a mês", () => {
  it("monta a janela em volta da fatura em aberto, com o estado de cada mês", () => {
    const usage = cardUsage([{ id: "a", lines: [], carried: {} }], "2026-11");
    expect(usage.points).toHaveLength(USAGE_PAST + 1 + USAGE_AHEAD);
    expect(usage.points[0]).toEqual({ month: "2026-03", total: "0.00", state: "fechada" });
    expect(usage.points[USAGE_PAST]).toEqual({ month: "2026-11", total: "0.00", state: "aberta" });
    expect(usage.points.at(-1)).toEqual({ month: "2027-02", total: "0.00", state: "futura" });
    expect(usage.average).toBeNull();
    expect(usage.change).toBeNull();
  });

  it("soma as faturas dos cartões e compara a em aberto com a anterior", () => {
    const usage = cardUsage(
      [
        {
          id: "a",
          lines: [line("2026-09", "100.00"), line("2026-10", "400.00"), line("2026-11", "450.00")],
          carried: {},
        },
        { id: "b", lines: [line("2026-10", "100.00"), line("2026-12", "80.00")], carried: {} },
      ],
      "2026-11",
    );
    const of = (month: string) => usage.points.find((point) => point.month === month)!.total;
    expect(of("2026-10")).toBe("500.00");
    expect(of("2026-11")).toBe("450.00");
    expect(of("2026-12")).toBe("80.00");
    // Média só das fechadas, a partir do primeiro mês com compra: setembro e outubro.
    expect(usage.average).toBe("300.00");
    expect(usage.change).toBe(-10);
  });

  it("o saldo de fatura paga em parte não conta como gasto do mês seguinte", () => {
    const usage = cardUsage(
      [
        {
          id: "a",
          lines: [line("2026-10", "700.00"), line("2026-11", "250.00"), line("2026-11", "90.00")],
          // Dos 700 de outubro, 250 foram para novembro como saldo.
          carried: { "2026-10": "250.00" },
        },
      ],
      "2026-11",
    );
    const of = (month: string) => usage.points.find((point) => point.month === month)!.total;
    expect(of("2026-10")).toBe("700.00");
    expect(of("2026-11")).toBe("90.00");
  });

  it("saldo sem a compra correspondente não deixa o mês negativo", () => {
    const usage = cardUsage(
      [{ id: "a", lines: [line("2026-10", "100.00")], carried: { "2026-10": "40.00" } }],
      "2026-11",
    );
    expect(usage.points.find((point) => point.month === "2026-11")!.total).toBe("0.00");
  });

  it("o eixo termina num número redondo que cobre o maior valor", () => {
    expect(axisTop(0)).toBe(0);
    expect(axisTop(87)).toBe(100);
    expect(axisTop(1552.2)).toBe(2000);
    expect(axisTop(2000)).toBe(2000);
    expect(axisTop(2300)).toBe(2500);
    expect(axisTop(4200)).toBe(5000);
    expect(axisTop(7200)).toBe(10000);
  });
});
