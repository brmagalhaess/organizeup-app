// `listar_lancamentos` e `resumo_do_mes` batem, com compras de cartão, aporte no cartão e fatura paga e em
// aberto (ADR-0027, revisão, item 7). Postgres real, pela conexão da web. Dados fictícios.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const { ALL_TOOLS, executeTool } = await import("../src/tools/index");
const { loadPrivacyFilter } = await import("../src/privacy");
const { SYSTEM_PROMPT } = await import("../src/instructions");

const { accounts, cardPurchases, cardStatementPayments, cashflowPlans, creditCards, household } =
  db;
const { householdMember, householdSettings, transactions, user } = db;

const FAMILY = "hh-ia-aporte";
const OWNER = "user-ia-aporte";
const MONTH = "2026-10";
const OPEN = "2026-11";

let ctx: TenantContext;
const run = async (name: string, input: unknown) => {
  const privacy = await db.withHousehold(ctx, (tx) => loadPrivacyFilter(tx, ctx.householdId));
  const { content } = await executeTool(ALL_TOOLS, ctx, privacy, name, input);
  const inner = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  return JSON.parse(inner) as Record<string, string>;
};

beforeAll(async () => {
  await db.withAdmin("seed das ferramentas", async (admin) => {
    await admin.insert(user).values({ id: OWNER, name: "Pessoa", email: `${OWNER}@example.com` });
    await admin.insert(household).values({ id: FAMILY, name: "Ferramentas", slug: FAMILY });
    await admin
      .insert(householdMember)
      .values({ id: `m-${FAMILY}`, organizationId: FAMILY, userId: OWNER, role: "owner" });
  });
  const session = await db.fromSession({
    user: { id: OWNER },
    session: { activeOrganizationId: FAMILY },
  });
  if (!session) throw new Error("sem contexto");
  ctx = session;
  await db.withHousehold(ctx, async (tx) => {
    await tx.insert(householdSettings).values({ householdId: FAMILY });
    await db.ensureFinanceDefaults(tx, FAMILY);
    const [main] = await tx.select().from(accounts);
    const category = async (kind: "receita" | "despesa", name: string) =>
      (await db.ensureCategory(tx, FAMILY, kind, name, false)).id;
    const salary = await category("receita", "Salário");
    const market = await category("despesa", "Mercado");
    const cardCategory = await category("despesa", domain.CARD_CATEGORY);
    const contribution = await category("despesa", domain.CONTRIBUTION_CATEGORY);
    const base = {
      householdId: FAMILY,
      accountId: main!.id,
      categorySource: "familia" as const,
    };
    await tx.insert(transactions).values([
      {
        ...base,
        kind: "receita",
        categoryId: salary,
        description: "Salário",
        amount: "9000.00",
        occurredOn: `${MONTH}-05`,
      },
      {
        ...base,
        kind: "despesa",
        categoryId: market,
        description: "Feira",
        amount: "120.00",
        occurredOn: `${MONTH}-06`,
      },
    ]);
    const [card] = await tx
      .insert(creditCards)
      .values({
        householdId: FAMILY,
        name: "Visa",
        closingDay: 1,
        dueDay: 10,
        payingAccountId: main!.id,
      })
      .returning();
    await tx.insert(cardPurchases).values([
      {
        householdId: FAMILY,
        cardId: card!.id,
        categoryId: market,
        description: "Mercado no cartão",
        amount: "400.00",
        purchasedOn: `${MONTH}-01`,
      },
      {
        householdId: FAMILY,
        cardId: card!.id,
        categoryId: contribution,
        description: "Corretora",
        amount: "600.00",
        purchasedOn: `${MONTH}-01`,
      },
    ]);
    const [paid] = await tx
      .insert(transactions)
      .values({
        ...base,
        kind: "despesa",
        categoryId: cardCategory,
        description: "Fatura Visa",
        amount: "1000.00",
        occurredOn: `${MONTH}-10`,
      })
      .returning({ id: transactions.id });
    await tx.insert(cardStatementPayments).values({
      householdId: FAMILY,
      cardId: card!.id,
      statementMonth: MONTH,
      transactionId: paid!.id,
    });
    // Novembro: compra no cartão com a fatura aberta, um lançamento previsto e uma previsão recorrente.
    await tx.insert(cardPurchases).values({
      householdId: FAMILY,
      cardId: card!.id,
      categoryId: market,
      description: "Super novembro",
      amount: "1500.00",
      purchasedOn: `${OPEN}-01`,
    });
    await tx.insert(transactions).values({
      ...base,
      kind: "despesa",
      categoryId: market,
      description: "Feira prevista",
      status: "previsto",
      amount: "250.00",
      occurredOn: `${OPEN}-25`,
    });
    await tx.insert(cashflowPlans).values({
      householdId: FAMILY,
      accountId: main!.id,
      categoryId: market,
      kind: "despesa",
      description: "Escola",
      amount: "900.00",
      dayOfMonth: 28,
      startMonth: OPEN,
    });
  });
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("listar_lancamentos e resumo_do_mes", () => {
  it.each([
    ["sem filtro", {}],
    ["tipo despesa", { tipo: "despesa" }],
  ])(
    "%s: o pagamento da fatura sai da soma, e o aporte não volta como despesa",
    async (_, filter) => {
      const resumo = await run("resumo_do_mes", { mes: MONTH });
      const lista = await run("listar_lancamentos", { mes: MONTH, ...filter });
      expect(resumo).toMatchObject({ gasto: "520.00", aportado: "600.00" });
      expect(lista.soma_despesas).toBe(resumo.gasto);
    },
  );

  it("tipo aporte traz a compra de aporte, e a soma bate", async () => {
    const lista = await run("listar_lancamentos", { mes: MONTH, tipo: "aporte" });
    expect(lista.soma_aportes).toBe("600.00");
    expect(lista.soma_despesas).toBe("0.00");
  });

  it("categoria bate com por_categoria do resumo", async () => {
    const resumo = (await run("resumo_do_mes", { mes: MONTH })) as unknown as {
      por_categoria: Array<{ categoria: string; valor: string }>;
    };
    const lista = await run("listar_lancamentos", { mes: MONTH, categoria: "Mercado" });
    expect(lista.soma_despesas).toBe(
      resumo.por_categoria.find((row) => row.categoria === "Mercado")?.valor,
    );
  });

  it("a fatura sozinha não é gasto a mais: o pagamento vem em soma própria", async () => {
    for (const filter of [{ busca: "Fatura" }, { categoria: "Cartão" }]) {
      const lista = await run("listar_lancamentos", { mes: MONTH, ...filter });
      expect(lista).toMatchObject({
        soma_despesas: "0.00",
        soma_pagamentos_de_fatura: "1000.00",
      });
    }
  });

  it("quanto gastei: a compra de fatura aberta aparece como já comprada, e a conta vem pronta", async () => {
    const lista = await run("listar_lancamentos", { mes: OPEN, categoria: "Mercado" });
    expect(lista).toMatchObject({
      soma_despesas: "0.00",
      soma_comprada_fatura_aberta: "1500.00",
      soma_despesas_com_comprado: "1500.00",
      soma_prevista_despesas: "2650.00",
    });
    const itens = lista.itens as unknown as Array<{ situacao: string; valor: string }>;
    expect(itens.find((row) => row.valor === "1500.00")?.situacao).toBe("comprado_fatura_aberta");
    const resumo = await run("resumo_do_mes", { mes: OPEN });
    expect(resumo).toMatchObject({
      gasto: "0.00",
      comprado_em_fatura_aberta: "1500.00",
      gasto_com_comprado: "1500.00",
      despesa_prevista: "2650.00",
    });
    const tudo = await run("listar_lancamentos", { mes: OPEN });
    expect(tudo.soma_prevista_despesas).toBe(resumo.despesa_prevista);
  });

  it("as instruções mandam usar a conta pronta, e seguem sem data nem dado", () => {
    expect(SYSTEM_PROMPT).toContain("soma_despesas_com_comprado");
    expect(SYSTEM_PROMPT).toContain("gasto_com_comprado");
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}/);
  });
});
