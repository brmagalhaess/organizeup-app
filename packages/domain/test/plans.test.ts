import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  annualRenewalDue,
  connectedAccountsOf,
  selectionOfSubscribed,
  BILLING_MODULES,
  canUse,
  canUseCurrency,
  canView,
  entitlementsOf,
  FAMILY_SELECTION,
  fromCents,
  itemsOf,
  money,
  normalizeSelection,
  PAID_MODULES,
  planChange,
  quotaLeft,
  quotePlan,
  refundWindowOpen,
  resolveAccess,
  selectionOfItems,
  stripeUnitAmount,
  usageLevel,
  type BillingCycle,
  type CatalogPrice,
  type Currency,
  type EntryTier,
  type MessageTier,
  type PaidModule,
  type PlanSelection,
  type SubscribedItem,
  type SubscriptionState,
} from "../src";

// Preços da especificação, seção 1, os mesmos da migração 0036.
const MONTHLY: Record<string, string> = {
  "base:50": "9.90",
  "base:200": "19.90",
  "base:ilimitado": "29.90",
  "modulo:investimentos": "9.90",
  "modulo:aposentadoria": "9.90",
  "modulo:dividas": "7.90",
  "modulo:metas": "6.90",
  "assistente:30": "6.90",
  "assistente:100": "14.90",
  "assistente:300": "29.90",
  "moeda:BRL": "4.90",
  "moeda:USD": "4.90",
  "moeda:EUR": "4.90",
  familia: "44.90",
  "familia_mensagens:300": "15.00",
};

const CATALOG: CatalogPrice[] = Object.entries(MONTHLY).flatMap(([item, amount]) => [
  { id: `${item}:mes`, item, cycle: "mes", amount, stripePriceId: `price_${item}_mes` },
  {
    id: `${item}:ano`,
    item,
    cycle: "ano",
    amount: money(amount).times(10).toFixed(2),
    stripePriceId: `price_${item}_ano`,
  },
]);

const avulso = (over: Partial<PlanSelection> = {}): PlanSelection => ({
  family: false,
  entries: "50",
  modules: [],
  messages: 0,
  currencies: [],
  connectedAccounts: 0,
  cycle: "mes",
  ...over,
});

const selectionArb: fc.Arbitrary<PlanSelection> = fc.record({
  family: fc.boolean(),
  entries: fc.constantFrom<EntryTier>("50", "200", "ilimitado"),
  modules: fc.subarray<PaidModule>([...PAID_MODULES]),
  messages: fc.constantFrom<MessageTier>(0, 30, 100, 300),
  currencies: fc.subarray<Currency>(["BRL", "USD", "EUR"]),
  connectedAccounts: fc.constant(0),
  cycle: fc.constantFrom<BillingCycle>("mes", "ano"),
});

describe("preço do plano", () => {
  it("cada degrau da base e do assistente sai pelo valor da tabela", () => {
    expect(quotePlan(avulso({ entries: "50" }), CATALOG).total).toBe("9.90");
    expect(quotePlan(avulso({ entries: "200" }), CATALOG).total).toBe("19.90");
    expect(quotePlan(avulso({ entries: "ilimitado" }), CATALOG).total).toBe("29.90");
    expect(quotePlan(avulso({ messages: 30 }), CATALOG).total).toBe("16.80");
    expect(quotePlan(avulso({ messages: 100 }), CATALOG).total).toBe("24.80");
    expect(quotePlan(avulso({ messages: 300 }), CATALOG).total).toBe("39.80");
  });

  it("a Família completa custa R$ 44,90 por mês e R$ 449,00 por ano", () => {
    expect(quotePlan(FAMILY_SELECTION, CATALOG).total).toBe("44.90");
    expect(quotePlan({ ...FAMILY_SELECTION, cycle: "ano" }, CATALOG).total).toBe("449.00");
  });

  it("em cima da Família completa dá para subir mensagens e somar moedas", () => {
    const plan = { ...FAMILY_SELECTION, messages: 300 as const, currencies: ["USD", "EUR"] };
    const quote = quotePlan(plan as PlanSelection, CATALOG);
    expect(quote.lines.map((line) => line.item)).toEqual([
      "familia",
      "familia_mensagens:300",
      "moeda:USD",
      "moeda:EUR",
    ]);
    expect(quote.total).toBe("69.70");
  });

  it("o caminho mais caro no avulso, somado pelas tabelas, dá R$ 104,20", () => {
    // A especificação escreve R$ 103,40, que não fecha com as tabelas dela: ver ADR-0023.
    const quote = quotePlan(
      avulso({
        entries: "ilimitado",
        modules: [...PAID_MODULES],
        messages: 300,
        currencies: ["USD", "EUR"],
      }),
      CATALOG,
    );
    expect(quote.total).toBe("104.20");
  });

  it("anual custa 10 meses em qualquer item", () => {
    fc.assert(
      fc.property(selectionArb, (selection) => {
        const month = quotePlan({ ...selection, cycle: "mes" }, CATALOG);
        const year = quotePlan({ ...selection, cycle: "ano" }, CATALOG);
        expect(money(year.total).eq(money(month.total).times(10))).toBe(true);
      }),
    );
  });

  it("desmarcar um módulo no avulso sempre baixa o total, no valor dele", () => {
    fc.assert(
      fc.property(selectionArb, fc.constantFrom(...PAID_MODULES), (raw, module) => {
        const selection: PlanSelection = {
          ...raw,
          family: false,
          modules: [...new Set([...raw.modules, module])],
        };
        const before = quotePlan(selection, CATALOG);
        const after = quotePlan(
          { ...selection, modules: selection.modules.filter((item) => item !== module) },
          CATALOG,
        );
        const price = CATALOG.find(
          (row) => row.item === `modulo:${module}` && row.cycle === selection.cycle,
        )!;
        expect(money(before.total).minus(after.total).toFixed(2)).toBe(price.amount);
      }),
    );
  });

  it("sair da Família completa sobe o total, e a tela diz quanto ela economizaria", () => {
    // Registro do conflito na especificação: sem Dívidas, o avulso sai R$ 71,50 contra R$ 44,90.
    const quote = quotePlan(
      avulso({
        entries: "ilimitado",
        modules: ["investimentos", "aposentadoria", "metas"],
        messages: 100,
      }),
      CATALOG,
    );
    expect(quote.total).toBe("71.50");
    expect(quote.familySaves).toBe("26.60");
  });

  it("não sugere a Família completa quando o avulso já sai mais barato", () => {
    expect(quotePlan(avulso({ modules: ["dividas"] }), CATALOG).familySaves).toBeNull();
  });

  it("o total é a soma exata do que vai para a Stripe", () => {
    fc.assert(
      fc.property(selectionArb, (selection) => {
        const quote = quotePlan(selection, CATALOG);
        const charged = quote.lines.reduce((acc, line) => {
          const row = CATALOG.find((price) => price.stripePriceId === line.stripePriceId)!;
          return acc.plus(row.amount);
        }, money(0));
        expect(charged.toFixed(2)).toBe(quote.total);
        expect(quote.missing).toEqual([]);
        expect(new Set(quote.lines.map((line) => line.stripePriceId)).size).toBe(
          quote.lines.length,
        );
      }),
    );
  });

  it("preço novo não muda quem já assina, e só vale para o item que entra agora", () => {
    const newer = CATALOG.map((row) =>
      row.item === "base:200" || row.item === "modulo:metas"
        ? { ...row, amount: "99.00", stripePriceId: `${row.stripePriceId}_novo` }
        : row,
    );
    const kept: SubscribedItem[] = [
      { price: "price_base:200_mes", item: "base:200", amount: "19.90", quantity: 1 },
    ];
    const same = quotePlan(avulso({ entries: "200" }), newer, kept);
    expect(same.total).toBe("19.90");
    expect(same.lines[0]!.stripePriceId).toBe("price_base:200_mes");

    const added = quotePlan(avulso({ entries: "200", modules: ["metas"] }), newer, kept);
    expect(added.total).toBe("118.90");
  });

  it("item sem preço não some da conta: fica em `missing`, e a tela não deixa assinar", () => {
    const partial = CATALOG.filter((row) => row.item !== "modulo:metas");
    expect(quotePlan(avulso({ modules: ["metas"] }), partial).missing).toEqual(["modulo:metas"]);
  });
});

describe("contas conectadas", () => {
  const SELLING: CatalogPrice = {
    id: "c",
    item: "contas_conectadas",
    cycle: "mes",
    amount: "19.90",
    stripePriceId: "price_conectadas",
  };

  it("fora de venda, o item não tem preço: fica em `missing` e a tela não deixa assinar", () => {
    const quote = quotePlan({ ...FAMILY_SELECTION, connectedAccounts: 1 }, CATALOG);
    expect(quote.missing).toEqual(["contas_conectadas"]);
    expect(quote.total).toBe("44.90");
  });

  it("sem quantidade, o item nem existe", () => {
    expect(itemsOf(FAMILY_SELECTION)).toEqual(["familia"]);
  });

  it("à venda, cobra por conta, por cima de qualquer plano", () => {
    const catalog = [...CATALOG, SELLING];
    const quote = quotePlan({ ...FAMILY_SELECTION, connectedAccounts: 3 }, catalog);
    expect(quote.total).toBe("104.60");
    expect(quote.lines.at(-1)).toMatchObject({
      item: "contas_conectadas",
      amount: "19.90",
      quantity: 3,
      stripePriceId: "price_conectadas",
    });
    expect(quotePlan(avulso({ connectedAccounts: 2 }), catalog).total).toBe("49.70");
  });

  it("só mensal: no anual não tem preço, então não dá para somar", () => {
    const quote = quotePlan({ ...FAMILY_SELECTION, connectedAccounts: 1, cycle: "ano" }, [
      ...CATALOG,
      SELLING,
    ]);
    expect(quote.missing).toEqual(["contas_conectadas"]);
  });

  it("quantidade fora da faixa não passa", () => {
    expect(normalizeSelection(avulso({ connectedAccounts: 999 })).connectedAccounts).toBe(20);
    expect(normalizeSelection(avulso({ connectedAccounts: -2 })).connectedAccounts).toBe(0);
    expect(normalizeSelection(avulso({ connectedAccounts: 1.7 })).connectedAccounts).toBe(1);
  });

  it("volta da assinatura com a quantidade, e não libera módulo nenhum", () => {
    const items: SubscribedItem[] = [
      { price: "p", item: "base:50", amount: "9.90", quantity: 1 },
      { price: "price_conectadas", item: "contas_conectadas", amount: "19.90", quantity: 4 },
    ];
    expect(connectedAccountsOf(items)).toBe(4);
    expect(selectionOfSubscribed(items, "mes").connectedAccounts).toBe(4);
    expect(entitlementsOf(items.map((row) => row.item)).modules).toEqual([]);
  });

  it("aumentar vale na hora; diminuir, no fim do ciclo", () => {
    const up = planChange(avulso({ connectedAccounts: 1 }), avulso({ connectedAccounts: 3 }));
    expect(up.now?.connectedAccounts).toBe(3);
    expect(up.later).toBeNull();
    const down = planChange(avulso({ connectedAccounts: 3 }), avulso({ connectedAccounts: 1 }));
    expect(down.now).toBeNull();
    expect(down.later?.connectedAccounts).toBe(1);
  });
});

describe("itens e o que eles liberam", () => {
  it("ida e volta: o que a tela escolhe é o que volta da Stripe", () => {
    fc.assert(
      fc.property(selectionArb, (selection) => {
        const items = itemsOf(selection);
        expect(itemsOf(selectionOfItems(items, selection.cycle))).toEqual(items);
      }),
    );
  });

  it("a Família completa libera tudo, sem limite de lançamentos e com 100 mensagens", () => {
    expect(entitlementsOf(itemsOf(FAMILY_SELECTION))).toEqual({
      modules: [...BILLING_MODULES],
      entryLimit: null,
      messageLimit: 100,
      currencies: [],
    });
  });

  it("o complemento leva a Família completa a 300 mensagens", () => {
    expect(entitlementsOf(["familia_mensagens:300", "familia"]).messageLimit).toBe(300);
  });

  it("o avulso libera só o que foi marcado", () => {
    expect(entitlementsOf(["base:200", "modulo:dividas", "moeda:USD"])).toEqual({
      modules: ["dividas"],
      entryLimit: 200,
      messageLimit: 0,
      currencies: ["USD"],
    });
  });

  it("item desconhecido, ou assinatura sem base, não libera nada", () => {
    expect(entitlementsOf(["modulo:outro"])).toMatchObject({ modules: [], entryLimit: 0 });
  });
});

const NOW = new Date("2026-11-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const state = (over: Partial<SubscriptionState> = {}): SubscriptionState => ({
  courtesy: false,
  courtesyUntil: null,
  trialEndsAt: null,
  status: null,
  items: [],
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  ...over,
});
const item = (name: string): SubscribedItem => ({
  price: `price_${name}`,
  item: name,
  amount: "9.90",
  quantity: 1,
});
const access = (subscription: SubscriptionState | null, billingEnabled = true) =>
  resolveAccess({ billingEnabled, subscription, now: NOW });

describe("acesso", () => {
  it("chave desligada: tudo como hoje, mesmo com teste vencido", () => {
    const off = access(state({ trialEndsAt: new Date(NOW.getTime() - DAY) }), false);
    expect(off.mode).toBe("livre");
    for (const module of BILLING_MODULES) expect(canUse(off, module)).toBe(true);
    expect(off.entryLimit).toBeNull();
    expect(off.messageLimit).toBeNull();
  });

  it("família que existia entra com cortesia, sem data de fim", () => {
    const result = access(state({ courtesy: true }));
    expect(result.mode).toBe("cortesia");
    expect(canUse(result, "assistente")).toBe(true);
  });

  it("cortesia vencida cai na assinatura ou em só leitura", () => {
    const past = new Date(NOW.getTime() - DAY);
    expect(access(state({ courtesy: true, courtesyUntil: past })).mode).toBe("leitura");
    const future = new Date(NOW.getTime() + DAY);
    expect(access(state({ courtesy: true, courtesyUntil: future })).mode).toBe("cortesia");
  });

  it("no teste de 7 dias está tudo liberado", () => {
    const trialEndsAt = new Date(NOW.getTime() + DAY);
    const result = access(state({ trialEndsAt }));
    expect(result.mode).toBe("teste");
    expect(result.trialEndsAt).toEqual(trialEndsAt);
    for (const module of BILLING_MODULES) expect(canUse(result, module)).toBe(true);
  });

  it("fim do teste sem assinatura: só leitura, vê tudo, não usa nada", () => {
    const result = access(state({ trialEndsAt: new Date(NOW.getTime() - 1) }));
    expect(result.mode).toBe("leitura");
    for (const module of BILLING_MODULES) {
      expect(canUse(result, module)).toBe(false);
      expect(canView(result, module)).toBe(true);
    }
  });

  it("assinante vale pelos itens, e módulo fora dos itens vira convite", () => {
    const result = access(
      state({ status: "active", items: [item("base:50"), item("modulo:metas")] }),
    );
    expect(result.mode).toBe("assinatura");
    expect(canUse(result, "metas")).toBe(true);
    expect(canUse(result, "investimentos")).toBe(false);
    expect(canView(result, "investimentos")).toBe(false);
    expect(result.entryLimit).toBe(50);
    expect(result.messageLimit).toBe(0);
  });

  it("cobrança atrasada mantém o acesso enquanto a Stripe tenta de novo", () => {
    const result = access(state({ status: "past_due", items: [item("familia")] }));
    expect(result.mode).toBe("assinatura");
    expect(result.pastDue).toBe(true);
  });

  it.each(["incomplete", "incomplete_expired", "canceled", "unpaid", "paused"])(
    "situação %s da Stripe não libera nada",
    (status) => {
      expect(access(state({ status, items: [item("familia")] })).mode).toBe("leitura");
    },
  );

  it("cancelada vale até o fim do período pago, mesmo com o evento atrasado por pouco", () => {
    const cancelled = (end: number) =>
      access(
        state({
          status: "active",
          items: [item("familia")],
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(NOW.getTime() + end),
        }),
      ).mode;
    expect(cancelled(DAY)).toBe("assinatura");
    expect(cancelled(-DAY)).toBe("assinatura");
    expect(cancelled(-4 * DAY)).toBe("leitura");
  });

  it("sem linha da família, o erro é nosso: não vira bloqueio", () => {
    expect(access(null).mode).toBe("cortesia");
  });

  it("moeda principal é grátis; adicional só a assinada; fora do plano, teste e cortesia veem todas", () => {
    const paid = access(state({ status: "active", items: [item("base:50"), item("moeda:USD")] }));
    expect(canUseCurrency(paid, "BRL", "BRL")).toBe(true);
    expect(canUseCurrency(paid, "USD", "BRL")).toBe(true);
    expect(canUseCurrency(paid, "EUR", "BRL")).toBe(false);
    expect(canUseCurrency(paid, "EUR", "EUR")).toBe(true);
    expect(canUseCurrency(access(state({ courtesy: true })), "EUR", "BRL")).toBe(true);
  });
});

describe("limites", () => {
  it("aviso em 80%, limite ao bater, e sem limite nunca avisa", () => {
    expect(usageLevel(39, 50)).toBe("normal");
    expect(usageLevel(40, 50)).toBe("aviso");
    expect(usageLevel(50, 50)).toBe("limite");
    expect(usageLevel(70, 50)).toBe("limite");
    expect(usageLevel(1_000_000, null)).toBe("normal");
  });

  it("vaga que sobra nunca é negativa", () => {
    expect(quotaLeft(10, 50)).toBe(40);
    expect(quotaLeft(60, 50)).toBe(0);
  });
});

describe("upgrade e downgrade", () => {
  it("sem mudança, nada acontece", () => {
    expect(planChange(FAMILY_SELECTION, { ...FAMILY_SELECTION })).toEqual({
      now: null,
      later: null,
    });
  });

  it("subir vale na hora", () => {
    const change = planChange(avulso(), avulso({ entries: "200", modules: ["metas"] }));
    expect(change.later).toBeNull();
    expect(itemsOf(change.now!)).toEqual(["base:200", "modulo:metas"]);
  });

  it("descer espera o fim do ciclo", () => {
    const target = avulso({ entries: "50" });
    const change = planChange(avulso({ entries: "200", modules: ["metas"] }), target);
    expect(change.now).toBeNull();
    expect(itemsOf(change.later!)).toEqual(["base:50"]);
  });

  it("somar um módulo e tirar outro: o novo entra agora, o antigo sai depois do que já foi pago", () => {
    const change = planChange(avulso({ modules: ["dividas"] }), avulso({ modules: ["metas"] }));
    expect(itemsOf(change.now!).toSorted()).toEqual(
      ["base:50", "modulo:dividas", "modulo:metas"].toSorted(),
    );
    expect(itemsOf(change.later!)).toEqual(["base:50", "modulo:metas"]);
  });

  it("sair da Família completa é redução, mesmo o avulso custando mais", () => {
    const target = avulso({ entries: "ilimitado", modules: ["metas"], messages: 100 });
    const change = planChange(FAMILY_SELECTION, target);
    expect(change.now).toBeNull();
    expect(change.later).toEqual(target);
  });

  it("entrar na Família completa vale na hora", () => {
    const change = planChange(avulso({ modules: ["metas"] }), FAMILY_SELECTION);
    expect(itemsOf(change.now!)).toEqual(["familia"]);
    expect(change.later).toBeNull();
  });

  it("mensal para anual tirando módulo cobra já só o plano pedido", () => {
    const current = avulso({ entries: "200", modules: ["dividas", "investimentos"] });
    const target = avulso({ entries: "200", cycle: "ano" });
    const { now, later } = planChange(current, target);
    expect(later).toBeNull();
    expect(quotePlan(now!, CATALOG).total).toBe("199.00");
    expect(itemsOf(now!)).toEqual(["base:200"]);
  });

  it("mensal para anual vale na hora; anual para mensal espera o ano acabar", () => {
    const year = { ...FAMILY_SELECTION, cycle: "ano" as const };
    const up = planChange(FAMILY_SELECTION, year);
    expect(up.now?.cycle).toBe("ano");
    expect(up.later).toBeNull();
    const down = planChange(year, FAMILY_SELECTION);
    expect(down.now).toBeNull();
    expect(down.later?.cycle).toBe("mes");
  });

  it("o que vale na hora nunca tira nada, e o fim sempre chega ao que a pessoa escolheu", () => {
    fc.assert(
      fc.property(selectionArb, selectionArb, (current, target) => {
        const { now, later } = planChange(current, target);
        const last = later ?? now ?? current;
        expect(itemsOf(last).toSorted()).toEqual(itemsOf(target).toSorted());
        expect(last.cycle).toBe(target.cycle);
        // Mensal para anual abre outro ciclo: é a única troca que tira na hora.
        if (!now || normalizeSelection(current).cycle !== last.cycle) return;
        const before = entitlementsOf(itemsOf(current));
        const after = entitlementsOf(itemsOf(now));
        for (const module of before.modules) expect(after.modules).toContain(module);
        expect(after.messageLimit).toBeGreaterThanOrEqual(before.messageLimit);
        expect(after.entryLimit ?? Infinity).toBeGreaterThanOrEqual(before.entryLimit ?? Infinity);
      }),
    );
  });
});

describe("centavos da Stripe", () => {
  it("vão e voltam sem erro de arredondamento", () => {
    expect(stripeUnitAmount("44.90")).toBe(4490);
    expect(stripeUnitAmount("29.90")).toBe(2990);
    expect(stripeUnitAmount("0.07")).toBe(7);
    expect(fromCents(4490)).toBe("44.90");
    expect(fromCents(0)).toBe("0.00");
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), (cents) => {
        expect(stripeUnitAmount(fromCents(cents))).toBe(cents);
      }),
    );
  });

  it("valor com fração de centavo ou zerado é erro, não preço errado", () => {
    expect(() => stripeUnitAmount("1.005")).toThrow(RangeError);
    expect(() => stripeUnitAmount("0.00")).toThrow(RangeError);
  });
});

describe("devolução e renovação", () => {
  const firstPaidAt = new Date("2026-11-01T12:00:00Z");

  it("devolve até 7 dias depois da primeira cobrança, uma vez só", () => {
    const at = (days: number) => new Date(firstPaidAt.getTime() + days * DAY);
    expect(refundWindowOpen({ firstPaidAt, refundedAt: null, now: at(7) })).toBe(true);
    expect(refundWindowOpen({ firstPaidAt, refundedAt: null, now: at(7.01) })).toBe(false);
    expect(refundWindowOpen({ firstPaidAt, refundedAt: at(1), now: at(2) })).toBe(false);
    expect(refundWindowOpen({ firstPaidAt: null, refundedAt: null, now: at(1) })).toBe(false);
  });

  it("avisa da renovação anual nos 30 dias antes, e não de quem cancelou", () => {
    const base = {
      cycle: "ano" as const,
      status: "active",
      cancelAtPeriodEnd: false,
      now: NOW,
    };
    const end = (days: number) => new Date(NOW.getTime() + days * DAY);
    expect(annualRenewalDue({ ...base, currentPeriodEnd: end(30) })).toBe(true);
    expect(annualRenewalDue({ ...base, currentPeriodEnd: end(31) })).toBe(false);
    expect(annualRenewalDue({ ...base, currentPeriodEnd: end(-1) })).toBe(false);
    expect(annualRenewalDue({ ...base, cycle: "mes", currentPeriodEnd: end(5) })).toBe(false);
    expect(annualRenewalDue({ ...base, cancelAtPeriodEnd: true, currentPeriodEnd: end(5) })).toBe(
      false,
    );
  });
});
