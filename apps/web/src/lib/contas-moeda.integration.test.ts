// Contas em dólar e euro (ADR-0020), pelas server actions de verdade, contra um Postgres real com RLS.
// Dados fictícios. Cotações da PTAX de venda de out/2026.
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
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: messages } = await import("../../messages/pt-BR.json");
  return {
    getLocale: async () => "pt-BR",
    getTranslations: async (namespace: never) =>
      createTranslator({ locale: "pt-BR", messages, namespace }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({ requireTenant: async () => ({ ctx }) }));

// As actions leem o idioma da requisição; aqui ele é escolhido por teste.
const language = vi.hoisted(() => ({ current: "pt-BR" }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messagesFor } = await import("@/i18n/messages");
  const messages = (locale: string) => messagesFor(locale as "pt-BR");
  return {
    getLocale: async () => language.current,
    getMessages: async () => messages(language.current),
    getTranslations: async (namespace?: string) =>
      createTranslator({
        locale: language.current,
        messages: messages(language.current),
        namespace,
      } as never),
  };
});

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const { saveEntry, confirmEntry, confirmEntryNotice, deleteEntry, quoteForEntry } =
  await import("@/app/app/(painel)/lancamentos/actions");
const { createTransfer, deleteTransfer, saveAccount } =
  await import("@/app/app/(painel)/contas/actions");
const { commitImport, prepareImport } = await import("@/app/app/(painel)/importar/actions");
const { addTrade, updateTrade } = await import("@/app/app/(painel)/investimentos/actions");
const { loadAccountBalances, loadMonth, loadOverview, loadTransfers } =
  await import("@/lib/finance-data");
const { loadNetWorth, loadReserve } = await import("@/lib/wealth");

const { accounts, categories, creditCards, cardPurchases, household, householdMember, user } = db;
const { accountTransfers, cashflowPlans, earmarks, eq, goals, householdSettings } = db;
const { goalContributions, investments, transactions } = db;

const H = { household: "hh-moeda", owner: "user-moeda" };
const inH = <T>(fn: Parameters<typeof db.withWorkerHousehold<T>>[1]) =>
  db.withWorkerHousehold(H.household, fn);

let real = "";
let dollars = "";
let euros = "";
let expense = "";
let income = "";

const fx = (currency: "USD" | "EUR", date: string, rate: string) => ({
  currency,
  date,
  rate,
  source: "teste",
});

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const entry = (over: Record<string, string> = {}) =>
  form({
    key: "",
    kind: "despesa",
    description: "Hotel",
    amount: "100,00",
    date: "2026-10-30",
    categoryId: expense,
    accountId: dollars,
    done: "on",
    ...over,
  });

const save = (over: Record<string, string> = {}) =>
  saveEntry({ ok: false, message: null }, entry(over));

const newest = async (description: string) => {
  const rows = await inH((tx) =>
    tx.select().from(transactions).where(eq(transactions.description, description)),
  );
  return rows[0]!;
};

const balanceOf = async (id: string) => {
  const { accounts: rows } = await loadAccountBalances(ctx);
  return rows.find((row) => row.id === id)!;
};

beforeAll(async () => {
  await db.withAdmin("seed do teste de moedas", async (admin) => {
    await admin.insert(user).values({
      id: H.owner,
      name: "Dona",
      email: "dona-moeda@example.com",
    });
    await admin.insert(household).values({ id: H.household, name: "Moeda", slug: "hh-moeda" });
    await admin
      .insert(householdMember)
      .values({ id: "m-moeda", organizationId: H.household, userId: H.owner, role: "owner" });
  });
  const session = await db.fromSession({
    user: { id: H.owner },
    session: { activeOrganizationId: H.household },
  });
  if (!session) throw new Error("sem contexto");
  ctx = session;

  await inH(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: H.household });
    const rows = await tx
      .insert(accounts)
      .values([
        { householdId: H.household, name: "Banco", openingBalance: "1000.00" },
        { householdId: H.household, name: "Dólar", currency: "USD", openingBalance: "200.00" },
        { householdId: H.household, name: "Euro", currency: "EUR" },
      ])
      .returning({ id: accounts.id, name: accounts.name });
    real = rows.find((row) => row.name === "Banco")!.id;
    dollars = rows.find((row) => row.name === "Dólar")!.id;
    euros = rows.find((row) => row.name === "Euro")!.id;
    const cats = await tx
      .insert(categories)
      .values([
        { householdId: H.household, name: "Viagem", kind: "despesa" },
        { householdId: H.household, name: "Freela", kind: "receita" },
        { householdId: H.household, name: "Cartão de crédito", kind: "despesa" },
      ])
      .returning({ id: categories.id, kind: categories.kind, name: categories.name });
    expense = cats.find((row) => row.name === "Viagem")!.id;
    income = cats.find((row) => row.kind === "receita")!.id;
  });
  await db.saveMarketFx([
    fx("USD", "2026-10-28", "5.34200000"),
    fx("USD", "2026-10-29", "5.37440000"),
    fx("USD", "2026-10-30", "5.42120000"),
    fx("EUR", "2026-10-30", "6.05220000"),
  ]);
});

afterAll(() => db.closeAllPools());

beforeEach(async () => {
  language.current = "pt-BR";
  await inH(async (tx) => {
    await tx.delete(accountTransfers);
    await tx.delete(transactions);
    await tx.delete(cashflowPlans);
  });
});

describe("lançamento em conta estrangeira", () => {
  it("grava reais em amount e o que foi digitado ao lado", async () => {
    expect((await save()).ok).toBe(true);
    expect(await newest("Hotel")).toMatchObject({
      amount: "542.12",
      originalAmount: "100.00",
      originalCurrency: "USD",
      fxRate: "5.42120000",
    });
  });

  it("em conta em real não muda nada", async () => {
    await save({ accountId: real, description: "Mercado" });
    expect(await newest("Mercado")).toMatchObject({
      amount: "100.00",
      originalAmount: null,
      originalCurrency: null,
      fxRate: null,
    });
  });

  it("no fim de semana usa a cotação de sexta, e data futura a última", async () => {
    await save({ date: "2026-10-31", description: "Sábado" });
    await save({ date: "2030-01-01", description: "Futuro", done: "" });
    expect((await newest("Sábado")).fxRate).toBe("5.42120000");
    expect((await newest("Futuro")).fxRate).toBe("5.42120000");
  });

  it("sem cotação nenhuma, recusa com mensagem clara e não grava", async () => {
    const result = await save({ date: "2016-01-01", description: "Antigo" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Ainda não temos a cotação do dólar");
    const rows = await inH((tx) => tx.select().from(transactions));
    expect(rows).toHaveLength(0);
  });

  it("em inglês, 1,234.56 grava mil duzentos e trinta e quatro, e o erro vem traduzido", async () => {
    language.current = "en";
    const saved = await save({ accountId: real, amount: "1,234.56", description: "Rent" });
    expect(saved).toMatchObject({ ok: true, message: "Transaction saved." });
    expect((await newest("Rent")).amount).toBe("1234.56");

    const refused = await save({ date: "2016-01-01", description: "Old" });
    expect(refused.message).toContain("We don't have the US dollar exchange rate");
    const wrong = await save({ accountId: real, amount: "abc" });
    expect(wrong.fieldErrors?.amount).toBe("Enter an amount greater than zero, like 150.90.");
  });

  it("em espanhol, 1.234,56 grava o mesmo valor", async () => {
    language.current = "es";
    await save({ accountId: real, amount: "1.234,56", description: "Alquiler" });
    expect((await newest("Alquiler")).amount).toBe("1234.56");
  });

  it("conta em euro sem cotação na data também recusa", async () => {
    const result = await save({ accountId: euros, date: "2026-10-29" });
    expect(result.message).toContain("cotação do euro");
  });

  it("a prévia devolve a cotação que o lançamento usaria", async () => {
    expect(await quoteForEntry("USD", "2026-10-31")).toEqual({
      rate: "5.42120000",
      date: "2026-10-30",
    });
    expect(await quoteForEntry("BRL", "2026-10-31")).toBeNull();
    expect(await quoteForEntry("USD", "2016-01-01")).toBeNull();
  });

  it("conta estrangeira não aceita conta que se repete", async () => {
    const result = await save({ repeat: "on" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("não aceita conta que se repete");
    expect(await inH((tx) => tx.select().from(cashflowPlans))).toHaveLength(0);
  });

  it("valor que não cabe em reais depois de convertido é recusado", async () => {
    const result = await save({ amount: "900.000.000.000,00" });
    expect(result.message).toContain("passa do limite");
  });
});

describe("editar lançamento", () => {
  const key = async (description: string) => `t:${(await newest(description)).id}`;

  it("data nova recalcula com a cotação dela", async () => {
    await save();
    await save({ key: await key("Hotel"), date: "2026-10-28" });
    expect(await newest("Hotel")).toMatchObject({
      amount: "534.20",
      originalAmount: "100.00",
      fxRate: "5.34200000",
    });
  });

  it("valor novo recalcula", async () => {
    await save();
    await save({ key: await key("Hotel"), amount: "50,00" });
    expect(await newest("Hotel")).toMatchObject({ amount: "271.06", originalAmount: "50.00" });
  });

  it("mudar só a descrição mantém a cotação congelada", async () => {
    await save();
    const id = await key("Hotel");
    // Cotação da data muda de propósito: um lançamento já feito não pode acompanhar.
    await inH((tx) =>
      tx
        .update(transactions)
        .set({ fxRate: "5.00000000", amount: "500.00" })
        .where(eq(transactions.id, id.slice(2))),
    );
    await save({ key: id, description: "Hotel em Lisboa" });
    expect(await newest("Hotel em Lisboa")).toMatchObject({
      amount: "500.00",
      fxRate: "5.00000000",
    });
  });

  it("levar para conta em real apaga o original", async () => {
    await save();
    await save({ key: await key("Hotel"), accountId: real });
    expect(await newest("Hotel")).toMatchObject({
      amount: "100.00",
      originalAmount: null,
      fxRate: null,
    });
  });
});

describe("saldo e totais", () => {
  it("a conta soma o valor original, com sinal", async () => {
    await save();
    await save({ kind: "receita", categoryId: income, description: "Freela", amount: "30,00" });
    await save({ description: "Previsto", done: "" });
    const account = await balanceOf(dollars);
    // 200 - 100 + 30; o previsto não entra.
    expect(account.nativeBalance).toBe("130.00");
    expect(account.balance).toBe("704.76");
  });

  it("o total em reais usa a cotação de hoje, não a do lançamento", async () => {
    await save({ date: "2026-10-28" });
    expect((await newest("Hotel")).amount).toBe("534.20");
    const { balance } = await loadOverview(ctx);
    // 1000 em real + 100 dólares a 5,4212 + zero em euro.
    expect(balance.value).toBe("1542.12");
    expect(balance.fx).toEqual({ date: "2026-10-30", missing: [] });
  });

  it("patrimônio e reserva somam em reais", async () => {
    const worth = await loadNetWorth(ctx, { record: false });
    expect(worth.summary.owned).toBe("2084.24");
    expect(worth.fx?.date).toBe("2026-10-30");

    await inH((tx) =>
      tx
        .insert(earmarks)
        .values({ householdId: H.household, accountId: dollars, purpose: "reserva" }),
    );
    const reserve = await loadReserve(ctx);
    expect(reserve.status.saved).toBe("1084.24");
    expect(reserve.fx?.date).toBe("2026-10-30");
    await inH((tx) => tx.delete(earmarks));
  });

  it("o resumo do mês soma reais", async () => {
    await save();
    await save({ accountId: real, description: "Mercado", amount: "50,00" });
    const month = await loadMonth(ctx, "2026-10");
    expect(month.summary.spent).toBe("592.12");
    const hotel = month.entries.find((row) => row.description === "Hotel")!;
    expect(hotel).toMatchObject({ amount: "542.12", originalAmount: "100.00" });
    const market = month.entries.find((row) => row.description === "Mercado")!;
    expect(market).not.toHaveProperty("originalAmount");
  });
});

describe("exportar", () => {
  it("leva as colunas novas de conta, lançamento e transferência", async () => {
    await save();
    await createTransfer(
      { ok: false, message: null },
      form({
        fromAccountId: real,
        toAccountId: dollars,
        amount: "550,00",
        toAmount: "100,00",
        occurredOn: "2026-10-30",
        note: "",
      }),
    );
    const data = await inH((tx) => db.exportHousehold(tx));
    expect(data.accounts).toContainEqual(expect.objectContaining({ currency: "USD" }));
    expect(data.transactions![0]).toMatchObject({
      originalAmount: "100.00",
      originalCurrency: "USD",
      fxRate: "5.42120000",
    });
    expect(data.account_transfers![0]).toMatchObject({
      toAmount: "100.00",
      fxRate: "5.50000000",
    });
    expect(data).not.toHaveProperty("market_fx");
  });
});

describe("transferência entre moedas", () => {
  const transfer = (over: Record<string, string>) =>
    createTransfer(
      { ok: false, message: null },
      form({
        fromAccountId: real,
        toAccountId: dollars,
        amount: "550,00",
        toAmount: "100,00",
        occurredOn: "2026-10-30",
        note: "",
        ...over,
      }),
    );

  it("move as duas pontas, guarda a taxa real e fica fora do mês", async () => {
    expect((await transfer({})).ok).toBe(true);
    const [row] = await inH((tx) => tx.select().from(accountTransfers));
    expect(row).toMatchObject({ amount: "550.00", toAmount: "100.00", fxRate: "5.50000000" });
    expect((await balanceOf(real)).nativeBalance).toBe("450.00");
    expect((await balanceOf(dollars)).nativeBalance).toBe("300.00");

    const month = await loadMonth(ctx, "2026-10");
    expect(month.summary).toMatchObject({ received: "0.00", spent: "0.00" });
    const listed = (await loadTransfers(ctx)).rows[0]!;
    expect(listed).toMatchObject({ fromCurrency: "BRL", toCurrency: "USD", toAmount: "100.00" });
  });

  it("no sentido contrário, sai dólar e entra real", async () => {
    await transfer({
      fromAccountId: dollars,
      toAccountId: real,
      amount: "50,00",
      toAmount: "270,00",
    });
    const [row] = await inH((tx) => tx.select().from(accountTransfers));
    expect(row).toMatchObject({ amount: "50.00", toAmount: "270.00", fxRate: "5.40000000" });
    expect((await balanceOf(dollars)).nativeBalance).toBe("150.00");
    expect((await balanceOf(real)).nativeBalance).toBe("1270.00");
  });

  it("desfazer devolve os dois lados", async () => {
    await transfer({});
    const [row] = await inH((tx) => tx.select().from(accountTransfers));
    await deleteTransfer(form({ id: row!.id }));
    expect((await balanceOf(dollars)).nativeBalance).toBe("200.00");
  });

  it("entre moedas pede o que entrou", async () => {
    const result = await transfer({ toAmount: "" });
    expect(result.message).toContain("quanto entrou em US$");
    expect(await inH((tx) => tx.select().from(accountTransfers))).toHaveLength(0);
  });

  it("entre contas da mesma moeda fica igual a hoje", async () => {
    const [other] = await inH((tx) =>
      tx
        .insert(accounts)
        .values({ householdId: H.household, name: "Banco 2" })
        .returning({ id: accounts.id }),
    );
    await transfer({ toAccountId: other!.id, amount: "10,00", toAmount: "" });
    const [row] = await inH((tx) => tx.select().from(accountTransfers));
    expect(row).toMatchObject({ amount: "10.00", toAmount: null, fxRate: null });
    await inH(async (tx) => {
      await tx.delete(accountTransfers);
      await tx.delete(accounts).where(eq(accounts.id, other!.id));
    });
  });
});

describe("moeda da conta", () => {
  const edit = (id: string, currency: string) =>
    saveAccount(
      { ok: false, message: null },
      form({ id, name: "Dólar", type: "corrente", currency, openingBalance: "200,00" }),
    );

  it("só muda em conta sem movimento", async () => {
    expect((await edit(euros, "EUR")).ok).toBe(true);
    await save();
    const result = await edit(dollars, "EUR");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("não pode mudar de moeda");
    expect((await balanceOf(dollars)).currency).toBe("USD");
  });

  it("transferência também conta como movimento", async () => {
    await createTransfer(
      { ok: false, message: null },
      form({
        fromAccountId: real,
        toAccountId: dollars,
        amount: "550,00",
        toAmount: "100,00",
        occurredOn: "2026-10-30",
        note: "",
      }),
    );
    expect((await edit(dollars, "BRL")).ok).toBe(false);
  });

  it("recusa moeda fora da lista", async () => {
    expect((await edit(euros, "GBP")).ok).toBe(false);
  });

  it("cria conta na moeda escolhida", async () => {
    await saveAccount(
      { ok: false, message: null },
      form({
        id: "",
        name: "Conta nova",
        type: "corrente",
        currency: "EUR",
        openingBalance: "10,00",
      }),
    );
    const { accounts: rows } = await loadAccountBalances(ctx);
    const created = rows.find((row) => row.name === "Conta nova")!;
    expect(created).toMatchObject({ currency: "EUR", nativeBalance: "10.00", balance: "60.52" });
    await inH((tx) => tx.delete(accounts).where(eq(accounts.id, created.id)));
  });
});

describe("importar extrato", () => {
  const rows = [
    { date: "2026-10-28", description: "Padaria", amount: "10.00", kind: "despesa" as const },
    { date: "2026-10-30", description: "Padaria", amount: "20.00", kind: "despesa" as const },
  ];

  async function importRows(list = rows) {
    const prepared = await prepareImport({ accountId: dollars, source: "csv", rows: list });
    if (!prepared.ok) throw new Error(prepared.message);
    const fresh = prepared.rows.filter((row) => row.state === "novo");
    const committed = await commitImport({
      accountId: dollars,
      source: "csv",
      rows: fresh.map((row) => ({
        date: row.date,
        description: row.description,
        amount: row.amount,
        kind: row.kind,
        fingerprint: row.fingerprint,
        categoryId: expense,
        newCategory: null,
        source: row.source,
        corrected: false,
        matchKey: null,
        matchMonth: null,
      })),
    }).catch((error: unknown) => ({ ok: false as const, message: String(error) }));
    return { prepared: prepared.rows, committed };
  }

  it("converte cada linha na data dela", async () => {
    const { committed } = await importRows();
    expect(committed.ok).toBe(true);
    const saved = await inH((tx) => tx.select().from(transactions));
    expect(saved.find((row) => row.occurredOn === "2026-10-28")).toMatchObject({
      amount: "53.42",
      originalAmount: "10.00",
      fxRate: "5.34200000",
    });
    expect(saved.find((row) => row.occurredOn === "2026-10-30")).toMatchObject({
      amount: "108.42",
      originalAmount: "20.00",
    });
    expect((await balanceOf(dollars)).nativeBalance).toBe("170.00");
  });

  it("reimportar o mesmo arquivo não duplica", async () => {
    await importRows();
    const { prepared } = await importRows();
    expect(prepared.map((row) => row.state)).toEqual(["importado", "importado"]);
    expect(await inH((tx) => tx.select().from(transactions))).toHaveLength(2);
  });

  it("linha igual a um lançamento feito à mão parece já lançada, pelo valor em dólar", async () => {
    await save({ description: "Padaria", amount: "20,00" });
    const prepared = await prepareImport({ accountId: dollars, source: "csv", rows: [rows[1]!] });
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.rows[0]!.state).toBe("lancado");
  });

  it("linha sem cotação recusa o arquivo com a data", async () => {
    const result = await prepareImport({
      accountId: dollars,
      source: "csv",
      rows: [{ date: "2016-03-01", description: "Velha", amount: "1.00", kind: "despesa" }],
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("01/03/2016");
  });
});

describe("compromissos em reais pagos com conta estrangeira", () => {
  const plan = async (accountId: string) => {
    const [created] = await inH((tx) =>
      tx
        .insert(cashflowPlans)
        .values({
          householdId: H.household,
          accountId,
          categoryId: expense,
          kind: "despesa",
          description: "Aluguel",
          amount: "1000.00",
          dayOfMonth: 5,
          startMonth: "2026-10",
        })
        .returning({ id: cashflowPlans.id }),
    );
    return form({ key: `p:${created!.id}`, month: "2026-10" });
  };

  it("sem cotação nada é confirmado, e a pessoa recebe um aviso claro", async () => {
    const notice = await confirmEntryNotice(await plan(euros));
    expect(notice).toBe(
      "Nada foi confirmado. Esta conta é em euro e ainda não temos a cotação de 05/10/2026. Tente de novo mais tarde.",
    );
    expect(await inH((tx) => tx.select().from(transactions))).toHaveLength(0);
  });

  it("o aviso vem no idioma da pessoa", async () => {
    language.current = "en";
    const notice = await confirmEntryNotice(await plan(euros));
    expect(notice).toContain("This account is in euros");
    expect(notice).toContain("10/05/2026");
  });

  it("com cotação, ou em conta em real, confirma sem aviso", async () => {
    expect(await confirmEntryNotice(await plan(real))).toBeNull();
    expect((await newest("Aluguel")).status).toBe("realizado");
  });

  it("fatura grava reais exatos e converte pela data do vencimento", async () => {
    const [card] = await inH((tx) =>
      tx
        .insert(creditCards)
        .values({
          householdId: H.household,
          name: "Cartão",
          closingDay: 20,
          dueDay: 30,
          payingAccountId: dollars,
        })
        .returning({ id: creditCards.id }),
    );
    await inH((tx) =>
      tx.insert(cardPurchases).values({
        householdId: H.household,
        cardId: card!.id,
        categoryId: expense,
        description: "Compra",
        amount: "543.21",
        purchasedOn: "2026-10-05",
      }),
    );
    await confirmEntry(form({ key: `f:${card!.id}:2026-10`, month: "2026-10" }));
    const paid = await newest("Fatura Cartão");
    expect(paid).toMatchObject({
      amount: "543.21",
      originalAmount: "100.20",
      originalCurrency: "USD",
      fxRate: "5.42120000",
    });
    expect((await balanceOf(dollars)).nativeBalance).toBe("99.80");
    await inH(async (tx) => {
      await tx.delete(db.cardStatementPayments);
      await tx.delete(transactions);
      await tx.delete(cardPurchases);
      await tx.delete(creditCards);
    });
  });

  it("aporte sai da conta em dólar, com a carteira em reais", async () => {
    const [asset] = await inH((tx) =>
      tx
        .insert(investments)
        .values({ householdId: H.household, name: "Reserva", assetClass: "renda_fixa" })
        .returning({ id: investments.id }),
    );
    const result = await addTrade(
      { ok: false, message: null },
      form({
        investmentId: asset!.id,
        side: "compra",
        occurredOn: "2026-10-30",
        fees: "0",
        amount: "1.084,24",
        accountId: dollars,
      }),
    );
    expect(result).toEqual({ ok: true, message: null });
    expect(await newest("Aporte em Reserva")).toMatchObject({
      amount: "1084.24",
      originalAmount: "200.00",
      fxRate: "5.42120000",
    });
    expect((await balanceOf(dollars)).nativeBalance).toBe("0.00");
  });

  it("aporte sem cotação não grava nada e explica", async () => {
    const [asset] = await inH((tx) => tx.select({ id: investments.id }).from(investments).limit(1));
    const result = await addTrade(
      { ok: false, message: null },
      form({
        investmentId: asset!.id,
        side: "compra",
        occurredOn: "2026-10-29",
        fees: "0",
        amount: "100,00",
        accountId: euros,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Ainda não temos a cotação");
    await inH(async (tx) => {
      await tx.delete(db.investmentTrades);
      await tx.delete(investments);
    });
  });

  it("venda maior que a posição entra, e editar a operação refaz o lançamento da conta", async () => {
    const [asset] = await inH((tx) =>
      tx
        .insert(investments)
        .values({
          householdId: H.household,
          name: "Petrobras",
          ticker: "PETR4",
          assetClass: "acao",
        })
        .returning({ id: investments.id }),
    );
    const sold = await addTrade(
      { ok: false, message: null },
      form({
        investmentId: asset!.id,
        side: "venda",
        occurredOn: "2026-10-30",
        fees: "0",
        quantity: "10",
        unitPrice: "30,00",
        accountId: dollars,
      }),
    );
    expect(sold).toEqual({ ok: true, message: null });
    const [trade] = await inH((tx) => tx.select().from(db.investmentTrades));
    expect(trade?.side).toBe("venda");
    expect(domain.money(trade!.quantity).toString()).toBe("10");
    expect(await newest("Resgate de PETR4")).toMatchObject({ amount: "300.00" });

    const edited = await updateTrade(
      { ok: false, message: null },
      form({
        id: trade!.id,
        investmentId: asset!.id,
        side: "venda",
        occurredOn: "2026-10-30",
        fees: "1,00",
        quantity: "12",
        unitPrice: "31,00",
        accountId: real,
      }),
    );
    expect(edited).toEqual({ ok: true, message: null });
    const [after] = await inH((tx) => tx.select().from(db.investmentTrades));
    expect(domain.money(after!.quantity).toString()).toBe("12");
    expect(domain.money(after!.unitPrice).toString()).toBe("31");
    expect(after?.fees).toBe("1.00");
    const moved = await inH((tx) =>
      tx.select().from(transactions).where(eq(transactions.description, "Resgate de PETR4")),
    );
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ id: after!.transactionId, accountId: real, amount: "371.00" });
    await inH(async (tx) => {
      await tx.delete(transactions);
      await tx.delete(db.investmentTrades);
      await tx.delete(investments);
    });
  });

  it("parcela de meta: os dois lados têm os mesmos reais, e apagar devolve tudo", async () => {
    await inH(async (tx) => {
      const { ensureCategory } = db;
      await ensureCategory(tx, H.household, "despesa", domain.GOAL_CATEGORY, false);
      await ensureCategory(tx, H.household, "receita", domain.GOAL_CATEGORY, false);
    });
    const [goal] = await inH((tx) =>
      tx
        .insert(goals)
        .values({
          householdId: H.household,
          name: "Viagem",
          kind: "outro",
          targetAmount: "1000.00",
          saved: "0.00",
          accountId: dollars,
          destinationAccountId: real,
          planDay: 28,
        })
        .returning({ id: goals.id }),
    );
    await inH((tx) =>
      tx.insert(goalContributions).values({
        householdId: H.household,
        goalId: goal!.id,
        month: "2026-10",
        amount: "271.06",
      }),
    );
    await confirmEntry(form({ key: `g:${goal!.id}:2026-10`, month: "2026-10" }));
    const rows = await inH((tx) => tx.select().from(transactions));
    expect(rows).toHaveLength(2);
    const out = rows.find((row) => row.kind === "despesa")!;
    const mirror = rows.find((row) => row.kind === "receita")!;
    expect(out).toMatchObject({ amount: "271.06", originalAmount: "50.74" });
    expect(mirror).toMatchObject({ amount: "271.06", originalAmount: null });

    await deleteEntry(form({ id: out.id }));
    expect(await inH((tx) => tx.select().from(transactions))).toHaveLength(0);
    const [after] = await inH((tx) => tx.select().from(goals).where(eq(goals.id, goal!.id)));
    expect(after!.saved).toBe("0.00");
  });
});
