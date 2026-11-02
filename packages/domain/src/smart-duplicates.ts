// Duplicidade do importador (ADR-0030): compara cada item com o que a família já tem e com os arquivos
// anteriores do mesmo lote. Puro. Reaproveita `reconcileRows` (impressão digital e valor a poucos dias),
// `planInvestmentImport` (operação como identidade) e `matchKnownDebt`. Roda de novo na gravação.
import { matchKnownDebt, type DebtExtraction, type KnownDebt } from "./debt-file";
import { planInvestmentImport, type KnownHolding, type PlannedTrade } from "./investment-import";
import type { ParsedTrade } from "./investment-file";
import { money } from "./money";
import { yearMonthOf } from "./cashflow";
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

export interface SmartItemRef {
  id: string;
  fileId: string;
  payload: SmartPayload;
}

export interface SmartKnown {
  realized: KnownEntry[];
  forecasts: KnownEntry[];
  purchases: Array<{ description: string; amount: string; date: string }>;
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
}

const fresh: SmartVerdict = {
  duplicate: "novo",
  reason: null,
  otherFileId: null,
  matchKey: null,
  matchMonth: null,
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

function byFile(items: SmartItemRef[]) {
  const files = new Map<string, SmartItemRef[]>();
  for (const item of items) files.set(item.fileId, [...(files.get(item.fileId) ?? []), item]);
  return files;
}

/** Lançamentos e compras, arquivo por arquivo: o primeiro de um par fica novo, o segundo aponta para ele. */
function judgeMoney(items: SmartItemRef[], known: SmartKnown, out: Map<string, SmartVerdict>) {
  const pool: KnownEntry[] = [
    ...known.realized,
    ...known.purchases.map((row, index) => ({
      key: `c:${index}`,
      description: row.description,
      amount: row.amount,
      date: row.date,
      kind: "despesa" as const,
    })),
  ];
  const foreignPrints = new Map<string, string>();
  for (const [fileId, group] of byFile(items.filter(isMoney))) {
    const rows = group.flatMap((item) => {
      const row = isMoney(item) ? rowOf(item) : null;
      return row ? [{ item, row }] : [];
    });
    if (rows.length === 0) continue;
    // Previsão só dá baixa de lançamento: compra de cartão não paga conta prevista.
    const entryRows = rows.filter(({ item }) => item.payload.destination === "lancamento");
    const reconciled = new Map(
      reconcileRows(
        rows.map(({ row }) => row),
        { realized: pool, forecasts: entryRows.length === rows.length ? known.forecasts : [] },
      ).map((row) => [row.fingerprint, row]),
    );
    for (const { item, row } of rows) {
      const result = reconciled.get(row.fingerprint)!;
      const other = foreignPrints.get(row.fingerprint);
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
      if (row.fingerprint.startsWith("item:")) {
        pool.push({ ...row, key: fileKey(fileId, item.id), fingerprint: null });
        continue;
      }
      if (!foreignPrints.has(row.fingerprint)) foreignPrints.set(row.fingerprint, fileId);
      pool.push({ ...row, key: fileKey(fileId, item.id), fingerprint: null });
    }
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
  for (const [fileId, group] of byFile(items.filter(isCompleteTrade))) {
    const trades = group as TradeItem[];
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
      pending.set(ticker, [
        ...(pending.get(ticker) ?? []),
        {
          id: `lote:${item.id}`,
          transactionId: null,
          side: side!,
          occurredOn: date!,
          quantity: quantity!,
          unitPrice: unitPrice!,
          fees,
          fileId,
        },
      ]);
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
    names: new Map<string, string>(),
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

/** Em ordem de arquivo. Item sem dado para comparar sai como novo: a falta aparece na revisão. */
export function planSmartDuplicates(
  items: SmartItemRef[],
  known: SmartKnown,
  shaOf: (fileId: string) => string | undefined = () => undefined,
): Map<string, SmartVerdict> {
  const out = new Map<string, SmartVerdict>();
  judgeMoney(items, known, out);
  judgeTrades(items, known, out);
  judgeOthers(items, known, shaOf, out);
  return out;
}
