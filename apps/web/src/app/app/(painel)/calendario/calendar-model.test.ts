import { describe, expect, it } from "vitest";
import { monthCells, type CalendarItem } from "@organizeup/domain";
import {
  countByType,
  dayMarks,
  filterDays,
  firstNegativeDay,
  initialDay,
  isOverdue,
  itemHref,
  neighborDays,
} from "./calendar-model";

const bill: CalendarItem = {
  type: "lancamento",
  key: "p:1",
  date: "2026-11-05",
  title: "Aluguel",
  amount: "100.00",
  kind: "despesa",
  status: "previsto",
  source: "previsao",
};
const invoice: CalendarItem = { ...bill, key: "f:1:2026-11", source: "fatura", title: "Fatura" };
const event: CalendarItem = {
  type: "compromisso",
  key: "e:1:2026-11-05",
  id: "1",
  date: "2026-11-05",
  title: "Dentista",
  yearly: false,
};
const items = { "2026-11-05": [event, bill, invoice], "2026-11-09": [bill] };
const types = {
  "p:1": "conta",
  "f:1:2026-11": "cartao",
  "e:1:2026-11-05": "evento",
} as const;

describe("filtro por tipo", () => {
  it("conta cada tipo e mantém só o escolhido", () => {
    const counts = countByType(items, types);
    expect(counts.conta).toBe(2);
    expect(counts.cartao).toBe(1);
    expect(counts.viagem).toBe(0);
    expect(filterDays(items, types, "todos")).toBe(items);
    expect(Object.keys(filterDays(items, types, "cartao"))).toEqual(["2026-11-05"]);
    expect(filterDays(items, types, "cartao")["2026-11-05"]).toEqual([invoice]);
  });

  it("mostra uma marca por tipo", () => {
    expect(dayMarks([bill, bill, event], types)).toEqual(["conta", "evento"]);
  });
});

describe("grade do mês", () => {
  it("abre em hoje, no primeiro dia com algo ou no dia 1", () => {
    const cells = monthCells("2026-11");
    const base = { month: "2026-11", cells, items };
    expect(initialDay({ ...base, today: "2026-11-20" })).toBe("2026-11-20");
    expect(initialDay({ ...base, today: "2026-10-20" })).toBe("2026-11-05");
    expect(initialDay({ ...base, today: "2026-10-20", items: {} })).toBe("2026-11-01");
  });

  it("completa as semanas com os dias vizinhos", () => {
    // Fevereiro de 2026 começa no domingo e tem 28 dias: grade exata.
    expect(neighborDays(monthCells("2026-02"), "2026-02")).toEqual({ before: [], after: [] });
    // Dezembro de 2026 começa na terça e termina na quinta.
    expect(neighborDays(monthCells("2026-12"), "2026-12")).toEqual({
      before: [29, 30],
      after: [1, 2],
    });
  });
});

describe("avisos e destinos", () => {
  it("acha o primeiro dia negativo", () => {
    expect(firstNegativeDay({ "2026-11-02": "10.00", "2026-11-01": "5.00" })).toBeNull();
    expect(
      firstNegativeDay({
        "2026-11-03": "-1.00",
        "2026-11-02": "-0.01",
        "2026-11-01": "5.00",
      }),
    ).toBe("2026-11-02");
  });

  it("só o que está em aberto e passou da data fica atrasado", () => {
    expect(isOverdue(bill, "2026-11-06")).toBe(true);
    expect(isOverdue(bill, "2026-11-05")).toBe(false);
    expect(isOverdue({ ...bill, status: "realizado" }, "2026-11-06")).toBe(false);
  });

  it("leva cada tipo para a sua tela", () => {
    expect(itemHref(invoice, "cartao")).toBe("/app/cartoes");
    expect(itemHref(bill, "conta")).toBe("/app/lancamentos?m=2026-11");
    expect(itemHref({ ...bill, source: "renda" }, "receita")).toBe("/app/renda");
    expect(itemHref(event, "evento")).toBeNull();
    expect(itemHref(event, "viagem")).toBe("/app/viagens");
  });
});
