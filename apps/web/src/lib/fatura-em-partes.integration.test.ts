// Pagamento de fatura em mais de uma vez (ADR-0043), contra um Postgres real com RLS: a tela sugere o débito
// do banco, a família junta e desliga, e o saldo levado para a fatura seguinte é sempre refeito. Tudo fictício.
// As datas saem de hoje: a sugestão só olha os últimos meses e só vale para fatura já fechada.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;
process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");

let ctx: TenantContext;
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: messages } = await import("../../messages/pt-BR.json");
  return {
    getLocale: async () => "pt-BR",
    getMessages: async () => messages,
    getTranslations: async (namespace: never) =>
      createTranslator({ locale: "pt-BR", messages, namespace }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requireTenant: async () => ({ ctx }),
  platformFlags: async () => ({ bankFeedEnabled: true }),
  isServiceAdmin: () => false,
}));

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const auto = await import("@/lib/bank-auto");
const { loadCardStatements, refreshStatementsOf } = await import("@/lib/card-statements");
const { loadMonth } = await import("@/lib/finance-data");
const { joinStatementDebit, payStatement, splitStatementDebit } =
  await import("@/app/app/(painel)/cartoes/actions");
const { deleteEntry } = await import("@/app/app/(painel)/lancamentos/actions");

const { accounts, and, categories, cardPurchases, cardStatementParts, cardStatementPayments } = db;
const { creditCards, eq, household, householdMember, householdSettings, people, transactions } = db;
const { user } = db;

const H = { household: "hh-partes", owner: "user-partes" };
const inH = <T>(fn: Parameters<typeof db.withWorkerHousehold<T>>[1]) =>
  db.withWorkerHousehold(H.household, fn);
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const idle = { ok: false, message: null };

// Fecha dia 25, vence dia 5. A fatura do teste é a de dois ciclos atrás: já fechou e já venceu.
const TERMS = { closingDay: 25, dueDay: 5 };
const today = domain.todayIn();
const OPEN = domain.statementMonthOf(today, TERMS);
const MONTH = domain.addMonths(OPEN, -2);
const DUE = domain.statementDueDate(MONTH, TERMS);
const before = (days: number) => domain.addDays(DUE, -days);
const NEXT = domain.addMonths(MONTH, 1);
type YearMonth = typeof MONTH;

let connection = "";
let cardCategory = "";
let other = "";
let market = "";
let serial = 0;

/** Uma conta e um cartão do mesmo banco, com uma compra de `total` na fatura do teste (ou em `month`). */
async function bankWithCard(name: string, total: string, month: YearMonth = MONTH) {
  return inH(async (tx) => {
    const [account] = await tx
      .insert(accounts)
      .values({ householdId: H.household, name: `Conta ${name}`, openingBalance: "9000.00" })
      .returning({ id: accounts.id });
    const [card] = await tx
      .insert(creditCards)
      .values({
        householdId: H.household,
        name: `Cartão ${name}`,
        ...TERMS,
        payingAccountId: account!.id,
      })
      .returning({ id: creditCards.id });
    await tx.insert(cardPurchases).values({
      householdId: H.household,
      cardId: card!.id,
      categoryId: market,
      description: "Loja",
      amount: total,
      installments: 1,
      purchasedOn: domain.statementClosingDate(month, TERMS),
    });
    const link = { householdId: H.household, connectionId: connection, itemId: `item-${name}` };
    await tx.insert(db.bankConnectionAccounts).values([
      {
        ...link,
        externalId: `conta-${name}`,
        kind: "corrente",
        name: "Conta",
        accountId: account!.id,
      },
      { ...link, externalId: `cartao-${name}`, kind: "cartao", name: "Cartão", cardId: card!.id },
    ]);
    return { accountId: account!.id, cardId: card!.id };
  });
}

const bill = (amount: string, date: string, description = "Pagamento de fatura") => ({
  date,
  description,
  amount,
  kind: "despesa" as const,
  externalId: `pluggy:p${(serial += 1)}`,
});
const entriesOf = (accountId: string) =>
  inH((tx) => tx.select().from(transactions).where(eq(transactions.accountId, accountId)));
const summed = (rows: Array<{ amount: string }>) =>
  domain.toDbAmount(rows.reduce((acc, row) => acc.plus(row.amount), domain.money(0)));
const statementOf = async (cardId: string, month: string = MONTH) =>
  (await loadCardStatements(ctx))[`${cardId}:${month}`];
/** Os saldos levados de um cartão, pela descrição: "Saldo da fatura de MM/AAAA" → valor. */
const carriesOf = async (cardId: string) => {
  const purchases = await inH((tx) =>
    tx.select().from(cardPurchases).where(eq(cardPurchases.cardId, cardId)),
  );
  return Object.fromEntries(
    purchases
      .filter((purchase) => purchase.description.startsWith("Saldo da fatura"))
      .map((purchase) => [purchase.description.slice(-7, -5), purchase.amount]),
  );
};
const buyIn = (cardId: string, month: YearMonth, amount: string) =>
  inH((tx) =>
    tx.insert(cardPurchases).values({
      householdId: H.household,
      cardId,
      categoryId: market,
      description: "Outra loja",
      amount,
      installments: 1,
      purchasedOn: domain.statementClosingDate(month, TERMS),
    }),
  );
/** O restante que a fatura do teste levou para a seguinte, ou null. */
const carryOf = async (cardId: string) => {
  const purchases = await inH((tx) =>
    tx.select().from(cardPurchases).where(eq(cardPurchases.cardId, cardId)),
  );
  return (
    purchases.find((purchase) => purchase.description.startsWith("Saldo da fatura"))?.amount ?? null
  );
};
const partsOf = (cardId: string) =>
  inH((tx) => tx.select().from(cardStatementParts).where(eq(cardStatementParts.cardId, cardId)));
const paymentOf = async (cardId: string, month: string = MONTH) => {
  const [row] = await inH((tx) =>
    tx
      .select()
      .from(cardStatementPayments)
      .where(
        and(
          eq(cardStatementPayments.cardId, cardId),
          eq(cardStatementPayments.statementMonth, month),
        ),
      ),
  );
  return row;
};
const join = (cardId: string, id: string, mode = "auto") =>
  joinStatementDebit(idle, form({ cardId, month: MONTH, id, mode }));
const payByHand = (cardId: string, amount: string, total: string, month: YearMonth = MONTH) =>
  payStatement(
    { ok: false, message: "" },
    form({
      cardId,
      month,
      paidOn: domain.statementDueDate(month, TERMS),
      amount,
      total,
    }),
  );
const MM = (month: string) => month.slice(5, 7);

beforeAll(async () => {
  await db.withAdmin("seed do teste de fatura em partes", async (admin) => {
    await admin
      .insert(user)
      .values({ id: H.owner, name: "Titular", email: "titular-partes@example.com" });
    await admin.insert(household).values({ id: H.household, name: "Casa", slug: "hh-partes" });
    await admin
      .insert(householdMember)
      .values({ id: "m-partes-1", organizationId: H.household, userId: H.owner, role: "owner" });
  });
  const made = await db.fromSession({
    user: { id: H.owner },
    session: { activeOrganizationId: H.household },
  });
  if (!made) throw new Error("sem contexto");
  ctx = made;
  await inH(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: H.household });
    const [person] = await tx
      .insert(people)
      .values({ householdId: H.household, name: "Ana Souza", relation: "titular" })
      .returning({ id: people.id });
    const cats = await tx
      .insert(categories)
      .values([
        { householdId: H.household, name: "Mercado", kind: "despesa" },
        { householdId: H.household, name: domain.CARD_CATEGORY, kind: "despesa" },
        { householdId: H.household, name: "Outras despesas", kind: "despesa" },
      ])
      .returning({ id: categories.id, name: categories.name });
    market = cats.find((row) => row.name === "Mercado")!.id;
    cardCategory = cats.find((row) => row.name === domain.CARD_CATEGORY)!.id;
    other = cats.find((row) => row.name === "Outras despesas")!.id;
    const [made] = await tx
      .insert(db.bankConnections)
      .values({
        householdId: H.household,
        userId: H.owner,
        personId: person!.id,
        clientIdSealed: "x",
        clientSecretSealed: "y",
        itemIds: ["item"],
        // Fora da rodada automática: outros testes contam as conexões ligadas no mesmo banco.
        autoEnabled: false,
      })
      .returning({ id: db.bankConnections.id });
    connection = made!.id;
  });
});

afterAll(() => db.closeAllPools());

describe("fatura marcada como paga à mão e débitos do banco por cima", () => {
  it("a tela sugere os débitos; juntar tira do valor marcado, e o total pago não muda", async () => {
    const { accountId, cardId } = await bankWithCard("mao", "500.00");
    expect((await payByHand(cardId, "500,00", "500.00")).ok).toBe(true);
    await auto.autoImportStatement(ctx, accountId, [
      bill("100.00", before(8)),
      bill("150.00", before(2)),
      bill("60.00", before(3), "SUPERMERCADO BOM PRECO"),
    ]);
    // Antes de juntar, o mês somava a fatura inteira e mais os dois débitos.
    expect(summed(await entriesOf(accountId))).toBe("810.00");
    const shown = await statementOf(cardId);
    expect(shown!.main).toMatchObject({ amount: "500.00", byHand: true, fromBank: false });
    expect(shown!.suggestions.map((debit) => debit.amount)).toEqual(["100.00", "150.00"]);

    const [first, second] = shown!.suggestions;
    expect(await join(cardId, first!.id)).toEqual({ ok: true, message: "Débito ligado à fatura." });
    expect((await join(cardId, second!.id)).ok).toBe(true);
    const after = await entriesOf(accountId);
    expect(summed(after)).toBe("560.00");
    const paid = after.filter((entry) => entry.categoryId === cardCategory);
    expect(summed(paid)).toBe("500.00");
    expect(paid.find((entry) => !entry.importFingerprint)).toMatchObject({ amount: "250.00" });
    expect(await carryOf(cardId)).toBeNull();
    const now = await statementOf(cardId);
    expect(now).toMatchObject({ paid: "500.00", suggestions: [] });
    expect(now!.parts.map((part) => part.amount)).toEqual(["100.00", "150.00"]);
    // O que já está ligado não pode ser ligado de novo.
    expect(await join(cardId, first!.id)).toMatchObject({ ok: false });
  });

  it("desligar devolve o valor marcado e a categoria de antes, e o débito volta a ser sugerido", async () => {
    const { accountId, cardId } = await bankWithCard("volta", "500.00");
    await payByHand(cardId, "500,00", "500.00");
    await auto.autoImportStatement(ctx, accountId, [bill("100.00", before(8))]);
    const [debit] = (await statementOf(cardId))!.suggestions;
    await join(cardId, debit!.id);
    await splitStatementDebit(form({ id: debit!.id }));

    const all = await entriesOf(accountId);
    expect(all.find((entry) => !entry.importFingerprint)).toMatchObject({ amount: "500.00" });
    expect(all.find((entry) => entry.id === debit!.id)).toMatchObject({
      categoryId: other,
      categorySource: "familia",
    });
    expect(await partsOf(cardId)).toHaveLength(0);
    expect((await statementOf(cardId))!.suggestions.map((item) => item.id)).toEqual([debit!.id]);
  });

  it("quando o banco cobre tudo, o débito toma o lugar do pagamento marcado", async () => {
    const { accountId, cardId } = await bankWithCard("troca", "500.00");
    await payByHand(cardId, "500,00", "500.00");
    await auto.autoImportStatement(ctx, accountId, [bill("520.00", before(1))]);
    const [debit] = (await statementOf(cardId))!.suggestions;
    await join(cardId, debit!.id);
    const all = await entriesOf(accountId);
    expect(all.map((entry) => entry.amount)).toEqual(["520.00"]);
    expect((await paymentOf(cardId))!.transactionId).toBe(debit!.id);
    expect(await partsOf(cardId)).toHaveLength(0);
    expect((await statementOf(cardId))!.main).toMatchObject({ byHand: false, fromBank: true });
  });

  it("a família diz quando o débito é um pagamento a mais, e não o que ela marcou", async () => {
    const { accountId, cardId } = await bankWithCard("mais", "1000.00");
    // Marcou 600 à mão (pagos por fora); o saldo de 400 foi para a seguinte.
    await payByHand(cardId, "600,00", "1000.00");
    expect(await carryOf(cardId)).toBe("400.00");
    await auto.autoImportStatement(ctx, accountId, [
      bill("400.00", before(0)),
      bill("150.00", domain.addDays(DUE, 3)),
    ]);
    const shown = await statementOf(cardId);
    const complement = shown!.suggestions.find((debit) => debit.amount === "400.00")!;
    // Três dias depois do vencimento, o outro débito aparece nesta fatura e na seguinte.
    const late = shown!.suggestions.find((debit) => debit.amount === "150.00")!;
    expect((await statementOf(cardId, NEXT))!.suggestions.map((debit) => debit.id)).toContain(
      late.id,
    );
    // Igual ao saldo levado: é o complemento, e não toma nada do marcado.
    await join(cardId, complement.id);
    expect(await carryOf(cardId)).toBeNull();
    const all = await entriesOf(accountId);
    expect(all.find((entry) => !entry.importFingerprint)).toMatchObject({ amount: "600.00" });
    expect((await statementOf(cardId))!.paid).toBe("1000.00");
  });
});

describe("fatura paga em partes pelo banco", () => {
  it("cada parte juntada diminui o saldo levado; desligar e apagar devolvem", async () => {
    const { accountId, cardId } = await bankWithCard("partes", "500.00");
    // A primeira parte, perto do vencimento, dá baixa sozinha e leva o resto para a seguinte.
    expect(
      await auto.autoImportStatement(ctx, accountId, [bill("200.00", before(2))]),
    ).toMatchObject({ settled: 1 });
    expect(await carryOf(cardId)).toBe("300.00");
    await auto.autoImportStatement(ctx, accountId, [
      bill("100.00", before(1)),
      bill("250.00", before(0)),
    ]);
    const shown = await statementOf(cardId);
    expect(shown!.main).toMatchObject({ amount: "200.00", fromBank: true });
    const small = shown!.suggestions.find((debit) => debit.amount === "100.00")!;
    const big = shown!.suggestions.find((debit) => debit.amount === "250.00")!;

    await join(cardId, small.id);
    expect(await carryOf(cardId)).toBe("200.00");
    await join(cardId, big.id);
    expect(await carryOf(cardId)).toBeNull();
    expect(summed(await entriesOf(accountId))).toBe("550.00");

    await splitStatementDebit(form({ id: big.id }));
    expect(await carryOf(cardId)).toBe("200.00");
    await deleteEntry(form({ id: small.id }));
    expect(await carryOf(cardId)).toBe("300.00");
    expect(await partsOf(cardId)).toHaveLength(0);
  });

  it("apagar o pagamento principal promove a parte mais antiga, e o saldo é refeito", async () => {
    const { accountId, cardId } = await bankWithCard("promove", "500.00");
    await auto.autoImportStatement(ctx, accountId, [bill("200.00", before(2))]);
    await auto.autoImportStatement(ctx, accountId, [bill("120.00", before(1))]);
    const [part] = (await statementOf(cardId))!.suggestions;
    await join(cardId, part!.id);
    expect(await carryOf(cardId)).toBe("180.00");
    const main = await paymentOf(cardId);

    await deleteEntry(form({ id: main!.transactionId }));
    expect((await paymentOf(cardId))!.transactionId).toBe(part!.id);
    expect(await partsOf(cardId)).toHaveLength(0);
    expect(await carryOf(cardId)).toBe("380.00");
  });

  it("desligar o pagamento que deu baixa reabre a fatura e tira o saldo", async () => {
    const { accountId, cardId } = await bankWithCard("reabre", "500.00");
    await auto.autoImportStatement(ctx, accountId, [bill("200.00", before(2))]);
    const main = await paymentOf(cardId);
    await splitStatementDebit(form({ id: main!.transactionId }));
    expect(await paymentOf(cardId)).toBeUndefined();
    expect(await carryOf(cardId)).toBeNull();
    const [entry] = await entriesOf(accountId);
    // Sem categoria de antes para devolver: vai para "Outras despesas", marcado para revisar.
    expect(entry).toMatchObject({ categoryId: other, categorySource: "revisar", amount: "200.00" });
    // A fatura volta a aparecer em aberto pelo total, e o débito volta a ser sugerido para ela.
    const month = await loadMonth(ctx, MONTH);
    expect(month.entries.find((item) => item.key === `f:${cardId}:${MONTH}`)?.amount).toBe(
      "500.00",
    );
    expect((await statementOf(cardId))!.suggestions.map((item) => item.id)).toEqual([entry!.id]);
  });
});

describe("adiantamento e fatura sem pagamento", () => {
  it("fatura fechada sem pagamento: o débito juntado vira o pagamento, e o resto vai para a seguinte", async () => {
    const { accountId, cardId } = await bankWithCard("adianta", "500.00");
    // Longe do vencimento: a importação não dá baixa sozinha.
    expect(
      await auto.autoImportStatement(ctx, accountId, [bill("120.00", before(16))]),
    ).toMatchObject({ settled: 0, imported: 1 });
    const [advance] = (await statementOf(cardId))!.suggestions;
    await join(cardId, advance!.id);
    expect((await paymentOf(cardId))!.transactionId).toBe(advance!.id);
    expect(await carryOf(cardId)).toBe("380.00");

    // O resto chega no vencimento: igual ao saldo levado, entra como pagamento a mais e zera o saldo.
    await auto.autoImportStatement(ctx, accountId, [bill("380.00", before(0))]);
    const [rest] = (await statementOf(cardId))!.suggestions;
    await join(cardId, rest!.id);
    expect(await carryOf(cardId)).toBeNull();
    expect(summed(await entriesOf(accountId))).toBe("500.00");
  });

  it("fatura que ainda não fechou não recebe débito, e o que não é sugerido não é ligado", async () => {
    const { accountId, cardId } = await bankWithCard("aberta", "500.00");
    // Compra de hoje: cai na fatura aberta.
    await inH((tx) =>
      tx.insert(cardPurchases).values({
        householdId: H.household,
        cardId,
        categoryId: market,
        description: "Hoje",
        amount: "90.00",
        installments: 1,
        purchasedOn: today,
      }),
    );
    // Antes do fechamento e longe do vencimento: a importação não dá baixa sozinha.
    const earlyDay = domain.addDays(domain.statementClosingDate(OPEN, TERMS), -3);
    await auto.autoImportStatement(ctx, accountId, [
      bill("90.00", earlyDay),
      bill("70.00", before(1), "SUPERMERCADO BOM PRECO"),
    ]);
    const all = await entriesOf(accountId);
    const early = all.find((entry) => entry.amount === "90.00")!;
    const groceries = all.find((entry) => entry.amount === "70.00")!;
    expect((await loadCardStatements(ctx))[`${cardId}:${OPEN}`]).toBeUndefined();
    const refused = await joinStatementDebit(
      idle,
      form({ cardId, month: OPEN, id: early.id, mode: "auto" }),
    );
    expect(refused.ok).toBe(false);
    // Mercado não parece pagamento de fatura nem tem o valor da fatura: não é sugerido nem ligado.
    expect((await statementOf(cardId))?.suggestions ?? []).toEqual([]);
    expect((await join(cardId, groceries.id)).ok).toBe(false);
    expect(await paymentOf(cardId)).toBeUndefined();
  });
});

describe("o que a revisão achou nas bordas", () => {
  it("depois que o banco toma o lugar do marcado, desligar uma parte refaz o saldo e ela volta a ser sugerida", async () => {
    const { accountId, cardId } = await bankWithCard("troca2", "1000.00");
    await payByHand(cardId, "1000,00", "1000.00");
    await auto.autoImportStatement(ctx, accountId, [
      bill("400.00", before(3)),
      bill("600.00", before(0)),
    ]);
    const first = (await statementOf(cardId))!.suggestions.find((d) => d.amount === "400.00")!;
    await join(cardId, first.id);
    const second = (await statementOf(cardId))!.suggestions.find((d) => d.amount === "600.00")!;
    // Cobre o que restava marcado: vira o pagamento, e o marcado à mão sai.
    await join(cardId, second.id);
    expect((await paymentOf(cardId))!.transactionId).toBe(second.id);
    expect((await partsOf(cardId)).map((part) => part.replacedAmount)).toEqual(["0.00"]);
    expect(summed(await entriesOf(accountId))).toBe("1000.00");

    await splitStatementDebit(form({ id: first.id }));
    expect(await carryOf(cardId)).toBe("400.00");
    expect((await statementOf(cardId))!.suggestions.map((d) => d.id)).toEqual([first.id]);
    // Juntar de novo zera o saldo.
    await join(cardId, first.id);
    expect(await carryOf(cardId)).toBeNull();
  });

  it("o saldo é refeito em cadeia nos dois sentidos, sem deixar dívida fantasma nem perder dívida", async () => {
    const { accountId, cardId } = await bankWithCard("cadeia", "500.00");
    // Mês do teste: o banco paga 200, e 300 vão para a seguinte.
    await auto.autoImportStatement(ctx, accountId, [bill("200.00", before(2))]);
    // Fatura seguinte: 200 de compras + 300 de saldo; a família marca 400, e 100 vão adiante.
    await buyIn(cardId, NEXT, "200.00");
    expect((await payByHand(cardId, "400,00", "500.00", NEXT)).ok).toBe(true);
    expect(await carriesOf(cardId)).toEqual({ [MM(MONTH)]: "300.00", [MM(NEXT)]: "100.00" });

    // Chega o resto do mês do teste: o saldo dele zera, e o da seguinte some (400 pagos para 200).
    await auto.autoImportStatement(ctx, accountId, [bill("300.00", before(0))]);
    const [rest] = (await statementOf(cardId))!.suggestions;
    await join(cardId, rest!.id);
    expect(await carriesOf(cardId)).toEqual({});
    // Desligar devolve os dois saldos.
    await splitStatementDebit(form({ id: rest!.id }));
    expect(await carriesOf(cardId)).toEqual({ [MM(MONTH)]: "300.00", [MM(NEXT)]: "100.00" });

    // Apagar o pagamento do mês do teste reabre a fatura: nenhum saldo sai dela, e o da seguinte é refeito.
    const main = await paymentOf(cardId);
    await deleteEntry(form({ id: main!.transactionId }));
    expect(await paymentOf(cardId)).toBeUndefined();
    expect(await carriesOf(cardId)).toEqual({});
  });

  it("pago poucos dias depois de um vencimento, o débito também é sugerido para a fatura seguinte", async () => {
    const { accountId, cardId } = await bankWithCard("atraso", "300.00");
    // O banco quita a fatura do teste inteira: nela não há mais o que acertar.
    await auto.autoImportStatement(ctx, accountId, [bill("300.00", before(0))]);
    await buyIn(cardId, NEXT, "250.00");
    // Adiantamento da seguinte, cinco dias depois do vencimento desta.
    await auto.autoImportStatement(ctx, accountId, [bill("250.00", domain.addDays(DUE, 5))]);
    expect((await statementOf(cardId))!.suggestions).toEqual([]);
    const [advance] = (await statementOf(cardId, NEXT))!.suggestions;
    expect(advance).toMatchObject({ amount: "250.00" });
    const joined = await joinStatementDebit(
      idle,
      form({ cardId, month: NEXT, id: advance!.id, mode: "auto" }),
    );
    expect(joined.ok).toBe(true);
    expect((await paymentOf(cardId, NEXT))!.transactionId).toBe(advance!.id);
    expect(await carriesOf(cardId)).toEqual({});
  });

  it("editar o valor de um pagamento refaz o saldo, para cima e para baixo", async () => {
    const { accountId, cardId } = await bankWithCard("edita", "500.00");
    await auto.autoImportStatement(ctx, accountId, [bill("200.00", before(2))]);
    const main = await paymentOf(cardId);
    const setAmount = (amount: string) =>
      db.withHousehold(ctx, async (tx) => {
        await tx
          .update(transactions)
          .set({ amount })
          .where(eq(transactions.id, main!.transactionId));
        await refreshStatementsOf(tx, ctx, main!.transactionId, true);
      });
    await setAmount("500.00");
    expect(await carryOf(cardId)).toBeNull();
    await setAmount("350.00");
    expect(await carryOf(cardId)).toBe("150.00");
    // Virou previsão: deixa de pagar a fatura, e o saldo sai.
    await db.withHousehold(ctx, async (tx) => {
      await tx
        .update(transactions)
        .set({ status: "previsto" })
        .where(eq(transactions.id, main!.transactionId));
      await refreshStatementsOf(tx, ctx, main!.transactionId, false);
    });
    expect(await paymentOf(cardId)).toBeUndefined();
    expect(await carryOf(cardId)).toBeNull();
  });

  it("débito antigo demais para voltar como sugestão não é desligado", async () => {
    const old = domain.addMonths(OPEN, -7);
    const { accountId, cardId } = await bankWithCard("antigo", "300.00", old);
    const due = domain.statementDueDate(old, TERMS);
    expect(await auto.autoImportStatement(ctx, accountId, [bill("300.00", due)])).toMatchObject({
      settled: 1,
    });
    const main = await paymentOf(cardId, old);
    expect((await statementOf(cardId, old))!.main).toMatchObject({ detachable: false });
    await splitStatementDebit(form({ id: main!.transactionId }));
    expect((await paymentOf(cardId, old))!.transactionId).toBe(main!.transactionId);
  });

  it("diminuir o valor de uma parte e corrigir de volta termina onde começou", async () => {
    const { accountId, cardId } = await bankWithCard("idavolta", "1000.00");
    await payByHand(cardId, "600,00", "1000.00");
    await auto.autoImportStatement(ctx, accountId, [bill("200.00", before(4))]);
    const [debit] = (await statementOf(cardId))!.suggestions;
    await join(cardId, debit!.id, "marcado");
    const setAmount = (amount: string) =>
      db.withHousehold(ctx, async (tx) => {
        await tx.update(transactions).set({ amount }).where(eq(transactions.id, debit!.id));
        await refreshStatementsOf(tx, ctx, debit!.id, true);
      });
    const marked = async () =>
      (await entriesOf(accountId)).find((entry) => !entry.importFingerprint)!.amount;
    await setAmount("20.00");
    expect(await marked()).toBe("580.00");
    await setAmount("200.00");
    expect(await marked()).toBe("400.00");
    expect((await partsOf(cardId))[0]!.replacedAmount).toBe("200.00");
    expect(await carryOf(cardId)).toBe("400.00");
  });
});
