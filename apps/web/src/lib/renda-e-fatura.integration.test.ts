// Renda cadastrada que também cai na conta do banco, e fatura paga em parte (ADR-0038), contra um Postgres
// real com RLS. Tudo fictício.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;
process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");

let ctx: TenantContext;
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: messages } = await import("../../messages/pt-BR.json");
  return {
    getLocale: async () => "pt-BR",
    getMessages: async () => messages,
    getTranslations: async (namespace: never) =>
      createTranslator({ locale: "pt-BR", messages, namespace }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requireTenant: async () => ({ ctx }),
  platformFlags: async () => ({ bankFeedEnabled: true }),
  isServiceAdmin: () => false,
}));

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const auto = await import("@/lib/bank-auto");
const { payStatement } = await import("@/app/app/(painel)/cartoes/actions");
const { deleteEntry } = await import("@/app/app/(painel)/lancamentos/actions");
const { undoImport } = await import("@/app/app/(painel)/importar/actions");

const { accounts, categories, eq, transactions, importBatches } = db;
const { cardPurchases, cardStatementPayments, creditCards, incomeReceipts, incomeSources } = db;
const { household, householdMember, householdSettings, user } = db;

const H = { household: "hh-renda", owner: "user-renda" };
const inH = <T>(fn: Parameters<typeof db.withWorkerHousehold<T>>[1]) =>
  db.withWorkerHousehold(H.household, fn);

let bank = "";
let wallet = "";
let salary = "";
let source = "";
let card = "";
// Compras de outubro, antes do fechamento: caem todas na mesma fatura.
let statement = "";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const linesOf = async (month: string) => {
  const [row] = await inH((tx) => tx.select().from(creditCards).where(eq(creditCards.id, card)));
  const purchases = await inH((tx) => tx.select().from(cardPurchases));
  return purchases
    .flatMap((purchase) => domain.purchaseLines(purchase, row!))
    .filter((line) => line.statementMonth === month);
};
const payments = () => inH((tx) => tx.select().from(cardStatementPayments));

beforeAll(async () => {
  await db.withAdmin("seed do teste de renda e fatura", async (admin) => {
    await admin
      .insert(user)
      .values({ id: H.owner, name: "Titular", email: "titular-renda@example.com" });
    await admin.insert(household).values({ id: H.household, name: "Renda", slug: "hh-renda" });
    await admin
      .insert(householdMember)
      .values({ id: "m-renda-1", organizationId: H.household, userId: H.owner, role: "owner" });
  });
  const made = await db.fromSession({
    user: { id: H.owner },
    session: { activeOrganizationId: H.household },
  });
  if (!made) throw new Error("sem contexto");
  ctx = made;
  await inH(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: H.household });
    const rows = await tx
      .insert(accounts)
      .values([
        { householdId: H.household, name: "Banco" },
        { householdId: H.household, name: "Carteira" },
      ])
      .returning({ id: accounts.id, name: accounts.name });
    bank = rows.find((row) => row.name === "Banco")!.id;
    wallet = rows.find((row) => row.name === "Carteira")!.id;
    const cats = await tx
      .insert(categories)
      .values([
        { householdId: H.household, name: "Salário", kind: "receita" },
        { householdId: H.household, name: domain.CARD_CATEGORY, kind: "despesa" },
      ])
      .returning({ id: categories.id, kind: categories.kind });
    salary = cats.find((row) => row.kind === "receita")!.id;
    const shopping = cats.find((row) => row.kind === "despesa")!.id;
    // A renda foi cadastrada na Carteira, com um valor estimado: o banco mostra onde e quanto caiu.
    const [income] = await tx
      .insert(incomeSources)
      .values({
        householdId: H.household,
        accountId: wallet,
        categoryId: salary,
        name: "Consultoria",
        kind: "pj_autonomo",
        amount: "5000.00",
        payDay: 5,
        startMonth: "2026-10",
      })
      .returning({ id: incomeSources.id });
    source = income!.id;
    const [made] = await tx
      .insert(creditCards)
      .values({
        householdId: H.household,
        name: "Roxinho",
        closingDay: 25,
        dueDay: 5,
        payingAccountId: bank,
      })
      .returning();
    card = made!.id;
    await tx.insert(cardPurchases).values([
      {
        householdId: H.household,
        cardId: card,
        categoryId: shopping,
        description: "Mercado",
        amount: "300.00",
        installments: 1,
        purchasedOn: "2026-10-10",
      },
      {
        householdId: H.household,
        cardId: card,
        categoryId: shopping,
        description: "Farmácia",
        amount: "200.00",
        installments: 1,
        purchasedOn: "2026-10-12",
      },
    ]);
    statement = domain.statementMonthOf("2026-10-10", made!);
  });
});

afterAll(() => db.closeAllPools());

describe("renda cadastrada que também chega pelo banco", () => {
  it("o crédito do banco dá baixa na renda estimada, com o valor e a conta de verdade", async () => {
    const saved = await auto.autoImportStatement(ctx, bank, [
      {
        date: "2026-11-06",
        description: "TED RECEBIDA EMPRESA X",
        amount: "5230.00",
        kind: "receita",
        externalId: "pluggy:r1",
      },
    ]);
    expect(saved).toEqual({ ok: true, imported: 0, settled: 1 });
    const rows = await inH((tx) => tx.select().from(transactions));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: bank,
      amount: "5230.00",
      kind: "receita",
      occurredOn: "2026-11-06",
      status: "realizado",
      importFingerprint: "ofx:id:pluggy:r1#0",
    });
    const receipts = await inH((tx) => tx.select().from(incomeReceipts));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ incomeSourceId: source, month: "2026-11" });
    // Buscar de novo não lança nem dá baixa outra vez.
    expect(
      await auto.autoImportStatement(ctx, bank, [
        {
          date: "2026-11-06",
          description: "TED RECEBIDA EMPRESA X",
          amount: "5230.00",
          kind: "receita",
          externalId: "pluggy:r1",
        },
      ]),
    ).toEqual({ ok: true, imported: 0, settled: 0 });
  });

  it("renda já confirmada à mão em outra conta não entra de novo pelo banco", async () => {
    await inH(async (tx) => {
      const [byHand] = await tx
        .insert(transactions)
        .values({
          householdId: H.household,
          accountId: wallet,
          categoryId: salary,
          kind: "receita",
          description: "Consultoria",
          amount: "5000.00",
          occurredOn: "2026-10-05",
          status: "realizado",
        })
        .returning({ id: transactions.id });
      await tx.insert(incomeReceipts).values({
        householdId: H.household,
        incomeSourceId: source,
        month: "2026-10",
        part: "salario",
        transactionId: byHand!.id,
      });
    });
    const saved = await auto.autoImportStatement(ctx, bank, [
      {
        date: "2026-10-06",
        description: "TED RECEBIDA EMPRESA X",
        amount: "5100.00",
        kind: "receita",
        externalId: "pluggy:r0",
      },
      // Um crédito bem diferente da renda é outro dinheiro: entra normalmente.
      {
        date: "2026-10-07",
        description: "PIX RECEBIDO",
        amount: "150.00",
        kind: "receita",
        externalId: "pluggy:r2",
      },
    ]);
    expect(saved).toEqual({ ok: true, imported: 1, settled: 0 });
    const rows = await inH((tx) => tx.select().from(transactions));
    expect(rows.filter((row) => row.amount === "5100.00")).toHaveLength(0);
    expect(rows.filter((row) => row.amount === "150.00")).toHaveLength(1);
  });
});

describe("fatura paga em parte", () => {
  it("o restante vai para a fatura seguinte, e apagar o pagamento traz tudo de volta", async () => {
    expect(domain.linesTotal(await linesOf(statement))).toBe("500.00");
    const bad = await payStatement(
      { ok: false, message: "" },
      form({ cardId: card, month: statement, paidOn: "2026-11-05", amount: "0", total: "500.00" }),
    );
    expect(bad.ok).toBe(false);
    const paid = await payStatement(
      { ok: false, message: "" },
      form({
        cardId: card,
        month: statement,
        paidOn: "2026-11-05",
        amount: "300,00",
        total: "500.00",
      }),
    );
    expect(paid).toEqual({
      ok: true,
      message: "Pagamento parcial gravado. O restante foi para a próxima fatura.",
    });
    const [payment] = await payments();
    expect(payment).toMatchObject({ cardId: card, statementMonth: statement });
    const [entry] = await inH((tx) =>
      tx.select().from(transactions).where(eq(transactions.id, payment!.transactionId)),
    );
    expect(entry).toMatchObject({
      accountId: bank,
      amount: "300.00",
      kind: "despesa",
      occurredOn: "2026-11-05",
      status: "realizado",
    });
    const next = await linesOf(domain.addMonths(statement as never, 1));
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ amount: "200.00" });
    expect(next[0]!.description).toMatch(/^Saldo da fatura de \d{2}\/\d{4}$/);
    // Paga, não paga de novo.
    const again = await payStatement(
      { ok: false, message: "" },
      form({
        cardId: card,
        month: statement,
        paidOn: "2026-11-05",
        amount: "200,00",
        total: "500.00",
      }),
    );
    expect(again.ok).toBe(false);

    await deleteEntry(form({ id: payment!.transactionId }));
    expect(await payments()).toHaveLength(0);
    expect(await linesOf(domain.addMonths(statement as never, 1))).toHaveLength(0);
    expect(domain.linesTotal(await linesOf(statement))).toBe("500.00");
  });

  it("o débito da fatura no banco dá baixa nela pelo valor pago, e Desfazer devolve o restante", async () => {
    const saved = await auto.autoImportStatement(ctx, bank, [
      {
        date: "2026-11-04",
        description: "PAGTO FATURA CARTAO ROXINHO",
        amount: "450.00",
        kind: "despesa",
        externalId: "pluggy:f1",
      },
    ]);
    expect(saved).toEqual({ ok: true, imported: 0, settled: 1 });
    const [payment] = await payments();
    const [entry] = await inH((tx) =>
      tx.select().from(transactions).where(eq(transactions.id, payment!.transactionId)),
    );
    expect(entry).toMatchObject({
      amount: "450.00",
      occurredOn: "2026-11-04",
      importFingerprint: "ofx:id:pluggy:f1#0",
    });
    const next = await linesOf(domain.addMonths(statement as never, 1));
    expect(next.map((line) => line.amount)).toEqual(["50.00"]);

    await undoImport(form({ id: entry!.importBatchId! }));
    expect(await payments()).toHaveLength(0);
    expect(await linesOf(domain.addMonths(statement as never, 1))).toHaveLength(0);
    expect(await inH((tx) => tx.select().from(importBatches))).toHaveLength(2);
  });

  it("cartão apontado para outra conta: o débito no banco do cartão ainda dá baixa na fatura", async () => {
    // O cartão foi criado pagando pela Carteira, mas é do mesmo banco da conta Banco (mesma conexão).
    await inH(async (tx) => {
      await tx.update(creditCards).set({ payingAccountId: wallet }).where(eq(creditCards.id, card));
      const [person] = await tx
        .insert(db.people)
        .values({ householdId: H.household, name: "Ana", relation: "titular", userId: H.owner })
        .returning({ id: db.people.id });
      const [connection] = await tx
        .insert(db.bankConnections)
        .values({
          householdId: H.household,
          userId: H.owner,
          personId: person!.id,
          clientIdSealed: "x",
          clientSecretSealed: "y",
          itemIds: ["item-1"],
        })
        .returning({ id: db.bankConnections.id });
      const link = { householdId: H.household, connectionId: connection!.id, itemId: "item-1" };
      await tx.insert(db.bankConnectionAccounts).values([
        { ...link, externalId: "conta", kind: "corrente", name: "Conta", accountId: bank },
        { ...link, externalId: "cartao", kind: "cartao", name: "Cartão", cardId: card },
      ]);
    });
    const saved = await auto.autoImportStatement(ctx, bank, [
      {
        date: "2026-11-04",
        description: "PAGAMENTO DE FATURA",
        amount: "500.00",
        kind: "despesa",
        externalId: "pluggy:f2",
      },
    ]);
    expect(saved).toEqual({ ok: true, imported: 0, settled: 1 });
    const [payment] = await payments();
    const [entry] = await inH((tx) =>
      tx.select().from(transactions).where(eq(transactions.id, payment!.transactionId)),
    );
    // Sai da conta em que o banco mostrou o débito, e não da que o cartão indicava.
    expect(entry).toMatchObject({ accountId: bank, amount: "500.00" });
    await undoImport(form({ id: entry!.importBatchId! }));
    expect(await payments()).toHaveLength(0);
    await inH((tx) =>
      tx.update(creditCards).set({ payingAccountId: bank }).where(eq(creditCards.id, card)),
    );
  });

  it("pagar o total fecha a fatura sem deixar saldo", async () => {
    const paid = await payStatement(
      { ok: false, message: "" },
      form({
        cardId: card,
        month: statement,
        paidOn: "2026-11-05",
        amount: "500,00",
        total: "500.00",
      }),
    );
    expect(paid).toEqual({ ok: true, message: "Fatura paga." });
    expect(await payments()).toHaveLength(1);
    expect(await linesOf(domain.addMonths(statement as never, 1))).toHaveLength(0);
  });
});
