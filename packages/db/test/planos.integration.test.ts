// Planos e assinatura (ADR-0023) contra um Postgres real: quem entra com cortesia, quem começa o teste,
// e a concorrência nos limites. Dados fictícios.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, inject, it } from "vitest";
import postgres from "postgres";

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("../src/index");
const { closeAllPools } = await import("../src/client");
const { defaultMigrationsDir } = await import("../src/migrator");
const domain = await import("@organizeup/domain");

const { accounts, categories, cardPurchases, creditCards, household, householdMember } = db;
const { householdSettings, householdSubscriptions, transactions, user } = db;

let families = 0;

/** Agora, no relógio do banco. */
const databaseNow = (ctx: Parameters<typeof db.withHousehold>[0]) =>
  db.withHousehold(ctx, async (tx) => {
    const rows = await tx.execute<{ ms: number }>(
      db.sql`select (extract(epoch from now()) * 1000)::float8 as ms`,
    );
    return Number(rows[0]!.ms);
  });

async function newFamily() {
  families += 1;
  const id = `hh-planos-${families}`;
  const owner = `user-planos-${families}`;
  await db.withAdmin("seed do teste de planos", async (admin) => {
    await admin.insert(user).values({ id: owner, name: "Teste", email: `${owner}@example.com` });
    await admin.insert(household).values({ id, name: "Família", slug: id });
    await admin
      .insert(householdMember)
      .values({ id: `m-${id}`, organizationId: id, userId: owner, role: "owner" });
  });
  const ctx = await db.fromSession({
    user: { id: owner },
    session: { activeOrganizationId: id },
  });
  if (!ctx) throw new Error("sem contexto");
  const accountId = await db.withHousehold(ctx, async (tx) => {
    await tx.insert(householdSettings).values({ householdId: id });
    const [account] = await tx
      .insert(accounts)
      .values({ householdId: id, name: "Conta", type: "corrente" })
      .returning({ id: accounts.id });
    await tx.insert(categories).values({ householdId: id, name: "Mercado", kind: "despesa" });
    return account!.id;
  });
  const categoryId = await db.withHousehold(ctx, async (tx) => {
    const [row] = await tx.select({ id: categories.id }).from(categories).limit(1);
    return row!.id;
  });
  return { id, ctx, accountId, categoryId };
}

async function setBilling(enabled: boolean) {
  await db.withAdmin("teste de planos: chave", (admin) =>
    admin
      .update(db.featureFlags)
      .set({ enabled })
      .where(db.eq(db.featureFlags.key, db.FLAG_KEYS.billing)),
  );
}

afterEach(() => setBilling(false));
afterAll(() => closeAllPools());

describe("linha da família", () => {
  it("a chave nasce desligada e o acesso é o de hoje", async () => {
    const { ctx } = await newFamily();
    expect((await db.readPlatformFlags()).billingEnabled).toBe(false);
    const access = await db.readFamilyAccess(ctx);
    expect(access.mode).toBe("livre");
  });

  it("família criada com a chave desligada ganha cortesia, sem data de fim", async () => {
    const { ctx } = await newFamily();
    expect(await db.readSubscription(ctx)).toMatchObject({
      courtesy: true,
      courtesyUntil: null,
      courtesyReason: "antes_da_cobranca",
      trialEndsAt: null,
    });
    await setBilling(true);
    expect((await db.readFamilyAccess(ctx)).mode).toBe("cortesia");
  });

  it("família criada com a chave ligada começa o teste de 7 dias, e depois só lê", async () => {
    await setBilling(true);
    const { ctx } = await newFamily();
    const row = await db.readSubscription(ctx);
    expect(row).toMatchObject({ courtesy: false });
    // Só o relógio do banco: o fim do teste nasce nele, e o do Node pode estar atrás.
    const left = row!.trialEndsAt!.getTime() - (await databaseNow(ctx));
    expect(left).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(left).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
    expect((await db.readFamilyAccess(ctx)).mode).toBe("teste");
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect((await db.readFamilyAccess(ctx, undefined, later)).mode).toBe("leitura");
  });

  it("a migração dá cortesia a quem já existe, em banco com dados de antes dela", async () => {
    const dir = defaultMigrationsDir();
    const files = readdirSync(dir)
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .toSorted();
    const body = (file: string) => readFileSync(path.join(dir, file), "utf8");
    const database = `ou_planos_${Date.now()}`;
    const owner = postgres(urls.owner, { max: 1, onnotice: () => {} });
    await owner.unsafe(`create database ${database}`);
    const url = new URL(urls.owner);
    url.pathname = `/${database}`;
    const fresh = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      for (const file of files.filter((name) => name < "0036")) await fresh.unsafe(body(file));
      await fresh`insert into household (id, name, slug, created_at) values ('hh-velha', 'Velha', 'velha', now())`;
      await fresh.unsafe(body(files.find((name) => name.startsWith("0036"))!));
      const rows =
        await fresh`select household_id, courtesy, courtesy_reason, courtesy_until, trial_ends_at from household_subscriptions`;
      expect(rows).toEqual([
        {
          household_id: "hh-velha",
          courtesy: true,
          courtesy_reason: "familia_existente",
          courtesy_until: null,
          trial_ends_at: null,
        },
      ]);
    } finally {
      await fresh.end();
      await owner.unsafe(`drop database ${database}`);
      await owner.end();
    }
  });

  it("apagar a família leva a assinatura junto, pela conexão da aplicação", async () => {
    const { id } = await newFamily();
    const raw = postgres(urls.app, { max: 1, onnotice: () => {} });
    try {
      await raw`delete from household where id = ${id}`;
      const rows = await db.withAdmin("teste", (admin) =>
        admin
          .select()
          .from(householdSubscriptions)
          .where(db.eq(householdSubscriptions.householdId, id)),
      );
      expect(rows).toEqual([]);
    } finally {
      await raw.end();
    }
  });
});

describe("limite de lançamentos", () => {
  const LIMIT = { entryLimit: 2 };
  type Family = Awaited<ReturnType<typeof newFamily>>;
  const entry = (family: Family) => ({
    householdId: family.id,
    accountId: family.accountId,
    categoryId: family.categoryId,
    kind: "despesa" as const,
    description: "Compra",
    amount: "10.00",
    occurredOn: domain.todayIn(),
  });
  /** Grava e marca, como `saveEntry`. */
  const lancar = async (
    tx: import("../src/index").TenantTx,
    family: Family,
    month: string | null,
  ) => {
    const [row] = await tx
      .insert(transactions)
      .values(entry(family))
      .returning({ id: transactions.id });
    await db.markEntries(tx, month, [row!.id]);
    return row!.id;
  };

  it("conta só o que tem o mês marcado: lançado, importado e compra no cartão", async () => {
    const family = await newFamily();
    const month = domain.yearMonthOf(domain.todayIn());
    await db.withHousehold(family.ctx, async (tx) => {
      await lancar(tx, family, month);
      // Parcela, fatura, aporte, recorrência: nascem sem marca.
      await lancar(tx, family, null);
      await lancar(tx, family, "2020-01");
      const [card] = await tx
        .insert(creditCards)
        .values({
          householdId: family.id,
          name: "Cartão",
          closingDay: 1,
          dueDay: 10,
          payingAccountId: family.accountId,
        })
        .returning({ id: creditCards.id });
      const [purchase] = await tx
        .insert(cardPurchases)
        .values({
          householdId: family.id,
          cardId: card!.id,
          categoryId: family.categoryId,
          description: "Compra parcelada",
          amount: "120.00",
          installments: 12,
          purchasedOn: domain.todayIn(),
        })
        .returning({ id: cardPurchases.id });
      await db.markCardPurchase(tx, month, purchase!.id);
    });
    expect(await db.withHousehold(family.ctx, (tx) => db.countEntries(tx, month))).toBe(2);
    expect((await db.readMonthUsage(family.ctx))?.entries).toBe(2);
  });

  it("no limite recusa e diz quantos cabem; abaixo dele, passa", async () => {
    const family = await newFamily();
    const take = (count: number) =>
      db.withHousehold(family.ctx, (tx) => db.takeEntries(tx, LIMIT, family.id, count));
    expect(await take(3)).toMatchObject({ ok: false, left: 2 });
    const quota = await take(2);
    expect(quota.ok).toBe(true);
    await db.withHousehold(family.ctx, async (tx) => {
      await lancar(tx, family, quota.month);
      await lancar(tx, family, quota.month);
    });
    expect(await take(1)).toMatchObject({ ok: false, left: 0 });
  });

  it("apagar um lançamento devolve a vaga", async () => {
    const family = await newFamily();
    const month = domain.yearMonthOf(domain.todayIn());
    const id = await db.withHousehold(family.ctx, (tx) => lancar(tx, family, month));
    await db.withHousehold(family.ctx, (tx) =>
      tx.delete(transactions).where(db.eq(transactions.id, id)),
    );
    expect(await db.withHousehold(family.ctx, (tx) => db.countEntries(tx, month))).toBe(0);
  });

  it("dez gravações ao mesmo tempo com duas vagas: só duas passam", async () => {
    const family = await newFamily();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.withHousehold(family.ctx, async (tx) => {
          const quota = await db.takeEntries(tx, LIMIT, family.id, 1);
          if (quota.ok) await lancar(tx, family, quota.month);
          return quota.ok;
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(2);
    const month = domain.yearMonthOf(domain.todayIn());
    expect(await db.withHousehold(family.ctx, (tx) => db.countEntries(tx, month))).toBe(2);
  });

  it("sem limite não trava e continua marcando o mês", async () => {
    const family = await newFamily();
    const quota = await db.withHousehold(family.ctx, (tx) =>
      db.takeEntries(tx, { entryLimit: null }, family.id, 5000),
    );
    expect(quota).toMatchObject({ ok: true, month: domain.yearMonthOf(domain.todayIn()) });
  });

  it("com a chave desligada não marca nada, para a web subir antes da migração", async () => {
    const family = await newFamily();
    const quota = await db.withHousehold(family.ctx, (tx) =>
      db.takeEntries(tx, { entryLimit: null, mode: "livre" }, family.id, 1),
    );
    expect(quota).toEqual({ ok: true, month: null });
  });
});

describe("limite de mensagens", () => {
  const MONTH = "2026-11";

  it("gasta até o limite, e no mês seguinte volta", async () => {
    const family = await newFamily();
    const take = (month: string) =>
      db.withHousehold(family.ctx, (tx) => db.takeMessage(tx, family.id, month, 2));
    expect(await take(MONTH)).toBe(true);
    expect(await take(MONTH)).toBe(true);
    expect(await take(MONTH)).toBe(false);
    expect(await take("2026-12")).toBe(true);
  });

  it("dez perguntas ao mesmo tempo com três vagas: só três passam", async () => {
    const family = await newFamily();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.withHousehold(family.ctx, (tx) => db.takeMessage(tx, family.id, MONTH, 3)),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it("limite zero nunca grava, e pergunta que falhou devolve a mensagem", async () => {
    const family = await newFamily();
    expect(
      await db.withHousehold(family.ctx, (tx) => db.takeMessage(tx, family.id, MONTH, 0)),
    ).toBe(false);
    await db.withHousehold(family.ctx, async (tx) => {
      await db.takeMessage(tx, family.id, MONTH, 1);
      await db.giveBackMessage(tx, family.id, MONTH);
    });
    expect(
      await db.withHousehold(family.ctx, (tx) => db.takeMessage(tx, family.id, MONTH, 1)),
    ).toBe(true);
  });
});

describe("contas conectadas no catálogo", () => {
  it("nascem fora de venda, sem preço na Stripe, e a tela nem as recebe", async () => {
    const rows = await db.withAdmin("teste", (admin) =>
      admin
        .select()
        .from(db.billingCatalog)
        .where(db.eq(db.billingCatalog.item, "contas_conectadas")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cycle: "mes",
      amount: "19.90",
      onSale: false,
      stripePriceId: null,
    });
    const catalog = await db.readBillingCatalog();
    expect(catalog.map((row) => row.item)).not.toContain("contas_conectadas");
  });
});

describe("resumo para o painel", () => {
  it("devolve só contagens, sem id de família nem da Stripe", async () => {
    await newFamily();
    const summary = await db.adminBillingSummary();
    expect(summary.courtesy).toBeGreaterThan(0);
    expect(summary.modules).toHaveProperty("dividas");
    expect(JSON.stringify(summary)).not.toMatch(/hh-|cus_|sub_|price_/);
  });
});
