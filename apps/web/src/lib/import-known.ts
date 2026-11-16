// O que a conferência de um extrato compara com as linhas do banco: o que a conta já tem lançado, o que está
// previsto nela e, à parte, os compromissos de valor incerto (renda estimada, fatura de cartão), que casam
// por aproximação. Usado pela conferência de /app/importar e pela atualização automática (ADR-0038).
import "server-only";
import { incomeReceiptRows } from "@organizeup/agents";
import {
  and,
  bankConnectionAccounts,
  cashflowPlans,
  gte,
  isSchemaLag,
  lte,
  transactions,
  type TenantTx,
} from "@organizeup/db";
import {
  addMonths,
  buildMonthEntries,
  entryOrigin,
  monthBounds,
  yearMonthOf,
  type KnownEntry,
  type LooseKnown,
  type YearMonth,
} from "@organizeup/domain";
import { transferKnown } from "@/lib/bank-transfers";
import { loadCommitments } from "@/lib/commitments";

export interface KnownForImport {
  realized: KnownEntry[];
  forecasts: KnownEntry[];
  loose: LooseKnown;
}

/**
 * `loose` só vem preenchido quando pedido: em conta de outra moeda o valor do banco não é o do compromisso, e
 * a baixa aproximada não se aplica.
 */
export async function loadKnownForImport(
  tx: TenantTx,
  accountId: string,
  months: { first: YearMonth; last: YearMonth },
  withLoose: boolean,
): Promise<KnownForImport> {
  const from = monthBounds(months.first).first;
  const to = monthBounds(months.last).last;
  const inRange = await tx
    .select()
    .from(transactions)
    .where(and(gte(transactions.occurredOn, from), lte(transactions.occurredOn, to)));
  const planRows = await tx.select().from(cashflowPlans);
  const { scheduled } = await loadCommitments(tx, { from: months.first, to: months.last });

  // Cartões ligados pela mesma conexão do banco desta conta: o débito da fatura aparece nela, mesmo que o
  // cartão daqui esteja apontado para outra conta (ADR-0038).
  const bankLinks = await tx
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
  const items = new Set(
    bankLinks.filter((link) => link.accountId === accountId).map((link) => link.itemId),
  );
  const sameBankCards = new Set(
    bankLinks.flatMap((link) => (link.cardId && items.has(link.itemId) ? [link.cardId] : [])),
  );

  const forecasts: KnownEntry[] = [];
  const incomes: KnownEntry[] = [];
  const statements: KnownEntry[] = [];
  for (let month = months.first; month <= months.last; month = addMonths(month, 1)) {
    const entries = buildMonthEntries(
      month,
      planRows,
      inRange.filter((entry) => yearMonthOf(entry.occurredOn) === month),
      scheduled,
    );
    for (const entry of entries) {
      if (entry.status !== "previsto") continue;
      const known = { ...entry, amount: entry.originalAmount ?? entry.amount };
      if (entry.accountId === accountId) forecasts.push(known);
      // A renda pode estar cadastrada em outra conta: o banco mostra onde ela caiu de verdade.
      if (entry.source === "renda") incomes.push(known);
      // A fatura sai da conta que o cartão indica, ou da conta do mesmo banco do cartão ligado.
      if (
        entry.source === "fatura" &&
        (entry.accountId === accountId || sameBankCards.has(entry.key.split(":")[1] ?? ""))
      ) {
        statements.push(known);
      }
    }
  }
  const toKnown = (entry: (typeof inRange)[number]): KnownEntry => ({
    key: `t:${entry.id}`,
    description: entry.description,
    // O arquivo está na moeda da conta: é assim que a linha se compara com o que já existe.
    amount: entryOrigin(entry)?.amount ?? entry.amount,
    date: entry.occurredOn,
    kind: entry.kind,
    fingerprint: entry.importFingerprint,
  });
  const realized = [
    ...inRange
      .filter((entry) => entry.accountId === accountId && entry.status === "realizado")
      .map(toKnown),
    // A linha que virou transferência já entrou, e a transferência lançada à mão não se repete.
    ...(await transferKnown(tx, accountId)).filter(
      (entry) => entry.date >= from && entry.date <= to,
    ),
  ];
  if (!withLoose) return { realized, forecasts, loose: {} };

  // Renda que a família já confirmou à mão, em qualquer conta: o crédito do banco é ela, e não outra.
  const receiptIds = new Set((await incomeReceiptRows(tx)).map((row) => row.transactionId));
  const received = inRange
    .filter(
      (entry) =>
        receiptIds.has(entry.id) && entry.status === "realizado" && !entry.importFingerprint,
    )
    .map(toKnown);
  return { realized, forecasts, loose: { incomes, received, statements } };
}
