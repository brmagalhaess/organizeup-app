import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  estimateTrip,
  money,
  suggestTrips,
  type DestinationTemplate,
  type TripSuggestInput,
} from "../src";

// Destinos fictícios só para o teste; a tabela real (`trip_destination_templates`) cita a fonte e a
// data de cada linha. Valores redondos para a conta ser conferível à mão.
const destination = (
  overrides: Partial<DestinationTemplate> & { id: string },
): DestinationTemplate => ({
  name: overrides.id,
  country: "BR",
  region: "brasil",
  lodgingPerNight: "300.00",
  foodPerPersonDay: "100.00",
  localTransportPerPersonDay: "30.00",
  flightPerPerson: "0.00",
  minDays: 3,
  kidsFriendly: true,
  bestMonths: [],
  source: "tabela de teste, 10/2026",
  confidence: "baixa",
  ...overrides,
});

const praia = destination({ id: "praia", region: "brasil_perto", bestMonths: [1, 2, 7] });
const capital = destination({
  id: "capital",
  lodgingPerNight: "400.00",
  foodPerPersonDay: "120.00",
  localTransportPerPersonDay: "40.00",
  flightPerPerson: "800.00",
  minDays: 4,
  bestMonths: [7],
});
const europa = destination({
  id: "europa",
  country: "PT",
  region: "europa",
  lodgingPerNight: "900.00",
  foodPerPersonDay: "250.00",
  localTransportPerPersonDay: "60.00",
  flightPerPerson: "5000.00",
  minDays: 7,
  kidsFriendly: false,
  bestMonths: [5, 6, 9],
  confidence: "media",
});

// Dois adultos e uma criança de 8 anos (fator 0,7 em alimentação e transporte).
const family = [
  { personId: "p1", ageYears: 40 },
  { personId: "p2", ageYears: null },
  { personId: "p3", ageYears: 8 },
];

const base: TripSuggestInput = {
  today: "2026-10-31",
  tripsPerYear: 2,
  tripDays: 5,
  travelers: family,
  tripsBudgetMonthly: "1100.00",
  destinations: [praia, capital, europa],
  existingTripMonths: [],
  weddingMonth: null,
};

describe("custo estimado de um destino", () => {
  it("soma hospedagem, alimentação, transporte e passagem com fator de criança", () => {
    // 5 dias, 4 noites: hospedagem 300 × 4 = 1.200; alimentação (1 + 1 + 0,7) × 100 × 5 = 1.350;
    // transporte 2,7 × 30 × 5 = 405; passagem 0 → 2.955, ou 985 por pessoa.
    expect(estimateTrip(praia, family, 5)).toEqual({
      days: 5,
      estimated: {
        passagem: "0.00",
        hospedagem: "1200.00",
        alimentacao: "1350.00",
        transporte: "405.00",
      },
      total: "2955.00",
      perPerson: "985.00",
    });
  });

  it("acima de 4 pessoas a hospedagem cresce 50% por pessoa extra e usa a duração mínima", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ personId: String(i), ageYears: 30 }));
    // 5 dias (mínimo 3, padrão 5): hospedagem 300 × 4 × 2 = 2.400.
    const estimate = estimateTrip(praia, six, null);
    expect(estimate.days).toBe(5);
    expect(estimate.estimated.hospedagem).toBe("2400.00");
  });
});

describe("sugestão de viagens", () => {
  it("escolhe as mais caras que cabem, em regiões diferentes, e marca os meses", () => {
    // Orçamento 1.100 × 12 / 2 = 6.600 por viagem: cabem praia (2.955) e capital (6.160); europa
    // nem é considerada porque há criança. A mais barata vem primeiro: 4 meses à frente, em
    // fevereiro (boa época); a capital espera caber no orçamento e cai em julho de 2028.
    const result = suggestTrips(base);
    expect(result.map((s) => s.destinationId)).toEqual(["praia", "capital"]);
    expect(result[0]).toMatchObject({
      month: "2027-02",
      days: 5,
      personIds: ["p1", "p2", "p3"],
      total: "2955.00",
      perPerson: "985.00",
      monthlyToSave: "738.75",
      fits: true,
      confidence: "baixa",
      source: "tabela de teste, 10/2026",
    });
    expect(result[0]!.note).toContain("fevereiro é boa época");
    expect(result[1]).toMatchObject({ month: "2028-07", total: "6160.00", fits: true });
    expect(result[1]!.monthlyToSave).toBe("293.33");
  });

  it("sem criança o destino caro entra e as regiões não se repetem", () => {
    const adults = family.slice(0, 2);
    const result = suggestTrips({
      ...base,
      travelers: adults,
      tripsPerYear: 3,
      tripsBudgetMonthly: "5000.00",
    });
    expect(new Set(result.map((s) => s.destinationId))).toEqual(
      new Set(["praia", "capital", "europa"]),
    );
    expect(result.find((s) => s.destinationId === "europa")!.total).toBe("16700.00");
  });

  it("quando nada cabe, sugere a mais barata e diz quanto falta por mês", () => {
    // 100 × 12 / 2 = 600 por viagem; a praia custa 2.955 → (2.955 − 600) / 12 = 196,25 a mais.
    const [only, ...rest] = suggestTrips({ ...base, tripsBudgetMonthly: "100.00" });
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ destinationId: "praia", fits: false });
    // `formatBRL` separa "R$" do número com espaço inseparável.
    expect(only!.note.split(String.fromCharCode(160)).join(" ")).toContain(
      "Guarde R$ 196,25 a mais por mês",
    );
  });

  it("uma viagem cai no aniversário de casamento", () => {
    // Praia cairia em fevereiro (4 meses à frente); o aniversário em março ainda dá tempo de guardar.
    const result = suggestTrips({
      ...base,
      tripsPerYear: 1,
      destinations: [praia],
      weddingMonth: 3,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.month).toBe("2027-03");
    expect(result[0]!.note).toContain("aniversário de casamento");
    // Aniversário em dezembro fica a menos de 4 meses: vai para o ano seguinte.
    const next = suggestTrips({
      ...base,
      tripsPerYear: 1,
      destinations: [praia],
      weddingMonth: 12,
    });
    expect(next[0]!.month).toBe("2027-12");
  });

  it("evita meses que já têm viagem", () => {
    const result = suggestTrips({ ...base, tripsPerYear: 1, existingTripMonths: ["2027-02"] });
    expect(result[0]!.month).not.toBe("2027-02");
  });

  it("sem viagens por ano ou sem destinos não sugere nada", () => {
    expect(suggestTrips({ ...base, tripsPerYear: 0 })).toEqual([]);
    expect(suggestTrips({ ...base, destinations: [] })).toEqual([]);
  });

  it("invariantes: cabe ⇒ soma mensal dentro do orçamento; meses distintos; quantidade limitada", () => {
    const destinationArb = fc.record({
      id: fc.uuid(),
      region: fc.constantFrom(
        "brasil_perto" as const,
        "brasil" as const,
        "america_sul" as const,
        "europa" as const,
      ),
      lodgingPerNight: fc.integer({ min: 100, max: 1500 }).map(String),
      foodPerPersonDay: fc.integer({ min: 50, max: 400 }).map(String),
      localTransportPerPersonDay: fc.integer({ min: 0, max: 100 }).map(String),
      flightPerPerson: fc.integer({ min: 0, max: 8000 }).map(String),
      minDays: fc.integer({ min: 2, max: 10 }),
      kidsFriendly: fc.boolean(),
      bestMonths: fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 4 }),
    });
    const input = fc.record({
      tripsPerYear: fc.integer({ min: 1, max: 6 }),
      tripDays: fc.option(fc.integer({ min: 2, max: 15 }), { nil: null }),
      tripsBudgetMonthly: fc.integer({ min: 0, max: 800_000 }).map((c) => (c / 100).toFixed(2)),
      destinations: fc
        .array(destinationArb, { minLength: 1, maxLength: 8 })
        .map((list) => list.map((d) => destination(d))),
      existingTripMonths: fc.uniqueArray(
        fc.constantFrom("2027-01", "2027-02", "2027-03", "2027-07"),
      ),
      weddingMonth: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
      kids: fc.integer({ min: 0, max: 2 }),
    });
    fc.assert(
      fc.property(input, ({ kids, ...data }) => {
        const travelers = [
          ...family.slice(0, 2),
          ...Array.from({ length: kids }, (_, i) => ({ personId: `k${i}`, ageYears: 5 + i })),
        ];
        const result = suggestTrips({ ...base, ...data, travelers });
        expect(result.length).toBeLessThanOrEqual(data.tripsPerYear);
        expect(new Set(result.map((s) => s.month)).size).toBe(result.length);
        for (const s of result) expect(data.existingTripMonths).not.toContain(s.month);
        if (result.length > 0 && result.every((s) => s.fits)) {
          const months = [...new Set(result.map((s) => s.month))].sort();
          for (const month of ["2026-10", ...months]) {
            const saving = result
              .filter((s) => s.month > month)
              .reduce((acc, s) => acc.plus(s.monthlyToSave), money(0));
            expect(saving.lte(money(data.tripsBudgetMonthly).plus(0.01 * result.length))).toBe(
              true,
            );
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});
