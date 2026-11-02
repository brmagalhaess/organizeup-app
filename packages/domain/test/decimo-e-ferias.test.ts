import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { addMonths, occurrenceDate, type ScheduledEntry } from "../src/cashflow";
import {
  calculatePayslip,
  calculateThirteenth,
  calculateVacation,
  findIncomeEntry,
  fiscalTableFor,
  incomeBetween,
  incomeKey,
  incomeYearView,
  isPayroll,
  monthIncome,
  openIncomeEntries,
  orphanVacationMonths,
  receivedInYear,
  splitByDays,
  thirteenthPlan,
  vacationPayouts,
  workedSalary,
  type FiscalTable,
  type IncomePart,
  type IncomeSourceInput,
  type PayrollInput,
} from "../src/income";
import {
  carryVacationKeys,
  defaultIncomePlan,
  parseVacationPeriods,
  planForYear,
  remainingVacationDays,
  serviceMonths,
  settleReceived,
  validateIncomePlan,
  vacationEvents,
  type IncomeYearPlan,
  type VacationPeriod,
} from "../src/income-plan";
import { money, toCents, toDbAmount } from "../src/money";

// Fontes de cada regra no ADR-0028. Tabelas de 2026: mesmas fontes de income.test.ts (ADR-0009).
const table2026: FiscalTable = {
  validFrom: "2026-01",
  minimumWage: "1621.00",
  inss: [
    { upTo: "1621.00", rate: "0.075" },
    { upTo: "2902.84", rate: "0.09" },
    { upTo: "4354.27", rate: "0.12" },
    { upTo: "8475.55", rate: "0.14" },
  ],
  irrf: [
    { upTo: "2428.80", rate: "0", deduction: "0" },
    { upTo: "2826.65", rate: "0.075", deduction: "182.16" },
    { upTo: "3751.05", rate: "0.15", deduction: "394.16" },
    { upTo: "4664.68", rate: "0.225", deduction: "675.49" },
    { upTo: null, rate: "0.275", deduction: "908.73" },
  ],
  dependentDeduction: "189.59",
  simplifiedDeduction: "607.20",
  reduction: {
    fullUpTo: "5000.00",
    maxAmount: "312.89",
    phaseOutUpTo: "7350.00",
    base: "978.62",
    factor: "0.133145",
  },
};
const tables = [table2026];

const source = (over: Partial<IncomeSourceInput> = {}): IncomeSourceInput => ({
  id: "s1",
  name: "Empresa",
  kind: "clt",
  amount: "6000.00",
  isGross: true,
  dependents: 0,
  pensionAmount: "0",
  otherDiscounts: "0",
  vacationMonth: null,
  payDay: 5,
  startMonth: "2026-01",
  endMonth: null,
  categoryId: "cat",
  accountId: "acc",
  ...over,
});

const plan = (over: Partial<IncomeYearPlan> = {}): IncomeYearPlan => ({
  ...defaultIncomePlan(2026, null),
  ...over,
});

const period = (month: number, startDay: number | null, days: number): VacationPeriod => ({
  month,
  startDay,
  days,
  received: false,
});

const lines = (input: IncomeSourceInput, month: string) =>
  monthIncome(input, tables, month).map((entry) => [entry.key, entry.date, entry.amount]);

// A função como estava antes do ADR-0028, copiada sem mudar nada: é o que "quem não escolhe nada tem o
// resultado de hoje" compara.
function oldMonthIncome(s: IncomeSourceInput, t: FiscalTable[], month: string): ScheduledEntry[] {
  if (month < s.startMonth) return [];
  if (s.endMonth !== null && month > s.endMonth) return [];

  const entry = (part: IncomePart, description: string, amount: string, date: string) => ({
    key: incomeKey(s.id, month, part),
    source: "renda" as const,
    id: s.id,
    kind: "receita" as const,
    description,
    amount,
    date,
    categoryId: s.categoryId,
    accountId: s.accountId,
  });
  const payDate = occurrenceDate(s.payDay, month);

  if (!isPayroll(s)) return [entry("salario", s.name, toDbAmount(s.amount), payDate)];

  const table = fiscalTableFor(t, month);
  const input: PayrollInput = {
    gross: s.amount,
    dependents: s.dependents,
    pension: s.pensionAmount,
    otherDiscounts: s.otherDiscounts,
  };
  const calendarMonth = Number(month.slice(5));
  const entries =
    calendarMonth === s.vacationMonth
      ? [entry("ferias", `Férias · ${s.name}`, calculateVacation(input, table).net, payDate)]
      : [entry("salario", s.name, calculatePayslip(input, table).net, payDate)];

  if (calendarMonth === 11)
    entries.push(
      entry(
        "13-1",
        `13º, 1ª parcela · ${s.name}`,
        calculateThirteenth(input, table).firstInstallment,
        `${month}-30`,
      ),
    );
  if (calendarMonth === 12)
    entries.push(
      entry(
        "13-2",
        `13º, 2ª parcela · ${s.name}`,
        calculateThirteenth(input, table).secondInstallment,
        `${month}-20`,
      ),
    );
  return entries.filter((item) => money(item.amount).gt(0));
}

const cents = (max: number, min = 0) =>
  fc.integer({ min, max }).map((value) => (value / 100).toFixed(2));

const anySource = fc.record({
  amount: cents(3_000_000, 10_000),
  dependents: fc.nat(4),
  pensionAmount: cents(200_000),
  otherDiscounts: cents(200_000),
  vacationMonth: fc.option(fc.integer({ min: 1, max: 12 }), { nil: null }),
  payDay: fc.integer({ min: 1, max: 31 }),
  isGross: fc.boolean(),
  kind: fc.constantFrom("clt" as const, "pj_autonomo" as const, "outro" as const),
});

describe("quem não escolhe nada tem o resultado de hoje", () => {
  const months = Array.from({ length: 24 }, (_, index) => addMonths("2026-01", index));

  it("sem plano, cada mês é igual ao da função antiga", () => {
    fc.assert(
      fc.property(anySource, (over) => {
        const input = source(over);
        for (const month of months)
          expect(monthIncome(input, tables, month)).toEqual(oldMonthIncome(input, tables, month));
      }),
    );
  });

  it("salvar o formulário sem mudar nada também não muda a previsão", () => {
    fc.assert(
      fc.property(anySource, (over) => {
        const input = source(over);
        const saved = { ...input, plans: [defaultIncomePlan(2026, input.vacationMonth)] };
        for (const month of months)
          expect(monthIncome(saved, tables, month)).toEqual(oldMonthIncome(input, tables, month));
      }),
    );
  });

  it("outros tipos ignoram as escolhas", () => {
    const rent = source({
      kind: "aluguel",
      amount: "1500.00",
      isGross: false,
      plans: [plan({ thirteenthMode: "integral", periods: [period(7, 1, 30)] })],
    });
    for (const month of months)
      expect(monthIncome(rent, tables, month)).toEqual(oldMonthIncome(rent, tables, month));
    expect(incomeYearView(rent, tables, 2026)).toBeNull();
  });
});

describe("13º em duas parcelas", () => {
  it("1ª em julho: sai de novembro e entra no dia do salário de julho", () => {
    const input = source({ plans: [plan({ firstMonth: 7 })] });
    expect(lines(input, "2026-07")).toContainEqual(["r:s1:2026-07:13-1", "2026-07-05", "3000.00"]);
    expect(lines(input, "2026-11").map(([key]) => key)).toEqual(["r:s1:2026-11:salario"]);
    expect(lines(input, "2026-12")[1]).toEqual(["r:s1:2026-12:13-2", "2026-12-20", "1973.39"]);
  });

  it("caso real: já recebida em julho, sem atraso, e a 2ª vem certa em dezembro", () => {
    const input = source({ plans: [plan({ firstMonth: 7, firstReceived: true })] });
    const all = incomeBetween([input], tables, "2026-01", "2026-12");
    expect(all.filter((entry) => entry.key.endsWith(":13-1"))).toEqual([]);
    expect(lines(input, "2026-12")[1]).toEqual(["r:s1:2026-12:13-2", "2026-12-20", "1973.39"]);
  });

  // Lei 4.749/1965, art. 1º: o que foi adiantado é compensado. Salário subiu depois da 1ª parcela.
  it("a 2ª desconta o valor informado, não a metade do salário atual", () => {
    const input = source({
      plans: [plan({ firstMonth: 7, firstReceived: true, firstAmount: "2800.00" })],
    });
    const thirteenth = thirteenthPlan(input, tables, 2026)!;
    expect(thirteenth.net).toBe("4973.39");
    expect(thirteenth.first?.amount).toBe("2800.00");
    expect(thirteenth.second.amount).toBe("2173.39");
  });

  it("julho em 2026 prevê julho em 2027, sem marca nem valor recebido", () => {
    const input = source({
      plans: [
        plan({
          firstMonth: 7,
          firstReceived: true,
          firstAmount: "2800.00",
          periods: [{ ...period(3, 10, 20), received: true, keyMonth: 2 }],
        }),
      ],
    });
    expect(lines(input, "2027-07")).toContainEqual(["r:s1:2027-07:13-1", "2027-07-05", "3000.00"]);
    expect(lines(input, "2027-11").map(([key]) => key)).toEqual(["r:s1:2027-11:salario"]);
    expect(lines(input, "2027-12")[1]?.[2]).toBe("1973.39");
    expect(lines(input, "2027-03").map(([key]) => key)).toContain("r:s1:2027-03:ferias");
    expect(incomeYearView(input, tables, 2027)?.inheritedFrom).toBe(2026);
    expect(incomeYearView(input, tables, 2026)?.inheritedFrom).toBeNull();
  });

  it("ano antes do plano fica como sempre foi", () => {
    const input = source({
      startMonth: "2025-01",
      plans: [plan({ year: 2026, firstMonth: 7 })],
    });
    expect(lines(input, "2025-11")).toContainEqual(["r:s1:2025-11:13-1", "2025-11-30", "3000.00"]);
    expect(lines(input, "2025-07").map(([key]) => key)).toEqual(["r:s1:2025-07:salario"]);
  });

  it("2ª parcela em outro mês cai no dia do salário", () => {
    const input = source({ plans: [plan({ firstMonth: 6, secondMonth: 10 })] });
    expect(lines(input, "2026-10")).toContainEqual(["r:s1:2026-10:13-2", "2026-10-05", "1973.39"]);
    expect(lines(input, "2026-12").map(([key]) => key)).toEqual(["r:s1:2026-12:salario"]);
  });

  it("1ª maior que o líquido não vira previsão negativa", () => {
    const input = source({ plans: [plan({ firstAmount: "5500.00" })] });
    expect(lines(input, "2026-12").map(([key]) => key)).toEqual(["r:s1:2026-12:salario"]);
  });

  it("as parcelas somam o líquido, com qualquer adiantamento", () => {
    fc.assert(
      fc.property(cents(3_000_000, 100_00), cents(100_000), (amount, advance) => {
        const result = thirteenthPlan(
          source({ amount, plans: [plan({ firstAmount: advance })] }),
          tables,
          2026,
        )!;
        expect(money(result.first!.amount).plus(result.second.amount).toFixed(2)).toBe(result.net);
      }),
    );
  });
});

describe("13º tudo de uma vez", () => {
  // Lei 8.134/1990, art. 16: IR no mês da quitação, sobre o valor inteiro.
  it("um pagamento só, com INSS e IR do valor inteiro", () => {
    const input = source({ plans: [plan({ thirteenthMode: "integral" })] });
    expect(lines(input, "2026-12")[1]).toEqual(["r:s1:2026-12:13-2", "2026-12-20", "4973.39"]);
    expect(monthIncome(input, tables, "2026-12")[1]?.description).toBe("13º salário · Empresa");
    expect(lines(input, "2026-11").map(([key]) => key)).toEqual(["r:s1:2026-11:salario"]);
  });

  it("no mês escolhido", () => {
    const input = source({ plans: [plan({ thirteenthMode: "integral", secondMonth: 11 })] });
    expect(lines(input, "2026-11")).toContainEqual(["r:s1:2026-11:13-2", "2026-11-30", "4973.39"]);
  });
});

// Lei 4.090/1962, art. 1º, §§ 1º e 2º; Decreto 10.854/2021, art. 78, § 4º, para o adiantamento.
describe("13º proporcional", () => {
  it("conta o mês com 15 dias ou mais", () => {
    // 17/03: 15 dias em março (17 a 31), conta. Abril a dezembro: 9. Total 10.
    expect(serviceMonths("2026-03-17", 2026)).toBe(10);
    // 18/03: 14 dias, não conta.
    expect(serviceMonths("2026-03-18", 2026)).toBe(9);
    // 17/04: 14 dias em abril, não conta.
    expect(serviceMonths("2026-04-17", 2026)).toBe(8);
    // 15/02/2026: 14 dias em fevereiro de 28.
    expect(serviceMonths("2026-02-15", 2026)).toBe(10);
    expect(serviceMonths("2026-02-14", 2026)).toBe(11);
    expect(serviceMonths("2026-01-01", 2026)).toBe(12);
  });

  it("só vale no ano do início", () => {
    expect(serviceMonths("2026-03-17", 2027)).toBe(12);
    expect(serviceMonths("2027-03-17", 2026)).toBe(0);
    expect(serviceMonths(null, 2026)).toBe(12);
  });

  it("10 meses de R$ 6.000,00: 13º de R$ 5.000,00, metade na 1ª", () => {
    const input = source({ plans: [plan({ jobStartedOn: "2026-03-17" })] });
    const result = thirteenthPlan(input, tables, 2026)!;
    expect(result).toMatchObject({ serviceMonths: 10, gross: "5000.00" });
    expect(result.first?.amount).toBe("2500.00");
    expect(money(result.first!.amount).plus(result.second.amount).toFixed(2)).toBe(result.net);
    // Até R$ 5.000 a redução zera o imposto (Lei 15.270, § 3º).
    expect(result.tax).toBe("0.00");
  });

  it("no ano seguinte, ano inteiro", () => {
    const input = source({ plans: [plan({ jobStartedOn: "2026-03-17" })] });
    expect(thirteenthPlan(input, tables, 2027)?.gross).toBe("6000.00");
  });

  it("começou no fim de dezembro: sem 13º no ano", () => {
    const input = source({ plans: [plan({ jobStartedOn: "2026-12-18" })] });
    expect(thirteenthPlan(input, tables, 2026)).toBeNull();
    expect(lines(input, "2026-12").map(([key]) => key)).toEqual(["r:s1:2026-12:salario"]);
  });

  it("o mês em que a renda entrou no sistema não muda o 13º", () => {
    expect(thirteenthPlan(source({ startMonth: "2026-11" }), tables, 2026)?.gross).toBe("6000.00");
  });
});

// Lei 4.749/1965, art. 2º, § 2º; Decreto 10.854/2021, art. 79.
describe("adiantamento do 13º com as férias", () => {
  it("cai na data do pagamento das férias", () => {
    const input = source({
      plans: [plan({ withVacation: true, periods: [period(7, 6, 30)] })],
    });
    expect(lines(input, "2026-07")).toContainEqual(["r:s1:2026-07:13-1", "2026-07-04", "3000.00"]);
    expect(thirteenthPlan(input, tables, 2026)?.first?.withVacation).toBe(true);
    expect(lines(input, "2026-11").map(([key]) => key)).toEqual(["r:s1:2026-11:salario"]);
  });

  it("férias que começam em 1º de julho levam a 1ª para junho", () => {
    const input = source({ plans: [plan({ withVacation: true, periods: [period(7, 1, 30)] })] });
    expect(lines(input, "2026-06")).toContainEqual(["r:s1:2026-06:13-1", "2026-06-29", "3000.00"]);
  });

  it("férias depois da 2ª parcela não servem: fica o mês escolhido", () => {
    const input = source({ plans: [plan({ withVacation: true, periods: [period(12, 28, 30)] })] });
    expect(thirteenthPlan(input, tables, 2026)?.first).toMatchObject({
      date: "2026-11-30",
      withVacation: false,
    });
  });

  it("férias de 1º de janeiro são pagas no ano anterior: fica o mês escolhido", () => {
    const input = source({ plans: [plan({ withVacation: true, periods: [period(1, 1, 30)] })] });
    expect(thirteenthPlan(input, tables, 2026)?.first?.date).toBe("2026-11-30");
  });
});

describe("férias integrais", () => {
  it("30 dias sem o dia de início: igual ao cálculo de antes, no dia do salário", () => {
    const input = source({ amount: "3000.00", plans: [plan({ periods: [period(7, null, 30)] })] });
    const expected = calculateVacation(
      { gross: "3000.00", dependents: 0, pension: "0", otherDiscounts: "0" },
      table2026,
    );
    expect(lines(input, "2026-07")).toEqual([["r:s1:2026-07:ferias", "2026-07-05", expected.net]]);
  });

  // CLT, art. 145: pagamento até 2 dias antes do início.
  it("começando em 1º de julho, o pagamento cai em 29 de junho", () => {
    const input = source({ amount: "3000.00", plans: [plan({ periods: [period(7, 1, 30)] })] });
    const june = monthIncome(input, tables, "2026-06");
    expect(june.map((entry) => [entry.key, entry.date])).toEqual([
      ["r:s1:2026-07:ferias", "2026-06-29"],
      ["r:s1:2026-06:salario", "2026-06-05"],
    ]);
    // Julho sem salário: 30 dias de férias em 30 da folha.
    expect(lines(input, "2026-07")).toEqual([]);
    expect(lines(input, "2026-08").map(([key]) => key)).toEqual(["r:s1:2026-08:salario"]);
  });

  it("dia 3 ainda paga no mesmo mês", () => {
    const input = source({ plans: [plan({ periods: [period(7, 3, 30)] })] });
    expect(vacationEvents(input.plans![0]!, 5, 2026)[0]?.payDate).toBe("2026-07-01");
  });

  it("1º de janeiro paga em 30 de dezembro do ano anterior", () => {
    const input = source({ plans: [plan({ year: 2027, periods: [period(1, 1, 30)] })] });
    expect(lines(input, "2026-12")).toContainEqual([
      "r:s1:2027-01:ferias",
      "2026-12-30",
      expect.any(String),
    ]);
  });

  it("a baixa acha a previsão pelo mês da chave, mesmo paga antes", () => {
    const input = source({ plans: [plan({ periods: [period(7, 1, 30)] })] });
    expect(findIncomeEntry(input, tables, "2026-07", "ferias")?.date).toBe("2026-06-29");
    expect(findIncomeEntry(input, tables, "2026-05", "ferias")).toBeNull();
  });

  it("já recebida sai da previsão, e o salário do mês continua pelos dias", () => {
    const input = source({
      plans: [plan({ periods: [{ ...period(3, 16, 30), received: true }] })],
    });
    expect(
      incomeBetween([input], tables, "2026-01", "2026-12").filter((entry) =>
        entry.key.includes("ferias"),
      ),
    ).toEqual([]);
    // 16 dias de férias em março: sobram 14 de 30.
    expect(workedSalary(input, tables, "2026-03").gross).toBe("2800.00");
  });
});

describe("férias vendidas", () => {
  // Salário R$ 3.000: 20 dias + 1/3 = 2.666,67; abono de 10 dias + 1/3 = 1.333,33. Soma 4.000,00.
  const input = source({
    amount: "3000.00",
    plans: [plan({ soldDays: 10, periods: [period(7, 6, 20)] })],
  });

  it("abono fora do INSS, terço do abono dentro do IR", () => {
    const [payout] = vacationPayouts(input, tables, 2026);
    expect(payout).toMatchObject({
      salary: "2000.00",
      oneThird: "666.67",
      abono: "1000.00",
      abonoThird: "333.33",
      gross: "4000.00",
      // INSS só sobre 2.666,67: 121,575 + 9% de 1.045,67 = 215,6853.
      inss: "215.69",
      // Base 3.000,00 − 607,20 = 2.392,80, dentro da faixa zero.
      tax: "0.00",
      net: "3784.31",
      payDate: "2026-07-04",
    });
  });

  it("os dias vendidos são trabalhados: julho paga 10 dias de salário", () => {
    // INSS do mês sobre 3.666,67 dá 328,60; 215,69 já saíram nas férias.
    expect(workedSalary(input, tables, "2026-07")).toMatchObject({
      gross: "1000.00",
      inss: "112.91",
      tax: "0.00",
      net: "887.09",
    });
  });

  it("vender não muda o INSS das férias", () => {
    const without = source({ amount: "3000.00", plans: [plan({ periods: [period(7, 6, 20)] })] });
    expect(vacationPayouts(without, tables, 2026)[0]?.inss).toBe("215.69");
  });
});

describe("férias divididas", () => {
  it("gera uma chave por período, mesmo no mesmo mês", () => {
    const input = source({ plans: [plan({ periods: [period(7, 3, 14), period(7, 20, 5)] })] });
    expect(lines(input, "2026-07").map(([key]) => key)).toEqual([
      "r:s1:2026-07:ferias",
      "r:s1:2026-07:ferias-2",
      "r:s1:2026-07:salario",
    ]);
    expect(workedSalary(input, tables, "2026-07").gross).toBe("2200.00");
  });

  it("três períodos somam um salário, sem perder centavo", () => {
    const input = source({
      amount: "1000.01",
      plans: [plan({ periods: [period(2, 10, 14), period(6, 10, 10), period(10, 5, 6)] })],
    });
    const payouts = vacationPayouts(input, tables, 2026);
    expect(payouts.map((payout) => payout.part)).toEqual(["ferias", "ferias-2", "ferias-3"]);
    expect(payouts.reduce((acc, payout) => acc.plus(payout.salary), money(0)).toFixed(2)).toBe(
      "1000.01",
    );
  });

  it("mantém a chave de hoje no primeiro período", () => {
    const input = source({ plans: [plan({ periods: [period(7, 1, 30)] })] });
    expect(vacationPayouts(input, tables, 2026)[0]?.part).toBe("ferias");
  });
});

describe("férias que atravessam meses", () => {
  const input = source({ plans: [plan({ periods: [period(12, 20, 30)] })] });

  it("20/12 a 18/01: 12 dias em dezembro e 18 em janeiro", () => {
    expect(vacationEvents(input.plans![0]!, 5, 2026)[0]).toMatchObject({
      end: "2027-01-18",
      payDate: "2026-12-18",
      slices: [
        { month: "2026-12", days: 12 },
        { month: "2027-01", days: 18 },
      ],
    });
    expect(workedSalary(input, tables, "2026-12").gross).toBe("3600.00");
    expect(workedSalary(input, tables, "2027-01").gross).toBe("2400.00");
  });

  it("uma linha de férias só, no mês do pagamento", () => {
    const keys = incomeBetween([input], tables, "2026-12", "2027-01").map((entry) => entry.key);
    expect(keys.filter((key) => key.includes("ferias"))).toEqual(["r:s1:2026-12:ferias"]);
  });

  it("fevereiro: mês curto continua somando 30 dias de folha", () => {
    const february = source({ plans: [plan({ periods: [period(2, 1, 30)] })] });
    const worked = ["2026-02", "2026-03"].map(
      (month) => workedSalary(february, tables, month).gross,
    );
    // 28 dias em fevereiro e 2 em março.
    expect(worked).toEqual(["400.00", "5600.00"]);
  });
});

describe("descontos do mês com férias", () => {
  it("pensão e outros descontos saem uma vez só, repartidos pelos dias", () => {
    const input = source({
      pensionAmount: "300.00",
      otherDiscounts: "150.00",
      plans: [plan({ periods: [period(7, 6, 20)] })],
    });
    const slip = workedSalary(input, tables, "2026-07");
    expect(slip.pension).toBe("100.00");
    expect(slip.otherDiscounts).toBe("50.00");
  });

  it("o teto do INSS vale para o mês, somando férias e salário", () => {
    const input = source({
      amount: "20000.00",
      plans: [plan({ periods: [period(7, 6, 20)] })],
    });
    const [payout] = vacationPayouts(input, tables, 2026);
    const slip = workedSalary(input, tables, "2026-07");
    expect(money(payout!.inss).plus(slip.inss).toFixed(2)).toBe("988.09");
  });
});

const VALID_SPLITS: Array<[number[], number]> = [
  [[30], 0],
  [[20], 10],
  [[25], 5],
  [[15, 15], 0],
  [[14, 6], 10],
  [[14, 10, 6], 0],
  [[14, 8, 8], 0],
  [[14, 5, 5], 6],
  [[16, 5], 9],
];

const validPlan = fc
  .record({
    split: fc.constantFrom(...VALID_SPLITS),
    months: fc.uniqueArray(fc.integer({ min: 1, max: 11 }), { minLength: 3, maxLength: 3 }),
    days: fc.array(fc.integer({ min: 1, max: 28 }), { minLength: 3, maxLength: 3 }),
  })
  .map(({ split: [lengths, soldDays], months, days }) => {
    const ordered = [...months].sort((a, b) => a - b);
    // Um mês entre períodos não basta: 30 dias a partir do dia 28 passam para o mês seguinte.
    return plan({
      soldDays,
      periods: lengths.map((length, index) =>
        period(ordered[index]!, index === 0 ? 1 : days[index]!, length),
      ),
    });
  })
  .filter((candidate) => validateIncomePlan(candidate).length === 0);

const moneyInput = fc.record({
  amount: cents(3_000_000, 162_100),
  pensionAmount: cents(100_000),
  otherDiscounts: cents(50_000),
  dependents: fc.nat(3),
  payDay: fc.integer({ min: 1, max: 31 }),
});

describe("propriedades", () => {
  it("não deixa buraco nem paga em dobro: salário dos dias de férias + dias trabalhados = 12 salários", () => {
    fc.assert(
      fc.property(moneyInput, validPlan, (over, candidate) => {
        const input = source({ ...over, plans: [candidate] });
        const months = Array.from({ length: 12 }, (_, index) => addMonths("2026-01", index));
        const worked = months.reduce(
          (acc, month) => acc.plus(workedSalary(input, tables, month).gross),
          money(0),
        );
        const vacation = vacationPayouts(input, tables, 2026).reduce(
          (acc, payout) => acc.plus(payout.salary),
          money(0),
        );
        expect(worked.plus(vacation).toFixed(2)).toBe(money(over.amount).times(12).toFixed(2));
      }),
    );
  });

  it("cada mês tem 30 dias entre férias e trabalho, e nenhum fica negativo", () => {
    fc.assert(
      fc.property(moneyInput, validPlan, (over, candidate) => {
        const input = source({ ...over, plans: [candidate] });
        const view = incomeYearView(input, tables, 2026)!;
        for (const row of view.salaryMonths) {
          expect(row.workedDays).toBeGreaterThanOrEqual(0);
          expect(row.workedDays).toBeLessThan(30);
        }
        const days = vacationEvents(candidate, input.payDay, 2026)
          .flatMap((event) => event.slices)
          .reduce((sum, slice) => sum + slice.days, 0);
        expect(days + candidate.soldDays).toBeLessThanOrEqual(30);
      }),
    );
  });

  it("com 30 dias entre férias e venda, salário e abono somam um salário e o terço fecha", () => {
    fc.assert(
      fc.property(moneyInput, validPlan, (over, candidate) => {
        fc.pre(remainingVacationDays(candidate) === 0);
        const payouts = vacationPayouts(source({ ...over, plans: [candidate] }), tables, 2026);
        const sum = (pick: (row: (typeof payouts)[number]) => string[]) =>
          payouts.flatMap(pick).reduce((acc, value) => acc.plus(value), money(0));
        expect(sum((row) => [row.salary, row.abono]).toFixed(2)).toBe(over.amount);
        expect(sum((row) => [row.oneThird, row.abonoThird]).toFixed(2)).toBe(
          toCents(money(over.amount).dividedBy(3)).toFixed(2),
        );
      }),
    );
  });

  it("o líquido das férias fecha com as partes", () => {
    fc.assert(
      fc.property(moneyInput, validPlan, (over, candidate) => {
        const input = source({ ...over, plans: [candidate] });
        for (const payout of vacationPayouts(input, tables, 2026)) {
          const parts = money(payout.salary)
            .plus(payout.oneThird)
            .plus(payout.abono)
            .plus(payout.abonoThird);
          expect(parts.toFixed(2)).toBe(payout.gross);
          expect(money(payout.net).lte(payout.netWithReduction)).toBe(true);
        }
      }),
    );
  });

  it("a mudança de escolha só move o dinheiro: o 13º do ano continua somando o mesmo", () => {
    fc.assert(
      fc.property(moneyInput, fc.integer({ min: 2, max: 11 }), (over, firstMonth) => {
        const base = source(over);
        const moved = source({ ...over, plans: [plan({ firstMonth })] });
        const total = (input: IncomeSourceInput) =>
          incomeBetween([input], tables, "2026-01", "2026-12")
            .filter((entry) => entry.key.includes(":13-"))
            .reduce((acc, entry) => acc.plus(entry.amount), money(0));
        expect(total(moved).toFixed(2)).toBe(total(base).toFixed(2));
      }),
    );
  });

  it("repartir pelos dias não perde centavo", () => {
    fc.assert(
      fc.property(
        cents(10_000_000),
        fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 5 }),
        (total, days) => {
          const basis = days.reduce((sum, value) => sum + value, 0);
          const parts = splitByDays(total, days, basis);
          expect(parts.reduce((acc, part) => acc.plus(part), money(0)).toFixed(2)).toBe(total);
        },
      ),
    );
  });
});

// CLT, art. 134, § 1º, e art. 143.
describe("limites da lei", () => {
  const codes = (over: Partial<IncomeYearPlan>) =>
    validateIncomePlan(plan(over)).map((issue) => issue.code);

  it("aceita integrais, divididas e vendidas", () => {
    expect(codes({ periods: [period(7, 1, 30)] })).toEqual([]);
    expect(codes({ periods: [period(1, 5, 14), period(6, 5, 11), period(10, 5, 5)] })).toEqual([]);
    expect(codes({ periods: [period(7, 1, 20)], soldDays: 10 })).toEqual([]);
    expect(codes({ periods: [] })).toEqual([]);
  });

  it("até 3 períodos", () => {
    expect(
      codes({
        periods: [period(1, 5, 14), period(3, 5, 5), period(5, 5, 5), period(7, 5, 5)],
      }),
    ).toContain("too_many_periods");
  });

  it("um período com pelo menos 14 dias, os outros com pelo menos 5", () => {
    expect(codes({ periods: [period(1, 5, 13), period(6, 5, 13)] })).toContain("needs_long_period");
    expect(codes({ periods: [period(1, 5, 14), period(6, 5, 4)] })).toContain("period_too_short");
  });

  it("vender até 10 dias, sem passar de 30 no total", () => {
    expect(codes({ periods: [period(7, 1, 19)], soldDays: 11 })).toContain("sold_over");
    expect(codes({ periods: [period(7, 1, 25)], soldDays: 10 })).toContain("days_over");
  });

  it("períodos sobrepostos", () => {
    expect(codes({ periods: [period(7, 1, 20), period(7, 15, 10)] })).toEqual(["overlap"]);
    expect(codes({ periods: [period(7, null, 20), period(7, null, 11)] })).toEqual(["days_over"]);
    expect(codes({ periods: [period(7, null, 16), period(7, null, 14)] })).toEqual([]);
  });

  it("dia que o mês não tem", () => {
    expect(codes({ periods: [period(2, 30, 14)] })).toContain("bad_day");
  });

  it("13º: 1ª antes da 2ª, e data de início real", () => {
    expect(codes({ firstMonth: 11, secondMonth: 11 })).toContain("first_after_second");
    expect(codes({ thirteenthMode: "integral", firstMonth: 11, secondMonth: 3 })).toEqual([]);
    expect(codes({ jobStartedOn: "2026-02-30" })).toContain("bad_job_date");
  });

  it("diz quantos dias faltam", () => {
    expect(remainingVacationDays(plan({ periods: [period(7, 1, 20)] }))).toBe(10);
    expect(remainingVacationDays(plan({ periods: [period(7, 1, 20)], soldDays: 10 }))).toBe(0);
  });
});

// Achados da revisão independente. Cada caso falhava antes da correção.
describe("revisão", () => {
  const months12 = Array.from({ length: 12 }, (_, index) => addMonths("2026-01", index));

  it("D1: dias vendidos vazios ou quebrados são erro, nunca NaN", () => {
    for (const soldDays of [Number.NaN, 2.5, -1])
      expect(
        validateIncomePlan(plan({ periods: [period(7, 1, 20)], soldDays })).map((i) => i.code),
      ).toContain("bad_sold");
    expect(validateIncomePlan(plan({ periods: [period(7, 1, 20)], soldDays: 10 }))).toEqual([]);
  });

  it("D2: pagamento que não passou nunca fica como recebido", () => {
    const moved = plan({ periods: [{ ...period(12, 10, 20), received: true }] });
    expect(settleReceived(moved, 5, "2026-11-02").periods[0]?.received).toBe(false);
    const past = plan({ periods: [{ ...period(7, 10, 20), received: true }] });
    expect(settleReceived(past, 5, "2026-11-02").periods[0]?.received).toBe(true);
    const nextYear = plan({
      year: 2027,
      firstReceived: true,
      singleReceived: true,
      periods: [{ ...period(1, 10, 20), received: true }],
    });
    expect(settleReceived(nextYear, 5, "2026-11-02")).toMatchObject({
      firstReceived: false,
      singleReceived: false,
      periods: [{ received: false }],
    });
  });

  it("D3: baixa de período que saiu não tira a previsão de outro", () => {
    const input = source({ plans: [plan({ periods: [period(11, null, 15)] })] });
    const open = openIncomeEntries(
      incomeBetween([input], tables, "2026-11", "2026-11"),
      [{ incomeSourceId: "s1", month: "2026-10", part: "ferias" }],
      [input],
    );
    expect(open.map((entry) => entry.key)).toContain("r:s1:2026-11:ferias");
  });

  it("D3: período novo antes do recebido não troca qual foi pago", () => {
    const input = source({
      plans: [plan({ periods: [period(3, null, 10), period(7, null, 10), period(11, null, 10)] })],
    });
    const open = openIncomeEntries(
      incomeBetween([input], tables, "2026-01", "2026-12"),
      [{ incomeSourceId: "s1", month: "2026-07", part: "ferias" }],
      [input],
    );
    expect(open.filter((e) => e.key.includes("ferias")).map((e) => e.key)).toEqual([
      "r:s1:2026-03:ferias",
      "r:s1:2026-11:ferias-3",
    ]);
  });

  it("D3 e D4: a baixa acompanha o período movido, e só ele", () => {
    const received = new Set(["10"]);
    const moved = carryVacationKeys(
      plan({ periods: [period(10, null, 30)] }),
      plan({ periods: [period(12, null, 30)] }),
      received,
    );
    expect(moved.periods[0]?.keyMonth).toBe(10);
    const removed = carryVacationKeys(
      plan({ periods: [period(10, null, 15), period(11, null, 15)] }),
      plan({ periods: [period(11, null, 15)] }),
      received,
    );
    expect(removed.periods[0]?.keyMonth).toBeUndefined();
    // Depois de mover, salvar de novo mantém a chave.
    const again = carryVacationKeys(moved, plan({ periods: [period(12, 5, 30)] }), received);
    expect(again.periods[0]?.keyMonth).toBe(10);
  });

  it("D4: período movido com a baixa na chave não abre de novo", () => {
    const input = source({
      plans: [plan({ periods: [{ ...period(12, null, 30), keyMonth: 10 }] })],
    });
    const entries = incomeBetween([input], tables, "2026-12", "2026-12");
    expect(entries.map((e) => e.key)).toContain("r:s1:2026-10:ferias");
    const receipts = [{ incomeSourceId: "s1", month: "2026-10", part: "ferias" }];
    const open = openIncomeEntries(entries, receipts, [input]);
    expect(open.filter((e) => e.key.includes("ferias"))).toEqual([]);
    expect(receivedInYear(receipts, input, 2026)).toEqual(["ferias"]);
    expect(findIncomeEntry(input, tables, "2026-10", "ferias")?.date).toBe("2026-12-05");
  });

  it("D4: regra anual do 13º vale para todos", () => {
    const input = source();
    const open = openIncomeEntries(
      incomeBetween([input], tables, "2026-11", "2026-11"),
      [{ incomeSourceId: "s1", month: "2026-07", part: "13-1" }],
      [input],
    );
    expect(open.map((e) => e.key)).toEqual(["r:s1:2026-11:salario"]);
  });

  // A única exceção à igualdade com a função antiga (ADR-0028): quem nunca escolheu e mudou o mês
  // das férias depois de receber. A função antiga previa pagar as férias de novo no ano.
  it("D4: quem nunca escolheu e mudou o mês não recebe as férias duas vezes no ano", () => {
    const input = source({ vacationMonth: 12 });
    const open = openIncomeEntries(
      incomeBetween([input], tables, "2026-12", "2026-12"),
      [{ incomeSourceId: "s1", month: "2026-10", part: "ferias" }],
      [input],
    );
    expect(open.filter((e) => e.key.includes("ferias"))).toEqual([]);
  });

  it("D5: reajuste depois da 1ª: desconta o que foi lançado", () => {
    const input = source({ amount: "6600.00", firstPaid: { 2026: "3000.00" } });
    const result = thirteenthPlan(input, tables, 2026)!;
    expect(result.net).toBe("5267.60");
    expect(result.first?.amount).toBe("3000.00");
    expect(result.second.amount).toBe("2267.60");
    expect(lines(input, "2026-12")[1]?.[2]).toBe("2267.60");
  });

  it("D6: férias no dia 1 do primeiro mês da renda não somem", () => {
    const input = source({
      startMonth: "2026-12",
      plans: [plan({ periods: [period(12, 1, 30)] })],
    });
    expect(lines(input, "2026-11")).toEqual([
      ["r:s1:2026-12:ferias", "2026-11-29", expect.any(String)],
    ]);
    expect(findIncomeEntry(input, tables, "2026-12", "ferias")?.date).toBe("2026-11-29");
    // Antes de começar, nada além disso.
    expect(lines(source({ startMonth: "2026-12" }), "2026-11")).toEqual([]);
  });

  it("D7: tudo de uma vez desconta a 1ª já recebida, com ou sem lançamento", () => {
    const paid = source({
      firstPaid: { 2026: "3000.00" },
      plans: [plan({ thirteenthMode: "integral" })],
    });
    expect(thirteenthPlan(paid, tables, 2026)).toMatchObject({
      net: "4973.39",
      advance: "3000.00",
      second: { amount: "1973.39" },
    });
    const marked = source({
      plans: [plan({ thirteenthMode: "integral", firstReceived: true, firstAmount: "2800.00" })],
    });
    expect(thirteenthPlan(marked, tables, 2026)?.second.amount).toBe("2173.39");
    const halfMarked = source({
      plans: [plan({ thirteenthMode: "integral", firstReceived: true })],
    });
    expect(thirteenthPlan(halfMarked, tables, 2026)?.second.amount).toBe("1973.39");
  });

  it("decisão: tudo de uma vez em mês passado pode ser marcado como recebido", () => {
    const input = source({
      plans: [plan({ thirteenthMode: "integral", secondMonth: 7, singleReceived: true })],
    });
    expect(lines(input, "2026-07").map(([key]) => key)).toEqual(["r:s1:2026-07:salario"]);
    expect(thirteenthPlan(input, tables, 2026)?.second.received).toBe(true);
  });

  it("D8: escolher 2027 não muda 2026", () => {
    const y2026 = plan({ year: 2026, firstMonth: 7, periods: [period(3, 10, 30)] });
    const y2027 = plan({ year: 2027, firstMonth: 5 });
    expect(planForYear([y2027], 2026, 7)).toEqual(defaultIncomePlan(2026, 7));
    expect(planForYear([y2026, y2027], 2026, null).firstMonth).toBe(7);
    expect(planForYear([y2026, y2027], 2027, null).firstMonth).toBe(5);
    const input = source({ vacationMonth: 7, plans: [y2027] });
    for (const month of months12)
      expect(monthIncome(input, tables, month)).toEqual(
        oldMonthIncome(source({ vacationMonth: 7 }), tables, month),
      );
  });

  it("D11 e D12: mês fora de faixa e janeiro na 1ª parcela", () => {
    const codes = (over: Partial<IncomeYearPlan>) =>
      validateIncomePlan(plan(over)).map((i) => i.code);
    expect(codes({ firstMonth: 1 })).toContain("bad_month");
    expect(codes({ firstMonth: 13, secondMonth: 14 })).toContain("bad_month");
    expect(codes({ thirteenthMode: "integral", secondMonth: 13 })).toContain("bad_month");
    expect(codes({ periods: [period(13, 1, 30)] })).toContain("bad_month");
    expect(codes({ firstMonth: 2 })).toEqual([]);
  });

  it("D12: janeiro só com as férias", () => {
    const input = source({
      plans: [plan({ withVacation: true, periods: [period(1, 10, 30)] })],
    });
    expect(thirteenthPlan(input, tables, 2026)?.first).toMatchObject({
      date: "2026-01-08",
      withVacation: true,
    });
  });
});

// Achados da reconferência. Cada caso falhava antes da correção.
describe("reconferência", () => {
  const receipt = (month: string, part: string) => ({ incomeSourceId: "s1", month, part });

  it("N2: baixa da 2ª quita o 13º: a 1ª fecha na previsão", () => {
    const input = source({ plans: [plan({ firstMonth: 11, secondMonth: 12 })] });
    const receipts = [receipt("2026-06", "13-2")];
    const open = openIncomeEntries(incomeBetween([input], tables, "2026-11", "2026-12"), receipts, [
      input,
    ]);
    expect(open.filter((e) => e.key.includes(":13-"))).toEqual([]);
    expect(receivedInYear(receipts, input, 2026)).toEqual(expect.arrayContaining(["13-1", "13-2"]));
    expect(receivedInYear(receipts, input, 2027)).toEqual([]);
  });

  it("N2: marca de tudo de uma vez segue quitando em duas parcelas", () => {
    const input = source({ plans: [plan({ singleReceived: true })] });
    const all = incomeBetween([input], tables, "2026-01", "2026-12");
    expect(all.filter((e) => e.key.includes(":13-"))).toEqual([]);
    expect(thirteenthPlan(input, tables, 2026)).toMatchObject({
      first: { received: true },
      second: { received: true },
    });
  });

  it("N3: casa pelo mês preferindo igual número de dias", () => {
    const moved = carryVacationKeys(
      plan({ periods: [period(10, null, 20), period(11, null, 10)] }),
      plan({ periods: [period(11, null, 20), period(12, null, 10)] }),
      new Set(["10"]),
    );
    expect(moved.periods).toEqual([
      { ...period(11, null, 20), keyMonth: 10 },
      period(12, null, 10),
    ]);
    const sameMonth = carryVacationKeys(
      plan({
        periods: [{ ...period(7, 3, 14), keyMonth: 5 }, period(7, 20, 5)],
      }),
      plan({ periods: [period(7, 22, 5), period(7, 3, 14)] }),
      new Set(["05"]),
    );
    expect(sameMonth.periods).toEqual([period(7, 22, 5), { ...period(7, 3, 14), keyMonth: 5 }]);
  });

  it("decisão: baixa de período que saiu fica sem período, e a tela sabe", () => {
    const input = source({ plans: [plan({ periods: [period(11, null, 15)] })] });
    const receipts = [receipt("2026-10", "ferias")];
    expect(orphanVacationMonths(receipts, input, 2026)).toEqual(["2026-10"]);
    const moved = source({
      plans: [plan({ periods: [{ ...period(12, null, 15), keyMonth: 10 }] })],
    });
    expect(orphanVacationMonths(receipts, moved, 2026)).toEqual([]);
    // Quem nunca escolheu: a baixa é do único período, não fica solta.
    expect(orphanVacationMonths(receipts, source({ vacationMonth: 12 }), 2026)).toEqual([]);
  });

  it("N5: data de início que não existe é erro, nunca exceção", () => {
    for (const jobStartedOn of ["2026-13-45", "2026-02-30", "abc"])
      expect(validateIncomePlan(plan({ jobStartedOn })).map((i) => i.code)).toEqual([
        "bad_job_date",
      ]);
  });
});

describe("plano do ano", () => {
  it("usa a linha mais recente até o ano", () => {
    const plans = [plan({ year: 2026, firstMonth: 7 }), plan({ year: 2028, firstMonth: 5 })];
    expect(planForYear(plans, 2025, null).firstMonth).toBe(11);
    expect(planForYear(plans, 2026, null).firstMonth).toBe(7);
    expect(planForYear(plans, 2027, null).firstMonth).toBe(7);
    expect(planForYear(plans, 2028, null).firstMonth).toBe(5);
    expect(planForYear(plans, 2030, null).firstMonth).toBe(5);
  });

  it("herança leva forma, meses, períodos e venda, e nunca o que aconteceu", () => {
    const row = plan({
      thirteenthMode: "integral",
      secondMonth: 6,
      firstReceived: true,
      firstAmount: "2800.00",
      singleReceived: true,
      soldDays: 10,
      periods: [{ ...period(7, 6, 20), received: true, keyMonth: 3 }],
    });
    expect(planForYear([row], 2027, null)).toEqual({
      ...row,
      year: 2027,
      firstReceived: false,
      firstAmount: null,
      singleReceived: false,
      periods: [period(7, 6, 20)],
    });
  });

  it("baixa é do próprio ano: a de 2026 não fecha a previsão herdada de 2027", () => {
    const input = source({ plans: [plan({ firstMonth: 7, periods: [period(3, null, 30)] })] });
    const receipts = [
      { incomeSourceId: "s1", month: "2026-07", part: "13-1" },
      { incomeSourceId: "s1", month: "2026-03", part: "ferias" },
    ];
    const open = openIncomeEntries(incomeBetween([input], tables, "2027-01", "2027-12"), receipts, [
      input,
    ]);
    expect(open.map((e) => e.key)).toEqual(
      expect.arrayContaining(["r:s1:2027-07:13-1", "r:s1:2027-03:ferias"]),
    );
    const paid = source({ ...input, firstPaid: { 2026: "2800.00" } });
    expect(thirteenthPlan(paid, tables, 2027)?.first?.amount).toBe("3000.00");
  });

  it("herança com vários períodos: baixa sem período não fecha nenhum", () => {
    const input = source({
      plans: [plan({ periods: [period(3, null, 15), period(9, null, 15)] })],
    });
    const open = openIncomeEntries(
      incomeBetween([input], tables, "2027-01", "2027-12"),
      [{ incomeSourceId: "s1", month: "2027-05", part: "ferias" }],
      [input],
    );
    expect(open.filter((e) => e.key.includes("ferias"))).toHaveLength(2);
  });

  it("descarta do jsonb o que não faz sentido", () => {
    expect(
      parseVacationPeriods([
        { month: 7, startDay: 1, days: 30, received: true },
        { month: 13, days: 30 },
        "lixo",
        { month: 3, startDay: "x", days: 10 },
      ]),
    ).toEqual([
      { month: 7, startDay: 1, days: 30, received: true },
      { month: 3, startDay: null, days: 10, received: false },
    ]);
    expect(parseVacationPeriods(null)).toEqual([]);
  });
});

describe("recebidos", () => {
  const key = (month: string, part: IncomePart) => incomeKey("s1", month, part);
  const entry = (month: string, part: IncomePart): ScheduledEntry => ({
    key: key(month, part),
    source: "renda",
    id: "s1",
    description: "x",
    amount: "1.00",
    date: `${month}-05`,
    categoryId: "c",
    accountId: "a",
  });
  const receipt = (month: string, part: string) => ({ incomeSourceId: "s1", month, part });

  it("a chave exata tira a previsão, como sempre", () => {
    const open = openIncomeEntries(
      [entry("2026-11", "13-1"), entry("2026-11", "salario")],
      [receipt("2026-11", "13-1")],
      [source()],
    );
    expect(open.map((row) => row.key)).toEqual([key("2026-11", "salario")]);
  });

  it("sem escolha, sem período no ano, baixa de férias não muda nada", () => {
    const open = openIncomeEntries(
      [entry("2026-07", "salario")],
      [receipt("2026-03", "ferias")],
      [source()],
    );
    expect(open).toHaveLength(1);
  });

  it("13º recebido em novembro não reaparece em julho depois de mudar o mês", () => {
    const open = openIncomeEntries(
      [entry("2026-07", "13-1"), entry("2027-07", "13-1")],
      [receipt("2026-11", "13-1")],
      [source({ plans: [plan({ firstMonth: 7 })] })],
    );
    expect(open.map((row) => row.key)).toEqual([key("2027-07", "13-1")]);
  });

  it("salário recebido não apaga o de outro mês", () => {
    const open = openIncomeEntries(
      [entry("2026-08", "salario")],
      [receipt("2026-07", "salario")],
      [source({ plans: [plan()] })],
    );
    expect(open).toHaveLength(1);
  });
});
