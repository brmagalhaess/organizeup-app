// Cotações e proventos automáticos contra um Postgres real com RLS (ADR-0017). Dados fictícios e
// chamadas externas simuladas com o formato real das APIs. Roda com a conexão do worker (ou_worker).
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { MarketDividendRow, TenantTx } from "@organizeup/db";
import type { ReportInvestimentos } from "../src/index";

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
  dividends,
  eq,
  household,
  householdMember,
  householdSettings,
  householdSuggestions,
  investments,
  investmentTrades,
  marketDividends,
  marketIndices,
  marketQuotes,
  marketStockEvents,
  marketTickers,
  session,
  user,
} = db;

type Tx = TenantTx;
const C = { household: "hh-mercado-c", owner: "user-mercado-c" };
const D = { household: "hh-mercado-d", owner: "user-mercado-d" };
const day = "2026-10-31";
const inC = <T>(fn: (tx: Tx) => Promise<T>) => db.withWorkerHousehold(C.household, fn);
const run = (today = day) =>
  inC((tx) => agents.runInvestimentosAgent(tx, { today, householdId: C.household }));
const market = (result: { report: { data: unknown } }) =>
  (result.report.data as ReportInvestimentos).market;
const applied = () =>
  inC((tx) =>
    tx
      .select()
      .from(householdSuggestions)
      .where(
        and(
          eq(householdSuggestions.status, "aplicada"),
          eq(householdSuggestions.appliedBy, "agente"),
        ),
      ),
  );

let petr = "";
let vale = "";
let manual = "";
const proventos: Record<string, string> = {};

async function ownerCtx() {
  const ctx = await db.fromSession({
    user: { id: C.owner },
    session: { activeOrganizationId: C.household },
  });
  if (!ctx) throw new Error("sem contexto");
  return ctx;
}

const quoteRow = (ticker: string, price: string, at = "2026-10-30T21:00:00Z") => ({
  ticker,
  price,
  changePercent: null,
  quotedAt: new Date(at),
  source: "brapi.dev",
  lastStockEventOn: null,
  lastStockEventNote: null,
});

const provento = (over: Partial<MarketDividendRow>): MarketDividendRow => ({
  ticker: "PETR4",
  kind: "jcp",
  comDate: "2026-08-21",
  exDate: "2026-08-24",
  payDate: "2026-09-21",
  ratePerShare: "0.67407131",
  seq: 1,
  source: "brapi.dev",
  ...over,
});

beforeAll(async () => {
  await db.withAdmin("seed do teste de mercado", async (admin) => {
    await admin.insert(user).values([
      { id: C.owner, name: "Caio", email: "caio.mercado@example.com" },
      { id: D.owner, name: "Dani", email: "dani.mercado@example.com" },
    ]);
    await admin.insert(household).values([
      { id: C.household, name: "Família Mercado", slug: "familia-mercado" },
      { id: D.household, name: "Família Parada", slug: "familia-parada" },
    ]);
    await admin.insert(householdMember).values([
      { id: "mc-1", organizationId: C.household, userId: C.owner, role: "owner" },
      { id: "md-1", organizationId: D.household, userId: D.owner, role: "owner" },
    ]);
    await admin.insert(session).values({
      id: "sessao-mercado",
      token: "tok-mercado",
      userId: C.owner,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  });
  await inC(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: C.household });
    const holdings = await tx
      .insert(investments)
      .values([
        { householdId: C.household, name: "Petrobras", ticker: "PETR4", assetClass: "acao" },
        { householdId: C.household, name: "Vale", ticker: "VALE3", assetClass: "acao" },
        {
          householdId: C.household,
          name: "Manual",
          ticker: "ITUB4",
          assetClass: "acao",
          currentPrice: "99.00000000",
          valuedOn: "2026-11-05",
        },
      ])
      .returning({ id: investments.id, ticker: investments.ticker });
    petr = holdings.find((row) => row.ticker === "PETR4")!.id;
    vale = holdings.find((row) => row.ticker === "VALE3")!.id;
    manual = holdings.find((row) => row.ticker === "ITUB4")!.id;
    const trade = (investmentId: string, occurredOn: string, quantity: string) => ({
      householdId: C.household,
      investmentId,
      side: "compra" as const,
      occurredOn,
      quantity,
      unitPrice: "30.00000000",
    });
    await tx.insert(investmentTrades).values([
      trade(petr, "2026-01-05", "100.00000000"),
      // Comprou na data-com: tem direito.
      trade(vale, "2026-08-11", "10.00000000"),
      // Comprou na data ex: sem direito.
      trade(vale, "2026-08-12", "5.00000000"),
      trade(manual, "2025-01-05", "10.00000000"),
    ]);
  });
  await db.saveMarketQuote(quoteRow("PETR4", "52.71000000"));
  await db.saveMarketQuote({
    ...quoteRow("VALE3", "62.02000000"),
    lastStockEventOn: "2026-09-01",
    lastStockEventNote: "Desdobramento de 2 para 1",
  });
  await db.saveMarketQuote(quoteRow("ITUB4", "38.69000000"));
  await db.saveMarketStockEvents([
    {
      ticker: "VALE3",
      comDate: "2026-09-01",
      factor: "2",
      note: "Desdobramento de 2 para 1",
      source: "brapi.dev",
    },
  ]);
  await db.saveMarketDividends([
    provento({}),
    // A receber.
    provento({ kind: "dividendo", ratePerShare: "0.47156696", payDate: "2026-12-21" }),
    provento({
      ticker: "VALE3",
      kind: "dividendo",
      comDate: "2026-08-11",
      exDate: "2026-08-12",
      ratePerShare: "2.00000000",
    }),
    // Antes da primeira compra.
    provento({ comDate: "2025-08-21", exDate: "2025-08-22", payDate: "2025-09-21" }),
    // Virada de ano: o imposto depende da data do crédito.
    provento({
      ticker: "ITUB4",
      comDate: "2025-12-30",
      exDate: "2026-01-02",
      payDate: "2026-02-02",
      ratePerShare: "0.01818200",
    }),
  ]);
  const rows = await inC((tx) => tx.select().from(marketDividends));
  for (const row of rows) proventos[`${row.ticker}:${row.kind}:${row.payDate}`] = row.id;
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("agente de investimentos com dados de mercado", () => {
  it("grava preço e proventos, com uma sugestão só e o estado anterior", async () => {
    const result = await run();
    expect(result.applied).toBe(5); // 2 preços + 3 proventos
    await inC(async (tx) => {
      const [holding] = await tx.select().from(investments).where(eq(investments.id, petr));
      expect(holding).toMatchObject({
        currentPrice: "52.71000000",
        valuedOn: "2026-10-30",
        priceSource: "mercado",
      });
      const rows = await tx.select().from(dividends).where(eq(dividends.investmentId, petr));
      expect(rows).toHaveLength(2);
      // Bruto 100 × 0,67407131 = 67,41; retido 17,5% (Lei Complementar 224/2025).
      expect(rows.find((row) => row.kind === "jcp")).toMatchObject({
        gross: "67.41",
        withheld: "11.80",
        source: "agente",
      });
      expect(rows.find((row) => row.kind === "dividendo")).toMatchObject({
        gross: "47.16",
        withheld: "0.00",
        paidOn: "2026-12-21",
      });
      const [valeRow] = await tx.select().from(dividends).where(eq(dividends.investmentId, vale));
      expect(valeRow!.gross).toBe("20.00"); // 10 da data-com; os 5 da data ex ficam de fora
    });
    const mine = (await applied()).filter((row) => row.dedupeKey.startsWith("mercado:"));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.title).not.toMatch(/agente|yield|aporte/i);
    expect(mine[0]!.body).not.toMatch(/agente|yield|aporte/i);
    const changes = agents.marketChangesSchema.parse(
      (mine[0]!.payload as { market: unknown }).market,
    );
    expect(changes.prices[0]!.previous).toEqual({ price: null, valuedOn: null, source: "familia" });
    const data = result.report.data as ReportInvestimentos;
    expect(data.market).toMatchObject({ prices: 2, created: 3, skippedTax: 1 });
    expect(data.upcomingNet).toBe("47.16");
    expect(data.stale).toEqual([]);
    expect(result.report.summary).toContain("A receber");
  });

  it("não sobrescreve preço que a família digitou depois da cotação", async () => {
    const [holding] = await inC((tx) =>
      tx.select().from(investments).where(eq(investments.id, manual)),
    );
    expect(holding).toMatchObject({
      currentPrice: "99.00000000",
      valuedOn: "2026-11-05",
      priceSource: "familia",
    });
  });

  it("JCP da virada de ano não é lançado e vira pedido de conferência", async () => {
    await inC(async (tx) => {
      expect(
        await tx.select().from(dividends).where(eq(dividends.investmentId, manual)),
      ).toHaveLength(0);
      const rows = await tx
        .select()
        .from(householdSuggestions)
        .where(eq(householdSuggestions.dedupeKey, agents.DEDUPE.investimentoConferir("2026-10")));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.body).toContain("ITUB4");
    });
  });

  it("avisa de desdobramento com operação cadastrada depois dele uma vez só, mesmo depois de a família decidir", async () => {
    const list = () =>
      inC((tx) =>
        tx.select().from(householdSuggestions).where(eq(householdSuggestions.kind, "investimento")),
      );
    const notices = async () =>
      (await list()).filter((row) => row.dedupeKey.startsWith("investimento:evento:"));
    expect(await notices()).toHaveLength(1);
    expect((await notices())[0]!.title).toContain("VALE3");
    const ctx = await ownerCtx();
    const id = (await notices())[0]!.id;
    await db.withHousehold(ctx, (tx) => agents.applySuggestion(tx, ctx, id));
    await run();
    expect((await notices()).filter((row) => row.status === "pendente")).toHaveLength(0);
  });

  it("rodar de novo no mesmo dia não muda nada", async () => {
    const before = await inC((tx) => tx.select().from(dividends));
    const result = await run();
    expect(result.applied).toBe(0);
    expect(await inC((tx) => tx.select().from(dividends))).toHaveLength(before.length);
    expect((await applied()).filter((row) => row.dedupeKey.startsWith("mercado:"))).toHaveLength(1);
  });

  it("o plano de aposentadoria conta uma vez e deixa o a receber de fora", async () => {
    const { input } = await inC((tx) =>
      agents.dividendPlanInputs(tx, {
        today: day,
        essentialMonthly: "1000.00",
        averageExpenses12: "1000.00",
      }),
    );
    const asset = input.assets.find((item) => item.id === petr)!;
    expect(asset.dividendsNet12).toBe("55.61"); // 67,41 − 11,80; os 47,16 ainda não caíram
    expect(input.assets.find((item) => item.id === vale)!.dividendsNet12).toBe("20.00");
    const plan = domain.planDividendRetirement(input);
    expect(plan.currentIncome).toBe(domain.toDbAmount(domain.money("75.61").dividedBy(12)));
    // Só PETR4 tem 3 meses ou mais: 55,61 em 9 meses, anualizado, sobre 100 × 52,71.
    expect(plan.yieldBasis).toBe("observado_anualizado");
    expect(plan.observedYield).toBe("1.41");
  });

  it("provento já lançado pela família não duplica", async () => {
    await db.saveMarketDividends([
      provento({
        kind: "dividendo",
        comDate: "2026-10-20",
        exDate: "2026-10-21",
        payDate: "2027-03-10",
        ratePerShare: "1.00000000",
      }),
    ]);
    await inC((tx) =>
      tx.insert(dividends).values({
        householdId: C.household,
        investmentId: petr,
        kind: "dividendo",
        paidOn: "2027-03-11",
        gross: "100.00",
      }),
    );
    const result = await run();
    expect(market(result)).toMatchObject({ skippedFamily: 1, created: 0 });
    const rows = await inC((tx) =>
      tx.select().from(dividends).where(eq(dividends.paidOn, "2027-03-10")),
    );
    expect(rows).toHaveLength(0);
  });

  it("provento automático excluído pela família não volta", async () => {
    const ctx = await ownerCtx();
    const id = proventos["PETR4:jcp:2026-09-21"]!;
    await db.withHousehold(ctx, async (tx) => {
      const [removed] = await tx
        .delete(dividends)
        .where(eq(dividends.marketDividendId, id))
        .returning();
      await agents.recordDividendRemoval(tx, ctx, {
        dividendId: removed!.id,
        investmentId: removed!.investmentId,
        marketDividendId: id,
      });
    });
    await run();
    await run("2026-11-03");
    expect(
      await inC((tx) => tx.select().from(dividends).where(eq(dividends.marketDividendId, id))),
    ).toHaveLength(0);
  });

  it("compra retroativa corrige o provento automático", async () => {
    await inC((tx) =>
      tx.insert(investmentTrades).values({
        householdId: C.household,
        investmentId: vale,
        side: "compra",
        occurredOn: "2026-03-01",
        quantity: "10.00000000",
        unitPrice: "30.00000000",
      }),
    );
    const result = await run("2026-11-04");
    expect(market(result)).toMatchObject({ adjusted: 1 });
    const [row] = await inC((tx) =>
      tx.select().from(dividends).where(eq(dividends.investmentId, vale)),
    );
    expect(row!.gross).toBe("40.00");
  });

  it("desfazer devolve o estado anterior e a mudança não volta sozinha", async () => {
    await db.saveMarketQuote(quoteRow("PETR4", "60.00000000", "2026-11-05T21:00:00Z"));
    await db.saveMarketDividends([
      provento({
        kind: "dividendo",
        comDate: "2026-10-30",
        exDate: "2026-11-03",
        payDate: "2026-11-20",
        ratePerShare: "2.00000000",
      }),
    ]);
    const result = await run("2026-11-06");
    expect(market(result)).toMatchObject({ prices: 1, created: 1 });
    const target = (await applied()).find(
      (row) => row.dedupeKey === agents.DEDUPE.mercadoDia("2026-11-06"),
    )!;
    const ctx = await ownerCtx();
    const undo = await db.withHousehold(ctx, (tx) => agents.undoSuggestion(tx, ctx, target.id));
    expect(undo.ok).toBe(true);
    expect(undo.message).not.toMatch(/agente|yield|aporte/i);
    const check = () =>
      inC(async (tx) => {
        const [holding] = await tx.select().from(investments).where(eq(investments.id, petr));
        expect(holding).toMatchObject({ currentPrice: "52.71000000", valuedOn: "2026-10-30" });
        expect(
          await tx.select().from(dividends).where(eq(dividends.paidOn, "2026-11-20")),
        ).toHaveLength(0);
      });
    await check();
    expect(market(await run("2026-11-06"))).toMatchObject({ prices: 0, created: 0 });
    await check();
  });

  it("ativo sem cotação segue com o aviso de preço velho; com cotação, ele some", async () => {
    await inC(async (tx) => {
      const [holding] = await tx
        .insert(investments)
        .values({
          householdId: C.household,
          name: "Sem cotação",
          ticker: "ABCD3",
          assetClass: "acao",
          currentPrice: "10.00000000",
          valuedOn: "2026-01-01",
        })
        .returning({ id: investments.id });
      await tx.insert(investmentTrades).values({
        householdId: C.household,
        investmentId: holding!.id,
        side: "compra",
        occurredOn: "2026-01-01",
        quantity: "1.00000000",
        unitPrice: "10.00000000",
      });
    });
    const stale = ((await run("2026-11-07")).report.data as ReportInvestimentos).stale;
    expect(stale).toHaveLength(1);
    await db.saveMarketQuote(quoteRow("ABCD3", "11.00000000", "2026-11-06T21:00:00Z"));
    const after = (await run("2026-11-07")).report.data as ReportInvestimentos;
    expect(after.stale).toEqual([]);
    const key = agents.DEDUPE.investimentoPreco(stale[0]!, "2026-11");
    const rows = await inC((tx) =>
      tx.select().from(householdSuggestions).where(eq(householdSuggestions.dedupeKey, key)),
    );
    expect(rows.filter((row) => row.status === "pendente")).toHaveLength(0);
  });

  it("nada disso aparece para outra família", async () => {
    const rows = await db.withWorkerHousehold(D.household, (tx) => tx.select().from(dividends));
    expect(rows).toHaveLength(0);
  });
});

describe("job de mercado", () => {
  const silent = { error: () => {}, info: () => {}, warn: () => {} };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  /** ISIN de uma classe no padrão da B3: PETR4 → BRPETRACNPR0, VALE3 → BRVALEACNOR0. */
  const isinOf = (ticker: string) =>
    `BR${ticker.slice(0, 4)}ACN${ticker.endsWith("4") ? "PR" : "OR"}0`;
  /** Resposta da lista de empresas da B3 (ADR-0035): proventos e eventos da classe, mais o que fica de fora. */
  const company = (ticker: string) => [
    {
      code: ticker.slice(0, 4),
      cashDividends: [
        {
          assetIssued: isinOf(ticker),
          rate: "1,00000000000",
          label: "DIVIDENDO",
          lastDatePrior: "21/08/2026",
          paymentDate: "30/12/2026",
        },
        // Fora: sem data de pagamento, e a outra classe da mesma emissora.
        {
          assetIssued: isinOf(ticker),
          rate: "0,20000000000",
          label: "JRS CAP PROPRIO",
          lastDatePrior: "21/08/2026",
          paymentDate: null,
        },
        {
          assetIssued: `BR${ticker.slice(0, 4)}ACNPA0`,
          rate: "9,00000000000",
          label: "DIVIDENDO",
          lastDatePrior: "21/08/2026",
          paymentDate: "30/12/2026",
        },
      ],
      stockDividends: [
        {
          assetIssued: isinOf(ticker),
          factor: "100,00000000000",
          label: "DESDOBRAMENTO",
          lastDatePrior: "01/09/2026",
        },
        {
          assetIssued: isinOf(ticker),
          factor: "100,00000000000",
          label: "CIS RED CAP",
          lastDatePrior: "01/10/2026",
        },
      ],
    },
  ];
  const sgs = () => json([{ data: "29/10/2026", valor: "0.050788" }]);
  /** Horário que nenhuma cotação gravada antes usa: o histórico não duplica a mesma coleta. */
  const closedAt = Math.floor(Date.parse("2026-11-07T20:00:00Z") / 1000);
  /** Formato real do Yahoo (ADR-0032): preço, fechamento anterior e horário em segundos. */
  const yahoo = (symbol: string, price: number) => ({
    chart: {
      result: [
        {
          meta: {
            currency: "BRL",
            symbol: `${symbol}.SA`,
            regularMarketPrice: price,
            regularMarketTime: closedAt,
            chartPreviousClose: price - 1,
          },
        },
      ],
      error: null,
    },
  });
  const yahooNotFound = () => json({ chart: { result: null, error: { code: "Not Found" } } }, 404);
  const isYahoo = (url: string) => url.includes("finance/chart/");
  const isB3 = (url: string) => url.includes("GetListedSupplementFunds");
  const isCompany = (url: string) => url.includes("GetListedSupplementCompany");
  /** Resposta no formato da fonte que a URL pede: Yahoo para cotação, B3 para proventos e eventos. */
  const answer = (ticker: string, url: string, price: number) =>
    isYahoo(url)
      ? json(yahoo(ticker, price))
      : isCompany(url)
        ? json(company(ticker))
        : json({ cashDividends: [] });
  /** Código da carteira de teste a partir da raiz que a rota de empresas recebe. */
  const TICKER_OF_ROOT: Record<string, string> = {
    PETR: "PETR4",
    VALE: "VALE3",
    ITUB: "ITUB4",
    ABCD: "ABCD3",
    B3SA: "B3SA3",
  };

  function fakeFetch(handler: (ticker: string, url: string) => Response) {
    const calls: string[] = [];
    /** URLs que receberam alguma chave: nunca pode acontecer, as fontes são públicas. */
    const withToken: string[] = [];
    const fn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      // Câmbio fora destes testes: os blocos do histórico não têm nada aqui.
      if (url.includes("dataInicial")) return new Response("{}", { status: 404 });
      if (url.includes("bcdata.sgs")) return sgs();
      let ticker = /chart\/([A-Z0-9]+)\.SA/.exec(url)?.[1];
      if (isB3(url)) {
        // A B3 recebe o identificador do fundo (HGLG) em base64; os FIIs daqui terminam em 11.
        const payload = JSON.parse(
          Buffer.from(url.split("/GetListedSupplementFunds/")[1]!, "base64").toString(),
        ) as { identifierFund: string };
        ticker = `${payload.identifierFund}11`;
      }
      if (isCompany(url)) {
        const payload = JSON.parse(
          Buffer.from(url.split("/GetListedSupplementCompany/")[1]!, "base64").toString(),
        ) as { issuingCompany: string };
        ticker = TICKER_OF_ROOT[payload.issuingCompany] ?? `${payload.issuingCompany}3`;
      }
      if ((init?.headers as Record<string, string> | undefined)?.authorization) withToken.push(url);
      calls.push(url);
      return handler(ticker!, url);
    }) as typeof fetch;
    return { fn, calls, withToken };
  }
  const tickers = () => inC((tx) => tx.select().from(marketTickers));
  const resetChecks = () =>
    inC((tx) =>
      tx.execute(
        db.sql`update market_tickers set checked_at = 'epoch', retry_on = null, dividends_retry_on = null`,
      ),
    );

  describe("câmbio (ADR-0020)", () => {
    const urlsOf: string[] = [];
    const answer = (url: string) => {
      urlsOf.push(url);
      const from = /dataInicial=(\d{2})\/(\d{2})\/(\d{4})/.exec(url);
      if (!from) return sgs();
      return from[3] === "2026" && url.includes("sgs.21619")
        ? new Response("{}", { status: 404 })
        : json([{ data: `${from[1]}/${from[2]}/${from[3]}`, valor: "5.4212" }]);
    };
    const fetchFx = (async (input: string | URL | Request) =>
      answer(String(input))) as typeof fetch;

    it("carrega dez anos em blocos na primeira vez e depois só o que falta", async () => {
      const run = (date: string) =>
        agents.runMarketData({
          log: silent,
          activeDays: 60,
          fetch: fetchFx,
          pauseMs: 0,
          now: new Date(`${date}T15:00:00Z`),
        });
      await inC((tx) => tx.execute(db.sql`select 1`));
      const first = await run("2026-10-30");
      const blocks = urlsOf.filter((url) => url.includes("dataInicial"));
      expect(blocks.filter((url) => url.includes("sgs.1/"))).toHaveLength(6);
      expect(blocks.filter((url) => url.includes("sgs.21619/"))).toHaveLength(6);
      expect(blocks[0]).toContain("dataInicial=30/10/2016&dataFinal=29/10/2018");
      // Seis blocos de dólar, e euro sem nada no bloco de 2026.
      expect(first.fx).toBe(11);

      urlsOf.length = 0;
      const next = await run("2026-11-03");
      const again = urlsOf.filter((url) => url.includes("dataInicial"));
      // Dólar já tinha 30/10; euro retoma do último dia que ficou gravado.
      expect(again.filter((url) => url.includes("sgs.1/"))).toEqual([
        expect.stringContaining("dataInicial=31/10/2026&dataFinal=03/11/2026"),
      ]);
      expect(again.filter((url) => url.includes("sgs.21619/"))).toHaveLength(2);
      // Um dia de dólar e o bloco de euro de 2024; o de 2026 não tem nada.
      expect(next.fx).toBe(2);
    });

    it("cotação gravada não muda", async () => {
      const row = { currency: "USD" as const, date: "2020-02-03", rate: "4.2", source: "teste" };
      await db.saveMarketFx([{ ...row, rate: "4.20000000" }]);
      expect(await db.saveMarketFx([{ ...row, rate: "9.00000000" }])).toBe(0);
      const quote = await inC((tx) => db.fxRateOn(tx, "USD", "2020-02-03"));
      expect(quote).toEqual({ rate: "4.20000000", date: "2020-02-03" });
    });

    it("família em real não recebe nada do câmbio no saldo", async () => {
      const { fx, accounts: rows } = await inC((tx) => db.accountBalances(tx));
      expect(fx).toBeNull();
      for (const row of rows) expect(row.balance).toBe(row.nativeBalance);
    });

    it("não há cotação no intervalo: lista vazia, não erro", async () => {
      const empty = (async () => new Response("{}", { status: 404 })) as typeof fetch;
      expect(
        await agents.fetchFxSeries("USD", "2026-10-31", "2026-11-01", {
          today: day,
          fetch: empty,
        }),
      ).toEqual([]);
    });

    it("lê o formato do SGS e guarda 8 casas", async () => {
      const real = (async () => json([{ data: "30/10/2026", valor: "6.0522000" }])) as typeof fetch;
      expect(
        await agents.fetchFxSeries("EUR", "2026-10-30", "2026-10-30", { today: day, fetch: real }),
      ).toEqual([{ currency: "EUR", date: "2026-10-30", rate: "6.05220000", source: "bcb.sgs" }]);
    });

    it("janela recusada pela fonte é falha da rodada, e a seguinte retoma", async () => {
      const refused = (async () => new Response("{}", { status: 406 })) as typeof fetch;
      await expect(
        agents.fetchFxSeries("USD", "2014-01-01", "2026-10-30", { today: day, fetch: refused }),
      ).rejects.toMatchObject({ code: "servidor" });
    });
  });

  it("cotação vem do Yahoo; proventos e eventos de ação vêm da B3, no valor pago na data (ADR-0035)", async () => {
    const { fn, calls, withToken } = fakeFetch((ticker, url) => answer(ticker, url, 40));
    const result = await agents.runMarketData({
      log: silent,
      activeDays: 60,
      fetch: fn,
      pauseMs: 0,
    });
    // PETR4, VALE3, ITUB4 e ABCD3: cada um uma cotação no Yahoo e uma consulta à lista de empresas.
    expect(calls.filter(isYahoo)).toHaveLength(4);
    expect(calls.filter(isCompany)).toHaveLength(4);
    expect(calls).toHaveLength(8);
    expect(calls.some((url) => url.includes("ABCD3.SA"))).toBe(true);
    expect(withToken).toEqual([]);
    expect(result).toMatchObject({
      quotes: 4,
      dividends: 4,
      stockEvents: 4,
      unknown: 0,
      failed: 0,
    });
    const [stored] = await inC((tx) =>
      tx.select().from(marketQuotes).where(eq(marketQuotes.ticker, "PETR4")),
    );
    // Variação calculada do fechamento anterior (39 → 40), horário do pregão em segundos.
    expect(stored).toMatchObject({
      source: "yahoo",
      price: "40.00000000",
      changePercent: "2.5641",
      quotedAt: new Date(closedAt * 1000),
      lastStockEventOn: "2026-09-01",
      lastStockEventNote: "Desdobramento de 2 para 1",
    });
    const at = new Date(closedAt * 1000);
    expect(await db.listMarketQuoteHistory("PETR4", at, at)).toMatchObject([
      { price: "40.00000000", source: "yahoo" },
    ]);
    const rows = await inC((tx) =>
      tx.select().from(marketDividends).where(eq(marketDividends.payDate, "2026-12-30")),
    );
    // Só a classe do código: a PNA da mesma emissora e o JCP sem data ficam de fora.
    const own = rows.filter((row) => row.ticker === "PETR4");
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      kind: "dividendo",
      comDate: "2026-08-21",
      ratePerShare: "1.00000000",
      source: "b3",
    });
    const stockEvents = await inC((tx) =>
      tx.select().from(marketStockEvents).where(eq(marketStockEvents.ticker, "PETR4")),
    );
    expect(stockEvents).toHaveLength(1);
    expect(stockEvents[0]).toMatchObject({
      comDate: "2026-09-01",
      factor: "2.00000000",
      note: "Desdobramento de 2 para 1",
      source: "b3",
    });
    const indices = await inC((tx) => tx.select().from(marketIndices));
    expect(indices.map((row) => row.code).sort()).toEqual(["CDI", "IPCA", "SELIC"]);
    expect(indices[0]).toMatchObject({ date: "2026-10-29", value: "0.05078800" });
  });

  it("catálogo guarda ação, FII, ETF e BDR, e a busca acha por código e por nome", async () => {
    const stocks = [
      {
        stock: "FICT3",
        name: "FICTICIA S.A.",
        close: 12.5,
        sector: "Finance",
        type: "stock",
        subType: "stock",
      },
      { stock: "FICT11", name: "FICTICIA LOG FUNDO", close: 100, type: "fund", subType: "fii" },
      { stock: "FETF11", name: "ISHARES FICTICIO", close: 50, type: "fund", subType: "etf" },
      { stock: "FBDR34", name: "BDR FICTICIO", close: 30, type: "bdr", subType: "bdr" },
      { stock: "FFIP11", name: "FIP FICTICIO", close: 9, type: "fund", subType: "fip" },
      { stock: "NADA4F", name: "CODIGO FRACIONARIO", close: 1, type: "stock", subType: "stock" },
    ];
    const fn = (async (input: string | URL | Request) => {
      if (String(input).includes("bcdata.sgs")) return sgs();
      if (String(input).includes("quote/list")) return json({ stocks, hasNextPage: false });
      return json({}, 404);
    }) as typeof fetch;
    const result = await agents.runMarketData({
      log: silent,
      activeDays: 60,
      fetch: fn,
      pauseMs: 0,
      catalog: true,
    });
    expect(result.assets).toBe(4);
    const byCode = await db.searchMarketAssets("fict");
    expect(byCode.map((row) => row.ticker).slice(0, 2)).toEqual(["FICT11", "FICT3"]);
    expect(byCode.find((row) => row.ticker === "FICT11")).toMatchObject({ assetClass: "fii" });
    const byName = await db.searchMarketAssets("ishares");
    expect(byName).toEqual([expect.objectContaining({ ticker: "FETF11", assetClass: "etf_bdr" })]);
    expect(await db.searchMarketAssets("%")).toEqual([]);
    expect(await db.searchMarketAssets("F_CT")).toEqual([]);
    expect((await db.findMarketAsset("FBDR34"))?.assetClass).toBe("etf_bdr");
    expect(await db.findMarketAsset("FFIP11")).toBeNull();
  });

  it("não repete ticker consultado há pouco", async () => {
    const { fn, calls } = fakeFetch((ticker, url) => answer(ticker, url, 40));
    await agents.runMarketData({ log: silent, activeDays: 60, fetch: fn, pauseMs: 0 });
    expect(calls).toHaveLength(0);
  });

  it("ticker desconhecido fica registrado; falha de um não para os outros", async () => {
    await resetChecks();
    const { fn, calls, withToken } = fakeFetch((ticker, url) => {
      if (isYahoo(url) && ticker === "ABCD3") return yahooNotFound();
      if (isYahoo(url) && ticker === "PETR4") return json({ error: true }, 500);
      return answer(ticker, url, 41);
    });
    const result = await agents.runMarketData({
      log: silent,
      activeDays: 60,
      fetch: fn,
      pauseMs: 0,
    });
    expect(result).toMatchObject({ unknown: 1, failed: 1, quotes: 2 });
    // Quatro no Yahoo; só quem tem cotação segue para os proventos na B3.
    expect(calls.filter(isYahoo)).toHaveLength(4);
    expect(calls.filter(isCompany)).toHaveLength(2);
    expect(withToken).toEqual([]);
    const rows = await tickers();
    expect(rows.find((row) => row.ticker === "ABCD3")).toMatchObject({
      status: "desconhecido",
      errorCode: "nao_encontrado",
    });
    expect(rows.find((row) => row.ticker === "PETR4")!.status).toBe("falha");

    const next = fakeFetch((ticker, url) => answer(ticker, url, 42));
    await agents.runMarketData({ log: silent, activeDays: 60, fetch: next.fn, pauseMs: 0 });
    expect(next.calls.some((url) => url.includes("ABCD3"))).toBe(false);
    expect(next.calls.some((url) => url.includes("PETR4"))).toBe(true);
  });

  it("rendimento de FII vem da B3 uma vez por dia; a rodada de hora em hora só traz cotação", async () => {
    // Os FIIs nunca foram consultados: entram na rodada completa mesmo com os outros recentes.
    await inC(async (tx) => {
      await tx.execute(db.sql`update market_tickers set checked_at = now()`);
      await tx.insert(investments).values([
        { householdId: C.household, name: "Fundo", ticker: "HGLG11", assetClass: "fii" },
        { householdId: C.household, name: "Outro fundo", ticker: "KNRI11", assetClass: "fii" },
      ]);
    });
    const b3 = {
      cashDividends: [
        {
          label: "RENDIMENTO",
          lastDatePrior: "30/10/2026",
          paymentDate: "16/11/2026",
          rate: "1,20000000000",
        },
        {
          label: "AMORTIZACAO",
          lastDatePrior: "30/10/2026",
          paymentDate: "16/11/2026",
          rate: "2,0",
        },
        { label: "RENDIMENTO", lastDatePrior: "29/09/2026", paymentDate: null, rate: "1,0" },
      ],
    };
    const { fn, calls, withToken } = fakeFetch((ticker, url) => {
      if (isB3(url)) return json(JSON.stringify(b3));
      return answer(ticker, url, 150);
    });
    const full = await agents.runMarketData({
      log: silent,
      activeDays: 60,
      fetch: fn,
      pauseMs: 0,
    });
    expect(calls).toHaveLength(4);
    expect(calls.filter(isYahoo)).toEqual([
      expect.stringContaining("finance/chart/HGLG11.SA"),
      expect.stringContaining("finance/chart/KNRI11.SA"),
    ]);
    expect(calls.filter(isB3)).toHaveLength(2);
    expect(withToken).toEqual([]);
    expect(full).toMatchObject({ quotes: 2, dividends: 2, failed: 0 });
    const rows = await inC((tx) =>
      tx.select().from(marketDividends).where(eq(marketDividends.ticker, "HGLG11")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "rendimento",
      comDate: "2026-10-30",
      payDate: "2026-11-16",
      ratePerShare: "1.20000000",
      source: "b3",
    });
    const hglg = (await tickers()).find((row) => row.ticker === "HGLG11")!;
    expect(hglg.status).toBe("ok");
    // Amanhã: a B3 só é consultada de novo na rodada completa do dia seguinte.
    expect(hglg.dividendsRetryOn! > domain.todayIn(domain.MARKET_RULES.timezone)).toBe(true);

    // Rodada de hora em hora (ADR-0033): só cotação, sem índices, câmbio, catálogo nem proventos.
    await inC((tx) => tx.execute(db.sql`update market_tickers set checked_at = 'epoch'`));
    const hourly = fakeFetch((ticker, url) => answer(ticker, url, 151));
    const quotes = await agents.runMarketData({
      log: silent,
      mode: "quotes",
      catalog: true,
      activeDays: 60,
      fetch: hourly.fn,
      pauseMs: 0,
    });
    // ABCD3 é desconhecido e espera os 30 dias; os outros cinco entram.
    expect(hourly.calls.every(isYahoo)).toBe(true);
    expect(hourly.calls).toHaveLength(5);
    expect(quotes).toMatchObject({ quotes: 5, dividends: 0, indices: 0, fx: 0, assets: 0 });
    // Mesma cotação repetida (bolsa fechada) não duplica o histórico.
    const at = new Date(closedAt * 1000);
    expect(await db.listMarketQuoteHistory("HGLG11", at, at)).toHaveLength(1);
    const soon = fakeFetch((ticker, url) => answer(ticker, url, 152));
    await agents.runMarketData({
      log: silent,
      mode: "quotes",
      activeDays: 60,
      fetch: soon.fn,
      pauseMs: 0,
    });
    // Consultados há menos de 50 minutos (checked_at é o relógio do banco): ninguém entra.
    expect(soon.calls).toHaveLength(0);
  });

  it("registra só contagens em ops, com o nome do job", async () => {
    const runs = await db.listAgentRuns(5);
    const row = runs.find((item) => item.agent === agents.MERCADO_AGENT);
    expect(row).toBeDefined();
    expect(row!.households).toBeGreaterThanOrEqual(1);
  });

  it("família inativa não entra na coleta", async () => {
    await db.withWorkerHousehold(D.household, (tx) =>
      tx.insert(investments).values({
        householdId: D.household,
        name: "Parado",
        ticker: "ZZZZ3",
        assetClass: "acao",
      }),
    );
    await inC((tx) => tx.execute(db.sql`update market_tickers set checked_at = now()`));
    const { fn, calls } = fakeFetch((ticker, url) => answer(ticker, url, 40));
    await agents.runMarketData({ log: silent, activeDays: 60, fetch: fn, pauseMs: 0 });
    expect(calls.some((url) => url.includes("ZZZZ3"))).toBe(false);
  });

  it("código com dígito entra no catálogo, na coleta e na carteira, como qualquer outro", async () => {
    const stocks = [
      { stock: "B3SA3", name: "B3 S.A.", close: 12, type: "stock", subType: "stock" },
      { stock: "M1TA34", name: "META BDR", close: 30, type: "bdr", subType: "bdr" },
    ];
    const list = (async (input: string | URL | Request) => {
      if (String(input).includes("bcdata.sgs")) return sgs();
      if (String(input).includes("quote/list")) return json({ stocks, hasNextPage: false });
      return json({}, 404);
    }) as typeof fetch;
    const catalog = await agents.runMarketData({
      log: silent,
      activeDays: 60,
      fetch: list,
      pauseMs: 0,
      catalog: true,
    });
    expect(catalog.assets).toBe(2);
    expect((await db.findMarketAsset("B3SA3"))?.assetClass).toBe("acao");
    expect((await db.findMarketAsset("M1TA34"))?.assetClass).toBe("etf_bdr");

    const [holding] = await inC((tx) =>
      tx
        .insert(investments)
        .values({ householdId: C.household, name: "B3", ticker: "B3SA3", assetClass: "acao" })
        .returning({ id: investments.id }),
    );
    await inC((tx) =>
      tx.insert(investmentTrades).values({
        householdId: C.household,
        investmentId: holding!.id,
        side: "compra",
        occurredOn: "2026-01-05",
        quantity: "10",
        unitPrice: "10",
        fees: "0.00",
      }),
    );
    const { fn, calls } = fakeFetch((ticker, url) => answer(ticker, url, 40));
    const collected = await agents.runMarketData({
      log: silent,
      activeDays: 60,
      fetch: fn,
      pauseMs: 0,
    });
    expect(calls.some((url) => url.includes("B3SA3.SA"))).toBe(true);
    // A cotação, o histórico (migração 0045) e os proventos entram na mesma rodada, sem "falha".
    expect(collected).toMatchObject({ failed: 0 });
    expect((await tickers()).find((row) => row.ticker === "B3SA3")).toMatchObject({ status: "ok" });
    const at = new Date(closedAt * 1000);
    expect(await db.listMarketQuoteHistory("B3SA3", at, at)).toMatchObject([
      { price: "40.00000000", source: "yahoo" },
    ]);
    await run();
    const [asset] = await inC((tx) =>
      tx.select().from(investments).where(eq(investments.id, holding!.id)),
    );
    expect(asset).toMatchObject({ priceSource: "mercado", currentPrice: "40.00000000" });
    const paid = await inC((tx) =>
      tx.select().from(dividends).where(eq(dividends.investmentId, holding!.id)),
    );
    expect(paid).toMatchObject([{ source: "agente", paidOn: "2026-12-30", gross: "10.00" }]);
    // O banco continua recusando o que não é código.
    await expect(db.saveMarketQuote(quoteRow("CPF123", "1.00000000"))).rejects.toThrow();
  });
});
