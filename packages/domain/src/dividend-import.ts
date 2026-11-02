// Compara os proventos do arquivo com o que a família já tem (ADR-0029). Puro: o servidor roda de novo na
// confirmação, dentro da transação, e só grava o que este plano mandar.
//
// Identidade: a B3 não dá número ao provento, então a chave é investimento, tipo, data e valor. Cada linha do
// arquivo gasta uma linha do banco, para dois pagamentos iguais continuarem sendo dois. O que sobra vale como o
// mesmo provento se a soma fechar, porque a mesma ação em duas corretoras vem em duas linhas.
//
// Dias são calculados uma vez por linha, e valores viram centavos inteiros: com 2.000 linhas contra 2.000, a
// comparação roda milhões de vezes.
import { yearMonthOf } from "./cashflow";
import type { DividendIgnoreReason, ParsedDividend } from "./dividend-file";
import {
  dayNumber,
  inWindow,
  jcpRateOf,
  MARKET_RULES,
  normalizeTicker,
  proventoAmounts,
  sameProventoKind,
  type DividendKind,
  type ExistingDividend,
} from "./market";
import { money, toDbAmount, type MoneyValue } from "./money";

const CENT = "0.01";
const WINDOW = MARKET_RULES.familyMatchDays;

export interface DividendHolding {
  id: string;
  name: string;
  ticker: string | null;
  assetClass: string;
  dividends: ExistingDividend[];
}

/** Provento da fonte: dá a data-com, que o arquivo não traz. */
export interface MarketEventRef {
  id: string;
  ticker: string;
  kind: DividendKind;
  comDate: string;
  payDate: string;
}

export type DividendState = "novo" | "existe" | "conferir" | "ignorado";

export const DIVIDEND_STATES = ["novo", "existe", "conferir", "ignorado"] as const;

export const DIVIDEND_DOUBTS = [
  /** Código fora da carteira, ou em mais de um investimento: a pessoa escolhe. */
  "sem_ativo",
  /** Há linha automática com outro valor: marcar troca pelo valor do arquivo. */
  "valor_diferente",
  /** Outra linha do arquivo já responde pelo mesmo automático: esta entra junto com ela. */
  "parte_do_automatico",
  /** Há lançamento à mão por perto: marcar grava mais um. */
  "parecida",
  /** Só o valor recebido, e a alíquota depende do que o arquivo não diz. */
  "imposto_incerto",
  /** Mais de R$ 50 mil no mês da mesma empresa: pode haver retenção. */
  "acima_do_limite",
  /** A família já excluiu ou desfez este provento. */
  "excluido",
  /** O valor pode ser lido de mais de um jeito, como 1.234. */
  "valor_ambiguo",
] as const;
export type DividendDoubt = (typeof DIVIDEND_DOUBTS)[number];

export type DividendCalculation =
  /** Bruto e retido a partir do líquido, com a alíquota de JCP. */
  | "jcp_do_liquido"
  /** Retido a partir do bruto, com a alíquota de JCP. */
  | "jcp_do_bruto"
  /** Retido é bruto menos líquido. */
  | "retido_pela_diferenca"
  /** Bruto é líquido mais retido. */
  | "bruto_pela_soma";

export interface DividendAmounts {
  gross: string;
  withheld: string;
  net: string;
}

export interface PlannedDividend extends ParsedDividend {
  state: DividendState;
  investmentId: string | null;
  /** O que será gravado. Null enquanto não há investimento escolhido. */
  amounts: DividendAmounts | null;
  calculation: DividendCalculation | null;
  /** Alíquota usada, quando houve conta de JCP. */
  rate: string | null;
  doubtReason: DividendDoubt | null;
  ignoreReason: DividendIgnoreReason | null;
  /** Linha automática que a pessoa pode trocar pelo valor do arquivo. */
  replaces: string | null;
  /** O que já está gravado perto desta linha, para a tela mostrar os dois valores. */
  current: DividendAmounts | null;
  /** Linha do arquivo que troca o automático: sem ela, esta somaria por cima dele. */
  pairedWith: number | null;
}

export interface DividendImportInput {
  rows: ParsedDividend[];
  holdings: DividendHolding[];
  /** Proventos da fonte, de qualquer família: fatos públicos da bolsa. */
  events: MarketEventRef[];
  /** Provento da fonte que a família desfez ou excluiu, por investimento. */
  blocked?: ReadonlyMap<string, ReadonlySet<string>>;
  today: string;
  /** Investimento escolhido na prévia, por código. */
  assignments?: Record<string, string>;
}

interface Resolved {
  amounts: DividendAmounts;
  calculation: DividendCalculation | null;
  rate: string | null;
  uncertain: boolean;
}

const asAmounts = (gross: string, withheld: string): DividendAmounts => ({
  gross,
  withheld,
  net: toDbAmount(money(gross).minus(withheld)),
});

/** O inverso de `proventoAmounts`: o bruto cujo líquido dá o que o arquivo traz, nesta alíquota. */
export function jcpFromNet(net: string, rate: string, payDate: string, comDate: string) {
  const start = money(toDbAmount(money(net).dividedBy(money(1).minus(rate))));
  for (const shift of ["0", CENT, `-${CENT}`]) {
    const amounts = proventoAmounts({
      assetClass: "acao",
      kind: "jcp",
      quantity: "1",
      ratePerShare: start.plus(shift).toFixed(2),
      comDate,
      payDate,
    });
    if ("skip" in amounts) continue;
    if (money(amounts.gross).minus(amounts.withheld).eq(net)) return amounts;
  }
  return { gross: toDbAmount(start), withheld: toDbAmount(start.minus(net)) };
}

/** Sem data-com no arquivo: antes de 2026 tudo é 15%; depois, só a fonte diz qual vale. */
function rateFor(row: ParsedDividend, comDate: string | null) {
  const known = comDate ?? (row.paidOn < MARKET_RULES.jcpChangeOn ? row.paidOn : null);
  return known === null ? null : { comDate: known, rate: jcpRateOf(known, row.paidOn) };
}

function resolveAmounts(row: ParsedDividend, assetClass: string, comDate: string | null): Resolved {
  const { gross, withheld, net } = row;
  const plain = { calculation: null, rate: null, uncertain: false };
  if (gross !== null && withheld !== null) return { ...plain, amounts: asAmounts(gross, withheld) };
  if (gross !== null && net !== null) {
    const amounts = asAmounts(gross, toDbAmount(money(gross).minus(net)));
    return { ...plain, amounts, calculation: "retido_pela_diferenca" };
  }
  if (net !== null && withheld !== null) {
    const amounts = asAmounts(toDbAmount(money(net).plus(withheld)), withheld);
    return { ...plain, amounts, calculation: "bruto_pela_soma" };
  }
  const known = (gross ?? net)!;
  const sure = { ...plain, amounts: asAmounts(known, "0.00") };
  if (row.kind === "rendimento" && assetClass !== "fii") return { ...sure, uncertain: true };
  if (row.kind !== "jcp") return sure;
  const found = rateFor(row, comDate);
  if (!found?.rate) return { ...sure, uncertain: true };
  const { rate } = found;
  if (gross === null) {
    const inverted = jcpFromNet(known, rate, row.paidOn, found.comDate);
    return {
      amounts: asAmounts(inverted.gross, inverted.withheld),
      calculation: "jcp_do_liquido",
      rate,
      uncertain: false,
    };
  }
  const computed = proventoAmounts({
    assetClass,
    kind: "jcp",
    quantity: "1",
    ratePerShare: known,
    comDate: found.comDate,
    payDate: row.paidOn,
  });
  if ("skip" in computed) return { ...sure, uncertain: true };
  return {
    amounts: asAmounts(computed.gross, computed.withheld),
    calculation: "jcp_do_bruto",
    rate,
    uncertain: false,
  };
}

/** Centavos inteiros e exatos, calculados uma vez por linha. */
const centsOf = (value: string) => BigInt(toDbAmount(value).replace(".", ""));

const within = (a: bigint, b: bigint, cents: number) => {
  const gap = a > b ? a - b : b - a;
  return gap <= BigInt(cents);
};

const sumCents = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);

interface Stored {
  row: ExistingDividend;
  day: number;
  gross: bigint;
  net: bigint;
  manual: boolean;
  used: boolean;
  /** Linha do arquivo que ficou em conferir por causa desta. */
  pairedLine: number | null;
}

interface Pending {
  row: PlannedDividend;
  amounts: DividendAmounts;
  uncertain: boolean;
  event: EventOnDay | undefined;
  day: number;
  gross: bigint;
  net: bigint;
}

interface EventOnDay extends MarketEventRef {
  day: number;
}

const storedOf = (row: ExistingDividend): Stored => {
  const gross = centsOf(row.gross);
  return {
    row,
    day: dayNumber(row.paidOn),
    gross,
    net: gross - centsOf(row.withheld),
    manual: row.source === "familia" && row.marketDividendId === null,
    used: false,
    pairedLine: null,
  };
};

const byDay = <T extends { day: number }>(list: T[]) => list.sort((a, b) => a.day - b.day);

/** Vale o líquido, e o bruto também, porque a coluna de valor pode trazer um ou outro. */
const sameValue = (line: Pending, stored: Stored) =>
  within(line.net, stored.net, 1) ||
  within(line.gross, stored.gross, 1) ||
  within(line.net, stored.gross, 1);

const fitsKind = (line: Pending, stored: Stored) =>
  sameProventoKind(stored.row.kind, line.row.kind);

/** A candidata mais perto da data da linha. */
function closest(line: Pending, near: Stored[], accepts: (stored: Stored) => boolean) {
  let best: Stored | undefined;
  for (const stored of near) {
    if (!accepts(stored)) continue;
    if (!best || Math.abs(stored.day - line.day) < Math.abs(best.day - line.day)) best = stored;
  }
  return best;
}

const isOpen = (line: Pending) => line.row.state === "novo";

/** Linha contra linha. */
function matchTwins(lines: Pending[], stored: Stored[]) {
  for (const line of lines) {
    const twin = closest(
      line,
      inWindow(stored, line.day, WINDOW),
      (item) => !item.used && fitsKind(line, item) && sameValue(line, item),
    );
    if (twin) {
      twin.used = true;
      line.row.state = "existe";
    }
  }
}

/** Duas corretoras no arquivo, uma linha no banco. À mão, a soma pode juntar JCP e dividendo (ADR-0017). */
function matchSplitLines(lines: Pending[], stored: Stored[]) {
  const sorted = byDay([...lines]);
  for (const item of stored) {
    if (item.used) continue;
    const group = inWindow(sorted, item.day, WINDOW).filter(
      (line) => isOpen(line) && (item.manual || fitsKind(line, item)),
    );
    if (group.length < 2) continue;
    const total = sumCents(group.map((line) => line.net));
    if (within(total, item.net, group.length) || within(total, item.gross, group.length)) {
      item.used = true;
      for (const line of group) line.row.state = "existe";
    }
  }
}

/** Uma linha no arquivo, dois pagamentos no banco. */
function matchSplitStored(lines: Pending[], stored: Stored[]) {
  for (const line of lines) {
    if (!isOpen(line)) continue;
    const group = inWindow(stored, line.day, WINDOW).filter(
      (item) => !item.used && fitsKind(line, item),
    );
    if (group.length < 2) continue;
    if (within(line.net, sumCents(group.map((item) => item.net)), group.length)) {
      for (const item of group) item.used = true;
      line.row.state = "existe";
    }
  }
}

const amountsOf = ({ row }: Stored): DividendAmounts => asAmounts(row.gross, row.withheld);

/** Tem algo perto que não bate: a pessoa decide, e nada entra marcado sozinho. */
function pairDoubts(lines: Pending[], stored: Stored[]) {
  for (const line of lines) {
    if (!isOpen(line)) continue;
    const near = inWindow(stored, line.day, WINDOW);
    const paired =
      closest(line, near, (item) => !item.used && fitsKind(line, item)) ??
      closest(line, near, (item) => !item.used && item.manual);
    if (!paired) continue;
    paired.used = true;
    paired.pairedLine = line.row.line;
    const automatic = paired.row.source === "agente";
    line.row.state = "conferir";
    line.row.doubtReason = automatic ? "valor_diferente" : "parecida";
    line.row.replaces = automatic ? paired.row.id : null;
    line.row.current = amountsOf(paired);
  }
  // Sobrou linha do mesmo pagamento: como nova, somaria por cima do valor que já está lá.
  for (const line of lines) {
    if (!isOpen(line)) continue;
    const near = inWindow(stored, line.day, WINDOW);
    const paired = closest(
      line,
      near,
      (item) => item.pairedLine !== null && (fitsKind(line, item) || item.manual),
    );
    if (!paired) continue;
    const automatic = paired.row.source === "agente";
    line.row.state = "conferir";
    line.row.doubtReason = automatic ? "parte_do_automatico" : "parecida";
    line.row.pairedWith = automatic ? paired.pairedLine : null;
    line.row.current = amountsOf(paired);
  }
}

function matchExisting(lines: Pending[], existing: ExistingDividend[]) {
  const stored = byDay(existing.map(storedOf));
  matchTwins(lines, stored);
  matchSplitLines(lines, stored);
  matchSplitStored(lines, stored);
  pairDoubts(lines, stored);
}

/** Mais de R$ 50 mil no mês, e o arquivo não disse quanto foi retido. */
function overLimit(lines: Pending[], existing: ExistingDividend[]) {
  const months = new Map<string, MoneyValue>();
  const add = (date: string, gross: string) => {
    const month = yearMonthOf(date);
    months.set(month, (months.get(month) ?? money(0)).plus(gross));
  };
  for (const row of existing) if (row.kind === "dividendo") add(row.paidOn, row.gross);
  const fresh = lines.filter((line) => line.row.kind === "dividendo" && isOpen(line));
  for (const line of fresh) add(line.row.paidOn, line.amounts.gross);
  return fresh.filter(
    (line) =>
      line.row.withheld === null &&
      (months.get(yearMonthOf(line.row.paidOn)) ?? money(0)).gt(MARKET_RULES.dividendMonthlyLimit),
  );
}

function holdingFor(
  ticker: string,
  holdings: DividendHolding[],
  assignments: Record<string, string>,
) {
  const chosen = holdings.find((holding) => holding.id === assignments[ticker]);
  if (chosen) return chosen;
  const same = holdings.filter((holding) => normalizeTicker(holding.ticker) === ticker);
  return same.length === 1 ? same[0] : undefined;
}

function eventsByTicker(events: MarketEventRef[]) {
  const grouped = new Map<string, EventOnDay[]>();
  for (const event of events) {
    const list = grouped.get(event.ticker) ?? [];
    list.push({ ...event, day: dayNumber(event.payDate) });
    grouped.set(event.ticker, list);
  }
  for (const list of grouped.values()) byDay(list);
  return grouped;
}

function nearestEvent(row: ParsedDividend, day: number, events: EventOnDay[] | undefined) {
  let best: EventOnDay | undefined;
  for (const event of inWindow(events ?? [], day, WINDOW)) {
    if (!sameProventoKind(event.kind, row.kind)) continue;
    if (!best || Math.abs(event.day - day) < Math.abs(best.day - day)) best = event;
  }
  return best;
}

export function planDividendImport(input: DividendImportInput): PlannedDividend[] {
  const assignments = input.assignments ?? {};
  const events = eventsByTicker(input.events);
  const planned = input.rows.map((row): PlannedDividend => ({
    ...row,
    state: "novo",
    investmentId: null,
    amounts: null,
    calculation: null,
    rate: null,
    doubtReason: null,
    ignoreReason: null,
    replaces: null,
    current: null,
    pairedWith: null,
  }));
  const byHolding = new Map<DividendHolding, Pending[]>();
  for (const row of planned) {
    if (row.paidOn > input.today) {
      row.state = "ignorado";
      row.ignoreReason = "data_futura";
      continue;
    }
    const holding = holdingFor(row.ticker, input.holdings, assignments);
    if (!holding) {
      row.state = "conferir";
      row.doubtReason = "sem_ativo";
      continue;
    }
    const day = dayNumber(row.paidOn);
    const event = nearestEvent(row, day, events.get(row.ticker));
    const resolved = resolveAmounts(row, holding.assetClass, event?.comDate ?? null);
    row.investmentId = holding.id;
    row.amounts = resolved.amounts;
    row.calculation = resolved.calculation;
    row.rate = resolved.rate;
    const list = byHolding.get(holding) ?? [];
    list.push({
      row,
      amounts: resolved.amounts,
      uncertain: resolved.uncertain,
      event,
      day,
      gross: centsOf(resolved.amounts.gross),
      net: centsOf(resolved.amounts.net),
    });
    byHolding.set(holding, list);
  }
  for (const [holding, lines] of byHolding) {
    matchExisting(lines, holding.dividends);
    const blocked = input.blocked?.get(holding.id);
    for (const line of lines) {
      if (!isOpen(line)) continue;
      const doubt: DividendDoubt | null = line.row.ambiguous
        ? "valor_ambiguo"
        : line.event && blocked?.has(line.event.id)
          ? "excluido"
          : line.uncertain
            ? "imposto_incerto"
            : null;
      if (doubt) {
        line.row.state = "conferir";
        line.row.doubtReason = doubt;
      }
    }
    for (const line of overLimit(lines, holding.dividends)) {
      line.row.state = "conferir";
      line.row.doubtReason = "acima_do_limite";
    }
  }
  return planned;
}

/** Marcada por padrão: só o que é novo. */
export const dividendSelectedByDefault = (row: PlannedDividend) => row.state === "novo";

/** A pessoa pode marcar. Sem investimento escolhido, ainda não. */
export const dividendSelectable = (row: PlannedDividend) =>
  (row.state === "novo" || row.state === "conferir") && row.amounts !== null;

/** O que a pessoa viu na prévia, por linha. */
export interface SeenDividend {
  line: number;
  state: DividendState;
  doubtReason: DividendDoubt | null;
}

/**
 * O que a confirmação grava: marcado, gravável, igual ao que a pessoa viu e com a linha de que depende. O resto
 * é pulado, para o Mercado que rodou no meio não transformar um "novo" em troca sem ninguém ver.
 */
export function dividendsToWrite(
  rows: PlannedDividend[],
  selected: ReadonlySet<number>,
  seen: SeenDividend[],
): PlannedDividend[] {
  const before = new Map(seen.map((item) => [item.line, item]));
  const ready = rows.filter((row) => {
    const shown = before.get(row.line);
    return (
      selected.has(row.line) &&
      dividendSelectable(row) &&
      shown?.state === row.state &&
      shown.doubtReason === row.doubtReason
    );
  });
  const lines = new Set(ready.map((row) => row.line));
  return ready.filter((row) => row.pairedWith === null || lines.has(row.pairedWith));
}
