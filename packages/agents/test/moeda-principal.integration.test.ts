// Agentes diários com família em dólar (ADR-0020, Fase 6), pela conexão do worker, como em produção.
// Nada de INSS nem de B3, e todo texto de reserva na moeda da família. Dados fictícios.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TenantTx } from "@organizeup/db";

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

const today = domain.todayIn();
const id = "hh-agentes-usd";
const owner = "user-agentes-usd";
const input = { today, householdId: id };
const inFamily = <T>(fn: (tx: TenantTx) => Promise<T>) => db.withWorkerHousehold(id, fn);

let account = "";
let goalId = "";

beforeAll(async () => {
  await db.withAdmin("seed do teste de agentes em dólar", async (admin) => {
    await admin.insert(db.user).values({ id: owner, name: "Ana", email: `${owner}@example.com` });
    await admin.insert(db.household).values({ id, name: "Família USD", slug: id });
    await admin
      .insert(db.householdMember)
      .values({ id: `m-${id}`, organizationId: id, userId: owner, role: "owner" });
    await admin.insert(db.session).values({
      id: `s-${id}`,
      userId: owner,
      token: `token-${id}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  });
  await inFamily(async (tx) => {
    await tx.insert(db.householdSettings).values({
      householdId: id,
      mainCurrency: "USD",
      retirementYear: 2050,
      tripsPerYear: 2,
    });
    await tx.insert(db.people).values({
      householdId: id,
      name: "Titular",
      relation: "titular",
      userId: owner,
      birthYear: 1980,
      birthMonth: 1,
      expectedPension: "3000.00",
      inssContributor: true,
    });
    await db.ensureFinanceDefaults(tx, id);
    const [main] = await tx.select().from(db.accounts);
    account = main!.id;
    const [category] = await tx
      .select({ id: db.categories.id })
      .from(db.categories)
      .where(db.eq(db.categories.kind, "receita"))
      .limit(1);
    const [expense] = await tx
      .select({ id: db.categories.id })
      .from(db.categories)
      .where(db.eq(db.categories.kind, "despesa"))
      .limit(1);
    await tx.insert(db.transactions).values([
      {
        householdId: id,
        accountId: account,
        categoryId: category!.id,
        kind: "receita",
        description: "Salário",
        amount: "9000.00",
        occurredOn: today,
      },
      {
        householdId: id,
        accountId: account,
        categoryId: expense!.id,
        kind: "despesa",
        description: "Aluguel",
        amount: "2000.00",
        occurredOn: today,
      },
    ]);
    const [goal] = await tx
      .insert(db.goals)
      .values({
        householdId: id,
        name: "Carro",
        kind: "outro",
        targetAmount: "90000.00",
        desiredMonth: "2027-01",
      })
      .returning({ id: db.goals.id });
    goalId = goal!.id;
    await tx.insert(db.investments).values({
      householdId: id,
      name: "Fundo no exterior",
      assetClass: "exterior",
      currentValue: "50000.00",
      valuedOn: today,
    });
    await tx.insert(db.emergencyFund).values({
      householdId: id,
      targetMonths: 6,
      monthlyAmount: "2000.00",
    });
  });
});

afterAll(() => db.closeAllPools());

const suggestions = () => inFamily((tx) => tx.select().from(db.householdSuggestions));

const money = (value: unknown): string[] =>
  JSON.stringify(value).match(/"money":"[^"]+"(,"currency":"[A-Z]{3}")?/g) ?? [];

describe("rodada do dia em dólar", () => {
  it("aposentadoria não soma INSS, e o aporte sai em dólar", async () => {
    const result = await inFamily((tx) => agents.runAposentadoriaAgent(tx, input));
    expect(result.plan.otherIncome).toBe("0.00");
    expect(result.plan.pensionsLater).toEqual([]);
    expect(JSON.stringify(result.plan.notes)).not.toContain("INSS");
    expect(result.report.summary).toContain("US$");
    expect(result.report.summary).not.toContain("R$");
    const rows = await suggestions();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(`${row.title} ${row.body}`).not.toContain("R$");
      for (const value of money(row.messageParams)) expect(value).toContain('"currency":"USD"');
    }
  });

  it("o plano continua vendo a pensão guardada, sem apagar", async () => {
    const [person] = await inFamily((tx) => tx.select().from(db.people));
    expect(person?.expectedPension).toBe("3000.00");
  });

  it("investimentos não busca B3, e o relatório sai em dólar", async () => {
    await inFamily(async (tx) => {
      await tx.insert(db.investments).values({
        householdId: id,
        name: "Sobrou de antes",
        ticker: "PETR4",
        assetClass: "acao",
      });
    });
    const result = await inFamily((tx) => agents.runInvestimentosAgent(tx, input));
    expect(result.applied).toBe(0);
    expect(result.report.summary).toContain("US$");
    expect(result.report.summary).not.toContain("R$");
    const [row] = await inFamily((tx) =>
      tx.select().from(db.investments).where(db.eq(db.investments.ticker, "PETR4")),
    );
    expect(row?.priceSource).toBe("familia");
    await inFamily((tx) => tx.delete(db.investments).where(db.eq(db.investments.ticker, "PETR4")));
  });

  it("metas e dívidas rodam na moeda da família", async () => {
    const metas = await inFamily((tx) => agents.runMetasAgent(tx, input));
    expect(metas.report.summary).not.toContain("R$");
    const [goal] = await inFamily((tx) =>
      tx.select().from(db.goals).where(db.eq(db.goals.id, goalId)),
    );
    expect(goal?.planNote ?? "").not.toContain("R$");
    const dividas = await inFamily((tx) => agents.runDividasAgent(tx, input));
    expect(dividas.report.summary).not.toContain("R$");
  });

  it("viagens não sugere destino da tabela em reais", async () => {
    const result = await inFamily((tx) => agents.runViagensAgent(tx, input));
    expect(result.suggestions).toBe(0);
    expect(result.report.message.params).toBeTruthy();
    expect(JSON.stringify(result.report.message)).toContain("relViagensForaDoBrasil");
  });

  it("rodar duas vezes dá o mesmo resultado", async () => {
    const before = (await suggestions()).length;
    await inFamily((tx) => agents.runAposentadoriaAgent(tx, input));
    await inFamily((tx) => agents.runInvestimentosAgent(tx, input));
    expect((await suggestions()).length).toBe(before);
  });

  it("a notificação de categoria leva a moeda", () => {
    const text = agents.notificationText(
      {
        type: "alteracao",
        merchant: "MERCADO X",
        count: 2,
        total: "80.00",
        fromNames: ["Outras despesas"],
        toName: "Mercado",
      },
      "USD",
    );
    expect(text.body).toContain("US$");
    expect(money(text.message)).toEqual(['"money":"80.00","currency":"USD"']);
  });

  it("a coleta de mercado não pede código de família em dólar", async () => {
    const asked: string[] = [];
    await inFamily(async (tx) => {
      await tx.insert(db.investments).values({
        householdId: id,
        name: "Sobrou de antes",
        ticker: "VALE3",
        assetClass: "acao",
      });
    });
    await agents.runMarketData({
      activeDays: 60,
      log: { error: () => undefined, info: () => undefined, warn: () => undefined },
      pauseMs: 0,
      token: "teste",
      fetch: (async (url: string | URL | Request) => {
        asked.push(String(url));
        return new Response("[]", { status: 200 });
      }) as typeof fetch,
    });
    expect(asked.join(" ")).not.toContain("VALE3");
    await inFamily((tx) => tx.delete(db.investments).where(db.eq(db.investments.ticker, "VALE3")));
  });
});
