// Cópia congelada de `suggestTrips` como estava antes das intenções (commit 51335bc), só para o teste
// provar que família sem intenção recebe exatamente o mesmo. Não importe fora dos testes nem atualize.
import { addMonths, yearMonthOf, type YearMonth } from "../src/cashflow";
import { message, moneyValue, type Message } from "../src/messages";
import { formatMoney, money, toCents, toDbAmount, type MoneyValue } from "../src/money";
import type {
  DestinationRegion,
  DestinationTemplate,
  TripEstimate,
  TripSuggestInput,
  TripSuggestion,
  TripTraveler,
} from "../src/trip-suggest";

const TRIP_RULES = {
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

interface Costed {
  destination: DestinationTemplate;
  days: number;
  estimated: Record<keyof TripEstimate, MoneyValue>;
  total: MoneyValue;
}

const sumOf = (values: MoneyValue[]) => values.reduce((acc, value) => acc.plus(value), money(0));

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

/**
 * Escolhe até `tripsPerYear` destinos que cabem no orçamento anual (os mais caros primeiro, regiões
 * diferentes quando possível), marca um mês para cada uma e diz quanto guardar por mês.
 */
export function suggestTripsBefore(input: TripSuggestInput): TripSuggestion[] {
  const count = Math.floor(input.tripsPerYear);
  if (count <= 0 || input.destinations.length === 0) return [];
  const hasChild = input.travelers.some(
    (traveler) => traveler.ageYears !== null && traveler.ageYears < TRIP_RULES.childAge,
  );
  const options = input.destinations
    .filter((destination) => !hasChild || destination.kidsFriendly)
    .map((destination) => costOf(destination, input.travelers, input.tripDays))
    .filter((costed) => costed.total.gt(0));
  if (options.length === 0) return [];

  const monthly = toCents(input.tripsBudgetMonthly).gt(0)
    ? toCents(input.tripsBudgetMonthly)
    : money(0);
  const perTrip = monthly.times(12).dividedBy(count);
  const fitting = options
    .filter((costed) => costed.total.lte(perTrip))
    .sort(
      (a, b) => b.total.comparedTo(a.total) || a.destination.id.localeCompare(b.destination.id),
    );

  let chosen: Costed[] = [];
  let nothingFits = false;
  if (fitting.length === 0) {
    nothingFits = true;
    chosen = [
      [...options].sort(
        (a, b) => a.total.comparedTo(b.total) || a.destination.id.localeCompare(b.destination.id),
      )[0]!,
    ];
  } else {
    const regions = new Set<DestinationRegion>();
    const pool = [...fitting];
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

  // Meses: da mais barata para a mais cara, cada uma depois de dar tempo de guardar o acumulado.
  const currentMonth = yearMonthOf(input.today);
  const used = new Set(input.existingTripMonths);
  const ordered = [...chosen].sort((a, b) => a.total.comparedTo(b.total));
  const offsets: number[] = [];
  let cumulative = money(0);
  const rateFor = (costed: Costed, offset: number) => costed.total.dividedBy(Math.max(1, offset));
  const totalRate = (upTo: number, candidate: number) =>
    sumOf(ordered.slice(0, upTo).map((c, i) => rateFor(c, offsets[i]!))).plus(
      rateFor(ordered[upTo]!, candidate),
    );
  const isFree = (offset: number) => !used.has(addMonths(currentMonth, offset));
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
    let offset = base;
    for (let candidate = base; candidate < base + 12; candidate += 1) {
      const month = addMonths(currentMonth, candidate);
      if (isFree(candidate) && costed.destination.bestMonths.includes(monthNumber(month))) {
        offset = candidate;
        break;
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
      const index = ordered.findIndex((_, i) => offsets[i]! <= weddingOffset);
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
  return ordered
    .map((costed, i): TripSuggestion => {
      const month = addMonths(currentMonth, offsets[i]!);
      const notes: string[] = [];
      const noteMessages: Message[] = [];
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
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
}
