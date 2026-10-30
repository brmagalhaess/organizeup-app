import { describe, expect, it } from "vitest";
import {
  eventsInMonth,
  groupCalendarItems,
  lowestBalance,
  monthCells,
  projectDailyBalance,
} from "../src/calendar";
import type { MonthEntry } from "../src/cashflow";

const entry = (over: Partial<MonthEntry> = {}): MonthEntry => ({
  key: "p:1",
  source: "previsao",
  id: "1",
  kind: "despesa",
  description: "Aluguel",
  amount: "1000.00",
  date: "2026-11-10",
  status: "previsto",
  categoryId: "c",
  accountId: "a",
  recurring: true,
  ...over,
});

describe("grade do mês", () => {
  it("começa no domingo", () => {
    // 01/11/2026 é domingo; 01/10/2026 é quinta.
    expect(monthCells("2026-11").leading).toBe(0);
    expect(monthCells("2026-10").leading).toBe(4);
  });

  it("tem todos os dias do mês", () => {
    expect(monthCells("2026-02").days).toHaveLength(28);
    expect(monthCells("2028-02").days).toHaveLength(29);
    expect(monthCells("2026-10").days.at(-1)).toBe("2026-10-31");
  });
});

describe("compromissos", () => {
  const event = { id: "e", title: "Dentista", eventDate: "2026-11-15", yearly: false };

  it("evento único aparece só no mês dele", () => {
    expect(eventsInMonth([event], "2026-11")).toHaveLength(1);
    expect(eventsInMonth([event], "2027-11")).toHaveLength(0);
  });

  it("evento anual repete, mas não antes de começar", () => {
    const birthday = { ...event, title: "Aniversário", yearly: true };
    expect(eventsInMonth([birthday], "2030-11")[0]!.date).toBe("2030-11-15");
    expect(eventsInMonth([birthday], "2025-11")).toHaveLength(0);
    expect(eventsInMonth([birthday], "2030-10")).toHaveLength(0);
  });

  it("29 de fevereiro cai em 28 nos outros anos", () => {
    const leap = { ...event, eventDate: "2028-02-29", yearly: true };
    expect(eventsInMonth([leap], "2029-02")[0]!.date).toBe("2029-02-28");
  });
});

describe("itens do dia", () => {
  it("agrupa por dia, com compromissos antes do dinheiro", () => {
    const days = groupCalendarItems(
      [entry()],
      [{ id: "e", title: "Dentista", date: "2026-11-10", yearly: false }],
      [{ id: "k", name: "Cartão", closingDay: 25 }],
      "2026-11",
    );
    expect(days["2026-11-10"]!.map((item) => item.type)).toEqual(["compromisso", "lancamento"]);
    expect(days["2026-11-25"]![0]).toMatchObject({ type: "fechamento", title: "Fecha Cartão" });
  });

  it("fechamento no dia 31 cai no fim dos meses curtos", () => {
    const days = groupCalendarItems([], [], [{ id: "k", name: "C", closingDay: 31 }], "2026-11");
    expect(days["2026-11-30"]).toHaveLength(1);
  });
});

describe("saldo previsto", () => {
  const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"];

  it("começa hoje e acumula o que está em aberto", () => {
    expect(
      projectDailyBalance(
        "2000.00",
        "2026-11-10",
        [
          entry({ date: "2026-11-11" }),
          entry({ date: "2026-11-12", kind: "receita", amount: "50.00" }),
        ],
        days,
      ),
    ).toEqual({
      "2026-11-10": "2000.00",
      "2026-11-11": "1000.00",
      "2026-11-12": "1050.00",
    });
  });

  it("o que está atrasado sai hoje", () => {
    const result = projectDailyBalance(
      "2000.00",
      "2026-11-10",
      [entry({ date: "2026-10-01" })],
      days,
    );
    expect(result["2026-11-10"]).toBe("1000.00");
  });

  it("no mês futuro conta o que vence antes dele", () => {
    const result = projectDailyBalance(
      "2000.00",
      "2026-11-10",
      [entry({ date: "2026-11-20" })],
      ["2026-12-01"],
    );
    expect(result["2026-12-01"]).toBe("1000.00");
  });

  it("mês passado não tem previsão", () => {
    expect(projectDailyBalance("2000.00", "2026-11-10", [], ["2026-10-01"])).toEqual({});
  });

  it("acha o dia de menor saldo", () => {
    expect(
      lowestBalance({ "2026-11-10": "100.00", "2026-11-11": "-50.00", "2026-11-12": "-50.00" }),
    ).toEqual({ date: "2026-11-11", balance: "-50.00" });
    expect(lowestBalance({})).toBeNull();
  });
});
