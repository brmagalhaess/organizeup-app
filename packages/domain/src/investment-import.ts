// Compara o que veio do arquivo com a carteira (ADR-0024). Puro: o servidor roda de novo na confirmação,
// dentro da transação, e só grava o que este plano mandar.
//
// Identidade: a B3 não dá um número comum à Negociação e à nota, então a chave é a própria operação, por
// ativo, sentido e data. Primeiro iguala quantidade e preço, linha a linha. O que sobra no dia vale como a
// mesma operação se a soma fechar, porque uma nota pode juntar o que a Negociação separa. Sobrou e não fecha
// ou tem operação igual a poucos dias: desmarcada, para a pessoa decidir.
import { shareFees } from "./brokerage-note";
import { isUnitPriced, positionOf, type StockEvent, type TradeInput } from "./investment";
import type { IgnoreReason, ParsedPosition, ParsedTrade } from "./investment-file";
import { normalizeTicker } from "./market";
import { money, type MoneyValue } from "./money";

/** Preço médio de uma nota que agrupa negócios vem arredondado: meio centavo por ação, mais o da linha. */
const PRICE_ROUNDING = "0.005";
const LINE_ROUNDING = "0.02";
/** Movimentação estima a data e não conhece feriado: fica a dúvida até tantos dias de distância. */
export const NEAR_TRADE_DAYS = 4;

export interface KnownTrade extends TradeInput {
  id: string;
  transactionId: string | null;
}

export interface KnownHolding {
  id: string;
  name: string;
  ticker: string | null;
  assetClass: string;
  trades: KnownTrade[];
  events: StockEvent[];
}

export interface CatalogAsset {
  ticker: string;
  name: string;
  assetClass: "acao" | "fii" | "etf_bdr";
  close: string | null;
}

export type ImportState =
  /** Será criada. */
  | "novo"
  /** Já existe, e a nota traz as taxas que faltavam. */
  | "taxas"
  /** Pode repetir algo: fica desmarcada. */
  | "conferir"
  | "existe"
  | "ignorado";

export type ImportDoubt = "parecida" | "nota_nao_fecha";

export interface FeeUpdate {
  tradeId: string;
  fees: string;
}

export interface PlannedTrade extends ParsedTrade {
  state: ImportState;
  /** Por que está em `conferir`. */
  doubtReason: ImportDoubt | null;
  /** Por que está em `ignorado`. */
  ignoreReason: IgnoreReason | null;
  feeUpdates: FeeUpdate[];
}

export interface NewAsset {
  ticker: string;
  name: string;
  /** Null: fora do catálogo e o código não diz o tipo; a pessoa escolhe. */
  assetClass: CatalogAsset["assetClass"] | null;
  inCatalog: boolean;
}

export type UnitPricedClass = CatalogAsset["assetClass"];

const SHARE_DIGITS: Record<string, string> = { ON: "3", PN: "4", PNA: "5", PNB: "6", UNT: "11" };
const FUND_MARK = "CI";
const TITLE_NOISE = /^(N1|N2|NM|MA|MB|DRN|EJ|ED|EDJ|ER|EDR|ES|EB|EG|EC|EA|ATZ|INT)$/;

const plainName = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(" ")
    .filter((token) => token && !TITLE_NOISE.test(token));

/** Empresa e tipo da ação num título: "PETROBRAS PN N2" vira PETROBRAS e PN. */
function titleParts(title: string) {
  const tokens = plainName(title);
  const kindAt = tokens.findLastIndex((token) => token in SHARE_DIGITS || token === FUND_MARK);
  if (kindAt < 0) return { company: tokens.join(" "), kind: null };
  return { company: tokens.slice(0, kindAt).join(" "), kind: tokens[kindAt]! };
}

const digitsOf = (ticker: string) => ticker.replace(/^[A-Z]+/, "");

/**
 * Código de um título da nota, pelo catálogo e pela carteira. Só responde quando um único ativo bate. Sem
 * isso, a pessoa informa o código na prévia: a nota escreve o nome da empresa e cada corretora abrevia do
 * seu jeito.
 */
export function tickerOfTitle(
  title: string,
  known: Array<{ ticker: string | null; name: string }>,
): string | null {
  const wanted = titleParts(title);
  if (!wanted.company) return null;
  const found = new Set<string>();
  for (const asset of known) {
    const ticker = normalizeTicker(asset.ticker);
    if (!ticker) continue;
    const parts = titleParts(asset.name);
    if (parts.company !== wanted.company) continue;
    const digits = wanted.kind ? SHARE_DIGITS[wanted.kind] : undefined;
    if (wanted.kind && parts.kind !== wanted.kind && digits !== digitsOf(ticker)) continue;
    found.add(ticker);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** Preenche o código das linhas da nota: primeiro o que a pessoa digitou, depois catálogo e carteira. */
export function withResolvedTickers(
  trades: ParsedTrade[],
  known: Array<{ ticker: string | null; name: string }>,
  typed: Record<string, string> = {},
): ParsedTrade[] {
  const memo = new Map<string, string | null>();
  return trades.map((trade) => {
    if (trade.ticker || !trade.title) return trade;
    const title = trade.title;
    if (!memo.has(title)) {
      memo.set(title, normalizeTicker(typed[title]) ?? tickerOfTitle(title, known));
    }
    return { ...trade, ticker: memo.get(title) ?? null };
  });
}

/** Tipo pelo código, só quando não há dúvida: final 11 pode ser FII, ETF ou unit. */
export function guessAssetClass(ticker: string): CatalogAsset["assetClass"] | null {
  const digits = Number(digitsOf(ticker));
  if (digits >= 3 && digits <= 8) return "acao";
  if (digits >= 31 && digits <= 39) return "etf_bdr";
  return null;
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const grossOf = (row: Pick<TradeInput, "quantity" | "unitPrice">): MoneyValue =>
  money(row.quantity).times(row.unitPrice);
const sumOf = (values: MoneyValue[]) => values.reduce((acc, value) => acc.plus(value), money(0));

/**
 * A mesma operação escrita com outro agrupamento: o número de linhas muda e as somas fecham. Linha contra
 * linha com preço diferente é outra coisa, e fica para a pessoa decidir.
 */
function sameOperation(lines: PlannedTrade[], trades: KnownTrade[]): boolean {
  if (lines.length === trades.length) return false;
  const quantity = sumOf(lines.map((row) => money(row.quantity)));
  if (!quantity.eq(sumOf(trades.map((row) => money(row.quantity))))) return false;
  const gap = sumOf(lines.map(grossOf))
    .minus(sumOf(trades.map(grossOf)))
    .abs();
  return gap.lte(quantity.times(PRICE_ROUNDING).plus(LINE_ROUNDING));
}

function holdingsByTicker(holdings: KnownHolding[]) {
  return new Map(
    holdings.flatMap((holding) => {
      const ticker = normalizeTicker(holding.ticker);
      return ticker ? [[ticker, holding] as const] : [];
    }),
  );
}

/** Taxas da nota numa operação já registrada sem taxa e sem lançamento em conta. */
function feeUpdatesFor(lines: PlannedTrade[], trades: KnownTrade[]): FeeUpdate[] {
  const total = sumOf(lines.map((row) => money(row.fees)));
  if (total.lte(0) || lines.some((row) => row.doubt !== null)) return [];
  if (trades.some((trade) => trade.transactionId !== null || money(trade.fees).gt(0))) return [];
  const shares = shareFees(
    total.toFixed(2),
    trades.map((trade) => grossOf(trade).toFixed()),
  );
  return trades.map((trade, index) => ({ tradeId: trade.id, fees: shares[index]! }));
}

function markSame(lines: PlannedTrade[], trades: KnownTrade[]) {
  const updates = feeUpdatesFor(lines, trades);
  for (const row of lines) row.state = "existe";
  if (updates.length > 0) {
    lines[0]!.state = "taxas";
    lines[0]!.feeUpdates = updates;
  }
}

/** Passa pelos dias do arquivo igualando com a carteira e devolve as operações que ninguém usou. */
function matchDays(rows: PlannedTrade[], holdings: Map<string, KnownHolding>) {
  const used = new Set<string>();
  const days = new Map<string, PlannedTrade[]>();
  for (const row of rows) {
    if (row.state !== "novo") continue;
    const key = `${row.ticker}|${row.side}|${row.date}`;
    days.set(key, [...(days.get(key) ?? []), row]);
  }
  for (const lines of days.values()) {
    const [first] = lines;
    const pool = (holdings.get(first!.ticker!)?.trades ?? []).filter(
      (trade) => trade.side === first!.side && trade.occurredOn === first!.date,
    );
    const rest: PlannedTrade[] = [];
    for (const row of lines) {
      const twin = pool.find(
        (trade) =>
          !used.has(trade.id) &&
          money(trade.quantity).eq(row.quantity) &&
          money(trade.unitPrice).eq(row.unitPrice),
      );
      if (twin) {
        used.add(twin.id);
        markSame([row], [twin]);
      } else {
        rest.push(row);
      }
    }
    const left = pool.filter((trade) => !used.has(trade.id));
    if (rest.length === 0 || left.length === 0) continue;
    for (const trade of left) used.add(trade.id);
    if (sameOperation(rest, left)) {
      markSame(rest, left);
    } else {
      for (const row of rest) {
        row.state = "conferir";
        row.doubtReason = "parecida";
      }
    }
  }
  return { days, used };
}

/** Mesma quantidade a poucos dias, em operação que nada do arquivo explicou. */
function markNearby(
  days: Map<string, PlannedTrade[]>,
  used: Set<string>,
  holdings: Map<string, KnownHolding>,
) {
  for (const lines of days.values()) {
    const fresh = lines.filter((row) => row.state === "novo");
    if (fresh.length === 0) continue;
    const { ticker, side, date } = fresh[0]!;
    const quantity = sumOf(fresh.map((row) => money(row.quantity)));
    const near = (holdings.get(ticker!)?.trades ?? []).filter(
      (trade) =>
        !used.has(trade.id) &&
        trade.side === side &&
        Math.abs(dayNumber(trade.occurredOn) - dayNumber(date)) <= NEAR_TRADE_DAYS,
    );
    const byDay = new Map<string, MoneyValue>();
    for (const trade of near) {
      byDay.set(trade.occurredOn, (byDay.get(trade.occurredOn) ?? money(0)).plus(trade.quantity));
    }
    if ([...byDay.values()].some((value) => value.eq(quantity))) {
      for (const row of fresh) {
        row.state = "conferir";
        row.doubtReason = "parecida";
      }
    }
  }
}

const chronological = (a: PlannedTrade, b: PlannedTrade) =>
  a.date.localeCompare(b.date) || a.side.localeCompare(b.side) || a.line - b.line;

/**
 * Venda maior que a posição é recusada, como no cadastro. As compras do arquivo contam, em ordem de data; a
 * família pode ter comprado antes do período baixado, e aí a linha fica de fora até vir o arquivo anterior.
 */
function refuseOversold(
  rows: PlannedTrade[],
  holdings: Map<string, KnownHolding>,
  willCreate: (row: PlannedTrade) => boolean,
) {
  const tickers = new Set(rows.filter(willCreate).map((row) => row.ticker!));
  for (const ticker of tickers) {
    const holding = holdings.get(ticker);
    const events = holding?.events ?? [];
    const base: TradeInput[] = holding?.trades ?? [];
    if (positionOf(base, events).oversold) continue;
    const created = rows.filter((row) => row.ticker === ticker && willCreate(row));
    const asTrade = (row: PlannedTrade): TradeInput => ({
      side: row.side,
      occurredOn: row.date,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      fees: row.fees,
    });
    if (!positionOf([...base, ...created.map(asTrade)], events).oversold) continue;
    const accepted = [...base];
    for (const row of [...created].sort(chronological)) {
      const next = [...accepted, asTrade(row)];
      if (row.side === "venda" && positionOf(next, events).oversold) {
        row.state = "ignorado";
        row.ignoreReason = "venda_maior_que_posicao";
        row.doubtReason = null;
      } else {
        accepted.push(asTrade(row));
      }
    }
  }
}

export interface ImportPlanInput {
  trades: ParsedTrade[];
  holdings: KnownHolding[];
  /** Na confirmação: as linhas que a pessoa marcou. Na prévia: as que nascem marcadas. */
  selected?: ReadonlySet<number>;
}

/** Marcada por padrão: criar o que é novo e completar taxa. O resto só com a pessoa pedindo. */
export const selectedByDefault = (row: PlannedTrade) =>
  row.state === "novo" || row.state === "taxas";

const creates = (row: PlannedTrade) => row.state === "novo" || row.state === "conferir";

export function planInvestmentImport(input: ImportPlanInput): PlannedTrade[] {
  const holdings = holdingsByTicker(input.holdings);
  const rows = input.trades.map((trade): PlannedTrade => {
    const planned: PlannedTrade = {
      ...trade,
      state: "novo",
      doubtReason: null,
      ignoreReason: null,
      feeUpdates: [],
    };
    const holding = trade.ticker ? holdings.get(trade.ticker) : undefined;
    if (!trade.ticker) {
      planned.state = "ignorado";
      planned.ignoreReason = "sem_codigo";
    } else if (holding && !isUnitPriced(holding.assetClass)) {
      planned.state = "ignorado";
      planned.ignoreReason = "classe_sem_cotacao";
    }
    return planned;
  });
  const { days, used } = matchDays(rows, holdings);
  markNearby(days, used, holdings);
  for (const row of rows) {
    if (row.state === "novo" && row.doubt) {
      row.state = "conferir";
      row.doubtReason = row.doubt;
    }
  }
  const { selected } = input;
  refuseOversold(rows, holdings, (row) =>
    selected ? creates(row) && selected.has(row.line) : row.state === "novo",
  );
  return rows;
}

/** Ativos que nascem com esta importação, com nome e tipo do catálogo quando ele conhece. */
export function newAssetsOf(
  rows: Array<{ ticker: string | null; name?: string | null }>,
  holdings: KnownHolding[],
  catalog: ReadonlyMap<string, CatalogAsset>,
): NewAsset[] {
  const owned = holdingsByTicker(holdings);
  const assets = new Map<string, NewAsset>();
  for (const row of rows) {
    if (!row.ticker || owned.has(row.ticker) || assets.has(row.ticker)) continue;
    const entry = catalog.get(row.ticker);
    assets.set(row.ticker, {
      ticker: row.ticker,
      name: entry?.name ?? row.name ?? row.ticker,
      assetClass: entry?.assetClass ?? guessAssetClass(row.ticker),
      inCatalog: entry !== undefined,
    });
  }
  return [...assets.values()];
}

export type PositionState =
  /** A quantidade bate com a carteira. */
  | "confere"
  /** A B3 mostra mais que a carteira: com o preço pago, a diferença entra. */
  | "falta"
  /** A carteira tem mais que a B3: nada muda, a pessoa olha. */
  | "sobra"
  | "ignorado";

export interface PlannedPosition extends ParsedPosition {
  state: PositionState;
  /** O que a carteira tem hoje. */
  held: string;
  /** B3 menos carteira. */
  difference: string;
}

/**
 * A Posição não traz data nem preço pago, então nunca vira operação sozinha: compara com a carteira e, no que
 * falta, só grava com o preço que a pessoa digitar. Depois de gravar, a quantidade bate e a linha confere.
 */
export function planPositions(
  positions: ParsedPosition[],
  holdings: KnownHolding[],
): PlannedPosition[] {
  const owned = holdingsByTicker(holdings);
  return positions.map((position) => {
    const holding = owned.get(position.ticker);
    const held = holding ? positionOf(holding.trades, holding.events).quantity : "0";
    const difference = money(position.quantity).minus(held);
    const unsupported = holding !== undefined && !isUnitPriced(holding.assetClass);
    const state: PositionState = unsupported
      ? "ignorado"
      : difference.isZero()
        ? "confere"
        : difference.gt(0)
          ? "falta"
          : "sobra";
    return { ...position, state, held, difference: difference.toFixed() };
  });
}
