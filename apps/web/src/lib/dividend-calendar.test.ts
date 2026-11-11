import { describe, expect, it } from "vitest";
import {
  entriesByDay,
  isYearMonth,
  monthChoices,
  monthGrid,
  type CalendarEvent,
} from "./dividend-calendar";

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: over.id ?? over.ticker ?? "x",
  ticker: "BTHF11",
  name: "BTG Hedge Fund",
  assetClass: "fii",
  kind: "rendimento",
  comDate: "2026-11-09",
  payDate: "2026-11-16",
  ratePerShare: "0.10100000",
  mine: false,
  quantity: null,
  amount: null,
  ...over,
});

describe("calendário de dividendos", () => {
  it("a grade começa no domingo anterior e tem seis semanas", () => {
    const grid = monthGrid("2026-11");
    expect(grid).toHaveLength(6);
    expect(grid[0]![0]).toEqual({ date: "2026-11-01", inMonth: true });
    expect(grid[5]![6]).toEqual({ date: "2026-12-12", inMonth: false });
    const march = monthGrid("2026-03");
    expect(march[0]![0]).toEqual({ date: "2026-03-01", inMonth: true });
    const feb = monthGrid("2026-02");
    expect(feb[0]![0]).toEqual({ date: "2026-02-01", inMonth: true });
    expect(feb[4]![0]).toEqual({ date: "2026-03-01", inMonth: false });
  });

  it("cada provento entra na data-com e no pagamento, só dentro do mês", () => {
    const days = entriesByDay(
      [event({ id: "a" }), event({ id: "b", ticker: "PETR4", comDate: "2026-10-30" })],
      "2026-11",
    );
    expect(days.get("2026-11-09")?.map((e) => [e.type, e.event.id])).toEqual([["com", "a"]]);
    expect(days.get("2026-11-16")?.map((e) => [e.type, e.event.id])).toEqual([
      ["pagamento", "a"],
      ["pagamento", "b"],
    ]);
    expect(days.has("2026-10-30")).toBe(false);
  });

  it("no mesmo dia: pagamentos antes das datas-com, os seus ativos primeiro", () => {
    const days = entriesByDay(
      [
        event({ id: "com-z", ticker: "ZZZZ11", comDate: "2026-11-16", payDate: "2026-11-30" }),
        event({ id: "pay-b" }),
        event({ id: "pay-a", ticker: "AAAA11", mine: true }),
      ],
      "2026-11",
    );
    expect(days.get("2026-11-16")?.map((e) => e.event.id)).toEqual(["pay-a", "pay-b", "com-z"]);
  });

  it("meses para escolher: dois anos para trás e três à frente", () => {
    const choices = monthChoices("2026-11-11");
    expect(choices[0]).toBe("2024-11");
    expect(choices.at(-1)).toBe("2027-02");
    expect(choices).toContain("2026-11");
  });

  it("aceita só ano-mês válido", () => {
    expect(isYearMonth("2026-11")).toBe(true);
    expect(isYearMonth("2026-13")).toBe(false);
    expect(isYearMonth(undefined)).toBe(false);
  });
});
