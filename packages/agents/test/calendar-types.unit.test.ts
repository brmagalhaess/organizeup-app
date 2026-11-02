import { describe, expect, it } from "vitest";
import type { CalendarItem } from "@organizeup/domain";
import { calendarItemType, type CalendarTypeContext } from "../src/calendar-types";

const context: CalendarTypeContext = {
  categoryOf: new Map([
    ["t:fatura", "cat-cartao"],
    ["t:divida", "cat-divida"],
    ["t:meta", "cat-meta"],
    ["t:meta-espelho", "cat-meta-receita"],
    ["t:aporte", "cat-aporte"],
    ["t:mercado", "cat-mercado"],
    ["t:salario", "cat-salario"],
  ]),
  system: {
    card: "cat-cartao",
    debt: "cat-divida",
    goal: "cat-meta",
    goalIncome: "cat-meta-receita",
    contribution: "cat-aporte",
  },
  tripEvents: new Set(["viagem-1"]),
};

const entry = (
  key: string,
  source: "lancamento" | "previsao" | "parcela" | "fatura" | "renda" | "meta",
  kind: "receita" | "despesa" = "despesa",
): CalendarItem => ({
  type: "lancamento",
  key,
  date: "2026-11-05",
  title: "Item",
  amount: "10.00",
  kind,
  status: source === "lancamento" ? "realizado" : "previsto",
  source,
});

describe("calendarItemType", () => {
  it("usa a origem do que ainda está previsto", () => {
    expect(calendarItemType(entry("f:c:2026-11", "fatura"), context)).toBe("cartao");
    expect(calendarItemType(entry("d:1", "parcela"), context)).toBe("divida");
    expect(calendarItemType(entry("g:1:2026-11", "meta"), context)).toBe("meta");
    expect(calendarItemType(entry("r:1:2026-11:mensal", "renda", "receita"), context)).toBe(
      "receita",
    );
    expect(calendarItemType(entry("p:1", "previsao"), context)).toBe("conta");
  });

  it("reconhece pela categoria o que já foi pago", () => {
    expect(calendarItemType(entry("t:fatura", "lancamento"), context)).toBe("cartao");
    expect(calendarItemType(entry("t:divida", "lancamento"), context)).toBe("divida");
    expect(calendarItemType(entry("t:meta", "lancamento"), context)).toBe("meta");
    expect(calendarItemType(entry("t:meta-espelho", "lancamento", "receita"), context)).toBe(
      "meta",
    );
    expect(calendarItemType(entry("t:mercado", "lancamento"), context)).toBe("conta");
    expect(calendarItemType(entry("t:aporte", "lancamento"), context)).toBe("aporte");
    expect(calendarItemType(entry("t:salario", "lancamento", "receita"), context)).toBe("receita");
  });

  it("não confunde categoria ausente com categoria do sistema", () => {
    const empty: CalendarTypeContext = { ...context, system: {} };
    expect(calendarItemType(entry("t:sem-categoria", "lancamento"), empty)).toBe("conta");
  });

  it("separa viagem de evento comum e leva o fechamento ao cartão", () => {
    const event = (id: string): CalendarItem => ({
      type: "compromisso",
      key: `e:${id}:2026-11-05`,
      id,
      date: "2026-11-05",
      title: "Item",
      yearly: false,
    });
    expect(calendarItemType(event("viagem-1"), context)).toBe("viagem");
    expect(calendarItemType(event("outro"), context)).toBe("evento");
    expect(
      calendarItemType(
        { type: "fechamento", key: "c:1", date: "2026-11-05", title: "Fecha" },
        context,
      ),
    ).toBe("cartao");
  });
});
