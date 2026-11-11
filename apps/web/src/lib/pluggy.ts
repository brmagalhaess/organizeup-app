// Cliente da API da Pluggy (ADR-0038), só com o que a conexão usa: trocar as chaves da pessoa por uma chave
// de sessão e ler contas, lançamentos e investimentos. Roda só no servidor, a pedido da própria pessoa, e
// nunca dentro de `withHousehold` (regra 9). Nenhum erro leva texto da Pluggy nem do banco: só o código.
import "server-only";
import {
  cleanFileText,
  type BankFeedError,
  type FeedInvestment,
  type FeedTransaction,
} from "@organizeup/domain";

const API_URL = "https://api.pluggy.ai";
const TIMEOUT_MS = 20_000;
const PAGE_SIZE = 500;
/** Teto de páginas por busca: uma resposta defeituosa não prende a requisição. */
const MAX_PAGES = 40;
/** Folga acima do teto de linhas do extrato: o corte fino é do domínio. */
const MAX_TRANSACTIONS = 6000;

export class PluggyError extends Error {
  constructor(readonly code: BankFeedError) {
    super(`pluggy_${code}`);
    this.name = "PluggyError";
  }
}

export interface PluggyOptions {
  fetcher?: typeof fetch;
  baseUrl?: string;
}

export interface PluggyAccount {
  id: string;
  itemId: string;
  kind: "corrente" | "poupanca" | "cartao";
  name: string;
  numberTail: string | null;
  currency: string;
  /** Só em cartão, quando a instituição informa: servem de sugestão no formulário. */
  closingDay: number | null;
  dueDay: number | null;
}

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null;
const text = (value: unknown) => (typeof value === "string" ? value : null);
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

async function call(
  path: string,
  init: { apiKey?: string; query?: Record<string, string>; body?: Json },
  options: PluggyOptions,
): Promise<Json> {
  const url = new URL(`${(options.baseUrl ?? API_URL).replace(/\/+$/, "")}/${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, {
      method: init.body ? "POST" : "GET",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.apiKey ? { "X-API-KEY": init.apiKey } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PluggyError("rede");
  }
  if (!response.ok) {
    // O corpo do erro não é lido: pode trazer dados da pessoa.
    await response.body?.cancel().catch(() => undefined);
    const { status } = response;
    if (!init.apiKey) throw new PluggyError(status >= 500 ? "rede" : "credenciais");
    if (status === 401) throw new PluggyError("credenciais");
    if (status === 403) throw new PluggyError("sem_acesso");
    if (status === 400 || status === 404) throw new PluggyError("conexao");
    if (status === 429) throw new PluggyError("limite");
    throw new PluggyError(status >= 500 ? "rede" : "resposta");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) throw new PluggyError("resposta");
  return body;
}

/** Dia do mês de uma data `AAAA-MM-DD…`. */
const dayOf = (value: unknown): number | null => {
  const match = /^\d{4}-\d{2}-(\d{2})/.exec(text(value) ?? "");
  const day = match ? Number(match[1]) : 0;
  return day >= 1 && day <= 31 ? day : null;
};

const results = (body: Json): Json[] => {
  if (!Array.isArray(body.results)) throw new PluggyError("resposta");
  return body.results.filter(isRecord);
};

/** Troca Client ID e Client Secret pela chave de sessão, que vale duas horas. */
export async function pluggyKey(
  clientId: string,
  clientSecret: string,
  options: PluggyOptions = {},
): Promise<string> {
  const body = await call("auth", { body: { clientId, clientSecret } }, options);
  const apiKey = text(body.apiKey);
  if (!apiKey) throw new PluggyError("resposta");
  return apiKey;
}

/**
 * Confere que a conexão existe para esta aplicação. Conexão criada em outra aplicação do mesmo painel não é
 * erro em `/accounts`: a Pluggy só devolve uma lista vazia. Aqui ela é recusada, e a tela consegue explicar.
 */
export async function pluggyItem(
  apiKey: string,
  itemId: string,
  options: PluggyOptions = {},
): Promise<void> {
  const body = await call(`items/${encodeURIComponent(itemId)}`, { apiKey }, options).catch(
    (error: unknown) => {
      // Sem acesso a esta conexão é o mesmo que não a ter: ela é de outra aplicação.
      if (error instanceof PluggyError && error.code === "sem_acesso") {
        throw new PluggyError("conexao");
      }
      throw error;
    },
  );
  if (text(body.id)?.toLowerCase() !== itemId.toLowerCase()) throw new PluggyError("conexao");
}

/** Contas e cartões de uma conexão. */
export async function pluggyAccounts(
  apiKey: string,
  itemId: string,
  options: PluggyOptions = {},
): Promise<PluggyAccount[]> {
  const body = await call("accounts", { apiKey, query: { itemId } }, options);
  const accounts: PluggyAccount[] = [];
  for (const row of results(body)) {
    const id = text(row.id);
    if (!id) continue;
    const kind =
      row.type === "CREDIT"
        ? "cartao"
        : row.subtype === "SAVINGS_ACCOUNT"
          ? "poupanca"
          : "corrente";
    const digits = (text(row.number) ?? "").replace(/\D/g, "");
    const bank = isRecord(row.bankData) ? row.bankData : {};
    const credit = isRecord(row.creditData) ? row.creditData : {};
    // A mesma instituição pode mandar duas contas com o mesmo nome e número: o código do banco as separa.
    const bankCode = /^(\d{3})\//.exec(text(bank.transferNumber) ?? "")?.[1];
    const label = cleanFileText(row.marketingName, 100) || cleanFileText(row.name, 100) || kind;
    accounts.push({
      id,
      itemId,
      kind,
      name: bankCode ? `${label} · ${bankCode}` : label,
      numberTail: digits.length >= 4 ? digits.slice(-4) : null,
      currency: /^[A-Z]{3}$/.test(text(row.currencyCode) ?? "")
        ? (row.currencyCode as string)
        : "BRL",
      closingDay: dayOf(credit.balanceCloseDate),
      dueDay: dayOf(credit.balanceDueDate),
    });
  }
  return accounts;
}

/** Lançamentos de uma conta no período, seguindo o cursor até o fim. */
export async function pluggyTransactions(
  apiKey: string,
  accountId: string,
  period: { from: string; to: string },
  options: PluggyOptions = {},
): Promise<FeedTransaction[]> {
  const transactions: FeedTransaction[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES && transactions.length < MAX_TRANSACTIONS; page += 1) {
    const query: Record<string, string> = { accountId, dateFrom: period.from, dateTo: period.to };
    if (after) query.after = after;
    const body = await call("v2/transactions", { apiKey, query }, options);
    for (const row of results(body)) {
      const id = text(row.id);
      const date = text(row.date);
      if (!id || !date) continue;
      const card = isRecord(row.creditCardMetadata) ? row.creditCardMetadata : {};
      transactions.push({
        id,
        date,
        description: text(row.description),
        descriptionRaw: text(row.descriptionRaw),
        type: text(row.type),
        amount: number(row.amount),
        status: text(row.status),
        installmentNumber: number(card.installmentNumber),
        totalInstallments: number(card.totalInstallments),
        purchaseDate: text(card.purchaseDate),
      });
    }
    // `next` é o endereço da página seguinte: só o cursor interessa.
    const next = text(body.next);
    const cursor = next ? new URL(next, API_URL).searchParams.get("after") : null;
    if (!cursor || cursor === after) break;
    after = cursor;
  }
  return transactions;
}

/** Investimentos de uma conexão, de todas as páginas. */
export async function pluggyInvestments(
  apiKey: string,
  itemId: string,
  options: PluggyOptions = {},
): Promise<FeedInvestment[]> {
  const investments: FeedInvestment[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await call(
      "investments",
      { apiKey, query: { itemId, pageSize: String(PAGE_SIZE), page: String(page) } },
      options,
    );
    for (const row of results(body)) {
      const id = text(row.id);
      if (!id) continue;
      investments.push({
        id,
        code: text(row.code),
        name: text(row.name),
        type: text(row.type),
        subtype: text(row.subtype),
        quantity: number(row.quantity),
        value: number(row.value),
        amount: number(row.amount),
        amountOriginal: number(row.amountOriginal),
        status: text(row.status),
      });
    }
    if (page >= (number(body.totalPages) ?? 1)) break;
  }
  return investments;
}
