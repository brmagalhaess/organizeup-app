// Compara os proventos do arquivo com o que a família já tem (ADR-0029). Puro: o servidor roda de novo na
// confirmação, dentro da transação, e só grava o que este plano mandar.
//
// Identidade: a B3 não dá número ao provento, então a chave é investimento, tipo, data e valor. Cada linha do
// arquivo gasta uma linha do banco, para dois pagamentos iguais continuarem sendo dois. O que sobra vale como o
// mesmo provento se a soma fechar, porque a mesma ação em duas corretoras vem em duas linhas.
import type { DividendIgnoreReason, ParsedDividend } from "./dividend-file";
import {
  daysApart,
  jcpRateOf,
  MARKET_RULES,
  normalizeTicker,
  proventoAmounts,
  sameProventoKind,
  type DividendKind,
  type ExistingDividend,
} from "./market";
import { money, toDbAmount, type MoneyValue } from "./money";
import { yearMonthOf } from "./cashflow";

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

export type DividendDoubt =
  /** Código fora da carteira, ou em mais de um investimento: a pessoa escolhe. */
  | "sem_ativo"
  /** Há linha automática com outro valor: marcar troca pelo valor do arquivo. */
  | "valor_diferente"
  /** Há lançamento à mão por perto: marcar grava mais um. */
  | "parecida"
  /** Só o valor recebido, e a alíquota depende do que o arquivo não diz. */
  | "imposto_incerto"
  /** Mais de R$ 50 mil no mês da mesma empresa: pode haver retenção. */
  | "acima_do_limite"
  /** A família já excluiu ou desfez este provento. */
  | "excluido";

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

const nearestEvent = (row: ParsedDividend, events: MarketEventRef[]) =>
  events
    .filter(
      (event) =>
        event.ticker === row.ticker &&
        sameProventoKind(event.kind, row.kind) &&
        daysApart(event.payDate, row.paidOn) <= WINDOW,
    )
    .toSorted((a, b) => daysApart(a.payDate, row.paidOn) - daysApart(b.payDate, row.paidOn))[0];

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

const close = (a: MoneyValue | string, b: MoneyValue | string, cents = 1) =>
  money(a).minus(b).abs().lte(money(CENT).times(cents));

const rowNet = (row: ExistingDividend) => money(row.gross).minus(row.withheld);

/** Vale o líquido, e o bruto também, porque a coluna de valor pode trazer um ou outro. */
function sameValue(amounts: DividendAmounts, row: ExistingDividend): boolean {
  return (
    close(amounts.net, rowNet(row)) ||
    close(amounts.gross, row.gross) ||
    close(amounts.net, row.gross)
  );
}

const sum = (values: Array<MoneyValue | string>) =>
  values.reduce<MoneyValue>((acc, value) => acc.plus(value), money(0));

const isManual = (row: ExistingDividend) =>
  row.source === "familia" && row.marketDividendId === null;

interface Pending {
  row: PlannedDividend;
  amounts: DividendAmounts;
  uncertain: boolean;
  event: MarketEventRef | undefined;
}

const near = (a: string, b: string) => daysApart(a, b) <= WINDOW;

function closestFirst(pool: ExistingDividend[], paidOn: string) {
  return pool.toSorted((a, b) => daysApart(a.paidOn, paidOn) - daysApart(b.paidOn, paidOn));
}

const fitsKind = (line: Pending, row: ExistingDividend) =>
  near(row.paidOn, line.row.paidOn) && sameProventoKind(row.kind, line.row.kind);

/** Passa pela holding igualando com o banco. Cada linha do banco responde por uma só. */
function matchExisting(lines: Pending[], existing: ExistingDividend[]) {
  const used = new Set<string>();
  const open = () => lines.filter((line) => line.row.state === "novo");
  const free = () => existing.filter((row) => !used.has(row.id));

  // Linha contra linha.
  for (const line of open()) {
    const twin = closestFirst(free(), line.row.paidOn).find(
      (row) => fitsKind(line, row) && sameValue(line.amounts, row),
    );
    if (twin) {
      used.add(twin.id);
      line.row.state = "existe";
    }
  }
  // Duas corretoras no arquivo, uma linha no banco. À mão, a soma pode juntar JCP e dividendo (ADR-0017).
  for (const row of free()) {
    const group = open().filter((line) =>
      isManual(row) ? near(row.paidOn, line.row.paidOn) : fitsKind(line, row),
    );
    const total = sum(group.map((line) => line.amounts.net));
    const fits = close(total, rowNet(row), group.length) || close(total, row.gross, group.length);
    if (group.length > 1 && fits) {
      used.add(row.id);
      for (const line of group) line.row.state = "existe";
    }
  }
  // Uma linha no arquivo, dois pagamentos no banco.
  for (const line of open()) {
    const group = free().filter((row) => fitsKind(line, row));
    if (group.length > 1 && close(line.amounts.net, sum(group.map(rowNet)), group.length)) {
      for (const row of group) used.add(row.id);
      line.row.state = "existe";
    }
  }
  // Tem algo perto, mas não bate: a pessoa decide.
  for (const line of open()) {
    const candidates = closestFirst(free(), line.row.paidOn);
    const paired =
      candidates.find((row) => fitsKind(line, row)) ??
      candidates.find((row) => isManual(row) && near(row.paidOn, line.row.paidOn));
    if (!paired) continue;
    used.add(paired.id);
    line.row.state = "conferir";
    const automatic = paired.source === "agente";
    line.row.doubtReason = automatic ? "valor_diferente" : "parecida";
    line.row.replaces = automatic ? paired.id : null;
  }
}

/** Mais de R$ 50 mil no mês, e o arquivo não disse quanto foi retido. */
function overLimit(lines: Pending[], existing: ExistingDividend[]) {
  const months = new Map<string, MoneyValue>();
  const add = (date: string, gross: string) => {
    const month = yearMonthOf(date);
    months.set(month, (months.get(month) ?? money(0)).plus(gross));
  };
  for (const row of existing) if (row.kind === "dividendo") add(row.paidOn, row.gross);
  const fresh = lines.filter((line) => line.row.kind === "dividendo" && line.row.state === "novo");
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

export function planDividendImport(input: DividendImportInput): PlannedDividend[] {
  const assignments = input.assignments ?? {};
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
    const event = nearestEvent(row, input.events);
    const resolved = resolveAmounts(row, holding.assetClass, event?.comDate ?? null);
    row.investmentId = holding.id;
    row.amounts = resolved.amounts;
    row.calculation = resolved.calculation;
    row.rate = resolved.rate;
    const list = byHolding.get(holding) ?? [];
    list.push({ row, amounts: resolved.amounts, uncertain: resolved.uncertain, event });
    byHolding.set(holding, list);
  }
  for (const [holding, lines] of byHolding) {
    matchExisting(lines, holding.dividends);
    const blocked = input.blocked?.get(holding.id);
    for (const line of lines) {
      if (line.row.state !== "novo") continue;
      const doubt: DividendDoubt | null =
        line.event && blocked?.has(line.event.id)
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
