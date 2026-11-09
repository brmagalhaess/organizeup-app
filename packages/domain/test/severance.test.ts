import { describe, expect, it } from "vitest";
import { calculateSeverance, noticeDays, type FiscalTable } from "../src";

// Tabela de 2026 (ADR-0009): Portaria MPS/MF 13/2026 e Receita, "Tributação de 2026".
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

const base = {
  gross: "3000.00",
  dependents: 0,
  pension: "0",
  otherDiscounts: "0",
  jobStartedOn: "2024-02-01",
  exitDate: "2026-11-09",
  reason: "sem_justa_causa" as const,
  noticeIndemnified: true,
  thirteenthAdvancePaid: "0",
  fgtsBalance: null,
};

describe("aviso prévio (Lei 12.506/2011)", () => {
  it("30 dias mais 3 por ano completo, até 90", () => {
    expect(noticeDays(0)).toBe(30);
    expect(noticeDays(2)).toBe(36);
    expect(noticeDays(20)).toBe(90);
  });
});

describe("rescisão estimada", () => {
  it("dispensa sem justa causa: saldo, aviso, 13º e férias proporcionais com 1/3, FGTS à parte", () => {
    const r = calculateSeverance(base, table2026);
    expect(r.monthsOfService).toBe(34);
    expect(r.fullYears).toBe(2);
    // Aviso de 36 dias projeta o contrato para 15/12 (CLT, art. 487, § 1º).
    expect(r.notice).toEqual({ days: 36, amount: "3600.00" });
    expect(r.projectedEnd).toBe("2026-12-15");
    // 9 dias de novembro: R$ 900, INSS de 7,5% e sem IR pela dedução simplificada.
    expect(r.salaryBalance).toEqual({
      days: 9,
      gross: "900.00",
      inss: "67.50",
      tax: "0.00",
      net: "832.50",
    });
    // 12 avos com a projeção do aviso; INSS por faixa de R$ 3.000 = 248,60; IR zero.
    expect(r.thirteenth.twelfths).toBe(12);
    expect(r.thirteenth.gross).toBe("3000.00");
    expect(r.thirteenth.inss).toBe("248.60");
    expect(r.thirteenth.net).toBe("2751.40");
    // Período aquisitivo desde 01/02/2026: 11 avos (fev–nov e os 15 dias de dezembro).
    expect(r.vacation).toEqual({
      twelfths: 11,
      proportional: "2750.00",
      oneThird: "916.67",
      amount: "3666.67",
    });
    // FGTS estimado em 8% × 34 meses; multa de 40% e saque de tudo (Lei 8.036/1990, art. 18, § 1º).
    expect(r.fgts).toEqual({
      balance: "8160.00",
      estimated: true,
      fine: "3264.00",
      withdrawable: "11424.00",
    });
    expect(r.total).toBe("10850.57");
    expect(r.notes).toEqual(["ferias_vencidas_fora"]);
  });

  it("pedido de demissão: sem aviso indenizado, sem multa e sem saque", () => {
    const r = calculateSeverance({ ...base, reason: "pedido" }, table2026);
    expect(r.notice.days).toBe(0);
    expect(r.projectedEnd).toBe("2026-11-09");
    expect(r.fgts.fine).toBe("0.00");
    expect(r.fgts.withdrawable).toBe("0.00");
    expect(r.notes).toContain("pedido_sem_fgts");
  });

  it("acordo (CLT, art. 484-A): metade do aviso, multa de 20% e saque de 80%", () => {
    const r = calculateSeverance({ ...base, reason: "acordo" }, table2026);
    expect(r.notice).toEqual({ days: 18, amount: "1800.00" });
    expect(r.fgts.fine).toBe("1632.00");
    expect(r.fgts.withdrawable).toBe("8160.00");
  });

  it("saldo do FGTS informado e adiantamento do 13º descontado", () => {
    const r = calculateSeverance(
      { ...base, fgtsBalance: "10000.00", thirteenthAdvancePaid: "1500.00" },
      table2026,
    );
    expect(r.fgts.estimated).toBe(false);
    expect(r.fgts.fine).toBe("4000.00");
    expect(r.thirteenth.advanceDeducted).toBe("1500.00");
    expect(r.thirteenth.net).toBe("1251.40");
  });

  it("sem data de início: avos pelo ano corrente, aviso de 30 dias e aviso na nota", () => {
    const r = calculateSeverance({ ...base, jobStartedOn: null }, table2026);
    expect(r.notice.days).toBe(30);
    expect(r.fgts.balance).toBe("0.00");
    expect(r.notes).toContain("sem_inicio");
    // Aviso de 30 dias leva a 09/12: dezembro fica com menos de 15 dias e não conta.
    expect(r.thirteenth.twelfths).toBe(11);
  });
});
