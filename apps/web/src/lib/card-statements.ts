// Pagamento de fatura em mais de uma vez (ADR-0043). A fatura tem um pagamento principal
// (`card_statement_payments`) e, ligados a ela, os outros débitos que também a pagaram (`card_statement_parts`).
// Quem liga e desliga é a família, na tela de cartões; nada aqui roda sozinho. O "Saldo da fatura" que vai
// para a seguinte nunca é somado nem diminuído: é sempre refeito do total menos o que está ligado.
import "server-only";
import { incomeReceiptRows, systemCategories } from "@organizeup/agents";
import {
  and,
  bankConnectionAccounts,
  canWrite,
  cardPurchaseImports,
  cardPurchases,
  cardStatementParts,
  cardStatementPayments,
  categories,
  creditCards,
  debtInstallments,
  ensureCategory,
  eq,
  gte,
  householdTimezone,
  inArray,
  isNotNull,
  isNull,
  isSchemaLag,
  like,
  lockFamilyImport,
  transactions,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  addMonths,
  FALLBACK_CATEGORY,
  joinReplaces,
  linesTotal,
  looksLikeCardBill,
  LOOSE_STATEMENT_DAYS,
  money,
  purchaseLines,
  statementCarry,
  statementClosingDate,
  statementMonthOf,
  statementPaidOn,
  toDbAmount,
  todayIn,
  type JoinMode,
  type YearMonth,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { carryMark, goalEntryLink } from "@/lib/confirm-entry";

/** Quantos meses para trás a tela procura débito que parece pagamento de fatura, e deixa desligar. */
const SUGGESTION_MONTHS = 4;
/** Acima disto o débito não é pagamento desta fatura. */
const SUGGESTION_CEILING = "1.5";
/** Teto de voltas ao seguir o saldo de uma fatura para a seguinte. */
const CHAIN_LIMIT = 36;

type Card = typeof creditCards.$inferSelect;
type Entry = typeof transactions.$inferSelect;
type Part = typeof cardStatementParts.$inferSelect;

/** Sem a migração 0056, não há parte ligada a fatura nenhuma. */
async function allParts(tx: TenantTx): Promise<Part[]> {
  return tx
    .transaction((step) => step.select().from(cardStatementParts))
    .catch((error: unknown) => {
      if (isSchemaLag(error)) return [];
      throw error;
    });
}

/** A web nova pode rodar antes da migração da conexão: sem a tabela, só vale a conta que o cartão indica. */
async function bankLinks(tx: TenantTx) {
  return tx
    .transaction((step) =>
      step
        .select({
          itemId: bankConnectionAccounts.itemId,
          accountId: bankConnectionAccounts.accountId,
          cardId: bankConnectionAccounts.cardId,
        })
        .from(bankConnectionAccounts),
    )
    .catch((error: unknown) => {
      if (isSchemaLag(error)) return [];
      throw error;
    });
}

/** As contas de onde a fatura de um cartão pode sair: a que ele indica e as do mesmo banco dele. */
function payingAccounts(card: Card, links: Awaited<ReturnType<typeof bankLinks>>): Set<string> {
  const items = new Set(links.filter((link) => link.cardId === card.id).map((link) => link.itemId));
  return new Set([
    card.payingAccountId,
    ...links.flatMap((link) => (link.accountId && items.has(link.itemId) ? [link.accountId] : [])),
  ]);
}

const dayAfter = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Marcado à mão: não veio do banco. Em moeda estrangeira o valor marcado não é trocado. */
const byHand = (entry: Entry) =>
  !entry.importFingerprint && !entry.originalAmount && !entry.brlAmount;

/** O primeiro dia que a tela ainda olha. */
const windowStart = (today: string) =>
  `${addMonths(today.slice(0, 7) as YearMonth, -SUGGESTION_MONTHS)}-01`;

/** A compra "Saldo da fatura" que a fatura `month` levou para a seguinte, se houver. */
async function carryOf(tx: TenantTx, cardId: string, month: string) {
  const [marked] = await tx
    .transaction((step) =>
      step
        .select({ id: cardPurchaseImports.id })
        .from(cardPurchaseImports)
        .where(
          and(
            eq(cardPurchaseImports.cardId, cardId),
            eq(cardPurchaseImports.importFingerprint, carryMark(month)),
          ),
        ),
    )
    .catch((error: unknown) => {
      if (isSchemaLag(error)) return [];
      throw error;
    });
  if (!marked) return null;
  const [purchase] = await tx
    .select({ id: cardPurchases.id, amount: cardPurchases.amount })
    .from(cardPurchases)
    .where(eq(cardPurchases.id, marked.id));
  return purchase ?? null;
}

async function statementTotal(tx: TenantTx, card: Card, month: string): Promise<string> {
  const purchases = await tx.select().from(cardPurchases).where(eq(cardPurchases.cardId, card.id));
  return linesTotal(
    purchases
      .flatMap((purchase) => purchaseLines(purchase, card))
      .filter((line) => line.statementMonth === month),
  );
}

/** O pagamento principal de uma fatura e as partes ligadas a ela, com os lançamentos de cada um. */
async function statementLinks(tx: TenantTx, cardId: string, month: string) {
  const [payment] = await tx
    .select()
    .from(cardStatementPayments)
    .where(
      and(
        eq(cardStatementPayments.cardId, cardId),
        eq(cardStatementPayments.statementMonth, month),
      ),
    );
  const parts = (await allParts(tx)).filter(
    (part) => part.cardId === cardId && part.statementMonth === month,
  );
  const ids = [...(payment ? [payment.transactionId] : []), ...parts.map((p) => p.transactionId)];
  const entries =
    ids.length === 0
      ? []
      : await tx.select().from(transactions).where(inArray(transactions.id, ids));
  const entryOf = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    payment: payment ?? null,
    main: payment ? (entryOf.get(payment.transactionId) ?? null) : null,
    parts: parts.flatMap((part) => {
      const entry = entryOf.get(part.transactionId);
      return entry ? [{ part, entry }] : [];
    }),
  };
}

/**
 * Refaz o "Saldo da fatura" que a fatura `month` leva para a seguinte: total das compras menos o pagamento
 * principal e as partes ligadas; sem pagamento, nenhum saldo. Quando o saldo muda, a fatura seguinte ganhou ou
 * perdeu uma compra, e o saldo dela é refeito em seguida, até uma fatura em que nada muda. Rodar duas vezes dá
 * o mesmo resultado.
 *
 * `before` é o saldo que a fatura levava antes de quem chamou mexer nela (por exemplo, antes de
 * `removeStatementCarry` apagar a compra): é contra ele que se decide se a seguinte precisa ser refeita.
 */
export async function refreshCarry(
  tx: TenantTx,
  ctx: TenantContext,
  card: Card,
  month: string,
  before?: string,
): Promise<void> {
  const { card: categoryId } = await systemCategories(tx);
  if (!categoryId) return;
  let current = month;
  let previous = before;
  for (let turn = 0; turn < CHAIN_LIMIT; turn += 1) {
    const links = await statementLinks(tx, card.id, current);
    const carried = await carryOf(tx, card.id, current);
    const wanted = links.main
      ? statementCarry(await statementTotal(tx, card, current), [
          links.main.amount,
          ...links.parts.map(({ entry }) => entry.amount),
        ])
      : "0.00";
    const had = previous ?? carried?.amount ?? "0.00";
    previous = undefined;
    if (carried && money(wanted).gt(0)) {
      if (carried.amount !== wanted) {
        await tx
          .update(cardPurchases)
          .set({ amount: wanted })
          .where(eq(cardPurchases.id, carried.id));
      }
    } else if (carried) {
      await tx.delete(cardPurchases).where(eq(cardPurchases.id, carried.id));
    } else if (money(wanted).gt(0)) {
      // O dia seguinte ao fechamento já é da fatura seguinte; em mês curto, anda mais um pouco.
      const next = addMonths(current as YearMonth, 1);
      let carryOn = dayAfter(statementClosingDate(current as YearMonth, card));
      for (let tries = 0; tries < 5 && statementMonthOf(carryOn, card) !== next; tries += 1) {
        carryOn = dayAfter(carryOn);
      }
      const [year, monthNumber] = current.split("-");
      const [created] = await tx
        .insert(cardPurchases)
        .values({
          householdId: ctx.householdId,
          cardId: card.id,
          categoryId,
          description: `Saldo da fatura de ${monthNumber}/${year}`,
          amount: wanted,
          installments: 1,
          purchasedOn: carryOn,
          createdBy: ctx.userId,
        })
        .returning({ id: cardPurchases.id });
      await tx
        .update(cardPurchaseImports)
        .set({ importFingerprint: carryMark(current) })
        .where(eq(cardPurchaseImports.id, created!.id));
    }
    // A fatura seguinte só muda se o que esta leva para ela mudou.
    if (money(wanted).eq(had)) return;
    current = addMonths(current as YearMonth, 1);
  }
}

/**
 * O que os débitos tinham tomado do pagamento marcado à mão só vale enquanto esse pagamento existe. Quando o
 * pagamento principal passa a ser um débito do banco, as partes viram pagamento a mais, sem nada a devolver.
 */
async function forgetReplaced(tx: TenantTx, cardId: string, month: string) {
  await tx
    .transaction((step) =>
      step
        .update(cardStatementParts)
        .set({ replacedAmount: "0.00" })
        .where(
          and(eq(cardStatementParts.cardId, cardId), eq(cardStatementParts.statementMonth, month)),
        ),
    )
    .catch((error: unknown) => {
      if (!isSchemaLag(error)) throw error;
    });
}

/** Sem pagamento principal e com partes ligadas, a parte mais antiga passa a ser o pagamento da fatura. */
async function promotePart(tx: TenantTx, ctx: TenantContext, cardId: string, month: string) {
  const links = await statementLinks(tx, cardId, month);
  if (links.payment || links.parts.length === 0) return;
  const [oldest] = [...links.parts].sort(
    (a, b) =>
      a.entry.occurredOn.localeCompare(b.entry.occurredOn) ||
      a.part.createdAt.getTime() - b.part.createdAt.getTime(),
  );
  await tx.delete(cardStatementParts).where(eq(cardStatementParts.id, oldest!.part.id));
  await tx.insert(cardStatementPayments).values({
    householdId: ctx.householdId,
    cardId,
    statementMonth: month,
    transactionId: oldest!.entry.id,
  });
  await forgetReplaced(tx, cardId, month);
}

/**
 * Devolve a um lançamento desligado a categoria que ele tinha, como escolha da família. Sem categoria conhecida,
 * vai para "Outras despesas" marcado para revisar, e o agente de categorias cuida dele.
 */
async function restoreCategory(
  tx: TenantTx,
  ctx: TenantContext,
  entryId: string,
  previous: string | null,
) {
  const { card: cardCategory } = await systemCategories(tx);
  // Quem já tirou o lançamento da categoria do cartão escolheu outra: fica a escolha.
  const [current] = await tx
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .where(eq(transactions.id, entryId));
  if (!current || current.categoryId !== cardCategory) return;
  const [known] = previous
    ? await tx
        .select({ id: categories.id, kind: categories.kind, archived: categories.archived })
        .from(categories)
        .where(eq(categories.id, previous))
    : [];
  const kept = known && known.kind === "despesa" && !known.archived && known.id !== cardCategory;
  const categoryId = kept
    ? known.id
    : (await ensureCategory(tx, ctx.householdId, "despesa", FALLBACK_CATEGORY.despesa, false)).id;
  await tx
    .update(transactions)
    .set({ categoryId, categorySource: kept ? "familia" : "revisar", updatedAt: new Date() })
    .where(eq(transactions.id, entryId));
}

/**
 * Lançamentos que já têm dono (pagamento de fatura, parte de fatura, renda recebida, parcela de dívida): não
 * podem ser ligados a uma fatura.
 */
async function tiedEntries(tx: TenantTx): Promise<Set<string>> {
  const installments = await tx
    .select({ id: debtInstallments.transactionId })
    .from(debtInstallments)
    .where(isNotNull(debtInstallments.transactionId));
  return new Set([
    ...(
      await tx.select({ id: cardStatementPayments.transactionId }).from(cardStatementPayments)
    ).map((row) => row.id),
    ...(await allParts(tx)).map((part) => part.transactionId),
    ...(await incomeReceiptRows(tx)).map((row) => row.transactionId),
    ...installments.flatMap((row) => (row.id ? [row.id] : [])),
  ]);
}

export interface StatementDebit {
  id: string;
  date: string;
  description: string;
  amount: string;
  accountId: string;
}

/** Débito ligado à fatura. */
export type LinkedDebit = StatementDebit & {
  /** Veio do banco (tem como voltar a ser despesa comum). */
  fromBank: boolean;
  /** Recente o bastante para, desligado, voltar a ser sugerido. */
  detachable: boolean;
};

export interface StatementPayments {
  /** O pagamento principal. */
  main: (LinkedDebit & { byHand: boolean }) | null;
  /** Os outros débitos ligados à fatura. */
  parts: LinkedDebit[];
  /** Tudo o que foi pago por esta fatura. */
  paid: string;
  /** Débitos do banco que parecem pagamento desta fatura e ainda não estão ligados a nada. */
  suggestions: StatementDebit[];
}

const debitOf = (entry: Entry): StatementDebit => ({
  id: entry.id,
  date: entry.occurredOn,
  description: entry.description,
  amount: entry.amount,
  accountId: entry.accountId,
});

const linkedOf = (entry: Entry, since: string): LinkedDebit => ({
  ...debitOf(entry),
  fromBank: Boolean(entry.importFingerprint),
  detachable: Boolean(entry.importFingerprint) && entry.occurredOn >= since,
});

/**
 * O que entra numa fatura sem pagamento, pela regra da tela: a fatura já fechou. Antes disso ainda chegam
 * compras, e marcar como paga travaria o mês.
 */
const canTakeFirstPayment = (card: Card, month: string, today: string) =>
  today > statementClosingDate(month as YearMonth, card);

/**
 * Os pagamentos de cada fatura e as sugestões, para a tela de cartões. Chave: `<cartão>:<mês>`. Só leitura.
 * Sugere o débito do banco, numa conta que paga o cartão, que caiu no ciclo da fatura, ainda não tem dono e
 * parece pagamento de fatura pelo texto ou pelo valor (igual ao que falta). Só para fatura que tem o que
 * acertar: marcada à mão, com saldo levado, ou fechada sem pagamento. Pago até dez dias depois de um
 * vencimento, o débito pode ser da fatura que venceu ou adiantamento da seguinte: aparece nas duas.
 */
export async function loadStatementPayments(
  tx: TenantTx,
  today: string,
): Promise<Record<string, StatementPayments>> {
  const cards = await tx.select().from(creditCards);
  if (cards.length === 0) return {};
  const system = await systemCategories(tx);
  const since = windowStart(today);
  const payments = await tx.select().from(cardStatementPayments);
  const parts = await allParts(tx);
  const linkedIds = [...payments.map((p) => p.transactionId), ...parts.map((p) => p.transactionId)];
  const linked =
    linkedIds.length === 0
      ? []
      : await tx.select().from(transactions).where(inArray(transactions.id, linkedIds));
  const entryOf = new Map(linked.map((entry) => [entry.id, entry]));
  const out: Record<string, StatementPayments> = {};
  const slot = (cardId: string, month: string) =>
    (out[`${cardId}:${month}`] ??= { main: null, parts: [], paid: "0.00", suggestions: [] });
  for (const payment of payments) {
    const entry = entryOf.get(payment.transactionId);
    if (!entry) continue;
    slot(payment.cardId, payment.statementMonth).main = {
      ...linkedOf(entry, since),
      byHand: byHand(entry),
    };
  }
  for (const part of parts) {
    const entry = entryOf.get(part.transactionId);
    if (entry) slot(part.cardId, part.statementMonth).parts.push(linkedOf(entry, since));
  }
  for (const statement of Object.values(out)) {
    statement.parts.sort((a, b) => a.date.localeCompare(b.date));
    statement.paid = toDbAmount(
      [...(statement.main ? [statement.main] : []), ...statement.parts].reduce(
        (acc, debit) => acc.plus(debit.amount),
        money(0),
      ),
    );
  }

  // Sugestões: só olha o que veio do banco nos últimos meses e ainda está como despesa comum.
  const loose = await tx
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.kind, "despesa"),
        eq(transactions.status, "realizado"),
        isNotNull(transactions.importFingerprint),
        isNull(transactions.planId),
        isNull(transactions.originalAmount),
        isNull(transactions.brlAmount),
        gte(transactions.occurredOn, since),
      ),
    );
  if (loose.length === 0) return out;
  const tied = await tiedEntries(tx);
  // Cartão, dívida, meta e aporte têm regra própria: lançamento nessas categorias não é despesa comum.
  const reserved = new Set(
    [system.card, system.debt, system.goal, system.contribution].filter(Boolean),
  );
  const links = await bankLinks(tx);
  const purchases = await tx.select().from(cardPurchases);
  const carries = await tx
    .transaction((step) =>
      step
        .select({
          id: cardPurchaseImports.id,
          cardId: cardPurchaseImports.cardId,
          mark: cardPurchaseImports.importFingerprint,
        })
        .from(cardPurchaseImports)
        .where(like(cardPurchaseImports.importFingerprint, "saldo:%")),
    )
    .catch((error: unknown) => {
      if (isSchemaLag(error)) return [];
      throw error;
    });
  const amountOf = new Map(purchases.map((purchase) => [purchase.id, purchase.amount]));
  for (const card of cards) {
    if (card.archived) continue;
    const accounts = payingAccounts(card, links);
    const lines = purchases
      .filter((purchase) => purchase.cardId === card.id)
      .flatMap((purchase) => purchaseLines(purchase, card));
    for (const entry of loose) {
      if (tied.has(entry.id) || reserved.has(entry.categoryId)) continue;
      if (!accounts.has(entry.accountId)) continue;
      const months = new Set([
        statementPaidOn(entry.occurredOn, card, LOOSE_STATEMENT_DAYS),
        statementPaidOn(entry.occurredOn, card, 0),
        // Pago entre o fechamento e o vencimento de uma fatura, pode ser adiantamento da que está aberta.
        statementMonthOf(entry.occurredOn, card),
      ]);
      for (const month of months) {
        const total = linesTotal(lines.filter((line) => line.statementMonth === month));
        if (!money(total).gt(0)) continue;
        const statement = out[`${card.id}:${month}`];
        const carry =
          amountOf.get(
            carries.find((row) => row.cardId === card.id && row.mark === carryMark(month))?.id ??
              "",
          ) ?? "0.00";
        // O que ainda dá para acertar nesta fatura: o saldo que ela levou adiante e o que foi marcado à mão;
        // sem pagamento, a fatura inteira, desde que já tenha fechado. Sem nada a acertar, nada é sugerido.
        const pending = statement?.main
          ? [
              ...(money(carry).gt(0) ? [carry] : []),
              ...(statement.main.byHand ? [statement.main.amount] : []),
            ]
          : canTakeFirstPayment(card, month, today)
            ? [total]
            : [];
        if (pending.length === 0) continue;
        const ceiling = pending
          .reduce((acc, value) => acc.plus(value), money(0))
          .times(SUGGESTION_CEILING);
        if (money(entry.amount).gt(ceiling)) continue;
        const exact = pending.some((value) => money(entry.amount).eq(value));
        if (!exact && !looksLikeCardBill(entry.description)) continue;
        slot(card.id, month).suggestions.push(debitOf(entry));
      }
    }
  }
  for (const statement of Object.values(out)) {
    statement.suggestions.sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

/** Para a tela de cartões: pagamentos e sugestões de cada fatura, pela chave `<cartão>:<mês>`. */
export async function loadCardStatements(ctx: TenantContext) {
  return withHousehold(ctx, async (tx) =>
    loadStatementPayments(tx, todayIn(await householdTimezone(tx, ctx.householdId))),
  );
}

export type JoinFailure =
  "sem_permissao" | "fatura_invalida" | "nao_sugerido" | "fatura_aberta" | "indisponivel";

/**
 * Junta um débito do banco à fatura. Só vale para o que a tela sugere: a conferência é refeita aqui.
 * - Fatura fechada e sem pagamento: o débito passa a ser o pagamento dela; pago a menos, o resto vai para a
 *   seguinte, como em qualquer pagamento em parte.
 * - Fatura com pagamento: o débito entra como mais uma parte. Se o pagamento foi marcado à mão, o débito toma
 *   o lugar do que foi marcado (ver `joinReplaces`); quando cobre tudo, vira o pagamento, e o marcado sai.
 */
export async function attachStatementDebit(
  ctx: TenantContext,
  input: { cardId: string; month: string; transactionId: string; mode: JoinMode },
): Promise<{ ok: true } | { ok: false; code: JoinFailure }> {
  if (!canWrite(ctx)) return { ok: false, code: "sem_permissao" };
  return withHousehold(ctx, async (tx) => {
    await lockFamilyImport(tx, ctx.householdId);
    const { card: cardCategory } = await systemCategories(tx);
    const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, input.cardId));
    if (!card || !cardCategory) return { ok: false, code: "fatura_invalida" } as const;
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const known = (await loadStatementPayments(tx, today))[`${card.id}:${input.month}`];
    if (!known?.suggestions.some((debit) => debit.id === input.transactionId)) {
      return { ok: false, code: "nao_sugerido" } as const;
    }
    const [entry] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, input.transactionId));
    // Parcela de meta baixada pelo extrato leva junto o guardado da meta: não entra em fatura.
    if (!entry || (await goalEntryLink(tx, entry.id))) {
      return { ok: false, code: "nao_sugerido" } as const;
    }
    const links = await statementLinks(tx, card.id, input.month);
    const asPayment = { categoryId: cardCategory, categorySource: null, updatedAt: new Date() };

    if (!links.payment || !links.main) {
      if (!canTakeFirstPayment(card, input.month, today)) {
        return { ok: false, code: "fatura_aberta" } as const;
      }
      await tx.insert(cardStatementPayments).values({
        householdId: ctx.householdId,
        cardId: card.id,
        statementMonth: input.month,
        transactionId: entry.id,
      });
      await tx.update(transactions).set(asPayment).where(eq(transactions.id, entry.id));
      await audit(tx, ctx, "confirm", "card_statement_payments", card.id);
      await refreshCarry(tx, ctx, card, input.month);
      return { ok: true } as const;
    }

    const carried = await carryOf(tx, card.id, input.month);
    const replaced = joinReplaces({
      amount: entry.amount,
      mainAmount: links.main.amount,
      mainByHand: byHand(links.main),
      carry: carried?.amount ?? "0.00",
      mode: input.mode,
    });
    if (byHand(links.main) && money(replaced).gte(links.main.amount)) {
      // O banco cobriu tudo o que estava marcado à mão: o débito passa a ser o pagamento, e o marcado sai.
      await tx
        .update(cardStatementPayments)
        .set({ transactionId: entry.id })
        .where(eq(cardStatementPayments.id, links.payment.id));
      await tx.delete(transactions).where(eq(transactions.id, links.main.id));
      await audit(tx, ctx, "delete", "transactions", links.main.id);
      await forgetReplaced(tx, card.id, input.month);
    } else {
      const inserted = await tx
        .transaction((step) =>
          step
            .insert(cardStatementParts)
            .values({
              householdId: ctx.householdId,
              cardId: card.id,
              statementMonth: input.month,
              transactionId: entry.id,
              replacedAmount: replaced,
              previousCategoryId: entry.categoryId,
              createdBy: ctx.userId,
            })
            .returning({ id: cardStatementParts.id }),
        )
        .catch((error: unknown) => {
          if (isSchemaLag(error)) return null;
          throw error;
        });
      if (!inserted) return { ok: false, code: "indisponivel" } as const;
      if (money(replaced).gt(0)) {
        await tx
          .update(transactions)
          .set({
            amount: toDbAmount(money(links.main.amount).minus(replaced)),
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, links.main.id));
        await audit(tx, ctx, "update", "transactions", links.main.id);
      }
    }
    await tx.update(transactions).set(asPayment).where(eq(transactions.id, entry.id));
    await audit(tx, ctx, "update", "transactions", entry.id);
    // Juntar só aumenta o que foi pago: diminui o saldo levado, quando há. Fatura sem saldo gravado não ganha
    // saldo por aqui, e quem a marcou como paga inteira continua com ela paga.
    if (carried) await refreshCarry(tx, ctx, card, input.month);
    return { ok: true } as const;
  });
}

export type SplitFailure = "sem_permissao" | "nao_ligado" | "marcado_a_mao" | "antigo";

/**
 * Tira a ligação de um lançamento com a fatura, sem apagar o lançamento. O que ele tinha tomado do pagamento
 * marcado à mão volta para lá. Se era o pagamento principal, a parte mais antiga toma o lugar dele; sem parte
 * nenhuma, a fatura reabre. O saldo levado é refeito quando o que foi pago mudou. Devolve o que estava ligado.
 */
async function unlinkEntry(tx: TenantTx, ctx: TenantContext, entry: Entry) {
  const part = (await allParts(tx)).find((row) => row.transactionId === entry.id);
  if (part) {
    const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, part.cardId));
    const links = await statementLinks(tx, part.cardId, part.statementMonth);
    const giveBack =
      money(part.replacedAmount).gt(0) && links.main && byHand(links.main)
        ? part.replacedAmount
        : "0.00";
    if (money(giveBack).gt(0) && links.main) {
      await tx
        .update(transactions)
        .set({ amount: toDbAmount(money(links.main.amount).plus(giveBack)), updatedAt: new Date() })
        .where(eq(transactions.id, links.main.id));
      await audit(tx, ctx, "update", "transactions", links.main.id);
    }
    await tx.delete(cardStatementParts).where(eq(cardStatementParts.id, part.id));
    // O que este débito pagava além do que tomou do marcado deixa de estar pago: o saldo levado acompanha.
    if (card && money(entry.amount).gt(giveBack)) {
      await refreshCarry(tx, ctx, card, part.statementMonth);
    }
    return { previousCategoryId: part.previousCategoryId };
  }
  const [payment] = await tx
    .select()
    .from(cardStatementPayments)
    .where(eq(cardStatementPayments.transactionId, entry.id));
  if (!payment) return null;
  const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, payment.cardId));
  const before = (await carryOf(tx, payment.cardId, payment.statementMonth))?.amount ?? "0.00";
  await tx.delete(cardStatementPayments).where(eq(cardStatementPayments.id, payment.id));
  await promotePart(tx, ctx, payment.cardId, payment.statementMonth);
  if (card) await refreshCarry(tx, ctx, card, payment.statementMonth, before);
  return { previousCategoryId: null };
}

/**
 * Desliga um débito do banco da fatura: ele volta a ser uma despesa comum, com a categoria de antes. Só para
 * débito recente: desligado, ele volta a aparecer como sugestão, e mais antigo que isso não apareceria.
 */
export async function detachStatementDebit(
  ctx: TenantContext,
  transactionId: string,
): Promise<{ ok: true } | { ok: false; code: SplitFailure }> {
  if (!canWrite(ctx)) return { ok: false, code: "sem_permissao" };
  return withHousehold(ctx, async (tx) => {
    await lockFamilyImport(tx, ctx.householdId);
    const [entry] = await tx.select().from(transactions).where(eq(transactions.id, transactionId));
    if (!entry) return { ok: false, code: "nao_ligado" } as const;
    // Pagamento marcado à mão não tem débito do banco para devolver: apaga-se o lançamento.
    if (!entry.importFingerprint) return { ok: false, code: "marcado_a_mao" } as const;
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    if (entry.occurredOn < windowStart(today)) return { ok: false, code: "antigo" } as const;
    const unlinked = await unlinkEntry(tx, ctx, entry);
    if (!unlinked) return { ok: false, code: "nao_ligado" } as const;
    await restoreCategory(tx, ctx, entry.id, unlinked.previousCategoryId);
    await audit(tx, ctx, "update", "transactions", entry.id);
    return { ok: true } as const;
  });
}

/**
 * Chame ANTES de apagar lançamentos (apagar, desfazer importação), com a trava da família já na primeira linha.
 * O que um débito ligado tinha tomado do pagamento marcado à mão volta para ele. `staying` são lançamentos do
 * mesmo gesto que não serão apagados, mas deixam de valer como pagamento (voltam a ser previsão): são
 * desligados aqui. Devolve o que rodar DEPOIS de apagar: fatura que perdeu o pagamento principal e ainda tem
 * partes ganha a mais antiga como pagamento, e o saldo levado é refeito, em cadeia.
 */
export async function releaseStatementLinks(
  tx: TenantTx,
  ctx: TenantContext,
  transactionIds: string[],
  staying: string[] = [],
): Promise<() => Promise<void>> {
  const nothing = async () => {};
  if (transactionIds.length === 0 && staying.length === 0) return nothing;
  await lockFamilyImport(tx, ctx.householdId);

  for (const id of staying) {
    const [entry] = await tx.select().from(transactions).where(eq(transactions.id, id));
    if (!entry) continue;
    const unlinked = await unlinkEntry(tx, ctx, entry);
    if (unlinked) await restoreCategory(tx, ctx, entry.id, unlinked.previousCategoryId);
  }
  if (transactionIds.length === 0) return nothing;

  const going = new Set(transactionIds);
  const parts = (await allParts(tx)).filter((part) => going.has(part.transactionId));
  const payments = await tx
    .select()
    .from(cardStatementPayments)
    .where(inArray(cardStatementPayments.transactionId, transactionIds));
  if (parts.length === 0 && payments.length === 0) return nothing;

  const amounts = new Map(
    (parts.length === 0
      ? []
      : await tx
          .select({ id: transactions.id, amount: transactions.amount })
          .from(transactions)
          .where(
            inArray(
              transactions.id,
              parts.map((part) => part.transactionId),
            ),
          )
    ).map((row) => [row.id, row.amount]),
  );
  // Fatura cujo saldo precisa ser refeito depois, com o saldo que ela levava antes de qualquer mudança.
  const touched = new Map<string, { cardId: string; month: string; before: string }>();
  const touch = async (row: { cardId: string; statementMonth: string }) => {
    const key = `${row.cardId}:${row.statementMonth}`;
    if (touched.has(key)) return;
    touched.set(key, {
      cardId: row.cardId,
      month: row.statementMonth,
      before: (await carryOf(tx, row.cardId, row.statementMonth))?.amount ?? "0.00",
    });
  };
  for (const payment of payments) await touch(payment);
  for (const part of parts) {
    const links = await statementLinks(tx, part.cardId, part.statementMonth);
    const giveBack =
      money(part.replacedAmount).gt(0) &&
      links.main &&
      !going.has(links.main.id) &&
      byHand(links.main)
        ? part.replacedAmount
        : "0.00";
    if (money(giveBack).gt(0) && links.main) {
      await tx
        .update(transactions)
        .set({ amount: toDbAmount(money(links.main.amount).plus(giveBack)), updatedAt: new Date() })
        .where(eq(transactions.id, links.main.id));
      await audit(tx, ctx, "update", "transactions", links.main.id);
    }
    // O que a parte pagava além do que tomou do marcado deixa de estar pago.
    if (money(amounts.get(part.transactionId) ?? "0").gt(giveBack)) await touch(part);
  }
  return async () => {
    for (const { cardId, month, before } of touched.values()) {
      const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, cardId));
      if (!card) continue;
      await promotePart(tx, ctx, cardId, month);
      await refreshCarry(tx, ctx, card, month, before);
    }
  };
}

/** A fatura a que um lançamento está ligado, como pagamento principal ou como parte. */
async function linkOf(tx: TenantTx, transactionId: string) {
  const part = (await allParts(tx)).find((row) => row.transactionId === transactionId);
  if (part) return { cardId: part.cardId, month: part.statementMonth, part };
  const [payment] = await tx
    .select()
    .from(cardStatementPayments)
    .where(eq(cardStatementPayments.transactionId, transactionId));
  return payment ? { cardId: payment.cardId, month: payment.statementMonth, part: null } : null;
}

/**
 * Chame ANTES de gravar a edição de um lançamento: se ele paga uma fatura, a trava da família vem antes da
 * linha do lançamento, na mesma ordem de Juntar e Desligar. Devolve se o lançamento está ligado.
 */
export async function lockStatementEntry(
  tx: TenantTx,
  ctx: TenantContext,
  transactionId: string,
): Promise<boolean> {
  // A trava vem antes da leitura: quem está juntando este mesmo lançamento termina primeiro.
  await lockFamilyImport(tx, ctx.householdId);
  return Boolean(await linkOf(tx, transactionId));
}

/**
 * Chame DEPOIS de gravar a edição de um lançamento ligado a uma fatura (com `lockStatementEntry` antes).
 * Deixou de ser despesa realizada: não paga mais a fatura, e a ligação sai. Mudou de valor: a parte não pode
 * ter tomado do marcado à mão mais do que vale, e o saldo levado é refeito.
 */
export async function refreshStatementsOf(
  tx: TenantTx,
  ctx: TenantContext,
  transactionId: string,
  moneyChanged: boolean,
): Promise<void> {
  const link = await linkOf(tx, transactionId);
  if (!link) return;
  const [entry] = await tx.select().from(transactions).where(eq(transactions.id, transactionId));
  const [card] = await tx.select().from(creditCards).where(eq(creditCards.id, link.cardId));
  if (!entry || !card) return;
  if (entry.status !== "realizado" || entry.kind !== "despesa") {
    const unlinked = await unlinkEntry(tx, ctx, entry);
    if (unlinked) await restoreCategory(tx, ctx, entry.id, unlinked.previousCategoryId);
    return;
  }
  // Só descrição, categoria ou conta: o que foi pago não mudou, e a fatura fica como está.
  if (!moneyChanged) return;
  if (link.part && money(link.part.replacedAmount).gt(0)) {
    // A parte que tomou o lugar do marcado à mão toma de novo, pelo valor de agora: diminuir e corrigir de
    // volta termina onde começou. Nunca toma tudo: o marcado só sai pelo Juntar.
    const links = await statementLinks(tx, link.cardId, link.month);
    if (links.main && byHand(links.main)) {
      const base = money(links.main.amount).plus(link.part.replacedAmount);
      const taken = money(entry.amount).lt(base)
        ? money(entry.amount)
        : money(link.part.replacedAmount);
      if (!taken.eq(link.part.replacedAmount)) {
        await tx
          .update(transactions)
          .set({ amount: toDbAmount(base.minus(taken)), updatedAt: new Date() })
          .where(eq(transactions.id, links.main.id));
        await audit(tx, ctx, "update", "transactions", links.main.id);
        await tx
          .update(cardStatementParts)
          .set({ replacedAmount: toDbAmount(taken) })
          .where(eq(cardStatementParts.id, link.part.id));
      }
    }
  }
  await refreshCarry(tx, ctx, card, link.month);
}
