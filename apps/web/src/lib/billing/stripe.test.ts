// Chave, assinatura do webhook e o que fica do evento. Nada chama a Stripe: os eventos são assinados
// aqui, com um segredo fictício.
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_EVENTS, normalizeEvent, verifyEvent } from "./events";
import { liveAllowed, stripeKeyMode, stripeUsable } from "./stripe-key";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  captureError: vi.fn(async () => undefined),
  recordBillingEvent: vi.fn(async (_event: { data: object }) => true),
}));
const fila = vi.hoisted(() => ({ queueBillingEvents: vi.fn(async () => "job") }));
vi.mock("@organizeup/db", () => db);
vi.mock("@/app/admin/fila", () => fila);

const { POST } = await import("@/app/api/webhooks/stripe/route");
const { billingGateway, itemDiff } = await import("./gateway");

const SECRET = "whsec_ficticio_de_teste";
const FAKE = (kind: string) => `${kind}_${"x".repeat(24)}`;

/** Evento como a Stripe manda, com tudo o que não pode passar daqui. */
function event(type: string, object: object, over: object = {}) {
  return {
    id: "evt_1",
    object: "event",
    created: 1_790_000_000,
    livemode: false,
    type,
    data: { object },
    ...over,
  } as unknown as Stripe.Event;
}

const subscriptionObject = {
  id: "sub_1",
  object: "subscription",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  canceled_at: null,
  schedule: null,
  metadata: { household_id: "hh-1" },
  items: {
    data: [
      {
        id: "si_1",
        price: { id: "price_1" },
        quantity: 1,
        current_period_start: 1_790_000_000,
        current_period_end: 1_792_592_000,
      },
    ],
  },
};

function signedRequest(body: object, secret = SECRET) {
  const payload = JSON.stringify(body);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("https://site.example.com/api/webhooks/stripe", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": signature },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("STRIPE_ALLOW_LIVE", "");
});

describe("tipo da chave", () => {
  it("diz só o tipo", () => {
    expect(stripeKeyMode({})).toBe("ausente");
    expect(stripeKeyMode({ STRIPE_SECRET_KEY: "  " })).toBe("ausente");
    expect(stripeKeyMode({ STRIPE_SECRET_KEY: FAKE("sk_test") })).toBe("teste");
    expect(stripeKeyMode({ STRIPE_SECRET_KEY: FAKE("rk_test") })).toBe("teste");
    expect(stripeKeyMode({ STRIPE_SECRET_KEY: FAKE("sk_live") })).toBe("producao");
    expect(stripeKeyMode({ STRIPE_SECRET_KEY: FAKE("rk_live") })).toBe("producao");
    expect(stripeKeyMode({ STRIPE_SECRET_KEY: "pk_test_123" })).toBe("invalida");
  });

  it("produção só com STRIPE_ALLOW_LIVE=true, escrito assim", () => {
    const live = { STRIPE_SECRET_KEY: FAKE("sk_live") };
    expect(stripeUsable(live)).toBe(false);
    for (const value of ["1", "TRUE", "yes", " true", ""]) {
      expect(stripeUsable({ ...live, STRIPE_ALLOW_LIVE: value }), value).toBe(false);
      expect(liveAllowed({ STRIPE_ALLOW_LIVE: value }), value).toBe(false);
    }
    expect(stripeUsable({ ...live, STRIPE_ALLOW_LIVE: "true" })).toBe(true);
  });

  it("o cliente recusa chave de produção, nas duas formas, e não mostra o valor", () => {
    for (const kind of ["sk_live", "rk_live"]) {
      const key = FAKE(kind);
      expect(() => billingGateway({ STRIPE_SECRET_KEY: key })).toThrow("producao");
      try {
        billingGateway({ STRIPE_SECRET_KEY: key });
      } catch (error) {
        expect(String(error)).not.toContain(key);
      }
    }
    expect(() => billingGateway({})).toThrow("ausente");
    expect(() => billingGateway({ STRIPE_SECRET_KEY: FAKE("sk_test") })).not.toThrow();
  });

  it("ninguém define a variável de produção no repositório", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const repo = path.resolve(import.meta.dirname, "../../../../..");
    const example = readFileSync(path.join(repo, ".env.example"), "utf8");
    expect(example).not.toMatch(/^\s*STRIPE_ALLOW_LIVE\s*=\s*true/m);
  });
});

describe("assinatura do webhook", () => {
  it("aceita o que foi assinado com o segredo certo", () => {
    const payload = JSON.stringify(event("invoice.paid", {}));
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect(verifyEvent(payload, signature, SECRET).id).toBe("evt_1");
  });

  it("recusa outro segredo, corpo mexido e evento velho", () => {
    const payload = JSON.stringify(event("invoice.paid", {}));
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_outro" });
    expect(() => verifyEvent(payload, signature, SECRET)).toThrow();

    const good = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect(() => verifyEvent(`${payload} `, good, SECRET)).toThrow();

    const old = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(() => verifyEvent(payload, old, SECRET)).toThrow();
  });
});

describe("POST /api/webhooks/stripe", () => {
  const body = event("customer.subscription.updated", subscriptionObject);

  it("sem cabeçalho ou com assinatura errada responde 400 e não grava", async () => {
    const response = await POST(
      new Request("https://site.example.com/api/webhooks/stripe", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(400);
    expect((await POST(signedRequest(body, "whsec_outro"))).status).toBe(400);
    expect(db.recordBillingEvent).not.toHaveBeenCalled();
  });

  it("sem o segredo configurado responde 503: nada entra sem conferir", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await POST(signedRequest(body))).status).toBe(503);
    expect(db.recordBillingEvent).not.toHaveBeenCalled();
  });

  it("guarda e acorda o worker", async () => {
    expect((await POST(signedRequest(body))).status).toBe(200);
    expect(db.recordBillingEvent).toHaveBeenCalledOnce();
    expect(fila.queueBillingEvents).toHaveBeenCalledOnce();
  });

  it("evento repetido responde 200 e não acorda ninguém", async () => {
    db.recordBillingEvent.mockResolvedValueOnce(false);
    expect((await POST(signedRequest(body))).status).toBe(200);
    expect(fila.queueBillingEvents).not.toHaveBeenCalled();
  });

  it("falhar ao acordar o worker não falha o webhook: a passada do minuto pega", async () => {
    fila.queueBillingEvents.mockRejectedValueOnce(new Error("x"));
    expect((await POST(signedRequest(body))).status).toBe(200);
  });

  it("falhar ao gravar responde 500, para a Stripe repetir", async () => {
    db.recordBillingEvent.mockRejectedValueOnce(new Error("x"));
    expect((await POST(signedRequest(body))).status).toBe(500);
  });

  it("evento de produção sem a variável do fundador não entra, e a Stripe repete depois", async () => {
    const live = event("customer.subscription.updated", subscriptionObject, { livemode: true });
    expect((await POST(signedRequest(live))).status).toBe(503);
    expect(db.recordBillingEvent).not.toHaveBeenCalled();
    vi.stubEnv("STRIPE_ALLOW_LIVE", "true");
    expect((await POST(signedRequest(live))).status).toBe(200);
  });

  it("evento que não interessa responde 200 sem gravar", async () => {
    const other = event("customer.created", { id: "cus_1" });
    expect((await POST(signedRequest(other))).status).toBe(200);
    expect(db.recordBillingEvent).not.toHaveBeenCalled();
  });
});

describe("a trilha do webhook", () => {
  it("fica fora do proxy de idioma e não passa por sessão", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = path.resolve(import.meta.dirname, "../..");
    const proxy = readFileSync(path.join(src, "proxy.ts"), "utf8");
    const matcher = proxy.match(/matcher: (\[[^\]]*\])/)?.[1] ?? "";
    expect(matcher).not.toBe("");
    expect(JSON.parse(matcher) as string[]).not.toEqual(
      expect.arrayContaining([expect.stringContaining("/api")]),
    );
    const route = readFileSync(path.join(src, "app/api/webhooks/stripe/route.ts"), "utf8");
    expect(route).not.toMatch(/requireTenant|requireSession|lib\/session/);
    expect(route).toContain("request.text()");
  });
});

describe("o que fica do evento", () => {
  const SECRETS = ["ana@example.com", "Ana da Silva", "Rua das Flores", "12345678900"];
  const payer = {
    customer_email: SECRETS[0],
    customer_name: SECRETS[1],
    customer_address: { line1: SECRETS[2] },
    customer_details: { email: SECRETS[0], name: SECRETS[1], tax_ids: [{ value: SECRETS[3] }] },
    billing_details: { email: SECRETS[0], name: SECRETS[1], address: { line1: SECRETS[2] } },
    receipt_email: SECRETS[0],
    shipping_details: { name: SECRETS[1] },
  };

  const samples = [
    event("checkout.session.completed", {
      ...payer,
      client_reference_id: "hh-1",
      customer: "cus_1",
      subscription: "sub_1",
    }),
    event("customer.subscription.updated", { ...payer, ...subscriptionObject }),
    event("invoice.paid", {
      ...payer,
      customer: "cus_1",
      amount_paid: 4490,
      status_transitions: { paid_at: 1_790_000_100 },
      parent: {
        subscription_details: { subscription: "sub_1", metadata: { household_id: "hh-1" } },
      },
    }),
    event("invoice.payment_failed", { ...payer, customer: "cus_1", parent: null }),
    event("charge.refunded", { ...payer, customer: "cus_1", refunded: true }),
    event("subscription_schedule.updated", {
      ...payer,
      id: "sub_sched_1",
      customer: "cus_1",
      status: "active",
      metadata: { household_id: "hh-1" },
      current_phase: { start_date: 1, end_date: 100 },
      phases: [
        { start_date: 1, end_date: 100, items: [{ price: "price_a", quantity: 1 }] },
        { start_date: 100, end_date: 200, items: [{ price: "price_b", quantity: 1 }] },
      ],
    }),
  ];

  it("nenhum evento carrega e-mail, nome, endereço ou documento do pagador", () => {
    for (const sample of samples) {
      const stored = JSON.stringify(normalizeEvent(sample));
      for (const secret of SECRETS) expect(stored, sample.type).not.toContain(secret);
    }
  });

  it("todo evento assinado no endpoint é entendido", () => {
    for (const type of STRIPE_EVENTS) {
      const sample = samples.find((item) => item.type === type) ?? event(type, subscriptionObject);
      if (type.startsWith("subscription_schedule")) {
        expect(normalizeEvent({ ...samples[5]!, type } as Stripe.Event)?.data).toBeTruthy();
      } else if (!type.startsWith("customer.subscription")) {
        expect(normalizeEvent(sample), type).not.toBeNull();
      } else {
        expect(normalizeEvent(sample)?.householdId, type).toBe("hh-1");
      }
    }
  });

  it("assinatura: período vem do item, e a família do metadata", () => {
    expect(normalizeEvent(samples[1]!)).toMatchObject({
      householdId: "hh-1",
      customerId: "cus_1",
      data: {
        kind: "subscription",
        status: "active",
        items: [{ price: "price_1", quantity: 1 }],
        periodEnd: new Date(1_792_592_000 * 1000).toISOString(),
      },
    });
  });

  it("schedule: a próxima fase é a redução marcada; solto, fica sem redução", () => {
    expect(normalizeEvent(samples[5]!)?.data).toMatchObject({
      kind: "schedule",
      next: { items: [{ price: "price_b", quantity: 1 }] },
    });
    const released = event("subscription_schedule.released", {
      id: "sub_sched_1",
      status: "released",
      customer: "cus_1",
      metadata: {},
      current_phase: null,
      phases: [],
    });
    expect(normalizeEvent(released)?.data).toEqual({
      kind: "schedule",
      scheduleId: "sub_sched_1",
      next: null,
      ended: true,
    });
  });
});

describe("troca de itens", () => {
  it("item que continua não é tocado: é assim que mantém o preço antigo", () => {
    const one = (price: string, quantity = 1) => ({ price, quantity });
    const current = [
      { id: "si_1", ...one("price_base") },
      { id: "si_2", ...one("price_metas") },
    ];
    expect(itemDiff(current, [one("price_base"), one("price_dividas")])).toEqual([
      { id: "si_2", deleted: true },
      { price: "price_dividas", quantity: 1 },
    ]);
    expect(itemDiff(current, [one("price_base"), one("price_metas")])).toEqual([]);
  });

  it("quantidade que muda vai no item que já existe", () => {
    const current = [{ id: "si_1", price: "price_conectadas", quantity: 2 }];
    expect(itemDiff(current, [{ price: "price_conectadas", quantity: 5 }])).toEqual([
      { id: "si_1", quantity: 5 },
    ]);
  });
});
