// Eventos da Stripe viram estado na tabela da família (ADR-0023), pela conexão do worker, como em
// produção. Eventos fictícios, com o formato que `normalizeEvent` grava. Nada aqui chama a Stripe.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const agents = await import("../src/index");

const { billingCatalog, billingEvents, eq, featureFlags, household, householdNotifications } = db;

const log = { error: () => undefined, info: () => undefined };
const silent = async () => agents.runBillingEvents(log);

const PRICES = {
  base: "price_base200",
  metas: "price_metas",
  dividas: "price_dividas",
  familia: "price_familia",
  anual: "price_familia_ano",
};

let families = 0;
let events = 0;

async function newFamily(): Promise<{ id: string; job: TenantContext }> {
  families += 1;
  const id = `hh-assina-${families}`;
  await db.withAdmin("seed do teste de assinatura", (admin) =>
    admin.insert(household).values({ id, name: "Família", slug: id }),
  );
  return { id, job: db.fromJob({ householdId: id }) };
}

interface Stored {
  type?: string;
  at: number;
  householdId?: string | null;
  customerId?: string | null;
  data: Record<string, unknown>;
}

const BASE_TIME = Date.parse("2026-11-01T12:00:00Z");

async function receive(event: Stored): Promise<string> {
  events += 1;
  const id = `evt_assina${events}`;
  await db.withAdmin("seed do teste de assinatura", (admin) =>
    admin.insert(billingEvents).values({
      id,
      type: event.type ?? "customer.subscription.updated",
      stripeAt: new Date(BASE_TIME + event.at * 1000),
      livemode: false,
      householdId: event.householdId ?? null,
      customerId: event.customerId ?? null,
      data: event.data,
    }),
  );
  return id;
}

const subscription = (over: Record<string, unknown> = {}) => ({
  kind: "subscription",
  // Uma assinatura da Stripe é de uma família só: a coluna é única.
  subscriptionId: `sub_f${families}`,
  status: "active",
  items: [
    { price: PRICES.base, quantity: 1 },
    { price: PRICES.metas, quantity: 1 },
  ],
  periodStart: "2026-11-01T12:00:00.000Z",
  periodEnd: "2026-12-01T12:00:00.000Z",
  cancelAtPeriodEnd: false,
  canceledAt: null,
  scheduleId: null,
  ...over,
});

const row = async (job: TenantContext) => (await db.readSubscription(job))!;

async function setBilling(enabled: boolean) {
  await db.withAdmin("teste de assinatura: chave", (admin) =>
    admin.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, db.FLAG_KEYS.billing)),
  );
}

beforeAll(async () => {
  await db.withAdmin("seed do teste de assinatura", async (admin) => {
    const set = (item: string, cycle: "mes" | "ano", price: string) =>
      admin
        .update(billingCatalog)
        .set({ stripePriceId: price })
        .where(db.and(eq(billingCatalog.item, item), eq(billingCatalog.cycle, cycle)));
    await set("base:200", "mes", PRICES.base);
    await set("modulo:metas", "mes", PRICES.metas);
    await set("modulo:dividas", "mes", PRICES.dividas);
    await set("familia", "mes", PRICES.familia);
    await set("familia", "ano", PRICES.anual);
  });
  await setBilling(true);
});

afterAll(async () => {
  await setBilling(false);
});

describe("assinatura local", () => {
  it("o desconto VIP entra e sai pelo webhook, e evento antigo sem ele não quebra", async () => {
    const { id, job } = await newFamily();
    const customerId = `cus_desc${families}`;
    await receive({
      at: 1,
      householdId: id,
      customerId,
      data: subscription({ discountPercent: 30 }),
    });
    await silent();
    expect((await row(job)).discountPercent).toBe(30);
    await receive({ at: 2, householdId: id, customerId, data: subscription() });
    await silent();
    expect((await row(job)).discountPercent).toBeNull();
  });

  it("checkout e assinatura ligam o plano, e o acesso lê da tabela local", async () => {
    const { id, job } = await newFamily();
    await receive({
      type: "checkout.session.completed",
      at: 0,
      householdId: id,
      customerId: "cus_1",
      data: { kind: "checkout", subscriptionId: `sub_f${families}` },
    });
    await receive({ at: 1, householdId: id, customerId: "cus_1", data: subscription() });
    expect(await silent()).toMatchObject({ applied: 2, waiting: 0 });

    const saved = await row(job);
    expect(saved).toMatchObject({
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: `sub_f${families}`,
      status: "active",
      cycle: "mes",
      courtesy: false,
    });
    expect(saved.items).toEqual([
      { price: PRICES.base, item: "base:200", amount: "19.90", quantity: 1 },
      { price: PRICES.metas, item: "modulo:metas", amount: "6.90", quantity: 1 },
    ]);
    const access = await db.readFamilyAccess(job);
    expect(access).toMatchObject({ mode: "assinatura", entryLimit: 200, messageLimit: 0 });
    expect(domain.canUse(access, "metas")).toBe(true);
    expect(domain.canUse(access, "investimentos")).toBe(false);
  });

  it("evento repetido não chega duas vezes: cada id aplica uma vez", async () => {
    const { id, job } = await newFamily();
    const eventId = await receive({ at: 0, householdId: id, data: subscription() });
    await silent();
    const again = await db
      .recordBillingEvent({
        id: eventId,
        type: "customer.subscription.updated",
        stripeAt: new Date(BASE_TIME),
        livemode: false,
        householdId: id,
        customerId: null,
        data: subscription({ status: "canceled" }),
      })
      .catch(() => "sem permissão nesta conexão");
    expect(again).not.toBe(true);
    await silent();
    expect((await row(job)).status).toBe("active");
  });

  it("evento fora de ordem não desfaz o mais novo", async () => {
    const { id, job } = await newFamily();
    await receive({
      at: 100,
      householdId: id,
      data: subscription({ cancelAtPeriodEnd: true }),
    });
    await silent();
    await receive({ at: 50, householdId: id, data: subscription({ status: "past_due" }) });
    expect(await silent()).toMatchObject({ applied: 1 });
    expect(await row(job)).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
  });

  it("na mesma passada, aplica pela ordem da Stripe, e não pela de chegada", async () => {
    const { id, job } = await newFamily();
    await receive({ at: 20, householdId: id, data: subscription({ status: "active" }) });
    await receive({ at: 10, householdId: id, data: subscription({ status: "incomplete" }) });
    await silent();
    expect((await row(job)).status).toBe("active");
  });

  it("fim de assinatura antiga, atrasado, não derruba a nova", async () => {
    const { id, job } = await newFamily();
    await receive({ at: 10, householdId: id, data: subscription({ status: "canceled" }) });
    await silent();
    await receive({
      at: 20,
      householdId: id,
      data: subscription({
        subscriptionId: `sub_nova${families}`,
        items: [{ price: PRICES.familia, quantity: 1 }],
      }),
    });
    await silent();
    await receive({ at: 30, householdId: id, data: subscription({ status: "canceled" }) });
    await silent();
    expect(await row(job)).toMatchObject({
      stripeSubscriptionId: `sub_nova${families}`,
      status: "active",
    });
  });

  it("primeira cobrança vale uma vez, e fatura zerada não abre os 7 dias", async () => {
    const { id, job } = await newFamily();
    const paid = (at: string, amountPaid: number) => ({
      kind: "invoice_paid",
      subscriptionId: "sub_1",
      paidAt: at,
      amountPaid,
    });
    await receive({
      type: "invoice.paid",
      at: 1,
      householdId: id,
      data: paid("2026-11-02T00:00:00.000Z", 0),
    });
    await silent();
    expect((await row(job)).firstPaidAt).toBeNull();
    await receive({
      type: "invoice.paid",
      at: 2,
      householdId: id,
      data: paid("2026-11-03T00:00:00.000Z", 4490),
    });
    await receive({
      type: "invoice.paid",
      at: 3,
      householdId: id,
      data: paid("2026-12-03T00:00:00.000Z", 4490),
    });
    await silent();
    expect((await row(job)).firstPaidAt).toEqual(new Date("2026-11-03T00:00:00.000Z"));
  });

  it("devolução acha a família pelo cliente, porque a cobrança não traz metadata", async () => {
    const { id, job } = await newFamily();
    const customerId = `cus_devolve${families}`;
    await receive({ at: 0, householdId: id, customerId, data: subscription() });
    await receive({
      type: "charge.refunded",
      at: 1,
      customerId,
      data: { kind: "refund", fully: true },
    });
    expect(await silent()).toMatchObject({ applied: 2 });
    expect((await row(job)).refundedAt).toEqual(new Date(BASE_TIME + 1000));
  });

  it("devolução parcial não marca como devolvido", async () => {
    const { id, job } = await newFamily();
    await receive({
      type: "charge.refunded",
      at: 1,
      householdId: id,
      data: { kind: "refund", fully: false },
    });
    await silent();
    expect((await row(job)).refundedAt).toBeNull();
  });

  it("cobrança que falhou avisa uma vez por dia, e paga limpa o aviso", async () => {
    const { id, job } = await newFamily();
    const failed = { kind: "invoice_failed", subscriptionId: "sub_1" };
    await receive({ type: "invoice.payment_failed", at: 1, householdId: id, data: failed });
    await receive({ type: "invoice.payment_failed", at: 2, householdId: id, data: failed });
    await silent();
    expect((await row(job)).paymentFailedAt).toEqual(new Date(BASE_TIME + 2000));
    const rows = await db.withHousehold(job, (tx) => tx.select().from(householdNotifications));
    expect(rows.map((item) => item.kind)).toEqual(["assinatura_falhou"]);
    await receive({
      type: "invoice.paid",
      at: 3,
      householdId: id,
      data: {
        kind: "invoice_paid",
        subscriptionId: "sub_1",
        paidAt: "2026-11-01T12:00:03.000Z",
        amountPaid: 100,
      },
    });
    await silent();
    expect((await row(job)).paymentFailedAt).toBeNull();
  });

  it("schedule marca a redução, e o fim dele limpa", async () => {
    const { id, job } = await newFamily();
    await receive({ at: 0, householdId: id, data: subscription({ scheduleId: "sub_sched_1" }) });
    await receive({
      type: "subscription_schedule.updated",
      at: 1,
      householdId: id,
      data: {
        kind: "schedule",
        scheduleId: "sub_sched_1",
        next: { items: [{ price: PRICES.base, quantity: 1 }], at: "2026-12-01T12:00:00.000Z" },
      },
    });
    await silent();
    expect(await row(job)).toMatchObject({
      stripeScheduleId: "sub_sched_1",
      scheduledCycle: "mes",
      scheduledAt: new Date("2026-12-01T12:00:00.000Z"),
    });
    expect((await row(job)).scheduledItems?.map((item) => item.item)).toEqual(["base:200"]);
    await receive({
      type: "subscription_schedule.released",
      at: 2,
      householdId: id,
      data: { kind: "schedule", scheduleId: "sub_sched_1", next: null, ended: true },
    });
    await silent();
    expect(await row(job)).toMatchObject({ stripeScheduleId: null, scheduledItems: null });
  });

  it("preço que o catálogo não conhece espera, sem dar acesso errado, e fecha com o código", async () => {
    const { id, job } = await newFamily();
    const eventId = await receive({
      at: 0,
      householdId: id,
      data: subscription({ items: [{ price: "price_novo", quantity: 1 }] }),
    });
    expect(await silent()).toMatchObject({ waiting: 1, applied: 0 });
    expect((await row(job)).status).toBeNull();
    await db.withAdmin("teste", (admin) =>
      admin
        .update(billingEvents)
        .set({ attempts: agents.MAX_EVENT_ATTEMPTS - 1 })
        .where(eq(billingEvents.id, eventId)),
    );
    expect(await silent()).toMatchObject({ closed: 1 });
    const [stored] = await db.withAdmin("teste", (admin) =>
      admin.select().from(billingEvents).where(eq(billingEvents.id, eventId)),
    );
    expect(stored).toMatchObject({ errorCode: "preco_desconhecido" });
    expect(stored?.processedAt).not.toBeNull();
  });

  it("evento sem família espera a próxima passada, e o que chega depois resolve", async () => {
    const { id, job } = await newFamily();
    const customerId = `cus_espera${families}`;
    await receive({
      type: "charge.refunded",
      at: 5,
      customerId,
      data: { kind: "refund", fully: true },
    });
    expect(await silent()).toMatchObject({ waiting: 1 });
    await receive({ at: 6, householdId: id, customerId, data: subscription() });
    await silent();
    await silent();
    expect((await row(job)).refundedAt).not.toBeNull();
  });

  it("evento de família apagada não trava a fila", async () => {
    const eventId = await receive({ at: 0, householdId: "hh-nao-existe", data: subscription() });
    await silent();
    await db.withAdmin("teste", (admin) =>
      admin
        .update(billingEvents)
        .set({ attempts: agents.MAX_EVENT_ATTEMPTS - 1 })
        .where(eq(billingEvents.id, eventId)),
    );
    await silent();
    const [stored] = await db.withAdmin("teste", (admin) =>
      admin.select().from(billingEvents).where(eq(billingEvents.id, eventId)),
    );
    expect(stored?.processedAt).not.toBeNull();
  });

  it("formato inválido fecha na hora, com o código", async () => {
    const eventId = await receive({ at: 0, data: { kind: "desconhecido" } });
    expect(await silent()).toMatchObject({ closed: 1 });
    const [stored] = await db.withAdmin("teste", (admin) =>
      admin.select().from(billingEvents).where(eq(billingEvents.id, eventId)),
    );
    expect(stored?.errorCode).toBe("formato_invalido");
  });
});

describe("eventos no mesmo segundo", () => {
  const SECOND = 500;

  it("`incomplete` nunca sobrescreve `active`, nas duas ordens de id", async () => {
    const { id, job } = await newFamily();
    await receive({ at: SECOND, householdId: id, data: subscription({ status: "active" }) });
    await receive({ at: SECOND, householdId: id, data: subscription({ status: "incomplete" }) });
    await silent();
    expect((await row(job)).status).toBe("active");
    await receive({
      at: SECOND + 10,
      householdId: id,
      data: subscription({ status: "incomplete" }),
    });
    await silent();
    expect((await row(job)).status).toBe("active");
  });

  it("`canceled` ganha, e `updated` depois de `deleted` não reativa", async () => {
    const { id, job } = await newFamily();
    await receive({ at: SECOND, householdId: id, data: subscription({ status: "canceled" }) });
    await receive({ at: SECOND, householdId: id, data: subscription({ status: "active" }) });
    await silent();
    expect((await row(job)).status).toBe("canceled");
    await receive({ at: SECOND + 10, householdId: id, data: subscription({ status: "active" }) });
    await silent();
    expect((await row(job)).status).toBe("canceled");
  });

  it("no mesmo segundo, situação mais adiantada não volta para a anterior", async () => {
    const { id, job } = await newFamily();
    await receive({ at: SECOND, householdId: id, data: subscription({ status: "active" }) });
    await receive({ at: SECOND, householdId: id, data: subscription({ status: "trialing" }) });
    await silent();
    expect((await row(job)).status).toBe("active");
    await receive({ at: SECOND + 10, householdId: id, data: subscription({ status: "trialing" }) });
    await silent();
    expect((await row(job)).status).toBe("trialing");
  });

  it("`active` depois de `incomplete` no mesmo segundo vale", async () => {
    const { id, job } = await newFamily();
    await receive({ at: SECOND, householdId: id, data: subscription({ status: "incomplete" }) });
    await receive({ at: SECOND, householdId: id, data: subscription({ status: "active" }) });
    await silent();
    expect((await row(job)).status).toBe("active");
  });

  const schedule = (scheduleId: string, next: boolean, ended = false) => ({
    kind: "schedule",
    scheduleId,
    next: next
      ? { items: [{ price: PRICES.base, quantity: 1 }], at: "2026-12-01T12:00:00.000Z" }
      : null,
    ended,
  });

  it("no schedule, `next: null` não apaga o `next` do mesmo segundo", async () => {
    const { id, job } = await newFamily();
    const sched = `sub_sched_a${families}`;
    await receive({ at: SECOND, householdId: id, data: subscription({ scheduleId: sched }) });
    await receive({
      type: "subscription_schedule.updated",
      at: SECOND,
      householdId: id,
      data: schedule(sched, true),
    });
    await receive({
      type: "subscription_schedule.created",
      at: SECOND,
      householdId: id,
      data: schedule(sched, false),
    });
    await silent();
    expect((await row(job)).scheduledItems?.map((item) => item.item)).toEqual(["base:200"]);
  });

  it("assinatura sem schedule no mesmo segundo não apaga a troca marcada", async () => {
    const { id, job } = await newFamily();
    const sched = `sub_sched_b${families}`;
    await receive({
      type: "subscription_schedule.updated",
      at: SECOND,
      householdId: id,
      data: schedule(sched, true),
    });
    await receive({ at: SECOND, householdId: id, data: subscription() });
    await silent();
    expect((await row(job)).stripeScheduleId).toBe(sched);
    await receive({ at: SECOND + 10, householdId: id, data: subscription() });
    await silent();
    expect((await row(job)).stripeScheduleId).toBeNull();
  });

  it("schedule que acabou não ressuscita, nem no mesmo segundo", async () => {
    const { id, job } = await newFamily();
    const sched = `sub_sched_c${families}`;
    await receive({
      type: "subscription_schedule.released",
      at: SECOND,
      householdId: id,
      data: schedule(sched, false, true),
    });
    await receive({
      type: "subscription_schedule.updated",
      at: SECOND,
      householdId: id,
      data: schedule(sched, true),
    });
    await silent();
    expect(await row(job)).toMatchObject({ stripeScheduleId: null, scheduledItems: null });
  });
});

describe("assinatura que não entrou", () => {
  it("segunda assinatura paga fica sinalizada, e a primeira segue", async () => {
    const { id, job } = await newFamily();
    await receive({ at: 0, householdId: id, data: subscription() });
    await silent();
    const eventId = await receive({
      at: 10,
      householdId: id,
      data: subscription({ subscriptionId: `sub_dupla${families}` }),
    });
    expect(await silent()).toMatchObject({ duplicates: 1, applied: 0 });
    expect((await row(job)).stripeSubscriptionId).toBe(`sub_f${families}`);
    const [stored] = await db.withAdmin("teste", (admin) =>
      admin.select().from(billingEvents).where(eq(billingEvents.id, eventId)),
    );
    expect(stored).toMatchObject({ errorCode: "assinatura_duplicada" });
    expect(stored?.processedAt).not.toBeNull();
    expect((await db.adminBillingSummary()).events.duplicates).toBeGreaterThanOrEqual(1);
  });
});

describe("lacunas", () => {
  it("cancelamento com preço fora do catálogo aplica, e o acesso acaba", async () => {
    const { id, job } = await newFamily();
    await receive({ at: 0, householdId: id, data: subscription() });
    await silent();
    await receive({
      at: 10,
      householdId: id,
      data: subscription({ status: "canceled", items: [{ price: "price_saiu", quantity: 1 }] }),
    });
    expect(await silent()).toMatchObject({ applied: 1, waiting: 0 });
    const saved = await row(job);
    expect(saved.status).toBe("canceled");
    expect(saved.items.map((item) => item.item)).toEqual(["base:200", "modulo:metas"]);
  });

  it("família sem linha: evento de fatura não tira a cortesia", async () => {
    const { id, job } = await newFamily();
    await db.withAdmin("teste", (admin) =>
      admin.delete(db.householdSubscriptions).where(eq(db.householdSubscriptions.householdId, id)),
    );
    expect((await db.readFamilyAccess(job)).mode).toBe("cortesia");
    await receive({
      type: "invoice.paid",
      at: 1,
      householdId: id,
      data: {
        kind: "invoice_paid",
        subscriptionId: null,
        paidAt: "2026-11-01T12:00:00.000Z",
        amountPaid: 0,
      },
    });
    await silent();
    expect((await db.readFamilyAccess(job)).mode).toBe("cortesia");
  });

  it("família apagada fecha na primeira passada, pelo código que vem em `cause`", async () => {
    const { id } = await newFamily();
    await db.withAdmin("teste", (admin) => admin.delete(household).where(eq(household.id, id)));
    const eventId = await receive({ at: 0, householdId: id, data: subscription() });
    expect(await silent()).toMatchObject({ closed: 1, waiting: 0 });
    const [stored] = await db.withAdmin("teste", (admin) =>
      admin.select().from(billingEvents).where(eq(billingEvents.id, eventId)),
    );
    expect(stored).toMatchObject({ errorCode: "familia_apagada", attempts: 1 });
  });
});

describe("divisão sem o agente de aposentadoria", () => {
  it("dá o mesmo valor real do agente, sem gravar nada", async () => {
    const { id, job } = await newFamily();
    const today = domain.todayIn();
    const month = domain.yearMonthOf(today);
    await db.withWorkerHousehold(id, async (tx) => {
      await tx.insert(db.householdSettings).values({ householdId: id });
      await db.ensureFinanceDefaults(tx, id);
      const [account] = await tx.select({ id: db.accounts.id }).from(db.accounts).limit(1);
      const rows = await tx.select().from(db.categories);
      const income = rows.find((row) => row.kind === "receita")!;
      const expense = rows.find((row) => row.kind === "despesa")!;
      for (const back of [1, 2, 3, 4]) {
        const occurredOn = `${domain.addMonths(month, -back)}-10`;
        const base = { householdId: id, accountId: account!.id, occurredOn };
        await tx.insert(db.transactions).values([
          {
            ...base,
            categoryId: income.id,
            kind: "receita",
            description: "Salário",
            amount: "10000.00",
          },
          {
            ...base,
            categoryId: expense.id,
            kind: "despesa",
            description: "Gasto",
            amount: "3000.00",
          },
        ]);
      }
    });
    const alone = await db.withWorkerHousehold(id, (tx) => agents.currentAllocation(tx, today));
    expect(domain.money(alone.goalsBudget).gt(0)).toBe(true);
    expect(domain.money(alone.tripsBudget).gt(0)).toBe(true);
    const reports = () =>
      db.withHousehold(job, (tx) =>
        tx.select({ id: db.householdReports.id }).from(db.householdReports),
      );
    expect(await reports()).toEqual([]);
    const full = await db.withWorkerHousehold(id, (tx) =>
      agents.runAposentadoriaAgent(tx, { today, householdId: id }),
    );
    expect(alone).toEqual(full.allocation);
  });
});

describe("renovação anual", () => {
  it("avisa uma vez por período, 30 dias antes", async () => {
    const { id, job } = await newFamily();
    const end = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await receive({
      at: 0,
      householdId: id,
      data: subscription({
        subscriptionId: `sub_ano${families}`,
        items: [{ price: PRICES.anual, quantity: 1 }],
        periodEnd: end.toISOString(),
      }),
    });
    await silent();
    expect((await row(job)).cycle).toBe("ano");
    expect(await agents.runBillingRenewals(log)).toBeGreaterThanOrEqual(1);
    await agents.runBillingRenewals(log);
    const rows = await db.withHousehold(job, (tx) => tx.select().from(householdNotifications));
    expect(rows.map((item) => item.kind)).toEqual(["assinatura_renovacao"]);
    expect(rows[0]?.messageKey).toBe("assinaturaRenovacao");
    expect(rows[0]?.href).toBe("/app/assinatura");
  });
});

describe("quem roda", () => {
  const off = domain.resolveAccess({
    billingEnabled: true,
    subscription: {
      courtesy: false,
      courtesyUntil: null,
      trialEndsAt: null,
      status: "active",
      items: [{ price: "p", item: "base:50", amount: "9.90", quantity: 1 }],
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    },
    now: new Date(),
  });
  const expired = domain.resolveAccess({
    billingEnabled: true,
    subscription: {
      courtesy: false,
      courtesyUntil: null,
      trialEndsAt: new Date(0),
      status: null,
      items: [],
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    },
    now: new Date(),
  });

  it("cada agente diário tem módulo definido, e o que vem na Base roda em qualquer plano", () => {
    expect(Object.keys(agents.AGENT_MODULE).toSorted()).toEqual(
      [
        "aposentadoria",
        "categorias",
        "categorias_ia",
        "dividas",
        "investimentos",
        "metas",
        "relatorios",
        "viagens",
      ].toSorted(),
    );
    expect(agents.agentMayRun("categorias", off)).toBe(true);
    expect(agents.agentMayRun("relatorios", off)).toBe(true);
  });

  it("módulo desligado não roda, IA de categorias inclusive", () => {
    for (const agent of [
      "categorias_ia",
      "investimentos",
      "dividas",
      "aposentadoria",
      "viagens",
      "metas",
    ]) {
      expect(agents.agentMayRun(agent, off), agent).toBe(false);
    }
  });

  it("em só leitura nada roda, nem a Base; agente novo sem classificação também não", () => {
    expect(agents.agentMayRun("categorias", expired)).toBe(false);
    expect(agents.agentMayRun("agente_novo", off)).toBe(false);
  });
});
