// Intenções de viagem na mesma conta das sugestões (ADR-0026). A tabela de destinos aqui é fictícia, com
// valores redondos para a conta ser conferível à mão. A fonte das regras é o ADR-0015; a mediana, o ADR-0026.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  money,
  planTrips,
  regionEstimate,
  suggestTrips,
  TRIP_RULES,
  type DestinationTemplate,
  type TripIntention,
  type TripSuggestInput,
} from "../src";
import { suggestTripsBefore } from "./trip-suggest-antes";

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
  confidence: "media",
  ...overrides,
});

const praia = destination({ id: "praia", bestMonths: [1, 2, 7] });
const capital = destination({
  id: "capital",
  lodgingPerNight: "400.00",
  flightPerPerson: "800.00",
  minDays: 4,
});
const lisboa = destination({
  id: "lisboa",
  country: "PT",
  region: "europa",
  lodgingPerNight: "900.00",
  foodPerPersonDay: "250.00",
  localTransportPerPersonDay: "60.00",
  flightPerPerson: "5000.00",
  minDays: 7,
  kidsFriendly: false,
  bestMonths: [5, 6, 9],
});
const roma = destination({
  id: "roma",
  country: "IT",
  region: "europa",
  lodgingPerNight: "700.00",
  foodPerPersonDay: "150.00",
  localTransportPerPersonDay: "40.00",
  flightPerPerson: "4000.00",
  minDays: 6,
  bestMonths: [4],
});

const adults = [
  { personId: "p1", ageYears: 40 },
  { personId: "p2", ageYears: 38 },
];

const base: TripSuggestInput = {
  today: "2026-11-02",
  tripsPerYear: 2,
  tripDays: 5,
  travelers: adults,
  tripsBudgetMonthly: "2000.00",
  destinations: [praia, capital, lisboa, roma],
  existingTripMonths: [],
  weddingMonth: null,
};

const intention = (over: Partial<TripIntention> & { id: string }): TripIntention => ({
  destinationId: null,
  customName: null,
  customRegion: null,
  preferredMonth: null,
  days: null,
  fulfilled: false,
  refusedYear: null,
  ...over,
});

const destinationArb = fc.record({
  id: fc.uuid(),
  region: fc.constantFrom("brasil" as const, "america_sul" as const, "europa" as const),
  lodgingPerNight: fc.integer({ min: 100, max: 1500 }).map(String),
  foodPerPersonDay: fc.integer({ min: 50, max: 400 }).map(String),
  localTransportPerPersonDay: fc.integer({ min: 0, max: 100 }).map(String),
  flightPerPerson: fc.integer({ min: 0, max: 8000 }).map(String),
  minDays: fc.integer({ min: 2, max: 10 }),
  kidsFriendly: fc.boolean(),
  bestMonths: fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 4 }),
});

const inputArb = fc.record({
  today: fc.constantFrom("2026-01-15", "2026-07-31", "2026-11-02", "2026-12-31", "2027-02-01"),
  tripsPerYear: fc.integer({ min: 0, max: 6 }),
  tripDays: fc.option(fc.integer({ min: 2, max: 15 }), { nil: null }),
  tripsBudgetMonthly: fc.integer({ min: 0, max: 800_000 }).map((c) => (c / 100).toFixed(2)),
  destinations: fc
    .array(destinationArb, { minLength: 1, maxLength: 8 })
    .map((list) => list.map((row) => destination(row))),
  existingTripMonths: fc.uniqueArray(
    fc.constantFrom("2027-01", "2027-02", "2027-03", "2027-07", "2027-12"),
  ),
  weddingMonth: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
  kids: fc.integer({ min: 0, max: 2 }),
});

const withKids = (kids: number) => [
  ...adults,
  ...Array.from({ length: kids }, (_, i) => ({ personId: `k${i}`, ageYears: 5 + i })),
];

describe("sem intenção", () => {
  it("o resultado é idêntico ao da função antiga, em qualquer família", () => {
    fc.assert(
      fc.property(inputArb, ({ kids, ...data }) => {
        const input = { ...data, travelers: withKids(kids) };
        const before = suggestTripsBefore(input);
        expect(suggestTrips(input)).toStrictEqual(before);
        expect(suggestTrips({ ...input, intentions: [] })).toStrictEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  it("nenhuma sugestão ganha campo de intenção", () => {
    for (const item of suggestTrips(base)) {
      expect(Object.keys(item)).not.toContain("intentionId");
      expect(Object.keys(item)).not.toContain("regionEstimate");
      expect(Object.keys(item)).not.toContain("postponed");
    }
  });
});

describe("intenção do catálogo", () => {
  it("cabe e passa na frente do catálogo, e a vaga que sobra segue o catálogo", () => {
    // 4.000 × 12 / 2 = 24.000 por viagem. Sem intenção, saem as mais caras que cabem, sem a praia.
    const rich = { ...base, tripsBudgetMonthly: "4000.00" };
    const plain = suggestTrips(rich).map((item) => item.destinationId);
    const result = planTrips({
      ...rich,
      intentions: [intention({ id: "i1", destinationId: "praia" })],
    });
    expect(plain).not.toContain("praia");
    expect(result.suggestions).toHaveLength(2);
    const asked = result.suggestions.find((item) => item.intentionId === "i1")!;
    expect(asked.destinationId).toBe("praia");
    expect(result.suggestions.filter((item) => item.destinationId === "praia")).toHaveLength(1);
    expect(result.intentions).toEqual([
      { intentionId: "i1", status: "sugerida", month: asked.month, total: asked.total },
    ]);
  });

  it("usa os mesmos custos da sugestão sem intenção", () => {
    const [asked] = suggestTrips({
      ...base,
      tripsPerYear: 1,
      intentions: [intention({ id: "i1", destinationId: "capital" })],
    });
    const [plain] = suggestTrips({ ...base, tripsPerYear: 1, destinations: [capital] });
    expect({ ...asked, intentionId: undefined }).toEqual({ ...plain, intentionId: undefined });
  });

  it("dias da intenção valem no lugar dos dias da família", () => {
    const [asked] = suggestTrips({
      ...base,
      tripsPerYear: 1,
      intentions: [intention({ id: "i1", destinationId: "praia", days: 10 })],
    });
    expect(asked!.days).toBe(10);
    // 9 noites × 300 + 2 × 100 × 10 + 2 × 30 × 10.
    expect(asked!.total).toBe("5300.00");
  });

  it("sem dias na intenção nem na família, vale a regra atual", () => {
    const [asked] = suggestTrips({
      ...base,
      tripDays: null,
      tripsPerYear: 1,
      intentions: [intention({ id: "i1", destinationId: "lisboa" })],
    });
    expect(asked!.days).toBe(7);
  });

  it("respeita o teto de viagens: quem não entra diz que ficou sem vaga", () => {
    const result = planTrips({
      ...base,
      tripsPerYear: 1,
      tripsBudgetMonthly: "4000.00",
      intentions: [
        intention({ id: "i1", destinationId: "praia" }),
        intention({ id: "i2", destinationId: "capital" }),
      ],
    });
    expect(result.suggestions.map((item) => item.intentionId)).toEqual(["i2"]);
    expect(result.intentions[0]).toMatchObject({ intentionId: "i1", status: "sem_vaga" });
  });

  it("entre intenções vale o critério do catálogo: regiões diferentes quando possível", () => {
    const result = suggestTrips({
      ...base,
      tripsPerYear: 2,
      tripsBudgetMonthly: "5000.00",
      intentions: [
        intention({ id: "i1", destinationId: "praia" }),
        intention({ id: "i2", destinationId: "lisboa" }),
        intention({ id: "i3", destinationId: "roma" }),
      ],
    });
    expect(result.map((item) => item.intentionId).sort()).toEqual(["i1", "i2"]);
  });

  it("evita mês ocupado também sem mês preferido", () => {
    const [plain] = suggestTrips({
      ...base,
      tripsPerYear: 1,
      intentions: [intention({ id: "i1", destinationId: "praia" })],
    });
    const [moved] = suggestTrips({
      ...base,
      tripsPerYear: 1,
      existingTripMonths: [plain!.month],
      intentions: [intention({ id: "i1", destinationId: "praia" })],
    });
    expect(moved!.month).not.toBe(plain!.month);
  });

  it("a viagem sem mês preferido pode ir para o mês do casamento; a com mês preferido não", () => {
    const free = suggestTrips({
      ...base,
      tripsPerYear: 1,
      weddingMonth: 6,
      destinations: [roma],
      tripsBudgetMonthly: "4000.00",
      intentions: [intention({ id: "i1", destinationId: "roma" })],
    });
    expect(free[0]!.month).toBe("2027-06");
    const pinned = suggestTrips({
      ...base,
      tripsPerYear: 1,
      weddingMonth: 6,
      destinations: [roma],
      tripsBudgetMonthly: "4000.00",
      intentions: [intention({ id: "i1", destinationId: "roma", preferredMonth: 8 })],
    });
    expect(pinned[0]!.month).toBe("2027-08");
  });
});

describe("mês preferido", () => {
  const ask = (preferredMonth: number, over: Partial<TripSuggestInput> = {}) =>
    planTrips({
      ...base,
      tripsPerYear: 1,
      ...over,
      intentions: [intention({ id: "i1", destinationId: "praia", preferredMonth })],
    });

  it("é respeitado quando dá tempo de guardar", () => {
    // Hoje é novembro de 2026; agosto está a 9 meses.
    const [item] = ask(8).suggestions;
    expect(item!.month).toBe("2027-08");
    expect(item!.postponed).toBeUndefined();
    expect(item!.note).not.toContain("ficou para");
  });

  it("sem tempo de guardar, fica para o mesmo mês do ano seguinte, com nota", () => {
    // Janeiro está a 2 meses, menos que os 4 de guardar.
    const [item] = ask(1).suggestions;
    expect(item!.month).toBe("2028-01");
    expect(item!.postponed).toEqual({ from: "2027-01", reason: "tempo" });
    expect(item!.note).toContain("não daria tempo de guardar");
    expect(item!.noteMessages).toContainEqual({
      key: "frases.viagemMesSemTempo",
      params: { from: { month: "2027-01" }, to: { month: "2028-01" } },
    });
  });

  it("o mês atual também não dá tempo", () => {
    const [item] = ask(11).suggestions;
    expect(item!.month).toBe("2027-11");
    expect(item!.postponed).toEqual({ from: "2026-11", reason: "tempo" });
  });

  it("mês já ocupado vai para o mesmo mês do ano seguinte, com nota", () => {
    const [item] = ask(8, { existingTripMonths: ["2027-08"] }).suggestions;
    expect(item!.month).toBe("2028-08");
    expect(item!.postponed).toEqual({ from: "2027-08", reason: "ocupado" });
    expect(item!.note).toContain("já há outra viagem");
  });

  it("orçamento curto também conta como falta de tempo", () => {
    // Custo 1.200 + 1.000 + 300 = 2.500. Com 240 por mês, juntar leva 11 meses, e agosto está a 9.
    const [item] = ask(8, { tripsBudgetMonthly: "240.00" }).suggestions;
    expect(item!.month).toBe("2028-08");
    expect(item!.postponed?.reason).toBe("tempo");
  });

  it("outra viagem não toma o lugar do mês preferido", () => {
    const result = suggestTrips({
      ...base,
      destinations: [praia, capital],
      intentions: [intention({ id: "i1", destinationId: "capital", preferredMonth: 2 })],
    });
    const asked = result.find((item) => item.intentionId === "i1")!;
    expect(asked.month.slice(5)).toBe("02");
    expect(new Set(result.map((item) => item.month)).size).toBe(result.length);
  });
});

describe("destino fora do catálogo", () => {
  const europa = [
    destination({
      id: "a",
      region: "europa",
      lodgingPerNight: "100.00",
      foodPerPersonDay: "10.00",
      localTransportPerPersonDay: "1.00",
      flightPerPerson: "1000.00",
      minDays: 4,
    }),
    destination({
      id: "b",
      region: "europa",
      lodgingPerNight: "300.00",
      foodPerPersonDay: "20.00",
      localTransportPerPersonDay: "3.00",
      flightPerPerson: "3000.00",
      minDays: 7,
    }),
    destination({
      id: "c",
      region: "europa",
      lodgingPerNight: "900.00",
      foodPerPersonDay: "30.00",
      localTransportPerPersonDay: "5.00",
      flightPerPerson: "5000.00",
      minDays: 8,
    }),
    destination({
      id: "d",
      region: "europa",
      lodgingPerNight: "200.00",
      foodPerPersonDay: "40.00",
      localTransportPerPersonDay: "7.00",
      flightPerPerson: "7000.00",
      minDays: 5,
    }),
  ];

  it("cada custo é a mediana da região, somando só as linhas dela", () => {
    const estimate = regionEstimate("europa", [...europa, praia]);
    expect(estimate).toMatchObject({ region: "europa", destinations: 4 });
    expect(estimate!.template).toMatchObject({
      // Pares: média dos dois do meio. 200 e 300; 20 e 30; 3 e 5; 3.000 e 5.000.
      lodgingPerNight: "250.00",
      foodPerPersonDay: "25.00",
      localTransportPerPersonDay: "4.00",
      flightPerPerson: "4000.00",
      minDays: 6,
      confidence: "baixa",
      bestMonths: [],
    });
  });

  it("com número ímpar de linhas, é a do meio", () => {
    expect(regionEstimate("europa", europa.slice(0, 3))!.template.lodgingPerNight).toBe("300.00");
  });

  it("sugere com confiança baixa e diz que é estimativa pela região", () => {
    const [item] = suggestTrips({
      ...base,
      tripsPerYear: 1,
      tripDays: null,
      tripsBudgetMonthly: "5000.00",
      destinations: europa,
      intentions: [intention({ id: "i1", customName: "Praga", customRegion: "europa", days: 8 })],
    });
    expect(item).toMatchObject({
      destinationId: "intencao:i1",
      name: "Praga",
      days: 8,
      confidence: "baixa",
      intentionId: "i1",
      regionEstimate: { region: "europa", destinations: 4 },
    });
    expect(item!.note).toContain("estimado pela região Europa");
    expect(item!.source).toBe("mediana de 4 destinos da região na nossa tabela.");
    expect(item!.noteMessages).toContainEqual({
      key: "frases.viagemEstimativaRegiao",
      params: { region: "europa" },
    });
    // 7 noites × 250 + 2 × 25 × 8 + 2 × 4 × 8 + 2 × 4.000.
    expect(item!.total).toBe("10214.00");
  });

  it("região sem linha usa a mais próxima, e a nota diz qual", () => {
    const [item] = suggestTrips({
      ...base,
      tripsPerYear: 1,
      destinations: [praia, capital],
      intentions: [intention({ id: "i1", customName: "Sítio", customRegion: "brasil_perto" })],
    });
    expect(item!.regionEstimate).toEqual({ region: "brasil", destinations: 2 });
    expect(item!.note).toContain("região Brasil");
  });

  it("região sem nenhuma referência explica em vez de sumir", () => {
    const result = planTrips({
      ...base,
      destinations: [praia],
      intentions: [intention({ id: "i1", customName: "Kyoto", customRegion: "asia_oceania" })],
    });
    expect(result.intentions).toEqual([{ intentionId: "i1", status: "sem_estimativa" }]);
  });

  it("nome livre não precisa de catálogo para entrar na conta da região", () => {
    expect(regionEstimate("europa", [])).toBeNull();
    expect(
      planTrips({
        ...base,
        destinations: [],
        intentions: [intention({ id: "i1", customName: "Praga", customRegion: "europa" })],
      }),
    ).toEqual({ suggestions: [], intentions: [{ intentionId: "i1", status: "sem_estimativa" }] });
  });
});

describe("quando não dá", () => {
  it("não cabe: diz o custo, quanto guardar a mais e o primeiro mês em que fecha", () => {
    // Orçamento 500: 3.000 por viagem. Lisboa custa 16.700 → 16.700 × 2 / 12 − 500 = 2.283,34.
    const result = planTrips({
      ...base,
      tripsBudgetMonthly: "500.00",
      intentions: [intention({ id: "i1", destinationId: "lisboa", days: 7 })],
    });
    expect(result.suggestions.map((item) => item.intentionId)).not.toContain("i1");
    const [outcome] = result.intentions;
    expect(outcome).toMatchObject({ intentionId: "i1", status: "nao_cabe" });
  });

  it("primeiro mês: junta o valor com o orçamento de hoje, dentro de 36 meses", () => {
    const [outcome] = planTrips({
      ...base,
      tripsPerYear: 1,
      tripsBudgetMonthly: "400.00",
      tripDays: 5,
      destinations: [roma],
      intentions: [intention({ id: "i1", destinationId: "roma" })],
    }).intentions;
    // 4 noites × 700 + 2 × 150 × 5 + 2 × 40 × 5 + 2 × 4.000 = 12.700; 12.700 / 400 = 31,75 → 32 meses.
    expect(outcome).toEqual({
      intentionId: "i1",
      status: "nao_cabe",
      total: "12700.00",
      extraMonthly: "658.34",
      firstMonth: "2029-07",
    });
  });

  it("o primeiro mês pula mês ocupado", () => {
    const [outcome] = planTrips({
      ...base,
      tripsPerYear: 1,
      tripsBudgetMonthly: "400.00",
      destinations: [roma],
      existingTripMonths: ["2029-07"],
      intentions: [intention({ id: "i1", destinationId: "roma" })],
    }).intentions;
    expect(outcome).toMatchObject({ firstMonth: "2029-08" });
  });

  it("sem orçamento, não há primeiro mês: só quanto guardar", () => {
    const [outcome] = planTrips({
      ...base,
      tripsPerYear: 1,
      tripsBudgetMonthly: "0.00",
      destinations: [roma],
      intentions: [intention({ id: "i1", destinationId: "roma" })],
    }).intentions;
    expect(outcome).toMatchObject({ firstMonth: null, extraMonthly: "1058.34" });
  });

  it("a vaga da intenção que não coube segue o catálogo", () => {
    const result = planTrips({
      ...base,
      tripsPerYear: 1,
      tripsBudgetMonthly: "400.00",
      intentions: [intention({ id: "i1", destinationId: "roma" })],
    });
    expect(result.suggestions.map((item) => item.destinationId)).toEqual(["capital"]);
  });

  it("destino não indicado para crianças não sugere, e o cartão explica", () => {
    const result = planTrips({
      ...base,
      travelers: withKids(1),
      intentions: [intention({ id: "i1", destinationId: "lisboa" })],
    });
    expect(result.suggestions.map((item) => item.destinationId)).not.toContain("lisboa");
    expect(result.intentions).toEqual([{ intentionId: "i1", status: "criancas" }]);
  });

  it("a mesma intenção sem criança na viagem é sugerida", () => {
    const result = planTrips({
      ...base,
      tripsBudgetMonthly: "4000.00",
      intentions: [intention({ id: "i1", destinationId: "lisboa" })],
    });
    expect(result.intentions[0]).toMatchObject({ status: "sugerida" });
  });
});

describe("decisões da família", () => {
  it("recusada fica de fora até o fim do ano recusado, e nem o catálogo traz o destino", () => {
    const refused = (today: string) =>
      planTrips({
        ...base,
        today,
        tripsBudgetMonthly: "4000.00",
        destinations: [lisboa, roma],
        intentions: [intention({ id: "i1", destinationId: "lisboa", refusedYear: 2027 })],
      });
    for (const today of ["2026-11-02", "2027-12-31"]) {
      const result = refused(today);
      expect(result.intentions).toEqual([
        { intentionId: "i1", status: "recusada", untilYear: 2027 },
      ]);
      expect(result.suggestions.map((item) => item.destinationId)).toEqual(["roma"]);
    }
    expect(refused("2028-01-01").intentions[0]).toMatchObject({ status: "sugerida" });
  });

  it("recusa antiga não segura mais nada", () => {
    const [outcome] = planTrips({
      ...base,
      intentions: [intention({ id: "i1", destinationId: "praia", refusedYear: 2025 })],
    }).intentions;
    expect(outcome).toMatchObject({ status: "sugerida" });
  });

  it("atendida não sugere de novo, e o destino não volta pelo catálogo", () => {
    const result = planTrips({
      ...base,
      destinations: [praia, capital],
      intentions: [intention({ id: "i1", destinationId: "capital", fulfilled: true })],
    });
    expect(result.intentions).toEqual([{ intentionId: "i1", status: "atendida" }]);
    expect(result.suggestions.map((item) => item.destinationId)).toEqual(["praia"]);
  });
});

describe("nome livre igual a destino do catálogo", () => {
  const inEurope = { customRegion: "europa" as const };

  it("vale como o destino do catálogo: custo, confiança e nome da tabela", () => {
    for (const customName of ["lisboa", " LISBOA ", "Lisbôa"]) {
      const result = planTrips({
        ...base,
        tripsBudgetMonthly: "4000.00",
        intentions: [intention({ id: "i1", customName, ...inEurope })],
      });
      const [suggestion] = result.suggestions.filter((item) => item.intentionId === "i1");
      expect(suggestion, customName).toMatchObject({
        destinationId: "lisboa",
        name: "lisboa",
        confidence: "media",
      });
      expect(suggestion!.regionEstimate).toBeUndefined();
    }
  });

  it("com duas vagas, o mesmo lugar não sai duas vezes", () => {
    const names = planTrips({
      ...base,
      tripsBudgetMonthly: "6000.00",
      destinations: [lisboa, roma],
      intentions: [intention({ id: "i1", customName: "Lisboa", ...inEurope })],
    }).suggestions.map((item) => item.destinationId);
    expect(names).toEqual(expect.arrayContaining(["lisboa", "roma"]));
    expect(names).toHaveLength(2);
  });

  it("recusada não volta pelo catálogo", () => {
    const result = planTrips({
      ...base,
      tripsBudgetMonthly: "4000.00",
      destinations: [lisboa, roma],
      intentions: [
        intention({ id: "i1", customName: "LISBOA", ...inEurope, refusedYear: 2027 }),
      ],
    });
    expect(result.intentions[0]).toMatchObject({ status: "recusada" });
    expect(result.suggestions.map((item) => item.destinationId)).toEqual(["roma"]);
  });

  it("atendida não volta pelo catálogo", () => {
    const result = planTrips({
      ...base,
      destinations: [lisboa, roma],
      tripsBudgetMonthly: "4000.00",
      intentions: [intention({ id: "i1", customName: "Lisboa", ...inEurope, fulfilled: true })],
    });
    expect(result.suggestions.map((item) => item.destinationId)).toEqual(["roma"]);
  });

  it("não indicado para crianças vale também para o nome livre", () => {
    const [outcome] = planTrips({
      ...base,
      travelers: withKids(1),
      destinations: [{ ...lisboa, kidsFriendly: false }, roma],
      intentions: [intention({ id: "i1", customName: "Lisboa", ...inEurope })],
    }).intentions;
    expect(outcome).toMatchObject({ status: "criancas" });
  });

  it("duas linhas do mesmo lugar viram uma sugestão só", () => {
    const result = planTrips({
      ...base,
      tripsBudgetMonthly: "6000.00",
      destinations: [lisboa, roma],
      intentions: [
        intention({ id: "i1", destinationId: "lisboa" }),
        intention({ id: "i2", customName: "Lisboa", ...inEurope }),
      ],
    });
    expect(result.suggestions.filter((item) => item.destinationId === "lisboa")).toHaveLength(1);
    expect(result.intentions.map((outcome) => outcome.status).toSorted()).toEqual([
      "sem_vaga",
      "sugerida",
    ]);
  });

  it("a recusa de uma linha segura a outra do mesmo lugar", () => {
    const result = planTrips({
      ...base,
      tripsBudgetMonthly: "6000.00",
      destinations: [lisboa, roma],
      intentions: [
        intention({ id: "i1", destinationId: "lisboa", refusedYear: 2027 }),
        intention({ id: "i2", customName: "Lisboa", ...inEurope }),
      ],
    });
    expect(result.suggestions.map((item) => item.destinationId)).toEqual(["roma"]);
    expect(result.intentions[1]).toEqual({
      intentionId: "i2",
      status: "recusada",
      untilYear: 2027,
    });
  });

  it("a linha atendida segura a outra do mesmo lugar", () => {
    const result = planTrips({
      ...base,
      tripsBudgetMonthly: "6000.00",
      destinations: [lisboa, roma],
      intentions: [
        intention({ id: "i1", customName: "Lisboa", ...inEurope }),
        intention({ id: "i2", destinationId: "lisboa", fulfilled: true }),
      ],
    });
    expect(result.suggestions.map((item) => item.destinationId)).toEqual(["roma"]);
    expect(result.intentions[0]).toEqual({ intentionId: "i1", status: "atendida" });
  });

  it("nome de verdade fora do catálogo segue a conta da região", () => {
    const { suggestions } = planTrips({
      ...base,
      tripsBudgetMonthly: "4000.00",
      intentions: [intention({ id: "i1", customName: "Praga", ...inEurope })],
    });
    expect(suggestions.find((item) => item.intentionId === "i1")).toMatchObject({
      destinationId: "intencao:i1",
      confidence: "baixa",
    });
  });
});

describe("sem viagens por ano", () => {
  const solo = { ...base, tripsPerYear: 0 };

  it("sem intenção, nada", () => {
    expect(planTrips(solo)).toEqual({ suggestions: [], intentions: [] });
  });

  it("uma sugestão só, sem catálogo, mesmo com várias intenções", () => {
    const result = planTrips({
      ...solo,
      intentions: [
        intention({ id: "i1", destinationId: "praia" }),
        intention({ id: "i2", destinationId: "capital" }),
      ],
    });
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.intentionId).toBe("i2");
    expect(result.intentions[0]).toMatchObject({ status: "sem_vaga" });
  });

  it("orçamento vale como uma viagem no ano", () => {
    const [outcome] = planTrips({
      ...solo,
      tripsBudgetMonthly: "100.00",
      intentions: [intention({ id: "i1", destinationId: "praia" })],
    }).intentions;
    // 5 dias: 1.200 + 1.000 + 300 = 2.500; 2.500 / 12 − 100 = 108,34.
    expect(outcome).toMatchObject({ status: "nao_cabe", extraMonthly: "108.34" });
  });

  it("a sugestão do ano já saiu: nenhuma outra, e o cartão diz por quê", () => {
    const result = planTrips({
      ...solo,
      intentionUsedThisYear: true,
      intentions: [intention({ id: "i1", destinationId: "praia" })],
    });
    expect(result).toEqual({
      suggestions: [],
      intentions: [{ intentionId: "i1", status: "uma_por_ano" }],
    });
  });
});

describe("propriedades", () => {
  const intentionsArb = (ids: fc.Arbitrary<number>) =>
    fc.array(
      fc.record({
        id: fc.uuid(),
        pick: fc.option(ids, { nil: null }),
        preferredMonth: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
        days: fc.option(fc.integer({ min: 1, max: 30 }), { nil: null }),
        refusedYear: fc.option(fc.integer({ min: 2025, max: 2029 }), { nil: null }),
        fulfilled: fc.boolean(),
        customRegion: fc.constantFrom(
          "brasil_perto" as const,
          "brasil" as const,
          "europa" as const,
          "asia_oceania" as const,
        ),
      }),
      { maxLength: 5 },
    );

  const build = (
    data: { destinations: DestinationTemplate[] },
    picks: Array<{
      id: string;
      pick: number | null;
      preferredMonth: number | null;
      days: number | null;
      refusedYear: number | null;
      fulfilled: boolean;
      customRegion: TripIntention["customRegion"];
    }>,
  ) => {
    const seen = new Set<string>();
    return picks.flatMap(({ pick, customRegion, ...rest }): TripIntention[] => {
      const row = pick === null ? null : data.destinations[pick % data.destinations.length]!;
      if (row && seen.has(row.id)) return [];
      if (row) seen.add(row.id);
      return [
        row
          ? { ...rest, destinationId: row.id, customName: null, customRegion: null }
          : { ...rest, destinationId: null, customName: "Lugar", customRegion },
      ];
    });
  };

  const scenario = fc
    .tuple(inputArb, intentionsArb(fc.nat({ max: 7 })), fc.boolean())
    .map(([{ kids, ...data }, picks, intentionUsedThisYear]) => ({
      ...data,
      travelers: withKids(kids),
      intentions: build(data, picks),
      intentionUsedThisYear,
    }));

  it("mesmos limites: teto de viagens, meses livres e distintos, 4 a 36 meses", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        const { suggestions, intentions } = planTrips(input);
        expect(suggestions.length).toBeLessThanOrEqual(Math.max(input.tripsPerYear, 1));
        if (input.tripsPerYear === 0) {
          expect(suggestions.length).toBeLessThanOrEqual(1);
          if (input.intentionUsedThisYear) expect(suggestions).toEqual([]);
          for (const item of suggestions) expect(item.intentionId).toBeDefined();
        }
        expect(new Set(suggestions.map((item) => item.month)).size).toBe(suggestions.length);
        const asked = suggestions.filter((item) => item.intentionId);
        for (const item of suggestions) {
          expect(input.existingTripMonths).not.toContain(item.month);
        }
        const start = Number(input.today.slice(0, 4)) * 12 + Number(input.today.slice(5, 7));
        for (const item of asked) {
          const at = Number(item.month.slice(0, 4)) * 12 + Number(item.month.slice(5, 7));
          expect(at - start).toBeGreaterThanOrEqual(TRIP_RULES.minMonthsAhead);
          expect(at - start).toBeLessThanOrEqual(TRIP_RULES.maxMonthsAhead);
        }
        expect(intentions).toHaveLength(input.intentions.length);
      }),
      { numRuns: 300 },
    );
  });

  it("idempotente: a mesma entrada dá o mesmo resultado", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        expect(planTrips(input)).toStrictEqual(planTrips(structuredClone(input)));
      }),
      { numRuns: 100 },
    );
  });

  it("toda intenção aberta sai com um motivo, e nenhuma some em silêncio", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        const { suggestions, intentions } = planTrips(input);
        for (const outcome of intentions) {
          const sugerida = suggestions.some((item) => item.intentionId === outcome.intentionId);
          expect(sugerida).toBe(outcome.status === "sugerida");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("intenção que cabe nunca perde a vaga para o catálogo", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        const { suggestions, intentions } = planTrips(input);
        if (!intentions.some((outcome) => outcome.status === "sem_vaga")) return;
        const free = input.existingTripMonths.length === 0;
        if (free) expect(suggestions.every((item) => item.intentionId)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("recusada e atendida nunca viram sugestão, nem pelo catálogo", () => {
    fc.assert(
      fc.property(scenario, (input) => {
        const year = Number(input.today.slice(0, 4));
        const closed = input.intentions.filter(
          (item) => item.fulfilled || (item.refusedYear !== null && item.refusedYear >= year),
        );
        const { suggestions } = planTrips(input);
        for (const item of closed) {
          expect(suggestions.map((row) => row.intentionId)).not.toContain(item.id);
          if (item.destinationId) {
            expect(suggestions.map((row) => row.destinationId)).not.toContain(item.destinationId);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("guardar o que o cartão pede a mais faz a viagem caber", () => {
    fc.assert(
      fc.property(
        fc.record({
          budget: fc.integer({ min: 0, max: 50_000 }),
          count: fc.integer({ min: 1, max: 4 }),
          days: fc.integer({ min: 2, max: 20 }),
        }),
        ({ budget, count, days }) => {
          const input: TripSuggestInput = {
            ...base,
            tripsPerYear: count,
            tripsBudgetMonthly: (budget / 100).toFixed(2),
            intentions: [intention({ id: "i1", destinationId: "roma", days })],
          };
          const [outcome] = planTrips(input).intentions;
          if (outcome!.status !== "nao_cabe") return;
          const raised = money(input.tripsBudgetMonthly).plus(outcome!.extraMonthly).toFixed(2);
          const after = planTrips({ ...input, tripsBudgetMonthly: raised });
          expect(after.intentions[0]!.status).not.toBe("nao_cabe");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("dinheiro sai sempre com dois decimais, na região também", () => {
    fc.assert(
      fc.property(fc.array(destinationArb, { minLength: 1, maxLength: 7 }), (rows) => {
        const table = rows.map((row) => destination(row));
        const estimate = regionEstimate(table[0]!.region, table)!;
        for (const value of [
          estimate.template.lodgingPerNight,
          estimate.template.foodPerPersonDay,
          estimate.template.localTransportPerPersonDay,
          estimate.template.flightPerPerson,
        ]) {
          expect(value).toMatch(/^\d+\.\d{2}$/);
        }
      }),
      { numRuns: 100 },
    );
  });
});
