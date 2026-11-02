import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildMonthEntries, summarizeMonth } from "../src/cashflow";
import {
  calculatePayslip,
  calculateThirteenth,
  calculateVacation,
  firstIncomeMonth,
  fiscalTableFor,
  incomeBetween,
  inssContribution,
  monthIncome,
  monthlyNet,
  progressiveTax,
  taxReduction,
  withholdingTax,
  type FiscalTable,
  type IncomeSourceInput,
} from "../src/income";
import { money } from "../src/money";
import { NO_SAVINGS } from "../src/savings";

// Fontes:
// INSS: Portaria Interministerial MPS/MF nº 13, de 09/01/2026.
// IRRF: Receita Federal, "Tributação de 2026"
// (gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026).
// Redução: Lei nº 15.270/2025 e orientação da Receita às fontes pagadoras, dezembro de 2025.
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

const plain = { dependents: 0, pension: "0", otherDiscounts: "0" };

describe("INSS 2026", () => {
  it("cobra por faixa", () => {
    // 7,5% de 1.621,00 = 121,575.
    expect(inssContribution("1621.00", table2026)).toBe("121.58");
    // 121,575 + 9% de 379,00 (34,11) = 155,685; arredonda só no fim, meio centavo para o par.
    expect(inssContribution("2000.00", table2026)).toBe("155.68");
  });

  it("para no teto de R$ 8.475,55: contribuição máxima de R$ 988,09", () => {
    expect(inssContribution("8475.55", table2026)).toBe("988.09");
    expect(inssContribution("30000.00", table2026)).toBe("988.09");
  });

  it("nunca diminui quando o salário sobe", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (cents, raise) => {
          const low = inssContribution((cents / 100).toFixed(2), table2026);
          const high = inssContribution(((cents + raise) / 100).toFixed(2), table2026);
          expect(money(high).gte(low)).toBe(true);
          expect(money(high).lte("988.09")).toBe(true);
        },
      ),
    );
  });
});

describe("IR 2026, exemplos oficiais da Receita", () => {
  it("R$ 4.500,00: tabela dá R$ 200,39 e a redução zera", () => {
    const result = withholdingTax(
      { income: "4500.00", inss: "0", dependents: 0, pension: "0" },
      table2026,
    );
    expect(result).toMatchObject({
      deduction: "simplificado",
      base: "3892.80",
      taxBeforeReduction: "200.39",
      reduction: "200.39",
      tax: "0.00",
    });
  });

  it("R$ 6.000,00: R$ 574,29 menos redução de R$ 179,75 = R$ 394,54", () => {
    const result = withholdingTax(
      { income: "6000.00", inss: "0", dependents: 0, pension: "0" },
      table2026,
    );
    expect(result).toMatchObject({
      base: "5392.80",
      taxBeforeReduction: "574.29",
      reduction: "179.75",
      tax: "394.54",
    });
  });
});

describe("IR 2026", () => {
  it("segue a tabela progressiva nos limites das faixas", () => {
    expect(progressiveTax("2428.80", table2026)).toBe("0.00");
    expect(progressiveTax("2826.65", table2026)).toBe("29.84");
    expect(progressiveTax("10000.00", table2026)).toBe("1841.27");
  });

  it("redução: cheia até R$ 5.000, parcial até R$ 7.350 e nenhuma depois", () => {
    expect(taxReduction("5000.00", "312.89", table2026)).toBe("312.89");
    expect(taxReduction("5000.00", "100.00", table2026)).toBe("100.00");
    expect(taxReduction("7350.00", "900.00", table2026)).toBe("0.00");
    expect(taxReduction("7350.01", "900.00", table2026)).toBe("0.00");
  });

  it("a faixa da redução olha o rendimento, não a base depois das deduções", () => {
    const result = withholdingTax(
      { income: "8000.00", inss: "1000.00", dependents: 2, pension: "0" },
      table2026,
    );
    expect(result.reduction).toBe("0.00");
  });

  it("usa a maior dedução", () => {
    const small = withholdingTax(
      { income: "5500.00", inss: "100.00", dependents: 0, pension: "0" },
      table2026,
    );
    expect(small).toMatchObject({ deduction: "simplificado", deductionAmount: "607.20" });
    const big = withholdingTax(
      { income: "5500.00", inss: "500.00", dependents: 2, pension: "100.00" },
      table2026,
    );
    expect(big).toMatchObject({ deduction: "legal", deductionAmount: "979.18" });
  });

  it("imposto final nunca é negativo nem maior que o da tabela", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3_000_000 }), fc.nat(5), (cents, dependents) => {
        const income = (cents / 100).toFixed(2);
        const inss = inssContribution(income, table2026);
        const result = withholdingTax({ income, inss, dependents, pension: "0" }, table2026);
        expect(money(result.tax).gte(0)).toBe(true);
        expect(money(result.tax).lte(result.taxBeforeReduction)).toBe(true);
      }),
    );
  });

  it("até R$ 5.000 o salário sem pensão não paga imposto", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500_000 }), (cents) => {
        const slip = calculatePayslip({ gross: (cents / 100).toFixed(2), ...plain }, table2026);
        expect(slip.tax).toBe("0.00");
      }),
    );
  });
});

describe("holerite", () => {
  it("salário de R$ 6.000,00", () => {
    expect(calculatePayslip({ gross: "6000.00", ...plain }, table2026)).toMatchObject({
      inss: "641.51",
      deduction: "legal",
      base: "5358.49",
      taxBeforeReduction: "564.85",
      reduction: "179.75",
      tax: "385.10",
      net: "4973.39",
    });
  });

  it("dependentes baixam o imposto", () => {
    const slip = calculatePayslip({ ...plain, gross: "6000.00", dependents: 2 }, table2026);
    expect(slip.base).toBe("4979.31");
    expect(money(slip.tax).lt("385.10")).toBe(true);
  });

  it("outros descontos saem do líquido sem mexer no imposto", () => {
    const slip = calculatePayslip(
      { ...plain, gross: "6000.00", otherDiscounts: "200.00" },
      table2026,
    );
    expect(slip.tax).toBe("385.10");
    expect(slip.net).toBe("4773.39");
  });

  it("o líquido fecha com a soma do holerite", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100_00, max: 3_000_000 }),
        fc.nat(4),
        fc.integer({ min: 0, max: 50_000 }),
        (cents, dependents, pensionCents) => {
          const slip = calculatePayslip(
            {
              gross: (cents / 100).toFixed(2),
              dependents,
              pension: (pensionCents / 100).toFixed(2),
              otherDiscounts: "0",
            },
            table2026,
          );
          const sum = money(slip.net).plus(slip.inss).plus(slip.tax).plus(slip.pension);
          expect(sum.toFixed(2)).toBe(slip.gross);
        },
      ),
    );
  });
});

describe("13º", () => {
  it("1ª parcela sem descontos; a 2ª leva INSS e IR do 13º inteiro", () => {
    expect(calculateThirteenth({ gross: "6000.00", ...plain }, table2026)).toEqual({
      gross: "6000.00",
      firstInstallment: "3000.00",
      secondInstallment: "1973.39",
      inss: "641.51",
      tax: "385.10",
      pension: "0.00",
      net: "4973.39",
    });
  });

  it("até R$ 5.000 a redução também zera o imposto do 13º (Lei 15.270, § 3º)", () => {
    expect(calculateThirteenth({ gross: "5000.00", ...plain }, table2026).tax).toBe("0.00");
  });

  it("outros descontos não entram no 13º", () => {
    const with13 = calculateThirteenth(
      { ...plain, gross: "6000.00", otherDiscounts: "500.00" },
      table2026,
    );
    expect(with13.net).toBe("4973.39");
  });

  it("as duas parcelas somam o líquido", () => {
    fc.assert(
      fc.property(fc.integer({ min: 100_00, max: 3_000_000 }), (cents) => {
        const result = calculateThirteenth(
          { gross: (cents / 100).toFixed(2), ...plain },
          table2026,
        );
        expect(money(result.firstInstallment).plus(result.secondInstallment).toFixed(2)).toBe(
          result.net,
        );
      }),
    );
  });
});

describe("férias", () => {
  it("paga salário + 1/3, com INSS sobre o total", () => {
    const result = calculateVacation({ gross: "3000.00", ...plain }, table2026);
    // 121,575 + 115,3656 + 12% de 1.097,16 (131,6592) = 368,5998.
    expect(result).toMatchObject({ gross: "4000.00", oneThird: "1000.00", inss: "368.60" });
  });

  it("sem orientação oficial sobre a redução, devolve o valor menor e o maior", () => {
    const result = calculateVacation({ gross: "3000.00", ...plain }, table2026);
    expect(money(result.net).lt(result.netWithReduction)).toBe(true);
    expect(result.taxWithReduction).toBe("0.00");
  });
});

const source = (over: Partial<IncomeSourceInput> = {}): IncomeSourceInput => ({
  id: "s1",
  name: "Empresa",
  kind: "clt",
  amount: "6000.00",
  isGross: true,
  dependents: 0,
  pensionAmount: "0",
  otherDiscounts: "0",
  vacationMonth: 7,
  payDay: 5,
  startMonth: "2026-01",
  endMonth: null,
  categoryId: "cat",
  accountId: "acc",
  ...over,
});

const parts = (month: string, input = source()) =>
  monthIncome(input, [table2026], month).map((entry) => [entry.key, entry.date, entry.amount]);

describe("previsões da renda", () => {
  it("mês normal entra pelo líquido", () => {
    expect(parts("2026-03")).toEqual([["r:s1:2026-03:salario", "2026-03-05", "4973.39"]]);
  });

  it("no mês de férias as férias entram no lugar do salário", () => {
    const entries = monthIncome(source(), [table2026], "2026-07");
    expect(entries.map((entry) => entry.key)).toEqual(["r:s1:2026-07:ferias"]);
  });

  it("13º entra em novembro e dezembro, junto do salário", () => {
    expect(parts("2026-11")).toEqual([
      ["r:s1:2026-11:salario", "2026-11-05", "4973.39"],
      ["r:s1:2026-11:13-1", "2026-11-30", "3000.00"],
    ]);
    expect(parts("2026-12")[1]).toEqual(["r:s1:2026-12:13-2", "2026-12-20", "1973.39"]);
  });

  it("outros tipos entram pelo valor informado, sem 13º", () => {
    const rent = source({ kind: "aluguel", amount: "1500.00", isGross: false });
    expect(parts("2026-11", rent)).toEqual([["r:s1:2026-11:salario", "2026-11-05", "1500.00"]]);
  });

  it("respeita início e fim", () => {
    const limited = source({ startMonth: "2026-03", endMonth: "2026-04" });
    expect(parts("2026-02", limited)).toEqual([]);
    expect(parts("2026-04", limited)).toHaveLength(1);
    expect(parts("2026-05", limited)).toEqual([]);
  });

  it("gera um ano inteiro: 12 pagamentos mais as 2 parcelas do 13º", () => {
    expect(incomeBetween([source()], [table2026], "2026-01", "2026-12")).toHaveLength(14);
  });

  it("entra no mês como receita prevista, sem virar despesa", () => {
    const scheduled = incomeBetween([source()], [table2026], "2026-03", "2026-03");
    const entries = buildMonthEntries("2026-03", [], [], scheduled);
    expect(entries[0]).toMatchObject({ kind: "receita", status: "previsto", source: "renda" });
    expect(summarizeMonth(entries, NO_SAVINGS)).toMatchObject({
      plannedIncome: "4973.39",
      plannedExpense: "0.00",
    });
  });

  it("não prevê receita negativa", () => {
    const heavy = source({ otherDiscounts: "9000.00" });
    expect(parts("2026-03", heavy)).toEqual([]);
  });

  it("mostra o valor de um mês normal", () => {
    expect(monthlyNet(source(), [table2026], "2026-03")).toBe("4973.39");
    expect(
      monthlyNet(source({ kind: "outro", isGross: false, amount: "900" }), [table2026], "2026-03"),
    ).toBe("900.00");
  });
});

describe("primeira previsão", () => {
  it("começa neste mês se o pagamento ainda vem", () => {
    expect(firstIncomeMonth("2026-10-05", 5)).toBe("2026-10");
    expect(firstIncomeMonth("2026-10-04", 5)).toBe("2026-10");
  });

  it("começa no mês seguinte se o pagamento já passou", () => {
    expect(firstIncomeMonth("2026-10-30", 5)).toBe("2026-11");
    expect(firstIncomeMonth("2026-12-30", 5)).toBe("2027-01");
  });

  it("dia 31 em mês curto cai no último dia", () => {
    expect(firstIncomeMonth("2026-11-30", 31)).toBe("2026-11");
  });
});

describe("vigência das tabelas", () => {
  const table2027 = { ...table2026, validFrom: "2027-01", minimumWage: "1700.00" };

  it("usa a tabela do mês e, sem tabela nova, a mais recente", () => {
    expect(fiscalTableFor([table2027, table2026], "2026-12").validFrom).toBe("2026-01");
    expect(fiscalTableFor([table2027, table2026], "2027-01").validFrom).toBe("2027-01");
    expect(fiscalTableFor([table2026], "2030-05").validFrom).toBe("2026-01");
  });
});
