// Casos da revisão independente da importação de proventos (ADR-0029). Cada um reprovava antes da correção.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  amountsProblem,
  answeredByImport,
  cameFromFile,
  dividendsToWrite,
  importedDividendId,
  isCalendarDate,
  parseDividendFile,
  planDividendImport,
  reconcileProventos,
  toDbAmount,
  money,
  type DividendHolding,
  type ExistingDividend,
  type MarketProvento,
  type ParsedDividend,
  type PlannedDividend,
  type TradeInput,
} from "../src";

const csv = (text: string) => parseDividendFile({ format: "csv", text });

const row = (over: Partial<ParsedDividend> = {}): ParsedDividend => ({
  line: 1,
  ticker: "ABCD3",
  kind: "dividendo",
  paidOn: "2026-03-10",
  gross: null,
  withheld: null,
  net: "50.00",
  ...over,
});
const auto = (over: Partial<ExistingDividend> = {}): ExistingDividend => ({
  id: "d1",
  kind: "dividendo",
  paidOn: "2026-03-10",
  gross: "95.00",
  withheld: "0.00",
  source: "agente",
  marketDividendId: "m1",
  ...over,
});
const holding = (dividends: ExistingDividend[] = []): DividendHolding => ({
  id: "inv-1",
  name: "ABCD",
  ticker: "ABCD3",
  assetClass: "acao",
  dividends,
});
const plan = (rows: ParsedDividend[], dividends: ExistingDividend[] = []) =>
  planDividendImport({ rows, holdings: [holding(dividends)], events: [], today: "2026-11-02" });
const seen = (rows: PlannedDividend[]) =>
  rows.map(({ line, state, doubtReason }) => ({ line, state, doubtReason }));

describe("1. linhas que disputam um automático de outro valor", () => {
  const lines = [row({ net: "60.00" }), row({ line: 2, net: "40.00" })];

  it("a segunda linha também fica para conferir, sem trocar nada", () => {
    expect(plan(lines, [auto()]).map((item) => [item.state, item.replaces])).toEqual([
      ["conferir", "d1"],
      ["conferir", null],
    ]);
  });

  it("automático 95, arquivo 60 + 40: nunca grava 135", () => {
    const planned = plan(lines, [auto()]);
    const sum = (selected: number[]) => {
      const writing = dividendsToWrite(planned, new Set(selected), seen(planned));
      const replaced = writing.some((item) => item.replaces === "d1");
      return writing.reduce(
        (total, item) => total.plus(item.amounts!.gross),
        money(replaced ? 0 : 95),
      );
    };
    for (const selected of [[], [1], [2], [1, 2]]) {
      expect(sum(selected).eq(135), String(selected)).toBe(false);
    }
    expect(sum([1, 2]).toFixed(2)).toBe("100.00");
    expect(sum([2]).toFixed(2)).toBe("95.00");
  });

  it("lançamento à mão por perto também segura a linha que sobrou", () => {
    const manual = auto({ source: "familia", marketDividendId: null });
    expect(plan(lines, [manual]).map((item) => item.state)).toEqual(["conferir", "conferir"]);
  });

  it("a linha traz o valor de hoje, para a tela mostrar os dois", () => {
    expect(plan(lines, [auto()])[0]!.current).toEqual({
      gross: "95.00",
      withheld: "0.00",
      net: "95.00",
    });
  });
});

describe("2. reivindicação da linha importada", () => {
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
  const created = (
    events: MarketProvento[],
    existing: ExistingDividend[],
    blocked: string[] = [],
    today?: string,
  ) =>
    reconcileProventos({
      assetClass: "acao",
      trades,
      events,
      existing,
      blocked: new Set(blocked),
      ...(today ? { today } : {}),
    }).create.map((entry) => entry.marketDividendId);

  it("duas corretoras no mesmo dia cobrem um provento e deixam o outro entrar", () => {
    const events = [event("A", "2026-03-10", "1"), event("B", "2026-03-13", "0.5", "2026-02-25")];
    const lines = [imported(1, "2026-03-10", "60.00"), imported(2, "2026-03-10", "40.00")];
    expect(created(events, lines)).toEqual(["B"]);
  });

  it("o provento da semana seguinte não some por sobrar linha", () => {
    const events = [event("A", "2026-03-10", "1"), event("B", "2026-03-14", "0.5", "2026-02-25")];
    const lines = [imported(1, "2026-03-10", "50.00"), imported(2, "2026-03-10", "50.00")];
    expect(created(events, lines)).toEqual(["B"]);
  });

  it("uma linha que soma dois pagamentos do dia cobre os dois", () => {
    const events = [event("A", "2026-03-10", "0.6"), event("B", "2026-03-10", "0.4", "2026-02-21")];
    expect(created(events, [imported(1, "2026-03-10", "100.00")])).toEqual([]);
  });

  it("bloqueado e sem posição não contam: a linha fica com o que ainda vale", () => {
    const blocked = [event("A", "2026-03-10", "1"), event("B", "2026-03-12", "0.5", "2026-02-25")];
    expect(created(blocked, [imported(1, "2026-03-10", "50.00")], ["A"])).toEqual([]);
    const noPosition = [
      event("A", "2026-03-10", "1", "2025-12-20"),
      event("B", "2026-03-12", "0.5", "2026-02-25"),
    ];
    expect(created(noPosition, [imported(1, "2026-03-10", "50.00")])).toEqual([]);
  });

  it("data do arquivo diferente da fonte: o valor decide, sem duplicar nem engolir", () => {
    const events = [event("A", "2026-03-10", "1"), event("B", "2026-03-16", "0.5", "2026-02-25")];
    // Dia 14 fica mais perto de B, mas o valor é o de A.
    expect(created(events, [imported(1, "2026-03-14", "100.00")])).toEqual(["B"]);
    // Quantidade um pouco diferente, em outra data, ainda é o mesmo pagamento.
    expect(created([events[0]!], [imported(1, "2026-03-12", "95.00")])).toEqual([]);
    // Valor bem diferente, em outra data, é outro pagamento.
    expect(created([events[1]!], [imported(1, "2026-03-12", "100.00")])).toEqual(["B"]);
  });

  it("propriedade: o arquivo responde pelo que traz, inteiro ou por corretora, e o resto entra", () => {
    const start = Date.UTC(2026, 2, 2);
    const dayOf = (index: number) =>
      new Date(start + index * 7 * 86_400_000).toISOString().slice(0, 10);
    const fact = fc.record({
      rate: fc.integer({ min: 2, max: 300 }).map((value) => (value / 100).toFixed(2)),
      imported: fc.boolean(),
      split: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(fact, { minLength: 1, maxLength: 8 }), (facts) => {
        const events = facts.map((item, index) =>
          event(`m${index}`, dayOf(index), item.rate, "2026-02-01"),
        );
        const rows = facts.flatMap((item, index) => {
          if (!item.imported) return [];
          const total = money(item.rate).times(100);
          if (!item.split) return [imported(index, dayOf(index), total.toFixed(2))];
          return [
            imported(index, dayOf(index), "1.00"),
            imported(index + 100, dayOf(index), total.minus(1).toFixed(2)),
          ];
        });
        expect(created(events, rows)).toEqual(
          events.filter((_, index) => !facts[index]!.imported).map((item) => item.id),
        );
      }),
    );
  });
});

describe("3. CSV com célula a mais", () => {
  it("vírgula decimal sem aspas não perde os centavos em silêncio", () => {
    const parsed = csv("Data,Ativo,Tipo,Valor\n15/03/2026,ABCD3,Dividendo,150,75\n");
    expect(parsed.rows).toEqual([]);
    expect(parsed.ignored.map((line) => line.reason)).toEqual(["dados_invalidos"]);
  });

  it("célula vazia no fim não conta; com aspas, a vírgula é decimal", () => {
    expect(csv("Data;Ativo;Tipo;Valor\n15/03/2026;ABCD3;Dividendo;10,00;;\n").rows).toHaveLength(1);
    const quoted = csv('Data,Ativo,Tipo,Valor\n15/03/2026,ABCD3,Dividendo,"150,75"\n');
    expect(quoted.rows[0]!.net).toBe("150.75");
  });
});

describe("4. coluna de data", () => {
  it("pagamento vence data, em qualquer ordem", () => {
    const first = csv(
      "Data;Pagamento;Ativo;Tipo;Valor\n01/03/2026;15/03/2026;ABCD3;Dividendo;10\n",
    );
    expect(first.rows[0]!.paidOn).toBe("2026-03-15");
    const second = csv(
      "Data Com;Data de Pagamento;Ativo;Tipo;Valor\n01/03/2026;15/03/2026;ABCD3;Dividendo;10\n",
    );
    expect(second.rows[0]!.paidOn).toBe("2026-03-15");
  });

  it("coluna de valor com a palavra pagamento não vira data", () => {
    const parsed = csv(
      "Data;Ativo;Tipo;Valor do pagamento;Total\n15/03/2026;ABCD3;Dividendo;x;10,00\n",
    );
    expect(parsed.rows[0]).toMatchObject({ paidOn: "2026-03-15", net: "10.00" });
  });
});

describe("5. custo do plano", () => {
  const paid = (index: number) => new Date(Date.UTC(2021, 0, 1 + index)).toISOString().slice(0, 10);

  it("2.000 linhas contra 2.000 no mesmo dia não para o servidor", () => {
    const existing = Array.from({ length: 2000 }, (_, index) =>
      auto({
        id: `r${index}`,
        marketDividendId: null,
        source: "familia",
        gross: `${5000 + index}.00`,
      }),
    );
    const rows = Array.from({ length: 2000 }, (_, index) =>
      row({ line: index + 1, net: `${index + 1}.00` }),
    );
    const started = performance.now();
    expect(plan(rows, existing)).toHaveLength(2000);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("2.000 linhas em datas diferentes usam só a janela", () => {
    const existing = Array.from({ length: 2000 }, (_, index) =>
      auto({ id: `r${index}`, paidOn: paid(index), gross: `${1000 + index}.00` }),
    );
    const rows = Array.from({ length: 2000 }, (_, index) =>
      row({ line: index + 1, paidOn: paid(index), net: `${index + 1}.00` }),
    );
    const started = performance.now();
    expect(plan(rows, existing)).toHaveLength(2000);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe("7. colunas e valores que enganam", () => {
  it("IR (%) não vira valor", () => {
    const parsed = csv("Data;Ativo;Tipo;Bruto;IR (%)\n15/03/2025;ABCD3;JCP;1000,00;15\n");
    expect(parsed.rows[0]).toMatchObject({ gross: "1000.00", withheld: null });
  });

  it("três casas depois do separador vão para conferir, sem chute", () => {
    const parsed = csv(
      "Data;Ativo;Tipo;Valor\n15/03/2026;ABCD3;Dividendo;0.125\n16/03/2026;ABCD3;Dividendo;1.234\n17/03/2026;ABCD3;Dividendo;1,005\n18/03/2026;ABCD3;Dividendo;1.234,56\n",
    );
    expect(parsed.rows.map((item) => item.ambiguous ?? false)).toEqual([true, true, true, false]);
    const planned = plan(parsed.rows);
    expect(planned.map((item) => [item.state, item.doubtReason])).toEqual([
      ["conferir", "valor_ambiguo"],
      ["conferir", "valor_ambiguo"],
      ["conferir", "valor_ambiguo"],
      ["novo", null],
    ]);
  });

  it("número do Excel com mais de duas casas também", () => {
    const parsed = parseDividendFile({
      format: "xlsx",
      sheets: [
        {
          name: "P",
          rows: [
            ["Produto", "Pagamento", "Tipo de Evento", "Valor líquido"],
            ["ABCD3 - ABCD", "15/01/2026", "Dividendo", 1.005],
            ["ABCD3 - ABCD", "16/01/2026", "Dividendo", 96.81],
          ],
        },
      ],
    });
    expect(parsed.rows.map((item) => item.ambiguous ?? false)).toEqual([true, false]);
  });

  it("só R$ passa como real", () => {
    const parsed = csv(
      "Data;Ativo;Tipo;Valor\n15/03/2026;ABCD3;Dividendo;$ 10,00\n15/03/2026;ABCD3;Dividendo;US$ 10,00\n15/03/2026;ABCD3;Dividendo;R$ 10,00\n",
    );
    expect(parsed.rows.map((item) => item.net)).toEqual(["10.00"]);
    expect(parsed.ignored.map((line) => line.reason)).toEqual([
      "dados_invalidos",
      "dados_invalidos",
    ]);
  });
});

describe("8. prévia velha", () => {
  it("linha que passou de novo para valor diferente é pulada", () => {
    const before = plan([row({ net: "70.00" })]);
    expect(before[0]!.state).toBe("novo");
    const after = plan([row({ net: "70.00" })], [auto()]);
    expect(after[0]).toMatchObject({ state: "conferir", doubtReason: "valor_diferente" });
    expect(dividendsToWrite(after, new Set([1]), seen(before))).toEqual([]);
    expect(dividendsToWrite(after, new Set([1]), seen(after))).toHaveLength(1);
  });

  it("linha que a pessoa não viu também não entra", () => {
    const planned = plan([row()]);
    expect(dividendsToWrite(planned, new Set([1]), [])).toEqual([]);
  });
});

describe("9. valores que não fecham", () => {
  it("diz qual é o problema", () => {
    const base = { gross: null, withheld: null, net: null };
    expect(amountsProblem({ ...base, gross: "10.00", withheld: "15.00" })).toBe("retido_maior");
    expect(amountsProblem({ ...base, gross: "10.00", net: "15.00" })).toBe("retido_maior");
    expect(amountsProblem({ gross: "100.00", withheld: "1.00", net: "50.00" })).toBe("nao_fecham");
    expect(amountsProblem({ ...base, withheld: "999999999999.99", net: "999999999999.99" })).toBe(
      "nao_fecham",
    );
    expect(amountsProblem({ gross: "100.00", withheld: "15.00", net: "85.00" })).toBeNull();
    expect(amountsProblem({ ...base, net: "85.00" })).toBeNull();
  });

  it("data de calendário de verdade", () => {
    for (const date of [
      "2026-02-31",
      "2026-04-31",
      "2026-02-30",
      "0000-01-01",
      "2026-13-01",
      "x",
    ]) {
      expect(isCalendarDate(date), date).toBe(false);
    }
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-03-10")).toBe(true);
  });
});

describe("10. Desfazer ao lado da importada", () => {
  const removed = { kind: "dividendo" as const, paidOn: "2026-03-10", gross: "50.00" };
  const imported = (over: Partial<ExistingDividend> = {}): ExistingDividend => ({
    id: importedDividendId("a"),
    kind: "dividendo",
    paidOn: "2026-03-10",
    gross: "50.00",
    withheld: "0.00",
    source: "familia",
    marketDividendId: null,
    ...over,
  });

  it("linha importada do mesmo pagamento responde por ele", () => {
    expect(answeredByImport(removed, [imported()])).toBe(true);
    expect(answeredByImport(removed, [imported({ paidOn: "2026-03-12", gross: "48.00" })])).toBe(
      true,
    );
  });

  it("outro tipo, outra data, valor distante ou lançamento à mão não respondem", () => {
    expect(answeredByImport(removed, [imported({ kind: "jcp" })])).toBe(false);
    expect(answeredByImport(removed, [imported({ paidOn: "2026-03-20" })])).toBe(false);
    expect(answeredByImport(removed, [imported({ paidOn: "2026-03-12", gross: "90.00" })])).toBe(
      false,
    );
    expect(answeredByImport(removed, [imported({ id: "manual" })])).toBe(false);
  });
});

describe("11. célula fora de faixa", () => {
  const header = "Data;Ativo;Tipo;Bruto;IR;Liquido\n";

  it("imposto enorme ignora a linha e mantém o arquivo", () => {
    const parsed = csv(
      `${header}15/03/2026;ABCD3;JCP;100,00;99999999999999,00;\n15/03/2026;ABCD3;JCP;;99999999999999,00;100,00\n16/03/2026;ABCD3;Dividendo;50,00;;\n`,
    );
    expect(parsed.rows.map((item) => item.paidOn)).toEqual(["2026-03-16"]);
    expect(parsed.ignored.map((line) => line.reason)).toEqual([
      "dados_invalidos",
      "dados_invalidos",
    ]);
  });

  it("número absurdo em qualquer coluna não derruba", () => {
    const huge = "9".repeat(400);
    const parsed = csv(
      `${header}15/03/2026;ABCD3;Dividendo;${huge},00;;\n15/03/2026;ABCD3;Dividendo;1e400;;\n15/03/2026;ABCD3;Dividendo;50,00;;\n`,
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.ignored).toHaveLength(2);
  });

  it("coluna preenchida com lixo não some em silêncio; traço é vazio", () => {
    const parsed = csv(
      `${header}15/03/2026;ABCD3;Dividendo;abc;;10,00\n16/03/2026;ABCD3;Dividendo;-;-;10,00\n`,
    );
    expect(parsed.ignored.map((line) => line.reason)).toEqual(["dados_invalidos"]);
    expect(parsed.rows).toMatchObject([{ paidOn: "2026-03-16", gross: null, withheld: null }]);
  });

  it("data fora do calendário vira linha ignorada", () => {
    const parsed = csv(`${header}31/02/2026;ABCD3;Dividendo;50,00;;\n`);
    expect(parsed.ignored.map((line) => line.reason)).toEqual(["dados_invalidos"]);
  });
});

describe("12. selo na linha trocada", () => {
  it("linha que veio de arquivo é reconhecida, importada ou trocada", () => {
    expect(
      cameFromFile({ id: importedDividendId("a"), source: "familia", marketDividendId: null }),
    ).toBe(true);
    expect(cameFromFile({ id: "x", source: "familia", marketDividendId: "m1" })).toBe(true);
    expect(cameFromFile({ id: "x", source: "agente", marketDividendId: "m1" })).toBe(false);
    expect(cameFromFile({ id: "x", source: "familia", marketDividendId: null })).toBe(false);
  });
});

describe("arredondamento do valor bruto em lote", () => {
  it("o plano não usa float: centavos grandes seguem exatos", () => {
    const value = "999999999999.97";
    const planned = plan([row({ net: value })], [auto({ gross: value })]);
    expect(planned[0]!.state).toBe("existe");
    expect(toDbAmount(value)).toBe(value);
  });
});
