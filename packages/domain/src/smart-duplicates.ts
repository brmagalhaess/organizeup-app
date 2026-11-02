// Duplicidade do importador (ADR-0030): compara cada item com o que a família já tem e com os arquivos
// anteriores do mesmo lote. Puro. Reaproveita `reconcileRows` (impressão digital e valor a poucos dias),
// `planInvestmentImport` (operação como identidade) e `matchKnownDebt`. Roda de novo na gravação.
import { yearMonthOf } from "./cashflow";
import { matchKnownDebt, type DebtExtraction, type KnownDebt } from "./debt-file";
import { planInvestmentImport, type KnownHolding, type PlannedTrade } from "./investment-import";
import type { ParsedTrade } from "./investment-file";
import { money, toDbAmount } from "./money";
import type {
  EntryPayload,
  PurchasePayload,
  SmartDuplicateState,
  SmartPayload,
  TradePayload,
} from "./smart-import";
import {
  normalizeDescription,
  reconcileRows,
  type FingerprintedRow,
  type KnownEntry,
} from "./statement";

const DIVIDEND_NEAR_DAYS = 5;
const PAYMENT_WORDS = /\b(fatura|cartao|pagamento|pagto|pgto)\b/;

export interface SmartItemRef {
  id: string;
  fileId: string;
  payload: SmartPayload;
}

export interface SmartKnown {
  realized: KnownEntry[];
  forecasts: KnownEntry[];
  purchases: Array<{ description: string; amount: string; date: string; cardId?: string | null }>;
  holdings: KnownHolding[];
  debts: KnownDebt[];
  incomes: Array<{ name: string; amount: string }>;
  plans: Array<{ description: string; amount: string; kind: string }>;
  goals: Array<{ name: string }>;
  dividends: Array<{ ticker: string | null; date: string; gross: string }>;
  /** Arquivos já guardados como documento: sha256 → id do arquivo. */
  documents: ReadonlyMap<string, string>;
}

export interface SmartVerdict {
  duplicate: SmartDuplicateState;
  reason: string | null;
  /** Arquivo do lote que tem o mesmo item. */
  otherFileId: string | null;
  /** Previsão que a linha dá baixa. */
  matchKey: string | null;
  matchMonth: string | null;
  /** Fatura do lote que esta linha paga. */
  settlesFileId: string | null;
}

const fresh: SmartVerdict = {
  duplicate: "novo",
  reason: null,
  otherFileId: null,
  matchKey: null,
  matchMonth: null,
  settlesFileId: null,
};

const seen = (reason: string, otherFileId: string | null = null): SmartVerdict => ({
  ...fresh,
  duplicate: "ja_lancado",
  reason,
  otherFileId,
});
const maybe = (reason: string, otherFileId: string | null = null): SmartVerdict => ({
  ...fresh,
  duplicate: "possivel",
  reason,
  otherFileId,
});

const RANK: Record<SmartDuplicateState, number> = { novo: 0, possivel: 1, ja_lancado: 2 };

/** A comparação de agora é pior que a da revisão: alguém gravou o mesmo item nesse meio tempo. */
export const smartVerdictWorse = (before: SmartDuplicateState, now: SmartDuplicateState) =>
  RANK[now] > RANK[before];

type Money = EntryPayload | PurchasePayload;

const isMoney = (item: SmartItemRef): item is SmartItemRef & { payload: Money } =>
  item.payload.destination === "lancamento" || item.payload.destination === "compra_cartao";

const kindOf = (payload: Money) =>
  payload.destination === "lancamento" ? payload.kind : "despesa";

/** Linha comparável. Item sem data ou valor fica de fora: quem decide é a revisão. */
function rowOf(item: SmartItemRef & { payload: Money }): FingerprintedRow | null {
  const { date, amount, description, fingerprint } = item.payload;
  if (!date || !amount) return null;
  return {
    date,
    amount,
    description: description ?? "",
    kind: kindOf(item.payload),
    fingerprint: fingerprint ?? `item:${item.id}`,
  };
}

const fileKey = (fileId: string, itemId: string) => `arquivo:${fileId}:${itemId}`;
const fileOfKey = (key: string) => (key.startsWith("arquivo:") ? key.split(":")[1]! : null);

function byFile<T extends SmartItemRef>(items: T[]) {
  const files = new Map<string, T[]>();
  for (const item of items) {
    const group = files.get(item.fileId);
    if (group) group.push(item);
    else files.set(item.fileId, [item]);
  }
  return files;
}

/** Conta e cartão escolhidos para cada arquivo. */
export type SmartScope = (fileId: string) => {
  accountId: string | null;
  cardId: string | null;
};

const NO_SCOPE: SmartScope = () => ({ accountId: null, cardId: null });

const inAccount = (entry: KnownEntry, accountId: string | null) =>
  !accountId || !entry.accountId || entry.accountId === accountId;

/** Lançamentos e compras, arquivo por arquivo: o primeiro de um par fica novo, o segundo aponta para ele. */
function judgeMoney(
  items: SmartItemRef[],
  known: SmartKnown,
  scope: SmartScope,
  out: Map<string, SmartVerdict>,
) {
  const lot: KnownEntry[] = [];
  const lotPrints = new Map<string, string>();
  for (const [fileId, group] of byFile(items.filter(isMoney))) {
    const rows = group.flatMap((item) => {
      const row = rowOf(item);
      return row ? [{ item, row }] : [];
    });
    if (rows.length === 0) continue;
    const { accountId, cardId } = scope(fileId);
    const pool: KnownEntry[] = [
      ...known.realized.filter((entry) => inAccount(entry, accountId)),
      ...known.purchases.flatMap((row, index) =>
        !cardId || !row.cardId || row.cardId === cardId
          ? [
              {
                key: `c:${index}`,
                description: row.description,
                amount: row.amount,
                date: row.date,
                kind: "despesa" as const,
              },
            ]
          : [],
      ),
      ...lot,
    ];
    // Previsão só dá baixa de lançamento: compra de cartão não paga conta prevista.
    const onlyEntries = rows.every(({ item }) => item.payload.destination === "lancamento");
    const reconciled = new Map(
      reconcileRows(
        rows.map(({ row }) => row),
        {
          realized: pool,
          forecasts: onlyEntries
            ? known.forecasts.filter((entry) => inAccount(entry, accountId))
            : [],
        },
      ).map((row) => [row.fingerprint, row]),
    );
    for (const { item, row } of rows) {
      const result = reconciled.get(row.fingerprint)!;
      const other = lotPrints.get(row.fingerprint);
      if (other) out.set(item.id, seen("mesmo_item", other));
      else if (result.state === "importado") out.set(item.id, seen("impressao_digital"));
      else if (result.state === "previsto" && result.match) {
        out.set(item.id, {
          ...fresh,
          matchKey: result.match.key,
          matchMonth: yearMonthOf(result.match.date),
        });
      } else if (result.state === "lancado" && result.match) {
        const otherFile = fileOfKey(result.match.key);
        out.set(item.id, maybe(otherFile ? "outro_arquivo" : "valor_parecido", otherFile));
      } else out.set(item.id, fresh);
    }
    for (const { item, row } of rows) {
      if (!row.fingerprint.startsWith("item:") && !lotPrints.has(row.fingerprint)) {
        lotPrints.set(row.fingerprint, fileId);
      }
      lot.push({
        key: fileKey(fileId, item.id),
        description: row.description,
        amount: row.amount,
        date: row.date,
        kind: row.kind,
      });
    }
  }
}

/**
 * Pagamento da fatura no extrato e as compras da mesma fatura contariam o dinheiro duas vezes. A linha que fecha
 * com a soma das compras de outro arquivo vira possível duplicado; aprovada, ela dá baixa na fatura.
 */
function judgePayments(items: SmartItemRef[], out: Map<string, SmartVerdict>) {
  const totals = new Map<string, { sum: ReturnType<typeof money>; count: number }>();
  for (const { fileId, payload } of items) {
    if (payload.destination !== "compra_cartao" || !payload.amount) continue;
    const total = totals.get(fileId) ?? { sum: money(0), count: 0 };
    totals.set(fileId, { sum: total.sum.plus(payload.amount), count: total.count + 1 });
  }
  if (totals.size === 0) return;
  const byAmount = new Map(
    [...totals].map(([fileId, total]) => [toDbAmount(total.sum), { fileId, count: total.count }]),
  );
  for (const item of items) {
    const { payload } = item;
    if (payload.destination !== "lancamento" || payload.kind !== "despesa") continue;
    if (!payload.amount) continue;
    const found = byAmount.get(payload.amount);
    if (!found || found.fileId === item.fileId) continue;
    // Uma compra só pode ser a própria compra, vista no extrato: aí precisa dizer que é pagamento.
    const words = normalizeDescription(payload.description ?? "");
    if (found.count < 2 && !PAYMENT_WORDS.test(words)) continue;
    out.set(item.id, { ...maybe("pagamento_fatura", found.fileId), settlesFileId: found.fileId });
  }
}

export const toParsedTrade = (payload: TradePayload): ParsedTrade => ({
  line: payload.line,
  ticker: payload.ticker,
  title: payload.title,
  side: payload.side ?? "compra",
  date: payload.date ?? "",
  quantity: payload.quantity ?? "0",
  unitPrice: payload.unitPrice ?? "0",
  fees: payload.fees,
  doubt: payload.doubt,
});

type TradeItem = SmartItemRef & { payload: TradePayload };

const isCompleteTrade = (item: SmartItemRef): item is TradeItem =>
  item.payload.destination === "operacao" &&
  item.payload.side !== null &&
  item.payload.date !== null &&
  item.payload.quantity !== null &&
  item.payload.unitPrice !== null;

const planLines = (rows: PlannedTrade[]) => new Map(rows.map((row) => [row.line, row]));

/** Operações do lote viram carteira de faz de conta para o arquivo seguinte: nota e Negociação se acham. */
function judgeTrades(items: SmartItemRef[], known: SmartKnown, out: Map<string, SmartVerdict>) {
  const pending = new Map<string, Array<KnownHolding["trades"][number] & { fileId: string }>>();
  for (const [fileId, trades] of byFile(items.filter(isCompleteTrade))) {
    const parsed = trades.map((item) => toParsedTrade(item.payload));
    const real = planLines(planInvestmentImport({ trades: parsed, holdings: known.holdings }));
    const tickers = new Set(known.holdings.map((holding) => holding.ticker));
    const withLot: KnownHolding[] = [
      ...known.holdings.map((holding) => ({
        ...holding,
        trades: [...holding.trades, ...(pending.get(holding.ticker ?? "") ?? [])],
      })),
      ...[...pending.entries()]
        .filter(([ticker]) => !tickers.has(ticker))
        .map(([ticker, lot]) => ({
          id: `lote:${ticker}`,
          name: ticker,
          ticker,
          assetClass: "acao",
          trades: lot,
          events: [],
        })),
    ];
    const lot = planLines(planInvestmentImport({ trades: parsed, holdings: withLot }));
    for (const item of trades) {
      const row = real.get(item.payload.line)!;
      const inLot = lot.get(item.payload.line)!;
      if (row.state === "existe" || row.state === "taxas") {
        out.set(item.id, seen("operacao_igual"));
      } else if (row.state === "conferir") {
        out.set(item.id, maybe(row.doubtReason ?? "parecida"));
      } else if (row.state === "ignorado") {
        out.set(item.id, maybe(row.ignoreReason ?? "ignorada"));
      } else if (inLot.state === "existe" || inLot.state === "conferir") {
        const other = pending
          .get(item.payload.ticker ?? "")
          ?.find((trade) => trade.fileId !== fileId);
        out.set(item.id, maybe("outro_arquivo", other?.fileId ?? null));
      } else out.set(item.id, fresh);
    }
    for (const item of trades) {
      const { ticker, side, date, quantity, unitPrice, fees } = item.payload;
      if (!ticker) continue;
      const entry = {
        id: `lote:${item.id}`,
        transactionId: null,
        side: side!,
        occurredOn: date!,
        quantity: quantity!,
        unitPrice: unitPrice!,
        fees,
        fileId,
      };
      const list = pending.get(ticker);
      if (list) list.push(entry);
      else pending.set(ticker, [entry]);
    }
  }
}

const samePlainName = (a: string, b: string) =>
  normalizeDescription(a) !== "" && normalizeDescription(a) === normalizeDescription(b);

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

const debtFound = (payload: Extract<SmartPayload, { destination: "divida" | "consorcio" }>) =>
  ({
    creditor: { value: payload.name, confidence: "alta" },
    installmentAmount: { value: payload.installmentAmount, confidence: "alta" },
    installments: { value: payload.installments, confidence: "alta" },
  }) as DebtExtraction;

function judgeOthers(
  items: SmartItemRef[],
  known: SmartKnown,
  shaOf: (fileId: string) => string | undefined,
  out: Map<string, SmartVerdict>,
) {
  const lot = {
    debts: new Map<string, string>(),
    dividends: new Map<string, string>(),
  };
  for (const item of items) {
    const { payload, fileId } = item;
    let verdict = fresh;
    switch (payload.destination) {
      case "divida":
      case "consorcio": {
        const key = normalizeDescription(payload.name ?? "");
        const other = key ? lot.debts.get(key) : undefined;
        if (matchKnownDebt(debtFound(payload), known.debts)) verdict = maybe("divida_parecida");
        else if (other && other !== fileId) verdict = maybe("outro_arquivo", other);
        if (key && !lot.debts.has(key)) lot.debts.set(key, fileId);
        break;
      }
      case "renda": {
        const { name, amount } = payload;
        const same = known.incomes.some(
          (row) =>
            (name && samePlainName(row.name, name)) ||
            (amount !== null && money(row.amount).eq(amount)),
        );
        if (same) verdict = maybe("renda_parecida");
        break;
      }
      case "previsao": {
        const { description, amount, kind } = payload;
        const same = known.plans.some(
          (row) =>
            row.kind === kind &&
            ((description && samePlainName(row.description, description)) ||
              (amount !== null && money(row.amount).eq(amount))),
        );
        if (same) verdict = maybe("previsao_parecida");
        break;
      }
      case "meta": {
        const { name } = payload;
        if (name && known.goals.some((row) => samePlainName(row.name, name))) {
          verdict = maybe("meta_parecida");
        }
        break;
      }
      case "provento": {
        const { ticker, date, gross } = payload;
        if (!date || !gross) break;
        const near = known.dividends.filter(
          (row) =>
            row.ticker === ticker &&
            Math.abs(dayNumber(row.date) - dayNumber(date)) <= DIVIDEND_NEAR_DAYS,
        );
        const key = `${ticker}|${date}|${gross}`;
        const other = lot.dividends.get(key);
        if (near.some((row) => row.date === date && money(row.gross).eq(gross))) {
          verdict = seen("provento_igual");
        } else if (near.length > 0) verdict = maybe("provento_parecido");
        else if (other && other !== fileId) verdict = seen("mesmo_item", other);
        if (!lot.dividends.has(key)) lot.dividends.set(key, fileId);
        break;
      }
      case "documento": {
        const sha = shaOf(fileId);
        const other = sha ? known.documents.get(sha) : undefined;
        if (other && other !== fileId) verdict = seen("documento_igual");
        break;
      }
      default:
        continue;
    }
    out.set(item.id, verdict);
  }
}

export interface SmartPlanOptions {
  shaOf?: (fileId: string) => string | undefined;
  scope?: SmartScope;
}

/** Em ordem de arquivo. Item sem dado para comparar sai como novo: a falta aparece na revisão. */
export function planSmartDuplicates(
  items: SmartItemRef[],
  known: SmartKnown,
  options: SmartPlanOptions = {},
): Map<string, SmartVerdict> {
  const out = new Map<string, SmartVerdict>();
  judgeMoney(items, known, options.scope ?? NO_SCOPE, out);
  judgePayments(items, out);
  judgeTrades(items, known, out);
  judgeOthers(items, known, options.shaOf ?? (() => undefined), out);
  return out;
}
