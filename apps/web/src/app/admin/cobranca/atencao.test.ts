import type { AdminFamilyBilling, AdminSubscription } from "@organizeup/db";
import type { FamilyAccess } from "@organizeup/domain";
import { describe, expect, it } from "vitest";
import { billingAttention, liveSubscriptions, type FamilyState } from "./atencao";

const sub = (over: Partial<AdminSubscription> = {}) =>
  ({
    status: "active",
    cancelAtPeriodEnd: false,
    hasSubscription: true,
    discountPercent: null,
    ...over,
  }) as AdminSubscription;

const state = (
  subscription: AdminSubscription | null,
  mode: FamilyAccess["mode"],
  vip: FamilyAccess["vip"] = null,
): FamilyState => ({
  family: { subscription } as AdminFamilyBilling,
  access: { mode, vip } as FamilyAccess,
});

const free = { cost: "sem_custo" as const, discountPercent: null, endsAt: null };
const off = (percent: number) => ({
  cost: "desconto" as const,
  discountPercent: percent,
  endsAt: null,
});

describe("cobrado mesmo sem precisar pagar", () => {
  it("vale para VIP sem custo e para cortesia", () => {
    const { charged } = billingAttention([
      state(sub(), "vip", free),
      state(sub(), "cortesia"),
      state(sub(), "assinatura"),
    ]);
    expect(charged.map((row) => row.access.mode)).toEqual(["vip", "cortesia"]);
  });

  it("inclui boleto esperando e fatura sem pagar", () => {
    const list = [state(sub({ status: "incomplete" }), "vip", free)];
    list.push(state(sub({ status: "unpaid" }), "cortesia"));
    expect(billingAttention(list).charged).toHaveLength(2);
  });

  it("não acusa quem assinou para começar quando o VIP acaba, nem quem já cancelou", () => {
    const { charged } = billingAttention([
      state(sub({ status: "trialing" }), "vip", free),
      state(sub({ cancelAtPeriodEnd: true }), "vip", free),
      state(sub({ status: "canceled" }), "cortesia"),
    ]);
    expect(charged).toEqual([]);
  });
});

describe("desconto", () => {
  it("concedido e não aplicado aparece; aplicado, não", () => {
    const { unapplied } = billingAttention([
      state(sub(), "assinatura", off(30)),
      state(sub({ discountPercent: 30 }), "assinatura", off(30)),
    ]);
    expect(unapplied).toHaveLength(1);
  });

  it("outro percentual também é não aplicado", () => {
    const list = [state(sub({ discountPercent: 10 }), "assinatura", off(30))];
    expect(billingAttention(list).unapplied).toHaveLength(1);
  });

  it("sobrou desconto só de assinatura que ainda cobra", () => {
    const { leftover } = billingAttention([
      state(sub({ discountPercent: 30 }), "assinatura"),
      state(sub({ discountPercent: 30, status: "canceled" }), "leitura"),
      state(sub({ discountPercent: 30, cancelAtPeriodEnd: true }), "assinatura"),
    ]);
    expect(leftover).toHaveLength(1);
  });
});

describe("assinaturas de pé", () => {
  it("conta só as que existem na Stripe e seguem cobrando", () => {
    expect(
      liveSubscriptions([
        state(sub(), "livre"),
        state(sub({ hasSubscription: false }), "livre"),
        state(sub({ cancelAtPeriodEnd: true }), "livre"),
        state(null, "livre"),
      ]),
    ).toBe(1);
  });
});
