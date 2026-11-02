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
    subscriptions = {
      retrieve: async () => ({
        status: api.status,
        items: { data: [{ id: "si_1", price: { id: "price_a" }, quantity: 1 }] },
      }),
      update: async () => {
        api.log.push("update");
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
  api.charges = [
    { id: "ch_1", status: "succeeded", refunded: false, payment_method_details: { type: "card" } },
  ];
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
