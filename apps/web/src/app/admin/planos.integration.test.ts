// Painel de planos pelas server actions de verdade, contra um Postgres real, como ou_app e ou_admin. Sessão e cache
// do Next.js simulados; a Stripe é o cliente falso abaixo, e nada aqui chama a API. Dados fictícios.
import { afterAll, afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;
process.env.BETTER_AUTH_URL = "https://app.example.com";

const session = vi.hoisted(() => ({
  ctx: null as unknown,
  user: { id: "", email: "dono@example.com" },
  admin: true,
}));
const gateway = vi.hoisted(() => ({
  createCustomer: vi.fn(async () => "cus_painel_novo"),
  hasLiveSubscription: vi.fn(async () => false),
  expireCheckout: vi.fn(async () => false),
  createCheckout: vi.fn(async () => ({
    id: `cs_painel${Math.random().toString(36).slice(2, 10)}`,
    url: "https://checkout.example.com/sessao",
  })),
  setCancelAtPeriodEnd: vi.fn(async () => undefined),
  refundAndCancel: vi.fn(async () => "devolvido"),
  setDiscount: vi.fn(async () => undefined),
  retryInvoice: vi.fn(async () => "cobrada"),
  createPrice: vi.fn(async () => `price_painel${Math.random().toString(36).slice(2, 10)}`),
}));
vi.mock("@/lib/billing/gateway", () => ({ billingGateway: () => gateway }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("404");
  },
}));
vi.mock("@/lib/session", async () => {
  const { readPlatformFlags } = await import("@organizeup/db");
  return {
    requireTenant: async () => ({ ctx: session.ctx, role: "owner" }),
    requireSession: async () => ({
      user: session.user,
      session: { activeOrganizationId: (session.ctx as TenantContext).householdId },
    }),
    requireAdmin: async () => {
      // Como o portão de verdade: quem não é administrador recebe 404.
      if (!session.admin) throw new Error("404");
      return { user: { id: "admin-painel", email: "admin@example.com" } };
    },
    isServiceAdmin: () => session.admin,
    platformFlags: readPlatformFlags,
  };
});
vi.mock("next-intl/server", () => ({ getLocale: async () => "pt-BR" }));

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const { closeAllPools } = db;
const vip = await import("./vip/actions");
const billing = await import("./assinaturas/actions");
const catalog = await import("./catalogo/actions");
const key = await import("./cobranca/actions");
const plan = await import("@/app/app/(painel)/assinatura/actions");

const { adminAccess, billingCatalog, eq, featureFlags, household, householdMember } = db;
const { householdSubscriptions, user, vipGrants } = db;

const DAY = 24 * 60 * 60 * 1000;

let serial = 0;

async function newFamily() {
  serial += 1;
  const id = `hh-painel-${serial}`;
  const owner = `user-painel-${serial}`;
  await db.withAdmin("seed do painel de planos", async (tx) => {
    await tx.insert(user).values({ id: owner, name: "Teste", email: `${owner}@example.com` });
    await tx.insert(household).values({ id, name: `Família ${serial}`, slug: id });
    await tx
      .insert(householdMember)
      .values({ id: `m-${id}`, organizationId: id, userId: owner, role: "owner" });
  });
  const ctx = await db.fromSession({ user: { id: owner }, session: { activeOrganizationId: id } });
  if (!ctx) throw new Error("sem contexto");
  session.ctx = ctx;
  session.user = { id: owner, email: `${owner}@example.com` };
  return { id, owner, ctx };
}

const setSub = (id: string, values: Partial<typeof householdSubscriptions.$inferInsert>) =>
  db.withAdmin("teste do painel de planos", (tx) =>
    tx.update(householdSubscriptions).set(values).where(eq(householdSubscriptions.householdId, id)),
  );

const subscribed = (id: string, over: Partial<typeof householdSubscriptions.$inferInsert> = {}) =>
  setSub(id, {
    courtesy: false,
    status: "active",
    cycle: "mes",
    stripeCustomerId: `cus_painel${serial}`,
    stripeSubscriptionId: `sub_painel${serial}`,
    items: [{ price: "price_painel_familia", item: "familia", amount: "44.90", quantity: 1 }],
    currentPeriodEnd: new Date(Date.now() + 20 * DAY),
    firstPaidAt: new Date(Date.now() - DAY),
    ...over,
  });

const setBilling = (enabled: boolean) =>
  db.withAdmin("teste do painel de planos", (tx) =>
    tx.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, db.FLAG_KEYS.billing)),
  );

function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    for (const item of [value].flat()) data.append(name, item);
  }
  return data;
}

const vipForm = (householdId: string, over: Record<string, string | string[]> = {}) =>
  form({
    householdId,
    scope: "familia",
    userId: "",
    access: "tudo",
    entryLimit: "",
    messageLimit: "",
    cost: "sem_custo",
    discountPercent: "",
    reason: "parceria",
    endsOn: "",
    ...over,
  });

const grant = (householdId: string, over: Record<string, string | string[]> = {}) =>
  vip.grantVip({ message: null }, vipForm(householdId, over));

const logged = (action: string, target: string) =>
  db.withAdminRead("teste do painel de planos", (tx) =>
    tx
      .select()
      .from(adminAccess)
      .where(db.and(eq(adminAccess.action, action), eq(adminAccess.targetHouseholdId, target))),
  );

beforeEach(() => {
  session.admin = true;
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_painel");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await setBilling(false);
});

afterAll(() => closeAllPools());

describe("quem não é administrador", () => {
  const all = [vip, billing, catalog, key];

  it("toda action responde 404 e nada muda", async () => {
    const family = await newFamily();
    session.admin = false;
    const data = vipForm(family.id, { id: family.id, days: "7", item: "base:50", cycle: "mes" });
    let called = 0;
    for (const actions of all) {
      for (const [name, action] of Object.entries(actions)) {
        if (typeof action !== "function") continue;
        called += 1;
        const run = action as (...args: unknown[]) => Promise<unknown>;
        await expect(
          name === "grantVip" ? run({ message: null }, data) : run(data),
          name,
        ).rejects.toThrow("404");
      }
    }
    expect(called).toBeGreaterThanOrEqual(15);
    session.admin = true;
    const rows = await db.withAdminRead("teste do painel de planos", (tx) =>
      tx.select().from(vipGrants).where(eq(vipGrants.householdId, family.id)),
    );
    expect(rows).toEqual([]);
    expect(gateway.setCancelAtPeriodEnd).not.toHaveBeenCalled();
    expect((await db.readPlatformFlags()).billingEnabled).toBe(false);
  });
});

describe("VIP", () => {
  it("concede e leva para a lista, com a família liberada e sem chamar a Stripe", async () => {
    const family = await newFamily();
    await setSub(family.id, { courtesy: false, trialEndsAt: new Date(Date.now() - DAY) });
    await setBilling(true);
    await expect(grant(family.id)).rejects.toThrow("redirect:/admin/vip");
    expect((await db.readFamilyAccess(family.ctx)).mode).toBe("vip");
    for (const call of Object.values(gateway)) expect(call).not.toHaveBeenCalled();
    expect(await logged("vip:conceder", family.id)).toHaveLength(1);
  });

  it("módulos: sem marcar o assistente, nenhuma mensagem, mesmo que mandem", async () => {
    const family = await newFamily();
    await expect(
      grant(family.id, {
        access: "escolhido",
        modules: ["metas"],
        entryLimit: "200",
        messageLimit: "300",
        currencies: ["USD"],
      }),
    ).rejects.toThrow("redirect");
    const [row] = await db.withHousehold(family.ctx, (tx) => tx.select().from(vipGrants));
    expect(row).toMatchObject({
      fullAccess: false,
      modules: ["metas"],
      entryLimit: 200,
      messageLimit: 0,
      currencies: ["USD"],
    });
  });

  it("recusa com explicação, e sem redirecionar", async () => {
    const family = await newFamily();
    await subscribed(family.id);
    expect((await grant(family.id)).message).toContain("cobrando");
    expect(
      (await grant(family.id, { cost: "desconto", discountPercent: "120" })).message,
    ).toContain("desconto");
    expect((await grant(family.id, { endsOn: "2020-01-01" })).message).toContain("futuro");
    expect((await grant(family.id, { reason: "amigo do João" })).message).toBeTruthy();
    expect((await grant(family.id, { scope: "pessoa", userId: "ninguem" })).message).toContain(
      "responsável",
    );
  });

  it("validade vale o dia inteiro, em Brasília", async () => {
    const family = await newFamily();
    await expect(grant(family.id, { endsOn: "2030-03-10" })).rejects.toThrow("redirect");
    const [row] = await db.withHousehold(family.ctx, (tx) => tx.select().from(vipGrants));
    expect(row?.endsAt?.toISOString()).toBe("2030-03-11T02:59:59.000Z");
  });

  it("família VIP sem custo não abre pagamento: pagaria pelo que ganhou", async () => {
    const family = await newFamily();
    await setSub(family.id, { courtesy: false, trialEndsAt: new Date(Date.now() - DAY) });
    await setBilling(true);
    await expect(grant(family.id)).rejects.toThrow("redirect");
    expect(await plan.subscribe(domain.FAMILY_SELECTION)).toEqual({ ok: false, code: "vip" });
    expect(gateway.createCheckout).not.toHaveBeenCalled();
  });

  it("família com desconto assina pagando menos, já na primeira cobrança", async () => {
    await db.withAdmin("teste do painel de planos", (tx) =>
      tx
        .update(billingCatalog)
        .set({ stripePriceId: "price_painel_familia" })
        .where(
          db.and(
            eq(billingCatalog.item, "familia"),
            eq(billingCatalog.cycle, "mes"),
            eq(billingCatalog.onSale, true),
          ),
        ),
    );
    const family = await newFamily();
    await setSub(family.id, { courtesy: false, trialEndsAt: new Date(Date.now() - DAY) });
    await setBilling(true);
    await expect(grant(family.id, { cost: "desconto", discountPercent: "30" })).rejects.toThrow(
      "redirect",
    );
    expect((await db.readFamilyAccess(family.ctx)).mode).toBe("leitura");
    expect(await plan.subscribe(domain.FAMILY_SELECTION)).toMatchObject({ ok: true });
    expect(gateway.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ discountPercent: 30 }),
    );
  });

  it("remover o VIP não mexe no desconto da Stripe: o preço não sobe sozinho", async () => {
    const family = await newFamily();
    await subscribed(family.id, { discountPercent: 30 });
    await expect(grant(family.id, { cost: "desconto", discountPercent: "30" })).rejects.toThrow(
      "redirect",
    );
    const [row] = await db.withHousehold(family.ctx, (tx) => tx.select().from(vipGrants));
    expect((await vip.revokeVip(form({ id: row!.id }))).ok).toBe(true);
    expect(gateway.setDiscount).not.toHaveBeenCalled();
    expect((await db.readSubscription(family.ctx))?.discountPercent).toBe(30);
  });
});

describe("ações na Stripe", () => {
  const stripeActions = [
    ["cancelar", billing.cancelSubscription, {}],
    ["devolver", billing.refundSubscription, { confirm: "DEVOLVER" }],
    ["reenviar", billing.retryCharge, {}],
    ["aplicar desconto", billing.applyDiscount, {}],
    ["tirar desconto", billing.removeDiscount, {}],
  ] as const;

  it.each(stripeActions)(
    "%s: indisponível com a cobrança desligada",
    async (_name, action, extra) => {
      const family = await newFamily();
      await subscribed(family.id);
      const result = await action(form({ id: family.id, ...extra }));
      expect(result).toMatchObject({ ok: false });
      expect(result.message).toContain("desligada");
      for (const call of Object.values(gateway)) expect(call).not.toHaveBeenCalled();
    },
  );

  it.each(stripeActions)("%s: indisponível sem chave da Stripe", async (_name, action, extra) => {
    const family = await newFamily();
    await subscribed(family.id);
    await setBilling(true);
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const result = await action(form({ id: family.id, ...extra }));
    expect(result.message).toContain("STRIPE_SECRET_KEY");
    for (const call of Object.values(gateway)) expect(call).not.toHaveBeenCalled();
  });

  it("cancelar vai para a Stripe e fica na auditoria, sem gravar no plano", async () => {
    const family = await newFamily();
    await subscribed(family.id);
    await setBilling(true);
    const before = await db.readSubscription(family.ctx);
    expect((await billing.cancelSubscription(form({ id: family.id }))).ok).toBe(true);
    expect(gateway.setCancelAtPeriodEnd).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: family.id, cancel: true }),
    );
    expect(await logged("assinatura:cancelar", family.id)).toHaveLength(1);
    expect(await db.readSubscription(family.ctx)).toEqual(before);
  });

  it("falhar na Stripe fica registrado, com mensagem curta", async () => {
    const family = await newFamily();
    await subscribed(family.id);
    await setBilling(true);
    gateway.setCancelAtPeriodEnd.mockRejectedValueOnce(new Error("card_declined pessoa@example"));
    const result = await billing.cancelSubscription(form({ id: family.id }));
    expect(result).toEqual({ ok: false, message: expect.not.stringContaining("example") });
    expect(await logged("assinatura:cancelar_falhou", family.id)).toHaveLength(1);
  });

  it("devolver exige o texto e os 7 dias; boleto não encerra nada", async () => {
    const family = await newFamily();
    await subscribed(family.id);
    await setBilling(true);
    const data = form({ id: family.id, confirm: "DEVOLVER" });
    expect((await billing.refundSubscription(form({ id: family.id }))).ok).toBe(false);
    expect(gateway.refundAndCancel).not.toHaveBeenCalled();

    gateway.refundAndCancel.mockResolvedValueOnce("boleto");
    expect((await billing.refundSubscription(data)).message).toContain("Boleto");

    expect((await billing.refundSubscription(data)).ok).toBe(true);

    await setSub(family.id, { firstPaidAt: new Date(Date.now() - 8 * DAY) });
    gateway.refundAndCancel.mockClear();
    expect((await billing.refundSubscription(data)).ok).toBe(false);
    expect(gateway.refundAndCancel).not.toHaveBeenCalled();
  });

  it("reenviar diz quando não há nada em aberto", async () => {
    const family = await newFamily();
    await subscribed(family.id, { status: "past_due" });
    await setBilling(true);
    expect((await billing.retryCharge(form({ id: family.id }))).ok).toBe(true);
    gateway.retryInvoice.mockResolvedValueOnce("nada_em_aberto");
    expect((await billing.retryCharge(form({ id: family.id }))).ok).toBe(false);
  });

  it("aplica o desconto do VIP que vale, e tira só por ação explícita", async () => {
    const family = await newFamily();
    await subscribed(family.id);
    await setBilling(true);
    expect((await billing.applyDiscount(form({ id: family.id }))).ok).toBe(false);
    await expect(grant(family.id, { cost: "desconto", discountPercent: "15" })).rejects.toThrow(
      "redirect",
    );
    expect((await billing.applyDiscount(form({ id: family.id }))).ok).toBe(true);
    expect(gateway.setDiscount).toHaveBeenLastCalledWith(
      expect.objectContaining({ householdId: family.id, percent: 15 }),
    );
    expect((await billing.removeDiscount(form({ id: family.id }))).ok).toBe(true);
    expect(gateway.setDiscount).toHaveBeenLastCalledWith(
      expect.objectContaining({ percent: null }),
    );
  });

  it("sem assinatura não há o que operar", async () => {
    const family = await newFamily();
    await setBilling(true);
    const result = await billing.cancelSubscription(form({ id: family.id }));
    expect(result.message).toContain("não tem assinatura");
  });
});

describe("dias de teste e cortesia pela action", () => {
  it("dias fora da faixa não passam, e cortesia recusa quem a Stripe cobra", async () => {
    const family = await newFamily();
    expect((await billing.giveTrialDays(form({ id: family.id, days: "0" }))).ok).toBe(false);
    expect((await billing.giveTrialDays(form({ id: family.id, days: "91" }))).ok).toBe(false);
    expect((await billing.giveTrialDays(form({ id: family.id, days: "9" }))).ok).toBe(true);
    await subscribed(family.id);
    expect((await billing.giveCourtesy(form({ id: family.id, until: "" }))).message).toContain(
      "cobrando",
    );
  });
});

describe("catálogo pela action", () => {
  const line = { item: "modulo:investimentos", cycle: "ano" };

  it("aceita vírgula, recusa valor estranho e abaixo do mínimo", async () => {
    expect((await catalog.setPrice(form({ ...line, amount: "abc" }))).ok).toBe(false);
    expect((await catalog.setPrice(form({ ...line, amount: "0,10" }))).ok).toBe(false);
    expect((await catalog.setPrice(form({ ...line, amount: "101,50" }))).ok).toBe(true);
    const sold = await db.readBillingCatalog();
    expect(sold.find((row) => row.item === line.item && row.cycle === line.cycle)?.amount).toBe(
      "101.50",
    );
  });

  it("criar na Stripe só por clique, e grava o id uma vez", async () => {
    await catalog.setPrice(form({ ...line, amount: "102,50" }));
    expect(gateway.createPrice).not.toHaveBeenCalled();
    const row = (await db.adminCatalog()).find(
      (item) => item.item === line.item && item.cycle === line.cycle && item.onSale,
    )!;
    expect(row.hasStripePrice).toBe(false);
    expect((await catalog.createStripePrice(form({ id: row.id }))).ok).toBe(true);
    expect(gateway.createPrice).toHaveBeenCalledTimes(1);
    expect((await catalog.createStripePrice(form({ id: row.id }))).ok).toBe(false);
    expect(gateway.createPrice).toHaveBeenCalledTimes(1);
  });

  it("sem chave, criar na Stripe fica indisponível, com o motivo", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const result = await catalog.createStripePrice(form({ id: "qualquer" }));
    expect(result.message).toContain("STRIPE_SECRET_KEY");
    expect(gateway.createPrice).not.toHaveBeenCalled();
  });

  it("contas conectadas: nem à venda, nem preço na Stripe, e a tela explica", async () => {
    const item = { item: domain.CONNECTED_ITEM, cycle: "mes" };
    const sale = await catalog.setSale(form({ ...item, enabled: "true" }));
    expect(sale.ok).toBe(false);
    expect(sale.message).toContain("conexão com bancos");
    const row = (await db.adminCatalog()).find((entry) => entry.item === domain.CONNECTED_ITEM)!;
    expect((await catalog.createStripePrice(form({ id: row.id }))).ok).toBe(false);
    expect(gateway.createPrice).not.toHaveBeenCalled();
    const annual = await catalog.setPrice(
      form({ item: domain.CONNECTED_ITEM, cycle: "ano", amount: "199,00" }),
    );
    expect(annual.message).toContain("anual");
  });

  it("ligar e desligar a venda ficam na auditoria", async () => {
    const off = form({ item: "moeda:EUR", cycle: "ano", enabled: "false" });
    expect((await catalog.setSale(off)).ok).toBe(true);
    const on = form({ item: "moeda:EUR", cycle: "ano", enabled: "true" });
    expect((await catalog.setSale(on)).ok).toBe(true);
    const rows = await db.adminAccessList({ actions: ["catalogo:vender", "catalogo:parar"] });
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe("chave da cobrança", () => {
  it("ligar pede o texto exato, confere de novo no servidor e fica na auditoria", async () => {
    expect((await key.enableBilling(form({ confirm: "ligar" }))).ok).toBe(false);
    expect((await db.readPlatformFlags()).billingEnabled).toBe(false);
    expect((await key.enableBilling(form({ confirm: "LIGAR COBRANCA" }))).ok).toBe(true);
    expect((await db.readPlatformFlags()).billingEnabled).toBe(true);
    const rows = await db.adminAccessList({ actions: ["cobranca:ligar"] });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect((await key.disableBilling(form({}))).ok).toBe(true);
    expect((await db.readPlatformFlags()).billingEnabled).toBe(false);
    expect((await db.adminAccessList({ actions: ["cobranca:desligar"] })).length).toBeGreaterThan(
      0,
    );
  });

  it("sem chave da Stripe, ou de produção sem a variável, não liga", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect((await key.enableBilling(form({ confirm: "LIGAR COBRANCA" }))).ok).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_painel");
    const refused = await key.enableBilling(form({ confirm: "LIGAR COBRANCA" }));
    expect(refused.message).toContain("STRIPE_ALLOW_LIVE");
    expect((await db.readPlatformFlags()).billingEnabled).toBe(false);
  });
});
