// Conexão com bancos pela Pluggy, com a chave de cada pessoa (ADR-0038). Quem está logado guarda até duas
// chaves: a sua e a de outra pessoa do cadastro, com a autorização dela. Cada chave pertence a uma pessoa, e
// só o login que a guardou vê, busca e remove. As chaves só abrem com a família, o login e a conexão que as
// gravaram. A Pluggy é chamada fora de `withHousehold`; dentro da transação só entra o que já foi lido.
import "server-only";
import { notFound } from "next/navigation";
import {
  accounts,
  and,
  asc,
  bankConnectionAccounts,
  bankConnections,
  canWrite,
  eq,
  householdTimezone,
  inArray,
  ne,
  notInArray,
  people,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  feedPortfolioOf,
  feedStatementOf,
  feedWindowStart,
  isFeedId,
  parseFeedItemIds,
  todayIn,
  type BankFeedError,
  type FeedInvestment,
  type ParsedInvestmentFile,
  type StatementRow,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { connectionVaultReady, openSecret, sealSecret } from "@/lib/connection-vault";
import {
  pluggyAccounts,
  pluggyInvestments,
  pluggyKey,
  pluggyTransactions,
  PluggyError,
  type PluggyAccount,
  type PluggyOptions,
} from "@/lib/pluggy";
import { isServiceAdmin, platformFlags, requireTenant } from "@/lib/session";

/** Esta pessoa pode ver a conexão? Desligada, só quem administra o serviço. */
export async function bankFeedOpen(user: { id: string; email: string }): Promise<boolean> {
  return (await platformFlags()).bankFeedEnabled || isServiceAdmin(user);
}

/** Sessão para tela e action da conexão. Quem não pode recebe 404: nem sabe que existe. */
export async function requireBankFeed() {
  const tenant = await requireTenant();
  if (!(await bankFeedOpen(tenant.session.user))) notFound();
  return tenant;
}

/** Quantas chaves um login guarda: a sua e a de mais uma pessoa. */
export const BANK_KEYS_PER_LOGIN = 2;

export type BankFeedFailure =
  | BankFeedError
  /** Sem `DOCUMENT_ENCRYPTION_KEY`, ou chave trocada desde que a conexão foi gravada. */
  | "cofre"
  | "sem_permissao"
  | "dados_invalidos"
  | "sem_conexao"
  | "conta_invalida"
  /** A conta do OrganizeUp já recebe lançamentos de outra conta do banco. */
  | "conta_em_uso"
  | "cartao"
  /** Pessoa fora do cadastro, ou menor de idade. */
  | "pessoa_invalida"
  /** Já existe uma chave desta pessoa, guardada por este ou por outro login. */
  | "pessoa_ja_conectada"
  | "limite_de_chaves"
  /** Chave de outra pessoa sem a confirmação de que ela autorizou. */
  | "sem_consentimento";

type Failed = { ok: false; code: BankFeedFailure };

export interface BankLink {
  id: string;
  kind: "corrente" | "poupanca" | "cartao";
  name: string;
  numberTail: string | null;
  accountId: string | null;
  syncedOn: string | null;
}

export interface BankConnectionView {
  id: string;
  personId: string;
  personName: string;
  itemIds: string[];
  checkedAt: Date | null;
  errorCode: string | null;
  links: BankLink[];
}

/** Pessoa do cadastro que pode ser dona de uma chave. */
export interface BankPerson {
  id: string;
  name: string;
  /** É a pessoa de quem está logado: não precisa confirmar autorização. */
  self: boolean;
  /** Já tem chave guardada, por este ou por outro login. */
  connected: boolean;
}

const failure = (error: unknown): Failed => {
  if (error instanceof PluggyError) return { ok: false, code: error.code };
  throw error;
};

const ownerOf = (ctx: TenantContext) => ctx.userId;

const ownConnections = (tx: TenantTx, userId: string) =>
  tx
    .select()
    .from(bankConnections)
    .where(and(eq(bankConnections.userId, userId), eq(bankConnections.provider, "pluggy")))
    .orderBy(asc(bankConnections.createdAt));

async function ownConnection(tx: TenantTx, userId: string, connectionId: string) {
  const [row] = await tx
    .select()
    .from(bankConnections)
    .where(
      and(
        eq(bankConnections.id, connectionId),
        eq(bankConnections.userId, userId),
        eq(bankConnections.provider, "pluggy"),
      ),
    );
  return row ?? null;
}

/** A conta ligada e a conexão dela, se a conexão é de quem está logado. */
async function ownLink(tx: TenantTx, userId: string, linkId: string) {
  const [link] = await tx
    .select()
    .from(bankConnectionAccounts)
    .where(eq(bankConnectionAccounts.id, linkId));
  if (!link) return null;
  const connection = await ownConnection(tx, userId, link.connectionId);
  return connection ? { link, connection } : null;
}

/**
 * Menor de idade não conecta (decisão do fundador, 2026-11-01). Sem ano de nascimento, filho é tratado como
 * menor; os demais, como adultos.
 */
function adult(person: { relation: string; birthYear: number | null }, today: string): boolean {
  if (person.birthYear === null) return person.relation !== "filho";
  return Number(today.slice(0, 4)) - person.birthYear >= 18;
}

/** As conexões de quem está logado, com as contas achadas em cada uma. */
export async function loadBankConnections(ctx: TenantContext): Promise<BankConnectionView[]> {
  const userId = ownerOf(ctx);
  if (!userId) return [];
  return withHousehold(ctx, async (tx) => {
    const connections = await ownConnections(tx, userId);
    if (connections.length === 0) return [];
    const [links, persons] = await Promise.all([
      tx
        .select()
        .from(bankConnectionAccounts)
        .where(
          inArray(
            bankConnectionAccounts.connectionId,
            connections.map((connection) => connection.id),
          ),
        ),
      tx.select({ id: people.id, name: people.name }).from(people),
    ]);
    const nameOf = new Map(persons.map((person) => [person.id, person.name]));
    return connections.map((connection) => ({
      id: connection.id,
      personId: connection.personId,
      personName: nameOf.get(connection.personId) ?? "",
      itemIds: connection.itemIds,
      checkedAt: connection.checkedAt,
      errorCode: connection.errorCode,
      links: links
        .filter((link) => link.connectionId === connection.id)
        .map(({ id, kind, name, numberTail, accountId, syncedOn }) => ({
          id,
          kind,
          name,
          numberTail,
          accountId,
          syncedOn,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  });
}

/** Quem do cadastro pode ser dono de uma chave, para o formulário. */
export async function loadBankPeople(ctx: TenantContext): Promise<BankPerson[]> {
  const userId = ownerOf(ctx);
  if (!userId) return [];
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    const [persons, taken] = await Promise.all([
      tx.select().from(people).orderBy(asc(people.createdAt)),
      tx.select({ personId: bankConnections.personId }).from(bankConnections),
    ]);
    const connected = new Set(taken.map((row) => row.personId));
    return persons
      .filter((person) => adult(person, today))
      .map((person) => ({
        id: person.id,
        name: person.name,
        self: person.userId === userId,
        connected: connected.has(person.id),
      }));
  });
}

type StoredKeys = { id: string; clientIdSealed: string; clientSecretSealed: string };

/** Abre as chaves guardadas e pede a chave de sessão à Pluggy. */
async function sessionKey(
  ctx: TenantContext,
  userId: string,
  connection: StoredKeys,
  options: PluggyOptions,
): Promise<string | Failed> {
  const ref = { householdId: ctx.householdId, userId, connectionId: connection.id };
  const clientId = openSecret(connection.clientIdSealed, { ...ref, field: "clientId" });
  const clientSecret = openSecret(connection.clientSecretSealed, { ...ref, field: "clientSecret" });
  if (!clientId || !clientSecret) return { ok: false, code: "cofre" };
  return pluggyKey(clientId, clientSecret, options).catch(failure);
}

/** Anota o código do último erro, para a tela dizer o que houve. Nunca o texto. */
async function noteResult(ctx: TenantContext, connectionId: string, errorCode: string | null) {
  await withHousehold(ctx, (tx) =>
    tx
      .update(bankConnections)
      .set({ errorCode, checkedAt: new Date(), updatedAt: new Date() })
      .where(eq(bankConnections.id, connectionId)),
  ).catch(() => undefined);
}

export interface ConnectInput {
  /** Null: chave nova. Com valor: troca as chaves ou as conexões de uma que já existe. */
  connectionId: string | null;
  /** De quem é a chave. Só vale na criação: a chave não muda de dono. */
  personId: string;
  /** Vazios quando a pessoa só troca as conexões e as chaves já estão guardadas. */
  clientId: string;
  clientSecret: string;
  itemIds: string;
  /** Chave de outra pessoa: quem está logado confirma que ela autorizou. */
  consent: boolean;
}

/**
 * Grava a conexão depois de conferir as chaves e cada conexão na Pluggy. Atualizar mantém a ligação das contas
 * que continuam existindo.
 */
export async function connectBank(
  ctx: TenantContext,
  input: ConnectInput,
  options: PluggyOptions = {},
): Promise<{ ok: true; accounts: number } | Failed> {
  const userId = ownerOf(ctx);
  if (!userId || !canWrite(ctx)) return { ok: false, code: "sem_permissao" };
  if (!connectionVaultReady()) return { ok: false, code: "cofre" };
  const itemIds = parseFeedItemIds(input.itemIds);
  const clientId = input.clientId.trim().toLowerCase();
  const clientSecret = input.clientSecret.trim();
  const typed = clientId !== "" || clientSecret !== "";
  if (!itemIds) return { ok: false, code: "dados_invalidos" };
  if (typed && (!isFeedId(clientId) || !/^\S{8,200}$/.test(clientSecret))) {
    return { ok: false, code: "dados_invalidos" };
  }

  type Stored = Awaited<ReturnType<typeof ownConnections>>[number];
  const state = await withHousehold(
    ctx,
    async (tx): Promise<BankFeedFailure | { existing: Stored | null; personId: string }> => {
      const own = await ownConnections(tx, userId);
      if (input.connectionId) {
        const existing = own.find((row) => row.id === input.connectionId);
        return existing ? { existing, personId: existing.personId } : "sem_conexao";
      }
      const [person] = await tx.select().from(people).where(eq(people.id, input.personId));
      const today = todayIn(await householdTimezone(tx, ctx.householdId));
      if (!person || !adult(person, today)) return "pessoa_invalida";
      const [taken] = await tx
        .select({ id: bankConnections.id })
        .from(bankConnections)
        .where(eq(bankConnections.personId, person.id));
      if (taken) return "pessoa_ja_conectada";
      if (own.length >= BANK_KEYS_PER_LOGIN) return "limite_de_chaves";
      if (person.userId !== userId && !input.consent) return "sem_consentimento";
      return { existing: null, personId: person.id };
    },
  );
  if (typeof state === "string") return { ok: false, code: state };
  const { existing } = state;
  if (!typed && !existing) return { ok: false, code: "dados_invalidos" };

  // O identificador nasce antes da linha: ele entra no dado autenticado das chaves.
  const connectionId = existing?.id ?? crypto.randomUUID();
  const ref = { householdId: ctx.householdId, userId, connectionId };
  const apiKey = typed
    ? await pluggyKey(clientId, clientSecret, options).catch(failure)
    : await sessionKey(ctx, userId, existing!, options);
  if (typeof apiKey !== "string") return apiKey;
  const found: PluggyAccount[] = [];
  for (const itemId of itemIds) {
    const rows = await pluggyAccounts(apiKey, itemId, options).catch(failure);
    if (!Array.isArray(rows)) return rows;
    found.push(...rows);
  }

  await withHousehold(ctx, async (tx) => {
    const sealed = typed
      ? {
          clientIdSealed: sealSecret(clientId, { ...ref, field: "clientId" }),
          clientSecretSealed: sealSecret(clientSecret, { ...ref, field: "clientSecret" }),
        }
      : {};
    const now = new Date();
    if (existing) {
      await tx
        .update(bankConnections)
        .set({ ...sealed, itemIds, checkedAt: now, errorCode: null, updatedAt: now })
        .where(eq(bankConnections.id, connectionId));
    } else {
      await tx.insert(bankConnections).values({
        id: connectionId,
        householdId: ctx.householdId,
        userId,
        personId: state.personId,
        clientIdSealed: sealed.clientIdSealed!,
        clientSecretSealed: sealed.clientSecretSealed!,
        itemIds,
        checkedAt: now,
      });
    }
    for (const account of found) {
      await tx
        .insert(bankConnectionAccounts)
        .values({
          householdId: ctx.householdId,
          connectionId,
          itemId: account.itemId,
          externalId: account.id,
          kind: account.kind,
          name: account.name,
          numberTail: account.numberTail,
          currency: account.currency,
        })
        .onConflictDoUpdate({
          target: [
            bankConnectionAccounts.householdId,
            bankConnectionAccounts.connectionId,
            bankConnectionAccounts.externalId,
          ],
          set: {
            itemId: account.itemId,
            kind: account.kind,
            name: account.name,
            numberTail: account.numberTail,
            currency: account.currency,
          },
        });
    }
    // Conta que saiu da Pluggy sai daqui. Os lançamentos já trazidos ficam.
    const kept = found.map((account) => account.id);
    await tx
      .delete(bankConnectionAccounts)
      .where(
        kept.length > 0
          ? and(
              eq(bankConnectionAccounts.connectionId, connectionId),
              notInArray(bankConnectionAccounts.externalId, kept),
            )
          : eq(bankConnectionAccounts.connectionId, connectionId),
      );
    await audit(tx, ctx, existing ? "update" : "create", "bank_connections", connectionId);
  });
  return { ok: true, accounts: found.length };
}

/** Lê de novo as contas de uma conexão já guardada. */
export async function refreshBank(
  ctx: TenantContext,
  connectionId: string,
  options: PluggyOptions = {},
): Promise<{ ok: true; accounts: number } | Failed> {
  const userId = ownerOf(ctx);
  if (!userId || !canWrite(ctx)) return { ok: false, code: "sem_permissao" };
  const existing = await withHousehold(ctx, (tx) => ownConnection(tx, userId, connectionId));
  if (!existing) return { ok: false, code: "sem_conexao" };
  const result = await connectBank(
    ctx,
    {
      connectionId: existing.id,
      personId: existing.personId,
      clientId: "",
      clientSecret: "",
      itemIds: existing.itemIds.join(","),
      consent: true,
    },
    options,
  );
  if (!result.ok) await noteResult(ctx, existing.id, result.code);
  return result;
}

/** Liga uma conta do banco a uma conta do OrganizeUp. `accountId` vazio desfaz a ligação. */
export async function linkBankAccount(
  ctx: TenantContext,
  linkId: string,
  accountId: string,
): Promise<{ ok: true } | Failed> {
  const userId = ownerOf(ctx);
  if (!userId || !canWrite(ctx)) return { ok: false, code: "sem_permissao" };
  return withHousehold(ctx, async (tx): Promise<{ ok: true } | Failed> => {
    const found = await ownLink(tx, userId, linkId);
    if (!found) return { ok: false, code: "sem_conexao" };
    const { link } = found;
    if (link.kind === "cartao") return { ok: false, code: "cartao" };
    if (accountId) {
      const [account] = await tx
        .select({ id: accounts.id, currency: accounts.currency })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.archived, false)));
      // O valor chega na moeda da conta do banco: a conta daqui precisa ser da mesma moeda.
      if (!account || account.currency !== link.currency) {
        return { ok: false, code: "conta_invalida" };
      }
      // Duas contas do banco na mesma conta daqui embaralham a conferência, venham de que chave vierem.
      const [busy] = await tx
        .select({ id: bankConnectionAccounts.id })
        .from(bankConnectionAccounts)
        .where(
          and(
            eq(bankConnectionAccounts.accountId, accountId),
            ne(bankConnectionAccounts.id, link.id),
          ),
        );
      if (busy) return { ok: false, code: "conta_em_uso" };
    }
    await tx
      .update(bankConnectionAccounts)
      .set({
        accountId: accountId || null,
        ...(accountId === link.accountId ? {} : { syncedOn: null }),
      })
      .where(eq(bankConnectionAccounts.id, link.id));
    await audit(tx, ctx, "update", "bank_connection_accounts", link.id);
    return { ok: true };
  });
}

/** Apaga uma conexão e as chaves dela. O que já foi importado continua na família. */
export async function removeBank(
  ctx: TenantContext,
  connectionId: string,
): Promise<{ ok: true } | Failed> {
  const userId = ownerOf(ctx);
  if (!userId || !canWrite(ctx)) return { ok: false, code: "sem_permissao" };
  return withHousehold(ctx, async (tx): Promise<{ ok: true } | Failed> => {
    const connection = await ownConnection(tx, userId, connectionId);
    if (!connection) return { ok: false, code: "sem_conexao" };
    await tx.delete(bankConnections).where(eq(bankConnections.id, connection.id));
    await audit(tx, ctx, "delete", "bank_connections", connection.id);
    return { ok: true };
  });
}

export interface BankStatement {
  ok: true;
  linkId: string;
  accountId: string;
  rows: StatementRow[];
  pending: number;
  skipped: number;
  truncated: boolean;
  from: string;
  to: string;
}

/** Lançamentos de uma conta ligada, prontos para a conferência de /app/importar. Não grava nada. */
export async function bankStatement(
  ctx: TenantContext,
  linkId: string,
  askedFrom: string | null,
  options: PluggyOptions = {},
): Promise<BankStatement | Failed> {
  const userId = ownerOf(ctx);
  if (!userId || !canWrite(ctx)) return { ok: false, code: "sem_permissao" };
  const found = await withHousehold(ctx, async (tx) => {
    const own = await ownLink(tx, userId, linkId);
    return own ? { ...own, timezone: await householdTimezone(tx, ctx.householdId) } : null;
  });
  if (!found) return { ok: false, code: "sem_conexao" };
  const { connection, link, timezone } = found;
  if (link.kind === "cartao") return { ok: false, code: "cartao" };
  if (!link.accountId) return { ok: false, code: "conta_invalida" };

  const to = todayIn(timezone);
  const from = feedWindowStart(to, link.syncedOn, askedFrom);
  const apiKey = await sessionKey(ctx, userId, connection, options);
  const transactions =
    typeof apiKey === "string"
      ? await pluggyTransactions(apiKey, link.externalId, { from, to }, options).catch(failure)
      : apiKey;
  if (!Array.isArray(transactions)) {
    await noteResult(ctx, connection.id, transactions.code);
    return transactions;
  }
  await noteResult(ctx, connection.id, null);
  const statement = feedStatementOf(transactions, timezone);
  return { ok: true, linkId: link.id, accountId: link.accountId, from, to, ...statement };
}

/** Depois de gravar a importação: a próxima busca desta conta parte daqui. */
export async function markBankSynced(ctx: TenantContext, linkId: string, day: string) {
  const userId = ownerOf(ctx);
  if (!userId || !canWrite(ctx) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  await withHousehold(ctx, async (tx) => {
    const found = await ownLink(tx, userId, linkId);
    if (!found) return;
    const today = todayIn(await householdTimezone(tx, ctx.householdId));
    await tx
      .update(bankConnectionAccounts)
      .set({ syncedOn: day > today ? today : day })
      .where(eq(bankConnectionAccounts.id, found.link.id));
  });
}

export interface BankPortfolio {
  ok: true;
  file: ParsedInvestmentFile;
  paid: Record<string, string>;
}

/**
 * Posição em ativos de bolsa de todas as chaves de quem está logado, somada por código: a carteira é da
 * família, então a mesma ação nas duas chaves vira uma linha só.
 */
export async function bankPortfolio(
  ctx: TenantContext,
  options: PluggyOptions = {},
): Promise<BankPortfolio | Failed> {
  const userId = ownerOf(ctx);
  if (!userId || !canWrite(ctx)) return { ok: false, code: "sem_permissao" };
  const connections = await withHousehold(ctx, (tx) => ownConnections(tx, userId));
  if (connections.length === 0) return { ok: false, code: "sem_conexao" };
  const investments: FeedInvestment[] = [];
  for (const connection of connections) {
    const apiKey = await sessionKey(ctx, userId, connection, options);
    if (typeof apiKey !== "string") {
      await noteResult(ctx, connection.id, apiKey.code);
      return apiKey;
    }
    for (const itemId of connection.itemIds) {
      const rows = await pluggyInvestments(apiKey, itemId, options).catch(failure);
      if (!Array.isArray(rows)) {
        await noteResult(ctx, connection.id, rows.code);
        return rows;
      }
      investments.push(...rows);
    }
    await noteResult(ctx, connection.id, null);
  }
  return { ok: true, ...feedPortfolioOf(investments) };
}
