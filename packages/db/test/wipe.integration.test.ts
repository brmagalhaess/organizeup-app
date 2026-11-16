// Limpeza de dados por módulo (ADR-0034): cada módulo some sozinho, o resto fica, e as referências
// cruzadas se soltam em vez de barrar o DELETE.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("../src/index");
const { closeAllPools } = await import("../src/client");

const H = "hh-wipe";
const OWNER = "user-wipe-owner";

async function ownerCtx() {
  const ctx = await db.fromSession({ user: { id: OWNER }, session: { activeOrganizationId: H } });
  if (!ctx) throw new Error("sem contexto");
  return ctx;
}

beforeAll(async () => {
  await db.withAdmin("seed da limpeza", async (admin) => {
    await admin.insert(db.user).values({ id: OWNER, name: "Wipe", email: "wipe@example.com" });
    await admin.insert(db.household).values({ id: H, name: "Casa Wipe", slug: "casa-wipe" });
    await admin
      .insert(db.householdMember)
      .values({ id: "m-wipe", organizationId: H, userId: OWNER, role: "owner" });
  });
});

afterAll(async () => {
  await closeAllPools();
});

/** Semeia um pouco de cada módulo, com as referências cruzadas que importam. */
async function seed() {
  const ctx = await ownerCtx();
  return db.withHousehold(ctx, async (tx) => {
    await tx.insert(db.householdSettings).values({ householdId: H }).onConflictDoNothing();
    await db.ensureFinanceDefaults(tx, H);
    const [account] = await tx.select().from(db.accounts).limit(1);
    const [category] = await tx
      .select()
      .from(db.categories)
      .where(eq(db.categories.kind, "despesa"))
      .limit(1);
    const [income] = await tx
      .select()
      .from(db.categories)
      .where(eq(db.categories.kind, "receita"))
      .limit(1);
    const accountId = account!.id;
    const [entry] = await tx
      .insert(db.transactions)
      .values({
        householdId: H,
        accountId,
        categoryId: category!.id,
        kind: "despesa",
        description: "Mercado",
        amount: "100.00",
        occurredOn: "2026-11-01",
      })
      .returning({ id: db.transactions.id });
    const [goal] = await tx
      .insert(db.goals)
      .values({
        householdId: H,
        name: "Carro",
        kind: "veiculo",
        targetAmount: "50000.00",
        accountId,
      })
      .returning({ id: db.goals.id });
    await tx.insert(db.goalContributions).values({
      householdId: H,
      goalId: goal!.id,
      month: "2026-11",
      amount: "100.00",
      transactionId: entry!.id,
    });
    const [debt] = await tx
      .insert(db.debts)
      .values({
        householdId: H,
        accountId,
        name: "Carro",
        system: "price",
        originalBalance: "1000.00",
      })
      .returning({ id: db.debts.id });
    await tx.insert(db.debtInstallments).values({
      householdId: H,
      debtId: debt!.id,
      number: 1,
      dueDate: "2026-11-10",
      amount: "100.00",
      principal: "90.00",
      interest: "10.00",
      transactionId: entry!.id,
    });
    await tx.insert(db.assets).values({
      householdId: H,
      name: "Carro",
      kind: "veiculo",
      value: "30000.00",
      valuedOn: "2026-11-01",
      linkedDebtId: debt!.id,
    });
    const [investment] = await tx
      .insert(db.investments)
      .values({ householdId: H, name: "Maxi Renda", ticker: "MXRF11", assetClass: "fii" })
      .returning({ id: db.investments.id });
    await tx.insert(db.investmentTrades).values({
      householdId: H,
      investmentId: investment!.id,
      side: "compra",
      occurredOn: "2026-10-30",
      quantity: "25",
      unitPrice: "8.88",
      transactionId: entry!.id,
    });
    await tx.insert(db.dividends).values({
      householdId: H,
      investmentId: investment!.id,
      kind: "rendimento",
      paidOn: "2026-11-16",
      gross: "2.38",
    });
    const [source] = await tx
      .insert(db.incomeSources)
      .values({
        householdId: H,
        accountId,
        categoryId: income!.id,
        name: "Salário",
        kind: "clt",
        amount: "5000.00",
        payDay: 5,
        startMonth: "2026-01",
      })
      .returning({ id: db.incomeSources.id });
    await tx.insert(db.incomeReceipts).values({
      householdId: H,
      incomeSourceId: source!.id,
      month: "2026-11",
      part: "salario",
      transactionId: entry!.id,
    });
    const [card] = await tx
      .insert(db.creditCards)
      .values({
        householdId: H,
        name: "Cartão",
        closingDay: 1,
        dueDay: 10,
        payingAccountId: accountId,
      })
      .returning({ id: db.creditCards.id });
    await tx.insert(db.cardPurchases).values({
      householdId: H,
      cardId: card!.id,
      categoryId: category!.id,
      description: "Compra",
      amount: "50.00",
      purchasedOn: "2026-11-02",
    });
    const [event] = await tx
      .insert(db.calendarEvents)
      .values({ householdId: H, title: "Viagem", eventDate: "2026-12-20" })
      .returning({ id: db.calendarEvents.id });
    const [trip] = await tx
      .insert(db.trips)
      .values({
        householdId: H,
        destination: "Lisboa",
        startOn: "2026-12-20",
        calendarEventId: event!.id,
      })
      .returning({ id: db.trips.id });
    await tx
      .insert(db.tripCosts)
      .values({ householdId: H, tripId: trip!.id, kind: "passagem", amount: "3000.00" });
    await tx.insert(db.retirementPlan).values({ householdId: H }).onConflictDoNothing();
    await tx.insert(db.emergencyFund).values({ householdId: H }).onConflictDoNothing();
  });
}

async function counts() {
  const ctx = await ownerCtx();
  return db.withHousehold(ctx, async (tx) => ({
    transactions: (await tx.select().from(db.transactions)).length,
    goals: (await tx.select().from(db.goals)).length,
    contributions: await tx.select().from(db.goalContributions),
    debts: (await tx.select().from(db.debts)).length,
    installments: await tx.select().from(db.debtInstallments),
    assets: await tx.select().from(db.assets),
    investments: (await tx.select().from(db.investments)).length,
    trades: await tx.select().from(db.investmentTrades),
    dividends: (await tx.select().from(db.dividends)).length,
    incomeSources: (await tx.select().from(db.incomeSources)).length,
    incomeReceipts: (await tx.select().from(db.incomeReceipts)).length,
    cards: (await tx.select().from(db.creditCards)).length,
    purchases: (await tx.select().from(db.cardPurchases)).length,
    events: (await tx.select().from(db.calendarEvents)).length,
    trips: await tx.select().from(db.trips),
    tripCosts: (await tx.select().from(db.tripCosts)).length,
    accounts: (await tx.select().from(db.accounts)).length,
    categories: (await tx.select().from(db.categories)).length,
    settings: (await tx.select().from(db.householdSettings)).length,
    connections: (await tx.select().from(db.bankConnections)).length,
    bankAccounts: await tx.select().from(db.bankConnectionAccounts),
  }));
}

describe("limpeza de dados por módulo", () => {
  it("lançamentos somem e quem apontava para eles perde só o vínculo", async () => {
    await seed();
    const before = await counts();
    expect(before.transactions).toBe(1);
    expect(before.incomeReceipts).toBe(1);

    const ctx = await ownerCtx();
    const report = await db.withHousehold(ctx, (tx) =>
      db.wipeHouseholdData(tx, { householdId: H, scopes: ["lancamentos"] }),
    );
    expect(report.scopes).toEqual(["lancamentos"]);
    expect(report.removed.transactions).toBe(1);

    const after = await counts();
    expect(after.transactions).toBe(0);
    expect(after.incomeReceipts).toBe(0); // cascata do lançamento
    expect(after.incomeSources).toBe(1);
    expect(after.contributions).toHaveLength(1);
    expect(after.contributions[0]!.transactionId).toBeNull();
    expect(after.installments[0]!.transactionId).toBeNull();
    expect(after.trades[0]!.transactionId).toBeNull();
    expect(after.goals).toBe(1);
    expect(after.debts).toBe(1);
    expect(after.investments).toBe(1);
    expect(after.accounts).toBeGreaterThan(0);
  });

  it("dívidas e agenda soltam o bem e a viagem; viagens levam os custos", async () => {
    const ctx = await ownerCtx();
    await db.withHousehold(ctx, (tx) =>
      db.wipeHouseholdData(tx, { householdId: H, scopes: ["dividas", "agenda"] }),
    );
    const mid = await counts();
    expect(mid.debts).toBe(0);
    expect(mid.installments).toHaveLength(0);
    expect(mid.assets).toHaveLength(1);
    expect(mid.assets[0]!.linkedDebtId).toBeNull();
    expect(mid.events).toBe(0);
    expect(mid.trips).toHaveLength(1);
    expect(mid.trips[0]!.calendarEventId).toBeNull();

    await db.withHousehold(ctx, (tx) =>
      db.wipeHouseholdData(tx, { householdId: H, scopes: ["viagens"] }),
    );
    const after = await counts();
    expect(after.trips).toHaveLength(0);
    expect(after.tripCosts).toBe(0);
    expect(after.investments).toBe(1);
  });

  it("contas leva o que aponta para contas e categorias e recria o padrão; o resto fica", async () => {
    const ctx = await ownerCtx();
    const report = await db.withHousehold(ctx, (tx) =>
      db.wipeHouseholdData(tx, { householdId: H, scopes: ["contas"] }),
    );
    expect(report.scopes).toContain("lancamentos");
    expect(report.scopes).toContain("cartoes");
    expect(report.removed.accounts).toBeGreaterThan(0);

    const after = await counts();
    expect(after.cards).toBe(0);
    expect(after.purchases).toBe(0);
    expect(after.goals).toBe(0);
    expect(after.incomeSources).toBe(0);
    expect(after.assets).toHaveLength(0);
    // Recriadas: uma conta e as categorias padrão.
    expect(after.accounts).toBe(1);
    expect(after.categories).toBeGreaterThan(1);
    // Não pedidos: ficam.
    expect(after.investments).toBe(1);
    expect(after.dividends).toBe(1);
    expect(after.settings).toBe(1);
  });

  it("investimentos leva operações e proventos em cascata", async () => {
    const ctx = await ownerCtx();
    await db.withHousehold(ctx, (tx) =>
      db.wipeHouseholdData(tx, { householdId: H, scopes: ["investimentos"] }),
    );
    const after = await counts();
    expect(after.investments).toBe(0);
    expect(after.trades).toHaveLength(0);
    expect(after.dividends).toBe(0);
  });

  it("conexão com bancos sai só no módulo dela; outro módulo só solta o vínculo", async () => {
    // Só o que este caso precisa: o `seed()` inteiro repetiria fixtures dos casos anteriores.
    const ctx = await ownerCtx();
    const personId = await db.withHousehold(ctx, async (tx) => {
      await db.ensureFinanceDefaults(tx, H);
      const [person] = await tx
        .insert(db.people)
        .values({ householdId: H, name: "Titular", relation: "titular" })
        .returning({ id: db.people.id });
      const [account] = await tx.select().from(db.accounts).limit(1);
      const [card] = await tx
        .insert(db.creditCards)
        .values({
          householdId: H,
          name: "Cartão do banco",
          closingDay: 2,
          dueDay: 12,
          payingAccountId: account!.id,
        })
        .returning({ id: db.creditCards.id });
      const [connection] = await tx
        .insert(db.bankConnections)
        .values({
          householdId: H,
          userId: OWNER,
          personId: person!.id,
          clientIdSealed: "selado-id",
          clientSecretSealed: "selado-secret",
          itemIds: ["item-1"],
        })
        .returning({ id: db.bankConnections.id });
      await tx.insert(db.bankConnectionAccounts).values([
        {
          householdId: H,
          connectionId: connection!.id,
          itemId: "item-1",
          externalId: "conta-1",
          kind: "corrente",
          name: "Conta",
          numberTail: "0000",
          accountId: account!.id,
          syncedOn: "2026-11-10",
        },
        {
          householdId: H,
          connectionId: connection!.id,
          itemId: "item-1",
          externalId: "cartao-1",
          kind: "cartao",
          name: "Cartão",
          cardId: card!.id,
        },
      ]);
      return person!.id;
    });

    // Limpar lançamentos e cartões não leva a chave do banco; o vínculo com o cartão só se solta.
    await db.withHousehold(ctx, (tx) =>
      db.wipeHouseholdData(tx, { householdId: H, scopes: ["lancamentos", "cartoes"] }),
    );
    const mid = await counts();
    expect(mid.connections).toBe(1);
    expect(mid.bankAccounts).toHaveLength(2);
    expect(mid.bankAccounts.find((row) => row.kind === "cartao")!.cardId).toBeNull();

    const report = await db.withHousehold(ctx, (tx) =>
      db.wipeHouseholdData(tx, { householdId: H, scopes: ["conexao"] }),
    );
    expect(report.scopes).toEqual(["conexao"]);
    expect(report.removed.bank_connections).toBe(1);
    expect(report.removed.bank_connection_accounts).toBe(2);

    const after = await counts();
    expect(after.connections).toBe(0);
    expect(after.bankAccounts).toHaveLength(0);
    // A conta daqui fica: quem aponta para ela é a linha que saiu.
    expect(after.accounts).toBeGreaterThan(0);

    // A pessoa não entra na limpeza (é de propósito), então este caso desfaz o que semeou: o teste de
    // RLS confere `people` de todas as casas e os arquivos dividem o mesmo banco.
    await db.withHousehold(ctx, (tx) => tx.delete(db.people).where(eq(db.people.id, personId)));
  });

  it("só quem pode escrever apaga: visualizador cai na RLS", async () => {
    await db.withAdmin("seed visualizador", async (admin) => {
      await admin
        .insert(db.user)
        .values({ id: "user-wipe-viewer", name: "V", email: "v-wipe@example.com" });
      await admin
        .insert(db.householdMember)
        .values({ id: "m-wipe-v", organizationId: H, userId: "user-wipe-viewer", role: "viewer" });
    });
    await seed();
    const ctx = await db.fromSession({
      user: { id: "user-wipe-viewer" },
      session: { activeOrganizationId: H },
    });
    if (!ctx) throw new Error("sem contexto");
    await db.withHousehold(ctx, (tx) =>
      db.wipeHouseholdData(tx, { householdId: H, scopes: ["metas"] }),
    );
    expect((await counts()).goals).toBe(1);
  });
});
