// Agente de relatórios (ADR-0021) contra um Postgres real com RLS, pela conexão do worker, como em
// produção. Datas fixas: o agente recebe o dia. Dados fictícios.
import { afterAll, describe, expect, inject, it } from "vitest";
import type { TenantContext, TenantTx } from "@organizeup/db";

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

const {
  accounts,
  and,
  categories,
  eq,
  household,
  householdMember,
  householdSettings,
  householdStatements,
  netWorthSnapshots,
  people,
  transactions,
  user,
} = db;

interface Family {
  id: string;
  job: TenantContext;
}

let families = 0;
async function newFamily(): Promise<Family> {
  families += 1;
  const id = `hh-rel-${families}`;
  const owner = `user-rel-${families}`;
  await db.withAdmin("seed do teste de relatórios", async (admin) => {
    await admin
      .insert(user)
      .values({ id: owner, name: "Pessoa Teste", email: `${owner}@example.com` });
    await admin.insert(household).values({ id, name: "Grupo Teste", slug: id });
    await admin
      .insert(householdMember)
      .values({ id: `m-${id}`, organizationId: id, userId: owner, role: "owner" });
  });
  await db.withWorkerHousehold(id, async (tx) => {
    await tx.insert(householdSettings).values({ householdId: id });
    await tx.insert(people).values({ householdId: id, name: "Titular", relation: "titular" });
    await db.ensureFinanceDefaults(tx, id);
  });
  return { id, job: db.fromJob({ householdId: id }) };
}

const inFamily = <T>(family: Family, fn: (tx: TenantTx) => Promise<T>) =>
  db.withWorkerHousehold(family.id, fn);

const run = (family: Family, today: string) =>
  inFamily(family, (tx) => agents.runRelatoriosAgent(tx, { today, householdId: family.id }));

const statements = (family: Family) =>
  inFamily(family, (tx) => tx.select().from(householdStatements));

const statement = async (family: Family, kind: "resumo" | "metas", period: string) => {
  const row = await inFamily(family, (tx) => agents.readStatement(tx, kind, period));
  if (!row) throw new Error(`sem relatório ${kind} ${period}`);
  return row;
};

async function add(
  family: Family,
  occurredOn: string,
  amount: string,
  over: { kind?: "receita" | "despesa"; category?: string } = {},
) {
  return inFamily(family, async (tx) => {
    const kind = over.kind ?? "despesa";
    const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.name, over.category ?? (kind === "despesa" ? "Moradia" : "Salário")),
          eq(categories.kind, kind),
        ),
      );
    const [row] = await tx
      .insert(transactions)
      .values({
        householdId: family.id,
        accountId: account!.id,
        categoryId: category!.id,
        kind,
        description: "Lançamento de teste",
        amount,
        occurredOn,
        categorySource: "familia",
      })
      .returning({ id: transactions.id });
    return row!.id;
  });
}

const figure = (data: { figures: Array<{ id: string; value: unknown }> }, id: string) =>
  data.figures.find((item) => item.id === id)?.value;

afterAll(async () => {
  await db.closeAllPools();
});

describe("agente de relatórios", () => {
  it("família vazia não quebra e não ganha relatório", async () => {
    const family = await newFamily();
    await expect(run(family, "2026-11-15")).resolves.toEqual({ suggestions: 0, applied: 0 });
    await expect(run(family, "2026-12-01")).resolves.toEqual({ suggestions: 0, applied: 0 });
    expect(await statements(family)).toEqual([]);
  });

  it("nos outros dias atualiza o mês corrente, parcial, e só com valores e chaves", async () => {
    const family = await newFamily();
    await add(family, "2026-11-03", "4000.00", { kind: "receita" });
    await add(family, "2026-11-04", "1500.00");
    const { applied } = await run(family, "2026-11-15");
    expect(applied).toBeGreaterThan(0);
    const row = await statement(family, "resumo", "2026-11");
    expect(row.status).toBe("parcial");
    expect(row.closedAt).toBeNull();
    expect(row.data.asOf).toBe("2026-11-15");
    expect(figure(row.data, "left")).toEqual({ money: "2500.00" });
    expect(row.messageKey).toBe("resumo");
    expect(row.messageParams).toMatchObject({ left: { money: "2500.00" } });
    const yearly = (await statements(family)).find((item) => item.kind === "anual");
    expect(yearly).toMatchObject({ period: "2026", status: "parcial" });
  });

  it("rodar duas vezes no dia dá o mesmo resultado", async () => {
    const family = await newFamily();
    await add(family, "2026-10-03", "900.00");
    await add(family, "2026-11-04", "1500.00");
    await run(family, "2026-11-15");
    const first = await statements(family);
    await expect(run(family, "2026-11-15")).resolves.toEqual({ suggestions: 0, applied: 0 });
    const second = await statements(family);
    const key = (row: { kind: string; period: string }) => `${row.kind}:${row.period}`;
    const sorted = (rows: typeof first) => [...rows].sort((a, b) => key(a).localeCompare(key(b)));
    expect(sorted(second)).toEqual(sorted(first));
  });

  it("no dia 1 fecha o mês anterior e ainda não abre o novo", async () => {
    const family = await newFamily();
    await add(family, "2026-10-03", "900.00");
    await run(family, "2026-10-20");
    expect((await statement(family, "resumo", "2026-10")).status).toBe("parcial");
    await run(family, "2026-11-01");
    const closed = await statement(family, "resumo", "2026-10");
    expect(closed.status).toBe("fechado");
    expect(closed.closedAt).not.toBeNull();
    expect(closed.revisedAt).toBeNull();
    expect(closed.data.asOf).toBe("2026-10-31");
    expect((await statements(family)).some((row) => row.period === "2026-11")).toBe(false);
  });

  it("perdeu o dia 1: fecha o que ficou parcial para trás", async () => {
    const family = await newFamily();
    await add(family, "2026-09-03", "900.00");
    await run(family, "2026-09-20");
    await run(family, "2026-11-05");
    expect((await statement(family, "resumo", "2026-09")).status).toBe("fechado");
  });

  it("mês fechado não muda sozinho", async () => {
    const family = await newFamily();
    await add(family, "2026-10-03", "900.00");
    await run(family, "2026-11-01");
    const closed = await statement(family, "resumo", "2026-10");
    // Lançamento de outro mês não mexe nele, nem o passar dos dias.
    await add(family, "2026-11-10", "50.00");
    await run(family, "2026-11-20");
    await run(family, "2026-12-01");
    expect(await statement(family, "resumo", "2026-10")).toEqual(closed);
  });

  it("agente mudar categoria genérica não reabre o mês fechado", async () => {
    const family = await newFamily();
    const id = await add(family, "2026-10-03", "900.00", { category: "Outras despesas" });
    await run(family, "2026-11-01");
    const closed = await statement(family, "resumo", "2026-10");
    await inFamily(family, async (tx) => {
      const [target] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.name, "Moradia"));
      await tx
        .update(transactions)
        .set({ categoryId: target!.id, categorySource: "agente" })
        .where(eq(transactions.id, id));
    });
    await run(family, "2026-11-20");
    expect(await statement(family, "resumo", "2026-10")).toEqual(closed);
  });

  it("lançamento em mês fechado regenera e marca atualizado em", async () => {
    const family = await newFamily();
    await add(family, "2026-10-03", "900.00");
    await run(family, "2026-11-01");
    const closed = await statement(family, "resumo", "2026-10");
    expect(closed.revisedAt).toBeNull();

    await inFamily(family, (tx) =>
      tx
        .update(householdStatements)
        .set({ whatChanged: "Texto antigo", narratedAt: new Date() })
        .where(eq(householdStatements.id, closed.id)),
    );
    await add(family, "2026-10-20", "100.00");
    await run(family, "2026-11-20");
    const revised = await statement(family, "resumo", "2026-10");
    expect(revised.status).toBe("fechado");
    expect(revised.revisedAt).not.toBeNull();
    expect(figure(revised.data, "spent")).toEqual({ money: "1000.00" });
    expect(revised.whatChanged).toBeNull();
    expect(revised.narratedAt).not.toBeNull();
    // A assinatura nova segura o mês de novo.
    await expect(run(family, "2026-11-20")).resolves.toEqual({ suggestions: 0, applied: 0 });
  });

  it("apagar tudo do mês tira o relatório da tela", async () => {
    const family = await newFamily();
    const id = await add(family, "2026-10-03", "900.00");
    await run(family, "2026-11-01");
    await inFamily(family, (tx) => tx.delete(transactions).where(eq(transactions.id, id)));
    await run(family, "2026-11-20");
    const left = await statements(family);
    expect(left.some((row) => row.kind === "resumo" && row.period === "2026-10")).toBe(false);
  });

  it("a primeira rodada preenche os meses fechados que têm dado, e o resto fica de fora", async () => {
    const family = await newFamily();
    await add(family, "2026-06-03", "700.00");
    await add(family, "2026-11-03", "100.00");
    await run(family, "2026-11-15");
    const rows = await statements(family);
    const resumo = rows.filter((row) => row.kind === "resumo").map((row) => row.period);
    expect(resumo.sort()).toEqual(["2026-06", "2026-11"]);
    expect((await statement(family, "resumo", "2026-06")).status).toBe("fechado");
  });

  it("foto do mês só vale de fechamento no dia 1", async () => {
    const family = await newFamily();
    await inFamily(family, (tx) =>
      tx.insert(db.goals).values({
        householdId: family.id,
        name: "Reforma",
        kind: "reforma",
        targetAmount: "1000.00",
        priority: 1,
      }),
    );
    await run(family, "2026-11-15");
    const metas = (await statements(family)).filter((row) => row.kind === "metas");
    expect(metas.map((row) => row.period)).toEqual(["2026-11"]);
    await run(family, "2026-12-01");
    expect((await statement(family, "metas", "2026-11")).status).toBe("fechado");
  });

  it("em janeiro fecha o ano", async () => {
    const family = await newFamily();
    await add(family, "2026-03-03", "900.00");
    await add(family, "2026-12-03", "100.00");
    await run(family, "2026-12-20");
    await run(family, "2027-01-01");
    const row = (await statements(family)).find(
      (item) => item.kind === "anual" && item.period === "2026",
    );
    expect(row?.status).toBe("fechado");
    expect(figure(row!.data, "spent")).toEqual({ money: "1000.00" });
    expect(row?.data.notes).toContain("anualNaoFiscal");
  });

  it("patrimônio fechado segue a foto do mês", async () => {
    const family = await newFamily();
    await inFamily(family, (tx) =>
      tx.insert(netWorthSnapshots).values({
        householdId: family.id,
        month: "2026-09",
        owned: "5000.00",
        owed: "1000.00",
        net: "4000.00",
      }),
    );
    await run(family, "2026-11-15");
    const rows = await statements(family);
    const worth = rows.find((row) => row.kind === "patrimonio" && row.period === "2026-09");
    expect(worth?.status).toBe("fechado");
    expect(figure(worth!.data, "net")).toEqual({ money: "4000.00" });
    expect(worth?.data.notes).toContain("semDetalhe");
  });

  it("painel e relatório saem da mesma conta", async () => {
    const family = await newFamily();
    await add(family, "2026-11-03", "4000.00", { kind: "receita" });
    await add(family, "2026-11-04", "1500.00");
    await run(family, "2026-11-15");
    const row = await statement(family, "resumo", "2026-11");
    const panel = await inFamily(family, async (tx) => {
      const rows = await tx.select().from(transactions);
      return domain.summarizeMonth(
        domain.buildMonthEntries("2026-11", [], rows),
        domain.NO_SAVINGS,
      );
    });
    expect(figure(row.data, "received")).toEqual({ money: panel.received });
    expect(figure(row.data, "spent")).toEqual({ money: panel.spent });
    expect(figure(row.data, "left")).toEqual({ money: panel.balance });
  });

  it("outra família não aparece", async () => {
    const a = await newFamily();
    const b = await newFamily();
    await add(a, "2026-11-04", "1500.00");
    await run(a, "2026-11-15");
    await run(b, "2026-11-15");
    expect(await statements(b)).toEqual([]);
  });

  it("lê a moeda da família e cai em real no que não conhece", async () => {
    const family = await newFamily();
    await expect(inFamily(family, (tx) => agents.householdCurrency(tx, family.id))).resolves.toBe(
      "BRL",
    );
  });
});
