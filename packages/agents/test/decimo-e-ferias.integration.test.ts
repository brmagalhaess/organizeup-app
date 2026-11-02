// 13º e férias contra um Postgres real com RLS: mudar a escolha muda a previsão em toda leitura, os
// recebidos seguem valendo e os agentes não tocam no que a família escolheu (ADR-0028). Dados fictícios.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
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

const { accounts, categories, eq, household, householdMember, householdSettings } = db;
const { householdStatements, incomeReceipts, incomeSources, incomeVacationReceipts } = db;
const { incomeYearPlans, people, transactions, user } = db;

const TODAY = "2026-11-02";
const family = "hh-decimo-ferias";
const inFamily = <T>(fn: (tx: TenantTx) => Promise<T>) => db.withWorkerHousehold(family, fn);

let sourceId = "";
let accountId = "";
let categoryId = "";

const incomeIn = (from: string, to: string) =>
  inFamily((tx) => agents.scheduledIncome(tx, from, to));

const choose = (values: Partial<typeof incomeYearPlans.$inferInsert>) =>
  inFamily(async (tx) => {
    await tx.delete(incomeYearPlans);
    await tx
      .insert(incomeYearPlans)
      .values({ householdId: family, incomeSourceId: sourceId, year: 2026, ...values });
  });

const received = (amount: string, occurredOn: string) =>
  inFamily(async (tx) => {
    const [row] = await tx
      .insert(transactions)
      .values({
        householdId: family,
        accountId,
        categoryId,
        kind: "receita",
        description: "Recebido",
        amount,
        occurredOn,
      })
      .returning({ id: transactions.id });
    return row!.id;
  });

beforeAll(async () => {
  const owner = "user-decimo-ferias";
  await db.withAdmin("seed de 13º e férias", async (admin) => {
    await admin.insert(user).values({ id: owner, name: "Pessoa", email: `${owner}@example.com` });
    await admin.insert(household).values({ id: family, name: "Exemplo", slug: family });
    await admin
      .insert(householdMember)
      .values({ id: `m-${family}`, organizationId: family, userId: owner, role: "owner" });
  });
  await inFamily(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: family });
    await tx.insert(people).values({ householdId: family, name: "Titular", relation: "titular" });
    await db.ensureFinanceDefaults(tx, family);
    const [account] = await tx.select().from(accounts);
    accountId = account!.id;
    const [category] = await tx.select().from(categories).where(eq(categories.name, "Salário"));
    categoryId = category!.id;
    const [source] = await tx
      .insert(incomeSources)
      .values({
        householdId: family,
        accountId,
        categoryId,
        name: "Empresa Exemplo",
        kind: "clt",
        amount: "6000.00",
        isGross: true,
        payDay: 5,
        startMonth: "2026-01",
      })
      .returning({ id: incomeSources.id });
    sourceId = source!.id;
  });
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("toda leitura usa as escolhas", () => {
  it("sem escolha, novembro e dezembro de sempre", async () => {
    const keys = (await incomeIn("2026-11", "2026-12")).map((entry) => entry.key);
    expect(keys).toContain(`r:${sourceId}:2026-11:13-1`);
    expect(keys).toContain(`r:${sourceId}:2026-12:13-2`);
  });

  it("caso real: 1ª em julho marcada como recebida. Sem previsão, sem lançamento, 2ª certa", async () => {
    await choose({ thirteenthFirstMonth: 7, thirteenthFirstReceived: true });
    const entries = await incomeIn("2026-01", "2026-12");
    expect(entries.filter((entry) => entry.key.endsWith(":13-1"))).toEqual([]);
    expect(entries.find((entry) => entry.key.endsWith(":13-2"))).toMatchObject({
      amount: "1973.39",
      date: "2026-12-20",
    });
    const rows = await inFamily((tx) => tx.select().from(transactions));
    expect(rows).toEqual([]);
  });

  it("painel, Lançamentos, Calendário e compromissos dão o mesmo número", async () => {
    await choose({ thirteenthMode: "integral", thirteenthSecondMonth: 12 });
    const expected = "9946.78"; // 4.973,39 de salário + 4.973,39 do 13º inteiro.
    const { calendar, commitments } = await inFamily(async (tx) => ({
      calendar: await agents.calendarMonth(tx, { today: TODAY, month: "2026-12" }),
      commitments: await agents.loadCommitments(tx, { from: "2026-12", to: "2026-12" }),
    }));
    const inDecember = commitments.scheduled.filter((entry) => entry.date.startsWith("2026-12"));
    expect(
      inDecember.reduce((acc, entry) => acc.plus(entry.amount), domain.money(0)).toFixed(2),
    ).toBe(expected);
    expect(calendar.summary.plannedIncome).toBe(expected);
  });

  it("férias pagas em junho entram no mês do pagamento, com a chave do início", async () => {
    await choose({
      vacationPeriods: [{ month: 7, startDay: 1, days: 30, received: false }],
    });
    const june = await incomeIn("2026-06", "2026-06");
    expect(june.find((entry) => entry.date === "2026-06-29")?.key).toBe(
      `r:${sourceId}:2026-07:ferias`,
    );
    expect(await incomeIn("2026-07", "2026-07")).toEqual([]);
  });
});

describe("recebidos", () => {
  it("o que já foi recebido em novembro segue válido depois de mudar para julho", async () => {
    const transactionId = await received("3000.00", "2026-11-30");
    await inFamily((tx) =>
      tx.insert(incomeReceipts).values({
        householdId: family,
        incomeSourceId: sourceId,
        month: "2026-11",
        part: "13-1",
        transactionId,
      }),
    );
    await choose({ thirteenthFirstMonth: 7 });
    const entries = await incomeIn("2026-01", "2026-12");
    expect(entries.filter((entry) => entry.key.endsWith(":13-1"))).toEqual([]);
    // Apagar o lançamento devolve a previsão, agora no mês escolhido.
    await inFamily((tx) => tx.delete(transactions).where(eq(transactions.id, transactionId)));
    const back = await incomeIn("2026-01", "2026-12");
    expect(back.find((entry) => entry.key.endsWith(":13-1"))?.date).toBe("2026-07-05");
  });

  it("2º período de férias tem baixa própria, e apagar o lançamento devolve", async () => {
    await choose({
      vacationPeriods: [
        { month: 7, startDay: 6, days: 14, received: false },
        { month: 7, startDay: 22, days: 5, received: false },
      ],
    });
    const key = `r:${sourceId}:2026-07:ferias-2`;
    expect((await incomeIn("2026-07", "2026-07")).map((entry) => entry.key)).toContain(key);
    const transactionId = await received("1000.00", "2026-07-20");
    await inFamily((tx) =>
      tx.insert(incomeVacationReceipts).values({
        householdId: family,
        incomeSourceId: sourceId,
        month: "2026-07",
        part: "ferias-2",
        transactionId,
      }),
    );
    expect((await incomeIn("2026-07", "2026-07")).map((entry) => entry.key)).not.toContain(key);
    await inFamily((tx) => tx.delete(transactions).where(eq(transactions.id, transactionId)));
    expect((await incomeIn("2026-07", "2026-07")).map((entry) => entry.key)).toContain(key);
  });

  it("férias recebidas antes na parte de hoje continuam baixadas com o dia informado", async () => {
    const transactionId = await received("6000.00", "2026-07-05");
    await inFamily((tx) =>
      tx.insert(incomeReceipts).values({
        householdId: family,
        incomeSourceId: sourceId,
        month: "2026-07",
        part: "ferias",
        transactionId,
      }),
    );
    await choose({ vacationPeriods: [{ month: 7, startDay: 1, days: 30, received: false }] });
    expect(await incomeIn("2026-06", "2026-07")).toHaveLength(1);
    await inFamily((tx) => tx.delete(transactions).where(eq(transactions.id, transactionId)));
  });
});

describe("1ª parcela lançada", () => {
  it("a 2ª desconta o valor do lançamento, com o salário de hoje", async () => {
    await inFamily((tx) => tx.delete(incomeYearPlans));
    const transactionId = await received("3000.00", "2026-11-30");
    await inFamily(async (tx) => {
      await tx.insert(incomeReceipts).values({
        householdId: family,
        incomeSourceId: sourceId,
        month: "2026-11",
        part: "13-1",
        transactionId,
      });
      await tx.update(incomeSources).set({ amount: "6600.00" });
    });
    const december = await incomeIn("2026-12", "2026-12");
    expect(december.find((entry) => entry.key.endsWith(":13-2"))?.amount).toBe("2267.60");
    await inFamily(async (tx) => {
      await tx.delete(transactions).where(eq(transactions.id, transactionId));
      await tx.update(incomeSources).set({ amount: "6000.00" });
    });
  });
});

describe("agentes e relatórios", () => {
  const runAgents = (today: string) =>
    inFamily(async (tx) => {
      const input = { today, householdId: family };
      const retirement = await agents.runAposentadoriaAgent(tx, input);
      await agents.runMetasAgent(tx, { ...input, allocation: retirement.allocation });
      return agents.runRelatoriosAgent(tx, input);
    });

  it("dado informado: os agentes leem e nunca mudam a escolha", async () => {
    await choose({
      thirteenthFirstMonth: 7,
      thirteenthFirstReceived: true,
      thirteenthFirstAmount: "2800.00",
    });
    const before = await inFamily((tx) => tx.select().from(incomeYearPlans));
    await runAgents(TODAY);
    await runAgents(TODAY);
    expect(await inFamily((tx) => tx.select().from(incomeYearPlans))).toEqual(before);
  });

  it("aposentadoria e divisão usam o líquido de um mês normal, com ou sem escolha", async () => {
    const withPlan = await inFamily((tx) => agents.surplusInputs(tx, { today: TODAY }));
    await inFamily((tx) => tx.delete(incomeYearPlans));
    const without = await inFamily((tx) => agents.surplusInputs(tx, { today: TODAY }));
    expect(withPlan.surplus).toBe(without.surplus);
  });

  it("mês fechado não muda com a escolha: só `source_hash` reabre", async () => {
    await received("4973.39", "2026-10-05");
    await runAgents(TODAY);
    const closed = () =>
      inFamily((tx) =>
        tx.select().from(householdStatements).where(eq(householdStatements.status, "fechado")),
      );
    const before = await closed();
    expect(before.length).toBeGreaterThan(0);
    await choose({ thirteenthMode: "integral", thirteenthSecondMonth: 3 });
    await runAgents("2026-11-03");
    const after = await closed();
    const pick = (rows: typeof before) =>
      rows.map((row) => [row.kind, row.period, row.sourceHash, row.data]);
    for (const row of pick(before)) expect(pick(after)).toContainEqual(row);
  });

  it("o fluxo do mês aberto usa a mesma escolha da previsão", async () => {
    await choose({ thirteenthMode: "integral", thirteenthSecondMonth: 11 });
    await runAgents(TODAY);
    const fluxo = await inFamily((tx) => agents.readStatement(tx, "fluxo", "2026-11"));
    expect(JSON.stringify(fluxo?.data)).toContain("9946.78");
  });
});
