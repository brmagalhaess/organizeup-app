import { writeFileSync } from "node:fs";
import { buildReminder, REMINDER_DEFAULTS, type ReminderInput } from "@organizeup/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { reminderEmail } from "./reminder-email";

const TODAY = "2026-11-11";
const sample = (over: Partial<ReminderInput> = {}) =>
  buildReminder({
    today: TODAY,
    settings: REMINDER_DEFAULTS,
    dailyDone: false,
    entries: [
      {
        kind: "despesa",
        source: "fatura",
        description: "Fatura Cartão XP",
        amount: "1184.65",
        date: TODAY,
      },
      {
        kind: "despesa",
        source: "previsao",
        description: "Aluguel",
        amount: "1800.00",
        date: "2026-11-10",
      },
      {
        kind: "despesa",
        source: "parcela",
        description: "Financiamento do carro 12/48",
        amount: "932.10",
        date: "2026-11-13",
      },
      { kind: "receita", source: "renda", description: "Salário", amount: "7500.00", date: TODAY },
    ],
    dividends: [
      { ticker: "MXRF11", kind: "rendimento", payDate: TODAY, amount: "38.40" },
      { ticker: "ITSA4", kind: "jcp", payDate: "2026-11-13", amount: "112.75" },
    ],
    fresh: [
      {
        description: "SUPERMERCADO ZONA SUL",
        amount: "312.48",
        date: TODAY,
        origin: "cartao",
        place: "Cartão XP",
      },
      {
        description: "UBER *TRIP",
        amount: "23.40",
        date: "2026-11-10",
        origin: "conta",
        place: "Banco XP",
      },
    ],
    ...over,
  })!;

beforeEach(() => {
  process.env.BETTER_AUTH_URL = "https://app.example.test/";
});

describe("e-mail de lembretes", () => {
  it("traz os quatro blocos, os totais e os links do sistema", () => {
    const email = reminderEmail({ name: "Ana", account: "Casa Teste", digest: sample() });
    expect(email.template).toBe("lembrete");
    expect(email.subject).toBe(
      "Hoje no OrganizeUp: 3 contas a pagar, 1 valor a receber, 2 proventos e 2 gastos novos",
    );
    for (const piece of [
      "Olá, Ana!",
      "Seu resumo de hoje",
      "Casa Teste",
      "Para pagar",
      "Para receber",
      "Proventos da carteira",
      "Gastos novos",
      "Fatura Cartão XP",
      "MXRF11",
      "SUPERMERCADO ZONA SUL",
      "Atrasada",
      "venceu em 10/11",
      "vence em 13/11",
      "https://app.example.test/app/notificacoes",
      "https://app.example.test/app/lancamentos",
      "https://app.example.test/app/calendario",
    ]) {
      expect(email.html, piece).toContain(piece);
    }
    // Total a pagar e a receber (renda mais proventos), no formato da moeda.
    expect(email.html).toContain("3.916,75");
    expect(email.html).toContain("7.651,15");
    expect(email.text).toContain("PARA PAGAR");
    expect(email.text).not.toMatch(/<[a-z]/i);
    if (process.env.EMAIL_PREVIEW_FILE) writeFileSync(process.env.EMAIL_PREVIEW_FILE, email.html);
  });

  it("no resumo do dia, mostra o valor investido e quanto foi aplicado", () => {
    const invested = { total: "52340.10", cost: "48000.00" };
    const email = reminderEmail({ name: "Ana", account: "Casa Teste", digest: sample(), invested });
    expect(email.html).toContain("Investido");
    expect(email.html).toContain("52.340,10");
    expect(email.html).toContain("aplicado R$");
    expect(email.text).toContain("Investido: R$");
    expect(email.text).toContain("48.000,00");
    // Só o e-mail de gasto novo não leva a carteira.
    const fresh = reminderEmail({
      name: "Ana",
      account: "Casa Teste",
      digest: sample({ dailyDone: true }),
      invested,
    });
    expect(fresh.html).not.toContain("52.340,10");
  });

  it("só com gasto novo, muda o assunto e o título", () => {
    const email = reminderEmail({
      name: "Ana",
      account: "Casa Teste",
      digest: sample({ dailyDone: true }),
    });
    expect(email.subject).toBe("Gastos novos no OrganizeUp: 2 gastos novos");
    expect(email.html).toContain("Entrou gasto novo");
    expect(email.html).not.toContain("Para pagar");
  });

  it("o que foi digitado por alguém não vira HTML nem entra no assunto", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const email = reminderEmail({
      name: hostile,
      account: hostile,
      digest: sample({
        entries: [
          {
            kind: "despesa",
            source: "previsao",
            description: hostile,
            amount: "10.00",
            date: TODAY,
          },
        ],
        dividends: [],
        fresh: [
          { description: hostile, amount: "5.00", date: TODAY, origin: "conta", place: hostile },
        ],
      }),
    });
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
    expect(email.subject).not.toContain("img");
  });

  it("corta descrição longa e conta o que ficou fora da lista", () => {
    const fresh = Array.from({ length: 11 }, (_, index) => ({
      description: `Compra ${index} ${"x".repeat(100)}`,
      amount: "10.00",
      date: TODAY,
      origin: "cartao" as const,
      place: "Cartão",
    }));
    const email = reminderEmail({
      name: "",
      account: "Casa",
      digest: sample({ entries: [], dividends: [], fresh }),
    });
    expect(email.html).toContain("e mais 3");
    expect(email.html).not.toContain("x".repeat(70));
    expect(email.html).toContain("Olá!");
    // Só cartão: o atalho leva aos cartões.
    expect(email.html).toContain("https://app.example.test/app/cartoes");
  });

  it("envio de teste sem nada por perto explica que está tudo em dia", () => {
    const digest = buildReminder({
      today: TODAY,
      settings: REMINDER_DEFAULTS,
      entries: [],
      dividends: [],
      fresh: [],
      dailyDone: false,
      force: true,
    })!;
    const email = reminderEmail({ name: "Ana", account: "Casa", digest });
    expect(email.subject).toBe("Seu resumo do OrganizeUp");
    expect(email.html).toContain("Nada vence nem entra nos próximos dias");
  });

  it("sai em inglês e em espanhol, com a moeda da conta", () => {
    const en = reminderEmail({
      name: "Ana",
      account: "Home",
      digest: sample(),
      locale: "en",
      currency: "USD",
    });
    expect(en.subject).toBe(
      "Today on OrganizeUp: 3 bills to pay, 1 amount to receive, 2 payouts, and 2 new expenses",
    );
    expect(en.html).toContain("$3,916.75");
    expect(en.html).toContain('lang="en"');
    const es = reminderEmail({ name: "Ana", account: "Casa", digest: sample(), locale: "es" });
    expect(es.html).toContain("Tu resumen de hoy");
  });
});
