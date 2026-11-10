// Desdobramento, grupamento e bonificação contra um Postgres real com RLS (ADR-0017). Dados fictícios.
// A família daqui não tem sessão: fica fora da coleta do job de mercado e não mexe nos outros testes.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TenantTx } from "@organizeup/db";
import type { InvestimentoPayload, ReportInvestimentos } from "../src/index";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const agents = await import("../src/index");

const {
  and,
  asc,
  dividends,
  eq,
  household,
  householdMember,
  householdSettings,
  householdSuggestions,
  investments,
  investmentStockEvents,
  investmentTrades,
  marketStockEvents,
  user,
} = db;

const E = { household: "hh-eventos-e", owner: "user-eventos-e" };
const day = "2026-10-31";
const inE = <T>(fn: (tx: TenantTx) => Promise<T>) => db.withWorkerHousehold(E.household, fn);
const run = (today = day) =>
  inE((tx) => agents.runInvestimentosAgent(tx, { today, householdId: E.household }));

async function ownerCtx() {
  const ctx = await db.fromSession({
    user: { id: E.owner },
    session: { activeOrganizationId: E.household },
  });
  if (!ctx) throw new Error("sem contexto");
  return ctx;
}

const before = new Date("2026-01-05T15:00:00Z");

async function holding(
  ticker: string,
  trades: Array<{
    occurredOn: string;
    quantity: string;
    side?: "compra" | "venda";
    createdAt?: Date;
  }>,
): Promise<string> {
  return inE(async (tx) => {
    const [row] = await tx
      .insert(investments)
      .values({ householdId: E.household, name: ticker, ticker, assetClass: "acao" })
      .returning({ id: investments.id });
    await tx.insert(investmentTrades).values(
      trades.map((trade) => ({
        householdId: E.household,
        investmentId: row!.id,
        side: trade.side ?? ("compra" as const),
        occurredOn: trade.occurredOn,
        quantity: trade.quantity,
        unitPrice: "30.00000000",
        createdAt: trade.createdAt ?? before,
      })),
    );
    return row!.id;
  });
}

const stockEvent = (ticker: string, comDate: string, factor: string, note: string) => ({
  ticker,
  comDate,
  factor,
  note,
  source: "brapi.dev",
});

const quote = (ticker: string, price: string) =>
  db.saveMarketQuote({
    ticker,
    price,
    changePercent: null,
    quotedAt: new Date("2026-10-30T21:00:00Z"),
    source: "brapi.dev",
    lastStockEventOn: null,
    lastStockEventNote: null,
  });

const appliedRows = (investmentId: string) =>
  inE((tx) =>
    tx
      .select()
      .from(investmentStockEvents)
      .where(eq(investmentStockEvents.investmentId, investmentId))
      .orderBy(asc(investmentStockEvents.comDate)),
  );

const suggestionsOf = (investmentId: string, comDate: string, note: string) =>
  inE((tx) =>
    tx
      .select()
      .from(householdSuggestions)
      .where(
        eq(
          householdSuggestions.dedupeKey,
          agents.DEDUPE.investimentoAcoes(investmentId, comDate, note),
        ),
      ),
  );

const noticesOf = (investmentId: string, comDate: string) =>
  inE((tx) =>
    tx
      .select()
      .from(householdSuggestions)
      .where(
        eq(householdSuggestions.dedupeKey, agents.DEDUPE.investimentoEvento(investmentId, comDate)),
      ),
  );

/** Quantidade como o patrimônio enxerga: é uma das telas que precisa dar o mesmo número. */
const quantityOf = async (investmentId: string) => {
  const input = await inE((tx) => db.netWorthInputs(tx));
  const found = input.investments.find((item) => item.id === investmentId)!;
  return domain.positionOf(found.trades, found.events).quantity;
};

beforeAll(async () => {
  await db.withAdmin("seed do teste de eventos", async (admin) => {
    await admin.insert(user).values({ id: E.owner, name: "Eva", email: "eva.eventos@example.com" });
    await admin
      .insert(household)
      .values({ id: E.household, name: "Família Eventos", slug: "familia-eventos" });
    await admin
      .insert(householdMember)
      .values({ id: "me-1", organizationId: E.household, userId: E.owner, role: "owner" });
  });
  await inE((tx) => tx.insert(householdSettings).values({ householdId: E.household }));
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("evento em ações registrado antes de qualquer operação nova", () => {
  const note = "Desdobramento de 2 para 1";
  let id = "";

  beforeAll(async () => {
    id = await holding("BBAS3", [{ occurredOn: "2026-01-05", quantity: "100.00000000" }]);
    await quote("BBAS3", "15.00000000");
    await db.saveMarketStockEvents([stockEvent("BBAS3", "2026-09-01", "2", note)]);
  });

  it("aplica, com sugestão aplicada, estado anterior e texto claro", async () => {
    const result = await run();
    const data = result.report.data as ReportInvestimentos;
    expect(data.market.stockEvents).toBe(1);
    expect(result.report.summary).toContain("quantidade ajustada");

    const rows = await appliedRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ comDate: "2026-09-01", factor: "2.00000000", note });

    const [suggestion] = await suggestionsOf(id, "2026-09-01", note);
    expect(suggestion).toMatchObject({
      status: "aplicada",
      appliedBy: "agente",
      kind: "investimento",
    });
    expect(suggestion!.body).toContain("desdobramento de 2 para 1");
    expect(suggestion!.body).toContain("foi de 100 para 200");
    expect(suggestion!.body).toContain("O valor total não muda");
    expect(suggestion!.body).not.toMatch(/agente|yield|aporte/i);
    const payload = suggestion!.payload as InvestimentoPayload;
    expect(payload.stockEvent).toEqual({
      investmentId: id,
      comDate: "2026-09-01",
      factor: "2.00000000",
      note,
      quantityBefore: "100",
      quantityAfter: "200",
    });
    expect(await noticesOf(id, "2026-09-01")).toHaveLength(0);
  });

  it("muda a posição e não toca nas operações", async () => {
    expect(await quantityOf(id)).toBe("200");
    const trades = await inE((tx) =>
      tx.select().from(investmentTrades).where(eq(investmentTrades.investmentId, id)),
    );
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ quantity: "100.00000000", unitPrice: "30.00000000" });
  });

  it("não reaplica no mesmo dia nem no seguinte", async () => {
    await run();
    await run("2026-11-01");
    expect(await appliedRows(id)).toHaveLength(1);
    expect(await suggestionsOf(id, "2026-09-01", note)).toHaveLength(1);
    expect(await quantityOf(id)).toBe("200");
  });

  it("a mesma nota com outra redação na fonte não aplica de novo", async () => {
    await db.saveMarketStockEvents([stockEvent("BBAS3", "2026-09-01", "2", "Desdobramento")]);
    await run("2026-11-01");
    expect(await appliedRows(id)).toHaveLength(1);
    expect(await quantityOf(id)).toBe("200");
  });

  it("desfazer remove o ajuste, não mexe em nada mais e não volta", async () => {
    const [suggestion] = await suggestionsOf(id, "2026-09-01", note);
    const ctx = await ownerCtx();
    const undo = await db.withHousehold(ctx, (tx) =>
      agents.undoSuggestion(tx, ctx, suggestion!.id),
    );
    expect(undo.ok).toBe(true);
    expect(undo.message).not.toMatch(/agente|yield|aporte/i);
    expect(await appliedRows(id)).toHaveLength(0);
    expect(await quantityOf(id)).toBe("100");
    const [after] = await suggestionsOf(id, "2026-09-01", note);
    expect(after!.status).toBe("desfeita");

    await run("2026-11-02");
    await run("2026-11-03");
    expect(await appliedRows(id)).toHaveLength(0);
    expect(await noticesOf(id, "2026-09-01")).toHaveLength(0);
    expect(await suggestionsOf(id, "2026-09-01", note)).toHaveLength(1);
  });
});

describe("evento em ações com operação cadastrada depois dele", () => {
  const note = "Grupamento de 1 para 10";
  let id = "";

  beforeAll(async () => {
    id = await holding("CMIG4", [
      { occurredOn: "2026-01-05", quantity: "100.00000000" },
      // Cadastrada depois do evento, com data antes dele: pode já estar na quantidade nova.
      {
        occurredOn: "2026-02-05",
        quantity: "10.00000000",
        createdAt: new Date("2026-09-20T15:00:00Z"),
      },
    ]);
    await quote("CMIG4", "60.00000000");
    await db.saveMarketStockEvents([stockEvent("CMIG4", "2026-09-01", "0.1", note)]);
  });

  it("não aplica e mantém o aviso, uma vez só", async () => {
    await run();
    await run();
    expect(await appliedRows(id)).toHaveLength(0);
    expect(await quantityOf(id)).toBe("110");
    const notices = await noticesOf(id, "2026-09-01");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ status: "pendente" });
    expect(notices[0]!.title).toBe("Confira a quantidade de CMIG4");
    expect(notices[0]!.body).toContain("Grupamento de 1 para 10");
    expect(notices[0]!.body).toContain("01/09/2026");
    expect(notices[0]!.body).not.toMatch(/agente|yield|aporte/i);
  });

  it("sem a operação que impedia, aplica e tira o aviso da fila", async () => {
    await inE((tx) =>
      tx
        .delete(investmentTrades)
        .where(
          and(eq(investmentTrades.investmentId, id), eq(investmentTrades.occurredOn, "2026-02-05")),
        ),
    );
    await run();
    expect(await quantityOf(id)).toBe("10");
    expect(await noticesOf(id, "2026-09-01")).toHaveLength(0);
  });
});

describe("regras de aplicação", () => {
  it("sem posição na data-com, ignora sem aviso", async () => {
    const later = await holding("KLBN4", [{ occurredOn: "2026-09-02", quantity: "100.00000000" }]);
    const sold = await holding("SAPR4", [
      { occurredOn: "2026-01-05", quantity: "100.00000000" },
      { occurredOn: "2026-02-05", quantity: "100.00000000", side: "venda" },
    ]);
    await quote("KLBN4", "20.00000000");
    await quote("SAPR4", "20.00000000");
    await db.saveMarketStockEvents([
      stockEvent("KLBN4", "2026-09-01", "2", "Desdobramento"),
      stockEvent("SAPR4", "2026-09-01", "2", "Desdobramento"),
    ]);
    await run();
    for (const id of [later, sold]) {
      expect(await appliedRows(id)).toHaveLength(0);
      expect(await noticesOf(id, "2026-09-01")).toHaveLength(0);
    }
    expect(await quantityOf(later)).toBe("100");
  });

  it("compra na data-com tem direito, e venda depois do evento conta na quantidade nova", async () => {
    const id = await holding("TIMS3", [
      { occurredOn: "2026-09-01", quantity: "100.00000000" },
      { occurredOn: "2026-10-01", quantity: "150.00000000", side: "venda" },
    ]);
    await db.saveMarketStockEvents([stockEvent("TIMS3", "2026-09-01", "2", "Desdobramento")]);
    await inE((tx) =>
      tx
        .update(investmentTrades)
        .set({ createdAt: new Date("2026-08-20T15:00:00Z") })
        .where(eq(investmentTrades.investmentId, id)),
    );
    await run();
    expect(await appliedRows(id)).toHaveLength(1);
    expect(await quantityOf(id)).toBe("50");
  });

  it("dois eventos em sequência acumulam", async () => {
    const id = await holding("CSAN3", [{ occurredOn: "2026-01-05", quantity: "100.00000000" }]);
    await db.saveMarketStockEvents([
      stockEvent("CSAN3", "2026-07-01", "1.1", "Bonificação de 10%"),
      stockEvent("CSAN3", "2026-08-01", "2", "Desdobramento de 2 para 1"),
    ]);
    await run();
    expect((await appliedRows(id)).map((row) => row.note)).toEqual([
      "Bonificação de 10%",
      "Desdobramento de 2 para 1",
    ]);
    expect(await quantityOf(id)).toBe("220");
    const [second] = await suggestionsOf(id, "2026-08-01", "Desdobramento de 2 para 1");
    expect((second!.payload as InvestimentoPayload).stockEvent).toMatchObject({
      quantityBefore: "110",
      quantityAfter: "220",
    });
  });

  it("provento usa a quantidade certa de cada lado do evento", async () => {
    const id = await holding("TAEE4", [{ occurredOn: "2026-01-05", quantity: "100.00000000" }]);
    await db.saveMarketStockEvents([stockEvent("TAEE4", "2026-09-01", "2", "Desdobramento")]);
    const provento = (comDate: string, payDate: string) => ({
      ticker: "TAEE4",
      kind: "dividendo" as const,
      comDate,
      exDate: null,
      payDate,
      ratePerShare: "1.00000000",
      seq: 1,
      source: "brapi.dev",
    });
    await db.saveMarketDividends([
      provento("2026-09-01", "2026-09-15"),
      provento("2026-09-02", "2026-09-16"),
    ]);
    await run();
    const rows = await inE((tx) =>
      tx.select().from(dividends).where(eq(dividends.investmentId, id)),
    );
    expect(rows.find((row) => row.paidOn === "2026-09-15")!.gross).toBe("100.00");
    expect(rows.find((row) => row.paidOn === "2026-09-16")!.gross).toBe("200.00");
  });

  it("não aplica em classe sem preço unitário", async () => {
    const id = await inE(async (tx) => {
      const [row] = await tx
        .insert(investments)
        .values({ householdId: E.household, name: "Fundo", ticker: "FNDO3", assetClass: "fundo" })
        .returning({ id: investments.id });
      await tx.insert(investmentTrades).values({
        householdId: E.household,
        investmentId: row!.id,
        side: "compra",
        occurredOn: "2026-01-05",
        quantity: "100.00000000",
        unitPrice: "1.00000000",
        createdAt: before,
      });
      return row!.id;
    });
    await db.saveMarketStockEvents([stockEvent("FNDO3", "2026-09-01", "2", "Desdobramento")]);
    await run();
    expect(await appliedRows(id)).toHaveLength(0);
  });
});

describe("coleta dos eventos em ações", () => {
  it("evento repetido na resposta vira uma linha, e fator corrigido atualiza", async () => {
    const row = stockEvent("WEGE3", "2026-05-02", "2", "Desdobramento");
    expect(await db.saveMarketStockEvents([row, row])).toBe(1);
    await db.saveMarketStockEvents([{ ...row, factor: "3" }]);
    const rows = await inE((tx) =>
      tx.select().from(marketStockEvents).where(eq(marketStockEvents.ticker, "WEGE3")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.factor).toBe("3.00000000");
  });

  it("traz todos os eventos que mudam a quantidade, com o fator da B3 virando multiplicador", async () => {
    // Resposta da lista de empresas da B3 (ADR-0035): a ITUB tem ON e PN; só a PN é ITUB4.
    const body = [
      {
        code: "ITUB",
        cashDividends: [],
        stockDividends: [
          {
            assetIssued: "BRITUBACNPR1",
            factor: "3,00000000000",
            label: "BONIFICACAO",
            lastDatePrior: "23/12/2025",
          },
          {
            assetIssued: "BRITUBACNOR4",
            factor: "3,00000000000",
            label: "BONIFICACAO",
            lastDatePrior: "23/12/2025",
          },
          {
            assetIssued: "BRITUBACNPR1",
            factor: "0,10000000000",
            label: "GRUPAMENTO",
            lastDatePrior: "02/03/2020",
          },
          {
            assetIssued: "BRITUBACNPR1",
            factor: "100,00000000000",
            label: "CIS RED CAP",
            lastDatePrior: "01/10/2021",
          },
          // Arredondaria para zero na coluna de 8 casas.
          {
            assetIssued: "BRITUBACNPR1",
            factor: "0,00000000010",
            label: "GRUPAMENTO",
            lastDatePrior: "02/03/2019",
          },
        ],
      },
    ];
    const result = await agents.fetchB3CompanyEvents("ITUB4", {
      today: day,
      fetch: (async () => new Response(JSON.stringify(body))) as typeof fetch,
    });
    expect(result.stockEvents).toEqual([
      { comDate: "2020-03-02", factor: "0.10000000", note: "Grupamento de 10 para 1" },
      { comDate: "2025-12-23", factor: "1.03000000", note: "Bonificação de 3%" },
    ]);
  });
});
