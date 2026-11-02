// Família de prova do ADR-0027, contra um Postgres real com RLS e com os agentes de verdade, rodando
// duas vezes. A família é a mesma antes e depois: "antes" é a conta com `NO_SAVINGS`, e os números vão,
// linha a linha, para o fim do ADR. Dados fictícios.
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
const agents = await import("../src/index");
const domain = await import("@organizeup/domain");

const { accounts, and, categories, categoryTemplates, emergencyFund, eq, goalContributions } = db;
const { goals, household, householdMember, householdSettings, householdStatements } = db;
const { householdSuggestions, investments, investmentTrades, people, retirementPlan } = db;
const { transactions, user } = db;

const TODAY = "2026-11-02";
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

let family = "";
const inFamily = <T>(fn: (tx: TenantTx) => Promise<T>) => db.withWorkerHousehold(family, fn);

async function categoryId(name: string, kind: "receita" | "despesa", tx: TenantTx) {
  return (await db.ensureCategory(tx, family, kind, name, false)).id;
}

/**
 * Família Exemplo: salário de 10.000, moradia e mercado essenciais, lazer, aporte de 3.000 todo mês por
 * operação e parcela de meta de 300. Em outubro, um resgate de 1.000 que volta à conta e um aporte em
 * dólar: US$ 100 a 5,40, ou 540 na moeda principal. Aporte foi marcado como essencial de propósito, para
 * provar que a reserva não conta com ele.
 */
async function seedFamily() {
  family = "hh-prova-aporte";
  const owner = "user-prova-aporte";
  await db.withAdmin("seed da família de prova", async (admin) => {
    await admin.insert(user).values({ id: owner, name: "Pessoa", email: `${owner}@example.com` });
    await admin.insert(household).values({ id: family, name: "Exemplo", slug: family });
    await admin
      .insert(householdMember)
      .values({ id: `m-${family}`, organizationId: family, userId: owner, role: "owner" });
  });
  await inFamily(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: family });
    await tx.insert(people).values({
      householdId: family,
      name: "Titular",
      relation: "titular",
      birthYear: 1980,
      birthMonth: 1,
    });
    await db.ensureFinanceDefaults(tx, family);
    const [main] = await tx.select().from(accounts);
    const [dollars] = await tx
      .insert(accounts)
      .values({ householdId: family, name: "Conta em dólar", currency: "USD" })
      .returning();
    const salary = await categoryId("Salário", "receita", tx);
    const home = await categoryId("Moradia", "despesa", tx);
    const market = await categoryId("Mercado", "despesa", tx);
    const leisure = await categoryId("Lazer", "despesa", tx);
    const contribution = await categoryId(domain.CONTRIBUTION_CATEGORY, "despesa", tx);
    const redemption = await categoryId(domain.CONTRIBUTION_CATEGORY, "receita", tx);
    const goalCategory = await categoryId(domain.GOAL_CATEGORY, "despesa", tx);
    await tx.update(categories).set({ essential: true }).where(eq(categories.id, contribution));
    await tx.insert(retirementPlan).values({
      householdId: family,
      targetIncome: "9000.00",
      expectedYield: "6.00",
    });
    await tx.insert(emergencyFund).values({ householdId: family, targetMonths: 6 });
    const [asset] = await tx
      .insert(investments)
      .values({
        householdId: family,
        name: "CDB de prova",
        assetClass: "renda_fixa",
        currentValue: "18000.00",
        valuedOn: "2026-10-31",
      })
      .returning();
    const [goal] = await tx
      .insert(goals)
      .values({
        householdId: family,
        name: "Reforma",
        kind: "reforma",
        targetAmount: "10000.00",
        saved: "1800.00",
        status: "juntando",
        accountId: main!.id,
      })
      .returning();

    const insert = async (
      kind: "receita" | "despesa",
      category: string,
      amount: string,
      occurredOn: string,
      over: Record<string, unknown> = {},
    ) => {
      const [row] = await tx
        .insert(transactions)
        .values({
          householdId: family,
          accountId: main!.id,
          categoryId: category,
          kind,
          description: "Lançamento de prova",
          amount,
          occurredOn,
          categorySource: "familia",
          ...over,
        })
        .returning({ id: transactions.id });
      return row!.id;
    };
    const trade = async (side: "compra" | "venda", amount: string, on: string, cash: string) => {
      await tx.insert(investmentTrades).values({
        householdId: family,
        investmentId: asset!.id,
        side,
        occurredOn: on,
        quantity: amount,
        unitPrice: "1",
        transactionId: cash,
      });
    };

    for (const month of MONTHS) {
      await insert("receita", salary, "10000.00", `${month}-05`);
      await insert("despesa", home, "3000.00", `${month}-06`);
      await insert("despesa", market, "2000.00", `${month}-07`);
      await insert("despesa", leisure, "1000.00", `${month}-08`);
      const aporte = await insert("despesa", contribution, "3000.00", `${month}-10`);
      await trade("compra", "3000.00", `${month}-10`, aporte);
      const parcela = await insert("despesa", goalCategory, "300.00", `${month}-11`);
      await tx.insert(goalContributions).values({
        householdId: family,
        goalId: goal!.id,
        month,
        amount: "300.00",
        transactionId: parcela,
      });
    }
    const resgate = await insert("receita", redemption, "1000.00", "2026-10-20");
    await trade("venda", "1000.00", "2026-10-20", resgate);
    const dolar = await insert("despesa", contribution, "540.00", "2026-10-21", {
      accountId: dollars!.id,
      originalAmount: "100.00",
      originalCurrency: "USD",
      fxRate: "5.40000000",
    });
    await trade("compra", "540.00", "2026-10-21", dolar);
  });
}

const octoberEntries = (tx: TenantTx) =>
  tx
    .select()
    .from(transactions)
    .where(
      and(
        db.gte(transactions.occurredOn, "2026-10-01"),
        db.lte(transactions.occurredOn, "2026-10-31"),
      ),
    );

const runAgents = (today: string) =>
  inFamily(async (tx) => {
    const input = { today, householdId: family };
    const retirement = await agents.runAposentadoriaAgent(tx, input);
    await agents.runMetasAgent(tx, { ...input, allocation: retirement.allocation });
    return { retirement, statements: await agents.runRelatoriosAgent(tx, input) };
  });

const figure = (data: { figures: Array<{ id: string; value: unknown }> }, id: string) =>
  data.figures.find((item) => item.id === id)?.value;

beforeAll(async () => {
  await seedFamily();
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("família de prova", () => {
  it("os modelos do banco têm a posição que a regra usa", async () => {
    const rows = await inFamily((tx) => tx.select().from(categoryTemplates));
    const position = (id: string) => rows.find((row) => row.id === id)?.position;
    const { goal, investment } = domain.SAVINGS_TEMPLATE_POSITION;
    expect([position("d-metas"), position("r-metas"), position("d-aportes")]).toEqual([
      goal,
      goal,
      investment,
    ]);
    const others = rows.filter((row) => !["d-metas", "r-metas", "d-aportes"].includes(row.id));
    expect(others.some((row) => row.position === goal || row.position === investment)).toBe(false);
  });

  it("outubro, antes e depois: sai o aporte da despesa e o resgate da receita", async () => {
    const { rule, rows } = await inFamily(async (tx) => ({
      rule: await agents.loadSavingsRule(tx),
      rows: await octoberEntries(tx),
    }));
    const entries = domain.buildMonthEntries("2026-10", [], rows);
    const before = domain.summarizeMonth(entries, domain.NO_SAVINGS);
    const after = domain.summarizeMonth(entries, rule);
    expect(before).toMatchObject({ received: "11000.00", spent: "9840.00", balance: "1160.00" });
    expect(after).toMatchObject({
      received: "10000.00",
      spent: "6000.00",
      balance: "4000.00",
      contributed: "3840.00",
      redeemed: "1000.00",
      afterContributions: "160.00",
    });
  });

  it("excedente, reserva e aposentadoria, rodando duas vezes", async () => {
    const first = await runAgents(TODAY);
    const second = await runAgents(TODAY);
    expect(second.retirement.allocation).toEqual(first.retirement.allocation);
    expect(second.retirement.plan).toEqual(first.retirement.plan);

    const { reserve, surplus, plan, suggestions } = await inFamily(async (tx) => ({
      reserve: await agents.reserveInputs(tx, { today: TODAY }),
      surplus: await agents.surplusInputs(tx, { today: TODAY }),
      plan: await agents.currentDividendPlan(tx, TODAY),
      suggestions: await tx
        .select()
        .from(householdSuggestions)
        .where(eq(householdSuggestions.status, "pendente")),
    }));

    // Excedente e gasto médio não mudam: já vinham sem aporte. O que muda é saber o que já foi aportado.
    expect(surplus.surplus).toBe("4000.00");
    expect(surplus.averageExpenses12).toBe("6000.00");
    // Hábito: outubro líquido foi 2.540 (3.000 + 540 − 1.000), e a média dos seis meses é 2.923,33.
    expect(surplus.invested).toBe("2923.33");

    // Reserva: aporte marcado como essencial não infla o alvo; moradia + mercado = 5.000 por mês.
    expect(reserve.baseline).toEqual({ monthly: "5000.00", basis: "media", months: 3 });
    expect(reserve.status.target).toBe("30000.00");
    // Antes, com aporte marcado como essencial, a média de agosto a outubro era 8.180,00.
    const antesDaRegra = await inFamily(async (tx) => {
      const essential = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.essential, true));
      const rows = await tx.select().from(transactions);
      return ["2026-08", "2026-09", "2026-10"].map((month) =>
        domain.essentialSpending(
          rows.filter((row) => row.occurredOn.startsWith(month)),
          [],
          new Set(essential.map((row) => row.id)),
          domain.NO_SAVINGS,
        ),
      );
    });
    expect(domain.essentialBaseline(antesDaRegra, "0.00", null).monthly).toBe("8180.00");

    const antes = domain.suggestAllocation({
      available: domain.availableToAllocate(surplus.surplus),
      reserveMissing: reserve.status.missing,
      expensiveDebtBalance: "0.00",
      retirementRequired: plan.plan.requiredContribution,
      confirmedTripsMonthly: "0.00",
    });
    const depois = plan.allocation;
    expect(antes).toMatchObject({
      reserve: "1800.00",
      retirement: "1260.00",
      goalsBudget: "270.00",
      tripsBudget: "270.00",
    });
    // O que passa dos 1.260 da fatia sai de metas e viagens e, por último, da reserva.
    expect(depois).toMatchObject({
      reserve: "676.67",
      retirement: "2923.33",
      alreadyInvesting: "2923.33",
      goalsBudget: "0.00",
      tripsBudget: "0.00",
    });
    // Soma das fatias é o disponível: 3.600. O dinheiro de hoje não é dividido duas vezes.
    expect(domain.money(depois.reserve).plus(depois.retirement).toFixed(2)).toBe("3600.00");
    // A projeção passa a usar o aporte real, que a família não informou.
    expect(plan.contribution).toBe("2923.33");
    // Não sugere aportar o que já é aportado, e o que a família informou continua intocado.
    expect(suggestions.filter((row) => row.kind === "aporte_investimento")).toEqual([]);
    const [saved] = await inFamily((tx) => tx.select().from(retirementPlan));
    expect(saved).toMatchObject({ targetIncome: "9000.00", monthlyContribution: null });
  });

  it("o plano do mês não sugere cortar aporte como se fosse gasto", async () => {
    const view = await inFamily((tx) => agents.monthlyPlanView(tx, TODAY));
    const cut = view.actions.find((action) => action.kind === "gasto");
    if (cut) expect(cut.category).toBe("Moradia");
  });

  it("categoria renomeada continua sendo aporte, sem mudar nenhum número", async () => {
    const rename = (name: string, from: string) =>
      inFamily((tx) =>
        tx
          .update(categories)
          .set({ name })
          .where(and(eq(categories.name, from), eq(categories.kind, "despesa"))),
      );
    await rename("Investments", domain.CONTRIBUTION_CATEGORY);
    await rename("Mi ahorro", domain.GOAL_CATEGORY);
    // O painel recria o nome de sistema: as duas ficam valendo.
    await inFamily((tx) => db.ensureFinanceDefaults(tx, family));
    const { rule, rows } = await inFamily(async (tx) => ({
      rule: await agents.loadSavingsRule(tx),
      rows: await octoberEntries(tx),
    }));
    expect(rule.investmentCategories.size).toBe(3);
    const summary = domain.summarizeMonth(domain.buildMonthEntries("2026-10", [], rows), rule);
    expect(summary).toMatchObject({ spent: "6000.00", contributed: "3840.00" });
  });
});

describe("relatórios já fechados", () => {
  const closedRow = (kind: "resumo" | "categorias" | "metas", period: string) =>
    inFamily(async (tx) => (await agents.readStatement(tx, kind, period))!);

  it("regenera uma vez, com aviso, sem parágrafo velho e sem gastar modelo", async () => {
    await runAgents("2026-11-03");
    // Como estava antes desta versão: regra 1, assinatura antiga e um parágrafo escrito pelo modelo.
    const narrated = new Date("2026-11-01T06:00:00Z");
    await inFamily(async (tx) => {
      const rows = await tx.select().from(householdStatements);
      for (const row of rows) {
        if (row.status !== "fechado") continue;
        const ruled = domain.SAVINGS_STATEMENT_KINDS.includes(row.kind);
        await tx
          .update(householdStatements)
          .set({
            ...(ruled
              ? { data: { ...row.data, version: 1, notes: [] }, sourceHash: "assinatura-antiga" }
              : {}),
            narratedAt: narrated,
            whatChanged: "As despesas foram de 9.840,00.",
            whatChangedLocale: "pt-BR",
            revisedAt: null,
          })
          .where(eq(householdStatements.id, row.id));
      }
    });
    const firstRun = await runAgents("2026-11-04");
    expect(firstRun.statements.applied).toBeGreaterThan(0);

    const resumo = await closedRow("resumo", "2026-10");
    expect(resumo.data.version).toBe(2);
    expect(resumo.data.notes).toContain("aporteSeparado");
    expect(figure(resumo.data, "spent")).toEqual({ money: "6000.00" });
    expect(figure(resumo.data, "contributed")).toEqual({ money: "3840.00" });
    expect(figure(resumo.data, "redeemed")).toEqual({ money: "1000.00" });
    expect(figure(resumo.data, "afterContributions")).toEqual({ money: "160.00" });
    expect(resumo.revisedAt).not.toBeNull();
    expect(resumo.whatChanged).toBeNull();
    // `narrated_at` fica: a regeneração não pede parágrafo novo ao modelo.
    expect(resumo.narratedAt).toEqual(narrated);

    const categorias = await closedRow("categorias", "2026-10");
    expect(figure(categorias.data, "total")).toEqual({ money: "6000.00" });
    expect(figure(categorias.data, "contributed")).toEqual({ money: "3840.00" });

    // Tipo que a regra não muda fica como estava: nem "atualizado em", nem parágrafo apagado.
    const metas = await inFamily((tx) =>
      tx.select().from(householdStatements).where(eq(householdStatements.kind, "metas")),
    );
    for (const row of metas.filter((item) => item.status === "fechado")) {
      expect(row.whatChanged).toBe("As despesas foram de 9.840,00.");
    }
  });

  it("a rodada seguinte não regenera de novo", async () => {
    const before = await inFamily((tx) => tx.select().from(householdStatements));
    await runAgents("2026-11-05");
    const after = await inFamily((tx) => tx.select().from(householdStatements));
    const closed = (rows: typeof before) =>
      rows
        .filter((row) => row.status === "fechado")
        .map((row) => [row.kind, row.period, row.generatedAt, row.revisedAt, row.sourceHash])
        .sort();
    expect(closed(after)).toEqual(closed(before));
  });

  it("mês fechado regenerado por lançamento novo continua dizendo por que mudou", async () => {
    await inFamily(async (tx) => {
      const [main] = await tx.select().from(accounts);
      const home = await categoryId("Moradia", "despesa", tx);
      await tx.insert(transactions).values({
        householdId: family,
        accountId: main!.id,
        categoryId: home,
        kind: "despesa",
        description: "Conserto",
        amount: "150.00",
        occurredOn: "2026-10-25",
        categorySource: "familia",
      });
    });
    await runAgents("2026-11-06");
    const resumo = await closedRow("resumo", "2026-10");
    expect(figure(resumo.data, "spent")).toEqual({ money: "6150.00" });
    expect(resumo.data.notes.filter((note) => note === "aporteSeparado")).toHaveLength(1);
  });
});
