// Família com moeda principal em dólar ou euro (ADR-0020, Fase 6), pelas server actions de verdade,
// contra um Postgres real com RLS. Dados fictícios. Cotações da PTAX de venda de 30/10/2026.
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;

let ctx: TenantContext;
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requireTenant: async () => ({ ctx, session: { user: { id: ctx.userId, name: "Dona" } } }),
}));
vi.mock("@/i18n/money-server", () => ({ forgetFamilyCurrency: async () => undefined }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messagesFor } = await import("@/i18n/messages");
  return {
    getLocale: async () => "pt-BR",
    getMessages: async () => messagesFor("pt-BR"),
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "pt-BR", messages: messagesFor("pt-BR"), namespace } as never),
  };
});

const db = await import("@organizeup/db");
const { bootstrapHousehold, updateCurrency } = await import("@/app/app/actions");
const domain = await import("@organizeup/domain");
const { saveEntry, quoteForEntry, confirmEntry, confirmEntryNotice } =
  await import("@/app/app/(painel)/lancamentos/actions");
const { createTransfer } = await import("@/app/app/(painel)/contas/actions");
const { addAsset, saveInvestment } = await import("@/app/app/(painel)/investimentos/actions");
const { saveIncome } = await import("@/app/app/(painel)/renda/actions");
const { saveScenario } = await import("@/app/app/(painel)/aposentadoria/actions");
const { loadAccountBalances, loadMonth } = await import("@/lib/finance-data");
const { loadIncome } = await import("@/lib/income-data");
const { loadNetWorth, loadReserve } = await import("@/lib/wealth");

const { accounts, accountTransfers, categories, eq, household, householdMember } = db;
const { householdSettings, incomeSources, investments, transactions, user } = db;

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const initial = { ok: false, message: null };

let families = 0;
async function newFamily(): Promise<{ id: string; ctx: TenantContext }> {
  families += 1;
  const id = `hh-principal-${families}`;
  const owner = `user-principal-${families}`;
  await db.withAdmin("seed do teste de moeda principal", async (admin) => {
    await admin.insert(user).values({ id: owner, name: "Dona", email: `${owner}@example.com` });
    await admin.insert(household).values({ id, name: "Moeda", slug: id });
    await admin
      .insert(householdMember)
      .values({ id: `m-${id}`, organizationId: id, userId: owner, role: "owner" });
  });
  const session = await db.fromSession({
    user: { id: owner },
    session: { activeOrganizationId: id },
  });
  if (!session) throw new Error("sem contexto");
  ctx = session;
  return { id, ctx: session };
}

const inFamily = <T>(id: string, fn: Parameters<typeof db.withWorkerHousehold<T>>[1]) =>
  db.withWorkerHousehold(id, fn);

async function usdFamily() {
  const family = await newFamily();
  expect((await bootstrapHousehold({ city: "", state: "", currency: "USD" })).ok).toBe(true);
  return inFamily(family.id, async (tx) => {
    await db.ensureFinanceDefaults(tx, family.id);
    const [main] = await tx.select().from(accounts);
    const [real] = await tx
      .insert(accounts)
      .values({ householdId: family.id, name: "Banco no Brasil", currency: "BRL" })
      .returning();
    const [euro] = await tx
      .insert(accounts)
      .values({ householdId: family.id, name: "Conta em euro", currency: "EUR" })
      .returning();
    const expense = await db.ensureCategory(tx, family.id, "despesa", "Viagem", false);
    const income = await db.ensureCategory(tx, family.id, "receita", "Freela", false);
    return {
      ...family,
      main: main!,
      real: real!,
      euro: euro!,
      expense: expense.id,
      income: income.id,
    };
  });
}

const entry = (accountId: string, categoryId: string, over: Record<string, string> = {}) =>
  saveEntry(
    initial,
    form({
      key: "",
      kind: "despesa",
      description: "Mercado",
      amount: "100,00",
      date: "2026-10-30",
      categoryId,
      accountId,
      done: "on",
      ...over,
    }),
  );

const lastEntry = (id: string, description: string) =>
  inFamily(id, async (tx) => {
    const [row] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.description, description));
    return row!;
  });

beforeAll(async () => {
  await db.saveMarketFx(
    (["USD", "EUR"] as const).map((currency) => ({
      currency,
      date: "2026-10-30",
      rate: currency === "USD" ? "5.42120000" : "6.05220000",
      source: "teste",
    })),
  );
});

afterAll(() => db.closeAllPools());

describe("cadastro", () => {
  it("nasce na moeda escolhida, e a conta padrão também", async () => {
    const family = await usdFamily();
    expect(family.main).toMatchObject({ name: "Conta principal", currency: "USD" });
    expect(await inFamily(family.id, db.householdCurrency)).toBe("USD");
  });

  it("sem escolha, ou com moeda que não existe, fica em real", async () => {
    await newFamily();
    await bootstrapHousehold({ currency: "JPY" });
    expect(await db.withHousehold(ctx, db.householdCurrency)).toBe("BRL");
  });
});

describe("trava da moeda principal", () => {
  const change = (currency: string) => updateCurrency(initial, form({ currency }));

  it("sem movimento muda, e a conta sem saldo acompanha", async () => {
    const family = await newFamily();
    await bootstrapHousehold({});
    await inFamily(family.id, (tx) => db.ensureFinanceDefaults(tx, family.id));
    const [withBalance] = await inFamily(family.id, (tx) =>
      tx
        .insert(accounts)
        .values({ householdId: family.id, name: "Poupança", openingBalance: "500.00" })
        .returning(),
    );
    expect((await change("EUR")).ok).toBe(true);
    const rows = await inFamily(family.id, (tx) => tx.select().from(accounts));
    expect(rows.find((row) => row.name === "Conta principal")?.currency).toBe("EUR");
    expect(rows.find((row) => row.id === withBalance!.id)?.currency).toBe("BRL");
    expect((await db.withHousehold(ctx, db.householdCurrency)) as string).toBe("EUR");
  });

  it("moeda fora da lista é recusada", async () => {
    await newFamily();
    await bootstrapHousehold({});
    const result = await change("JPY");
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.["currency"]).toBeTruthy();
  });

  it("com lançamento, não muda e explica", async () => {
    const family = await usdFamily();
    await entry(family.main.id, family.expense);
    const result = await change("EUR");
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain("não muda mais");
    expect(await inFamily(family.id, db.householdCurrency)).toBe("USD");
  });

  it("escolher a mesma moeda não trava nada", async () => {
    const family = await usdFamily();
    await entry(family.main.id, family.expense);
    expect((await change("USD")).ok).toBe(true);
  });
});

describe("família em dólar", () => {
  it("conta na moeda principal lança o valor, sem conversão", async () => {
    const family = await usdFamily();
    expect((await entry(family.main.id, family.expense)).ok).toBe(true);
    expect(await lastEntry(family.id, "Mercado")).toMatchObject({
      amount: "100.00",
      originalAmount: null,
      brlAmount: null,
    });
  });

  it("conta em real é a estrangeira: amount em dólar e o real ao lado", async () => {
    const family = await usdFamily();
    const saved = await entry(family.real.id, family.expense, { amount: "542,12" });
    expect(saved.ok).toBe(true);
    expect(await lastEntry(family.id, "Mercado")).toMatchObject({
      amount: "100.00",
      brlAmount: "542.12",
      brlRate: "0.18446100",
      originalAmount: null,
      originalCurrency: null,
    });
    const balances = await loadAccountBalances(ctx);
    const real = balances.accounts.find((row) => row.id === family.real.id)!;
    expect(real).toMatchObject({ nativeBalance: "-542.12", balance: "-100.00" });
    expect(balances.fx).toEqual({ date: "2026-10-30", missing: [] });
  });

  it("conta em euro passa pelo real", async () => {
    const family = await usdFamily();
    await entry(family.euro.id, family.expense);
    expect(await lastEntry(family.id, "Mercado")).toMatchObject({
      amount: "111.64",
      originalAmount: "100.00",
      originalCurrency: "EUR",
      fxRate: "1.11639489",
    });
    expect((await quoteForEntry("BRL", "2026-10-30"))?.rate).toBe("0.18446100");
    expect(await quoteForEntry("USD", "2026-10-30")).toBeNull();
  });

  it("editar a descrição mantém a cotação; editar o valor recalcula", async () => {
    const family = await usdFamily();
    await entry(family.real.id, family.expense, { amount: "542,12" });
    const row = await lastEntry(family.id, "Mercado");
    await entry(family.real.id, family.expense, {
      key: `t:${row.id}`,
      amount: "542,12",
      description: "Feira",
    });
    expect(await lastEntry(family.id, "Feira")).toMatchObject({ brlAmount: "542.12" });
    await entry(family.real.id, family.expense, {
      key: `t:${row.id}`,
      amount: "1084,24",
      description: "Feira",
    });
    expect(await lastEntry(family.id, "Feira")).toMatchObject({
      amount: "200.00",
      brlAmount: "1084.24",
    });
  });

  it("o resumo do mês soma dólar, e o lançamento mostra o real", async () => {
    const family = await usdFamily();
    await entry(family.main.id, family.expense, { description: "Hotel" });
    await entry(family.real.id, family.expense, { amount: "542,12", description: "Feira" });
    await entry(family.euro.id, family.expense, { description: "Trem" });
    const month = await loadMonth(ctx, "2026-10");
    expect(month.summary.spent).toBe("311.64");
    const shown = month.entries.find((item) => item.description === "Feira");
    expect(shown).toMatchObject({
      amount: "100.00",
      originalAmount: "542.12",
      originalCurrency: "BRL",
    });
  });

  it("conta estrangeira não aceita conta que se repete; a principal aceita", async () => {
    const family = await usdFamily();
    const refused = await entry(family.real.id, family.expense, { repeat: "on" });
    expect(refused.ok).toBe(false);
    const allowed = await entry(family.main.id, family.expense, { repeat: "on" });
    expect(allowed.ok).toBe(true);
  });

  it("transferência de dólar para real guarda as duas pontas e não é gasto", async () => {
    const family = await usdFamily();
    const result = await createTransfer(
      initial,
      form({
        fromAccountId: family.main.id,
        toAccountId: family.real.id,
        amount: "100,00",
        toAmount: "550,00",
        occurredOn: "2026-10-30",
        note: "",
      }),
    );
    expect(result.ok).toBe(true);
    const [row] = await inFamily(family.id, (tx) => tx.select().from(accountTransfers));
    expect(row).toMatchObject({ amount: "100.00", toAmount: "550.00", fxRate: "5.50000000" });
    const { accounts: rows } = await loadAccountBalances(ctx);
    expect(rows.find((item) => item.id === family.main.id)?.nativeBalance).toBe("-100.00");
    expect(rows.find((item) => item.id === family.real.id)?.nativeBalance).toBe("550.00");
    expect((await loadMonth(ctx, "2026-10")).summary.spent).toBe("0.00");
  });

  it("previsão na conta em dólar confirma sem conversão", async () => {
    const family = await usdFamily();
    await entry(family.main.id, family.expense, { repeat: "on", done: "", description: "Aluguel" });
    const month = await loadMonth(ctx, "2026-10");
    const plan = month.entries.find((item) => item.description === "Aluguel")!;
    await confirmEntry(form({ key: plan.key, month: "2026-10" }));
    expect(await lastEntry(family.id, "Aluguel")).toMatchObject({
      amount: "100.00",
      brlAmount: null,
      originalAmount: null,
    });
  });

  it("fatura paga com a conta em real fica exata em dólar", async () => {
    const family = await usdFamily();
    const card = await inFamily(family.id, async (tx) => {
      await db.ensureCategory(tx, family.id, "despesa", "Cartão de crédito", false);
      const [row] = await tx
        .insert(db.creditCards)
        .values({
          householdId: family.id,
          name: "Visa",
          closingDay: 25,
          dueDay: 5,
          payingAccountId: family.real.id,
        })
        .returning({ id: db.creditCards.id });
      await tx.insert(db.cardPurchases).values({
        householdId: family.id,
        cardId: row!.id,
        categoryId: family.expense,
        description: "Passagem",
        amount: "100.00",
        purchasedOn: "2026-10-10",
      });
      return row!.id;
    });
    await confirmEntry(form({ key: `f:${card}:2026-11`, month: "2026-11" }));
    expect(await lastEntry(family.id, "Fatura Visa")).toMatchObject({
      amount: "100.00",
      brlAmount: "542.12",
    });
  });

  it("parcela de dívida paga com a conta em real fica exata em dólar", async () => {
    const family = await usdFamily();
    const installment = await inFamily(family.id, async (tx) => {
      await db.ensureCategory(tx, family.id, "despesa", domain.DEBT_CATEGORY, false);
      const [debt] = await tx
        .insert(db.debts)
        .values({
          householdId: family.id,
          accountId: family.real.id,
          name: "Carro",
          system: "price",
          originalBalance: "1000.00",
        })
        .returning({ id: db.debts.id });
      const [row] = await tx
        .insert(db.debtInstallments)
        .values({
          householdId: family.id,
          debtId: debt!.id,
          number: 1,
          dueDate: "2026-10-30",
          amount: "100.00",
          principal: "90.00",
          interest: "10.00",
        })
        .returning({ id: db.debtInstallments.id });
      return row!.id;
    });
    await confirmEntry(form({ key: `d:${installment}`, month: "2026-10" }));
    expect(await lastEntry(family.id, "Carro (1/1)")).toMatchObject({
      amount: "100.00",
      brlAmount: "542.12",
    });
  });

  it("parcela de meta sai da conta em real e chega em dólar", async () => {
    const family = await usdFamily();
    const goal = await inFamily(family.id, async (tx) => {
      await db.ensureCategory(tx, family.id, "despesa", domain.GOAL_CATEGORY, false);
      await db.ensureCategory(tx, family.id, "receita", domain.GOAL_CATEGORY, false);
      const [row] = await tx
        .insert(db.goals)
        .values({
          householdId: family.id,
          name: "Viagem",
          kind: "outro",
          targetAmount: "1000.00",
          accountId: family.real.id,
          destinationAccountId: family.main.id,
          planDay: 5,
        })
        .returning({ id: db.goals.id });
      await tx.insert(db.goalContributions).values({
        householdId: family.id,
        goalId: row!.id,
        month: "2026-11",
        amount: "100.00",
      });
      return row!.id;
    });
    await confirmEntry(form({ key: `g:${goal}:2026-11`, month: "2026-11" }));
    const rows = await inFamily(family.id, (tx) => tx.select().from(transactions));
    expect(rows.find((row) => row.kind === "despesa")).toMatchObject({
      amount: "100.00",
      brlAmount: "542.12",
    });
    expect(rows.find((row) => row.kind === "receita")).toMatchObject({
      amount: "100.00",
      brlAmount: null,
      originalAmount: null,
    });
    const [saved] = await inFamily(family.id, (tx) => tx.select().from(db.goals));
    expect(saved?.saved).toBe("100.00");
  });

  it("sem cotação, compromisso em conta em real não é confirmado", async () => {
    const family = await usdFamily();
    const [plan] = await inFamily(family.id, (tx) =>
      tx
        .insert(db.cashflowPlans)
        .values({
          householdId: family.id,
          accountId: family.real.id,
          categoryId: family.expense,
          kind: "despesa",
          description: "Antigo",
          amount: "10.00",
          dayOfMonth: 5,
          startMonth: "2016-01",
        })
        .returning({ id: db.cashflowPlans.id }),
    );
    const notice = await confirmEntryNotice(form({ key: `p:${plan!.id}`, month: "2015-01" }));
    expect(notice).toContain("Nada foi confirmado");
    expect(await inFamily(family.id, (tx) => tx.select().from(transactions))).toEqual([]);
  });

  it("reserva e patrimônio somam na moeda principal", async () => {
    const family = await usdFamily();
    await inFamily(family.id, async (tx) => {
      await tx
        .update(accounts)
        .set({ openingBalance: "542.12" })
        .where(eq(accounts.id, family.real.id));
      await tx
        .insert(db.earmarks)
        .values({ householdId: family.id, accountId: family.real.id, purpose: "reserva" });
    });
    const reserve = await loadReserve(ctx);
    expect(reserve.status.saved).toBe("100.00");
    expect(reserve.fx?.missing).toEqual([]);
    const worth = await loadNetWorth(ctx, { record: false });
    expect(worth.summary.owned).toBe("100.00");
  });
});

describe("regras brasileiras desligadas", () => {
  it("investimento: só classes de valor informado, sem código", async () => {
    const family = await usdFamily();
    const stock = await saveInvestment(
      initial,
      form({ id: "", name: "Petrobras", ticker: "PETR4", assetClass: "acao" }),
    );
    expect(stock.ok).toBe(false);
    expect(stock.message).toContain("família em real");
    const bought = await addAsset(
      initial,
      form({
        ticker: "PETR4",
        name: "ETF exterior",
        assetClass: "exterior",
        occurredOn: "2026-10-30",
        amount: "1000,00",
        currentValue: "1100,00",
      }),
    );
    expect(bought).toMatchObject({ ok: true });
    const [row] = await inFamily(family.id, (tx) => tx.select().from(investments));
    expect(row).toMatchObject({ assetClass: "exterior", ticker: null, currentValue: "1100.00" });
  });

  it("renda: CLT é recusada, e a que já existia vale pelo valor cadastrado", async () => {
    const family = await usdFamily();
    const base = {
      id: "",
      name: "Empresa",
      amount: "5000,00",
      payDay: "5",
      accountId: family.main.id,
      categoryId: family.income,
    };
    const refused = await saveIncome(initial, form({ ...base, kind: "clt" }));
    expect(refused.fieldErrors?.["kind"]).toBeTruthy();
    expect((await saveIncome(initial, form({ ...base, kind: "outro" }))).ok).toBe(true);
    await inFamily(family.id, (tx) =>
      tx.insert(incomeSources).values({
        householdId: family.id,
        name: "Antiga",
        kind: "clt",
        amount: "3000.00",
        isGross: true,
        payDay: 5,
        startMonth: "2026-01",
        accountId: family.main.id,
        categoryId: family.income,
      }),
    );
    const income = await loadIncome(ctx);
    expect(income.summary.monthly).toBe("8000.00");
    expect(income.sources.every((source) => source.payslip === null)).toBe(true);
  });

  it("cenário de aposentadoria ignora outras rendas", async () => {
    const family = await usdFamily();
    const [person] = await inFamily(family.id, (tx) => tx.select().from(db.people));
    const result = await saveScenario(
      initial,
      form({
        id: "",
        personId: person!.id,
        birth: "1980-01",
        name: "Plano",
        targetAge: "65",
        lifeExpectancy: "90",
        targetIncome: "5000,00",
        otherIncome: "3000,00",
        monthlyContribution: "500,00",
        saved: "10000,00",
        returnBefore: "4",
        returnAfter: "3",
      }),
    );
    expect(result).toMatchObject({ ok: true });
    const [scenario] = await inFamily(family.id, (tx) => tx.select().from(db.retirementScenarios));
    expect(scenario?.otherIncome).toBe("0.00");
  });
});

describe("família em real", () => {
  beforeEach(async () => {
    await newFamily();
    await bootstrapHousehold({});
  });

  it("não muda nada: moeda, conta padrão e lançamento", async () => {
    await inFamily(ctx.householdId, (tx) => db.ensureFinanceDefaults(tx, ctx.householdId));
    const [settings] = await inFamily(ctx.householdId, (tx) => tx.select().from(householdSettings));
    expect(settings).toMatchObject({ mainCurrency: "BRL", currency: "BRL" });
    const [account] = await inFamily(ctx.householdId, (tx) => tx.select().from(accounts));
    expect(account?.currency).toBe("BRL");
    const [category] = await inFamily(ctx.householdId, (tx) =>
      tx.select().from(categories).where(eq(categories.kind, "despesa")).limit(1),
    );
    await entry(account!.id, category!.id);
    expect(await lastEntry(ctx.householdId, "Mercado")).toMatchObject({
      amount: "100.00",
      originalAmount: null,
      brlAmount: null,
    });
    const balances = await loadAccountBalances(ctx);
    expect(balances.fx).toBeNull();
    expect(balances.accounts[0]).toMatchObject({ nativeBalance: "-100.00", balance: "-100.00" });
  });
});
