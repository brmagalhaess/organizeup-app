// Terceira rodada da revisão da importação de proventos (ADR-0029). Cada caso reprovava antes da correção.
import { describe, expect, it } from "vitest";
import {
  answeredByImport,
  importedDividendId,
  parseDividendFile,
  reconcileProventos,
  TICKER_IN_TEXT,
  type ExistingDividend,
  type MarketProvento,
  type TradeInput,
} from "../src";

const csv = (text: string) => parseDividendFile({ format: "csv", text });

const trades: TradeInput[] = [
  { side: "compra", occurredOn: "2026-01-05", quantity: "100", unitPrice: "10", fees: "0" },
];
const event = (id: string, payDate: string, rate: string, comDate = "2026-02-20") => ({
  id,
  kind: "dividendo" as const,
  payDate,
  comDate,
  ratePerShare: rate,
});
const imported = (n: number, paidOn: string, gross: string): ExistingDividend => ({
  id: importedDividendId(`0000-${n}`),
  kind: "dividendo",
  paidOn,
  gross,
  withheld: "0.00",
  source: "familia",
  marketDividendId: null,
});
const created = (events: MarketProvento[], existing: ExistingDividend[], today?: string) =>
  reconcileProventos({
    assetClass: "acao",
    trades,
    events,
    existing,
    blocked: new Set(),
    ...(today ? { today } : {}),
  }).create.map((entry) => entry.marketDividendId);

describe("1. provento futuro", () => {
  it("valor exato, sem pago que cubra: responde igual em qualquer dia do job", () => {
    const events = [event("A", "2026-11-01", "0.5")];
    const line = imported(1, "2026-10-30", "50.00");
    expect(created(events, [line], "2026-10-31")).toEqual([]);
    expect(created(events, [line], "2026-11-03")).toEqual([]);
  });

  it("valor diferente segue de fora enquanto não for pago", () => {
    const events = [event("A", "2026-03-14", "1")];
    expect(created(events, [imported(1, "2026-03-10", "90.00")], "2026-03-11")).toEqual(["A"]);
  });

  it("provento já pago que cobre o grupo vence, e o futuro entra", () => {
    const events = [event("A", "2026-03-10", "1"), event("B", "2026-03-14", "1", "2026-02-25")];
    expect(created(events, [imported(1, "2026-03-10", "100.00")], "2026-03-11")).toEqual(["B"]);
  });

  it("pago por valor parecido em outra data também cobre, e o exato futuro fica", () => {
    const events = [event("A", "2026-03-09", "0.9"), event("B", "2026-03-12", "1", "2026-02-25")];
    expect(created(events, [imported(1, "2026-03-10", "100.00")], "2026-03-11")).toEqual(["B"]);
  });
});

describe("2. grupos em dias diferentes", () => {
  it("60 em 10/03 + 40 em 11/03 contra 100 em 12/03 não cria outra", () => {
    const lines = [imported(1, "2026-03-10", "60.00"), imported(2, "2026-03-11", "40.00")];
    expect(created([event("A", "2026-03-12", "1")], lines)).toEqual([]);
  });

  it("soma que não fecha não reivindica", () => {
    const lines = [imported(1, "2026-03-10", "60.00"), imported(2, "2026-03-11", "30.00")];
    expect(created([event("A", "2026-03-12", "1")], lines)).toEqual(["A"]);
  });

  it("grupo fora da janela não entra na soma", () => {
    const lines = [imported(1, "2026-03-02", "60.00"), imported(2, "2026-03-11", "40.00")];
    expect(created([event("A", "2026-03-12", "1")], lines)).toEqual(["A"]);
  });

  it("valor único mantém a folga de 20%", () => {
    const events = [event("A", "2026-03-11", "1")];
    expect(created(events, [imported(1, "2026-03-10", "120.00")])).toEqual([]);
    expect(created(events, [imported(1, "2026-03-10", "125.00")])).toEqual(["A"]);
  });
});

describe("3. código com dígito em texto", () => {
  it("acha os códigos da B3 e nada mais", () => {
    for (const text of ["em B3SA3 hoje", "M1TA34.", "PETR4 subiu", "5GTK11", "PETR4F"]) {
      expect(TICKER_IN_TEXT.test(text), text).toBe(true);
    }
    for (const text of ["CPF123", "ANA12 chegou", "em 2026", "ABCD"]) {
      expect(TICKER_IN_TEXT.test(text), text).toBe(false);
    }
  });
});

describe("4. vírgula como separador", () => {
  it("valor inteiro seguido de dois dígitos invalida, mesmo com coluna à direita", () => {
    for (const text of [
      "Data,Ativo,Tipo,Valor,Obs\n15/03/2026,ABCD3,Dividendo,150,75\n",
      "Data,Ativo,Tipo,Valor,Obs\n15/03/2026,ABCD3,Dividendo,150,75,\n",
    ]) {
      const parsed = csv(text);
      expect(parsed.rows).toEqual([]);
      expect(parsed.ignored.map((line) => line.reason)).toEqual(["dados_invalidos"]);
    }
  });

  it("colunas de valor vizinhas, em inteiros, seguem valendo", () => {
    const parsed = csv("Data,Ativo,Tipo,Bruto,IR,Liquido\n15/03/2026,ABCD3,JCP,100,15,85\n");
    expect(parsed.rows[0]).toMatchObject({ gross: "100.00", withheld: "15.00", net: "85.00" });
  });

  it("com ponto e vírgula, ou com centavos na própria célula, a linha segue", () => {
    expect(csv("Data;Ativo;Tipo;Valor;Obs\n15/03/2026;ABCD3;Dividendo;150;75\n").rows).toHaveLength(
      1,
    );
    const dotted = csv("Data,Ativo,Tipo,Valor,Obs\n15/03/2026,ABCD3,Dividendo,150.75,12\n");
    expect(dotted.rows[0]!.net).toBe("150.75");
    const text = csv("Data,Ativo,Tipo,Valor,Obs\n15/03/2026,ABCD3,Dividendo,150,ok\n");
    expect(text.rows[0]!.net).toBe("150.00");
  });
});

describe("5. título com a palavra pagamento", () => {
  it("forma e status do pagamento não viram data", () => {
    const forma = csv(
      "Data;Ativo;Tipo;Valor;Forma de pagamento\n15/03/2026;ABCD3;Dividendo;10,00;Pix\n",
    );
    expect(forma.rows[0]!.paidOn).toBe("2026-03-15");
    const status = csv(
      "Status do pagamento;Data;Ativo;Tipo;Valor\nPago;15/03/2026;ABCD3;Dividendo;10,00\n",
    );
    expect(status.rows[0]!.paidOn).toBe("2026-03-15");
  });

  it("pagamento sozinho, ou data de pagamento, seguem valendo", () => {
    const alone = csv("Pagamento;Ativo;Tipo;Valor\n15/03/2026;ABCD3;Dividendo;10,00\n");
    expect(alone.rows[0]!.paidOn).toBe("2026-03-15");
  });
});

describe("6. Desfazer ao lado da importada", () => {
  const entry = (gross: string, paidOn = "2026-03-10") => ({
    kind: "dividendo" as const,
    paidOn,
    gross,
  });

  it("mesmo dia exige valor parecido", () => {
    expect(answeredByImport(entry("30.00"), [imported(1, "2026-03-10", "50.00")])).toBe(false);
    expect(answeredByImport(entry("50.00"), [imported(1, "2026-03-10", "50.00")])).toBe(true);
  });

  it("cada importada responde por um só", () => {
    const used = new Set<string>();
    const rows = [imported(1, "2026-03-10", "50.00")];
    expect(answeredByImport(entry("50.00"), rows, used)).toBe(true);
    expect(answeredByImport(entry("50.00"), rows, used)).toBe(false);
  });

  it("duas corretoras no mesmo dia respondem juntas por um pagamento", () => {
    const rows = [imported(1, "2026-03-10", "30.00"), imported(2, "2026-03-10", "20.00")];
    const used = new Set<string>();
    expect(answeredByImport(entry("50.00"), rows, used)).toBe(true);
    expect(used.size).toBe(2);
  });
});
