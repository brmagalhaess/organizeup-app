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

const { accounts, cardPurchases, cardStatementPayments, creditCards, household } = db;
const { householdMember, householdSettings, transactions, user } = db;

const FAMILY = "hh-ia-aporte";
const OWNER = "user-ia-aporte";
const MONTH = "2026-10";

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
  });
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("listar_lancamentos e resumo_do_mes", () => {
  it("o pagamento da fatura sai da soma quando as compras estão listadas", async () => {
    const resumo = await run("resumo_do_mes", { mes: MONTH });
    const lista = await run("listar_lancamentos", { mes: MONTH });
    expect(resumo).toMatchObject({ gasto: "520.00", aportado: "600.00" });
    expect(lista).toMatchObject({ soma_despesas: resumo.gasto, soma_aportes: resumo.aportado });
    expect(lista.soma_receitas).toBe("9000.00");
  });

  it("buscando só a fatura, o pagamento conta: as compras não estão listadas", async () => {
    const lista = await run("listar_lancamentos", { mes: MONTH, busca: "Fatura" });
    expect(lista.soma_despesas).toBe("1000.00");
  });
});
