// Receita do painel (ADR-0025). Os totais esperados são conta feita à mão sobre os preços da especificação,
// docs/specs/planos-e-assinatura.md, seção 1.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  money,
  monthlyAmount,
  revenueSummary,
  type RevenueFamily,
  type SubscribedItem,
} from "../src";

const NOW = new Date("2026-11-02T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const line = (item: string, amount: string, quantity = 1): SubscribedItem => ({
  price: `price_${item}`,
  item,
  amount,
  quantity,
});

type Sub = NonNullable<RevenueFamily["subscription"]>;

const sub = (over: Partial<Sub> = {}): Sub => ({
  status: "active",
  items: [line("familia", "44.90")],
  trialEndsAt: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  cycle: "mes",
  discountPercent: null,
  canceledAt: null,
  firstPaidAt: null,
  ...over,
});

const family = (
  mode: RevenueFamily["mode"],
  subscription: Sub | null,
  aiCostUsd = "0",
): RevenueFamily => ({ mode, subscription, aiCostUsd });

describe("valor mensal", () => {
  it("anual vira doze avos, sem arredondar no meio", () => {
    // R$ 449,00 / 12 = 37,41666...
    expect(monthlyAmount([line("familia", "449.00")], "ano", null).toFixed(4)).toBe("37.4167");
  });

  it("desconto sai do valor, e quantidade multiplica", () => {
    // 2 × 19,90 + 29,90 = 69,70; menos 10% = 62,73.
    const items = [line("contas_conectadas", "19.90", 2), line("base:ilimitado", "29.90")];
    expect(monthlyAmount(items, "mes", 10).toFixed(2)).toBe("62.73");
  });
});

describe("resumo", () => {
  it("receita, ticket, atraso e quem não paga ficam cada um no seu lugar", () => {
    const summary = revenueSummary(
      [
        family("assinatura", sub()),
        family("assinatura", sub({ cycle: "ano", items: [line("familia", "449.00")] })),
        family("assinatura", sub({ status: "past_due", items: [line("base:50", "9.90")] })),
        family("assinatura", sub({ cancelAtPeriodEnd: true, items: [line("base:50", "9.90")] })),
        family("vip", sub({ status: null, items: [] })),
        family("cortesia", sub({ status: null, items: [] })),
        family("leitura", sub({ status: null, items: [] })),
        family("teste", sub({ status: null, items: [] })),
      ],
      NOW,
      null,
    );
    // 44,90 + 37,4166... + 9,90 = 92,2166... → 92,22.
    expect(summary.mrr).toBe("92.22");
    expect(summary.active).toBe(3);
    expect(summary.pastDue).toBe(1);
    expect(summary.pastDueAmount).toBe("9.90");
    expect(summary.cancelling).toBe(1);
    expect(summary.trial).toBe(1);
    // 92,2166... / 3 = 30,7388... → 30,74.
    expect(summary.averageTicket).toBe("30.74");
  });

  it("ninguém assinando: zero de verdade, sem ticket nem conversão inventados", () => {
    const summary = revenueSummary([family("cortesia", null)], NOW, "5.40");
    expect(summary.mrr).toBe("0.00");
    expect(summary.averageTicket).toBeNull();
    expect(summary.trialConversion).toBeNull();
  });

  it("cancelamentos só dos últimos 30 dias", () => {
    const canceled = (days: number) =>
      family(
        "leitura",
        sub({ status: "canceled", canceledAt: new Date(NOW.getTime() - days * DAY) }),
      );
    expect(revenueSummary([canceled(29), canceled(31)], NOW, null).canceled30d).toBe(1);
  });

  it("pedido de cancelamento não é cancelamento: conta à parte e segue na receita", () => {
    const asked = new Date(NOW.getTime() - DAY);
    const asking = sub({
      cancelAtPeriodEnd: true,
      canceledAt: asked,
      currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY),
    });
    const summary = revenueSummary([family("assinatura", asking)], NOW, null);
    expect(summary).toMatchObject({ canceled30d: 0, cancelling: 1, active: 1, mrr: "44.90" });
  });

  it("anual que pediu há meses e acabou agora conta pelo fim, não pelo pedido", () => {
    const ended = sub({
      status: "canceled",
      cancelAtPeriodEnd: true,
      canceledAt: new Date(NOW.getTime() - 200 * DAY),
      currentPeriodEnd: new Date(NOW.getTime() - 2 * DAY),
    });
    expect(revenueSummary([family("leitura", ended)], NOW, null).canceled30d).toBe(1);
  });

  it("quem a Stripe cobra entra na receita, mesmo com cortesia ou VIP", () => {
    const summary = revenueSummary(
      [family("cortesia", sub()), family("vip", sub({ items: [line("base:50", "9.90")] }))],
      NOW,
      null,
    );
    expect(summary).toMatchObject({ mrr: "54.80", active: 2 });
  });

  it("quem está em teste na Stripe ainda não paga: fora da receita, e conta como teste", () => {
    const summary = revenueSummary([family("vip", sub({ status: "trialing" }))], NOW, null);
    expect(summary).toMatchObject({ mrr: "0.00", active: 0, trial: 1 });
    expect(summary.tiers.find((tier) => tier.tier === "sem_receita")?.families).toBe(1);
  });

  it("modo assinatura com a Stripe já encerrada não é receita", () => {
    const over = family("assinatura", sub({ status: "canceled" }));
    expect(revenueSummary([over], NOW, null).mrr).toBe("0.00");
  });

  it("conversão olha só quem terminou o teste ou pagou antes dele acabar", () => {
    const past = new Date(NOW.getTime() - DAY);
    const future = new Date(NOW.getTime() + DAY);
    const summary = revenueSummary(
      [
        family("leitura", sub({ status: null, items: [], trialEndsAt: past })),
        family("leitura", sub({ status: null, items: [], trialEndsAt: past })),
        family("assinatura", sub({ trialEndsAt: past, firstPaidAt: past })),
        family("assinatura", sub({ trialEndsAt: future, firstPaidAt: past })),
        family("teste", sub({ status: null, items: [], trialEndsAt: future })),
      ],
      NOW,
      null,
    );
    expect(summary.trialConversion).toEqual({ started: 4, converted: 2, percent: "50.0" });
  });

  it("módulos do mais assinado para o menos, com a Família completa contando em todos", () => {
    const summary = revenueSummary(
      [
        family("assinatura", sub()),
        family(
          "assinatura",
          sub({ items: [line("base:50", "9.90"), line("modulo:dividas", "7.90")] }),
        ),
      ],
      NOW,
      null,
    );
    expect(summary.modules[0]).toEqual({ module: "dividas", families: 2 });
    expect(summary.modules.at(-1)?.families).toBe(1);
  });

  it("custo de IA contra receita por degrau, com o dólar do dia", () => {
    const summary = revenueSummary(
      [
        family("assinatura", sub(), "1.50"),
        family(
          "assinatura",
          sub({ items: [line("base:50", "10.00"), line("assistente:30", "10.00")] }),
          "0.50",
        ),
        family("vip", null, "2.00"),
      ],
      NOW,
      "5.00",
    );
    const by = Object.fromEntries(summary.tiers.map((tier) => [tier.tier, tier]));
    // Família completa traz 100 mensagens: R$ 44,90 de receita, US$ 1,50 × 5 = R$ 7,50, 16,7%.
    expect(by["100"]).toMatchObject({
      families: 1,
      revenue: "44.90",
      costUsd: "1.50",
      costBrl: "7.50",
      costShare: "16.7",
    });
    expect(by["30"]).toMatchObject({ revenue: "20.00", costBrl: "2.50", costShare: "12.5" });
    // Quem não paga também gasta IA, e isso precisa aparecer.
    expect(by.sem_receita).toMatchObject({ revenue: "0.00", costBrl: "10.00", costShare: null });
  });

  it("sem cotação, mostra o custo em dólar e não inventa a conta", () => {
    const summary = revenueSummary([family("assinatura", sub(), "1.00")], NOW, null);
    expect(summary.tiers.find((tier) => tier.tier === "100")).toMatchObject({
      costUsd: "1.00",
      costBrl: null,
      costShare: null,
    });
  });

  it("propriedade: a receita é a soma exata do valor de cada assinatura em dia", () => {
    const row = fc.record({
      cents: fc.integer({ min: 100, max: 100_000 }),
      cycle: fc.constantFrom("mes" as const, "ano" as const),
      discount: fc.option(fc.integer({ min: 1, max: 99 })),
    });
    fc.assert(
      fc.property(fc.array(row, { maxLength: 30 }), (rows) => {
        const families = rows.map(({ cents, cycle, discount }) =>
          family(
            "assinatura",
            sub({
              cycle,
              discountPercent: discount,
              items: [line("base:50", money(cents).dividedBy(100).toFixed(2))],
            }),
          ),
        );
        const expected = rows.reduce((acc, { cents, cycle, discount }) => {
          const yearly = money(cents).dividedBy(100);
          const monthly = cycle === "ano" ? yearly.dividedBy(12) : yearly;
          return acc.plus(monthly.times(money(100).minus(discount ?? 0)).dividedBy(100));
        }, money(0));
        expect(revenueSummary(families, NOW, null).mrr).toBe(
          expected.toDecimalPlaces(2).toFixed(2),
        );
      }),
    );
  });
});
