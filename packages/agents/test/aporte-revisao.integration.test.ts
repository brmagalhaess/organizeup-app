// O que a revisão independente do ADR-0027 achou, contra um Postgres real com os agentes de verdade.
// Cada caso falhava antes da correção. Dados fictícios.
import { afterAll, describe, expect, inject, it } from "vitest";
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

const { accounts, and, categories, emergencyFund, eq, goalContributions, goals } = db;
const { importBatches } = db;
const { household, householdMember, householdNotifications, householdSettings } = db;
const { householdStatements, householdSuggestions, investments, investmentTrades } = db;
const { isNull, people, retirementPlan, transactions, user } = db;

const TODAY = "2026-11-02";
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

interface Family {
  id: string;
  owner: string;
  main: string;
  in: <T>(fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
}

let count = 0;
async function newFamily(): Promise<Family> {
  count += 1;
  const id = `hh-rev-${count}`;
  const owner = `user-rev-${count}`;
  await db.withAdmin("seed da revisão", async (admin) => {
    await admin.insert(user).values({ id: owner, name: "Pessoa", email: `${owner}@example.com` });
    await admin.insert(household).values({ id, name: "Revisão", slug: id });
    await admin
      .insert(householdMember)
      .values({ id: `m-${id}`, organizationId: id, userId: owner, role: "owner" });
  });
  const inFamily = <T>(fn: (tx: TenantTx) => Promise<T>) => db.withWorkerHousehold(id, fn);
  const main = await inFamily(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: id });
    await tx.insert(people).values({
      householdId: id,
      name: "Titular",
      relation: "titular",
      birthYear: 1980,
      birthMonth: 1,
    });
    await db.ensureFinanceDefaults(tx, id);
    await tx.insert(retirementPlan).values({
      householdId: id,
      targetIncome: "9000.00",
      expectedYield: "6.00",
    });
    await tx.insert(emergencyFund).values({ householdId: id, targetMonths: 6 });
    const [account] = await tx.select().from(accounts);
    return account!.id;
  });
  return { id, owner, main, in: inFamily };
}

const categoryOf = async (
  family: Family,
  tx: TenantTx,
  kind: "receita" | "despesa",
  name: string,
) => (await db.ensureCategory(tx, family.id, kind, name, false)).id;

/** Salário 10.000, despesas 6.000 e aporte de `aporte` todo mês, por operação. */
async function investingFamily(aporte: string) {
  const family = await newFamily();
  await family.in(async (tx) => {
    const salary = await categoryOf(family, tx, "receita", "Salário");
    const home = await categoryOf(family, tx, "despesa", "Moradia");
    const contribution = await categoryOf(family, tx, "despesa", domain.CONTRIBUTION_CATEGORY);
    const [asset] = await tx
      .insert(investments)
      .values({
        householdId: family.id,
        name: "CDB",
        assetClass: "renda_fixa",
        currentValue: "18000.00",
        valuedOn: "2026-10-31",
      })
      .returning();
    for (const month of MONTHS) {
      const base = {
        householdId: family.id,
        accountId: family.main,
        description: "Prova",
        categorySource: "familia" as const,
      };
      await tx.insert(transactions).values([
        {
          ...base,
          kind: "receita",
          categoryId: salary,
          amount: "10000.00",
          occurredOn: `${month}-05`,
        },
        {
          ...base,
          kind: "despesa",
          categoryId: home,
          amount: "6000.00",
          occurredOn: `${month}-06`,
        },
      ]);
      if (aporte === "0.00") continue;
      const [cash] = await tx
        .insert(transactions)
        .values({
          ...base,
          kind: "despesa",
          categoryId: contribution,
          amount: aporte,
          occurredOn: `${month}-10`,
        })
        .returning({ id: transactions.id });
      await tx.insert(investmentTrades).values({
        householdId: family.id,
        investmentId: asset!.id,
        side: "compra",
        occurredOn: `${month}-10`,
        quantity: aporte,
        unitPrice: "1",
        transactionId: cash!.id,
      });
    }
  });
  return family;
}

const runAgents = (family: Family, today = TODAY) =>
  family.in(async (tx) => {
    const input = { today, householdId: family.id };
    const retirement = await agents.runAposentadoriaAgent(tx, input);
    await agents.runMetasAgent(tx, { ...input, allocation: retirement.allocation });
    return retirement;
  });

const pendingOf = (family: Family) =>
  family.in((tx) =>
    tx.select().from(householdSuggestions).where(eq(householdSuggestions.status, "pendente")),
  );

afterAll(async () => {
  await db.closeAllPools();
});

describe("F1. reserva curta por causa do hábito", () => {
  it("avisa, sugere redirecionar sem mudar nada, e é idempotente", async () => {
    const family = await investingFamily("3000.00");
    const first = await runAgents(family);
    await runAgents(family);
    expect(first.allocation).toMatchObject({ reserve: "600.00", retirement: "3000.00" });
    const rows = (await pendingOf(family)).filter((row) => row.kind === "lembrete");
    const redirect = rows.filter((row) => row.dedupeKey.startsWith("lembrete:redirecionar"));
    expect(redirect).toHaveLength(1);
    expect(redirect[0]).toMatchObject({ messageKey: "lembreteRedirecionar" });
    expect(redirect[0]!.body).toContain("nada muda sozinho");
    // Nada automático: aporte e reserva informados continuam vazios.
    const [plan] = await family.in((tx) => tx.select().from(retirementPlan));
    const [fund] = await family.in((tx) => tx.select().from(emergencyFund));
    expect(plan?.monthlyContribution).toBeNull();
    expect(fund?.contribution).toBeNull();
  });

  it("some quando a reserva deixa de ficar curta", async () => {
    const family = await investingFamily("3000.00");
    await runAgents(family);
    await family.in((tx) => tx.update(emergencyFund).set({ monthlyAmount: "1.00" }));
    await runAgents(family);
    const rows = await pendingOf(family);
    expect(rows.filter((row) => row.dedupeKey.startsWith("lembrete:redirecionar"))).toEqual([]);
  });
});

describe("F3. valor aceito pela família", () => {
  it("o agente não propõe reduzir: só informa", async () => {
    const family = await investingFamily("3000.00");
    await family.in(async (tx) => {
      await tx.update(emergencyFund).set({ contribution: "1800.00" });
      await tx.update(retirementPlan).set({ monthlyContribution: "3500.00" });
    });
    await runAgents(family);
    const rows = await pendingOf(family);
    expect(rows.filter((row) => row.kind === "aporte_reserva")).toEqual([]);
    expect(rows.filter((row) => row.kind === "aporte_investimento")).toEqual([]);
    const notice = rows.find((row) => row.dedupeKey.startsWith("lembrete:valor-acima"));
    expect(notice).toMatchObject({ kind: "lembrete", messageKey: "lembreteValorAcima" });
    const [fund] = await family.in((tx) => tx.select().from(emergencyFund));
    const [plan] = await family.in((tx) => tx.select().from(retirementPlan));
    expect(fund?.contribution).toBe("1800.00");
    expect(plan?.monthlyContribution).toBe("3500.00");
  });
});

describe("4. sugestão que a divisão não pede mais", () => {
  it("fecha aporte_investimento e aporte_divida, sem contar como recusa", async () => {
    const family = await investingFamily("3000.00");
    const stale = (kind: "aporte_investimento" | "aporte_divida", agent: string, key: string) => ({
      householdId: family.id,
      agent,
      kind,
      title: "Velha",
      body: "Velha",
      payload: { monthlyAmount: "1260.00", previous: null, debtId: "d", extraMonthly: "100.00" },
      status: "pendente" as const,
      appliedBy: "familia" as const,
      dedupeKey: key,
    });
    await family.in((tx) =>
      tx.insert(householdSuggestions).values([
        stale("aporte_investimento", "aposentadoria", "aporte_investimento:2026-11"),
        stale("aporte_divida", "dividas", "aporte_divida:d:2026-11"),
        // Pedida na conversa: não é da divisão, e fica.
        stale("aporte_investimento", "assistente", "aporte_investimento:assistente"),
      ]),
    );
    await runAgents(family);
    const rows = await family.in((tx) => tx.select().from(householdSuggestions));
    const byKey = (key: string) => rows.find((row) => row.dedupeKey === key);
    expect(byKey("fechada:aporte_investimento:2026-11")?.status).toBe("ignorada");
    expect(byKey("fechada:aporte_divida:d:2026-11")?.status).toBe("ignorada");
    expect(byKey("aporte_investimento:assistente")?.status).toBe("pendente");
    const decisions = await family.in((tx) => agents.loadDecisions(tx, TODAY));
    expect(decisions.recentlyIgnored.has("aporte_investimento:2026-11")).toBe(false);
  });
});

describe("F2. meta com parcela real", () => {
  it("não perde plano nem parcelas abertas, e desired_month fica intocado", async () => {
    const family = await investingFamily("3000.00");
    const goalId = await family.in(async (tx) => {
      const category = await categoryOf(family, tx, "despesa", domain.GOAL_CATEGORY);
      const [goal] = await tx
        .insert(goals)
        .values({
          householdId: family.id,
          name: "Reforma",
          kind: "reforma",
          targetAmount: "10000.00",
          saved: "1800.00",
          status: "juntando",
          accountId: family.main,
          desiredMonth: "2027-06",
          planMonthly: "300.00",
          planStart: "2026-05",
          planEnd: "2028-11",
        })
        .returning();
      for (const month of MONTHS) {
        const [cash] = await tx
          .insert(transactions)
          .values({
            householdId: family.id,
            accountId: family.main,
            categoryId: category,
            kind: "despesa",
            description: "Parcela",
            amount: "300.00",
            occurredOn: `${month}-11`,
            categorySource: "familia",
          })
          .returning({ id: transactions.id });
        await tx.insert(goalContributions).values({
          householdId: family.id,
          goalId: goal!.id,
          month,
          amount: "300.00",
          transactionId: cash!.id,
        });
      }
      await tx.insert(goalContributions).values(
        ["2026-11", "2026-12", "2027-01"].map((month) => ({
          householdId: family.id,
          goalId: goal!.id,
          month,
          amount: "300.00",
        })),
      );
      return goal!.id;
    });

    const { allocation } = await runAgents(family);
    expect(allocation).toMatchObject({ goalsBudget: "300.00", alreadySavingForGoals: "300.00" });
    const read = () =>
      family.in(async (tx) => ({
        goal: (await tx.select().from(goals).where(eq(goals.id, goalId)))[0]!,
        open: await tx
          .select()
          .from(goalContributions)
          .where(isNull(goalContributions.transactionId)),
      }));
    const planned = await read();
    expect(planned.goal.desiredMonth).toBe("2027-06");
    expect(planned.goal.planMonthly).toBe("300.00");
    expect(planned.open.length).toBeGreaterThan(0);

    // Mês sem sobra nenhuma: o plano fica, e a tela avisa.
    await family.in(async (tx) => {
      const home = await categoryOf(family, tx, "despesa", "Moradia");
      await tx.insert(transactions).values(
        MONTHS.map((month) => ({
          householdId: family.id,
          accountId: family.main,
          categoryId: home,
          kind: "despesa" as const,
          description: "Obra",
          amount: "9000.00",
          occurredOn: `${month}-15`,
          categorySource: "familia" as const,
        })),
      );
    });
    const squeezed = await runAgents(family);
    expect(squeezed.allocation.goalsBudget).toBe("0.00");
    const kept = await read();
    expect(kept.goal).toMatchObject({
      planMonthly: "300.00",
      desiredMonth: "2027-06",
      status: "juntando",
    });
    expect(kept.goal.planNote).toMatch(/^Plano mantido/);
    expect(kept.open.map((row) => row.month).sort()).toEqual(
      planned.open.map((row) => row.month).sort(),
    );
  });
});

describe("2. resgate de extrato no histórico", () => {
  async function imported() {
    const family = await newFamily();
    const rows = await family.in(async (tx) => {
      const generic = await categoryOf(family, tx, "receita", "Outras receitas");
      const bonus = await categoryOf(family, tx, "receita", "Bônus");
      await tx.insert(importBatches).values({
        id: "lote-1",
        householdId: family.id,
        accountId: family.main,
        source: "ofx",
        rowCount: 3,
        periodStart: "2026-01-01",
        periodEnd: "2026-10-31",
      });
      const base = {
        householdId: family.id,
        accountId: family.main,
        kind: "receita" as const,
        amount: "5000.00",
        occurredOn: "2026-10-12",
      };
      return tx
        .insert(transactions)
        .values([
          {
            ...base,
            categoryId: generic,
            description: "RES APLIC AUT MAIS",
            importBatchId: "lote-1",
            categorySource: "revisar" as const,
          },
          {
            ...base,
            categoryId: generic,
            description: "RESGATE CDB",
            occurredOn: "2026-01-12",
            importBatchId: "lote-1",
            categorySource: "revisar" as const,
          },
          // A família escolheu: não muda.
          {
            ...base,
            categoryId: bonus,
            description: "RESGATE PREMIO",
            importBatchId: "lote-1",
            categorySource: "familia" as const,
          },
          // Não veio de importação: não muda.
          {
            ...base,
            categoryId: generic,
            description: "RESGATE MANUAL",
            categorySource: "familia" as const,
          },
        ])
        .returning({ id: transactions.id, description: transactions.description });
    });
    return { family, rows };
  }

  const categoryNameOf = (family: Family, id: string) =>
    family.in(async (tx) => {
      const [row] = await tx
        .select({ name: categories.name, kind: categories.kind })
        .from(transactions)
        .innerJoin(categories, eq(categories.id, transactions.categoryId))
        .where(eq(transactions.id, id));
      return row?.name;
    });

  it("move só genérica de importação, avisa, tem Desfazer e o desfeito não volta", async () => {
    const { family, rows } = await imported();
    const id = (text: string) => rows.find((row) => row.description === text)!.id;
    const review = () =>
      family.in((tx) => agents.runCategoriasAgent(tx, { today: TODAY, householdId: family.id }));

    await review();
    expect(await categoryNameOf(family, id("RES APLIC AUT MAIS"))).toBe(
      domain.CONTRIBUTION_CATEGORY,
    );
    expect(await categoryNameOf(family, id("RESGATE CDB"))).toBe(domain.CONTRIBUTION_CATEGORY);
    expect(await categoryNameOf(family, id("RESGATE PREMIO"))).toBe("Bônus");
    expect(await categoryNameOf(family, id("RESGATE MANUAL"))).toBe("Outras receitas");

    const notices = await family.in((tx) => tx.select().from(householdNotifications));
    expect(notices.filter((row) => row.kind === "categoria")).toHaveLength(2);
    const changes = await family.in((tx) =>
      tx
        .select()
        .from(householdSuggestions)
        .where(
          and(
            eq(householdSuggestions.status, "aplicada"),
            eq(householdSuggestions.appliedBy, "agente"),
          ),
        ),
    );
    expect(changes).toHaveLength(2);

    const ctx = db.fromJob({ householdId: family.id });
    const undone = await family.in((tx) =>
      agents.undoSuggestion(tx, { ...ctx, userId: family.owner, role: "owner" }, changes[0]!.id),
    );
    expect(undone.ok).toBe(true);
    await review();
    await review();
    const names = await Promise.all(
      ["RES APLIC AUT MAIS", "RESGATE CDB"].map((text) => categoryNameOf(family, id(text))),
    );
    expect(names.filter((name) => name === "Outras receitas")).toHaveLength(1);
  });
});

describe("relatórios fechados", () => {
  const seedClosed = async () => {
    const family = await investingFamily("1000.00");
    await family.in((tx) =>
      agents.runRelatoriosAgent(tx, { today: "2026-11-01", householdId: family.id }),
    );
    return family;
  };
  const figure = (data: { figures: Array<{ id: string; value: unknown }> }, id: string) =>
    data.figures.find((item) => item.id === id)?.value;

  it("6. fluxo regenerado mantém a projeção antiga, rotulada", async () => {
    const family = await seedClosed();
    const projection = {
      id: "projection",
      columns: ["month", "plannedIn", "plannedOut", "left", "accumulated"],
      rows: [
        [
          { month: "2026-10" },
          { money: "1.00" },
          { money: "2.00" },
          { money: "-1.00" },
          { money: "-1.00" },
        ],
      ],
    };
    await family.in(async (tx) => {
      const [row] = await tx
        .select()
        .from(householdStatements)
        .where(
          and(eq(householdStatements.kind, "fluxo"), eq(householdStatements.period, "2026-09")),
        );
      const data = row!.data as unknown as domain_StatementData;
      await tx
        .update(householdStatements)
        .set({
          data: {
            ...data,
            version: 1,
            notes: [],
            sections: [...data.sections.filter((s) => s.id !== "projection"), projection],
            figures: [...data.figures, { id: "projected", value: { money: "-1.00" } }],
          } as never,
          sourceHash: "antiga",
        })
        .where(eq(householdStatements.id, row!.id));
    });
    await family.in((tx) =>
      agents.runRelatoriosAgent(tx, { today: "2026-11-03", householdId: family.id }),
    );
    const read = async () =>
      (await family.in((tx) => agents.readStatement(tx, "fluxo", "2026-09")))!.data;
    const data = await read();
    expect(data.version).toBe(2);
    expect(data.sections.find((s) => s.id === "projection")).toEqual(projection);
    expect(figure(data, "projected")).toEqual({ money: "-1.00" });
    expect(data.notes).toContain("projecaoAntiga");
  });

  it("8. a posição do fim do ano sobrevive a qualquer regeneração do anual", async () => {
    const family = await investingFamily("1000.00");
    await family.in(async (tx) => {
      const salary = await categoryOf(family, tx, "receita", "Salário");
      await tx.insert(transactions).values({
        householdId: family.id,
        accountId: family.main,
        categoryId: salary,
        kind: "receita",
        description: "Ano passado",
        amount: "100.00",
        occurredOn: "2025-12-05",
        categorySource: "familia",
      });
    });
    await family.in((tx) =>
      agents.runRelatoriosAgent(tx, { today: "2026-01-01", householdId: family.id }),
    );
    const annual = async () =>
      (await family.in((tx) => agents.readStatement(tx, "anual", "2025")))!.data;
    const positions = (await annual()).sections.find((s) => s.id === "positions");
    expect(positions).toBeDefined();
    // Regra nova, e depois a família lança de novo em dezembro: a foto de janeiro continua.
    await family.in((tx) =>
      tx
        .update(householdStatements)
        .set({ sourceHash: "x" })
        .where(eq(householdStatements.period, "2025")),
    );
    await family.in((tx) =>
      agents.runRelatoriosAgent(tx, { today: "2026-02-10", householdId: family.id }),
    );
    expect((await annual()).sections.find((s) => s.id === "positions")).toEqual(positions);
  });
});

type domain_StatementData = {
  sections: Array<{ id: string }>;
  figures: Array<{ id: string; value: unknown }>;
};
