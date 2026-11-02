// VIP e painel de planos (ADR-0025) contra um Postgres real: a família lê pela conexão ou_app com RLS, e o painel
// grava como ou_admin. Dados fictícios.
import { afterAll, afterEach, describe, expect, inject, it } from "vitest";
import postgres from "postgres";
import type { VipGrantInput } from "../src/index";

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("../src/index");
const { closeAllPools } = await import("../src/client");
const domain = await import("@organizeup/domain");

const { adminAccess, billingCatalog, eq, featureFlags, household, householdMember } = db;
const { householdSubscriptions, user, vipGrants } = db;

const DAY = 24 * 60 * 60 * 1000;
const admin = { adminUserId: "admin-vip" };

let serial = 0;

/** Agora, no relógio do banco. */
const databaseNow = (ctx: Parameters<typeof db.withHousehold>[0]) =>
  db.withHousehold(ctx, async (tx) => {
    const rows = await tx.execute<{ ms: number }>(
      db.sql`select (extract(epoch from now()) * 1000)::float8 as ms`,
    );
    return Number(rows[0]!.ms);
  });

async function newFamily(members: Array<{ userId: string; role: string }> = []) {
  serial += 1;
  const id = `hh-vip-${serial}`;
  const owner = `user-vip-${serial}`;
  await db.withAdmin("seed do teste de VIP", async (tx) => {
    await tx.insert(user).values({ id: owner, name: "Teste", email: `${owner}@example.com` });
    await tx.insert(household).values({ id, name: `Família ${serial}`, slug: id });
    await tx
      .insert(householdMember)
      .values({ id: `m-${id}`, organizationId: id, userId: owner, role: "owner" });
    for (const member of members) {
      await tx.insert(householdMember).values({
        id: `m-${id}-${member.userId}`,
        organizationId: id,
        userId: member.userId,
        role: member.role,
      });
    }
  });
  const ctx = await db.fromSession({ user: { id: owner }, session: { activeOrganizationId: id } });
  if (!ctx) throw new Error("sem contexto");
  return { id, owner, ctx };
}

async function newUser() {
  serial += 1;
  const id = `user-vip-${serial}`;
  await db.withAdmin("seed do teste de VIP", (tx) =>
    tx.insert(user).values({ id, name: "Teste", email: `${id}@example.com` }),
  );
  return id;
}

async function setBilling(enabled: boolean) {
  await db.withAdmin("teste de VIP: chave", (tx) =>
    tx.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, db.FLAG_KEYS.billing)),
  );
}

const setSub = (id: string, values: Partial<typeof householdSubscriptions.$inferInsert>) =>
  db.withAdmin("teste de VIP: assinatura", (tx) =>
    tx.update(householdSubscriptions).set(values).where(eq(householdSubscriptions.householdId, id)),
  );

/** Teste vencido e sem assinatura: a família só lê. */
const expireTrial = (id: string) =>
  setSub(id, { courtesy: false, trialEndsAt: new Date(Date.now() - DAY) });

const grant = (householdId: string, over: Partial<VipGrantInput> = {}): VipGrantInput => ({
  householdId,
  scope: "familia",
  userId: null,
  full: true,
  modules: [],
  entryLimit: null,
  messageLimit: null,
  currencies: [],
  cost: "sem_custo",
  discountPercent: null,
  reason: "parceria",
  endsAt: null,
  ...over,
});

const rowsOf = (id: string) =>
  db.withAdminRead("teste de VIP", (tx) =>
    tx.select().from(vipGrants).where(eq(vipGrants.householdId, id)),
  );

const logged = (action: string, target: string) =>
  db.withAdminRead("teste de VIP", (tx) =>
    tx
      .select()
      .from(adminAccess)
      .where(db.and(eq(adminAccess.action, action), eq(adminAccess.targetHouseholdId, target))),
  );

const catalogBefore = await db.withAdminRead("teste de VIP: catálogo de antes", (tx) =>
  tx.select().from(billingCatalog),
);

/** O banco é o mesmo dos outros arquivos, e eles contam as linhas do catálogo. */
async function restoreCatalog() {
  await db.withAdmin("teste de VIP: devolve o catálogo", async (tx) => {
    const ids = catalogBefore.map((row) => row.id);
    await tx.delete(billingCatalog).where(db.notInArray(billingCatalog.id, ids));
    for (const { id, onSale, stripePriceId } of catalogBefore) {
      await tx
        .update(billingCatalog)
        .set({ onSale, stripePriceId })
        .where(eq(billingCatalog.id, id));
    }
  });
}

afterEach(() => setBilling(false));
afterAll(async () => {
  await restoreCatalog();
  await closeAllPools();
});

describe("quem grava", () => {
  it("nem o responsável nem o worker gravam VIP: nem pela RLS, nem cru", async () => {
    const family = await newFamily();
    const values = { householdId: family.id, scope: "familia" as const };
    const row = { ...values, cost: "sem_custo" as const, reason: "parceria", grantedBy: "x" };
    await expect(
      db.withHousehold(family.ctx, (tx) => tx.insert(vipGrants).values(row)),
    ).rejects.toThrow();
    await expect(
      db.withWorkerHousehold(family.id, (tx) => tx.insert(vipGrants).values(row)),
    ).rejects.toThrow();
    for (const url of [urls.app, urls.worker]) {
      const raw = postgres(url, { max: 1, onnotice: () => {} });
      try {
        await expect(
          raw`insert into vip_grants (household_id, scope, cost, reason, granted_by)
              values (${family.id}, 'familia', 'sem_custo', 'parceria', 'x')`,
        ).rejects.toThrow();
        await expect(raw`update vip_grants set revoked_at = now()`).rejects.toThrow();
        await expect(raw`delete from vip_grants`).rejects.toThrow();
      } finally {
        await raw.end();
      }
    }
  });

  it("nem o painel apaga: remover é marcar", async () => {
    const raw = postgres(urls.admin, { max: 1, onnotice: () => {} });
    try {
      await expect(raw`delete from vip_grants`).rejects.toThrow();
    } finally {
      await raw.end();
    }
  });

  it("nem a família nem o worker gravam no catálogo", async () => {
    for (const url of [urls.app, urls.worker]) {
      const raw = postgres(url, { max: 1, onnotice: () => {} });
      try {
        await expect(
          raw`insert into billing_catalog (item, cycle, amount) values ('base:50', 'mes', 1)`,
        ).rejects.toThrow();
        await expect(raw`update billing_catalog set on_sale = true`).rejects.toThrow();
      } finally {
        await raw.end();
      }
    }
  });
});

describe("VIP sem custo com a chave ligada", () => {
  it("libera quem só leria, sem tocar na assinatura e sem nada da Stripe", async () => {
    const family = await newFamily();
    await expireTrial(family.id);
    await setBilling(true);
    expect((await db.readFamilyAccess(family.ctx)).mode).toBe("leitura");
    const before = await db.readSubscription(family.ctx);

    expect(await db.adminGrantVip(admin, grant(family.id))).toBe("ok");

    const access = await db.readFamilyAccess(family.ctx);
    expect(access.mode).toBe("vip");
    expect(domain.canUse(access, "investimentos")).toBe(true);
    expect(access.entryLimit).toBeNull();
    const after = await db.readSubscription(family.ctx);
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      status: null,
      items: [],
    });
  });

  it("o acesso é o mesmo dentro de uma transação e no worker", async () => {
    const family = await newFamily();
    await expireTrial(family.id);
    await setBilling(true);
    await db.adminGrantVip(admin, grant(family.id));
    const inside = await db.withHousehold(family.ctx, (tx) => db.accessWithin(tx));
    expect(inside.mode).toBe("vip");
    const worker = await db.readFamilyAccess(db.fromJob({ householdId: family.id }));
    expect(worker.mode).toBe("vip");
  });

  it("módulos e limites escolhidos: só o que foi dado", async () => {
    const family = await newFamily();
    await expireTrial(family.id);
    await setBilling(true);
    await db.adminGrantVip(
      admin,
      grant(family.id, { full: false, modules: ["metas"], entryLimit: 200, messageLimit: 0 }),
    );
    const access = await db.readFamilyAccess(family.ctx);
    expect(access.modules).toEqual(["metas"]);
    expect(access.entryLimit).toBe(200);
    expect(domain.canUse(access, "dividas")).toBe(false);
  });

  it("família comum nada ganha com o VIP de outra", async () => {
    const vip = await newFamily();
    const common = await newFamily();
    await expireTrial(vip.id);
    await expireTrial(common.id);
    await setBilling(true);
    await db.adminGrantVip(admin, grant(vip.id));

    const access = await db.readFamilyAccess(common.ctx);
    expect(access.mode).toBe("leitura");
    expect(access.modules).toEqual([]);
    expect(access.vip).toBeNull();
    const seen = await db.withHousehold(common.ctx, (tx) => tx.select().from(vipGrants));
    expect(seen).toEqual([]);
    const mine = await db.withHousehold(vip.ctx, (tx) => tx.select().from(vipGrants));
    expect(mine.map((row) => row.householdId)).toEqual([vip.id]);
  });

  it("com a chave desligada, nada muda para ninguém", async () => {
    const family = await newFamily();
    await db.adminGrantVip(admin, grant(family.id));
    const access = await db.readFamilyAccess(family.ctx);
    expect(access.mode).toBe("livre");
    expect(access.vip).toBeNull();
  });

  it("a Stripe cobrando: recusa até a assinatura estar marcada para acabar", async () => {
    const family = await newFamily();
    await setSub(family.id, {
      courtesy: false,
      status: "active",
      cycle: "mes",
      items: [{ price: "price_v", item: "base:50", amount: "9.90", quantity: 1 }],
    });
    expect(await db.adminGrantVip(admin, grant(family.id))).toBe("assinatura_viva");
    expect(await logged("vip:conceder", family.id)).toEqual([]);
    expect(await db.adminSetCourtesy(admin, family.id, null)).toBe("assinatura_viva");

    // Com desconto a assinatura continua: é o caminho certo.
    expect(
      await db.adminGrantVip(admin, grant(family.id, { cost: "desconto", discountPercent: 20 })),
    ).toBe("ok");
    const [open] = await rowsOf(family.id);
    await db.adminRevokeVip(admin, open!.id);

    await setSub(family.id, { cancelAtPeriodEnd: true });
    expect(await db.adminGrantVip(admin, grant(family.id))).toBe("ok");
  });
});

describe("recusa quando a Stripe ainda pode cobrar", () => {
  it.each(["active", "past_due", "incomplete", "unpaid"])(
    "%s: nem VIP sem custo, nem cortesia",
    async (status) => {
      const family = await newFamily();
      await setSub(family.id, { courtesy: false, status });
      expect(await db.adminGrantVip(admin, grant(family.id))).toBe("assinatura_viva");
      expect(await db.adminSetCourtesy(admin, family.id, null)).toBe("assinatura_viva");
    },
  );

  it("validade não reabre VIP sem custo de quem passou a pagar", async () => {
    const family = await newFamily();
    await setSub(family.id, { courtesy: false });
    await db.adminGrantVip(admin, grant(family.id, { endsAt: new Date(Date.now() + DAY) }));
    await setSub(family.id, { status: "active" });
    const [row] = await rowsOf(family.id);
    expect(await db.adminExtendVip(admin, row!.id, null)).toBe("assinatura_viva");
    expect((await rowsOf(family.id))[0]?.endsAt).not.toBeNull();
    expect(await logged("vip:validade", family.id)).toEqual([]);
  });

  it("com desconto a validade muda: a assinatura é o caminho dele", async () => {
    const family = await newFamily();
    await setSub(family.id, { courtesy: false, status: "active" });
    await db.adminGrantVip(admin, grant(family.id, { cost: "desconto", discountPercent: 20 }));
    const [row] = await rowsOf(family.id);
    expect(await db.adminExtendVip(admin, row!.id, new Date(Date.now() + DAY))).toBe("ok");
  });
});

describe("concessão ao mesmo tempo", () => {
  it("oito pedidos: um entra, os outros dizem que já há VIP, e a auditoria tem um só", async () => {
    const family = await newFamily();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => db.adminGrantVip(admin, grant(family.id))),
    );
    expect(results.filter((result) => result === "ok")).toHaveLength(1);
    expect(results.filter((result) => result === "ja_vip")).toHaveLength(7);
    expect(await rowsOf(family.id)).toHaveLength(1);
    expect(await logged("vip:conceder", family.id)).toHaveLength(1);
  });
});

describe("fim do VIP", () => {
  it("vencer volta ao estado anterior, sem apagar nada e sem cobrança", async () => {
    const family = await newFamily();
    await expireTrial(family.id);
    await setBilling(true);
    const before = await db.readSubscription(family.ctx);
    const endsAt = new Date(Date.now() + 2 * DAY);
    await db.adminGrantVip(admin, grant(family.id, { endsAt }));
    expect((await db.readFamilyAccess(family.ctx)).mode).toBe("vip");

    const later = new Date(Date.now() + 3 * DAY);
    const access = await db.readFamilyAccess(family.ctx, undefined, later);
    expect(access.mode).toBe("leitura");
    expect(access.vip).toBeNull();
    expect(await db.readSubscription(family.ctx)).toEqual(before);
    expect(await rowsOf(family.id)).toHaveLength(1);
  });

  it("concessão vencida não segura a próxima, e fica guardada", async () => {
    const family = await newFamily();
    await db.adminGrantVip(admin, grant(family.id, { endsAt: new Date(Date.now() + DAY) }));
    await db.withAdmin("teste de VIP: vencer", (tx) =>
      tx
        .update(vipGrants)
        .set({ endsAt: new Date(Date.now() - DAY) })
        .where(eq(vipGrants.householdId, family.id)),
    );
    expect(await db.adminGrantVip(admin, grant(family.id))).toBe("ok");
    const rows = await rowsOf(family.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.revokedAt)).toHaveLength(1);
    expect(rows.find((row) => row.revokedAt)?.revokedBy).toBe("validade");
  });

  it("remover fica na auditoria, com quem e quando, e a linha continua", async () => {
    const family = await newFamily();
    await expireTrial(family.id);
    await setBilling(true);
    await db.adminGrantVip(admin, grant(family.id));
    const [row] = await rowsOf(family.id);
    expect(await db.adminRevokeVip(admin, row!.id)).toBe("ok");
    expect(await db.adminRevokeVip(admin, row!.id)).toBe("not_found");
    expect((await db.readFamilyAccess(family.ctx)).mode).toBe("leitura");
    const [kept] = await rowsOf(family.id);
    expect(kept).toMatchObject({ revokedBy: admin.adminUserId });
    expect(await logged("vip:conceder", family.id)).toHaveLength(1);
    expect(await logged("vip:remover", family.id)).toHaveLength(1);
  });

  it("mudar a validade fica na auditoria", async () => {
    const family = await newFamily();
    await db.adminGrantVip(admin, grant(family.id));
    const [row] = await rowsOf(family.id);
    const endsAt = new Date(Date.now() + 40 * DAY);
    expect(await db.adminExtendVip(admin, row!.id, endsAt)).toBe("ok");
    expect((await rowsOf(family.id))[0]?.endsAt).toEqual(endsAt);
    expect(await logged("vip:validade", family.id)).toHaveLength(1);
  });

  it("a lista diz quem vence em breve, quem venceu e quem foi removido", async () => {
    const soon = await newFamily();
    const later = await newFamily();
    await db.adminGrantVip(admin, grant(soon.id, { endsAt: new Date(Date.now() + 5 * DAY) }));
    await db.adminGrantVip(admin, grant(later.id, { endsAt: new Date(Date.now() + 90 * DAY) }));
    const list = await db.adminVipList();
    const status = (id: string) => list.find((row) => row.grant.householdId === id)?.status;
    expect(status(soon.id)).toBe("vencendo");
    expect(status(later.id)).toBe("ativo");
    const expired = await db.adminVipList(new Date(Date.now() + 6 * DAY));
    expect(expired.find((row) => row.grant.householdId === soon.id)?.status).toBe("vencido");
  });
});

describe("VIP de pessoa", () => {
  it("vale para a família de que ela é responsável, para todos os membros", async () => {
    const family = await newFamily();
    await expireTrial(family.id);
    await setBilling(true);
    expect(
      await db.adminGrantVip(admin, grant(family.id, { scope: "pessoa", userId: family.owner })),
    ).toBe("ok");
    expect((await db.readFamilyAccess(family.ctx)).mode).toBe("vip");
  });

  it("quem é só membro não passa VIP para a família", async () => {
    const member = await newUser();
    const family = await newFamily([{ userId: member, role: "adult" }]);
    expect(
      await db.adminGrantVip(admin, grant(family.id, { scope: "pessoa", userId: member })),
    ).toBe("nao_responsavel");
    expect(await rowsOf(family.id)).toEqual([]);
    expect(await logged("vip:conceder", family.id)).toEqual([]);
  });

  it("não segue a pessoa para outra família", async () => {
    const family = await newFamily();
    const other = await newFamily([]);
    await db.withAdmin("seed do teste de VIP", (tx) =>
      tx.insert(householdMember).values({
        id: `m-extra-${other.id}`,
        organizationId: other.id,
        userId: family.owner,
        role: "owner",
      }),
    );
    await expireTrial(other.id);
    await setBilling(true);
    await db.adminGrantVip(admin, grant(family.id, { scope: "pessoa", userId: family.owner }));
    expect((await db.readFamilyAccess(other.ctx)).mode).toBe("leitura");
    expect(await db.adminOwnedFamilies(family.owner)).toHaveLength(2);
  });

  it("deixando de ser responsável, para de valer e a família volta ao que era", async () => {
    const family = await newFamily();
    await expireTrial(family.id);
    await setBilling(true);
    await db.adminGrantVip(admin, grant(family.id, { scope: "pessoa", userId: family.owner }));
    await db.withAdmin("teste: troca de papel", (tx) =>
      tx
        .update(householdMember)
        .set({ role: "adult" })
        .where(eq(householdMember.organizationId, family.id)),
    );
    const job = db.fromJob({ householdId: family.id });
    expect((await db.readFamilyAccess(job)).mode).toBe("leitura");
    const list = await db.adminVipList();
    expect(list.find((row) => row.grant.householdId === family.id)?.status).toBe("sem_responsavel");
  });

  it("conta apagada: o vínculo some, e nunca vira VIP da família", async () => {
    const family = await newFamily();
    const person = await newUser();
    await db.withAdmin("seed do teste de VIP", (tx) =>
      tx.insert(householdMember).values({
        id: `m-dono-${person}`,
        organizationId: family.id,
        userId: person,
        role: "owner",
      }),
    );
    await db.adminGrantVip(admin, grant(family.id, { scope: "pessoa", userId: person }));
    await expireTrial(family.id);
    await setBilling(true);
    expect((await db.readFamilyAccess(db.fromJob({ householdId: family.id }))).mode).toBe("vip");
    const raw = postgres(urls.app, { max: 1, onnotice: () => {} });
    try {
      await raw`delete from "user" where id = ${person}`;
    } finally {
      await raw.end();
    }
    const [row] = await rowsOf(family.id);
    expect(row).toMatchObject({ scope: "pessoa", userId: null });
    expect((await db.readFamilyAccess(db.fromJob({ householdId: family.id }))).mode).toBe(
      "leitura",
    );
  });
});

describe("regras do painel", () => {
  it("ninguém concede a si mesmo: recusa, e não aparece como feito na auditoria", async () => {
    const family = await newFamily();
    const self = { adminUserId: family.owner };
    expect(await db.adminGrantVip(self, grant(family.id))).toBe("own_family");
    expect(await db.adminGrantTrialDays(self, family.id, 7)).toBe("own_family");
    expect(await db.adminSetCourtesy(self, family.id, null)).toBe("own_family");
    expect(await logged("vip:conceder", family.id)).toEqual([]);
    expect(await rowsOf(family.id)).toEqual([]);
  });

  it("quem participa da família não opera a Stripe dela, nem remove o VIP dela", async () => {
    const family = await newFamily();
    const self = { adminUserId: family.owner };
    await setSub(family.id, {
      stripeCustomerId: `cus_self${serial}`,
      stripeSubscriptionId: `sub_self${serial}`,
    });
    expect(await db.adminStripeTarget(self, family.id)).toBe("own_family");
    expect(await db.adminGrantVip(admin, grant(family.id))).toBe("ok");
    const [row] = await rowsOf(family.id);
    expect(await db.adminRevokeVip(self, row!.id)).toBe("own_family");
    expect((await rowsOf(family.id))[0]?.revokedAt).toBeNull();
    expect(await logged("vip:remover", family.id)).toEqual([]);
  });

  it("família que não existe", async () => {
    expect(await db.adminGrantVip(admin, grant("hh-nao-existe"))).toBe("not_found");
    expect(await db.adminGrantTrialDays(admin, "hh-nao-existe", 7)).toBe("not_found");
  });

  it("apagar a família leva a concessão junto, pela conexão da aplicação", async () => {
    const family = await newFamily();
    await db.adminGrantVip(admin, grant(family.id));
    const raw = postgres(urls.app, { max: 1, onnotice: () => {} });
    try {
      await raw`delete from household where id = ${family.id}`;
    } finally {
      await raw.end();
    }
    expect(await rowsOf(family.id)).toEqual([]);
  });

  it("exportar traz a concessão da própria família", async () => {
    const family = await newFamily();
    await db.adminGrantVip(admin, grant(family.id));
    const exported = await db.withHousehold(family.ctx, (tx) => db.exportHousehold(tx));
    expect(exported.vip_grants).toHaveLength(1);
  });
});

describe("dias de teste e cortesia", () => {
  it("soma dias a quem só lê, e a família volta a usar", async () => {
    const family = await newFamily();
    await expireTrial(family.id);
    await setBilling(true);
    expect(await db.adminGrantTrialDays(admin, family.id, 10)).toBe("ok");
    const access = await db.readFamilyAccess(family.ctx);
    expect(access.mode).toBe("teste");
    expect(await logged("assinatura:dias_teste", family.id)).toHaveLength(1);
    // Só o relógio do banco: o fim do teste nasce nele, e o do Node pode estar atrás.
    const left = access.trialEndsAt!.getTime() - (await databaseNow(family.ctx));
    expect(left).toBeGreaterThan(9.9 * DAY);
    expect(left).toBeLessThanOrEqual(10 * DAY);
  });

  it("soma ao fim do teste que ainda corre", async () => {
    const family = await newFamily();
    const end = new Date(Date.now() + 5 * DAY);
    await setSub(family.id, { courtesy: false, trialEndsAt: end });
    await db.adminGrantTrialDays(admin, family.id, 3);
    const row = await db.readSubscription(family.ctx);
    expect(row!.trialEndsAt!.getTime() - end.getTime()).toBe(3 * DAY);
  });

  it("cortesia com data acaba sozinha, e encerrar fica na auditoria", async () => {
    const family = await newFamily();
    await expireTrial(family.id);
    await setBilling(true);
    const until = new Date(Date.now() + 2 * DAY);
    expect(await db.adminSetCourtesy(admin, family.id, until)).toBe("ok");
    expect((await db.readFamilyAccess(family.ctx)).mode).toBe("cortesia");
    const later = new Date(Date.now() + 3 * DAY);
    expect((await db.readFamilyAccess(family.ctx, undefined, later)).mode).toBe("leitura");
    expect(await db.adminEndCourtesy(admin, family.id)).toBe("ok");
    expect((await db.readFamilyAccess(family.ctx)).mode).toBe("leitura");
    expect(await logged("assinatura:cortesia_fim", family.id)).toHaveLength(1);
  });
});

describe("catálogo", () => {
  const onSale = (item: string, cycle: "mes" | "ano") =>
    db.withAdminRead("teste de catálogo", (tx) =>
      tx
        .select()
        .from(billingCatalog)
        .where(
          db.and(
            eq(billingCatalog.item, item),
            eq(billingCatalog.cycle, cycle),
            eq(billingCatalog.onSale, true),
          ),
        ),
    );

  it("preço novo é linha nova: a antiga fica, e quem assinou por ela continua nela", async () => {
    const [old] = await onSale("modulo:metas", "mes");
    await db.withAdmin("teste de catálogo", (tx) =>
      tx
        .update(billingCatalog)
        .set({ stripePriceId: "price_metas_antigo" })
        .where(eq(billingCatalog.id, old!.id)),
    );
    expect(
      await db.adminNewPrice(admin, {
        item: "modulo:metas",
        cycle: "mes",
        amount: "8.90",
        basedOn: old!.id,
      }),
    ).toBe("ok");
    const [current] = await onSale("modulo:metas", "mes");
    expect(current).toMatchObject({ amount: "8.90", stripePriceId: null });
    expect(current!.id).not.toBe(old!.id);

    const book = await db.priceBook();
    expect(book.get("price_metas_antigo")).toMatchObject({ amount: "6.90", item: "modulo:metas" });
    const quote = domain.quotePlan(
      { ...domain.FAMILY_SELECTION, family: false, modules: ["metas"], entries: "50", messages: 0 },
      await db.readBillingCatalog(),
      [{ price: "price_metas_antigo", item: "modulo:metas", amount: "6.90", quantity: 1 }],
    );
    expect(quote.lines.find((line) => line.item === "modulo:metas")?.amount).toBe("6.90");
    const fresh = domain.quotePlan(
      { ...domain.FAMILY_SELECTION, family: false, modules: ["metas"], entries: "50", messages: 0 },
      await db.readBillingCatalog(),
    );
    expect(fresh.lines.find((line) => line.item === "modulo:metas")?.amount).toBe("8.90");
  });

  it("não cria preço na Stripe: o id só chega por ação explícita, uma vez", async () => {
    const [before] = await onSale("modulo:dividas", "ano");
    await db.adminNewPrice(admin, {
      item: "modulo:dividas",
      cycle: "ano",
      amount: "80.00",
      basedOn: before!.id,
    });
    const [row] = await onSale("modulo:dividas", "ano");
    expect(row?.stripePriceId).toBeNull();
    const line = await db.adminPriceToCreate(row!.id);
    expect(line).toMatchObject({ amount: "80.00", currency: "BRL" });
    expect(await db.adminSaveStripePrice(admin, row!.id, "price_dividas_novo")).toBe("ok");
    expect(await db.adminSaveStripePrice(admin, row!.id, "price_dividas_de_novo")).toBe(
      "not_found",
    );
    expect(await db.adminPriceToCreate(row!.id)).toBeNull();
  });

  it("mesmo valor não vira linha nova", async () => {
    const [row] = await onSale("base:50", "mes");
    expect(
      await db.adminNewPrice(admin, {
        item: "base:50",
        cycle: "mes",
        amount: "9.90",
        basedOn: row!.id,
      }),
    ).toBe("igual");
  });

  it("três preços ao mesmo tempo: um entra, e os outros ouvem que mudou, sem perda silenciosa", async () => {
    const [row] = await onSale("base:200", "mes");
    const asked = ["11.00", "12.00", "13.00"];
    const results = await Promise.all(
      asked.map((amount) =>
        db.adminNewPrice(admin, { item: "base:200", cycle: "mes", amount, basedOn: row!.id }),
      ),
    );
    expect(results.filter((result) => result === "ok")).toHaveLength(1);
    expect(results.filter((result) => result === "mudou")).toHaveLength(2);
    const sold = await onSale("base:200", "mes");
    expect(sold).toHaveLength(1);
    expect(sold[0]?.amount).toBe(asked[results.indexOf("ok")]);
    const lines = await db.withAdminRead("teste de catálogo", (tx) =>
      tx.select().from(billingCatalog).where(eq(billingCatalog.item, "base:200")),
    );
    // A antiga dos dois ciclos e a nova: nenhuma linha fantasma fora de venda.
    expect(lines).toHaveLength(3);
  });

  it("contas conectadas não vão à venda, nem por preço novo, e não têm anual", async () => {
    const item = domain.CONNECTED_ITEM;
    expect(await db.adminSetOnSale(admin, { item, cycle: "mes", onSale: true })).toBe(
      "conexao_inexistente",
    );
    const [row] = await db.withAdminRead("teste de catálogo", (tx) =>
      tx.select().from(billingCatalog).where(eq(billingCatalog.item, item)),
    );
    const basedOn = row!.id;
    expect(await db.adminNewPrice(admin, { item, cycle: "ano", amount: "199.00", basedOn })).toBe(
      "sem_anual",
    );
    expect(await db.adminNewPrice(admin, { item, cycle: "mes", amount: "21.90", basedOn })).toBe(
      "ok",
    );
    expect(await onSale(item, "mes")).toEqual([]);
    expect((await db.readBillingCatalog()).map((row) => row.item)).not.toContain(item);
  });

  it("desligar a venda tira da tela e religar devolve o mesmo preço", async () => {
    const off = { item: "modulo:aposentadoria", cycle: "ano" as const };
    expect(await db.adminSetOnSale(admin, { ...off, onSale: false })).toBe("ok");
    const sold = await db.readBillingCatalog();
    expect(sold.some((row) => row.item === off.item && row.cycle === off.cycle)).toBe(false);
    expect(await db.adminSetOnSale(admin, { ...off, onSale: true })).toBe("ok");
    expect((await onSale(off.item, off.cycle))[0]?.amount).toBe("99.00");
  });
});

describe("leituras do painel", () => {
  it("nenhuma devolve id da Stripe nem dado de família além do nome", async () => {
    const family = await newFamily();
    await setSub(family.id, {
      stripeCustomerId: `cus_vip${serial}`,
      stripeSubscriptionId: `sub_vip${serial}`,
    });
    const rows = await db.adminBillingFamilies();
    const row = rows.find((item) => item.householdId === family.id)!;
    expect(row.subscription).toMatchObject({ hasSubscription: true, hasCustomer: true });
    expect(JSON.stringify(rows)).not.toMatch(/cus_vip|sub_vip/);
    expect(await db.adminStripeTarget(admin, family.id)).toMatchObject({
      customerId: `cus_vip${serial}`,
    });
  });

  it("uso do mês só em contagens, no mês da família", async () => {
    const family = await newFamily();
    const month = domain.yearMonthOf(domain.todayIn());
    await db.withHousehold(family.ctx, (tx) => db.takeMessage(tx, family.id, month, null));
    const usage = await db.adminMonthUsage();
    expect(usage.find((row) => row.householdId === family.id)).toEqual({
      householdId: family.id,
      entries: 0,
      messages: 1,
    });
  });

  it("histórico lê os eventos da família, com o nome do item e sem pessoa", async () => {
    const family = await newFamily();
    await db.withAdmin("seed do teste de VIP", (tx) =>
      tx
        .update(billingCatalog)
        .set({ stripePriceId: "price_hist_base" })
        .where(
          db.and(
            eq(billingCatalog.item, "base:ilimitado"),
            eq(billingCatalog.cycle, "mes"),
            eq(billingCatalog.onSale, true),
          ),
        ),
    );
    await db.recordBillingEvent({
      id: `evt_hist${serial}`,
      type: "customer.subscription.updated",
      stripeAt: new Date(),
      livemode: false,
      householdId: family.id,
      customerId: null,
      data: {
        kind: "subscription",
        status: "active",
        items: [{ price: "price_hist_base", quantity: 1 }],
      },
    });
    const history = await db.adminBillingHistory(family.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "active", items: ["base:ilimitado"] });
  });

  it("saúde da cobrança conta os erros por código, com a duplicada", async () => {
    const id = `evt_dup${serial}`;
    await db.recordBillingEvent({
      id,
      type: "customer.subscription.created",
      stripeAt: new Date(),
      livemode: false,
      householdId: null,
      customerId: null,
      data: { kind: "ignored" },
    });
    await db.withAdmin("seed do teste de VIP", (tx) =>
      tx
        .update(db.billingEvents)
        .set({ errorCode: "assinatura_duplicada", processedAt: new Date() })
        .where(eq(db.billingEvents.id, id)),
    );
    const health = await db.adminBillingHealth();
    expect(health.lastReceivedAt).not.toBeNull();
    expect(health.errors.map((row) => row.code)).toContain("assinatura_duplicada");
    expect(JSON.stringify(health)).not.toMatch(/hh-|cus_|sub_/);
  });

  it("telas da família só com códigos e contagens", async () => {
    const family = await newFamily();
    expect(await db.adminFamilyProduct(family.id)).toMatchObject({
      mainCurrency: "BRL",
      reports: 0,
      statements: 0,
      notifications: 0,
      unread: 0,
    });
    // Uso de módulo por família nomeada não sai daqui: só somado, em `adminProductCounts`.
    expect(await db.adminFamilyProduct(family.id)).not.toHaveProperty("debts");
    const counts = await db.adminProductCounts();
    expect(JSON.stringify(counts)).not.toMatch(/hh-/);
  });
});
