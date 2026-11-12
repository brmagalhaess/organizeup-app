import { writeFileSync } from "node:fs";
import type { RetirementSummary } from "@organizeup/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { retirementEmail } from "./retirement-email";

const summary = (over: Partial<RetirementSummary> = {}): RetirementSummary => ({
  month: "2026-11",
  targetYear: 2045,
  targetIncome: "12000.00",
  incomeGap: "9500.00",
  currentIncome: "2375.00",
  coverage: 25,
  requiredPortfolio: "1425000.00",
  portfolioGap: "1068750.00",
  contribution: "2500.00",
  requiredContribution: "3120.00",
  yearWithContribution: 2048,
  projectedIncomeAtTarget: "8100.00",
  ...over,
});
const flat = (text: string) => text.replaceAll(" ", " ");

beforeEach(() => {
  process.env.BETTER_AUTH_URL = "https://app.example.test";
});

describe("e-mail mensal da aposentadoria", () => {
  it("mostra a cobertura, os três números e o veredito de quem chega depois da meta", () => {
    const email = retirementEmail({ name: "Ana Souza", account: "Casa Teste", summary: summary() });
    expect(email.subject).toBe("Seu plano de aposentadoria: resumo de novembro");
    const text = flat(email.text);
    for (const piece of [
      "Olá, Ana!",
      "Casa Teste",
      "já cobrem 25% da renda",
      "Renda desejada: R$ 12.000,00 (por mês)",
      "Proventos de hoje: R$ 2.375,00 (por mês)",
      // Falta: o que a carteira precisa pagar menos o que já paga.
      "Ainda falta: R$ 7.125,00 (por mês)",
      "No ritmo de hoje, você chega lá em 2048, 3 anos depois da meta. Aportando R$ 3.120,00 por mês, fecha em 2045.",
      "- Ano da meta: 2045",
      "- Carteira necessária: R$ 1.425.000,00",
      "- Aporte de hoje: R$ 2.500,00 por mês",
      "- Renda projetada em 2045: R$ 8.100,00 por mês",
      "https://app.example.test/app/aposentadoria",
      "https://app.example.test/app/notificacoes",
    ]) {
      expect(text, piece).toContain(piece);
    }
    expect(email.html).toContain("Novembro de 2026");
    expect(email.html).toContain('width="25%"');
    expect(email.text).not.toMatch(/<[a-z]/i);
    if (process.env.EMAIL_PREVIEW_FILE) writeFileSync(process.env.EMAIL_PREVIEW_FILE, email.html);
  });

  it("muda o veredito conforme o plano", () => {
    const verdict = (over: Partial<RetirementSummary>) =>
      flat(retirementEmail({ name: "Ana", account: "Casa", summary: summary(over) }).text);
    expect(verdict({ yearWithContribution: 2043 })).toContain(
      "No ritmo de hoje, você chega lá em 2043, dentro da meta.",
    );
    expect(verdict({ yearWithContribution: null })).toContain("não chega ao valor necessário");
    expect(verdict({ targetYear: null, requiredContribution: null })).toContain(
      "Escolha o ano em que quer se aposentar",
    );
    expect(verdict({ targetYear: null })).toContain("- Ano da meta: Ainda sem ano");
    const done = verdict({ coverage: 140, currentIncome: "13300.00" });
    expect(done).toContain("A carteira já paga a renda que você quer.");
    expect(done).toContain("Ainda falta: R$ 0,00");
    expect(done).toContain("já cobrem 100%");
  });

  it("nome hostil não vira HTML, e sai nos outros idiomas", () => {
    const hostile = "<b>x</b>";
    const email = retirementEmail({ name: hostile, account: hostile, summary: summary() });
    expect(email.html).not.toContain("<b>x</b>");
    const en = retirementEmail({
      name: "Ana",
      account: "Home",
      summary: summary(),
      locale: "en",
      currency: "USD",
    });
    expect(en.subject).toBe("Your retirement plan: November summary");
    expect(en.html).toContain("$12,000.00");
    const es = retirementEmail({ name: "Ana", account: "Casa", summary: summary(), locale: "es" });
    expect(es.subject).toBe("Tu plan de jubilación: resumen de noviembre");
  });
});
