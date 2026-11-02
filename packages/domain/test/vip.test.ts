// VIP em `resolveAccess` (ADR-0025): o único lugar que decide acesso. Regras em
// docs/specs/planos-e-assinatura.md, seções 5 e 9.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BILLING_MODULES,
  canSubscribe,
  canUse,
  canUseCurrency,
  canView,
  discountedAmount,
  firstChargeAfterVip,
  resolveAccess,
  vipActive,
  vipEndingSoon,
  vipNoticeDue,
  vipPartial,
  VIP_NOTICE_DAYS,
  willChargeAgain,
  type SubscribedItem,
  type SubscriptionState,
  type VipState,
} from "../src";

const NOW = new Date("2026-11-02T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const PAST = new Date(NOW.getTime() - DAY);
const FUTURE = new Date(NOW.getTime() + DAY);

const line = (item: string): SubscribedItem => ({
  price: `price_${item}`,
  item,
  amount: "9.90",
  quantity: 1,
});

const plan = (over: Partial<SubscriptionState> = {}): SubscriptionState => ({
  courtesy: false,
  courtesyUntil: null,
  trialEndsAt: null,
  status: null,
  items: [],
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  ...over,
});

const vip = (over: Partial<VipState> = {}): VipState => ({
  cost: "sem_custo",
  discountPercent: null,
  full: true,
  modules: [],
  entryLimit: null,
  messageLimit: null,
  currencies: [],
  endsAt: null,
  revokedAt: null,
  holderActive: true,
  ...over,
});

const limited = (over: Partial<VipState> = {}) =>
  vip({ full: false, modules: ["metas"], entryLimit: 200, messageLimit: 0, ...over });

const resolve = (
  subscription: SubscriptionState | null,
  grant: VipState | null,
  billingEnabled = true,
) => resolveAccess({ billingEnabled, subscription, vip: grant, now: NOW });

describe("VIP sem custo", () => {
  it("com a chave ligada, libera tudo a quem só leria, sem Stripe nenhuma", () => {
    const access = resolve(plan({ trialEndsAt: PAST }), vip());
    expect(access.mode).toBe("vip");
    for (const module of BILLING_MODULES) expect(canUse(access, module)).toBe(true);
    expect(access.entryLimit).toBeNull();
    expect(access.messageLimit).toBeNull();
    expect(access.currencies).toBeNull();
    expect(access.vip).toEqual({ cost: "sem_custo", discountPercent: null, endsAt: null });
  });

  it("com a chave desligada, todos seguem como hoje e o VIP nem aparece", () => {
    const access = resolve(plan({ trialEndsAt: PAST }), vip(), false);
    expect(access.mode).toBe("livre");
    expect(access.vip).toBeNull();
  });

  it("módulos e limites escolhidos: só o que foi dado", () => {
    const access = resolve(plan({ trialEndsAt: PAST }), limited());
    expect(access.mode).toBe("vip");
    expect(access.modules).toEqual(["metas"]);
    expect(access.entryLimit).toBe(200);
    expect(access.messageLimit).toBe(0);
    expect(canUse(access, "investimentos")).toBe(false);
    expect(canUse(access, "assistente")).toBe(false);
  });

  it("sem mensagens o assistente não entra, mesmo vindo na lista", () => {
    const access = resolve(plan(), limited({ modules: ["assistente"], messageLimit: 0 }));
    expect(canUse(access, "assistente")).toBe(false);
    const talks = resolve(plan(), limited({ modules: ["assistente"], messageLimit: 30 }));
    expect(canUse(talks, "assistente")).toBe(true);
  });

  it("moeda escolhida libera só ela", () => {
    const access = resolve(plan(), limited({ currencies: ["USD"] }));
    expect(canUseCurrency(access, "USD", "BRL")).toBe(true);
    expect(canUseCurrency(access, "EUR", "BRL")).toBe(false);
  });

  it("nunca tira o que a família já tinha", () => {
    const access = resolve(
      plan({
        status: "active",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: FUTURE,
        items: [line("base:ilimitado"), line("modulo:dividas"), line("moeda:EUR")],
      }),
      limited({ currencies: ["USD"] }),
    );
    expect(access.modules).toEqual(["dividas", "metas"]);
    expect(access.entryLimit).toBeNull();
    expect(access.currencies).toEqual(["EUR", "USD"]);
  });
});

describe("fim do VIP", () => {
  const trial = plan({ trialEndsAt: FUTURE });
  const reading = plan({ trialEndsAt: PAST });
  const paying = plan({ status: "active", items: [line("base:50")] });
  const courtesy = plan({ courtesy: true });

  it.each([
    ["teste", trial],
    ["leitura", reading],
    ["assinatura", paying],
    ["cortesia", courtesy],
  ])("volta a %s, igual a antes, ao vencer, ao ser removido ou sem responsável", (mode, state) => {
    const before = resolve(state, null);
    expect(before.mode).toBe(mode);
    for (const grant of [
      vip({ endsAt: PAST }),
      vip({ endsAt: NOW }),
      vip({ revokedAt: PAST }),
      vip({ holderActive: false }),
    ]) {
      expect(resolve(state, grant)).toEqual(before);
    }
  });

  it("propriedade: VIP vencido nunca muda o acesso, seja qual for a concessão", () => {
    const grant = fc.record({
      full: fc.boolean(),
      modules: fc.subarray([...BILLING_MODULES]),
      entryLimit: fc.option(fc.nat(1000)),
      messageLimit: fc.option(fc.nat(1000)),
    });
    fc.assert(
      fc.property(grant, (over) => {
        const expired = vip({ ...over, endsAt: PAST });
        expect(resolve(reading, expired)).toEqual(resolve(reading, null));
      }),
    );
  });

  it("propriedade: VIP válido nunca dá menos que o plano", () => {
    fc.assert(
      fc.property(fc.subarray([...BILLING_MODULES]), fc.option(fc.nat(500)), (modules, entry) => {
        const before = resolve(paying, null);
        const after = resolve(paying, limited({ modules, entryLimit: entry }));
        for (const module of before.modules) expect(after.modules).toContain(module);
        if (before.entryLimit !== null && after.entryLimit !== null) {
          expect(after.entryLimit).toBeGreaterThanOrEqual(before.entryLimit);
        }
      }),
    );
  });
});

describe("visão", () => {
  it("VIP nunca tira visão: o que ficou de fora abre só para consulta", () => {
    const reading = plan({ trialEndsAt: PAST });
    const access = resolve(reading, limited());
    for (const module of BILLING_MODULES) {
      expect(canView(resolve(reading, null), module)).toBe(true);
      expect(canView(access, module), module).toBe(true);
    }
    expect(canUse(access, "dividas")).toBe(false);
    expect(vipPartial(access)).toBe(true);
  });

  it("tudo liberado não é parcial", () => {
    expect(vipPartial(resolve(plan(), vip()))).toBe(false);
    expect(vipPartial(resolve(plan(), null))).toBe(false);
  });
});

describe("assinar durante o VIP", () => {
  it("sem data não há o que assinar; com data, pode", () => {
    expect(canSubscribe(resolve(plan(), vip()))).toBe(false);
    expect(canSubscribe(resolve(plan(), vip({ endsAt: FUTURE })))).toBe(true);
    expect(canSubscribe(resolve(plan({ trialEndsAt: PAST }), null))).toBe(true);
  });

  it("a primeira cobrança é o fim do VIP, sem pagar dias que já ganhou", () => {
    const end = new Date(NOW.getTime() + 10 * DAY);
    expect(firstChargeAfterVip(end, NOW)).toEqual(end);
  });

  it("faltando menos que o prazo da Stripe, vale o prazo", () => {
    const first = firstChargeAfterVip(new Date(NOW.getTime() + DAY), NOW);
    expect(first.getTime() - NOW.getTime()).toBe(49 * 60 * 60 * 1000);
  });

  it("assinatura em teste na Stripe mantém o acesso quando o VIP acaba", () => {
    const after = plan({ status: "trialing", items: [line("base:50"), line("modulo:metas")] });
    const ended = resolve(after, vip({ endsAt: PAST }));
    expect(ended.mode).toBe("assinatura");
    expect(canUse(ended, "metas")).toBe(true);
  });
});

describe("aviso à família", () => {
  it("só de concessão sem custo que vale e acaba em breve", () => {
    const soon = new Date(NOW.getTime() + 5 * DAY);
    const far = new Date(NOW.getTime() + 30 * DAY);
    expect(vipNoticeDue(vip({ endsAt: soon }), NOW)).toBe(true);
    expect(vipNoticeDue(vip({ endsAt: far }), NOW)).toBe(false);
    expect(vipNoticeDue(vip({ endsAt: null }), NOW)).toBe(false);
    expect(vipNoticeDue(vip({ endsAt: PAST }), NOW)).toBe(false);
    expect(vipNoticeDue(vip({ endsAt: soon, revokedAt: PAST }), NOW)).toBe(false);
    expect(vipNoticeDue(vip({ endsAt: soon, holderActive: false }), NOW)).toBe(false);
    expect(vipNoticeDue(vip({ endsAt: soon, cost: "desconto", discountPercent: 10 }), NOW)).toBe(
      false,
    );
  });
});

describe("desconto no valor", () => {
  it("tira o percentual e arredonda só no fim", () => {
    // R$ 44,90 com 30% de desconto = 31,43.
    expect(discountedAmount("44.90", 30)).toBe("31.43");
    expect(discountedAmount("44.90", null)).toBe("44.90");
  });
});

describe("VIP com desconto", () => {
  const discount = (over: Partial<VipState> = {}) =>
    vip({ cost: "desconto", discountPercent: 30, ...over });

  it("sem assinatura não libera nada: desconto não é acesso de graça", () => {
    const access = resolve(plan({ trialEndsAt: PAST }), discount());
    expect(access.mode).toBe("leitura");
    expect(access.modules).toEqual([]);
    expect(access.vip?.discountPercent).toBe(30);
  });

  it("assinando, segue assinante e soma o que foi concedido", () => {
    const access = resolve(
      plan({ status: "active", items: [line("base:50")] }),
      discount({ full: false, modules: ["metas"], entryLimit: 200, messageLimit: 0 }),
    );
    expect(access.mode).toBe("assinatura");
    expect(access.modules).toEqual(["metas"]);
    expect(access.entryLimit).toBe(200);
  });

  it("assinatura que acabou perde o que o VIP somava", () => {
    const access = resolve(plan({ status: "canceled", items: [line("base:50")] }), discount());
    expect(access.mode).toBe("leitura");
  });
});

describe("apoio do painel", () => {
  it("aviso só nos dias anteriores ao fim, e sem data nunca avisa", () => {
    const at = (days: number) => ({ endsAt: new Date(NOW.getTime() + days * DAY) });
    expect(vipEndingSoon(at(VIP_NOTICE_DAYS), NOW)).toBe(true);
    expect(vipEndingSoon(at(VIP_NOTICE_DAYS + 1), NOW)).toBe(false);
    expect(vipEndingSoon(at(-1), NOW)).toBe(false);
    expect(vipEndingSoon({ endsAt: null }, NOW)).toBe(false);
  });

  it("vale só sem remoção, com responsável e antes do fim", () => {
    expect(vipActive(vip(), NOW)).toBe(true);
    expect(vipActive(vip({ endsAt: FUTURE }), NOW)).toBe(true);
    expect(vipActive(vip({ endsAt: NOW }), NOW)).toBe(false);
  });

  it("só quem a Stripe vai cobrar de novo impede a concessão sem custo", () => {
    expect(willChargeAgain({ status: "active", cancelAtPeriodEnd: false })).toBe(true);
    expect(willChargeAgain({ status: "past_due", cancelAtPeriodEnd: false })).toBe(true);
    // Boleto esperando e fatura sem pagar ainda podem cobrar.
    expect(willChargeAgain({ status: "incomplete", cancelAtPeriodEnd: false })).toBe(true);
    expect(willChargeAgain({ status: "unpaid", cancelAtPeriodEnd: false })).toBe(true);
    expect(willChargeAgain({ status: "incomplete_expired", cancelAtPeriodEnd: false })).toBe(false);
    expect(willChargeAgain({ status: "active", cancelAtPeriodEnd: true })).toBe(false);
    expect(willChargeAgain({ status: "canceled", cancelAtPeriodEnd: false })).toBe(false);
    expect(willChargeAgain({ status: null, cancelAtPeriodEnd: false })).toBe(false);
  });
});
