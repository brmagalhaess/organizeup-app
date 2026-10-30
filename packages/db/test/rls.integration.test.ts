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

describe("ops", () => {
  it("registra e lista deploys sem tenant", async () => {
    await db.recordDeployment({ service: "web", commit: "abc1234", hostname: "test" });
    const rows = await db.listDeployments(5);
    expect(rows[0]?.commit).toBe("abc1234");
    const status = await db.databaseStatus();
    expect(status.schemaVersion).toMatch(/^\d{4}_/);
  });
});
