// O cliente da Stripe por dentro, com a API falsa: a ordem das chamadas é o que importa aqui. Nada sai
// para a rede.
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  log: [] as string[],
  failCancel: false,
  failUpdate: false,
  status: "active",
  charges: [] as Array<{
    id: string;
    status: string;
    refunded: boolean;
    payment_method_details?: { type: string };
  }>,
  next: [{ price: "price_reducao", quantity: 1 }] as unknown[] | null,
  coupons: [] as string[],
  updates: [] as Array<Record<string, unknown>>,
  invoiceStatus: "open",
  latestInvoice: "in_1" as string | null,
  sessions: [] as Array<Record<string, unknown>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("stripe", () => {
  class Fake {
    charges = {
      list: async () => ({ data: api.charges.filter((charge) => !charge.refunded) }),
    };
    refunds = {
      create: async (params: { charge: string }) => {
        api.log.push(`refund:${params.charge}`);
        const charge = api.charges.find((item) => item.id === params.charge);
        if (charge) charge.refunded = true;
        return {};
      },
    };
    coupons = {
      retrieve: async (id: string) => {
        if (api.coupons.includes(id)) return { id };
        throw Object.assign(new Error("sem cupom"), { statusCode: 404 });
      },
      create: async (params: { id: string }) => {
        api.log.push(`cupom:${params.id}`);
        api.coupons.push(params.id);
        return { id: params.id };
      },
    };
    invoices = {
      retrieve: async () => ({ status: api.invoiceStatus }),
      pay: async (id: string) => {
        api.log.push(`pay:${id}`);
        return {};
      },
    };
    checkout = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          api.sessions.push(params);
          return { id: "cs_1", url: "https://checkout.example.com" };
        },
      },
    };
    subscriptions = {
      retrieve: async () => ({
        status: api.status,
        latest_invoice: api.latestInvoice,
        items: { data: [{ id: "si_1", price: { id: "price_a" }, quantity: 1 }] },
      }),
      update: async (_id: string, params: Record<string, unknown> = {}) => {
        api.log.push("update");
        api.updates.push(params);
        if (api.failUpdate) throw new Error("card_declined");
        return {};
      },
      cancel: async (id: string) => {
        api.log.push(`cancel:${id}`);
        if (api.failCancel) throw new Error("rede");
        api.status = "canceled";
        return {};
      },
    };
    subscriptionSchedules = {
      retrieve: async () => ({
        current_phase: { end_date: 100 },
        phases: [
          { start_date: 1, end_date: 100, items: [] },
          { start_date: 100, end_date: 200, items: api.next ?? [] },
        ].slice(0, api.next ? 2 : 1),
      }),
      release: async (id: string) => {
        api.log.push(`release:${id}`);
        return {};
      },
      create: async () => {
        api.log.push("schedule");
        return {
          id: "sub_sched_2",
          phases: [{ start_date: 1, end_date: 100, items: [{ price: "price_a", quantity: 1 }] }],
        };
      },
      update: async (_id: string, params: { phases: Array<{ items: unknown[] }> }) => {
        api.log.push(`phases:${JSON.stringify(params.phases.at(-1)?.items)}`);
        return {};
      },
    };
  }
  return { default: Fake };
});

const { billingGateway } = await import("./gateway");

const gateway = () => billingGateway({ STRIPE_SECRET_KEY: "sk_test_ficticia" });
const refund = () =>
  gateway().refundAndCancel({
    subscriptionId: "sub_1",
    customerId: "cus_1",
    since: new Date(),
  });

beforeEach(() => {
  api.log.length = 0;
  api.failCancel = false;
  api.failUpdate = false;
  api.status = "active";
  api.next = [{ price: "price_reducao", quantity: 1 }];
  api.coupons = [];
  api.updates = [];
  api.sessions = [];
  api.invoiceStatus = "open";
  api.latestInvoice = "in_1";
  api.charges = [
    { id: "ch_1", status: "succeeded", refunded: false, payment_method_details: { type: "card" } },
  ];
});

describe("desconto VIP", () => {
  const input = { householdId: "hh-1", subscriptionId: "sub_1" };

  it("cria o cupom uma vez, sem cobrança proporcional, e marca a metadata", async () => {
    await gateway().setDiscount({ ...input, percent: 30 });
    await gateway().setDiscount({ ...input, percent: 30 });
    expect(api.log.filter((line) => line.startsWith("cupom:"))).toEqual([
      "cupom:organizeup_vip_30",
    ]);
    expect(api.updates[0]).toEqual({
      discounts: [{ coupon: "organizeup_vip_30" }],
      proration_behavior: "none",
      metadata: { household_id: "hh-1", vip_desconto: "30" },
    });
  });

  it("tirar limpa o cupom e a metadata, sem criar nada", async () => {
    await gateway().setDiscount({ ...input, percent: null });
    expect(api.coupons).toEqual([]);
    expect(api.updates[0]).toMatchObject({
      discounts: "",
      metadata: { vip_desconto: "" },
    });
  });

  it("assinar com desconto já leva o cupom e a metadata para a assinatura", async () => {
    const checkout = {
      householdId: "hh-1",
      customerId: "cus_1",
      prices: [{ price: "price_a", quantity: 1 }],
      cycle: "mes" as const,
      locale: "pt-BR",
      successUrl: "https://app.example.com/ok",
      cancelUrl: "https://app.example.com/nao",
    };
    await gateway().createCheckout({ ...checkout, discountPercent: 15 });
    expect(api.sessions[0]).toMatchObject({
      discounts: [{ coupon: "organizeup_vip_15" }],
      subscription_data: { metadata: { household_id: "hh-1", vip_desconto: "15" } },
    });
    await gateway().createCheckout(checkout);
    expect(api.sessions[1]).not.toHaveProperty("discounts");
    expect(api.sessions[1]).toMatchObject({
      subscription_data: { metadata: { household_id: "hh-1" } },
    });
  });
});

describe("reenviar cobrança", () => {
  it("tenta de novo a fatura em aberto", async () => {
    expect(await gateway().retryInvoice("sub_1")).toBe("cobrada");
    expect(api.log).toContain("pay:in_1");
  });

  it("fatura paga, ou sem fatura: nada a fazer, e nada é cobrado", async () => {
    api.invoiceStatus = "paid";
    expect(await gateway().retryInvoice("sub_1")).toBe("nada_em_aberto");
    api.latestInvoice = null;
    expect(await gateway().retryInvoice("sub_1")).toBe("nada_em_aberto");
    expect(api.log.some((line) => line.startsWith("pay:"))).toBe(false);
  });
});

describe("devolução", () => {
  it("encerra antes de devolver", async () => {
    expect(await refund()).toBe("devolvido");
    expect(api.log).toEqual(["cancel:sub_1", "refund:ch_1"]);
  });

  it("cancelar falhou: nada foi devolvido, e repetir conclui", async () => {
    api.failCancel = true;
    await expect(refund()).rejects.toThrow("rede");
    expect(api.log).toEqual(["cancel:sub_1"]);
    api.failCancel = false;
    api.log.length = 0;
    expect(await refund()).toBe("devolvido");
    expect(api.log).toEqual(["cancel:sub_1", "refund:ch_1"]);
  });

  it("sem nada a devolver, ainda encerra: não sobra assinatura ativa de quem já recebeu", async () => {
    api.charges = [];
    expect(await refund()).toBe("nada_a_devolver");
    expect(api.log).toEqual(["cancel:sub_1"]);
  });

  it("assinatura já encerrada: repetir só devolve o que faltou", async () => {
    api.status = "canceled";
    expect(await refund()).toBe("devolvido");
    expect(api.log).toEqual(["refund:ch_1"]);
  });

  it("boleto: não encerra nem devolve", async () => {
    api.charges[0]!.payment_method_details = { type: "boleto" };
    expect(await refund()).toBe("boleto");
    expect(api.log).toEqual([]);
  });
});

describe("troca com redução marcada", () => {
  const input = {
    householdId: "hh-1",
    subscriptionId: "sub_1",
    scheduleId: "sub_sched_1",
    now: [{ price: "price_b", quantity: 1 }],
    later: null,
    prorationDate: null,
  };

  it("upgrade recusado marca de novo a redução que estava lá", async () => {
    api.failUpdate = true;
    await expect(gateway().applyChange(input)).rejects.toThrow("card_declined");
    expect(api.log).toEqual([
      "release:sub_sched_1",
      "update",
      "schedule",
      'phases:[{"price":"price_reducao","quantity":1}]',
    ]);
  });

  it("upgrade aceito não remarca a redução antiga", async () => {
    await gateway().applyChange(input);
    expect(api.log).toEqual(["release:sub_sched_1", "update"]);
  });

  it("recusado sem redução marcada não inventa schedule", async () => {
    api.failUpdate = true;
    await expect(gateway().applyChange({ ...input, scheduleId: null })).rejects.toThrow();
    expect(api.log).toEqual(["update"]);
  });

  it("cancelar que falha também não perde a redução", async () => {
    api.failUpdate = true;
    await expect(
      gateway().setCancelAtPeriodEnd({
        householdId: "hh-1",
        subscriptionId: "sub_1",
        scheduleId: "sub_sched_1",
        cancel: true,
      }),
    ).rejects.toThrow();
    expect(api.log).toContain("schedule");
  });
});

describe("encerrar", () => {
  it("assinatura que já acabou não é erro", async () => {
    api.status = "canceled";
    await gateway().cancelNow("sub_1");
    expect(api.log).toEqual([]);
  });
});
