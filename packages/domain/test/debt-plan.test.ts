import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  debtPlanHeadline,
  debtSignals,
  HIGH_DEBT_MONTHLY_RATE,
  planDebtPayoff,
  recommendedStrategy,
  type DebtPlanInput,
  type PlanDebt,
} from "../src/debt-plan";
import { priceInstallment, simulatePayoff, type PayoffDebt } from "../src/debt";
import { money, toDbAmount } from "../src/money";

const today = "2026-11-10";

const debt = (over: Partial<PlanDebt> & { id: string }): PlanDebt => ({
  name: `Dívida ${over.id}`,
  system: "price",
  balance: "1000.00",
  monthlyRate: "2",
  minimum: "100.00",
  nextDue: "2026-11-20",
  ...over,
});

const input = (over: Partial<DebtPlanInput> = {}): DebtPlanInput => ({
  today,
  extra: "300.00",
  debts: [
    debt({ id: "cara", balance: "1000.00", monthlyRate: "8", minimum: "150.00" }),
    debt({ id: "barata", balance: "600.00", monthlyRate: "1", minimum: "100.00" }),
  ],
  yieldAnnualPercent: null,
  payDays: [],
  ...over,
});

describe("plano de saída: contas conferidas", () => {
  // Fonte: fórmula de prestações iguais da Calculadora do Cidadão do Banco Central.
  // R$ 10.000,00 a 2% ao mês em 12 parcelas: PMT = 945,60, com juros de 1.347,16 no total.
  const single = debt({
    id: "emprestimo",
    balance: "10000.00",
    monthlyRate: "2",
    minimum: priceInstallment("10000.00", "2", 12),
  });

  it("só pagar a parcela repete a Tabela Price do Banco Central", () => {
    expect(single.minimum).toBe("945.60");
    const plan = planDebtPayoff(input({ debts: [single], extra: "0" }))!;
    expect(plan.baseline.months).toBe(12);
    expect(money(plan.baseline.totalInterest).minus("1347.16").abs().lte("0.10")).toBe(true);
    expect(plan.baseline.payoffMonth).toBe("2027-10");
  });

  // Fonte: número de parcelas do Banco Central, n = −ln(1 − PV × i / PMT) / ln(1 + i).
  // Com PMT = 945,60 + 300,00 = 1.245,60: n = 8,84, ou seja, 9 pagamentos.
  it("o extra encurta o prazo como manda a fórmula do número de parcelas", () => {
    const plan = planDebtPayoff(input({ debts: [single], extra: "300.00" }))!;
    expect(plan.avalanche.months).toBe(9);
    expect(plan.avalanche.payoffMonth).toBe("2027-07");
    expect(money(plan.avalanche.saved).gt(0)).toBe(true);
  });

  // Conta à mão, mês 1: A deve 1.000 + 100 de juros (10%) e paga 100; B deve 1.000 + 10 (1%) e paga 100.
  // Sobram 200 de extra: avalanche leva A a 800 e deixa B em 910; bola de neve leva B a 710.
  it("o primeiro mês manda o extra para a dívida certa", () => {
    const debts: PayoffDebt[] = [
      { id: "a", name: "A", balance: "1000.00", monthlyRate: "10", minimum: "100.00" },
      { id: "b", name: "B", balance: "1000.00", monthlyRate: "1", minimum: "100.00" },
    ];
    expect(simulatePayoff(debts, "200", "avalanche").firstMonthExtra).toEqual([
      { id: "a", name: "A", amount: "200.00" },
    ]);
  });
});

describe("plano de saída", () => {
  it("sem dívida em aberto, não há plano", () => {
    expect(planDebtPayoff(input({ debts: [] }))).toBeNull();
  });

  it("recomenda a mais barata e diz quem atacar e quanto pagar a mais neste mês", () => {
    const plan = planDebtPayoff(input())!;
    expect(plan.recommended).toBe("avalanche");
    const best = recommendedStrategy(plan);
    expect(best.attack.map((item) => item.id)).toEqual(["cara", "barata"]);
    expect(best.thisMonth).toEqual([{ id: "cara", name: "Dívida cara", amount: "300.00" }]);
    expect(plan.snowball.attack[0]!.id).toBe("barata");
    expect(money(best.saved).gt(0)).toBe(true);
  });

  it("o extra que quita uma dívida passa para a seguinte", () => {
    const plan = planDebtPayoff(
      input({
        extra: "500.00",
        debts: [
          debt({ id: "pequena", balance: "200.00", monthlyRate: "9", minimum: "50.00" }),
          debt({ id: "grande", balance: "5000.00", monthlyRate: "3", minimum: "200.00" }),
        ],
      }),
    )!;
    const paid = plan.avalanche.thisMonth;
    expect(paid.map((item) => item.id)).toEqual(["pequena", "grande"]);
    expect(toDbAmount(paid.reduce((acc, item) => acc.plus(item.amount), money(0)))).toBe("500.00");
  });

  it("parcela que não cobre os juros avisa que não termina", () => {
    const plan = planDebtPayoff(
      input({
        extra: "0",
        debts: [debt({ id: "x", balance: "10000.00", monthlyRate: "10", minimum: "50.00" })],
      }),
    )!;
    expect(plan.avalanche.stalled).toBe(true);
    expect(plan.avalanche.payoffMonth).toBeNull();
    expect(debtPlanHeadline(plan)).toContain("não terminam");
  });

  it("começa no mês seguinte quando as parcelas deste já foram pagas", () => {
    const plan = planDebtPayoff(input({ debts: [debt({ id: "x", nextDue: "2026-12-05" })] }))!;
    expect(plan.month).toBe("2026-12");
  });

  it("dívida atrasada não puxa o plano para o passado", () => {
    const plan = planDebtPayoff(input({ debts: [debt({ id: "x", nextDue: "2026-09-05" })] }))!;
    expect(plan.month).toBe("2026-11");
  });

  it("a frase de cima diz quando termina e quanto economiza", () => {
    const plan = planDebtPayoff(input())!;
    const best = recommendedStrategy(plan);
    expect(debtPlanHeadline(plan)).toMatch(/^Quite tudo em .+ de 20\d\d e economize R\$/);
    expect(money(best.saved).gt(0)).toBe(true);
  });

  it("sem economia, a frase fala só do prazo", () => {
    const plan = planDebtPayoff(
      input({ extra: "0", debts: [debt({ id: "x", monthlyRate: "0", minimum: "100.00" })] }),
    )!;
    expect(debtPlanHeadline(plan)).not.toContain("economize");
  });
});

describe("sinais do plano", () => {
  const kinds = (over: Partial<DebtPlanInput>) =>
    debtSignals(input(over)).map((signal) => signal.kind);

  it("juro acima do que o dinheiro rende", () => {
    const debts = [debt({ id: "x", monthlyRate: "0.9" })];
    expect(kinds({ debts, yieldAnnualPercent: "6" })).toContain("juro_acima_do_rendimento");
    expect(kinds({ debts, yieldAnnualPercent: "24" })).not.toContain("juro_acima_do_rendimento");
  });

  it("portabilidade só com juro alto, sem citar banco", () => {
    const high = debtSignals(
      input({ debts: [debt({ id: "x", monthlyRate: HIGH_DEBT_MONTHLY_RATE })] }),
    ).find((signal) => signal.kind === "portabilidade");
    expect(high?.text).toContain("portabilidade");
    expect(high?.text).not.toMatch(/\b(banco|itaú|bradesco|nubank|caixa|santander)\b/i);
    expect(kinds({ debts: [debt({ id: "x", monthlyRate: "2.49" })] })).not.toContain(
      "portabilidade",
    );
  });

  it("parcela que vence antes de a renda entrar", () => {
    const debts = [debt({ id: "x", nextDue: "2026-11-03" })];
    expect(kinds({ debts, payDays: [10, 20] })).toContain("vence_antes_da_renda");
    expect(kinds({ debts, payDays: [2] })).not.toContain("vence_antes_da_renda");
    expect(kinds({ debts, payDays: [] })).not.toContain("vence_antes_da_renda");
  });

  it("dado faltando: juros não informados, mesmo em parcela informada", () => {
    const debts = [
      debt({ id: "manual", system: "manual", monthlyRate: "0", rankRate: "0" }),
      debt({ id: "com-taxa", system: "manual", monthlyRate: "0", rankRate: "3" }),
    ];
    expect(
      debtSignals(input({ debts }))
        .filter((signal) => signal.kind === "dado_faltando")
        .map((signal) => signal.debtId),
    ).toEqual(["manual"]);
  });
});

describe("propriedades do plano", () => {
  const debtsArb = fc.array(
    fc.record({
      cents: fc.integer({ min: 10_000, max: 5_000_000 }),
      rate: fc.integer({ min: 0, max: 800 }),
      minimum: fc.integer({ min: 5_000, max: 200_000 }),
    }),
    { minLength: 1, maxLength: 6 },
  );
  const toDebts = (rows: Array<{ cents: number; rate: number; minimum: number }>): PayoffDebt[] =>
    rows.map((row, index) => ({
      id: `d${index}`,
      name: `D${index}`,
      balance: (row.cents / 100).toFixed(2),
      monthlyRate: (row.rate / 100).toFixed(2),
      // Garante que a parcela cobre os juros: toda dívida termina nas duas estratégias.
      minimum: Math.max(row.minimum, Math.ceil((row.cents * row.rate) / 10_000) + 100)
        .toString()
        .replace(/(\d{2})$/, ".$1"),
    }));

  it("avalanche nunca paga mais juro que bola de neve", () => {
    fc.assert(
      fc.property(debtsArb, fc.integer({ min: 0, max: 500_000 }), (rows, extraCents) => {
        const debts = toDebts(rows);
        const extra = (extraCents / 100).toFixed(2);
        const avalanche = simulatePayoff(debts, extra, "avalanche");
        const snowball = simulatePayoff(debts, extra, "snowball");
        expect(money(avalanche.totalInterest).lte(snowball.totalInterest)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("o extra nunca aumenta os juros frente a só pagar as parcelas", () => {
    fc.assert(
      fc.property(debtsArb, fc.integer({ min: 0, max: 500_000 }), (rows, extraCents) => {
        const debts = toDebts(rows).map((item) => ({
          ...item,
          system: "price" as const,
          nextDue: "2026-11-20",
        }));
        const plan = planDebtPayoff(input({ debts, extra: (extraCents / 100).toFixed(2) }))!;
        expect(money(plan.avalanche.totalInterest).lte(plan.baseline.totalInterest)).toBe(true);
        expect(money(recommendedStrategy(plan).saved).gte(0)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
