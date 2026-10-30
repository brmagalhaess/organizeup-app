// Teste de isolamento entre households (obrigatório no CI — ver ADR-0002).
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import postgres from "postgres";
import { eq } from "drizzle-orm";

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
    expect(created.categories).toHaveLength(17);
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

describe("ops", () => {
  it("registra e lista deploys sem tenant", async () => {
    await db.recordDeployment({ service: "web", commit: "abc1234", hostname: "test" });
    const rows = await db.listDeployments(5);
    expect(rows[0]?.commit).toBe("abc1234");
    const status = await db.databaseStatus();
    expect(status.schemaVersion).toMatch(/^\d{4}_/);
  });
});
