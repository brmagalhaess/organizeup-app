// Atualização automática da conexão com bancos (ADR-0038). O que a conferência faz com um clique, aqui roda
// sozinho: busca o que caiu em cada conta e cartão ligados, compara com o que já existe e grava o que é novo.
// Roda na web, porque a chave do cofre só existe nela, sempre no contexto de quem guardou a chave.
import "server-only";
import {
  accountBalances,
  accountCurrency,
  accounts,
  and,
  bankConnections,
  canWrite,
  countEntries,
  currencyFrozen,
  ensureCategory,
  eq,
  fromSession,
  householdCurrency,
  householdReports,
  importBatches,
  isNull,
  lockEntryQuota,
  lt,
  markEntries,
  or,
  readFamilyAccess,
  recordAgentRun,
  transactions,
  usageMonthOf,
  withAdmin,
  withAdminRead,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  addMonths,
  categorizeRow,
  entryFromTyped,
  importReport,
  isForeign,
  money,
  reconcileRows,
  toDbAmount,
  todayIn,
  withFingerprints,
  yearMonthOf,
  type StatementRow,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import {
  bankStatement,
  loadBankConnections,
  markBankSynced,
  sessionKey,
  type BankConnectionView,
  type BankFeedFailure,
  type Failed,
} from "@/lib/bank-feed";
import { categoryContext, commitCardFeed, prepareCardFeed } from "@/lib/bank-feed-cards";
import { pairBankTransfers } from "@/lib/bank-transfers";
import { loadKnownForImport } from "@/lib/import-known";
import { confirmCommitment } from "@/lib/confirm-entry";
import { pluggyAccounts, type PluggyOptions } from "@/lib/pluggy";

/** Nome do agente nas rodadas e no interruptor do painel. */
export const BANCOS_AGENT = "bancos";
/** Intervalo mínimo entre duas rodadas da mesma conexão quando a pessoa abre o sistema. */
export const BANK_AUTO_HOURS = 6;

export interface AutoStatement {
  ok: true;
  /** Lançamentos novos gravados. */
  imported: number;
  /** Contas previstas que o extrato confirmou. */
  settled: number;
}

/** O limite do plano estourou no meio: desfaz a transação inteira. */
class OverLimit extends Error {}

/**
 * Grava as linhas novas de uma conta, sem conferência: o que já entrou é pulado, o que a família lançou à
 * mão é respeitado, a conta prevista leva baixa e o resto vira lançamento, com a categoria que o sistema
 * propõe. Linha sem pista entra marcada para revisar, e o agente de categorias cuida dela de madrugada. Fica
 * tudo num lote de importação, com Desfazer.
 */
export async function autoImportStatement(
  ctx: TenantContext,
  accountId: string,
  input: StatementRow[],
): Promise<AutoStatement | Failed> {
  if (!canWrite(ctx)) return { ok: false, code: "sem_permissao" };
  if (input.length === 0) return { ok: true, imported: 0, settled: 0 };
  const rows = withFingerprints(input, "ofx");
  const dates = rows.map((row) => row.date).sort();
  const firstMonth = addMonths(yearMonthOf(dates[0]!), -1);
  const lastMonth = addMonths(yearMonthOf(dates.at(-1)!), 1);
  const access = await readFamilyAccess(ctx);

  return withHousehold(ctx, async (tx): Promise<AutoStatement | Failed> => {
    const currency = await accountCurrency(tx, accountId);
    if (!currency) return { ok: false, code: "conta_invalida" };
    const main = await householdCurrency(tx);
    if (isForeign(currency, main) || (await currencyFrozen(tx, currency))) {
      return { ok: false, code: "moeda_estrangeira" };
    }

    const known = await loadKnownForImport(
      tx,
      accountId,
      { first: firstMonth, last: lastMonth },
      true,
    );
    const reconciled = reconcileRows(rows, known, known.loose);
    if (!reconciled.some((row) => row.state === "novo" || row.state === "previsto")) {
      return { ok: true, imported: 0, settled: 0 };
    }

    const usageMonth = access.mode === "livre" ? null : await usageMonthOf(tx, ctx.householdId);
    if (access.entryLimit !== null) await lockEntryQuota(tx, ctx.householdId);
    const [batch] = await tx
      .insert(importBatches)
      .values({
        householdId: ctx.householdId,
        accountId,
        source: "ofx",
        rowCount: 0,
        periodStart: dates[0]!,
        periodEnd: dates.at(-1)!,
        createdBy: ctx.userId,
      })
      .returning({ id: importBatches.id });
    const batchId = batch!.id;

    let settled = 0;
    const fresh: typeof reconciled = [];
    for (const row of reconciled) {
      if (row.state === "importado" || row.state === "lancado") continue;
      const mark = { importFingerprint: row.fingerprint, importBatchId: batchId };
      if (row.state === "previsto" && row.match) {
        // Renda estimada e fatura: a baixa leva o valor, a conta e o dia que o banco mostra.
        const outcome = row.approx
          ? await confirmCommitment(tx, ctx, row.match.key, "", mark, row.date, {
              amount: row.amount,
              accountId,
            })
          : await confirmCommitment(tx, ctx, row.match.key, yearMonthOf(row.match.date), mark);
        if (outcome.done) {
          settled += 1;
          continue;
        }
      }
      fresh.push(row);
    }

    const context = await categoryContext(tx);
    const created: string[] = [];
    const outcome: Parameters<typeof importReport>[0] = [];
    const values = [];
    for (const row of fresh) {
      const proposal = categorizeRow(row, context.usable, context);
      let categoryId = proposal.categoryId;
      let categoryName = context.usable.find((category) => category.id === categoryId)?.name ?? "";
      if (!categoryId && proposal.newCategory) {
        const { name, essential } = proposal.newCategory;
        const made = await ensureCategory(tx, ctx.householdId, row.kind, name, essential);
        if (made.created) {
          await audit(tx, ctx, "create", "categories", made.id);
          created.push(name);
        }
        if (!context.usable.some((category) => category.id === made.id)) {
          context.usable.push({ id: made.id, name, kind: row.kind, archived: false });
        }
        categoryId = made.id;
        categoryName = name;
      }
      const money = entryFromTyped(row.amount, currency, null, main);
      if (!categoryId || !money) continue;
      values.push({
        householdId: ctx.householdId,
        accountId,
        categoryId,
        kind: row.kind,
        description: row.description,
        ...money,
        occurredOn: row.date,
        status: "realizado" as const,
        importFingerprint: row.fingerprint,
        importBatchId: batchId,
        // Ninguém conferiu: o agente de categorias só mexe no que ficou para revisar.
        categorySource:
          proposal.source === "revisar" ? ("revisar" as const) : ("importacao" as const),
        createdBy: ctx.userId,
      });
      outcome.push({
        kind: row.kind,
        amount: money.amount,
        category: categoryName,
        source: proposal.source,
        corrected: false,
      });
    }
    const inserted =
      values.length === 0
        ? []
        : await tx
            .insert(transactions)
            .values(values)
            .onConflictDoNothing()
            .returning({ id: transactions.id });
    await markEntries(
      tx,
      usageMonth,
      inserted.map((row) => row.id),
    );
    if (access.entryLimit !== null && usageMonth) {
      if ((await countEntries(tx, usageMonth)) > access.entryLimit) throw new OverLimit();
    }

    const total = settled + inserted.length;
    if (total === 0) {
      await tx.delete(importBatches).where(eq(importBatches.id, batchId));
      return { ok: true, imported: 0, settled: 0 };
    }
    await tx.update(importBatches).set({ rowCount: total }).where(eq(importBatches.id, batchId));
    await audit(tx, ctx, "create", "import_batches", batchId);
    if (outcome.length > 0) {
      const report = importReport(outcome, created, { start: dates[0]!, end: dates.at(-1)! });
      await tx.insert(householdReports).values({
        householdId: ctx.householdId,
        agent: "categorizacao",
        kind: "importacao",
        period: batchId,
        title: report.title,
        summary: report.summary,
        messageKey: report.message.key,
        messageParams: report.message.params ?? null,
        data: report.data,
      });
    }
    return { ok: true, imported: inserted.length, settled };
  }).catch((error: unknown) => {
    if (error instanceof OverLimit) return { ok: false, code: "limite_de_lancamentos" };
    throw error;
  });
}

export interface BankSyncResult {
  /** Lançamentos novos em contas. */
  entries: number;
  /** Contas previstas confirmadas pelo extrato. */
  settled: number;
  /** Compras novas em cartões. */
  purchases: number;
  /** Saída e entrada entre contas da casa que viraram uma transferência só. */
  transfers: number;
  /** Contas ou cartões que não deu para trazer, pelo código. */
  failures: BankFeedFailure[];
}

/** Erro que vale para a conexão inteira: não adianta tentar a conta seguinte. */
const STOPS: readonly BankFeedFailure[] = ["credenciais", "cofre", "limite", "rede"];

/** Traz tudo o que é novo de uma conexão: cada conta e cada cartão já ligados. */
export async function syncBankConnection(
  ctx: TenantContext,
  connection: BankConnectionView,
  options: PluggyOptions = {},
): Promise<BankSyncResult> {
  const result: BankSyncResult = {
    entries: 0,
    settled: 0,
    purchases: 0,
    transfers: 0,
    failures: [],
  };
  for (const link of connection.links) {
    if (link.kind === "cartao") {
      if (!link.cardId) continue;
      const feed = await prepareCardFeed(ctx, link.id, null, options);
      if (!feed.ok) {
        result.failures.push(feed.code);
        if (STOPS.includes(feed.code)) break;
        continue;
      }
      const fresh = feed.rows.filter((row) => row.state === "novo");
      if (fresh.length > 0) {
        const saved = await commitCardFeed(
          ctx,
          link.id,
          fresh.map((row) => ({
            date: row.date,
            description: row.description,
            amount: row.amount,
            installments: row.installments,
            fingerprint: row.fingerprint,
            categoryId: row.categoryId,
            newCategory: row.newCategory,
          })),
        );
        if (!saved.ok) {
          result.failures.push(saved.code);
          continue;
        }
        result.purchases += saved.imported;
      }
      await markBankSynced(ctx, link.id, feed.to);
      continue;
    }
    if (!link.accountId) continue;
    const statement = await bankStatement(ctx, link.id, null, options);
    if (!statement.ok) {
      result.failures.push(statement.code);
      if (STOPS.includes(statement.code)) break;
      continue;
    }
    const saved = await autoImportStatement(ctx, statement.accountId, statement.rows);
    if (!saved.ok) {
      result.failures.push(saved.code);
      continue;
    }
    result.entries += saved.imported;
    result.settled += saved.settled;
    await markBankSynced(ctx, link.id, statement.to);
  }
  // Dinheiro que só mudou de conta dentro da casa não é despesa nem receita (ADR-0042). Olha tudo o que veio
  // do banco, e não só esta rodada: a outra ponta pode ter chegado antes, pela conexão de outra pessoa.
  result.transfers = await pairBankTransfers(ctx).catch((error: unknown) => {
    const { name, code } = error as { name?: string; code?: string };
    console.error(JSON.stringify({ level: "error", msg: "bank_transfers_failed", name, code }));
    return 0;
  });
  // Com os lançamentos já gravados, o saldo de cada conta ligada é acertado pelo do banco.
  if (!result.failures.some((code) => STOPS.includes(code))) {
    await alignBankBalances(ctx, connection.id, options).catch((error: unknown) => {
      const { name, code } = error as { name?: string; code?: string };
      console.error(JSON.stringify({ level: "error", msg: "bank_balance_failed", name, code }));
    });
  }
  return result;
}

/**
 * Roda a atualização automática das conexões de quem está no contexto, se já passou o intervalo. Marcar a
 * hora da rodada é a primeira coisa, numa escrita só: duas telas abertas juntas não rodam duas vezes.
 */
export async function syncOwnBanks(
  ctx: TenantContext,
  { minHours = BANK_AUTO_HOURS, options = {} }: { minHours?: number; options?: PluggyOptions } = {},
): Promise<BankSyncResult | null> {
  const userId = ctx.userId;
  if (!userId || !canWrite(ctx)) return null;
  const now = new Date();
  const cutoff = new Date(now.getTime() - minHours * 60 * 60 * 1000);
  const claimed = await withHousehold(ctx, (tx) =>
    tx
      .update(bankConnections)
      .set({ autoRanAt: now })
      .where(
        and(
          eq(bankConnections.userId, userId),
          eq(bankConnections.autoEnabled, true),
          or(isNull(bankConnections.autoRanAt), lt(bankConnections.autoRanAt, cutoff)),
        ),
      )
      .returning({ id: bankConnections.id }),
  );
  if (claimed.length === 0) return null;
  const ids = new Set(claimed.map((row) => row.id));
  const total: BankSyncResult = {
    entries: 0,
    settled: 0,
    purchases: 0,
    transfers: 0,
    failures: [],
  };
  for (const connection of await loadBankConnections(ctx)) {
    if (!ids.has(connection.id)) continue;
    const result = await syncBankConnection(ctx, connection, options);
    total.entries += result.entries;
    total.settled += result.settled;
    total.purchases += result.purchases;
    total.transfers += result.transfers;
    total.failures.push(...result.failures);
  }
  return total;
}

/**
 * Rodada de todas as conexões com a atualização ligada, a pedido do Paperclip (agente `bancos`). Para a
 * equipe de agentes vão só contagens: famílias, quantas rodaram sem falha e quantos lançamentos entraram.
 */
export async function syncAllBanks(options: PluggyOptions = {}) {
  const started = Date.now();
  const owners = await withAdminRead("atualização automática de bancos", (db) =>
    db
      .selectDistinct({ householdId: bankConnections.householdId, userId: bankConnections.userId })
      .from(bankConnections)
      .where(eq(bankConnections.autoEnabled, true)),
  );
  const households = new Set<string>();
  let ok = 0;
  let failed = 0;
  let applied = 0;
  for (const owner of owners) {
    households.add(owner.householdId);
    try {
      const ctx = await fromSession({
        user: { id: owner.userId },
        session: { activeOrganizationId: owner.householdId },
      });
      // Quem saiu da família ou perdeu a permissão de escrita não tem mais rodada.
      if (!ctx || !canWrite(ctx)) continue;
      // Uma hora de folga: a pessoa pode ter acabado de abrir o sistema.
      const result = await syncOwnBanks(ctx, { minHours: 1, options });
      if (!result) continue;
      applied += result.entries + result.settled + result.purchases;
      if (result.failures.length > 0) failed += 1;
      else ok += 1;
    } catch (error) {
      failed += 1;
      // Só o nome e o código: a mensagem pode trazer dados da família.
      const { name, code } = error as { name?: string; code?: string };
      console.error(JSON.stringify({ level: "error", msg: "bank_auto_failed", name, code }));
    }
  }
  const counts = {
    households: households.size,
    ok,
    failed,
    suggestions: 0,
    applied,
    durationMs: Date.now() - started,
  };
  // A conexão da web não grava rodadas de agente, de propósito: a contagem vai pela administrativa.
  await withAdmin("rodada do agente bancos", (db) =>
    recordAgentRun(todayIn(), BANCOS_AGENT, counts, db),
  );
  return counts;
}

/**
 * Acerta o saldo das contas ligadas pelo saldo que o banco informa agora. A conta daqui começa do zero e só
 * recebe os lançamentos da janela trazida: sem isto, ela mostra a soma dos gastos, e não o dinheiro que tem.
 * O que muda é o saldo inicial, de modo que saldo inicial mais lançamentos dê o saldo do banco. Devolve
 * quantas contas mudaram. Falha da Pluggy aqui não é erro da rodada: o saldo fica como estava.
 */
export async function alignBankBalances(
  ctx: TenantContext,
  connectionId: string,
  options: PluggyOptions = {},
): Promise<number> {
  const userId = ctx.userId;
  if (!userId || !canWrite(ctx)) return 0;
  const connection = (await loadBankConnections(ctx)).find((row) => row.id === connectionId);
  const linked = connection?.links.filter((link) => link.kind !== "cartao" && link.accountId) ?? [];
  if (!connection || linked.length === 0) return 0;
  const sealed = await withHousehold(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.id, connectionId), eq(bankConnections.userId, userId)));
    return row ?? null;
  });
  if (!sealed) return 0;
  const apiKey = await sessionKey(ctx, userId, sealed, options);
  if (typeof apiKey !== "string") return 0;
  const balances = new Map<string, string>();
  for (const itemId of connection.itemIds) {
    const remote = await pluggyAccounts(apiKey, itemId, options).catch(() => []);
    for (const account of remote) {
      if (account.balance !== null) balances.set(account.id, account.balance);
    }
  }
  let changed = 0;
  await withHousehold(ctx, async (tx) => {
    const { accounts: current } = await accountBalances(tx);
    for (const link of linked) {
      const bank = balances.get(link.externalId);
      const account = current.find((row) => row.id === link.accountId);
      // A conta do banco e a daqui são da mesma moeda (a ligação exige): compara-se na moeda dela.
      if (bank === undefined || !account || account.currency !== link.currency) continue;
      const gap = money(bank).minus(account.nativeBalance);
      if (gap.isZero()) continue;
      await tx
        .update(accounts)
        .set({ openingBalance: toDbAmount(money(account.openingBalance).plus(gap)) })
        .where(eq(accounts.id, account.id));
      await audit(tx, ctx, "update", "accounts", account.id);
      changed += 1;
    }
  });
  return changed;
}

/** O mesmo acerto, a partir de uma conta ligada: depois de ligar, criar ou trazer pela conferência. */
export async function alignBankLink(ctx: TenantContext, linkId: string): Promise<number> {
  const connection = (await loadBankConnections(ctx)).find((row) =>
    row.links.some((link) => link.id === linkId),
  );
  return connection ? alignBankBalances(ctx, connection.id) : 0;
}
