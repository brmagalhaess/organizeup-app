// Teste de isolamento entre households (obrigatório no CI — ver ADR-0002).
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("../src/index");
const { closeAllPools } = await import("../src/client");
const { people, householdSettings, auditLog, household, user, householdMember } = db;

const A = {
  household: "hh-a",
  owner: "user-a-owner",
  viewer: "user-a-viewer",
  adult: "user-a-adult",
};
const B = { household: "hh-b", owner: "user-b-owner" };
let personA = "";
let personB = "";

function session(userId: string, householdId: string) {
  return { user: { id: userId }, session: { activeOrganizationId: householdId } };
}

async function ctxFor(userId: string, householdId: string) {
  const ctx = await db.fromSession(session(userId, householdId));
  if (!ctx) throw new Error(`sem contexto para ${userId}`);
  return ctx;
}

beforeAll(async () => {
  await db.withAdmin("seed do teste de isolamento", async (admin) => {
    await admin.insert(user).values([
      { id: A.owner, name: "Ana", email: "ana@example.com" },
      { id: A.viewer, name: "Vi", email: "vi@example.com" },
      { id: A.adult, name: "Adu", email: "adu@example.com" },
      { id: B.owner, name: "Beto", email: "beto@example.com" },
    ]);
    await admin.insert(household).values([
      { id: A.household, name: "Família A", slug: "familia-a" },
      { id: B.household, name: "Família B", slug: "familia-b" },
    ]);
    await admin.insert(householdMember).values([
      { id: "m1", organizationId: A.household, userId: A.owner, role: "owner" },
      { id: "m2", organizationId: A.household, userId: A.viewer, role: "viewer" },
      { id: "m3", organizationId: A.household, userId: A.adult, role: "adult" },
      { id: "m4", organizationId: B.household, userId: B.owner, role: "owner" },
    ]);
  });

  const ctxA = await ctxFor(A.owner, A.household);
  personA = await db.withHousehold(ctxA, async (tx) => {
    const [row] = await tx
      .insert(people)
      .values({ householdId: A.household, name: "Ana", relation: "titular", userId: A.owner })
      .returning({ id: people.id });
    await tx.insert(householdSettings).values({ householdId: A.household });
    await tx.insert(auditLog).values({
      householdId: A.household,
      actorUserId: A.owner,
      actorKind: "user",
      action: "create",
      entity: "people",
    });
    return row!.id;
  });

  const ctxB = await ctxFor(B.owner, B.household);
  personB = await db.withHousehold(ctxB, async (tx) => {
    const [row] = await tx
      .insert(people)
      .values({ householdId: B.household, name: "Beto", relation: "titular" })
      .returning({ id: people.id });
    return row!.id;
  });
});

afterAll(async () => {
  await closeAllPools();
});

describe("isolamento entre households (RLS)", () => {
  it("cada household só enxerga as próprias pessoas", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    const rows = await db.withHousehold(ctxA, (tx) => tx.select().from(people));
    expect(rows.map((r) => r.id)).toEqual([personA]);
  });

  it("não-membro não obtém contexto de outro household", async () => {
    expect(await db.fromSession(session(B.owner, A.household))).toBeNull();
    expect(await db.fromSession(session(A.owner, "hh-inexistente"))).toBeNull();
  });

  it("sem contexto aplicado, a conexão da aplicação não vê nada (fail-closed)", async () => {
    const raw = postgres(urls.app, { max: 1 });
    try {
      const rows = await raw`select id from people`;
      expect(rows).toHaveLength(0);
      await expect(
        raw`insert into people (household_id, name, relation) values (${A.household}, 'X', 'outro')`,
      ).rejects.toThrow();
    } finally {
      await raw.end();
    }
  });

  it("não grava linha com household_id de outro tenant", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctxA, (tx) =>
        tx.insert(people).values({ householdId: B.household, name: "Intruso", relation: "outro" }),
      ),
    ).rejects.toThrow();
  });

  it("não altera nem apaga linha de outro tenant", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    const updated = await db.withHousehold(ctxA, (tx) =>
      tx.update(people).set({ name: "Hackeado" }).where(eq(people.id, personB)).returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await db.withHousehold(ctxA, (tx) =>
      tx.delete(people).where(eq(people.id, personB)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("FK composta impede apontar para pessoa de outro household", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctxA, (tx) =>
        tx
          .update(householdSettings)
          .set({ primaryPersonId: personB })
          .where(eq(householdSettings.householdId, A.household)),
      ),
    ).rejects.toThrow();
    // E aceita uma pessoa do próprio household.
    await db.withHousehold(ctxA, (tx) =>
      tx
        .update(householdSettings)
        .set({ primaryPersonId: personA })
        .where(eq(householdSettings.householdId, A.household)),
    );
  });

  it("papel viewer lê mas não escreve", async () => {
    const ctxV = await ctxFor(A.viewer, A.household);
    const rows = await db.withHousehold(ctxV, (tx) => tx.select().from(people));
    expect(rows).toHaveLength(1);
    await expect(
      db.withHousehold(ctxV, (tx) =>
        tx.insert(people).values({ householdId: A.household, name: "Novo", relation: "filho" }),
      ),
    ).rejects.toThrow();
  });

  it("papel adult escreve, mas só o owner lê a auditoria", async () => {
    const ctxAdult = await ctxFor(A.adult, A.household);
    await db.withHousehold(ctxAdult, (tx) =>
      tx.insert(people).values({ householdId: A.household, name: "Filho", relation: "filho" }),
    );
    const auditAsAdult = await db.withHousehold(ctxAdult, (tx) => tx.select().from(auditLog));
    expect(auditAsAdult).toHaveLength(0);
    const ctxOwner = await ctxFor(A.owner, A.household);
    const auditAsOwner = await db.withHousehold(ctxOwner, (tx) => tx.select().from(auditLog));
    expect(auditAsOwner.length).toBeGreaterThan(0);
  });

  it("auditoria é append-only", async () => {
    const ctxOwner = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctxOwner, (tx) => tx.update(auditLog).set({ action: "x" })),
    ).rejects.toThrow();
  });

  it("papel 'system' na conexão da web não concede escrita", async () => {
    const ctx = db.fromJob({ householdId: A.household });
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(people).values({ householdId: A.household, name: "Sys", relation: "outro" }),
      ),
    ).rejects.toThrow();
  });

  it("contexto forjado é rejeitado", async () => {
    const forged = { householdId: B.household, userId: A.owner, role: "owner" } as never;
    await expect(db.withHousehold(forged, async () => 1)).rejects.toThrow(/TenantContext inválido/);
  });

  it("worker (ou_worker) grava com papel 'system' apenas no household do job", async () => {
    const raw = postgres(urls.worker, { max: 1 });
    try {
      await raw.begin(async (tx) => {
        await tx`select set_config('app.household_id', ${A.household}, true), set_config('app.role', 'system', true)`;
        await tx`insert into people (household_id, name, relation) values (${A.household}, 'Via job', 'outro')`;
      });
      await expect(
        raw.begin(async (tx) => {
          await tx`select set_config('app.household_id', ${A.household}, true), set_config('app.role', 'system', true)`;
          await tx`insert into people (household_id, name, relation) values (${B.household}, 'Vazou', 'outro')`;
        }),
      ).rejects.toThrow();
      const ok = await raw.begin(async (tx) => {
        await tx`select set_config('app.household_id', ${A.household}, true), set_config('app.role', 'system', true)`;
        return tx`select name from people where name = 'Via job'`;
      });
      expect(ok).toHaveLength(1);
    } finally {
      await raw.end();
    }
  });

  it("admin (BYPASSRLS) enxerga todos os households", async () => {
    const all = await db.withAdmin("verificação do teste", (admin) => admin.select().from(people));
    const households = new Set(all.map((p) => p.householdId));
    expect(households).toEqual(new Set([A.household, B.household]));
  });
});

describe("isolamento do financeiro", () => {
  const { accounts, categories, cashflowPlans, transactions, categoryTemplates } = db;
  let accountA = "";
  let categoryA = "";
  let accountB = "";
  let categoryB = "";
  let transactionB = "";

  const firstIds = (tx: Parameters<Parameters<typeof db.withHousehold>[1]>[0]) =>
    Promise.all([
      tx.select({ id: accounts.id }).from(accounts).limit(1),
      tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.kind, "despesa"))
        .limit(1),
    ]);

  beforeAll(async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    [accountA, categoryA] = await db.withHousehold(ctxA, async (tx) => {
      await db.ensureFinanceDefaults(tx, A.household);
      const [a, c] = await firstIds(tx);
      return [a[0]!.id, c[0]!.id];
    });
    const ctxB = await ctxFor(B.owner, B.household);
    [accountB, categoryB, transactionB] = await db.withHousehold(ctxB, async (tx) => {
      await db.ensureFinanceDefaults(tx, B.household);
      const [a, c] = await firstIds(tx);
      const [t] = await tx
        .insert(transactions)
        .values({
          householdId: B.household,
          accountId: a[0]!.id,
          categoryId: c[0]!.id,
          kind: "despesa",
          description: "Segredo da família B",
          amount: "99.90",
          occurredOn: "2026-03-05",
        })
        .returning({ id: transactions.id });
      return [a[0]!.id, c[0]!.id, t!.id];
    });
  });

  it("dados iniciais são idempotentes", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    const count = await db.withHousehold(ctxA, async (tx) => {
      await db.ensureFinanceDefaults(tx, A.household);
      return (await tx.select().from(accounts)).length;
    });
    expect(count).toBe(1);
  });

  it("dados iniciais suportam requisições simultâneas da primeira tela", async () => {
    await db.withAdmin("seed do teste de concorrência", async (admin) => {
      await admin.insert(household).values({ id: "hh-c", name: "Família C", slug: "familia-c" });
      await admin
        .insert(householdMember)
        .values({ id: "m5", organizationId: "hh-c", userId: B.owner, role: "owner" });
    });
    const ctxC = await ctxFor(B.owner, "hh-c");
    await Promise.all(
      Array.from({ length: 6 }, () =>
        db.withHousehold(ctxC, (tx) => db.ensureFinanceDefaults(tx, "hh-c")),
      ),
    );
    const created = await db.withHousehold(ctxC, async (tx) => ({
      accounts: await tx.select().from(accounts),
      categories: await tx.select().from(categories),
    }));
    expect(created.accounts).toHaveLength(1);
    // 17 modelos até a 0005 + 3 de metas e aportes (0016).
    expect(created.categories).toHaveLength(20);
  });

  it("não lê lançamentos, contas nem categorias de outra família", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    const seen = await db.withHousehold(ctxA, async (tx) => ({
      transactions: await tx.select().from(transactions),
      accounts: await tx.select().from(accounts),
      categories: await tx.select().from(categories),
    }));
    expect(seen.transactions).toHaveLength(0);
    expect(seen.accounts.every((a) => a.householdId === A.household)).toBe(true);
    expect(seen.categories.every((c) => c.householdId === A.household)).toBe(true);
  });

  it("não altera nem apaga lançamento de outra família", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    const result = await db.withHousehold(ctxA, async (tx) => ({
      updated: await tx
        .update(transactions)
        .set({ amount: "1.00" })
        .where(eq(transactions.id, transactionB))
        .returning(),
      deleted: await tx.delete(transactions).where(eq(transactions.id, transactionB)).returning(),
    }));
    expect(result.updated).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });

  it("FK composta impede lançamento e previsão com conta ou categoria alheia", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    const base = {
      householdId: A.household,
      kind: "despesa" as const,
      description: "Forjado",
      amount: "10.00",
    };
    await expect(
      db.withHousehold(ctxA, (tx) =>
        tx.insert(transactions).values({
          ...base,
          accountId: accountB,
          categoryId: categoryA,
          occurredOn: "2026-03-05",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctxA, (tx) =>
        tx.insert(transactions).values({
          ...base,
          accountId: accountA,
          categoryId: categoryB,
          occurredOn: "2026-03-05",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctxA, (tx) =>
        tx.insert(cashflowPlans).values({
          ...base,
          accountId: accountB,
          categoryId: categoryA,
          dayOfMonth: 5,
          startMonth: "2026-03",
        }),
      ),
    ).rejects.toThrow();
  });

  it("previsão gera no máximo um lançamento por mês", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    const base = {
      householdId: A.household,
      accountId: accountA,
      categoryId: categoryA,
      kind: "despesa" as const,
      description: "Aluguel",
      amount: "1500.00",
    };
    const planId = await db.withHousehold(ctxA, async (tx) => {
      const [plan] = await tx
        .insert(cashflowPlans)
        .values({ ...base, dayOfMonth: 10, startMonth: "2026-03" })
        .returning({ id: cashflowPlans.id });
      await tx
        .insert(transactions)
        .values({ ...base, occurredOn: "2026-03-10", planId: plan!.id, planMonth: "2026-03" });
      return plan!.id;
    });
    await expect(
      db.withHousehold(ctxA, (tx) =>
        tx
          .insert(transactions)
          .values({ ...base, occurredOn: "2026-03-11", planId, planMonth: "2026-03" }),
      ),
    ).rejects.toThrow();
  });

  it("papel viewer lê mas não lança", async () => {
    const ctxV = await ctxFor(A.viewer, A.household);
    await expect(
      db.withHousehold(ctxV, (tx) =>
        tx.insert(transactions).values({
          householdId: A.household,
          accountId: accountA,
          categoryId: categoryA,
          kind: "despesa",
          description: "Viewer",
          amount: "1.00",
          occurredOn: "2026-03-05",
        }),
      ),
    ).rejects.toThrow();
  });

  it("modelos de categoria são somente leitura para a aplicação", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctxA, (tx) =>
        tx.insert(categoryTemplates).values({ id: "x", name: "Global", kind: "despesa" }),
      ),
    ).rejects.toThrow();
  });
});

describe("isolamento de cartões e dívidas", () => {
  const {
    accounts,
    categories,
    creditCards,
    cardPurchases,
    cardStatementPayments,
    debts,
    debtInstallments,
    transactions,
  } = db;
  let ctxA: Awaited<ReturnType<typeof ctxFor>>;
  let ctxB: Awaited<ReturnType<typeof ctxFor>>;
  let accountA: string;
  let categoryA: string;
  let categoryB: string;
  let cardA: string;
  let debtA: string;
  let installmentA: string;

  beforeAll(async () => {
    ctxA = await ctxFor(A.owner, A.household);
    ctxB = await ctxFor(B.owner, B.household);
    const seed = (ctx: typeof ctxA) =>
      db.withHousehold(ctx, async (tx) => {
        await db.ensureFinanceDefaults(tx, ctx.householdId);
        const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
        const [category] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.name, "Compras"));
        return { account: account!.id, category: category!.id };
      });
    const a = await seed(ctxA);
    const b = await seed(ctxB);
    accountA = a.account;
    categoryA = a.category;
    categoryB = b.category;

    await db.withHousehold(ctxA, async (tx) => {
      const [card] = await tx
        .insert(creditCards)
        .values({
          householdId: A.household,
          name: "Cartão A",
          closingDay: 25,
          dueDay: 5,
          payingAccountId: accountA,
        })
        .returning({ id: creditCards.id });
      cardA = card!.id;
      await tx.insert(cardPurchases).values({
        householdId: A.household,
        cardId: cardA,
        categoryId: categoryA,
        description: "Compra secreta",
        amount: "300.00",
        installments: 3,
        purchasedOn: "2026-10-10",
      });
      const [debt] = await tx
        .insert(debts)
        .values({
          householdId: A.household,
          accountId: accountA,
          name: "Dívida secreta",
          system: "price",
          monthlyRate: "2",
          originalBalance: "1000.00",
        })
        .returning({ id: debts.id });
      debtA = debt!.id;
      const [installment] = await tx
        .insert(debtInstallments)
        .values({
          householdId: A.household,
          debtId: debtA,
          number: 1,
          dueDate: "2026-11-10",
          amount: "100.00",
          principal: "80.00",
          interest: "20.00",
        })
        .returning({ id: debtInstallments.id });
      installmentA = installment!.id;
    });
  });

  it("não lê cartões, compras, dívidas nem parcelas de outra família", async () => {
    await db.withHousehold(ctxB, async (tx) => {
      expect(await tx.select().from(creditCards)).toHaveLength(0);
      expect(await tx.select().from(cardPurchases)).toHaveLength(0);
      expect(await tx.select().from(cardStatementPayments)).toHaveLength(0);
      expect(await tx.select().from(debts)).toHaveLength(0);
      expect(await tx.select().from(debtInstallments)).toHaveLength(0);
    });
  });

  it("não altera nem apaga cartão e dívida de outra família", async () => {
    await db.withHousehold(ctxB, async (tx) => {
      expect(
        await tx
          .update(creditCards)
          .set({ name: "Invadido" })
          .where(eq(creditCards.id, cardA))
          .returning({ id: creditCards.id }),
      ).toHaveLength(0);
      expect(
        await tx.delete(debts).where(eq(debts.id, debtA)).returning({ id: debts.id }),
      ).toHaveLength(0);
    });
  });

  it("FK composta impede apontar para conta, cartão ou dívida alheia", async () => {
    await expect(
      db.withHousehold(ctxB, (tx) =>
        tx.insert(creditCards).values({
          householdId: B.household,
          name: "Forjado",
          closingDay: 1,
          dueDay: 10,
          payingAccountId: accountA,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctxB, (tx) =>
        tx.insert(cardPurchases).values({
          householdId: B.household,
          cardId: cardA,
          categoryId: categoryB,
          description: "Forjada",
          amount: "1.00",
          purchasedOn: "2026-10-10",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctxB, (tx) =>
        tx.insert(debtInstallments).values({
          householdId: B.household,
          debtId: debtA,
          number: 2,
          dueDate: "2026-12-10",
          amount: "1.00",
          principal: "1.00",
          interest: "0.00",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctxB, (tx) =>
        tx.insert(debts).values({
          householdId: B.household,
          accountId: accountA,
          name: "Forjada",
          system: "manual",
          originalBalance: "1.00",
        }),
      ),
    ).rejects.toThrow();
  });

  it("papel viewer lê mas não registra compra", async () => {
    const viewer = await ctxFor(A.viewer, A.household);
    await db.withHousehold(viewer, async (tx) => {
      expect(await tx.select().from(creditCards)).toHaveLength(1);
    });
    await expect(
      db.withHousehold(viewer, (tx) =>
        tx.insert(cardPurchases).values({
          householdId: A.household,
          cardId: cardA,
          categoryId: categoryA,
          description: "Sem permissão",
          amount: "1.00",
          purchasedOn: "2026-10-10",
        }),
      ),
    ).rejects.toThrow();
  });

  it("apagar o lançamento reabre a parcela e a fatura", async () => {
    await db.withHousehold(ctxA, async (tx) => {
      const [paid] = await tx
        .insert(transactions)
        .values({
          householdId: A.household,
          accountId: accountA,
          categoryId: categoryA,
          kind: "despesa",
          description: "Pagamento",
          amount: "100.00",
          occurredOn: "2026-11-10",
        })
        .returning({ id: transactions.id });
      await tx
        .update(debtInstallments)
        .set({ transactionId: paid!.id })
        .where(eq(debtInstallments.id, installmentA));
      await tx.insert(cardStatementPayments).values({
        householdId: A.household,
        cardId: cardA,
        statementMonth: "2026-11",
        transactionId: paid!.id,
      });
      await tx.delete(transactions).where(eq(transactions.id, paid!.id));

      const [installment] = await tx
        .select()
        .from(debtInstallments)
        .where(eq(debtInstallments.id, installmentA));
      expect(installment!.transactionId).toBeNull();
      expect(installment!.householdId).toBe(A.household);
      expect(await tx.select().from(cardStatementPayments)).toHaveLength(0);
    });
  });

  it("uma fatura só pode ser paga uma vez", async () => {
    await expect(
      db.withHousehold(ctxA, async (tx) => {
        const [paid] = await tx
          .insert(transactions)
          .values({
            householdId: A.household,
            accountId: accountA,
            categoryId: categoryA,
            kind: "despesa",
            description: "Pagamento",
            amount: "100.00",
            occurredOn: "2026-11-10",
          })
          .returning({ id: transactions.id });
        const payment = {
          householdId: A.household,
          cardId: cardA,
          statementMonth: "2026-12",
          transactionId: paid!.id,
        };
        await tx.insert(cardStatementPayments).values(payment);
        await tx.insert(cardStatementPayments).values(payment);
      }),
    ).rejects.toThrow();
  });

  it("famílias antigas recebem as categorias do sistema", async () => {
    await db.withHousehold(ctxB, async (tx) => {
      await db.ensureFinanceDefaults(tx, B.household);
      const rows = await tx
        .select({ name: categories.name })
        .from(categories)
        .where(eq(categories.kind, "despesa"));
      expect(rows.map((r) => r.name)).toEqual(
        expect.arrayContaining(["Cartão de crédito", "Dívidas e empréstimos"]),
      );
    });
  });
});

describe("isolamento da importação", () => {
  const { accounts, categories, importBatches, transactions } = db;
  let ctxA: Awaited<ReturnType<typeof ctxFor>>;
  let ctxB: Awaited<ReturnType<typeof ctxFor>>;
  let accountA: string;
  let accountB: string;
  let categoryA: string;
  let batchA: string;

  const batch = (householdId: string, accountId: string) => ({
    householdId,
    accountId,
    source: "ofx" as const,
    rowCount: 1,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
  });
  const line = (fingerprint: string) => ({
    householdId: A.household,
    accountId: accountA,
    categoryId: categoryA,
    kind: "despesa" as const,
    description: "Linha de extrato",
    amount: "10.00",
    occurredOn: "2026-10-05",
    importFingerprint: fingerprint,
  });

  beforeAll(async () => {
    ctxA = await ctxFor(A.owner, A.household);
    ctxB = await ctxFor(B.owner, B.household);
    const seed = (ctx: typeof ctxA) =>
      db.withHousehold(ctx, async (tx) => {
        await db.ensureFinanceDefaults(tx, ctx.householdId);
        const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
        const [category] = await tx.select({ id: categories.id }).from(categories).limit(1);
        return { account: account!.id, category: category!.id };
      });
    const a = await seed(ctxA);
    const b = await seed(ctxB);
    accountA = a.account;
    categoryA = a.category;
    accountB = b.account;
    await db.withHousehold(ctxA, async (tx) => {
      const [created] = await tx
        .insert(importBatches)
        .values(batch(A.household, accountA))
        .returning({ id: importBatches.id });
      batchA = created!.id;
    });
  });

  it("não lê nem apaga lote de outra família", async () => {
    await db.withHousehold(ctxB, async (tx) => {
      expect(await tx.select().from(importBatches)).toHaveLength(0);
      expect(
        await tx
          .delete(importBatches)
          .where(eq(importBatches.id, batchA))
          .returning({ id: importBatches.id }),
      ).toHaveLength(0);
    });
  });

  it("FK composta impede lote em conta alheia e lançamento em lote alheio", async () => {
    await expect(
      db.withHousehold(ctxB, (tx) => tx.insert(importBatches).values(batch(B.household, accountA))),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctxB, async (tx) => {
        const [category] = await tx.select({ id: categories.id }).from(categories).limit(1);
        await tx.insert(transactions).values({
          householdId: B.household,
          accountId: accountB,
          categoryId: category!.id,
          kind: "despesa",
          description: "Forjada",
          amount: "1.00",
          occurredOn: "2026-10-05",
          importBatchId: batchA,
        });
      }),
    ).rejects.toThrow();
  });

  it("papel viewer lê mas não importa", async () => {
    const viewer = await ctxFor(A.viewer, A.household);
    await expect(
      db.withHousehold(viewer, (tx) =>
        tx.insert(importBatches).values(batch(A.household, accountA)),
      ),
    ).rejects.toThrow();
  });

  it("a mesma linha não entra duas vezes na conta", async () => {
    await db.withHousehold(ctxA, async (tx) => {
      await tx.insert(transactions).values(line("ofx:id:R1#0"));
      const again = await tx
        .insert(transactions)
        .values(line("ofx:id:R1#0"))
        .onConflictDoNothing()
        .returning({ id: transactions.id });
      expect(again).toHaveLength(0);
    });
  });

  it("lançamentos manuais não colidem entre si", async () => {
    await db.withHousehold(ctxA, async (tx) => {
      await tx.insert(transactions).values({ ...line("x"), importFingerprint: null });
      await tx.insert(transactions).values({ ...line("x"), importFingerprint: null });
    });
  });

  it("apagar o lote mantém o lançamento e a família dele", async () => {
    await db.withHousehold(ctxA, async (tx) => {
      const [created] = await tx
        .insert(transactions)
        .values({ ...line("ofx:id:R2#0"), importBatchId: batchA })
        .returning({ id: transactions.id });
      await tx.delete(importBatches).where(eq(importBatches.id, batchA));
      const [kept] = await tx.select().from(transactions).where(eq(transactions.id, created!.id));
      expect(kept!.importBatchId).toBeNull();
      expect(kept!.householdId).toBe(A.household);
    });
  });
});

describe("isolamento de reserva e patrimônio", () => {
  const { accounts, assets, debts, earmarks, emergencyFund, netWorthSnapshots } = db;
  let ctxA: Awaited<ReturnType<typeof ctxFor>>;
  let ctxB: Awaited<ReturnType<typeof ctxFor>>;
  let accountA: string;
  let debtA: string;

  beforeAll(async () => {
    ctxA = await ctxFor(A.owner, A.household);
    ctxB = await ctxFor(B.owner, B.household);
    await db.withHousehold(ctxB, (tx) => db.ensureFinanceDefaults(tx, B.household));
    await db.withHousehold(ctxA, async (tx) => {
      await db.ensureFinanceDefaults(tx, A.household);
      const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
      accountA = account!.id;
      const [debt] = await tx
        .insert(debts)
        .values({
          householdId: A.household,
          accountId: accountA,
          name: "Dívida do bem",
          system: "manual",
          originalBalance: "10.00",
        })
        .returning({ id: debts.id });
      debtA = debt!.id;
      await tx.insert(emergencyFund).values({ householdId: A.household, targetMonths: 6 });
      await tx
        .insert(earmarks)
        .values({ householdId: A.household, accountId: accountA, purpose: "reserva" });
      await tx.insert(assets).values({
        householdId: A.household,
        name: "Imóvel secreto",
        kind: "imovel",
        value: "1000.00",
        valuedOn: "2026-10-30",
        linkedDebtId: debtA,
      });
      await db.recordNetWorth(tx, A.household, "2026-10", {
        owned: "1000.00",
        owed: "0.00",
        net: "1000.00",
      });
    });
  });

  it("não lê meta, contas marcadas, bens nem fotos de outra família", async () => {
    await db.withHousehold(ctxB, async (tx) => {
      expect(await tx.select().from(emergencyFund)).toHaveLength(0);
      expect(await tx.select().from(earmarks)).toHaveLength(0);
      expect(await tx.select().from(assets)).toHaveLength(0);
      expect(await tx.select().from(netWorthSnapshots)).toHaveLength(0);
    });
  });

  it("FK composta impede marcar conta alheia e ligar bem a dívida alheia", async () => {
    await expect(
      db.withHousehold(ctxB, (tx) =>
        tx
          .insert(earmarks)
          .values({ householdId: B.household, accountId: accountA, purpose: "reserva" }),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctxB, (tx) =>
        tx.insert(assets).values({
          householdId: B.household,
          name: "Forjado",
          kind: "outro",
          value: "1.00",
          valuedOn: "2026-10-30",
          linkedDebtId: debtA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("papel viewer lê mas não grava", async () => {
    const viewer = await ctxFor(A.viewer, A.household);
    await db.withHousehold(viewer, async (tx) => {
      expect(await tx.select().from(assets)).toHaveLength(1);
    });
    await expect(
      db.withHousehold(viewer, (tx) =>
        db.recordNetWorth(tx, A.household, "2026-11", { owned: "1", owed: "0", net: "1" }),
      ),
    ).rejects.toThrow();
  });

  it("a foto do mês é substituída, não repetida", async () => {
    await db.withHousehold(ctxA, async (tx) => {
      await db.recordNetWorth(tx, A.household, "2026-10", {
        owned: "2000.00",
        owed: "0.00",
        net: "2000.00",
      });
      const rows = await tx.select().from(netWorthSnapshots);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.net).toBe("2000.00");
    });
  });

  it("apagar a dívida mantém o bem e a família dele", async () => {
    await db.withHousehold(ctxA, async (tx) => {
      await tx.delete(debts).where(eq(debts.id, debtA));
      const [asset] = await tx.select().from(assets);
      expect(asset!.linkedDebtId).toBeNull();
      expect(asset!.householdId).toBe(A.household);
    });
  });

  it("o saldo soma movimentos realizados e a dívida soma parcelas em aberto", async () => {
    const { categories, debtInstallments, transactions } = db;
    await db.withHousehold(ctxB, async (tx) => {
      const [account] = await tx
        .insert(accounts)
        .values({ householdId: B.household, name: "Conta da conta", openingBalance: "100.00" })
        .returning({ id: accounts.id });
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.kind, "despesa"))
        .limit(1);
      const move = (
        amount: string,
        status: "realizado" | "previsto",
        kind: "receita" | "despesa",
      ) => ({
        householdId: B.household,
        accountId: account!.id,
        categoryId: category!.id,
        kind,
        description: "Movimento",
        amount,
        occurredOn: "2026-10-05",
        status,
      });
      await tx
        .insert(transactions)
        .values([
          move("40.00", "realizado", "despesa"),
          move("15.00", "realizado", "receita"),
          move("999.00", "previsto", "despesa"),
        ]);
      const [debt] = await tx
        .insert(debts)
        .values({
          householdId: B.household,
          accountId: account!.id,
          name: "Dívida da conta",
          system: "manual",
          originalBalance: "300.00",
        })
        .returning({ id: debts.id });
      const [paid] = await tx
        .insert(transactions)
        .values(move("100.00", "realizado", "despesa"))
        .returning({ id: transactions.id });
      await tx.insert(debtInstallments).values(
        [1, 2, 3].map((number) => ({
          householdId: B.household,
          debtId: debt!.id,
          number,
          dueDate: "2026-11-10",
          amount: "100.00",
          principal: "90.00",
          interest: "10.00",
          transactionId: number === 1 ? paid!.id : null,
        })),
      );

      const input = await db.netWorthInputs(tx);
      expect(input.accounts.find((a) => a.id === account!.id)?.balance).toBe("-25.00");
      expect(input.debts.find((d) => d.id === debt!.id)?.balance).toBe("180.00");
    });
  });

  it("os dados do patrimônio respeitam a família do contexto", async () => {
    const seen = await db.withHousehold(ctxB, (tx) => db.netWorthInputs(tx));
    expect(seen.assets).toHaveLength(0);
    expect(seen.accounts.map((account) => account.name)).not.toContain("Dívida do bem");
    expect(seen.debts.map((debt) => debt.name)).not.toContain("Dívida do bem");
    const own = await db.withHousehold(ctxA, (tx) => db.netWorthInputs(tx));
    expect(own.assets).toHaveLength(1);
  });

  it("worker grava a foto só da família do job", async () => {
    const raw = postgres(urls.worker, { max: 1 });
    try {
      await raw.begin(async (tx) => {
        await tx`select set_config('app.household_id', ${B.household}, true), set_config('app.role', 'system', true)`;
        await tx`insert into net_worth_snapshots (household_id, month, owned, owed, net) values (${B.household}, '2026-10', 1, 0, 1)`;
      });
      await expect(
        raw.begin(async (tx) => {
          await tx`select set_config('app.household_id', ${B.household}, true), set_config('app.role', 'system', true)`;
          await tx`insert into net_worth_snapshots (household_id, month, owned, owed, net) values (${A.household}, '2026-09', 1, 0, 1)`;
        }),
      ).rejects.toThrow();
    } finally {
      await raw.end();
    }
  });

  it("lista as famílias sem expor dados delas", async () => {
    const ids = await db.listHouseholdIds();
    expect(ids).toEqual(expect.arrayContaining([A.household, B.household]));
  });
});

describe("isolamento do calendário", () => {
  const { calendarEvents } = db;
  const event = (householdId: string) => ({
    householdId,
    title: "Consulta secreta",
    eventDate: "2026-11-15",
  });

  it("não lê, altera nem apaga compromisso de outra família", async () => {
    const ctxA = await ctxFor(A.owner, A.household);
    const ctxB = await ctxFor(B.owner, B.household);
    const [created] = await db.withHousehold(ctxA, (tx) =>
      tx.insert(calendarEvents).values(event(A.household)).returning({ id: calendarEvents.id }),
    );
    await db.withHousehold(ctxB, async (tx) => {
      expect(await tx.select().from(calendarEvents)).toHaveLength(0);
      expect(
        await tx
          .update(calendarEvents)
          .set({ title: "Invadido" })
          .where(eq(calendarEvents.id, created!.id))
          .returning({ id: calendarEvents.id }),
      ).toHaveLength(0);
      expect(
        await tx
          .delete(calendarEvents)
          .where(eq(calendarEvents.id, created!.id))
          .returning({ id: calendarEvents.id }),
      ).toHaveLength(0);
    });
    await db.withHousehold(ctxA, async (tx) => {
      expect(await tx.select().from(calendarEvents)).toHaveLength(1);
    });
  });

  it("não grava compromisso com a família de outra pessoa", async () => {
    const ctxB = await ctxFor(B.owner, B.household);
    await expect(
      db.withHousehold(ctxB, (tx) => tx.insert(calendarEvents).values(event(A.household))),
    ).rejects.toThrow();
  });

  it("papel viewer lê mas não marca compromisso", async () => {
    const viewer = await ctxFor(A.viewer, A.household);
    await db.withHousehold(viewer, async (tx) => {
      expect(await tx.select().from(calendarEvents)).toHaveLength(1);
    });
    await expect(
      db.withHousehold(viewer, (tx) => tx.insert(calendarEvents).values(event(A.household))),
    ).rejects.toThrow();
  });
});

describe("isolamento da renda", () => {
  const { accounts, categories, fiscalParameters, incomeReceipts, incomeSources, transactions } =
    db;
  let ctxA: Awaited<ReturnType<typeof ctxFor>>;
  let ctxB: Awaited<ReturnType<typeof ctxFor>>;
  let accountA: string;
  let accountB: string;
  let categoryA: string;
  let categoryB: string;
  let sourceA: string;

  const income = (householdId: string, accountId: string, categoryId: string) => ({
    householdId,
    accountId,
    categoryId,
    name: "Empresa secreta",
    kind: "clt" as const,
    amount: "6000.00",
    isGross: true,
    payDay: 5,
    startMonth: "2026-10",
  });

  beforeAll(async () => {
    ctxA = await ctxFor(A.owner, A.household);
    ctxB = await ctxFor(B.owner, B.household);
    const seed = (ctx: typeof ctxA) =>
      db.withHousehold(ctx, async (tx) => {
        await db.ensureFinanceDefaults(tx, ctx.householdId);
        const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
        const [category] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.name, "Salário"));
        return { account: account!.id, category: category!.id };
      });
    const a = await seed(ctxA);
    const b = await seed(ctxB);
    accountA = a.account;
    categoryA = a.category;
    accountB = b.account;
    categoryB = b.category;
    await db.withHousehold(ctxA, async (tx) => {
      const [created] = await tx
        .insert(incomeSources)
        .values(income(A.household, accountA, categoryA))
        .returning({ id: incomeSources.id });
      sourceA = created!.id;
    });
  });

  it("não lê, altera nem apaga renda de outra família", async () => {
    await db.withHousehold(ctxB, async (tx) => {
      expect(await tx.select().from(incomeSources)).toHaveLength(0);
      expect(await tx.select().from(incomeReceipts)).toHaveLength(0);
      expect(
        await tx
          .update(incomeSources)
          .set({ name: "Invadido" })
          .where(eq(incomeSources.id, sourceA))
          .returning({ id: incomeSources.id }),
      ).toHaveLength(0);
      expect(
        await tx
          .delete(incomeSources)
          .where(eq(incomeSources.id, sourceA))
          .returning({ id: incomeSources.id }),
      ).toHaveLength(0);
    });
  });

  it("FK composta impede renda com conta, categoria ou pessoa alheia", async () => {
    await expect(
      db.withHousehold(ctxB, (tx) =>
        tx.insert(incomeSources).values(income(B.household, accountA, categoryB)),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctxB, (tx) =>
        tx.insert(incomeSources).values(income(B.household, accountB, categoryA)),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctxB, (tx) =>
        tx
          .insert(incomeSources)
          .values({ ...income(B.household, accountB, categoryB), personId: personA }),
      ),
    ).rejects.toThrow();
  });

  it("papel viewer lê mas não cadastra renda", async () => {
    const viewer = await ctxFor(A.viewer, A.household);
    await db.withHousehold(viewer, async (tx) => {
      expect(await tx.select().from(incomeSources)).toHaveLength(1);
    });
    await expect(
      db.withHousehold(viewer, (tx) =>
        tx.insert(incomeSources).values(income(A.household, accountA, categoryA)),
      ),
    ).rejects.toThrow();
  });

  it("apagar o lançamento devolve a previsão, e o recebimento não repete", async () => {
    await db.withHousehold(ctxA, async (tx) => {
      const [received] = await tx
        .insert(transactions)
        .values({
          householdId: A.household,
          accountId: accountA,
          categoryId: categoryA,
          kind: "receita",
          description: "Salário recebido",
          amount: "4973.39",
          occurredOn: "2026-10-05",
        })
        .returning({ id: transactions.id });
      await tx.insert(incomeReceipts).values({
        householdId: A.household,
        incomeSourceId: sourceA,
        month: "2026-10",
        part: "salario",
        transactionId: received!.id,
      });
      await tx.delete(transactions).where(eq(transactions.id, received!.id));
      expect(await tx.select().from(incomeReceipts)).toHaveLength(0);
    });
    await expect(
      db.withHousehold(ctxA, async (tx) => {
        const [received] = await tx
          .insert(transactions)
          .values({
            householdId: A.household,
            accountId: accountA,
            categoryId: categoryA,
            kind: "receita",
            description: "Salário recebido",
            amount: "4973.39",
            occurredOn: "2026-10-05",
          })
          .returning({ id: transactions.id });
        const receipt = {
          householdId: A.household,
          incomeSourceId: sourceA,
          month: "2026-11",
          part: "salario" as const,
          transactionId: received!.id,
        };
        await tx.insert(incomeReceipts).values(receipt);
        await tx.insert(incomeReceipts).values(receipt);
      }),
    ).rejects.toThrow();
  });

  it("tabelas fiscais são públicas e somente leitura para a aplicação", async () => {
    await db.withHousehold(ctxB, async (tx) => {
      const [row] = await tx.select().from(fiscalParameters);
      const params = row!.params as { inss: Array<{ upTo: string }>; dependentDeduction: string };
      expect(row!.validFrom).toBe("2026-01");
      expect(params.inss.at(-1)!.upTo).toBe("8475.55");
      expect(params.dependentDeduction).toBe("189.59");
    });
    await expect(
      db.withHousehold(ctxA, (tx) =>
        tx.insert(fiscalParameters).values({ validFrom: "2099-01", source: "x", params: {} }),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctxA, (tx) => tx.update(fiscalParameters).set({ source: "alterado" })),
    ).rejects.toThrow();
  });
});

describe("memória e relatórios dos agentes", () => {
  it("guarda e acha memória em português, inclusive por outra forma da palavra", async () => {
    await db.addAgentMemory({
      agent: "sre",
      kind: "licao",
      content: "Reiniciar o worker libera as filas travadas.",
      sourceIssue: "ORG-1",
    });
    const found = await db.findAgentMemories({ agent: "sre", query: "fila travada" });
    expect(found.map((m) => m.sourceIssue)).toContain("ORG-1");
  });

  it("memória substituída sai das buscas", async () => {
    const old = await db.addAgentMemory({
      agent: "qa",
      kind: "fato",
      content: "Limite antigo de lote",
    });
    await db.addAgentMemory({
      agent: "qa",
      kind: "fato",
      content: "Limite novo de lote",
      supersedes: old.id,
    });
    const found = await db.findAgentMemories({ agent: "qa" });
    expect(found.map((m) => m.content)).toEqual(["Limite novo de lote"]);
  });

  it("memória de um agente não aparece filtrando por outro", async () => {
    await db.addAgentMemory({
      agent: "engenheiro",
      kind: "decisao",
      content: "Usar fila do pgboss",
    });
    expect(await db.findAgentMemories({ agent: "tech-lead" })).toEqual([]);
  });

  it("reenviar o relatório do período atualiza em vez de duplicar", async () => {
    const report = {
      kind: "saude" as const,
      period: "2026-10-30",
      agent: "sre",
      title: "Saúde do dia",
      body: "Tudo no ar.",
    };
    await db.saveReport(report);
    await db.saveReport({ ...report, body: "Queda de 2 minutos." });
    const rows = await db.listReports({ kind: "saude" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe("Queda de 2 minutos.");
  });

  it("a aplicação não apaga memória nem relatório", async () => {
    const raw = postgres(urls.app, { max: 1 });
    try {
      await expect(raw`delete from ops.agent_memory`).rejects.toThrow();
      await expect(raw`delete from ops.reports`).rejects.toThrow();
    } finally {
      await raw.end();
    }
  });
});

describe("isolamento de investimentos", () => {
  const { investments, investmentTrades, dividends, investmentTargets, dividendGoals } = db;
  let holdingB = "";

  const seed =
    (householdId: string, ticker: string) =>
    async (tx: Parameters<Parameters<typeof db.withHousehold>[1]>[0]) => {
      const [holding] = await tx
        .insert(investments)
        .values({ householdId, name: "Ação", ticker, assetClass: "acao", currentPrice: "10" })
        .returning({ id: investments.id });
      await tx.insert(investmentTrades).values({
        householdId,
        investmentId: holding!.id,
        side: "compra",
        occurredOn: "2026-01-10",
        quantity: "10",
        unitPrice: "8",
      });
      await tx.insert(dividends).values({
        householdId,
        investmentId: holding!.id,
        kind: "dividendo",
        paidOn: "2026-02-10",
        gross: "5.00",
      });
      await tx.insert(investmentTargets).values({ householdId, assetClass: "acao", percent: "50" });
      await tx.insert(dividendGoals).values({ householdId, monthlyAmount: "100.00" });
      return holding!.id;
    };

  beforeAll(async () => {
    await db.withHousehold(await ctxFor(A.owner, A.household), seed(A.household, "AAAA3"));
    holdingB = await db.withHousehold(
      await ctxFor(B.owner, B.household),
      seed(B.household, "BBBB3"),
    );
  });

  it("não lê investimentos, operações, proventos nem metas de outra família", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    const seen = await db.withHousehold(ctx, async (tx) => ({
      investments: await tx.select().from(investments),
      trades: await tx.select().from(investmentTrades),
      dividends: await tx.select().from(dividends),
      targets: await tx.select().from(investmentTargets),
      goals: await tx.select().from(dividendGoals),
    }));
    for (const rows of Object.values(seen)) {
      expect(rows).toHaveLength(1);
      expect(rows[0]!.householdId).toBe(A.household);
    }
  });

  it("não altera nem apaga investimento de outra família", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await db.withHousehold(ctx, async (tx) => {
      const changed = await tx
        .update(investments)
        .set({ name: "Invadido" })
        .where(eq(investments.id, holdingB))
        .returning({ id: investments.id });
      const removed = await tx
        .delete(investments)
        .where(eq(investments.id, holdingB))
        .returning({ id: investments.id });
      expect(changed).toHaveLength(0);
      expect(removed).toHaveLength(0);
    });
  });

  it("FK composta impede operação e provento em investimento alheio", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(investmentTrades).values({
          householdId: A.household,
          investmentId: holdingB,
          side: "compra",
          occurredOn: "2026-01-10",
          quantity: "1",
          unitPrice: "1",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(dividends).values({
          householdId: A.household,
          investmentId: holdingB,
          kind: "jcp",
          paidOn: "2026-02-10",
          gross: "1.00",
        }),
      ),
    ).rejects.toThrow();
  });

  it("papel viewer lê mas não registra", async () => {
    const ctx = await ctxFor(A.viewer, A.household);
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(investments).values({
          householdId: A.household,
          name: "Fundo",
          assetClass: "fundo",
        }),
      ),
    ).rejects.toThrow();
    const rows = await db.withHousehold(ctx, (tx) => tx.select().from(investments));
    expect(rows).toHaveLength(1);
  });

  it("apagar o investimento leva operações e proventos, e o patrimônio soma a carteira", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await db.withHousehold(ctx, async (tx) => {
      const input = await db.netWorthInputs(tx);
      expect(input.investments[0]!.trades).toHaveLength(1);
      await tx.delete(investments);
      expect(await tx.select().from(investmentTrades)).toHaveLength(0);
      expect(await tx.select().from(dividends)).toHaveLength(0);
    });
  });
});

describe("memória e relatórios do agente de categorização", () => {
  const { categories, categoryMemory, householdReports } = db;
  let categoryA = "";
  let categoryB = "";

  beforeAll(async () => {
    const seed =
      (householdId: string) =>
      async (tx: Parameters<Parameters<typeof db.withHousehold>[1]>[0]) => {
        await db.ensureFinanceDefaults(tx, householdId);
        const [category] = await tx.select({ id: categories.id }).from(categories).limit(1);
        await tx.insert(categoryMemory).values({
          householdId,
          kind: "despesa",
          merchant: "padaria exemplo",
          categoryId: category!.id,
          source: "agente",
        });
        await tx.insert(householdReports).values({
          householdId,
          agent: "categorizacao",
          kind: "importacao",
          period: "lote-1",
          title: "Extrato",
          summary: "Segredo do relatório",
        });
        return category!.id;
      };
    categoryA = await db.withHousehold(await ctxFor(A.owner, A.household), seed(A.household));
    categoryB = await db.withHousehold(await ctxFor(B.owner, B.household), seed(B.household));
  });

  it("não lê memória nem relatório de outra família", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await db.withHousehold(ctx, async (tx) => {
      const memory = await tx.select().from(categoryMemory);
      const reports = await tx.select().from(householdReports);
      expect(memory.map((row) => row.householdId)).toEqual([A.household]);
      expect(reports.map((row) => row.householdId)).toEqual([A.household]);
    });
  });

  it("FK composta impede guardar categoria de outra família", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(categoryMemory).values({
          householdId: A.household,
          kind: "despesa",
          merchant: "invasao",
          categoryId: categoryB,
          source: "agente",
        }),
      ),
    ).rejects.toThrow();
  });

  it("papel viewer lê mas não grava", async () => {
    const ctx = await ctxFor(A.viewer, A.household);
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(categoryMemory).values({
          householdId: A.household,
          kind: "despesa",
          merchant: "leitura",
          categoryId: categoryA,
          source: "agente",
        }),
      ),
    ).rejects.toThrow();
    const rows = await db.withHousehold(ctx, (tx) => tx.select().from(householdReports));
    expect(rows).toHaveLength(1);
  });

  it("as contagens para a equipe somam por dia, sem nada da família", async () => {
    const counts = {
      rowCount: 10,
      fromMemory: 4,
      fromWords: 3,
      unmatched: 3,
      corrected: 1,
      categoriesCreated: 2,
    };
    await db.recordCategorizationStats("2026-10-30", counts);
    await db.recordCategorizationStats("2026-10-30", counts);
    const [row] = await db.listCategorizationStats(1);
    expect(row).toMatchObject({ day: "2026-10-30", imports: 2, rowCount: 20, unmatched: 6 });
  });
});

describe("isolamento de aposentadoria e viagens", () => {
  const { retirementScenarios, trips, tripCosts, tripPeople } = db;
  const scenario = (householdId: string, personId: string) => ({
    householdId,
    personId,
    name: "Base",
    targetAge: 65,
    lifeExpectancy: 90,
    targetIncome: "5000.00",
    returnBefore: "4.00",
    returnAfter: "2.00",
  });
  let tripB = "";

  beforeAll(async () => {
    const seed =
      (householdId: string, personId: string) =>
      async (tx: Parameters<Parameters<typeof db.withHousehold>[1]>[0]) => {
        await tx.insert(retirementScenarios).values(scenario(householdId, personId));
        const [trip] = await tx
          .insert(trips)
          .values({ householdId, destination: "Destino", startOn: "2027-01-10" })
          .returning({ id: trips.id });
        await tx.insert(tripCosts).values({
          householdId,
          tripId: trip!.id,
          kind: "passagem",
          amount: "100.00",
        });
        await tx.insert(tripPeople).values({ householdId, tripId: trip!.id, personId });
        return trip!.id;
      };
    await db.withHousehold(await ctxFor(A.owner, A.household), seed(A.household, personA));
    tripB = await db.withHousehold(await ctxFor(B.owner, B.household), seed(B.household, personB));
  });

  it("não lê cenário nem viagem de outra família", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await db.withHousehold(ctx, async (tx) => {
      for (const table of [retirementScenarios, trips, tripCosts, tripPeople]) {
        const rows = await tx.select().from(table as typeof trips);
        expect(rows.map((row) => row.householdId)).toEqual([A.household]);
      }
    });
  });

  it("não altera nem apaga viagem de outra família", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await db.withHousehold(ctx, async (tx) => {
      const changed = await tx
        .update(trips)
        .set({ destination: "Invadido" })
        .where(eq(trips.id, tripB))
        .returning({ id: trips.id });
      const removed = await tx.delete(trips).where(eq(trips.id, tripB)).returning({ id: trips.id });
      expect(changed).toHaveLength(0);
      expect(removed).toHaveLength(0);
    });
  });

  it("FK composta impede pessoa ou viagem de outra família", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(retirementScenarios).values(scenario(A.household, personB)),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(tripCosts).values({
          householdId: A.household,
          tripId: tripB,
          kind: "outros",
          amount: "1.00",
        }),
      ),
    ).rejects.toThrow();
  });

  it("papel viewer lê mas não planeja", async () => {
    const ctx = await ctxFor(A.viewer, A.household);
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(retirementScenarios).values(scenario(A.household, personA)),
      ),
    ).rejects.toThrow();
    const rows = await db.withHousehold(ctx, (tx) => tx.select().from(trips));
    expect(rows).toHaveLength(1);
  });
});

describe("isolamento de metas, sugestões e plano por proventos", () => {
  const {
    accounts,
    calendarEvents,
    categories,
    emergencyFund,
    goalContributions,
    goals,
    householdReports,
    householdSuggestions,
    retirementPlan,
    transactions,
    tripDestinationTemplates,
  } = db;
  type Tx = Parameters<Parameters<typeof db.withHousehold>[1]>[0];
  let goalA = "";
  let goalB = "";
  let accountB = "";

  beforeAll(async () => {
    const seed = (householdId: string) => async (tx: Tx) => {
      await db.ensureFinanceDefaults(tx, householdId);
      const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
      await tx
        .insert(retirementPlan)
        .values({ householdId, targetIncome: "6000.00", expectedYield: "6.00" })
        .onConflictDoNothing();
      const [goal] = await tx
        .insert(goals)
        .values({
          householdId,
          name: "Carro",
          kind: "veiculo",
          targetAmount: "30000.00",
          accountId: account!.id,
        })
        .returning({ id: goals.id });
      await tx.insert(goalContributions).values({
        householdId,
        goalId: goal!.id,
        month: "2027-01",
        amount: "500.00",
      });
      await tx.insert(householdSuggestions).values({
        householdId,
        agent: "metas",
        kind: "meta",
        title: "Ajuste da meta",
        body: "Segredo da sugestão",
        dedupeKey: "meta:carro:2027-01",
      });
      return { goalId: goal!.id, accountId: account!.id };
    };
    const a = await db.withHousehold(await ctxFor(A.owner, A.household), seed(A.household));
    goalA = a.goalId;
    const b = await db.withHousehold(await ctxFor(B.owner, B.household), seed(B.household));
    goalB = b.goalId;
    accountB = b.accountId;
  });

  it("não lê plano, metas, parcelas nem sugestões de outra família", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await db.withHousehold(ctx, async (tx) => {
      for (const table of [retirementPlan, goals, goalContributions, householdSuggestions]) {
        const rows = await tx.select().from(table as typeof goals);
        expect(rows.map((row) => row.householdId)).toEqual([A.household]);
      }
    });
  });

  it("não altera nem apaga meta ou sugestão de outra família; plano 1:1 não se apaga", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await db.withHousehold(ctx, async (tx) => {
      const changed = await tx
        .update(goals)
        .set({ name: "Invadido" })
        .where(eq(goals.id, goalB))
        .returning({ id: goals.id });
      const removed = await tx.delete(goals).where(eq(goals.id, goalB)).returning({ id: goals.id });
      const decided = await tx
        .update(householdSuggestions)
        .set({ status: "ignorada" })
        .where(eq(householdSuggestions.householdId, B.household))
        .returning({ id: householdSuggestions.id });
      expect(changed).toHaveLength(0);
      expect(removed).toHaveLength(0);
      expect(decided).toHaveLength(0);
      // Sem policy DELETE: nem a própria família apaga o plano (como household_settings).
      const plan = await tx
        .delete(retirementPlan)
        .where(eq(retirementPlan.householdId, A.household))
        .returning({ id: retirementPlan.householdId });
      expect(plan).toHaveLength(0);
      expect(await tx.select().from(retirementPlan)).toHaveLength(1);
    });
  });

  it("FK composta impede conta, meta ou lançamento de outra família", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(goals).values({
          householdId: A.household,
          name: "Casa",
          kind: "imovel",
          targetAmount: "1.00",
          accountId: accountB,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(goalContributions).values({
          householdId: A.household,
          goalId: goalB,
          month: "2027-03",
          amount: "1.00",
        }),
      ),
    ).rejects.toThrow();
  });

  it("papel viewer lê mas não cria meta nem decide sugestão", async () => {
    const ctx = await ctxFor(A.viewer, A.household);
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(goals).values({
          householdId: A.household,
          name: "Viagem",
          kind: "outro",
          targetAmount: "10.00",
        }),
      ),
    ).rejects.toThrow();
    await db.withHousehold(ctx, async (tx) => {
      const decided = await tx
        .update(householdSuggestions)
        .set({ status: "aplicada" })
        .returning({ id: householdSuggestions.id });
      expect(decided).toHaveLength(0);
      expect(await tx.select().from(goals)).toHaveLength(1);
    });
  });

  it("upsert pelo índice parcial mantém uma pendente por chave e não toca nas decididas", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    const key = "aporte_reserva:2026-11";
    const upsert = (tx: Tx, title: string) =>
      tx
        .insert(householdSuggestions)
        .values({
          householdId: A.household,
          agent: "aposentadoria",
          kind: "aporte_reserva",
          title,
          body: "Guarde um pouco mais na reserva.",
          dedupeKey: key,
        })
        .onConflictDoUpdate({
          target: [householdSuggestions.householdId, householdSuggestions.dedupeKey],
          targetWhere: sql`status = 'pendente'`,
          set: { title },
        });
    await db.withHousehold(ctx, async (tx) => {
      await upsert(tx, "Primeira");
      await upsert(tx, "Segunda");
      const pending = await tx
        .select()
        .from(householdSuggestions)
        .where(eq(householdSuggestions.dedupeKey, key));
      expect(pending).toHaveLength(1);
      expect(pending[0]!.title).toBe("Segunda");
      expect(pending[0]!.status).toBe("pendente");
      expect(pending[0]!.appliedBy).toBe("familia");

      await tx
        .update(householdSuggestions)
        .set({ status: "ignorada", decidedAt: new Date(), decidedBy: A.owner })
        .where(eq(householdSuggestions.dedupeKey, key));
      await upsert(tx, "Terceira");
      const rows = await tx
        .select({ status: householdSuggestions.status, title: householdSuggestions.title })
        .from(householdSuggestions)
        .where(eq(householdSuggestions.dedupeKey, key));
      expect(rows.map((row) => row.status).sort()).toEqual(["ignorada", "pendente"]);
    });
  });

  it("worker grava parcelas e sugestões só da família do job", async () => {
    const raw = postgres(urls.worker, { max: 1 });
    try {
      await raw.begin(async (tx) => {
        await tx`select set_config('app.household_id', ${A.household}, true), set_config('app.role', 'system', true)`;
        await tx`insert into goal_contributions (household_id, goal_id, month, amount) values (${A.household}, ${goalA}, '2027-02', 100)`;
        await tx`insert into household_suggestions (household_id, agent, kind, title, body, dedupe_key, status, applied_by)
          values (${A.household}, 'categorias', 'categoria', 'Movemos 2 lançamentos', 'Para Mercado', 'categoria:despesa:padaria:x', 'aplicada', 'agente')`;
      });
      await expect(
        raw.begin(async (tx) => {
          await tx`select set_config('app.household_id', ${A.household}, true), set_config('app.role', 'system', true)`;
          await tx`insert into goal_contributions (household_id, goal_id, month, amount) values (${B.household}, ${goalB}, '2027-02', 100)`;
        }),
      ).rejects.toThrow();
    } finally {
      await raw.end();
    }
    const ctx = await ctxFor(A.owner, A.household);
    const rows = await db.withHousehold(ctx, (tx) =>
      tx.select().from(goalContributions).where(eq(goalContributions.goalId, goalA)),
    );
    expect(rows.map((row) => row.month).sort()).toEqual(["2027-01", "2027-02"]);
  });

  it("worker lê a auditoria da família em contexto; na web, 'system' e adulto continuam sem ver", async () => {
    const raw = postgres(urls.worker, { max: 1 });
    try {
      const rows = await raw.begin(async (tx) => {
        await tx`select set_config('app.household_id', ${A.household}, true), set_config('app.role', 'system', true)`;
        return tx<{ household_id: string }[]>`select distinct household_id from audit_log`;
      });
      expect(rows.map((row) => row.household_id)).toEqual([A.household]);
    } finally {
      await raw.end();
    }
    const viaWeb = await db.withHousehold(db.fromJob({ householdId: A.household }), (tx) =>
      tx.select().from(auditLog),
    );
    expect(viaWeb).toHaveLength(0);
    const asAdult = await db.withHousehold(await ctxFor(A.adult, A.household), (tx) =>
      tx.select().from(auditLog),
    );
    expect(asAdult).toHaveLength(0);
  });

  it("colunas novas do cadastro complementar aceitam e validam valores", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await db.withHousehold(ctx, async (tx) => {
      await tx
        .update(householdSettings)
        .set({
          retirementYear: 2050,
          tripsPerYear: 2,
          tripDays: 7,
          weddingMonth: 5,
          weddingYear: 2015,
          onboardingVersion: 1,
          onboardingCompletedAt: new Date(),
        })
        .where(eq(householdSettings.householdId, A.household));
      await tx
        .update(people)
        .set({
          workStatus: "clt",
          inssContributor: true,
          expectedPension: "2500.00",
          retirementAge: 65,
        })
        .where(eq(people.id, personA));
      await tx
        .insert(emergencyFund)
        .values({ householdId: A.household, contribution: "300.00" })
        .onConflictDoUpdate({ target: emergencyFund.householdId, set: { contribution: "300.00" } });
      const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.kind, "despesa"))
        .limit(1);
      const [entry] = await tx
        .insert(transactions)
        .values({
          householdId: A.household,
          accountId: account!.id,
          categoryId: category!.id,
          kind: "despesa",
          description: "Compra para revisar",
          amount: "10.00",
          occurredOn: "2026-10-01",
          categorySource: "revisar",
        })
        .returning({ categorySource: transactions.categorySource });
      expect(entry!.categorySource).toBe("revisar");
      const [settings] = await tx.select().from(householdSettings);
      expect(settings).toMatchObject({
        retirementYear: 2050,
        tripsPerYear: 2,
        onboardingVersion: 1,
      });
      const [person] = await tx.select().from(people).where(eq(people.id, personA));
      expect(person).toMatchObject({ workStatus: "clt", expectedPension: "2500.00" });
      const [fund] = await tx.select().from(emergencyFund);
      expect(fund!.contribution).toBe("300.00");
    });
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx
          .update(householdSettings)
          .set({ tripsPerYear: 13 })
          .where(eq(householdSettings.householdId, A.household)),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.execute(sql`update people set work_status = 'freelancer' where id = ${personA}`),
      ),
    ).rejects.toThrow();
  });

  it("o evento de casamento só aponta para evento da própria família", async () => {
    const ctxB = await ctxFor(B.owner, B.household);
    const eventB = await db.withHousehold(ctxB, async (tx) => {
      const [row] = await tx
        .insert(calendarEvents)
        .values({
          householdId: B.household,
          title: "Aniversário",
          eventDate: "2015-05-10",
          yearly: true,
        })
        .returning({ id: calendarEvents.id });
      return row!.id;
    });
    const ctx = await ctxFor(A.owner, A.household);
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx
          .update(householdSettings)
          .set({ weddingEventId: eventB })
          .where(eq(householdSettings.householdId, A.household)),
      ),
    ).rejects.toThrow();
    await db.withHousehold(ctx, async (tx) => {
      const [own] = await tx
        .insert(calendarEvents)
        .values({
          householdId: A.household,
          title: "Aniversário de casamento",
          eventDate: "2015-05-10",
          yearly: true,
        })
        .returning({ id: calendarEvents.id });
      await tx
        .update(householdSettings)
        .set({ weddingEventId: own!.id })
        .where(eq(householdSettings.householdId, A.household));
      await tx.delete(calendarEvents).where(eq(calendarEvents.id, own!.id));
      const [settings] = await tx.select().from(householdSettings);
      expect(settings!.weddingEventId).toBeNull();
      expect(settings!.householdId).toBe(A.household);
    });
  });

  it("relatórios aceitam os tipos dos agentes diários e recusam outros", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await db.withHousehold(ctx, (tx) =>
      tx.insert(householdReports).values({
        householdId: A.household,
        agent: "metas",
        kind: "metas",
        period: "2026-10-31",
        title: "Metas de hoje",
        summary: "Plano recalculado.",
      }),
    );
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.execute(sql`insert into household_reports (household_id, agent, kind, period, title, summary)
          values (${A.household}, 'x', 'inventado', 'p', 't', 's')`),
      ),
    ).rejects.toThrow();
  });

  it("a tabela de destinos é global, cita fonte em toda linha e é somente leitura", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    const rows = await db.withHousehold(ctx, (tx) => tx.select().from(tripDestinationTemplates));
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const row of rows) {
      expect(row.source).toMatch(/20\d\d/);
      expect(["baixa", "media"]).toContain(row.confidence);
      expect(Number(row.flightPerPerson) % 100).toBe(0);
      expect(Number(row.lodgingPerNight) % 100).toBe(0);
    }
    expect(new Set(rows.map((row) => row.region))).toEqual(
      expect.objectContaining(
        new Set(["brasil", "america_sul", "america_norte", "europa", "asia_oceania"]),
      ),
    );
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(tripDestinationTemplates).values({
          id: "x",
          name: "Lugar",
          country: "BR",
          region: "brasil",
          lodgingPerNight: "1.00",
          foodPerPersonDay: "1.00",
          localTransportPerPersonDay: "1.00",
          flightPerPerson: "1.00",
          source: "fonte inventada 2026",
          confidence: "baixa",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.update(tripDestinationTemplates).set({ flightPerPerson: "1.00" }),
      ),
    ).rejects.toThrow();
  });

  describe("tabelas de mercado (ADR-0017)", () => {
    const { dividends, investments, marketDividends, marketIndices, marketQuotes, marketUsage } =
      db;
    const worker = () => postgres(urls.worker, { max: 1, onnotice: () => {} });
    const dividendRow = {
      ticker: "PETR4",
      kind: "jcp",
      com_date: "2026-08-21",
      pay_date: "2026-09-21",
      rate_per_share: "0.67407131",
      source: "teste",
    };

    it("só o worker grava; web lê; ninguém apaga", async () => {
      const raw = worker();
      try {
        await raw`insert into market_quotes (ticker, price, quoted_at, source)
                  values ('PETR4', '52.71', now(), 'teste')`;
        await raw`insert into market_dividends ${raw(dividendRow)}`;
        await raw`insert into market_indices (code, date, value) values ('IPCA', '2026-09-01', '-0.32')`;
        await raw`insert into market_tickers (ticker, status) values ('PETR4', 'ok')`;
        await raw`insert into market_usage (day, calls) values ('2026-10-31', 1)`;
        await raw`update market_quotes set price = '53' where ticker = 'PETR4'`;
        await expect(raw`delete from market_quotes`).rejects.toThrow(/permission denied/);
      } finally {
        await raw.end();
      }

      const ctx = await ctxFor(A.owner, A.household);
      const quotes = await db.withHousehold(ctx, (tx) => tx.select().from(marketQuotes));
      expect(quotes.map((row) => row.ticker)).toEqual(["PETR4"]);
      const indices = await db.withHousehold(ctx, (tx) => tx.select().from(marketIndices));
      expect(indices[0]!.value).toBe("-0.32000000");

      for (const write of [
        (tx: Parameters<Parameters<typeof db.withHousehold>[1]>[0]) =>
          tx.update(marketQuotes).set({ price: "1" }),
        (tx: Parameters<Parameters<typeof db.withHousehold>[1]>[0]) =>
          tx.insert(marketUsage).values({ day: "2026-11-01", calls: 1 }),
        (tx: Parameters<Parameters<typeof db.withHousehold>[1]>[0]) => tx.delete(marketDividends),
      ]) {
        await expect(db.withHousehold(ctx, write)).rejects.toThrow();
      }
      await expect(
        db.withAdmin("confere o grant de mercado", (admin) =>
          admin.update(marketQuotes).set({ price: "1" }),
        ),
      ).rejects.toThrow();
    });

    it("a tabela global não guarda vínculo com família", async () => {
      const raw = postgres(urls.owner, { max: 1, onnotice: () => {} });
      try {
        const columns = await raw<{ table_name: string }[]>`
          select table_name from information_schema.columns
          where column_name = 'household_id'
            and table_name in ('market_quotes', 'market_dividends', 'market_indices',
                               'market_tickers', 'market_usage')`;
        expect(columns).toHaveLength(0);
      } finally {
        await raw.end();
      }
    });

    it("o mesmo provento de mercado cabe uma vez por investimento e por família", async () => {
      const ctx = await ctxFor(A.owner, A.household);
      const ctxB = await ctxFor(B.owner, B.household);
      const [market] = await db.withHousehold(ctx, (tx) =>
        tx.select({ id: marketDividends.id }).from(marketDividends).limit(1),
      );
      const create = (householdId: string, role: typeof ctx) =>
        db.withHousehold(role, async (tx) => {
          const [holding] = await tx
            .insert(investments)
            .values({ householdId, name: "Petrobras", ticker: "PETR4", assetClass: "acao" })
            .returning({ id: investments.id });
          return holding!.id;
        });
      const holdingA = await create(A.household, ctx);
      const holdingB = await create(B.household, ctxB);
      const row = (householdId: string, investmentId: string) => ({
        householdId,
        investmentId,
        kind: "jcp" as const,
        paidOn: "2026-09-21",
        gross: "67.41",
        withheld: "11.80",
        source: "agente" as const,
        marketDividendId: market!.id,
      });
      await db.withHousehold(ctx, (tx) => tx.insert(dividends).values(row(A.household, holdingA)));
      await db.withHousehold(ctxB, (tx) => tx.insert(dividends).values(row(B.household, holdingB)));
      await expect(
        db.withHousehold(ctx, (tx) => tx.insert(dividends).values(row(A.household, holdingA))),
      ).rejects.toThrow();
      // Cada família só vê o próprio.
      const seen = await db.withHousehold(ctxB, (tx) => tx.select().from(dividends));
      expect(seen.every((item) => item.householdId === B.household)).toBe(true);
      // Lançamento à mão, sem vínculo, pode repetir.
      const manual = {
        ...row(A.household, holdingA),
        source: "familia" as const,
        marketDividendId: null,
      };
      await db.withHousehold(ctx, async (tx) => {
        await tx.insert(dividends).values(manual);
        await tx.insert(dividends).values(manual);
      });
      await db.withHousehold(ctx, async (tx) => {
        await tx.delete(investments).where(eq(investments.id, holdingA));
      });
      await db.withHousehold(ctxB, async (tx) => {
        await tx.delete(investments).where(eq(investments.id, holdingB));
      });
    });

    it("investimento e provento novos nascem como da família", async () => {
      const ctx = await ctxFor(A.owner, A.household);
      await db.withHousehold(ctx, async (tx) => {
        const [holding] = await tx
          .insert(investments)
          .values({ householdId: A.household, name: "Novo", assetClass: "acao" })
          .returning();
        expect(holding!.priceSource).toBe("familia");
        const [row] = await tx
          .insert(dividends)
          .values({
            householdId: A.household,
            investmentId: holding!.id,
            kind: "dividendo",
            paidOn: "2026-09-21",
            gross: "1.00",
          })
          .returning();
        expect(row).toMatchObject({ source: "familia", marketDividendId: null });
        await tx.delete(investments).where(eq(investments.id, holding!.id));
      });
    });
  });

  it("ensureCategory acha por nome normalizado, desarquiva e só cria quando não existe", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    await db.withHousehold(ctx, async (tx) => {
      const [market] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.kind, "despesa"), eq(categories.name, "Mercado")));
      const found = await db.ensureCategory(tx, A.household, "despesa", "  MÉRCADO ", false);
      expect(found).toEqual({ id: market!.id, created: false });

      await tx.update(categories).set({ archived: true }).where(eq(categories.id, market!.id));
      await db.ensureCategory(tx, A.household, "despesa", "mercado", false);
      const [after] = await tx.select().from(categories).where(eq(categories.id, market!.id));
      expect(after!.archived).toBe(false);

      const first = await db.ensureCategory(tx, A.household, "despesa", "Pet shop", false);
      const again = await db.ensureCategory(tx, A.household, "despesa", "pet-shop", true);
      expect(first.created).toBe(true);
      expect(again).toEqual({ id: first.id, created: false });
      // Receita com o mesmo nome é outra categoria.
      const income = await db.ensureCategory(tx, A.household, "receita", "Pet shop", false);
      expect(income.created).toBe(true);
    });
  });

  it("famílias antigas recebem as categorias de metas e aportes", async () => {
    const ctx = await ctxFor(B.owner, B.household);
    await db.withHousehold(ctx, async (tx) => {
      await db.ensureFinanceDefaults(tx, B.household);
      const rows = await tx
        .select({ name: categories.name, kind: categories.kind })
        .from(categories);
      const goalKinds = rows
        .filter((row) => row.name === "Metas e objetivos")
        .map((row) => row.kind)
        .sort();
      expect(goalKinds).toEqual(["despesa", "receita"]);
      expect(rows.map((row) => row.name)).toContain("Aportes e investimentos");
    });
    expect(db.SYSTEM_TEMPLATES).toEqual(
      expect.arrayContaining(["d-metas", "r-metas", "d-aportes"]),
    );
  });
});

describe("ops dos agentes diários e do painel do serviço", () => {
  const { session } = db;

  /** Helpers de ops usam DATABASE_URL; o worker é quem grava rodadas. */
  async function asWorker<T>(fn: () => Promise<T>): Promise<T> {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = urls.worker;
    try {
      return await fn();
    } finally {
      process.env.DATABASE_URL = previous;
    }
  }

  beforeAll(async () => {
    const day = 24 * 60 * 60 * 1000;
    await db.withAdmin("seed de sessões do teste", async (admin) => {
      await admin.insert(session).values([
        {
          id: "sess-a",
          token: "tok-a",
          userId: A.owner,
          expiresAt: new Date(Date.now() + 7 * day),
          updatedAt: new Date(),
        },
        {
          id: "sess-b",
          token: "tok-b",
          userId: B.owner,
          expiresAt: new Date(Date.now() + 7 * day),
          createdAt: new Date(Date.now() - 100 * day),
          updatedAt: new Date(Date.now() - 100 * day),
        },
      ]);
    });
  });

  it("o worker registra a rodada; repetir no dia substitui as contagens e soma runs", async () => {
    const counts = {
      households: 3,
      ok: 3,
      failed: 0,
      suggestions: 2,
      applied: 1,
      durationMs: 1200,
    };
    await asWorker(() => db.recordAgentRun("2026-10-31", "metas", counts));
    await asWorker(() => db.recordAgentRun("2026-10-31", "metas", { ...counts, ok: 2, failed: 1 }));
    await asWorker(() => db.recordAgentRun("2026-10-30", "viagens", counts));
    const rows = await db.listAgentRuns(7);
    expect(rows.map((row) => `${row.day}:${row.agent}`)).toEqual([
      "2026-10-31:metas",
      "2026-10-30:viagens",
    ]);
    expect(rows[0]).toMatchObject({ runs: 2, households: 3, ok: 2, failed: 1, suggestions: 2 });
    expect(await db.listAgentRuns(1)).toHaveLength(1);
    expect(await db.hasAgentRunToday("2026-10-31", "metas")).toBe(true);
    expect(await db.hasAgentRunToday("2026-10-31", "viagens")).toBe(false);
  });

  it("a web não grava rodadas de agente", async () => {
    await expect(
      db.recordAgentRun("2026-10-29", "metas", {
        households: 0,
        ok: 0,
        failed: 0,
        suggestions: 0,
        applied: 0,
      }),
    ).rejects.toThrow();
  });

  it("famílias ativas são as com sessão recente", async () => {
    const recent = await db.listActiveHouseholdIds(60);
    expect(recent).toContain(A.household);
    expect(recent).not.toContain(B.household);
    expect(await db.listActiveHouseholdIds(365)).toEqual(
      expect.arrayContaining([A.household, B.household]),
    );
  });

  it("o painel lista famílias com contagens, sem nome nem e-mail de pessoas", async () => {
    const rows = await db.adminHouseholdList({ limit: 50 });
    const a = rows.find((row) => row.id === A.household);
    expect(a).toMatchObject({ name: "Família A", members: 3, onboardingVersion: 1 });
    expect(a!.createdAt).toBeInstanceOf(Date);
    expect(a!.lastSessionAt).toBeInstanceOf(Date);
    expect(Object.keys(a!).sort()).toEqual([
      "createdAt",
      "id",
      "lastSessionAt",
      "members",
      "name",
      "onboardingVersion",
      "suspendedAt",
    ]);
    const b = rows.find((row) => row.id === B.household);
    expect(b).toMatchObject({ members: 1, onboardingVersion: 0 });

    expect((await db.adminHouseholdList({ q: "família a" })).map((row) => row.id)).toEqual([
      A.household,
    ]);
    // E-mail exato devolve só as famílias daquele membro (B.owner também entrou em hh-c).
    const byEmail = (await db.adminHouseholdList({ q: "Beto@example.com" })).map((row) => row.id);
    expect(byEmail).toContain(B.household);
    expect(byEmail).not.toContain(A.household);
    expect(await db.adminHouseholdList({ q: "ninguem@example.com" })).toEqual([]);
    expect(await db.adminHouseholdList({ q: "%" })).toEqual([]);
  });

  it("o e-mail do responsável sai só por ação registrada em ops.admin_access", async () => {
    const owner = await db.adminHouseholdOwner(B.household, { adminUserId: A.owner });
    expect(owner).toEqual({ name: "Beto", email: "beto@example.com" });
    expect(await db.adminHouseholdOwner("hh-inexistente", { adminUserId: A.owner })).toBeNull();
    await db.recordAdminAccess({ adminUserId: A.owner, action: "familias:lista" });
    const raw = postgres(urls.admin, { max: 1 });
    try {
      const rows = await raw<{ action: string; target_household_id: string | null }[]>`
        select action, target_household_id from ops.admin_access where admin_user_id = ${A.owner}
        order by id`;
      expect(rows).toEqual(
        expect.arrayContaining([
          { action: "familia:email_responsavel", target_household_id: B.household },
          { action: "familias:lista", target_household_id: null },
        ]),
      );
    } finally {
      await raw.end();
    }
  });

  it("as contagens do painel não identificam família", async () => {
    const counts = await db.adminOverviewCounts({ onboardingVersion: 1 });
    expect(counts.households).toBeGreaterThanOrEqual(2);
    expect(counts.users).toBeGreaterThanOrEqual(4);
    expect(counts.newHouseholds7d).toBeGreaterThanOrEqual(2);
    expect(counts.newHouseholds30d).toBeGreaterThanOrEqual(counts.newHouseholds7d);
    // B não tem household_settings; A já completou a versão 1.
    expect(counts.onboardingPending).toBeGreaterThanOrEqual(1);
    expect(Object.keys(counts).sort()).toEqual([
      "active30d",
      "blocked",
      "households",
      "newHouseholds30d",
      "newHouseholds7d",
      "onboardingPending",
      "suspended",
      "users",
    ]);
  });

  it("o acesso de leitura do admin recusa qualquer escrita", async () => {
    const error: unknown = await db
      .withAdminRead("teste do pool de leitura", (admin) =>
        admin.insert(household).values({ id: "hh-ro", name: "Família RO", slug: "familia-ro" }),
      )
      .catch((err: unknown) => err);
    // 25006 = read_only_sql_transaction: o banco recusou, não a aplicação.
    expect((error as { cause?: { code?: string } }).cause?.code).toBe("25006");
    const all = await db.withAdmin("verificação do teste", (admin) =>
      admin.select().from(household),
    );
    expect(all.map((row) => row.id)).not.toContain("hh-ro");
  });
});

describe("gerência do painel do serviço", () => {
  const { session } = db;
  const admin = { adminUserId: "user-painel" };
  const S = {
    household: "hh-s",
    solo: "hh-solo",
    owner: "user-s-owner",
    member: "user-s-member",
    alone: "user-s-alone",
  };

  async function asWorker<T>(fn: () => Promise<T>): Promise<T> {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = urls.worker;
    try {
      return await fn();
    } finally {
      process.env.DATABASE_URL = previous;
    }
  }

  const sessionsOf = (userId: string) =>
    db.withAdmin("verificação do teste", (conn) =>
      conn.select().from(session).where(eq(session.userId, userId)),
    );

  async function openSession(userId: string) {
    const id = crypto.randomUUID();
    await db.withAdmin("seed de sessão do teste", (conn) =>
      conn.insert(session).values({
        id,
        token: id,
        userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
  }

  async function auditActions(target: string) {
    const rows = await db.adminAccessList({ target, limit: 50 });
    return rows.map((row) => row.action);
  }

  beforeAll(async () => {
    await db.withAdmin("seed do painel", async (conn) => {
      await conn.insert(user).values([
        { id: "user-painel", name: "Painel", email: "painel@example.com" },
        { id: S.owner, name: "Sara", email: "sara@example.com" },
        { id: S.member, name: "Sol", email: "sol@example.com" },
        { id: S.alone, name: "Sami", email: "sami@example.com" },
      ]);
      await conn.insert(household).values([
        { id: S.household, name: "Família S", slug: "familia-s" },
        { id: S.solo, name: "Família Solo", slug: "familia-solo" },
      ]);
      await conn.insert(householdMember).values([
        { id: "m-s1", organizationId: S.household, userId: S.owner, role: "owner" },
        { id: "m-s2", organizationId: S.household, userId: S.member, role: "adult" },
        { id: "m-s3", organizationId: S.solo, userId: S.alone, role: "owner" },
      ]);
    });
    await openSession(S.owner);
    await openSession(S.member);
  });

  it("suspender corta as sessões, tira a família da rodada e reativar devolve", async () => {
    expect(await db.listActiveHouseholdIds(60)).toContain(S.household);

    expect(await db.adminSetHouseholdSuspended(admin, S.household, true)).toBe("ok");
    expect(await db.householdIsSuspended(S.household)).toBe(true);
    expect(await sessionsOf(S.owner)).toEqual([]);
    expect(await sessionsOf(S.member)).toEqual([]);

    await openSession(S.owner);
    expect(await db.listActiveHouseholdIds(60)).not.toContain(S.household);
    const suspended = await db.adminHouseholdList({ status: "suspensas" });
    expect(suspended.map((row) => row.id)).toContain(S.household);
    expect((await db.adminHouseholdList({ status: "ativas" })).map((row) => row.id)).not.toContain(
      S.household,
    );
    expect(await db.suspendedHouseholdIds([S.household, A.household])).toEqual(
      new Set([S.household]),
    );
    expect((await db.adminOverviewCounts({ onboardingVersion: 1 })).suspended).toBe(1);

    expect(await db.adminSetHouseholdSuspended(admin, S.household, false)).toBe("ok");
    expect(await db.householdIsSuspended(S.household)).toBe(false);
    expect(await db.listActiveHouseholdIds(60)).toContain(S.household);
    expect(await auditActions(S.household)).toEqual(["familia:reativar", "familia:suspender"]);
  });

  it("administrador não suspende nem exclui a própria família", async () => {
    const self = { adminUserId: S.owner };
    expect(await db.adminSetHouseholdSuspended(self, S.household, true)).toBe("own_family");
    expect(await db.adminDeleteHousehold(self, S.household, "Família S")).toBe("own_family");
    expect(await db.householdIsSuspended(S.household)).toBe(false);
    expect(await db.adminSetHouseholdSuspended(admin, "hh-inexistente", true)).toBe("not_found");
  });

  it("o detalhe traz papéis e módulos, sem nome nem e-mail de pessoas", async () => {
    const detail = await db.adminHouseholdDetail(S.household);
    expect(detail).toMatchObject({
      name: "Família S",
      pendingInvites: 0,
      modules: {
        entries: false,
        investments: false,
        goals: false,
        trips: false,
        retirement: false,
      },
    });
    expect(detail!.members.map((member) => member.role).sort()).toEqual(["adult", "owner"]);
    expect(Object.keys(detail!.members[0]!).sort()).toEqual([
      "blockedAt",
      "joinedAt",
      "lastAccessAt",
      "role",
      "userId",
    ]);
    expect(JSON.stringify(detail)).not.toContain("example.com");
    expect(await db.adminHouseholdDetail("hh-inexistente")).toBeNull();
  });

  it("bloquear corta as sessões e desbloquear libera; a própria conta não", async () => {
    await openSession(S.member);
    expect(await db.adminSetUserBlocked(admin, S.member, true)).toBe("ok");
    expect(await db.userIsBlocked(S.member)).toBe(true);
    expect(await sessionsOf(S.member)).toEqual([]);
    const blocked = await db.adminUserList({ status: "bloqueados" });
    expect(blocked.map((row) => row.id)).toEqual([S.member]);
    expect(JSON.stringify(blocked)).not.toContain("example.com");

    expect(await db.adminSetUserBlocked(admin, S.member, false)).toBe("ok");
    expect(await db.userIsBlocked(S.member)).toBe(false);
    expect(await db.adminSetUserBlocked(admin, admin.adminUserId, true)).toBe("self");
    expect(await db.adminEndUserSessions(admin, admin.adminUserId)).toBe("self");
    expect(await db.adminDeleteUser(admin, admin.adminUserId)).toBe("self");
    expect(await db.userIsBlocked(admin.adminUserId)).toBe(false);
  });

  it("encerrar sessões e achar por e-mail exato ou id, nunca por parte dele", async () => {
    await openSession(S.alone);
    expect(await db.adminEndUserSessions(admin, S.alone)).toBe("ok");
    expect(await sessionsOf(S.alone)).toEqual([]);
    expect(await auditActions(S.alone)).toContain("usuario:encerrar_sessoes");

    expect((await db.adminUserList({ q: "SAMI@example.com" })).map((row) => row.id)).toEqual([
      S.alone,
    ]);
    expect((await db.adminUserList({ q: S.alone })).map((row) => row.id)).toEqual([S.alone]);
    expect(await db.adminUserList({ q: "sami" })).toEqual([]);
    const [row] = await db.adminUserList({ q: S.owner });
    expect(row).toMatchObject({ households: 1, isOwner: true, emailVerified: false });
  });

  it("nome e e-mail só saem de responsável, com registro", async () => {
    expect(await db.adminRevealUser(admin, S.owner)).toEqual({
      name: "Sara",
      email: "sara@example.com",
    });
    expect(await db.adminRevealUser(admin, S.member)).toBe("not_allowed");
    expect(await db.adminRevealUser(admin, "user-inexistente")).toBe("not_found");
    expect(await auditActions(S.member)).toContain("usuario:revelar");
    expect((await db.adminUserDetail(S.member))?.canReveal).toBe(false);
    expect((await db.adminUserDetail(S.owner))?.canReveal).toBe(true);
    expect(await db.adminPasswordResetTarget(admin, S.owner)).toBe("sara@example.com");
    expect(await auditActions(S.owner)).toContain("usuario:redefinir_senha");
  });

  it("excluir família confere o nome e apaga em cascata", async () => {
    expect(await db.adminDeleteHousehold(admin, S.solo, "família solo")).toBe("name_mismatch");
    expect(await db.adminHouseholdDetail(S.solo)).not.toBeNull();
    const ctx = await ctxFor(S.alone, S.solo);
    await db.withHousehold(ctx, (tx) =>
      tx.insert(people).values({ householdId: S.solo, name: "Sami", relation: "titular" }),
    );
    expect(await db.adminDeleteHousehold(admin, S.solo, " Família Solo ")).toBe("ok");
    expect(await db.adminHouseholdDetail(S.solo)).toBeNull();
    const left = await db.withAdmin("verificação do teste", (conn) =>
      conn.select().from(people).where(eq(people.householdId, S.solo)),
    );
    expect(left).toEqual([]);
    expect(await auditActions(S.solo)).toContain("familia:excluir");
  });

  it("excluir conta segue a regra de apagar a própria conta", async () => {
    expect(await db.adminDeleteUser(admin, S.owner)).toBe("family_has_members");
    expect(await db.adminUserDetail(S.owner)).not.toBeNull();

    await db.withAdmin("seed da exclusão de conta", async (conn) => {
      await conn.insert(household).values({ id: "hh-sami", name: "Sami", slug: "familia-sami" });
      await conn
        .insert(householdMember)
        .values({ id: "m-sami", organizationId: "hh-sami", userId: S.alone, role: "owner" });
    });
    expect(await db.adminDeleteUser(admin, S.alone)).toBe("ok");
    expect(await db.adminUserDetail(S.alone)).toBeNull();
    expect(await db.adminHouseholdDetail("hh-sami")).toBeNull();
    expect(await db.adminDeleteUser(admin, S.alone)).toBe("not_found");
  });

  it("as chaves são lidas por web e worker e só o admin grava", async () => {
    expect(await db.readPlatformFlags()).toEqual(db.NO_FLAGS);

    const raw = postgres(urls.app, { max: 1 });
    try {
      await expect(
        raw`insert into ops.feature_flags (key, enabled) values ('manutencao', true)`,
      ).rejects.toThrow();
    } finally {
      await raw.end();
    }

    await db.adminSetFlag(admin, {
      key: db.FLAG_KEYS.maintenance,
      enabled: true,
      value: { message: "Voltamos logo." },
      action: "controle:manutencao_ligar",
    });
    await db.adminSetFlag(admin, {
      key: db.FLAG_KEYS.signupClosed,
      enabled: true,
      action: "controle:cadastro_fechar",
    });
    await db.adminSetFlag(admin, {
      key: db.FLAG_KEYS.agentOff("metas"),
      enabled: true,
      action: "agente:desligar:metas",
    });
    const flags = await asWorker(() => db.readPlatformFlags());
    expect(flags).toMatchObject({
      maintenance: true,
      maintenanceMessage: "Voltamos logo.",
      signupClosed: true,
      disabledAgents: ["metas"],
    });

    await db.adminSetFlag(admin, {
      key: db.FLAG_KEYS.maintenance,
      enabled: false,
      action: "controle:manutencao_desligar",
    });
    await db.adminSetFlag(admin, {
      key: db.FLAG_KEYS.agentOff("metas"),
      enabled: false,
      action: "agente:ligar:metas",
    });
    await db.adminSetFlag(admin, {
      key: db.FLAG_KEYS.signupClosed,
      enabled: false,
      action: "controle:cadastro_abrir",
    });
    expect(await db.readPlatformFlags()).toEqual(db.NO_FLAGS);
    const actions = await db.adminAccessList({ actions: ["agente:desligar:metas"] });
    expect(actions).toHaveLength(1);
  });

  it("aviso vale só entre o início e o fim", async () => {
    const now = new Date("2026-10-31T12:00:00Z");
    await db.adminSetFlag(admin, {
      key: db.FLAG_KEYS.notice("abc123abc123"),
      enabled: true,
      value: {
        text: "Parada programada",
        startsAt: "2026-10-31T10:00:00.000Z",
        endsAt: "2026-10-31T14:00:00.000Z",
      },
      action: "controle:aviso_criar",
    });
    const flags = await db.readPlatformFlags();
    expect(db.activeNotices(flags, now).map((notice) => notice.text)).toEqual([
      "Parada programada",
    ]);
    expect(db.activeNotices(flags, new Date("2026-10-31T09:59:00Z"))).toEqual([]);
    expect(db.activeNotices(flags, new Date("2026-10-31T14:00:00Z"))).toEqual([]);
    await db.adminRemoveNotice(admin, "abc123abc123");
    expect((await db.readPlatformFlags()).notices).toEqual([]);
  });

  it("modo manutenção: o contexto só leitura é recusado pelo banco", async () => {
    const ctx = db.readOnlyContext(await ctxFor(S.owner, S.household));
    expect(db.canWrite(ctx)).toBe(false);
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.insert(people).values({ householdId: S.household, name: "X", relation: "outro" }),
      ),
    ).rejects.toThrow();
    const rows = await db.withHousehold(ctx, (tx) => tx.select().from(people));
    expect(rows).toEqual([]);
  });

  it("a estatística soma módulos sem dado de família e só o worker grava", async () => {
    const ctx = await ctxFor(S.owner, S.household);
    await db.withHousehold(ctx, async (tx) => {
      await db.ensureFinanceDefaults(tx, S.household);
      const [account] = await tx.select({ id: db.accounts.id }).from(db.accounts).limit(1);
      const [category] = await tx
        .select({ id: db.categories.id })
        .from(db.categories)
        .where(eq(db.categories.kind, "despesa"))
        .limit(1);
      await tx.insert(db.transactions).values({
        householdId: S.household,
        accountId: account!.id,
        categoryId: category!.id,
        kind: "despesa",
        description: "Compra",
        amount: "10.00",
        occurredOn: "2026-10-01",
      });
    });
    expect((await db.adminHouseholdDetail(S.household))?.modules.entries).toBe(true);

    const errors: object[] = [];
    const log = { error: (data: object) => errors.push(data) };
    const day = "2026-10-31";
    const first = await asWorker(() => db.collectPlatformStats(day, log));
    expect(errors).toEqual([]);
    expect(first.useEntries).toBeGreaterThanOrEqual(1);
    expect(first.households).toBeGreaterThanOrEqual(3);
    expect(first.users).toBeGreaterThanOrEqual(5);
    expect(first.active30d).toBeGreaterThanOrEqual(1);

    await asWorker(() => db.collectPlatformStats(day, log));
    const rows = await db.listPlatformStats(10);
    expect(rows.filter((row) => row.day === day)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day, useEntries: first.useEntries });

    await expect(db.recordPlatformStats("2026-10-30", first)).rejects.toThrow();
  });

  it("crescimento, migrações e filas leem só o que é da plataforma", async () => {
    const growth = await db.adminGrowth(12);
    expect(growth).toHaveLength(12);
    expect(growth.at(-1)!.households).toBeGreaterThanOrEqual(3);
    expect(growth.at(-1)!.newUsers).toBeGreaterThanOrEqual(1);
    expect(growth[0]!.week < growth.at(-1)!.week).toBe(true);

    const migrations = await db.adminMigrations();
    expect(migrations.some((migration) => migration.version === "0018_admin")).toBe(true);

    const queues = await db.listQueueCounts();
    expect(queues.map((queue) => queue.name)).toContain(db.JOB_QUEUES.platformStats);
  });

  it("coluna ou tabela nova faltando não derruba o portão", async () => {
    const lag = { cause: { code: "42703" } };
    expect(db.isSchemaLag(lag)).toBe(true);
    expect(db.isSchemaLag({ code: "42P01" })).toBe(true);
    expect(db.isSchemaLag({ code: "23505" })).toBe(false);
    expect(
      await db.tolerateSchemaLag(() => Promise.reject(new Error("x", { cause: lag.cause })), "ok"),
    ).toBe("ok");
    await expect(
      db.tolerateSchemaLag(() => Promise.reject(new Error("outro")), "ok"),
    ).rejects.toThrow("outro");
    // O erro real do banco, do jeito que o Drizzle entrega.
    const missing = (query: ReturnType<typeof sql>) =>
      db.tolerateSchemaLag<unknown>(
        () => db.withAdminRead("teste de atraso do schema", (conn) => conn.execute(query)),
        "tolerado",
      );
    expect(await missing(sql`select coluna_nova from "user"`)).toBe("tolerado");
    expect(await missing(sql`select 1 from ops.tabela_nova`)).toBe("tolerado");
  });
});

describe("assistente com IA (ADR-0018)", () => {
  const { aiStats, aiUsage, assistantMessages, assistantThreads } = db;
  const SPOUSE = "user-a-conjuge-ia";
  let threadId = "";

  const addThread = (ctx: Awaited<ReturnType<typeof ctxFor>>, userId: string, household: string) =>
    db.withHousehold(ctx, async (tx) => {
      const [row] = await tx
        .insert(assistantThreads)
        .values({ householdId: household, userId, title: "Conversa de teste" })
        .returning({ id: assistantThreads.id });
      return row!.id;
    });

  beforeAll(async () => {
    await db.withAdmin("seed do teste do assistente", async (admin) => {
      await admin.insert(user).values({ id: SPOUSE, name: "Cida", email: "cida@example.com" });
      await admin
        .insert(householdMember)
        .values({ id: "m-ia", organizationId: A.household, userId: SPOUSE, role: "adult" });
    });
    threadId = await addThread(await ctxFor(A.owner, A.household), A.owner, A.household);
    await db.withHousehold(await ctxFor(A.owner, A.household), (tx) =>
      tx.insert(assistantMessages).values({
        householdId: A.household,
        userId: A.owner,
        threadId,
        role: "user",
        content: { text: "Quanto gastei?" },
      }),
    );
  });

  it("consentimento e autonomia têm padrão e valores fechados", async () => {
    const ctx = await ctxFor(A.owner, A.household);
    const [row] = await db.withHousehold(ctx, (tx) =>
      tx
        .select({ at: householdSettings.aiConsentAt, autonomy: householdSettings.aiAutonomy })
        .from(householdSettings),
    );
    expect(row).toEqual({ at: null, autonomy: "organizar" });
    await expect(
      db.withHousehold(ctx, (tx) =>
        tx.execute(sql`update household_settings set ai_autonomy = 'total'`),
      ),
    ).rejects.toThrow();
  });

  it("outra família não vê a conversa nem o uso", async () => {
    const ctxB = await ctxFor(B.owner, B.household);
    await db.withHousehold(ctxB, async (tx) => {
      expect(await tx.select().from(assistantThreads)).toHaveLength(0);
      expect(await tx.select().from(assistantMessages)).toHaveLength(0);
      expect(await tx.select().from(aiUsage)).toHaveLength(0);
    });
    await expect(addThread(ctxB, B.owner, A.household)).rejects.toThrow();
  });

  it("na mesma família, cada pessoa só vê as próprias conversas", async () => {
    const owner = await ctxFor(A.owner, A.household);
    const spouse = await ctxFor(SPOUSE, A.household);
    await db.withHousehold(owner, async (tx) => {
      expect(await tx.select().from(assistantThreads)).toHaveLength(1);
      expect(await tx.select().from(assistantMessages)).toHaveLength(1);
    });
    await db.withHousehold(spouse, async (tx) => {
      expect(await tx.select().from(assistantThreads)).toHaveLength(0);
      expect(await tx.select().from(assistantMessages)).toHaveLength(0);
      const updated = await tx
        .update(assistantThreads)
        .set({ title: "Troquei" })
        .where(eq(assistantThreads.id, threadId))
        .returning({ id: assistantThreads.id });
      expect(updated).toHaveLength(0);
      const deleted = await tx
        .delete(assistantThreads)
        .where(eq(assistantThreads.id, threadId))
        .returning({ id: assistantThreads.id });
      expect(deleted).toHaveLength(0);
    });
    await expect(addThread(spouse, A.owner, A.household)).rejects.toThrow();
  });

  it("a FK não deixa pôr mensagem na conversa de outra pessoa", async () => {
    const spouse = await ctxFor(SPOUSE, A.household);
    await expect(
      db.withHousehold(spouse, (tx) =>
        tx.insert(assistantMessages).values({
          householdId: A.household,
          userId: SPOUSE,
          threadId,
          role: "user",
          content: { text: "Entrei na conversa dela" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("mensagem não muda e some com a conversa", async () => {
    const owner = await ctxFor(A.owner, A.household);
    await db.withHousehold(owner, async (tx) => {
      expect(
        await tx
          .update(assistantMessages)
          .set({ content: { text: "reescrita" } })
          .returning({ id: assistantMessages.id }),
      ).toHaveLength(0);
      expect(await tx.delete(assistantMessages).returning({ id: assistantMessages.id })).toEqual(
        [],
      );
    });
    const other = await addThread(owner, A.owner, A.household);
    await db.withHousehold(owner, async (tx) => {
      await tx.insert(assistantMessages).values({
        householdId: A.household,
        userId: A.owner,
        threadId: other,
        role: "assistant",
        content: { text: "Oi" },
      });
      await tx.delete(assistantThreads).where(eq(assistantThreads.id, other));
      expect(
        await tx.select().from(assistantMessages).where(eq(assistantMessages.threadId, other)),
      ).toHaveLength(0);
    });
  });

  it("papel viewer e modo manutenção não conversam; o worker não lê conversa", async () => {
    const viewer = await ctxFor(A.viewer, A.household);
    await expect(addThread(viewer, A.viewer, A.household)).rejects.toThrow();
    const readOnly = db.readOnlyContext(await ctxFor(A.owner, A.household));
    await expect(addThread(readOnly, A.owner, A.household)).rejects.toThrow();
    // A web usa ou_app: o papel 'system' não abre leitura de conversa alheia.
    await db.withHousehold(db.fromJob({ householdId: A.household }), async (tx) => {
      expect(await tx.select().from(assistantThreads)).toHaveLength(0);
    });
  });

  it("ai_usage é por família, não aceita texto em rota ou modelo e soma por dia", async () => {
    const owner = await ctxFor(A.owner, A.household);
    await db.withHousehold(owner, async (tx) => {
      await tx.insert(aiUsage).values({
        householdId: A.household,
        day: "2026-10-31",
        route: "chat",
        model: "claude-opus-5-5",
        calls: 1,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 900,
        cacheWriteTokens: 50,
        costUsd: "0.001234",
      });
      const rows = await tx.select().from(aiUsage);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.costUsd).toBe("0.001234");
    });
    await expect(
      db.withHousehold(owner, (tx) =>
        tx.insert(aiUsage).values({
          householdId: A.household,
          day: "2026-10-31",
          route: "Quanto gastei em outubro?",
          model: "claude-opus-5-5",
        }),
      ),
    ).rejects.toThrow();
    const viewer = await ctxFor(A.viewer, A.household);
    await expect(
      db.withHousehold(viewer, (tx) =>
        tx
          .insert(aiUsage)
          .values({ householdId: A.household, day: "2026-10-30", route: "chat", model: "m" }),
      ),
    ).rejects.toThrow();
  });

  it("ops.ai_stats soma por dia e rota, só a web grava e não há coluna de família", async () => {
    const counts = {
      calls: 2,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 100,
      cacheWriteTokens: 7,
      costUsd: "1.250000",
    };
    await db.recordAiStats("2026-09-02", "chat", counts);
    await db.recordAiStats("2026-09-02", "chat", counts);
    await db.recordAiStats("2026-09-30", "chat", counts);
    await db.recordAiStats("2026-10-01", "chat", counts);
    const month = await db.aiMonthTotals("2026-09");
    expect(month).toMatchObject({ calls: 6, cacheReadTokens: 300 });
    expect(Number(month.costUsd)).toBeCloseTo(3.75);
    expect((await db.aiMonthTotals("2020-01")).calls).toBe(0);

    expect(Object.keys(aiStats)).not.toContain("householdId");
    const raw = postgres(urls.worker, { max: 1 });
    try {
      await expect(
        raw`insert into ops.ai_stats (day, route) values ('2026-09-03', 'chat')`,
      ).rejects.toThrow();
    } finally {
      await raw.end();
    }
  });

  it("apagar a conta leva só as conversas daquela pessoa", async () => {
    const id = "user-a-sai-ia";
    await db.withAdmin("seed do teste do assistente", async (admin) => {
      await admin.insert(user).values({ id, name: "Edu", email: "edu@example.com" });
      await admin
        .insert(householdMember)
        .values({ id: "m-ia-2", organizationId: A.household, userId: id, role: "adult" });
    });
    await addThread(await ctxFor(id, A.household), id, A.household);
    await db.withAdmin("limpeza do teste do assistente", (admin) =>
      admin.delete(user).where(eq(user.id, id)),
    );
    const owner = await ctxFor(A.owner, A.household);
    const rows = await db.withHousehold(owner, (tx) => tx.select().from(assistantThreads));
    expect(rows.map((row) => row.id)).toEqual([threadId]);
  });
});

describe("exportação e exclusão da família", () => {
  it("a exportação cobre toda tabela com household_id", async () => {
    const owner = await ctxFor(A.owner, A.household);
    const exported = await db.withHousehold(owner, (tx) => db.exportHousehold(tx));
    const raw = postgres(urls.admin, { max: 1 });
    try {
      const rows = await raw<{ table_name: string }[]>`
        select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'household_id'
          and table_name not in ('household_member', 'household_invitation')`;
      expect(Object.keys(exported).sort()).toEqual(rows.map((r) => r.table_name).sort());
    } finally {
      await raw.end();
    }
  });

  it("a exportação traz só a própria família", async () => {
    const owner = await ctxFor(A.owner, A.household);
    const exported = await db.withHousehold(owner, (tx) => db.exportHousehold(tx));
    const ids = (exported.people as { householdId: string }[]).map((p) => p.householdId);
    expect(new Set(ids)).toEqual(new Set([A.household]));
  });

  it("apagar a família remove os dados em cascata pela conexão da aplicação", async () => {
    const id = "hh-apagar";
    await db.withAdmin("seed da exclusão", async (admin) => {
      await admin.insert(household).values({ id, name: "Família C", slug: "familia-apagar" });
      await admin
        .insert(householdMember)
        .values({ id: "m-apagar", organizationId: id, userId: B.owner, role: "owner" });
    });
    const ctx = await ctxFor(B.owner, id);
    await db.withHousehold(ctx, async (tx) => {
      await db.ensureFinanceDefaults(tx, id);
      const [account] = await tx.select({ id: db.accounts.id }).from(db.accounts).limit(1);
      const [category] = await tx
        .select({ id: db.categories.id })
        .from(db.categories)
        .where(eq(db.categories.kind, "despesa"))
        .limit(1);
      await tx.insert(db.transactions).values({
        householdId: id,
        accountId: account!.id,
        categoryId: category!.id,
        kind: "despesa",
        description: "Compra",
        amount: "10.00",
        occurredOn: "2026-10-01",
      });
      await tx.insert(people).values({ householdId: id, name: "Cida", relation: "titular" });
    });

    const raw = postgres(urls.app, { max: 1 });
    try {
      await raw`delete from household where id = ${id}`;
    } finally {
      await raw.end();
    }

    const owner = postgres(urls.admin, { max: 1 });
    try {
      const tables = await owner<{ table_name: string }[]>`
        select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'household_id'`;
      for (const { table_name } of tables) {
        const [row] = await owner<{ n: number }[]>`
          select count(*)::int as n from ${owner(table_name)} where household_id = ${id}`;
        expect(row!.n).toBe(0);
      }
    } finally {
      await owner.end();
    }
  });
});

describe("diagnósticos", () => {
  const raw = postgres(urls.owner, { max: 1, onnotice: () => {} });
  const app = postgres(urls.app, { max: 1, onnotice: () => {} });
  afterAll(async () => {
    await raw.end();
    await app.end();
  });

  let serial = 0;
  /** Cada teste usa impressão digital e origem próprias. */
  function event(over: Partial<import("../src/index").DiagnosticEvent> = {}) {
    serial += 1;
    return {
      fingerprint: serial.toString(16).padStart(32, "a"),
      service: "web" as const,
      source: "route" as const,
      errorType: "TypeError",
      route: "/api/teste",
      commit: "commit-a",
      code: null,
      stack: ["apps/web/src/lib/goals.ts:42"],
      ...over,
    };
  }
  const rowOf = async (fingerprint: string) => {
    const rows = await raw<
      { count: number; day_count: number; status: string; commit: string }[]
    >`select count, day_count, status, commit from ops.diagnostics
      where fingerprint = ${fingerprint} order by id`;
    return rows;
  };

  it("um erro com e-mail e valor na mensagem grava só o que é permitido", async () => {
    const message = "Falha na meta de ana@example.com: R$ 1.234,56 família hh-a";
    await db.captureError(Object.assign(new TypeError(message), { code: "23505" }), {
      service: "web",
      source: "action",
      route: "/app/(painel)/metas/[id]/page?email=ana@example.com",
      commit: "commit-pii",
    });
    const rows = await raw`select * from ops.diagnostics where commit = 'commit-pii'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      service: "web",
      source: "action",
      error_type: "TypeError",
      route: "/app/metas/[id]",
      code: "23505",
      status: "aberto",
    });
    expect(JSON.stringify(rows)).not.toMatch(/ana@example|1\.234,56|hh-a|Falha/);
  });

  it("repetir soma na mesma linha; outra versão abre outra linha", async () => {
    const first = event();
    expect(await db.recordDiagnostic(first)).toBe(true);
    expect(await db.recordDiagnostic(first)).toBe(true);
    await db.recordDiagnostic({ ...first, commit: "commit-b" });
    const rows = await rowOf(first.fingerprint);
    expect(rows.map((row) => [row.commit, row.count])).toEqual([
      ["commit-a", 2],
      ["commit-b", 1],
    ]);
    const [item] = await db.listDiagnostics({ fingerprint: first.fingerprint });
    expect(item).toMatchObject({ count: 3, status: "aberto", errorType: "TypeError" });
    expect([...item!.commits].sort()).toEqual(["commit-a", "commit-b"]);
    expect(item!.stack).toEqual(["apps/web/src/lib/goals.ts:42"]);
    expect(item!.firstSeenAt).toBeInstanceOf(Date);
    const onlyB = await db.listDiagnostics({ fingerprint: first.fingerprint, commit: "commit-b" });
    expect(onlyB[0]!.count).toBe(1);
  });

  it("a mesma impressão digital para de somar no teto do dia e volta no dia seguinte", async () => {
    const limits = { perFingerprintDay: 3, newPerSourceDay: 1000 };
    const noisy = event({ commit: "commit-teto" });
    for (let time = 0; time < 3; time += 1) {
      expect(await db.recordDiagnostic(noisy, limits)).toBe(true);
    }
    expect(await db.recordDiagnostic(noisy, limits)).toBe(false);
    expect((await rowOf(noisy.fingerprint))[0]).toMatchObject({ count: 3, day_count: 3 });

    await raw`update ops.diagnostics set day = day - 1 where fingerprint = ${noisy.fingerprint}`;
    expect(await db.recordDiagnostic(noisy, limits)).toBe(true);
    expect((await rowOf(noisy.fingerprint))[0]).toMatchObject({ count: 4, day_count: 1 });
  });

  it("cada origem tem o próprio teto de linhas novas por dia", async () => {
    await raw`delete from ops.diagnostics where source = 'proxy'`;
    const limits = { perFingerprintDay: 1000, newPerSourceDay: 2 };
    const first = event({ source: "proxy" });
    expect(await db.recordDiagnostic(first, limits)).toBe(true);
    expect(await db.recordDiagnostic(event({ source: "proxy" }), limits)).toBe(true);
    const third = event({ source: "proxy" });
    expect(await db.recordDiagnostic(third, limits)).toBe(false);
    expect(await rowOf(third.fingerprint)).toEqual([]);
    // O teto só barra erro novo: quem já tem linha continua somando, e as outras origens seguem.
    expect(await db.recordDiagnostic(first, limits)).toBe(true);
    expect(await db.recordDiagnostic(event({ source: "job" }), limits)).toBe(true);

    await raw`update ops.diagnostics set first_seen_at = now() - interval '2 days'
      where source = 'proxy'`;
    expect(await db.recordDiagnostic(third, limits)).toBe(true);
  });

  it("marcar resolvido vale para todas as versões, e o erro que volta reabre", async () => {
    const error = event();
    await db.recordDiagnostic(error);
    await db.recordDiagnostic({ ...error, commit: "commit-b" });
    expect(await db.resolveDiagnostic(error.fingerprint)).toBe(2);
    expect(await db.resolveDiagnostic(error.fingerprint)).toBe(0);
    expect(await db.listDiagnostics({ fingerprint: error.fingerprint })).toEqual([]);
    const [done] = await db.listDiagnostics({
      fingerprint: error.fingerprint,
      status: "resolvido",
    });
    expect(done!.status).toBe("resolvido");

    // Mesmo no teto do dia: resolvido que continua acontecendo precisa aparecer.
    await db.recordDiagnostic(
      { ...error, commit: "commit-b" },
      { perFingerprintDay: 1, newPerSourceDay: 1000 },
    );
    const [open] = await db.listDiagnostics({ fingerprint: error.fingerprint });
    expect(open).toMatchObject({ status: "aberto", commits: ["commit-b"] });
    const [all] = await db.listDiagnostics({ fingerprint: error.fingerprint, status: "todos" });
    expect(all!.status).toBe("aberto");
    expect(all!.commits).toHaveLength(2);
  });

  it("filtra por serviço, origem, rota e data", async () => {
    const worker = event({ service: "worker", source: "agent", route: "agente:metas" });
    await db.recordDiagnostic(worker);
    const found = (filters: Parameters<typeof db.listDiagnostics>[0]) =>
      db
        .listDiagnostics({ limit: 100, ...filters })
        .then((rows) => rows.some((row) => row.fingerprint === worker.fingerprint));
    expect(await found({ service: "worker", source: "agent" })).toBe(true);
    expect(await found({ route: "agente:metas" })).toBe(true);
    expect(await found({ service: "web" })).toBe(false);
    expect(await found({ source: "job" })).toBe(false);
    expect(await found({ route: "agente:viagens" })).toBe(false);
    expect(await found({ since: new Date(Date.now() + 60_000) })).toBe(false);
  });

  it("a taxa por versão usa o tempo que cada uma ficou no ar", async () => {
    await raw`delete from ops.deployments`;
    await raw`insert into ops.deployments (service, commit, started_at) values
      ('web', 'taxa-antiga', now() - interval '12 hours'),
      ('worker', 'taxa-antiga', now() - interval '11 hours'),
      ('web', 'taxa-nova', now() - interval '2 hours')`;
    const old = event({ commit: "taxa-antiga" });
    const fresh = event({ commit: "taxa-nova" });
    for (const item of [old, old, old, old, old, fresh, fresh, fresh, fresh]) {
      await db.recordDiagnostic(item);
    }
    await db.recordDiagnostic(event({ commit: "taxa-nova" }));

    const rates = await db.listDiagnosticRates(5);
    expect(rates.map((rate) => rate.commit)).toEqual(["taxa-nova", "taxa-antiga"]);
    expect(rates[0]).toMatchObject({ occurrences: 5, fingerprints: 2 });
    expect(rates[0]!.perHour).toBeCloseTo(2.5, 1);
    expect(rates[1]).toMatchObject({ occurrences: 5, fingerprints: 1 });
    expect(rates[1]!.perHour).toBeCloseTo(0.5, 1);
    expect(rates[0]!.startedAt).toBeInstanceOf(Date);
  });

  it("web e worker gravam; ninguém da aplicação apaga", async () => {
    const worker = postgres(urls.worker, { max: 1, onnotice: () => {} });
    try {
      for (const role of [app, worker]) {
        await expect(role`select count(*) from ops.diagnostics`).resolves.toBeDefined();
        await expect(
          role`update ops.diagnostics set status = 'aberto' where false`,
        ).resolves.toBeDefined();
        await expect(role`delete from ops.diagnostics`).rejects.toThrow();
      }
    } finally {
      await worker.end();
    }
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = urls.worker;
    try {
      const failure = event({ service: "worker", source: "job", route: "job:market-data" });
      expect(await db.recordDiagnostic(failure)).toBe(true);
      expect(await db.resolveDiagnostic(failure.fingerprint)).toBe(1);
    } finally {
      process.env.DATABASE_URL = previous;
    }
  });

  it("o banco recusa texto livre em qualquer coluna", async () => {
    const insert = (over: Record<string, unknown>) => {
      const row = {
        fingerprint: "b".repeat(32),
        service: "web",
        source: "route",
        error_type: "TypeError",
        route: "/api/teste",
        commit: "commit-a",
        code: null,
        stack: "{}",
        day: "2026-10-31",
        ...over,
      };
      return app`insert into ops.diagnostics ${app(row as never)}`;
    };
    await expect(insert({ error_type: "Falha de ana@example.com" })).rejects.toThrow();
    await expect(insert({ route: "/app/metas?email=ana@example.com" })).rejects.toThrow();
    await expect(insert({ code: "R$ 1.234,56" })).rejects.toThrow();
    await expect(insert({ commit: "ana silva" })).rejects.toThrow();
    await expect(insert({ fingerprint: "nao-e-hash" })).rejects.toThrow();
    await expect(insert({ stack: '{"a.ts:1 ana@example.com"}' })).rejects.toThrow();
    await expect(insert({ service: "outro" })).rejects.toThrow();
  });

  it("antes da migração chegar, a leitura devolve vazio e o registro não estoura", async () => {
    await raw`alter table ops.diagnostics rename to diagnostics_escondida`;
    try {
      expect(await db.listDiagnostics()).toEqual([]);
      expect(await db.listDiagnosticRates()).toEqual([]);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        db.captureError(new Error("x"), { service: "web", source: "route", route: "/api/x" }),
      ).resolves.toBeUndefined();
      expect(log.mock.calls.join()).toContain("42P01");
      log.mockRestore();
    } finally {
      await raw`alter table ops.diagnostics_escondida rename to diagnostics`;
    }
  });
});

describe("ops", () => {
  it("registra e lista deploys sem tenant", async () => {
    await db.recordDeployment({ service: "web", commit: "abc1234", hostname: "test" });
    const rows = await db.listDeployments(5);
    expect(rows[0]?.commit).toBe("abc1234");
    const status = await db.databaseStatus();
    expect(status.schemaVersion).toMatch(/^\d{4}_/);
  });
});
