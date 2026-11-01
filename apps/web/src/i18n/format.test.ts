import { formatBRL, formatBRLCompact, formatMonthShort, formatYearMonth } from "@organizeup/domain";
import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatDate,
  formatDayMonth,
  formatDayName,
  formatInstant,
  formatLongDate,
  formatMonthAbbr,
  formatMonthYear,
  formatNumber,
  formatPercent,
  formatPercentExact,
  toFieldValue,
  toInputValue,
  formatWeekdayName,
  monthNames,
  toAmountInput,
  weekdayNames,
} from "./format";

const plain = (text: string) => text.replace(/\s/g, " ");

describe("datas, quantidades e campos no idioma da pessoa", () => {
  it("data completa em números", () => {
    expect(formatDate("2026-11-01", "pt-BR")).toBe("01/11/2026");
    expect(formatDate("2026-11-01", "en")).toBe("11/01/2026");
    expect(formatDate("2026-11-01", "es")).toBe("01/11/2026");
  });

  it("percentual com casas e quantidade", () => {
    expect(formatPercentExact(12.5, "pt-BR")).toBe("12,5%");
    expect(formatPercentExact(12.5, "en")).toBe("12.5%");
    expect(plain(formatPercentExact(12.5, "es"))).toBe("12,5 %");
    expect(formatNumber(1234.5, "pt-BR")).toBe("1.234,5");
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
  });

  it("valor volta ao campo como a pessoa digitaria", () => {
    expect(toInputValue("1234.50", "pt-BR")).toBe("1234,5");
    expect(toInputValue("1234.50", "en")).toBe("1234.5");
    expect(toInputValue("1234.50", "es")).toBe("1234,5");
    expect(toFieldValue("500.00", "pt-BR")).toBe("500,00");
    expect(toFieldValue("500.00", "en")).toBe("500.00");
    expect(toFieldValue(null, "en")).toBe("");
  });
});

describe("em português nada muda", () => {
  it("datas e meses dão o texto de sempre", () => {
    expect(formatMonthYear("2026-10", "pt-BR")).toBe(formatYearMonth("2026-10"));
    expect(formatMonthAbbr("2026-10", "pt-BR")).toBe(formatMonthShort("2026-10"));
    expect(formatDayMonth("2026-10-05", "pt-BR")).toBe("05/10");
    expect(formatLongDate("2026-11-01", "pt-BR")).toBe("1 de novembro de 2026");
    expect(formatInstant(new Date(2026, 10, 1, 12), "pt-BR")).toBe(
      new Date(2026, 10, 1, 12).toLocaleDateString("pt-BR"),
    );
  });

  it("dinheiro dá o texto de formatBRL", () => {
    expect(formatAmount("1234.5", "pt-BR")).toBe(formatBRL("1234.5"));
    expect(formatAmount("8000", "pt-BR", "compact")).toBe(formatBRLCompact("8000"));
  });

  it("percentual dá o texto de sempre", () => {
    expect(formatPercent(12, "pt-BR")).toBe("12%");
    expect(formatPercent(100, "pt-BR")).toBe("100%");
  });

  it("calendário e formulários dão o texto de sempre", () => {
    expect(formatDate("2026-10-30", "pt-BR")).toBe("30/10/2026");
    expect(formatDayName("2026-11-05", "pt-BR")).toBe("5 de novembro");
    expect(formatWeekdayName("2026-11-05", "pt-BR")).toBe("quinta-feira, 5 de novembro");
    expect(weekdayNames("pt-BR")).toEqual(["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]);
    expect(monthNames("pt-BR").slice(0, 3)).toEqual(["Janeiro", "Fevereiro", "Março"]);
    expect(toAmountInput("1234.56", "pt-BR")).toBe("1234,56");
  });
});

describe("semana e campos em inglês e espanhol", () => {
  it("a semana começa no domingo em todos os idiomas", () => {
    expect(weekdayNames("en")[0]).toBe("Sun");
    expect(weekdayNames("es")).toEqual(["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]);
  });

  it("datas e meses seguem o idioma", () => {
    expect(formatDate("2026-10-30", "en")).toBe("10/30/2026");
    expect(formatWeekdayName("2026-11-05", "es")).toBe("jueves, 5 de noviembre");
    expect(monthNames("en")[11]).toBe("December");
    expect(monthNames("es")[0]).toBe("Enero");
  });

  it("campo de valor vem com o decimal do idioma", () => {
    expect(toAmountInput("1234.56", "en")).toBe("1234.56");
    expect(toAmountInput("1234.56", "es")).toBe("1234,56");
  });
});

describe("em inglês e espanhol", () => {
  it("datas seguem o idioma, sem mudar de dia", () => {
    expect(formatLongDate("2026-11-01", "en")).toBe("November 1, 2026");
    expect(formatLongDate("2026-11-01", "es")).toBe("1 de noviembre de 2026");
    expect(formatDayMonth("2026-10-05", "en")).toBe("10/05");
    expect(formatMonthYear("2026-10", "en")).toBe("October 2026");
    expect(formatMonthYear("2026-10", "es")).toBe("octubre de 2026");
    expect(formatMonthAbbr("2026-10", "en")).toBe("Oct");
    expect(formatMonthAbbr("2026-10", "es")).toBe("oct");
  });

  it("dinheiro segue o idioma e continua em reais", () => {
    expect(plain(formatAmount("1234.5", "en"))).toBe("R$1,234.50");
    expect(plain(formatAmount("12345.5", "es"))).toBe("12.345,50 R$");
  });

  it("percentual segue o idioma", () => {
    expect(formatPercent(12, "en")).toBe("12%");
    expect(plain(formatPercent(12, "es"))).toBe("12 %");
  });
});
