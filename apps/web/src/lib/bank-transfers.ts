// Transferência entre contas da casa que chegou pelo banco como duas linhas (ADR-0042). As duas viram uma
// transferência só: o saldo de cada conta não muda, e o mês deixa de somar a saída como despesa e a entrada
// como receita. Vale para o que acabou de chegar e para o que já estava lançado.
import "server-only";
import { incomeReceiptRows } from "@organizeup/agents";
import {
  and,
  canWrite,
  cardStatementPayments,
  ensureCategory,
  eq,
  inArray,
  isNotNull,
  isNull,
  isSchemaLag,
  transactions,
  transferImports,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import { FALLBACK_CATEGORY, pairOwnTransfers, type KnownEntry } from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { goalEntryLink } from "@/lib/confirm-entry";
import { loadOwners } from "@/lib/owners";

/** Quem escolheu a categoria. O que a família classificou à mão é decisão dela, e não vira transferência. */
const UNTOUCHED = ["importacao", "revisar", "agente"] as const;

/**
 * Procura, no que veio do banco, saída e entrada de mesmo valor entre contas da casa e troca as duas por uma
 * transferência. Devolve quantas transferências criou. Sem a migração 0055, não faz nada.
 */
export async function pairBankTransfers(ctx: TenantContext): Promise<number> {
  if (!canWrite(ctx)) return 0;
  return withHousehold(ctx, (tx) =>
    tx
      .transaction((step) => pairWithin(step as TenantTx, ctx))
      .catch((error: unknown) => {
        if (isSchemaLag(error)) return 0;
        throw error;
      }),
  );
}

async function pairWithin(tx: TenantTx, ctx: TenantContext): Promise<number> {
  const rows = await tx
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      kind: transactions.kind,
      amount: transactions.amount,
      date: transactions.occurredOn,
      description: transactions.description,
      fingerprint: transactions.importFingerprint,
    })
    .from(transactions)
    .where(
      and(
        isNotNull(transactions.importFingerprint),
        eq(transactions.status, "realizado"),
        inArray(transactions.categorySource, [...UNTOUCHED]),
        // Previsão que o extrato confirmou é conta da casa, e não transferência.
        isNull(transactions.planId),
        // Só na moeda principal: em conta estrangeira o valor das duas pontas não é o mesmo.
        isNull(transactions.originalAmount),
        isNull(transactions.brlAmount),
      ),
    );
  if (rows.length < 2) return 0;
  // Pagamento de fatura e renda recebida têm dono: não são transferência.
  const tied = new Set([
    ...(
      await tx.select({ id: cardStatementPayments.transactionId }).from(cardStatementPayments)
    ).map((row) => row.id),
    ...(await incomeReceiptRows(tx)).map((row) => row.transactionId),
  ]);
  const lines = rows.filter((row) => !tied.has(row.id));
  const owners = await loadOwners(tx);
  const pairs = pairOwnTransfers(lines, {
    accountOwner: owners.book.accounts,
    people: owners.people,
  });

  const byId = new Map(lines.map((row) => [row.id, row]));
  let made = 0;
  for (const pair of pairs) {
    const out = byId.get(pair.fromId)!;
    const into = byId.get(pair.toId)!;
    // Parcela de meta baixada pelo extrato leva junto o guardado da meta: fica como está.
    if ((await goalEntryLink(tx, out.id)) || (await goalEntryLink(tx, into.id))) continue;
    const [created] = await tx
      .insert(transferImports)
      .values({
        householdId: ctx.householdId,
        fromAccountId: out.accountId,
        toAccountId: into.accountId,
        amount: out.amount,
        occurredOn: out.date,
        note: out.description.slice(0, 200),
        toNote: into.description.slice(0, 200),
        fromFingerprint: out.fingerprint,
        toFingerprint: into.fingerprint,
        createdBy: ctx.userId,
      })
      .returning({ id: transferImports.id });
    await tx.delete(transactions).where(inArray(transactions.id, [out.id, into.id]));
    await audit(tx, ctx, "create", "account_transfers", created!.id);
    await audit(tx, ctx, "delete", "transactions", out.id);
    await audit(tx, ctx, "delete", "transactions", into.id);
    made += 1;
  }
  return made;
}

/**
 * As transferências de uma conta, do jeito que a conferência do extrato compara: a linha do banco que já virou
 * transferência não entra de novo, e a transferência lançada à mão não se repete quando o banco a mostra.
 * Sem conta, devolve a ponta de saída de todas.
 */
export async function transferKnown(tx: TenantTx, accountId?: string): Promise<KnownEntry[]> {
  const rows = await tx
    .transaction((step) => step.select().from(transferImports))
    .catch((error: unknown) => {
      if (isSchemaLag(error)) return [];
      throw error;
    });
  return rows.flatMap((row): KnownEntry[] => {
    const base = { key: `x:${row.id}`, date: row.occurredOn };
    if (!accountId || row.fromAccountId === accountId) {
      return [
        {
          ...base,
          description: row.note ?? "",
          amount: row.amount,
          kind: "despesa",
          fingerprint: row.fromFingerprint,
        },
      ];
    }
    if (row.toAccountId === accountId) {
      return [
        {
          ...base,
          description: row.toNote ?? row.note ?? "",
          amount: row.toAmount ?? row.amount,
          kind: "receita",
          fingerprint: row.toFingerprint,
        },
      ];
    }
    return [];
  });
}

/**
 * Desfaz uma transferência. A que veio do banco volta a ser dois lançamentos, a saída e a entrada, marcados
 * como escolha da família: assim não viram transferência de novo nem entram em dobro na próxima atualização.
 * Devolve false quando a transferência não existe.
 */
export async function undoTransfer(tx: TenantTx, ctx: TenantContext, id: string): Promise<boolean> {
  const [bank] = await tx
    .transaction((step) => step.select().from(transferImports).where(eq(transferImports.id, id)))
    .catch((error: unknown) => {
      if (isSchemaLag(error)) return [];
      throw error;
    });
  if (bank?.fromFingerprint && bank.toFingerprint) {
    const side = async (
      kind: "despesa" | "receita",
      accountId: string,
      description: string | null,
      importFingerprint: string,
    ) => {
      const category = await ensureCategory(
        tx,
        ctx.householdId,
        kind,
        FALLBACK_CATEGORY[kind],
        false,
      );
      const [created] = await tx
        .insert(transactions)
        .values({
          householdId: ctx.householdId,
          accountId,
          categoryId: category.id,
          kind,
          description: description || FALLBACK_CATEGORY[kind],
          amount: bank.amount,
          occurredOn: bank.occurredOn,
          status: "realizado",
          importFingerprint,
          categorySource: "familia",
          createdBy: ctx.userId,
        })
        .returning({ id: transactions.id });
      await audit(tx, ctx, "create", "transactions", created!.id);
    };
    await side("despesa", bank.fromAccountId, bank.note, bank.fromFingerprint);
    await side("receita", bank.toAccountId, bank.toNote ?? bank.note, bank.toFingerprint);
  }
  const removed = await tx
    .delete(transferImports)
    .where(eq(transferImports.id, id))
    .returning({ id: transferImports.id });
  if (removed.length === 0) return false;
  await audit(tx, ctx, "delete", "account_transfers", id);
  return true;
}
