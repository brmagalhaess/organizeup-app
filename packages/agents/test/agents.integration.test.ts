// Agentes diários contra um Postgres real com RLS (ADR-0015/0016). Dados fictícios.
// Roda com a conexão do worker (ou_worker), como em produção; a família é seedada via withAdmin.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TenantTx } from "@organizeup/db";
import type { Allocation } from "@organizeup/domain";

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
  accounts,
  calendarEvents,
  categories,
  eq,
  and,
  goalContributions,
  goals,
  household,
  householdMember,
  householdReports,
  householdSettings,
  householdSuggestions,
  investments,
  investmentTrades,
  people,
  transactions,
  trips,
  user,
} = db;

const A = { household: "hh-agents-a", owner: "user-agents-a" };
const B = { household: "hh-agents-b", owner: "user-agents-b" };
const today = domain.todayIn();
const month = domain.yearMonthOf(today);

type Tx = TenantTx;
const inA = <T>(fn: (tx: Tx) => Promise<T>) => db.withWorkerHousehold(A.household, fn);
const inB = <T>(fn: (tx: Tx) => Promise<T>) => db.withWorkerHousehold(B.household, fn);

const allocation = (over: Partial<Allocation> = {}): Allocation => ({
  reserve: "0.00",
  debt: "0.00",
  retirement: "0.00",
  alreadyInvesting: "0.00",
  goalsBudget: "500.00",
  tripsBudget: "800.00",
  tripsCommitted: "0.00",
  shortfall: "0.00",
  notes: [],
  ...over,
});

async function ownerCtx() {
  const ctx = await db.fromSession({
    user: { id: A.owner },
    session: { activeOrganizationId: A.household },
  });
  if (!ctx) throw new Error("sem contexto do responsável");
  return ctx;
}

async function categoryId(tx: Tx, name: string, kind: "receita" | "despesa" = "despesa") {
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, name), eq(categories.kind, kind)));
  if (!row) throw new Error(`categoria ${name} não existe`);
  return row.id;
}

async function firstAccount(tx: Tx) {
  const [row] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
  return row!.id;
}

beforeAll(async () => {
  await db.withAdmin("seed do teste dos agentes diários", async (admin) => {
    await admin.insert(user).values([
      { id: A.owner, name: "Ana", email: "ana.agentes@example.com" },
      { id: B.owner, name: "Beto", email: "beto.agentes@example.com" },
    ]);
    await admin.insert(household).values([
      { id: A.household, name: "Família Agentes A", slug: "familia-agentes-a" },
      { id: B.household, name: "Família Agentes B", slug: "familia-agentes-b" },
    ]);
    await admin.insert(householdMember).values([
      { id: "ma-1", organizationId: A.household, userId: A.owner, role: "owner" },
      { id: "mb-1", organizationId: B.household, userId: B.owner, role: "owner" },
    ]);
  });
  for (const [run, hh, owner] of [
    [inA, A.household, A.owner],
    [inB, B.household, B.owner],
  ] as const) {
    await run(async (tx) => {
      await tx.insert(householdSettings).values({ householdId: hh });
      await tx
        .insert(people)
        .values({ householdId: hh, name: "Titular", relation: "titular", userId: owner });
      await db.ensureFinanceDefaults(tx, hh);
    });
  }
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("agente de categorias", () => {
  let reviewId = "";
  let familyId = "";
  let otherB = "";

  beforeAll(async () => {
    [reviewId, familyId] = await inA(async (tx) => {
      const account = await firstAccount(tx);
      const fallback = await categoryId(tx, "Outras despesas");
      const rows = await tx
        .insert(transactions)
        .values([
          {
            householdId: A.household,
            accountId: account,
            categoryId: fallback,
            kind: "despesa",
            description: "SUPERMERCADO BOM PRECO 12/10",
            amount: "230.00",
            occurredOn: today,
            categorySource: "revisar",
          },
          {
            householdId: A.household,
            accountId: account,
            categoryId: fallback,
            kind: "despesa",
            description: "FARMACIA SAO JOAO",
            amount: "80.00",
            occurredOn: today,
            categorySource: "familia",
          },
        ])
        .returning({ id: transactions.id });
      return [rows[0]!.id, rows[1]!.id];
    });
    otherB = await inB(async (tx) => {
      const [row] = await tx
        .insert(transactions)
        .values({
          householdId: B.household,
          accountId: await firstAccount(tx),
          categoryId: await categoryId(tx, "Outras despesas"),
          kind: "despesa",
          description: "SUPERMERCADO BOM PRECO",
          amount: "99.00",
          occurredOn: today,
          categorySource: "revisar",
        })
        .returning({ id: transactions.id });
      return row!.id;
    });
  });

  it("move sozinho o que está em Outras, inclusive o que a família deixou lá", async () => {
    const result = await inA((tx) =>
      agents.runCategoriasAgent(tx, { today, householdId: A.household }),
    );
    expect(result.applied).toBe(2);
    expect(result.suggestions).toBe(0);
    await inA(async (tx) => {
      const mercado = await categoryId(tx, "Mercado");
      const fallback = await categoryId(tx, "Outras despesas");
      const [moved] = await tx.select().from(transactions).where(eq(transactions.id, reviewId));
      expect(moved!.categoryId).toBe(mercado);
      expect(moved!.categorySource).toBe("agente");
      const [chosen] = await tx.select().from(transactions).where(eq(transactions.id, familyId));
      expect(chosen!.categoryId).not.toBe(fallback);
      expect(chosen!.categorySource).toBe("agente");

      const rows = await tx.select().from(householdSuggestions);
      const applied = rows.filter((row) => row.status === "aplicada");
      expect(applied).toHaveLength(2);
      expect(applied.every((row) => row.appliedBy === "agente")).toBe(true);
      expect(applied.flatMap((row) => row.payload.previous)).toEqual(
        expect.arrayContaining([
          { transactionId: reviewId, categoryId: fallback, categorySource: "revisar" },
          { transactionId: familyId, categoryId: fallback, categorySource: "familia" },
        ]),
      );
      expect(rows.filter((row) => row.status === "pendente")).toEqual([]);
      const [report] = await tx
        .select()
        .from(householdReports)
        .where(and(eq(householdReports.kind, "categorias"), eq(householdReports.period, today)));
      expect(report).toBeDefined();
    });
  });

  it("duas rodadas dão as mesmas linhas", async () => {
    const before = await inA((tx) => tx.select().from(householdSuggestions));
    const result = await inA((tx) =>
      agents.runCategoriasAgent(tx, { today, householdId: A.household }),
    );
    expect(result.applied).toBe(0);
    const after = await inA((tx) => tx.select().from(householdSuggestions));
    expect(after.map((r) => [r.id, r.status, r.dedupeKey]).sort()).toEqual(
      before.map((r) => [r.id, r.status, r.dedupeKey]).sort(),
    );
    const reports = await inA((tx) => tx.select().from(householdReports));
    expect(reports.filter((r) => r.kind === "categorias")).toHaveLength(1);
  });

  it("nada vaza para a família B", async () => {
    await inB(async (tx) => {
      expect(await tx.select().from(householdSuggestions)).toHaveLength(0);
      expect(await tx.select().from(householdReports)).toHaveLength(0);
      const [row] = await tx.select().from(transactions).where(eq(transactions.id, otherB));
      expect(row!.categorySource).toBe("revisar");
      expect(row!.categoryId).toBe(await categoryId(tx, "Outras despesas"));
    });
  });

  it("desfazer devolve os lançamentos e a mudança não volta sozinha", async () => {
    const ctx = await ownerCtx();
    const rows = await inA((tx) =>
      tx.select().from(householdSuggestions).where(eq(householdSuggestions.status, "aplicada")),
    );
    const applied = rows.find((row) => row.dedupeKey.includes("supermercado bom"));
    const undo = await db.withHousehold(ctx, (tx) => agents.undoSuggestion(tx, ctx, applied!.id));
    expect(undo.ok).toBe(true);
    await inA(async (tx) => {
      const [row] = await tx.select().from(transactions).where(eq(transactions.id, reviewId));
      expect(row!.categoryId).toBe(await categoryId(tx, "Outras despesas"));
      expect(row!.categorySource).toBe("familia");
      const [undone] = await tx
        .select()
        .from(householdSuggestions)
        .where(eq(householdSuggestions.id, applied!.id));
      expect(undone!.status).toBe("desfeita");
    });

    const result = await inA((tx) =>
      agents.runCategoriasAgent(tx, { today, householdId: A.household }),
    );
    expect(result.applied).toBe(0);
    await inA(async (tx) => {
      const [row] = await tx.select().from(transactions).where(eq(transactions.id, reviewId));
      expect(row!.categoryId).toBe(await categoryId(tx, "Outras despesas"));
      const sameKey = await tx
        .select()
        .from(householdSuggestions)
        .where(eq(householdSuggestions.dedupeKey, applied!.dedupeKey));
      expect(sameKey.map((r) => r.status)).toEqual(["desfeita"]);
    });
  });
});

describe("agente de metas", () => {
  let goalId = "";
  let firstMonth = month;

  beforeAll(async () => {
    goalId = await inA(async (tx) => {
      const [row] = await tx
        .insert(goals)
        .values({
          householdId: A.household,
          name: "Carro",
          kind: "veiculo",
          targetAmount: "6000.00",
          priority: 1,
          planDay: 28,
          accountId: await firstAccount(tx),
        })
        .returning({ id: goals.id });
      return row!.id;
    });
  });

  it("cria as parcelas do plano e repete sem duplicar", async () => {
    const input = { today, householdId: A.household, allocation: allocation() };
    await inA((tx) => agents.runMetasAgent(tx, input));
    const first = await inA((tx) =>
      tx.select().from(goalContributions).where(eq(goalContributions.goalId, goalId)),
    );
    expect(first).toHaveLength(12);
    expect(first.every((row) => row.amount === "500.00" && row.transactionId === null)).toBe(true);
    const [goal] = await inA((tx) => tx.select().from(goals).where(eq(goals.id, goalId)));
    expect(goal!.status).toBe("juntando");
    expect(goal!.planMonthly).toBe("500.00");
    // Dia de guardar (28) já passou? Então a primeira parcela é do mês seguinte.
    const expectedStart = Number(today.slice(8, 10)) > 28 ? domain.addMonths(month, 1) : month;
    expect(goal!.planStart).toBe(expectedStart);
    firstMonth = expectedStart;

    await inA((tx) => agents.runMetasAgent(tx, input));
    const second = await inA((tx) =>
      tx.select().from(goalContributions).where(eq(goalContributions.goalId, goalId)),
    );
    expect(second).toHaveLength(12);
    expect(second.map((row) => `${row.month}:${row.amount}`).sort()).toEqual(
      first.map((row) => `${row.month}:${row.amount}`).sort(),
    );
  });

  it("parcela confirmada na primeira parcela fica intocada e não duplica", async () => {
    const confirmedId = await inA(async (tx) => {
      const [txRow] = await tx
        .insert(transactions)
        .values({
          householdId: A.household,
          accountId: await firstAccount(tx),
          categoryId: await categoryId(tx, "Metas e objetivos"),
          kind: "despesa",
          description: "Meta: Carro (1/12)",
          amount: "500.00",
          occurredOn: today,
          categorySource: "familia",
        })
        .returning({ id: transactions.id });
      const [row] = await tx
        .update(goalContributions)
        .set({ transactionId: txRow!.id })
        .where(and(eq(goalContributions.goalId, goalId), eq(goalContributions.month, firstMonth)))
        .returning({ id: goalContributions.id });
      await tx.update(goals).set({ saved: "500.00" }).where(eq(goals.id, goalId));
      return row!.id;
    });

    await inA((tx) =>
      agents.runMetasAgent(tx, { today, householdId: A.household, allocation: allocation() }),
    );
    const rows = await inA((tx) =>
      tx.select().from(goalContributions).where(eq(goalContributions.goalId, goalId)),
    );
    const current = rows.filter((row) => row.month === firstMonth);
    expect(current).toHaveLength(1);
    expect(current[0]!.id).toBe(confirmedId);
    expect(current[0]!.transactionId).not.toBeNull();
    expect(rows.filter((row) => row.transactionId === null)).toHaveLength(11);
    expect(rows.every((row) => row.month >= firstMonth)).toBe(true);
  });

  it("parcela deste mês já vencida fica aberta e sai do que falta planejar", async () => {
    // Dia 15 com a parcela do dia 5: a família ainda pode dizer que guardou.
    const dayAfter = `${domain.addMonths(month, 6)}-15`;
    const held = domain.addMonths(month, 6);
    const goalHeld = await inA(async (tx) => {
      const [row] = await tx
        .insert(goals)
        .values({
          householdId: A.household,
          name: "Reforma",
          kind: "reforma",
          targetAmount: "1200.00",
          priority: 5,
          planDay: 5,
          accountId: await firstAccount(tx),
          status: "juntando",
        })
        .returning({ id: goals.id });
      await tx
        .insert(goalContributions)
        .values({ householdId: A.household, goalId: row!.id, month: held, amount: "300.00" });
      return row!.id;
    });
    const run = () =>
      inA((tx) =>
        agents.runMetasAgent(tx, {
          today: dayAfter,
          householdId: A.household,
          allocation: allocation(),
        }),
      );
    await run();
    await run();
    const rows = await inA((tx) =>
      tx.select().from(goalContributions).where(eq(goalContributions.goalId, goalHeld)),
    );
    expect(rows.filter((row) => row.month === held)).toHaveLength(1);
    const open = rows.filter((row) => row.transactionId === null);
    expect(open.reduce((sum, row) => sum.plus(row.amount), domain.money(0)).toFixed(2)).toBe(
      "1200.00",
    );
    await inA((tx) => tx.delete(goals).where(eq(goals.id, goalHeld)));
  });

  it("sugere ajustar a data quando o prazo não cabe", async () => {
    await inA((tx) =>
      tx
        .update(goals)
        .set({ desiredMonth: domain.addMonths(month, 2) })
        .where(eq(goals.id, goalId)),
    );
    const result = await inA((tx) =>
      agents.runMetasAgent(tx, { today, householdId: A.household, allocation: allocation() }),
    );
    expect(result.suggestions).toBeGreaterThanOrEqual(1);
    const [row] = await inA((tx) =>
      tx
        .select()
        .from(householdSuggestions)
        .where(eq(householdSuggestions.dedupeKey, agents.DEDUPE.meta(goalId, month))),
    );
    expect(row!.status).toBe("pendente");
    const payload = agents.parsePayload("meta", row!.payload);
    expect(payload.goalId).toBe(goalId);
    expect(payload.extraMonthly).not.toBeNull();
    // Chave e valores crus ao lado do texto em português, que fica como reserva.
    expect(row!.messageKey).toMatch(/^meta/);
    expect(row!.messageParams).toHaveProperty("parts");
    expect(JSON.stringify(row!.messageParams)).not.toContain("R$");
    expect(row!.body).toContain("R$");
    const [goal] = await inA((tx) => tx.select().from(goals).where(eq(goals.id, goalId)));
    expect(goal!.planNoteKey).toBe("frases.notaMeta");
    expect(JSON.stringify(goal!.planNoteParams)).not.toContain("R$");
  });
});

describe("aposentadoria, viagens e investimentos", () => {
  it("aposentadoria devolve a divisão e lembra de completar o plano", async () => {
    const result = await inA((tx) =>
      agents.runAposentadoriaAgent(tx, { today, householdId: A.household }),
    );
    expect(result.allocation.goalsBudget).toMatch(/^\d+\.\d{2}$/);
    expect(result.plan.status).not.toBe("ok");
    const [reminder] = await inA((tx) =>
      tx
        .select()
        .from(householdSuggestions)
        .where(eq(householdSuggestions.dedupeKey, agents.DEDUPE.lembreteAposentadoria())),
    );
    expect(reminder?.status).toBe("pendente");
    expect(reminder?.messageKey).toMatch(/^lembrete/);
    const [report] = await inA((tx) =>
      tx
        .select()
        .from(householdReports)
        .where(and(eq(householdReports.kind, "aposentadoria"), eq(householdReports.period, today))),
    );
    expect((report!.data as { allocation: Allocation }).allocation).toEqual(result.allocation);
    expect(report!.messageKey).toBe("relatorioAposentadoria");
    expect(JSON.stringify(report!.messageParams)).not.toContain("R$");
  });

  it("viagens sugere no máximo o pedido e a família pode aceitar e desfazer", async () => {
    await inA((tx) =>
      tx
        .update(householdSettings)
        .set({ tripsPerYear: 1, tripDays: 5 })
        .where(eq(householdSettings.householdId, A.household)),
    );
    const input = { today, householdId: A.household, allocation: allocation() };
    await inA((tx) => agents.runViagensAgent(tx, input));
    await inA((tx) => agents.runViagensAgent(tx, input));
    const pending = await inA((tx) =>
      tx
        .select()
        .from(householdSuggestions)
        .where(
          and(eq(householdSuggestions.kind, "viagem"), eq(householdSuggestions.status, "pendente")),
        ),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]!.messageKey).toBe("viagem");

    const ctx = await ownerCtx();
    const apply = await db.withHousehold(ctx, (tx) =>
      agents.applySuggestion(tx, ctx, pending[0]!.id),
    );
    expect(apply).toMatchObject({ ok: true, code: "tripCreated" });
    expect(apply.values?.name).toBeTruthy();
    const created = await inA((tx) => tx.select().from(trips));
    expect(created).toHaveLength(1);
    expect(await inA((tx) => tx.select().from(calendarEvents))).toHaveLength(1);

    const undo = await db.withHousehold(ctx, (tx) =>
      agents.undoSuggestion(tx, ctx, pending[0]!.id),
    );
    expect(undo.ok).toBe(true);
    expect(await inA((tx) => tx.select().from(trips))).toHaveLength(0);
    expect(await inA((tx) => tx.select().from(calendarEvents))).toHaveLength(0);
  });

  it("investimentos avisa de valor velho", async () => {
    await inA(async (tx) => {
      const [holding] = await tx
        .insert(investments)
        .values({
          householdId: A.household,
          name: "Fundo imobiliário X",
          ticker: "XXXX11",
          assetClass: "fii",
          currentPrice: "100.00000000",
          valuedOn: domain.addMonths(month, -3) + "-01",
        })
        .returning({ id: investments.id });
      await tx.insert(investmentTrades).values({
        householdId: A.household,
        investmentId: holding!.id,
        side: "compra",
        occurredOn: domain.addMonths(month, -6) + "-10",
        quantity: "10.00000000",
        unitPrice: "95.00000000",
      });
    });
    const result = await inA((tx) =>
      agents.runInvestimentosAgent(tx, { today, householdId: A.household }),
    );
    expect(result.suggestions).toBeGreaterThanOrEqual(1);
    expect((result.report.data as { stale: string[] }).stale).toHaveLength(1);
    const rows = await inA((tx) =>
      tx.select().from(householdSuggestions).where(eq(householdSuggestions.kind, "investimento")),
    );
    expect(rows.some((row) => row.dedupeKey.startsWith("investimento:preco:"))).toBe(true);
    expect(rows.every((row) => row.messageKey !== null)).toBe(true);
  });

  it("a família B continua sem nada dos agentes", async () => {
    await inB(async (tx) => {
      expect(await tx.select().from(householdSuggestions)).toHaveLength(0);
      expect(await tx.select().from(householdReports)).toHaveLength(0);
      expect(await tx.select().from(goalContributions)).toHaveLength(0);
    });
  });
});
