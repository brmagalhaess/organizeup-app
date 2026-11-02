// Sugestão de viagens (ADR-0015, substitui em parte o ADR-0014). Puro e estimativa: usa a tabela
// global de destinos (cada linha com fonte e confiança) para estimar quanto custa levar a família e
// encaixa as viagens no orçamento mensal de viagens. Valores aproximados; a família confere passagem
// e hospedagem antes de fechar, e nada é criado sem ela aceitar. Intenções (ADR-0026) entram na mesma
// conta, com prioridade sobre o catálogo: sem intenção, o resultado é o de sempre.
import { addMonths, formatYearMonth, yearMonthOf, type YearMonth } from "./cashflow";
import { message, moneyValue, type Message } from "./messages";
import { formatMoney, money, toCents, toDbAmount, type Currency, type MoneyValue } from "./money";
import { monthsBetween } from "./trip";

export const TRIP_RULES = {
  /** Criança (menos de 12 anos) come e se locomove por 70% de um adulto; passagem inteira. */
  childAge: 12,
  childFactor: 0.7,
  /** Acomodação cobre até 4 pessoas; +50% por pessoa extra. */
  lodgingPeople: 4,
  lodgingExtra: 0.5,
  /** Duração padrão quando a família não disse. */
  defaultDays: 5,
  /** Nenhuma viagem antes de 4 meses: dá tempo de guardar. */
  minMonthsAhead: 4,
  /** Até quando adiar uma viagem para caber no orçamento. */
  maxMonthsAhead: 36,
} as const;

export type DestinationRegion =
  "brasil_perto" | "brasil" | "america_sul" | "america_norte" | "europa" | "asia_oceania";

export interface DestinationTemplate {
  id: string;
  name: string;
  country: string;
  region: DestinationRegion;
  /** Acomodação por noite para até 4 pessoas. */
  lodgingPerNight: string;
  foodPerPersonDay: string;
  localTransportPerPersonDay: string;
  /** Ida e volta, saída do Brasil. */
  flightPerPerson: string;
  minDays: number;
  kidsFriendly: boolean;
  /** Meses do ano (1 a 12) em que vale mais a pena ir. */
  bestMonths: number[];
  source: string;
  confidence: "baixa" | "media";
}

export interface TripTraveler {
  personId: string;
  /** Null conta como adulto. */
  ageYears: number | null;
}

export interface TripSuggestInput {
  today: string;
  tripsPerYear: number;
  tripDays: number | null;
  /** Pessoas `titular|conjuge|filho` (o chamador filtra). */
  travelers: TripTraveler[];
  /** `allocation.tripsBudget`. */
  tripsBudgetMonthly: string;
  destinations: DestinationTemplate[];
  existingTripMonths: YearMonth[];
  /** Mês do aniversário de casamento (1 a 12). */
  weddingMonth: number | null;
  /** Moeda principal da família, para as notas. Sem ela, real. */
  currency?: Currency;
  /** Lugares que a família quer conhecer. Sem nenhum, o resultado é o de sempre. */
  intentions?: TripIntention[];
  /** Só com `tripsPerYear = 0`: a sugestão de intenção deste ano civil já saiu. */
  intentionUsedThisYear?: boolean;
}

/** Destino do catálogo, ou nome livre com região. */
export interface TripIntention {
  id: string;
  destinationId: string | null;
  customName: string | null;
  customRegion: DestinationRegion | null;
  /** Mês do ano (1 a 12). */
  preferredMonth: number | null;
  days: number | null;
  /** A família aceitou: não sugere de novo, e o destino não volta pelo catálogo. */
  fulfilled: boolean;
  /** Ano da viagem recusada mais adiante. Até o fim dele, a intenção fica de fora. */
  refusedYear: number | null;
}

/** O que aconteceu com cada intenção nesta conta. Só id e valores: nunca o nome. */
export type IntentionOutcome = { intentionId: string } & (
  | { status: "sugerida"; month: YearMonth; total: string }
  | {
      status: "nao_cabe";
      total: string;
      /** Quanto a mais por mês faz a viagem caber. */
      extraMonthly: string;
      /** Primeiro mês em que o orçamento de hoje, só para ela, junta o valor. Null: passa de 36 meses. */
      firstMonth: YearMonth | null;
    }
  | { status: "sem_vaga"; total: string }
  | { status: "atendida" }
  | { status: "uma_por_ano" | "criancas" | "sem_estimativa" }
  | { status: "recusada"; untilYear: number }
);

export interface TripSuggestionPlan {
  suggestions: TripSuggestion[];
  /** Na ordem de `intentions`. */
  intentions: IntentionOutcome[];
}

export interface TripEstimate {
  passagem: string;
  hospedagem: string;
  alimentacao: string;
  transporte: string;
}

export interface TripSuggestion {
  destinationId: string;
  name: string;
  month: YearMonth;
  days: number;
  personIds: string[];
  estimated: TripEstimate;
  total: string;
  perPerson: string;
  /** Quanto guardar por mês até o mês da viagem. */
  monthlyToSave: string;
  /** Em nenhum mês a soma do que se guarda para as sugeridas passa do orçamento. */
  fits: boolean;
  confidence: "baixa" | "media";
  source: string;
  note: string;
  /** A mesma nota, por chave, para sair no idioma de quem lê. */
  noteMessages: Message[];
  /** Veio de uma intenção. */
  intentionId?: string;
  /** Destino fora do catálogo: custo pela mediana desta região, com tantos destinos da tabela. */
  regionEstimate?: { region: DestinationRegion; destinations: number };
  /** Não coube no mês preferido, que seria `from`. */
  postponed?: { from: YearMonth; reason: "tempo" | "ocupado" };
}

interface Costed {
  destination: DestinationTemplate;
  days: number;
  estimated: Record<keyof TripEstimate, MoneyValue>;
  total: MoneyValue;
  intention?: TripIntention;
  regionEstimate?: { region: DestinationRegion; destinations: number };
}

/**
 * Linha só de contagem em `ops.agent_runs`: `households` são as famílias com intenção de viagem, e
 * `suggestions`, as intenções usadas na rodada. Nunca o nome do destino (ADR-0026). Não é um agente:
 * fora de `DAILY_AGENTS`, e nada a acorda. Mora aqui porque o worker grava e o painel filtra, e o
 * cartão do painel roda no navegador.
 */
export const TRIP_INTENTIONS_RUN = "viagens-intencoes";

const sumOf = (values: MoneyValue[]) => values.reduce((acc, value) => acc.plus(value), money(0));

/** Custo estimado de um destino para estes viajantes. */
export function estimateTrip(
  destination: DestinationTemplate,
  travelers: TripTraveler[],
  tripDays: number | null,
): { days: number; estimated: TripEstimate; total: string; perPerson: string } {
  const costed = costOf(destination, travelers, tripDays);
  const people = Math.max(1, travelers.length);
  return {
    days: costed.days,
    estimated: {
      passagem: toDbAmount(costed.estimated.passagem),
      hospedagem: toDbAmount(costed.estimated.hospedagem),
      alimentacao: toDbAmount(costed.estimated.alimentacao),
      transporte: toDbAmount(costed.estimated.transporte),
    },
    total: toDbAmount(costed.total),
    perPerson: toDbAmount(costed.total.dividedBy(people)),
  };
}

function costOf(
  destination: DestinationTemplate,
  travelers: TripTraveler[],
  tripDays: number | null,
): Costed {
  const days = Math.max(1, tripDays ?? Math.max(destination.minDays, TRIP_RULES.defaultDays));
  const nights = Math.max(0, days - 1);
  const people = Math.max(1, travelers.length);
  const factors = travelers.length > 0 ? travelers.map(factorOf) : [money(1)];
  const factorSum = sumOf(factors);
  const extra = Math.max(0, people - TRIP_RULES.lodgingPeople);
  const estimated = {
    hospedagem: toCents(
      money(destination.lodgingPerNight)
        .times(nights)
        .times(money(1).plus(money(TRIP_RULES.lodgingExtra).times(extra))),
    ),
    alimentacao: toCents(factorSum.times(destination.foodPerPersonDay).times(days)),
    transporte: toCents(factorSum.times(destination.localTransportPerPersonDay).times(days)),
    passagem: toCents(money(destination.flightPerPerson).times(people)),
  };
  const total = sumOf(Object.values(estimated));
  return { destination, days, estimated, total };
}

const factorOf = (traveler: TripTraveler): MoneyValue =>
  traveler.ageYears !== null && traveler.ageYears < TRIP_RULES.childAge
    ? money(TRIP_RULES.childFactor)
    : money(1);

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const monthNumber = (ym: YearMonth) => Number(ym.slice(5, 7));

/** Meses até o próximo aniversário de casamento; o do ano seguinte se faltam menos de 4 meses. */
function weddingOffsetOf(currentMonth: YearMonth, weddingMonth: number | null): number | null {
  if (weddingMonth === null) return null;
  const offset = (weddingMonth - monthNumber(currentMonth) + 12) % 12;
  return offset < TRIP_RULES.minMonthsAhead ? offset + 12 : offset;
}

/** Região sem linha na tabela usa a mais próxima que tem. */
const REGION_FALLBACK: Partial<Record<DestinationRegion, DestinationRegion>> = {
  brasil_perto: "brasil",
};

const REGION_NAMES: Record<DestinationRegion, string> = {
  brasil_perto: "Brasil, perto de casa",
  brasil: "Brasil",
  america_sul: "América do Sul",
  america_norte: "América do Norte",
  europa: "Europa",
  asia_oceania: "Ásia e Oceania",
};

/**
 * Molde de custo de um destino fora do catálogo: a mediana da região, custo a custo, em confiança
 * baixa. Sem saber o lugar, não há boa época nem restrição para crianças. Null: a tabela não tem
 * destino dessa região.
 */
export function regionEstimate(
  region: DestinationRegion,
  destinations: DestinationTemplate[],
): { template: DestinationTemplate; region: DestinationRegion; destinations: number } | null {
  const ofRegion = (name: DestinationRegion | undefined) =>
    destinations.filter((destination) => destination.region === name);
  const direct = ofRegion(region);
  const usedRegion = direct.length > 0 ? region : (REGION_FALLBACK[region] ?? region);
  const rows = direct.length > 0 ? direct : ofRegion(usedRegion);
  if (rows.length === 0) return null;
  const median = (values: MoneyValue[]) => {
    const sorted = [...values].sort((a, b) => a.comparedTo(b));
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[middle]!
      : sorted[middle - 1]!.plus(sorted[middle]!).dividedBy(2);
  };
  const of = (pick: (row: DestinationTemplate) => string) =>
    toDbAmount(median(rows.map((row) => money(pick(row)))));
  const count = rows.length;
  return {
    region: usedRegion,
    destinations: count,
    template: {
      id: `regiao:${usedRegion}`,
      name: REGION_NAMES[usedRegion],
      country: "",
      region: usedRegion,
      lodgingPerNight: of((row) => row.lodgingPerNight),
      foodPerPersonDay: of((row) => row.foodPerPersonDay),
      localTransportPerPersonDay: of((row) => row.localTransportPerPersonDay),
      flightPerPerson: of((row) => row.flightPerPerson),
      minDays: median(rows.map((row) => money(row.minDays)))
        .ceil()
        .toNumber(),
      kidsFriendly: true,
      bestMonths: [],
      source: `mediana de ${count} ${count === 1 ? "destino" : "destinos"} da região na nossa tabela.`,
      confidence: "baixa",
    },
  };
}

/** Custo da intenção, com o catálogo ou com a região. Null: não há como estimar. */
function costIntention(
  intention: TripIntention,
  input: TripSuggestInput,
  hasChild: boolean,
): Costed | "criancas" | null {
  const days = intention.days ?? input.tripDays;
  const known = input.destinations.find((row) => row.id === intention.destinationId);
  if (known) {
    if (hasChild && !known.kidsFriendly) return "criancas";
    return { ...costOf(known, input.travelers, days), intention };
  }
  if (intention.customName === null || intention.customRegion === null) return null;
  const estimate = regionEstimate(intention.customRegion, input.destinations);
  if (!estimate) return null;
  const destination: DestinationTemplate = {
    ...estimate.template,
    id: `intencao:${intention.id}`,
    name: intention.customName,
  };
  return {
    ...costOf(destination, input.travelers, days),
    intention,
    regionEstimate: { region: estimate.region, destinations: estimate.destinations },
  };
}

/** Primeiro mês em que o orçamento, só para esta viagem, junta o valor. Null: passa de 36 meses. */
function firstFitMonth(
  total: MoneyValue,
  monthly: MoneyValue,
  currentMonth: YearMonth,
  occupied: readonly YearMonth[],
): YearMonth | null {
  if (monthly.isZero()) return null;
  const needed = total.dividedBy(monthly).ceil().toNumber();
  for (
    let offset = Math.max(TRIP_RULES.minMonthsAhead, needed);
    offset <= TRIP_RULES.maxMonthsAhead;
    offset += 1
  ) {
    const month = addMonths(currentMonth, offset);
    if (!occupied.includes(month)) return month;
  }
  return null;
}

/** Quanto a mais por mês faz `total` caber na parte de uma viagem, com o centavo para cima. */
const extraToFit = (total: MoneyValue, monthly: MoneyValue, count: number) =>
  toDbAmount(total.times(count).dividedBy(12).minus(monthly).times(100).ceil().dividedBy(100));

const byPriceDesc = (a: Costed, b: Costed) =>
  b.total.comparedTo(a.total) || a.destination.id.localeCompare(b.destination.id);

/** Tira de `pool` até completar `count`: a mais cara primeiro, regiões diferentes quando possível. */
function pickInto(
  chosen: Costed[],
  regions: Set<DestinationRegion>,
  pool: Costed[],
  count: number,
): void {
  while (chosen.length < count && pool.length > 0) {
    const index = Math.max(
      0,
      pool.findIndex((costed) => !regions.has(costed.destination.region)),
    );
    const pick = pool.splice(index, 1)[0]!;
    regions.add(pick.destination.region);
    chosen.push(pick);
  }
}

const isPinned = (costed: Costed) => (costed.intention?.preferredMonth ?? null) !== null;

/**
 * Escolhe até `tripsPerYear` destinos que cabem no orçamento anual (os mais caros primeiro, regiões
 * diferentes quando possível), marca um mês para cada uma e diz quanto guardar por mês.
 */
export function suggestTrips(input: TripSuggestInput): TripSuggestion[] {
  return planTrips(input).suggestions;
}

/**
 * A mesma conta, dizendo também o que aconteceu com cada intenção. Intenção que cabe vem antes do
 * catálogo; o que sobrar de vaga segue o catálogo. Com `tripsPerYear = 0`, uma vaga só para intenção.
 */
export function planTrips(input: TripSuggestInput): TripSuggestionPlan {
  const requested = Math.floor(input.tripsPerYear);
  const intentions = input.intentions ?? [];
  const currentMonth = yearMonthOf(input.today);
  const currentYear = Number(currentMonth.slice(0, 4));
  const hasChild = input.travelers.some(
    (traveler) => traveler.ageYears !== null && traveler.ageYears < TRIP_RULES.childAge,
  );

  const outcomes = new Map<string, IntentionOutcome>();
  const wanted: Costed[] = [];
  for (const intention of intentions) {
    const intentionId = intention.id;
    if (intention.fulfilled) {
      outcomes.set(intentionId, { intentionId, status: "atendida" });
    } else if (intention.refusedYear !== null && intention.refusedYear >= currentYear) {
      outcomes.set(intentionId, {
        intentionId,
        status: "recusada",
        untilYear: intention.refusedYear,
      });
    } else {
      const costed = costIntention(intention, input, hasChild);
      if (costed === "criancas") outcomes.set(intentionId, { intentionId, status: "criancas" });
      else if (costed === null || !costed.total.gt(0))
        outcomes.set(intentionId, { intentionId, status: "sem_estimativa" });
      else wanted.push(costed);
    }
  }
  const finish = (suggestions: TripSuggestion[]): TripSuggestionPlan => ({
    suggestions,
    intentions: intentions.map((intention) => outcomes.get(intention.id)!),
  });

  const solo = requested <= 0;
  if (solo && wanted.length === 0) return finish([]);
  if (solo && input.intentionUsedThisYear) {
    for (const { intention } of wanted) {
      outcomes.set(intention!.id, { intentionId: intention!.id, status: "uma_por_ano" });
    }
    return finish([]);
  }
  const count = solo ? 1 : requested;

  const monthly = toCents(input.tripsBudgetMonthly).gt(0)
    ? toCents(input.tripsBudgetMonthly)
    : money(0);
  const perTrip = monthly.times(12).dividedBy(count);

  const chosen: Costed[] = [];
  const regions = new Set<DestinationRegion>();
  const intentionPool = wanted.filter((costed) => costed.total.lte(perTrip)).sort(byPriceDesc);
  for (const costed of wanted.filter((item) => !item.total.lte(perTrip))) {
    const { id } = costed.intention!;
    outcomes.set(id, {
      intentionId: id,
      status: "nao_cabe",
      total: toDbAmount(costed.total),
      extraMonthly: extraToFit(costed.total, monthly, count),
      firstMonth: firstFitMonth(costed.total, monthly, currentMonth, input.existingTripMonths),
    });
  }
  pickInto(chosen, regions, intentionPool, count);
  for (const costed of intentionPool) {
    const { id } = costed.intention!;
    outcomes.set(id, { intentionId: id, status: "sem_vaga", total: toDbAmount(costed.total) });
  }

  // Destino que já é intenção não volta pelo catálogo, nem recusado, nem atendido.
  const claimed = new Set(intentions.map((intention) => intention.destinationId));
  const options = solo
    ? []
    : input.destinations
        .filter((destination) => !claimed.has(destination.id))
        .filter((destination) => !hasChild || destination.kidsFriendly)
        .map((destination) => costOf(destination, input.travelers, input.tripDays))
        .filter((costed) => costed.total.gt(0));
  if (options.length === 0 && chosen.length === 0) return finish([]);

  const fitting = options.filter((costed) => costed.total.lte(perTrip)).sort(byPriceDesc);

  let nothingFits = false;
  if (fitting.length === 0 && chosen.length === 0) {
    nothingFits = true;
    chosen.push(
      [...options].sort(
        (a, b) => a.total.comparedTo(b.total) || a.destination.id.localeCompare(b.destination.id),
      )[0]!,
    );
  } else {
    pickInto(chosen, regions, [...fitting], count);
  }

  // Meses: da mais barata para a mais cara, cada uma depois de dar tempo de guardar o acumulado. Mês
  // preferido vem antes, para nenhuma outra ocupar o lugar dele.
  const used = new Set(input.existingTripMonths);
  const ordered = [...chosen]
    .sort((a, b) => a.total.comparedTo(b.total))
    .sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)));
  const offsets: number[] = [];
  let cumulative = money(0);
  const rateFor = (costed: Costed, offset: number) => costed.total.dividedBy(Math.max(1, offset));
  const totalRate = (upTo: number, candidate: number) =>
    sumOf(ordered.slice(0, upTo).map((c, i) => rateFor(c, offsets[i]!))).plus(
      rateFor(ordered[upTo]!, candidate),
    );
  const isFree = (offset: number) => !used.has(addMonths(currentMonth, offset));
  const postponed = new Map<Costed, NonNullable<TripSuggestion["postponed"]>>();

  /** O mês preferido mais perto em que dá tempo de guardar: este ano, ou o mesmo mês mais adiante. */
  const placePreferred = (k: number, preferred: number, earliest: number, fallback: number) => {
    const nearest = (preferred - monthNumber(currentMonth) + 12) % 12;
    let reason: "tempo" | "ocupado" | null = null;
    let offset = nearest;
    for (; offset <= TRIP_RULES.maxMonthsAhead; offset += 12) {
      const room = offset >= earliest && !totalRate(k, offset).gt(monthly);
      if (room && isFree(offset)) break;
      reason ??= room ? "ocupado" : "tempo";
    }
    const placed = offset <= TRIP_RULES.maxMonthsAhead ? offset : fallback;
    if (reason) {
      postponed.set(ordered[k]!, { from: addMonths(currentMonth, nearest), reason });
    }
    return placed;
  };

  for (let k = 0; k < ordered.length; k += 1) {
    const costed = ordered[k]!;
    cumulative = cumulative.plus(costed.total);
    const minOffset = Math.max(
      TRIP_RULES.minMonthsAhead,
      monthly.isZero() ? 12 : cumulative.dividedBy(monthly).ceil().toNumber(),
    );
    const earliest = Math.min(minOffset, TRIP_RULES.maxMonthsAhead);
    // Primeiro mês livre que não estoura o orçamento; entre os 12 seguintes, prefere a melhor época.
    let base = earliest;
    while (
      base < TRIP_RULES.maxMonthsAhead &&
      (!isFree(base) || (!nothingFits && totalRate(k, base).gt(monthly)))
    ) {
      base += 1;
    }
    const preferred = costed.intention?.preferredMonth ?? null;
    let offset = base;
    if (preferred !== null) {
      offset = placePreferred(k, preferred, earliest, base);
    } else {
      // Intenção respeita o teto de 36 meses até na procura da boa época.
      const last = costed.intention
        ? Math.min(base + 12, TRIP_RULES.maxMonthsAhead + 1)
        : base + 12;
      for (let candidate = base; candidate < last; candidate += 1) {
        const month = addMonths(currentMonth, candidate);
        if (isFree(candidate) && costed.destination.bestMonths.includes(monthNumber(month))) {
          offset = candidate;
          break;
        }
      }
    }
    offsets.push(offset);
    used.add(addMonths(currentMonth, offset));
  }

  // Uma viagem cai no aniversário de casamento, se houver tempo de guardar.
  const weddingOffset = weddingOffsetOf(currentMonth, input.weddingMonth);
  if (weddingOffset !== null) {
    const weddingYm = addMonths(currentMonth, weddingOffset);
    if (!used.has(weddingYm)) {
      const index = ordered.findIndex((c, i) => !isPinned(c) && offsets[i]! <= weddingOffset);
      if (index >= 0) {
        used.delete(addMonths(currentMonth, offsets[index]!));
        offsets[index] = weddingOffset;
        used.add(weddingYm);
      }
    }
  }

  // Cabe? Em nenhum mês a soma do que se guarda passa do orçamento.
  const rates = ordered.map((costed, i) => rateFor(costed, offsets[i]!));
  const lastOffset = Math.max(...offsets);
  let fits = !nothingFits;
  for (let step = 0; step < lastOffset && fits; step += 1) {
    const saving = sumOf(rates.filter((_, i) => offsets[i]! > step));
    if (toCents(saving).gt(monthly)) fits = false;
  }

  const people = Math.max(1, input.travelers.length);
  const { currency } = input;
  const extraPerMonth = nothingFits
    ? toCents(ordered[0]!.total.minus(perTrip).dividedBy(12))
    : money(0);
  const suggestions = ordered
    .map((costed, i): TripSuggestion => {
      const month = addMonths(currentMonth, offsets[i]!);
      const notes: string[] = [];
      const noteMessages: Message[] = [];
      const moved = postponed.get(costed);
      if (costed.regionEstimate) {
        const { region } = costed.regionEstimate;
        notes.push(
          `Custo estimado pela região ${REGION_NAMES[region]}: este destino não está na nossa tabela.`,
        );
        noteMessages.push(message("frases.viagemEstimativaRegiao", { region }));
      }
      if (moved) {
        const from = formatYearMonth(moved.from);
        const to = formatYearMonth(month);
        notes.push(
          moved.reason === "tempo"
            ? `Em ${from} não daria tempo de guardar, então ficou para ${to}.`
            : `Em ${from} já há outra viagem, então ficou para ${to}.`,
        );
        noteMessages.push(
          message(
            moved.reason === "tempo" ? "frases.viagemMesSemTempo" : "frases.viagemMesOcupado",
            {
              from: { month: moved.from },
              to: { month },
            },
          ),
        );
      }
      if (nothingFits && extraPerMonth.gt(0)) {
        notes.push(
          `Guarde ${formatMoney(extraPerMonth, currency)} a mais por mês para esta viagem caber.`,
        );
        noteMessages.push(
          message("frases.viagemGuardeMais", {
            amount: moneyValue(toDbAmount(extraPerMonth), currency),
          }),
        );
      }
      if (weddingOffset !== null && offsets[i] === weddingOffset) {
        notes.push("No mês do aniversário de casamento.");
        noteMessages.push(message("frases.viagemCasamento"));
      }
      if (costed.destination.bestMonths.includes(monthNumber(month))) {
        notes.push(
          `${MONTH_NAMES[monthNumber(month) - 1]} é boa época para ${costed.destination.name}.`,
        );
        noteMessages.push(
          message("frases.viagemBoaEpoca", {
            month: { monthName: monthNumber(month) },
            name: costed.destination.name,
          }),
        );
      }
      return {
        destinationId: costed.destination.id,
        name: costed.destination.name,
        month,
        days: costed.days,
        personIds: input.travelers.map((traveler) => traveler.personId),
        estimated: {
          passagem: toDbAmount(costed.estimated.passagem),
          hospedagem: toDbAmount(costed.estimated.hospedagem),
          alimentacao: toDbAmount(costed.estimated.alimentacao),
          transporte: toDbAmount(costed.estimated.transporte),
        },
        total: toDbAmount(costed.total),
        perPerson: toDbAmount(costed.total.dividedBy(people)),
        monthlyToSave: toDbAmount(rates[i]!),
        fits,
        confidence: costed.destination.confidence,
        source: costed.destination.source,
        note: notes.join(" "),
        noteMessages,
        ...(costed.intention ? { intentionId: costed.intention.id } : {}),
        ...(costed.regionEstimate ? { regionEstimate: costed.regionEstimate } : {}),
        ...(moved ? { postponed: moved } : {}),
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month))
    // Sem mês livre nos 36 meses, a intenção não vira sugestão por cima de outra viagem.
    .filter((item) => !(item.intentionId && input.existingTripMonths.includes(item.month)));

  for (const item of chosen.filter((costed) => costed.intention)) {
    const { id } = item.intention!;
    const suggestion = suggestions.find((row) => row.intentionId === id);
    outcomes.set(
      id,
      suggestion
        ? { intentionId: id, status: "sugerida", month: suggestion.month, total: suggestion.total }
        : { intentionId: id, status: "sem_vaga", total: toDbAmount(item.total) },
    );
  }
  return finish(suggestions);
}

/** Meses entre hoje e o mês da viagem, para quem precisa recalcular `monthlyToSave`. */
export function monthsUntil(today: string, month: YearMonth): number {
  return Math.max(1, monthsBetween(yearMonthOf(today), month));
}
