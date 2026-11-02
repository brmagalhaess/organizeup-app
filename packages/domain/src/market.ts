// Cotações e proventos automáticos (ADR-0017). Puro: decide o que aplicar, quanto a família recebeu
// e como mostrar. Só organiza; não indica ativo nem momento de compra ou venda (CVM, ADR-0012).
//
// Fontes das regras:
// - Direito ao provento: data-com é o último dia para comprar e ter direito; data ex é o primeiro dia
//   sem o direito. Definição da documentação da brapi (GET /api/v2/stocks/dividends, campos
//   `lastDatePrior` e `exDate`). A posição conta por data de negócio, então compra na data-com
//   entra e venda na data-com sai.
// - JCP: 15% até 2025 (Lei 9.249/1995, art. 9º, § 2º); 17,5% desde 01/01/2026, "na data do pagamento
//   ou do crédito ao beneficiário" (Lei Complementar 224/2025, art. 8º e art. 14, III,
//   planalto.gov.br/ccivil_03/leis/lcp/lcp224.htm).
// - Dividendo: sem retenção, salvo mais de R$ 50 mil no mês da mesma empresa para a mesma pessoa, que
//   retém 10% sobre o total (Lei 15.270/2025, que criou o art. 6º-A da Lei 9.250/1995).
// - Rendimento de FII: sem retenção para pessoa física nas condições da Lei 11.033/2004, art. 3º.
import Decimal from "decimal.js";
import { DEFAULT_TIMEZONE, todayIn } from "./dates";
import { yearMonthOf } from "./cashflow";
import { isUnitPriced, positionOf, type StockEvent, type TradeInput } from "./investment";
import { money, toDbAmount, type MoneyValue } from "./money";

export const MARKET_RULES = {
  /** Fuso da B3: a data de uma cotação ou provento é a data civil daqui. */
  timezone: DEFAULT_TIMEZONE,
  /** Primeiro dia com a alíquota nova de JCP. */
  jcpChangeOn: "2026-01-01",
  jcpRateUntil2025: "0.15",
  jcpRateFrom2026: "0.175",
  /** Acima disto, no mês, a mesma empresa retém 10% da mesma pessoa (Lei 15.270/2025). */
  dividendMonthlyLimit: "50000",
  /** Lançamento da família até tantos dias do pagamento conta como o mesmo provento. */
  familyMatchDays: 5,
  /** Proventos mais antigos que isto não são coletados. */
  historyYears: 5,
} as const;

// Raiz de quatro caracteres mais um ou dois dígitos. A raiz costuma ser só letras, mas a B3 usa dígito em
// lugares certos: B3SA3 e M1TA34 na segunda posição, IB5M11 na terceira, 5GTK11 na primeira e B5P211 na segunda
// e na quarta, só em ETF. Cada forma é listada para não abrir a porta a nome digitado, como CPF123.
export const TICKER_ROOTS = String.raw`(?:[A-Z]{4}|[A-Z][0-9][A-Z]{2}|[A-Z]{2}[0-9][A-Z]|[0-9][A-Z]{3})[0-9]{1,2}|[A-Z][0-9][A-Z][0-9]11`;
const TICKER = new RegExp(`^(${TICKER_ROOTS})F?$`);
/** Código da B3 no meio de um texto, com ou sem o F do fracionário. */
export const TICKER_IN_TEXT = new RegExp(String.raw`\b(?:${TICKER_ROOTS})F?\b`);

/**
 * Código da B3 no formato que a fonte entende; null quando não parece um. O sufixo F é o mercado
 * fracionário do mesmo ativo. Só código válido sai do sistema: o campo é livre e aceitaria um nome.
 */
export function normalizeTicker(raw: string | null | undefined): string | null {
  const match = TICKER.exec(raw?.trim().toUpperCase() ?? "");
  return match ? match[1]! : null;
}

/** Código já no formato de `normalizeTicker`, sem o F do fracionário. */
export const isB3Ticker = (text: string) => normalizeTicker(text) === text;

/** Data civil na B3 de um instante da fonte. */
export const marketDateOf = (at: Date | string): string =>
  todayIn(MARKET_RULES.timezone, typeof at === "string" ? new Date(at) : at);

/**
 * Quantidade com direito ao provento: só operações até a data-com, inclusive, e eventos em ações
 * anteriores a ela. Evento na própria data-com fica de fora: o provento vai para as ações de antes dele.
 */
export function entitledQuantity(
  trades: TradeInput[],
  comDate: string,
  events: StockEvent[] = [],
): string {
  return positionOf(
    trades.filter((trade) => trade.occurredOn <= comDate),
    events.filter((event) => event.comDate < comDate),
  ).quantity;
}

/** "Desdobramento de 2 para 1" vira "desdobramento": a primeira palavra da nota é o tipo do evento. */
export const stockEventKind = (note: string): string => note.split(" ")[0]!.toLowerCase();

/**
 * A fonte ajusta o valor por ação pelos eventos em ações posteriores à data-com. A família recebeu o
 * valor da época, e é esse que combina com a quantidade que ela tinha. Evento na própria data-com
 * conta: o provento vai para as ações de antes dele.
 */
export function paidRate(rate: string, comDate: string, events: StockEvent[]): string {
  const factor = events
    .filter((event) => event.comDate >= comDate)
    .reduce((acc, event) => acc.times(event.factor), money(1));
  return money(rate).times(factor).toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN).toFixed(8);
}

/** Alíquota de JCP retido, ou null quando a data do crédito decidiria e a fonte não a informa. */
export function jcpRateOf(comDate: string, payDate: string): string | null {
  if (comDate >= MARKET_RULES.jcpChangeOn) return MARKET_RULES.jcpRateFrom2026;
  if (payDate < MARKET_RULES.jcpChangeOn) return MARKET_RULES.jcpRateUntil2025;
  return null;
}

export type DividendKind = "dividendo" | "jcp" | "rendimento";

export interface ProventoFacts {
  assetClass: string;
  kind: DividendKind;
  quantity: string;
  ratePerShare: string;
  comDate: string;
  payDate: string;
}

export type ProventoAmounts =
  { gross: string; withheld: string } | { skip: "imposto_incerto" | "abaixo_de_um_centavo" };

/** Bruto e retido de um provento. Sem certeza do imposto, não calcula: a família confere no extrato. */
export function proventoAmounts(facts: ProventoFacts): ProventoAmounts {
  const gross = money(toDbAmount(money(facts.quantity).times(facts.ratePerShare)));
  if (gross.lte(0)) return { skip: "abaixo_de_um_centavo" };
  if (facts.kind === "jcp") {
    const rate = jcpRateOf(facts.comDate, facts.payDate);
    if (rate === null) return { skip: "imposto_incerto" };
    return { gross: toDbAmount(gross), withheld: toDbAmount(gross.times(rate)) };
  }
  // "Rendimento" em ação é correção de outro provento, e em ETF o imposto depende do fundo.
  if (facts.kind === "rendimento" && facts.assetClass !== "fii") return { skip: "imposto_incerto" };
  return { gross: toDbAmount(gross), withheld: "0.00" };
}

export interface MarketProvento {
  id: string;
  kind: DividendKind;
  comDate: string;
  payDate: string;
  ratePerShare: string;
}

export interface ExistingDividend {
  id: string;
  kind: DividendKind;
  paidOn: string;
  gross: string;
  withheld: string;
  source: "familia" | "agente";
  marketDividendId: string | null;
}

export interface ReconcileInput {
  assetClass: string;
  trades: TradeInput[];
  /** Eventos em ações já aplicados ao investimento. */
  stockEvents?: StockEvent[];
  /** Proventos de mercado do ticker do investimento. */
  events: MarketProvento[];
  /** Todos os proventos do investimento. */
  existing: ExistingDividend[];
  /** Proventos de mercado que a família desfez ou excluiu: nunca mais mexidos. */
  blocked: ReadonlySet<string>;
  /** Hoje, na família. Provento ainda não pago não responde por linha já paga. */
  today?: string;
}

export interface ProventoEntry {
  marketDividendId: string;
  kind: DividendKind;
  paidOn: string;
  gross: string;
  withheld: string;
}

export interface ProventoPlan {
  create: ProventoEntry[];
  /** Linha automática cujo valor mudou (operação corrigida ou valor corrigido na fonte). */
  update: Array<{ id: string; marketDividendId: string; gross: string; withheld: string }>;
  /** Linha automática que deixou de valer (sem posição na data-com ou ticker trocado). */
  remove: ExistingDividend[];
  /** Já lançado à mão pela família perto da data do pagamento. */
  skippedFamily: number;
  /** Imposto sem certeza: fica para a família conferir. */
  skippedTax: number;
}

/** Número do dia. Calcule uma vez por linha: comparar datas pelo texto ou por este número, nunca reconverter. */
export const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Fatia de uma lista ordenada por `day` que cabe na janela em torno de `day`. */
export function inWindow<T extends { day: number }>(sorted: T[], day: number, window: number): T[] {
  const firstAt = (limit: number) => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle]!.day < limit) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  return sorted.slice(firstAt(day - window), firstAt(day + window + 1));
}

/** Marca da linha que veio de arquivo, no próprio `id` (ADR-0029). */
const IMPORTED_DIVIDEND_PREFIX = "importado-";

export const importedDividendId = (uuid: string) => `${IMPORTED_DIVIDEND_PREFIX}${uuid}`;

export const isImportedDividend = (id: string) => id.startsWith(IMPORTED_DIVIDEND_PREFIX);

/** Veio de arquivo: importada, ou automática que a pessoa trocou pelo valor do arquivo. */
export const cameFromFile = (row: {
  id: string;
  source: ExistingDividend["source"];
  marketDividendId: string | null;
}) => isImportedDividend(row.id) || (row.source === "familia" && row.marketDividendId !== null);

/** A B3 e a fonte de mercado podem chamar de jeitos diferentes o pagamento de um FII. JCP é à parte. */
export const sameProventoKind = (a: DividendKind, b: DividendKind) =>
  a === b || (a !== "jcp" && b !== "jcp");

/** Em data diferente, até esta distância de valor ainda é o mesmo pagamento: quantidade ou imposto divergem. */
const CLAIM_VALUE_SLACK = "0.2";
const CENT = "0.01";

const similarValue = (a: MoneyValue, b: MoneyValue) =>
  a.minus(b).abs().lte(a.times(CLAIM_VALUE_SLACK));

interface ImportedGroup {
  day: number;
  kind: DividendKind;
  gross: MoneyValue;
  net: MoneyValue;
  rows: number;
}

/** Linhas do mesmo dia e tipo são um pagamento só, partido por corretora. */
function importedGroups(existing: ExistingDividend[]): ImportedGroup[] {
  const groups = new Map<string, ImportedGroup>();
  for (const row of existing) {
    if (row.marketDividendId !== null || !isImportedDividend(row.id)) continue;
    const key = `${row.paidOn}|${row.kind === "jcp"}`;
    const group = groups.get(key) ?? {
      day: dayNumber(row.paidOn),
      kind: row.kind,
      gross: money(0),
      net: money(0),
      rows: 0,
    };
    group.gross = group.gross.plus(row.gross);
    group.net = group.net.plus(row.gross).minus(row.withheld);
    group.rows += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.day - b.day);
}

interface OpenEvent {
  id: string;
  kind: DividendKind;
  day: number;
  due: MoneyValue;
  /** Ainda não pago no dia desta rodada. */
  future: boolean;
}

/** Provento que ainda pode ser reivindicado, com o valor devido. Bloqueado e sem posição não valem. */
function openEvents(input: ReconcileInput, taken: ReadonlySet<string>): OpenEvent[] {
  const { today } = input;
  return input.events
    .flatMap((event): OpenEvent[] => {
      if (taken.has(event.id) || input.blocked.has(event.id)) return [];
      const quantity = entitledQuantity(input.trades, event.comDate, input.stockEvents);
      const due = money(quantity).times(event.ratePerShare);
      if (due.lte(0)) return [];
      const future = today !== undefined && event.payDate > today;
      return [{ id: event.id, kind: event.kind, day: dayNumber(event.payDate), due, future }];
    })
    .sort((a, b) => a.day - b.day);
}

const toleranceOf = (group: ImportedGroup) => money(CENT).times(group.rows);

const fitsExactly = (group: ImportedGroup, due: MoneyValue) => {
  const tolerance = toleranceOf(group);
  return due.minus(group.gross).abs().lte(tolerance) || due.minus(group.net).abs().lte(tolerance);
};

const byCloseness = (group: ImportedGroup, candidates: OpenEvent[]) =>
  candidates.toSorted(
    (a, b) =>
      Math.abs(a.day - group.day) - Math.abs(b.day - group.day) ||
      a.due.minus(group.gross).abs().comparedTo(b.due.minus(group.gross).abs()),
  );

/** O que um pagamento do arquivo cobre com certeza: o de mesmo valor, vários que somam, ou o do mesmo dia. */
function coveredBy(group: ImportedGroup, candidates: OpenEvent[]): OpenEvent[] {
  const tolerance = toleranceOf(group);
  const ordered = byCloseness(group, candidates);
  const exact = ordered.find((event) => fitsExactly(group, event.due));
  if (exact) return [exact];

  const summed: OpenEvent[] = [];
  let left = group.gross;
  for (const event of ordered) {
    if (left.lte(tolerance)) break;
    if (event.due.lte(left.plus(tolerance))) {
      summed.push(event);
      left = left.minus(event.due);
    }
  }
  if (summed.length > 0 && left.lte(tolerance)) return summed;

  const sameDay: OpenEvent[] = [];
  left = group.gross;
  for (const event of ordered.filter((item) => item.day === group.day)) {
    sameDay.push(event);
    left = left.minus(event.due);
    if (left.lte(tolerance)) break;
  }
  return sameDay;
}

const mergedGroup = (groups: ImportedGroup[], day: number): ImportedGroup => ({
  day,
  kind: groups[0]!.kind,
  gross: groups.reduce((total, group) => total.plus(group.gross), money(0)),
  net: groups.reduce((total, group) => total.plus(group.net), money(0)),
  rows: groups.reduce((total, group) => total + group.rows, 0),
});

/**
 * Proventos respondidos por linhas importadas. O resto a fonte cria, ao contrário do lançamento à mão. A data do
 * arquivo diferente da fonte não duplica, e sobra de linha não engole o provento seguinte. Provento ainda não pago
 * só conta por valor exato, e só se nenhum já pago cobrir: assim o resultado não depende do dia em que o job roda.
 */
function claimedByImports(input: ReconcileInput, taken: ReadonlySet<string>): Set<string> {
  const claimed = new Set<string>();
  const open = openEvents(input, taken);
  const paid = open.filter((event) => !event.future);
  const upcoming = open.filter((event) => event.future);
  const free = (list: OpenEvent[], group: ImportedGroup) =>
    inWindow(list, group.day, MARKET_RULES.familyMatchDays).filter(
      (event) => !claimed.has(event.id) && sameProventoKind(event.kind, group.kind),
    );

  const unsettled: ImportedGroup[] = [];
  for (const group of importedGroups(input.existing)) {
    const covered = coveredBy(group, free(paid, group));
    if (covered.length === 0) unsettled.push(group);
    for (const event of covered) claimed.add(event.id);
  }

  // Corretoras que pagaram em dias diferentes: a soma dos dias responde pelo provento da fonte.
  const settled = new Set<ImportedGroup>();
  for (const event of paid) {
    if (claimed.has(event.id)) continue;
    const near = inWindow(unsettled, event.day, MARKET_RULES.familyMatchDays).filter(
      (group) => !settled.has(group) && sameProventoKind(group.kind, event.kind),
    );
    if (near.length < 2 || !fitsExactly(mergedGroup(near, event.day), event.due)) continue;
    claimed.add(event.id);
    for (const group of near) settled.add(group);
  }

  for (const group of unsettled) {
    if (settled.has(group)) continue;
    const similar = byCloseness(group, free(paid, group)).find((event) =>
      similarValue(event.due, group.gross),
    );
    const exact = byCloseness(group, free(upcoming, group)).find((event) =>
      fitsExactly(group, event.due),
    );
    const answer = similar ?? exact;
    if (answer) claimed.add(answer.id);
  }
  return claimed;
}

/**
 * Linha automática que voltaria por um Desfazer já tem resposta numa linha importada? Cada importada responde por
 * um só: quem chama passa o mesmo `used` para todas, para o Desfazer não perder outro provento do dia.
 */
export function answeredByImport(
  entry: { kind: DividendKind; paidOn: string; gross: string },
  existing: ExistingDividend[],
  used: Set<string> = new Set(),
): boolean {
  const day = dayNumber(entry.paidOn);
  const gross = money(entry.gross);
  const near = existing
    .flatMap((row) => {
      if (row.marketDividendId !== null || !isImportedDividend(row.id) || used.has(row.id)) {
        return [];
      }
      const apart = Math.abs(dayNumber(row.paidOn) - day);
      const fits = sameProventoKind(row.kind, entry.kind) && apart <= MARKET_RULES.familyMatchDays;
      return fits ? [{ row, apart }] : [];
    })
    .sort((a, b) => a.apart - b.apart);
  const single = near.find(({ row }) => similarValue(gross, money(row.gross)));
  if (single) {
    used.add(single.row.id);
    return true;
  }
  const sameDay = near.filter(({ apart }) => apart === 0).map(({ row }) => row);
  const total = sameDay.reduce((sum, row) => sum.plus(row.gross), money(0));
  if (sameDay.length < 2 || !similarValue(gross, total)) return false;
  for (const row of sameDay) used.add(row.id);
  return true;
}

/** Decide o que criar, corrigir e tirar para um investimento. Rodar de novo sobre o resultado não muda nada. */
export function reconcileProventos(input: ReconcileInput): ProventoPlan {
  const plan: ProventoPlan = {
    create: [],
    update: [],
    remove: [],
    skippedFamily: 0,
    skippedTax: 0,
  };
  const family = input.existing.filter(
    (row) => row.marketDividendId === null && !isImportedDividend(row.id),
  );
  const familyDays = family.map((row) => dayNumber(row.paidOn));
  const linked = input.existing.flatMap((row) =>
    row.marketDividendId === null ? [] : [{ ...row, marketDividendId: row.marketDividendId }],
  );
  const automatic = new Map(
    linked.filter((row) => row.source === "agente").map((row) => [row.marketDividendId, row]),
  );
  // Linha automática que a família trocou pelo valor do arquivo: o provento já tem resposta (ADR-0029).
  const answered = new Set(
    linked.filter((row) => row.source !== "agente").map((row) => row.marketDividendId),
  );
  const claimed = claimedByImports(input, new Set(linked.map((row) => row.marketDividendId)));

  for (const event of input.events) {
    if (input.blocked.has(event.id)) continue;
    const current = automatic.get(event.id);
    const quantity = entitledQuantity(input.trades, event.comDate, input.stockEvents);
    if (money(quantity).lte(0)) {
      if (current) plan.remove.push(current);
      continue;
    }
    const eventDay = dayNumber(event.payDate);
    const recorded =
      answered.has(event.id) ||
      claimed.has(event.id) ||
      familyDays.some((day) => Math.abs(day - eventDay) <= MARKET_RULES.familyMatchDays);
    if (!current && recorded) {
      plan.skippedFamily += 1;
      continue;
    }
    const amounts = proventoAmounts({ ...event, assetClass: input.assetClass, quantity });
    if ("skip" in amounts) {
      if (amounts.skip === "imposto_incerto") plan.skippedTax += 1;
      continue;
    }
    if (!current) {
      plan.create.push({
        marketDividendId: event.id,
        kind: event.kind,
        paidOn: event.payDate,
        ...amounts,
      });
    } else if (
      !money(current.gross).eq(amounts.gross) ||
      !money(current.withheld).eq(amounts.withheld)
    ) {
      plan.update.push({ id: current.id, marketDividendId: event.id, ...amounts });
    }
  }

  const known = new Set(input.events.map((event) => event.id));
  for (const [id, row] of automatic) {
    if (!known.has(id) && !input.blocked.has(id)) plan.remove.push(row);
  }

  // Acima do limite do mês pode haver retenção de 10%, que depende de quem é o titular.
  const months = new Map<string, MoneyValue>();
  const add = (date: string, gross: string) => {
    const month = yearMonthOf(date);
    months.set(month, (months.get(month) ?? money(0)).plus(gross));
  };
  for (const row of input.existing) if (row.kind === "dividendo") add(row.paidOn, row.gross);
  for (const entry of plan.create) if (entry.kind === "dividendo") add(entry.paidOn, entry.gross);
  const risky = (date: string) =>
    (months.get(yearMonthOf(date)) ?? money(0)).gt(MARKET_RULES.dividendMonthlyLimit);
  const kept = plan.create.filter((entry) => entry.kind !== "dividendo" || !risky(entry.paidOn));
  plan.skippedTax += plan.create.length - kept.length;
  plan.create = kept;
  return plan;
}

export interface QuoteDecisionInput {
  priceSource: "familia" | "mercado";
  currentPrice: string | null;
  valuedOn: string | null;
  quotePrice: string;
  quoteDate: string;
}

/**
 * A cotação entra se for mais nova que o preço da família, ou se o preço atual já for automático e
 * mudou. Preço digitado na mesma data da cotação ou depois fica.
 */
export function quoteApplies(input: QuoteDecisionInput): boolean {
  const { currentPrice, priceSource, quoteDate, quotePrice, valuedOn } = input;
  if (valuedOn === null || currentPrice === null) return true;
  if (priceSource === "familia") return quoteDate > valuedOn;
  if (quoteDate < valuedOn) return false;
  return quoteDate > valuedOn || !money(currentPrice).eq(quotePrice);
}

export type QuoteState =
  /** Renda fixa, fundo e demais: vale o total informado. */
  | "nao_se_aplica"
  | "sem_ticker"
  /** Formato errado, ou a fonte disse que não existe. */
  | "ticker_invalido"
  /** Código válido que ainda não foi consultado. */
  | "aguardando"
  /** A fonte não entrega este ativo no plano contratado. */
  | "sem_plano"
  | "automatico"
  /** Tem cotação, mas vale o preço que a família digitou depois dela. */
  | "informado";

export function quoteStateOf(input: {
  assetClass: string;
  ticker: string | null;
  priceSource: "familia" | "mercado";
  hasQuote: boolean;
  tickerStatus: string | null;
}): QuoteState {
  if (!isUnitPriced(input.assetClass)) return "nao_se_aplica";
  if (!input.ticker) return "sem_ticker";
  if (normalizeTicker(input.ticker) === null) return "ticker_invalido";
  if (input.tickerStatus === "desconhecido") return "ticker_invalido";
  if (input.hasQuote) return input.priceSource === "mercado" ? "automatico" : "informado";
  return input.tickerStatus === "sem_plano" ? "sem_plano" : "aguardando";
}
