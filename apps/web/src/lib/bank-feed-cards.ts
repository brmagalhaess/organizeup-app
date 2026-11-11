// Compras de cartão pela conexão com bancos (ADR-0038). Como no extrato, nada entra sozinho: a busca devolve
// as linhas já comparadas com o que o cartão tem e com a categoria proposta, e só a conferência grava.
import "server-only";
import {
  canWrite,
  cardPurchaseImports,
  cardPurchases,
  cardStatementPayments,
  categories,
  categoryMemory,
  creditCards,
  desc,
  ensureCategory,
  eq,
  householdTimezone,
  markCardPurchase,
  readFamilyAccess,
  takeEntries,
  transactions,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  CARD_CATEGORY,
  categorizeRow,
  feedCardPurchasesOf,
  feedWindowStart,
  memoryKey,
  merchantKey,
  normalizeDescription,
  purchaseLines,
  todayIn,
  withFingerprints,
  type CategoryProposal,
  type ReconciledRow,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { failure, noteResult, ownLink, sessionKey, type Failed } from "@/lib/bank-feed";
import { pluggyTransactions, type PluggyOptions } from "@/lib/pluggy";

/** Linha da conferência: a mesma do extrato, com as parcelas que a compra ainda tem. */
export type PreparedCardRow = ReconciledRow & CategoryProposal & { installments: number };

export interface CardFeed {
  ok: true;
  linkId: string;
  cardId: string;
  rows: PreparedCardRow[];
  pending: number;
  credits: number;
  truncated: boolean;
  from: string;
  to: string;
}

/** O que a conferência precisa para propor a categoria de cada compra: o mesmo do extrato. */
async function categoryContext(tx: TenantTx) {
  const rows = await tx
    .select({
      id: categories.id,
      name: categories.name,
      kind: categories.kind,
      archived: categories.archived,
    })
    .from(categories);
  const usable = rows.filter((row) => !row.archived && row.name !== CARD_CATEGORY);
  const recent = await tx
    .select({
      kind: transactions.kind,
      description: transactions.description,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .orderBy(desc(transactions.occurredOn))
    .limit(1000);
  const history = new Map<string, string>();
  for (const row of recent) {
    const key = memoryKey(row.kind, merchantKey(row.description));
    if (!history.has(key)) history.set(key, row.categoryId);
  }
  const remembered = await tx.select().from(categoryMemory);
  const learned = new Map(
    remembered.map((row) => [memoryKey(row.kind, row.merchant), row.categoryId]),
  );
  return { usable, history, learned };
}

const knownFingerprints = async (tx: TenantTx, cardId: string) =>
  new Set(
    (
      await tx
        .select({ fingerprint: cardPurchaseImports.importFingerprint })
        .from(cardPurchaseImports)
        .where(eq(cardPurchaseImports.cardId, cardId))
    ).flatMap((row) => (row.fingerprint ? [row.fingerprint] : [])),
  );

/** Compras de um cartão ligado, prontas para a conferência. Não grava nada. */
export async function prepareCardFeed(
  ctx: TenantContext,
  linkId: string,
  askedFrom: string | null,
  options: PluggyOptions = {},
): Promise<CardFeed | Failed> {
  const userId = ctx.userId;
  if (!userId || !canWrite(ctx)) return { ok: false, code: "sem_permissao" };
  const found = await withHousehold(ctx, async (tx) => {
    const own = await ownLink(tx, userId, linkId);
    return own ? { ...own, timezone: await householdTimezone(tx, ctx.householdId) } : null;
  });
  if (!found) return { ok: false, code: "sem_conexao" };
  const { connection, link, timezone } = found;
  if (link.kind !== "cartao") return { ok: false, code: "nao_e_cartao" };
  if (!link.cardId) return { ok: false, code: "cartao_invalido" };
  const cardId = link.cardId;

  const to = todayIn(timezone);
  const from = feedWindowStart(to, link.syncedOn, askedFrom);
  const apiKey = await sessionKey(ctx, userId, connection, options);
  const fetched =
    typeof apiKey === "string"
      ? await pluggyTransactions(apiKey, link.externalId, { from, to }, options).catch(failure)
      : apiKey;
  if (!Array.isArray(fetched)) {
    await noteResult(ctx, connection.id, fetched.code);
    return fetched;
  }
  await noteResult(ctx, connection.id, null);
  const statement = feedCardPurchasesOf(fetched, timezone);
  const installments = new Map(statement.rows.map((row) => [row.externalId, row.installments]));

  const rows = await withHousehold(ctx, async (tx) => {
    const known = await knownFingerprints(tx, cardId);
    const context = await categoryContext(tx);
    return withFingerprints(statement.rows, "ofx").map((row): PreparedCardRow => {
      const state = known.has(row.fingerprint) ? "importado" : "novo";
      return {
        ...row,
        state,
        match: null,
        installments: installments.get(row.externalId) ?? 1,
        ...categorizeRow(row, context.usable, context),
      };
    });
  });
  return {
    ok: true,
    linkId: link.id,
    cardId,
    rows,
    pending: statement.pending,
    credits: statement.credits,
    truncated: statement.truncated,
    from,
    to,
  };
}

export interface CardCommitRow {
  date: string;
  description: string;
  amount: string;
  installments: number;
  fingerprint: string;
  categoryId: string | null;
  newCategory: { name: string; essential: boolean } | null;
}

export interface CardCommit {
  ok: true;
  imported: number;
  /** Já estavam no cartão. */
  repeated: number;
  /** Cairiam numa fatura já paga: o OrganizeUp não mexe em fatura fechada. */
  blocked: number;
}

/** Grava as compras escolhidas na conferência. Reenviar as mesmas linhas não duplica. */
export async function commitCardFeed(
  ctx: TenantContext,
  linkId: string,
  rows: CardCommitRow[],
): Promise<CardCommit | Failed> {
  const userId = ctx.userId;
  if (!userId || !canWrite(ctx)) return { ok: false, code: "sem_permissao" };
  const access = await readFamilyAccess(ctx);
  return withHousehold(ctx, async (tx): Promise<CardCommit | Failed> => {
    const found = await ownLink(tx, userId, linkId);
    if (!found) return { ok: false, code: "sem_conexao" };
    if (found.link.kind !== "cartao") return { ok: false, code: "nao_e_cartao" };
    const [card] = found.link.cardId
      ? await tx.select().from(creditCards).where(eq(creditCards.id, found.link.cardId))
      : [];
    if (!card) return { ok: false, code: "cartao_invalido" };

    const known = await knownFingerprints(tx, card.id);
    const paid = new Set(
      (
        await tx
          .select({ month: cardStatementPayments.statementMonth })
          .from(cardStatementPayments)
          .where(eq(cardStatementPayments.cardId, card.id))
      ).map((row) => row.month),
    );
    const categoryRows = await tx
      .select({ id: categories.id, name: categories.name, kind: categories.kind })
      .from(categories);
    const expense = new Map(
      categoryRows
        .filter((row) => row.kind === "despesa")
        .map((row) => [normalizeDescription(row.name), row.id]),
    );
    const expenseIds = new Set(expense.values());

    let repeated = 0;
    let blocked = 0;
    const fresh: Array<CardCommitRow & { categoryId: string }> = [];
    for (const row of rows) {
      if (known.has(row.fingerprint)) {
        repeated += 1;
        continue;
      }
      known.add(row.fingerprint);
      let categoryId = row.categoryId;
      if (!categoryId && row.newCategory) {
        const name = row.newCategory.name.trim();
        categoryId = expense.get(normalizeDescription(name)) ?? null;
        if (!categoryId) {
          const made = await ensureCategory(
            tx,
            ctx.householdId,
            "despesa",
            name,
            row.newCategory.essential,
          );
          if (made.created) await audit(tx, ctx, "create", "categories", made.id);
          categoryId = made.id;
          expense.set(normalizeDescription(name), made.id);
          expenseIds.add(made.id);
        }
      }
      if (!categoryId || !expenseIds.has(categoryId)) return { ok: false, code: "dados_invalidos" };
      const lines = purchaseLines(
        {
          id: "",
          cardId: card.id,
          categoryId,
          description: row.description,
          amount: row.amount,
          installments: row.installments,
          purchasedOn: row.date,
        },
        card,
      );
      if (lines.some((line) => paid.has(line.statementMonth))) {
        blocked += 1;
        continue;
      }
      fresh.push({ ...row, categoryId });
    }
    if (fresh.length === 0) return { ok: true, imported: 0, repeated, blocked };

    // Uma compra é um lançamento, com ou sem parcelas.
    const quota = await takeEntries(tx, access, ctx.householdId, fresh.length);
    if (!quota.ok) return { ok: false, code: "limite_de_lancamentos" };
    const created = await tx
      .insert(cardPurchases)
      .values(
        fresh.map((row) => ({
          householdId: ctx.householdId,
          cardId: card.id,
          categoryId: row.categoryId,
          description: row.description,
          amount: row.amount,
          installments: row.installments,
          purchasedOn: row.date,
          createdBy: ctx.userId,
        })),
      )
      .returning({ id: cardPurchases.id });
    for (const [index, purchase] of created.entries()) {
      await tx
        .update(cardPurchaseImports)
        .set({ importFingerprint: fresh[index]!.fingerprint })
        .where(eq(cardPurchaseImports.id, purchase.id));
      await markCardPurchase(tx, quota.month, purchase.id);
    }
    // Um registro pelo lote: a auditoria diz quem trouxe e de qual conexão, não cada compra.
    await audit(tx, ctx, "import", "card_purchases", found.link.id);
    return { ok: true, imported: created.length, repeated, blocked };
  });
}
