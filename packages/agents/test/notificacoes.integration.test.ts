// Categorias sem aceite e central de notificações (decisão do fundador em 2026-11-01, ADR-0015), pela
// conexão do worker, como em produção. Dados fictícios.
import { afterAll, beforeEach, describe, expect, inject, it } from "vitest";
import type { TenantContext, TenantTx } from "@organizeup/db";

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

const {
  accounts,
  and,
  categories,
  categoryMemory,
  eq,
  household,
  householdMember,
  householdNotifications,
  householdReports,
  householdSettings,
  householdSuggestions,
  people,
  transactions,
  user,
} = db;

const today = domain.todayIn();

interface Family {
  id: string;
  owner: string;
  viewer: string;
  job: TenantContext;
}

let families = 0;
async function newFamily(): Promise<Family> {
  families += 1;
  const id = `hh-notif-${families}`;
  const owner = `user-notif-${families}`;
  const viewer = `viewer-notif-${families}`;
  await db.withAdmin("seed do teste de notificações", async (admin) => {
    await admin.insert(user).values([
      { id: owner, name: "Pessoa Teste", email: `${owner}@example.com` },
      { id: viewer, name: "Quem Só Vê", email: `${viewer}@example.com` },
    ]);
    await admin.insert(household).values({ id, name: "Grupo Teste", slug: id });
    await admin.insert(householdMember).values([
      { id: `m-${id}`, organizationId: id, userId: owner, role: "owner" },
      { id: `v-${id}`, organizationId: id, userId: viewer, role: "viewer" },
    ]);
  });
  await db.withWorkerHousehold(id, async (tx) => {
    await tx.insert(householdSettings).values({ householdId: id });
    await tx
      .insert(people)
      .values({ householdId: id, name: "Titular", relation: "titular", userId: owner });
    await db.ensureFinanceDefaults(tx, id);
  });
  return { id, owner, viewer, job: db.fromJob({ householdId: id }) };
}

const inFamily = <T>(family: Family, fn: (tx: TenantTx) => Promise<T>) =>
  db.withWorkerHousehold(family.id, fn);

async function categoryId(tx: TenantTx, name: string, kind: "despesa" | "receita" = "despesa") {
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, name), eq(categories.kind, kind)));
  if (!row) throw new Error(`categoria ${name} não existe`);
  return row.id;
}

const addCategory = (family: Family, name: string) =>
  inFamily(family, async (tx) => {
    const [row] = await tx
      .insert(categories)
      .values({ householdId: family.id, name, kind: "despesa" })
      .returning({ id: categories.id });
    return row!.id;
  });

type Source = "familia" | "importacao" | "revisar" | "agente" | null;

interface Entry {
  description: string;
  amount?: string;
  source?: Source;
  category?: string;
}

async function seed(family: Family, entries: Entry[]): Promise<string[]> {
  return inFamily(family, async (tx) => {
    const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
    const values = [];
    for (const entry of entries) {
      values.push({
        householdId: family.id,
        accountId: account!.id,
        categoryId: await categoryId(tx, entry.category ?? "Outras despesas"),
        kind: "despesa" as const,
        description: entry.description,
        amount: entry.amount ?? "100.00",
        occurredOn: today,
        categorySource: entry.source === undefined ? ("familia" as const) : entry.source,
      });
    }
    const rows = await tx.insert(transactions).values(values).returning({ id: transactions.id });
    return rows.map((row) => row.id);
  });
}

const runRules = (family: Family, day = today) =>
  inFamily(family, (tx) => agents.runCategoriasAgent(tx, { today: day, householdId: family.id }));

const rowOf = (family: Family, id: string) =>
  inFamily(family, async (tx) => {
    const [row] = await tx.select().from(transactions).where(eq(transactions.id, id));
    return row!;
  });

const suggestions = (family: Family) =>
  inFamily(family, (tx) => tx.select().from(householdSuggestions));

const notifications = (family: Family) =>
  inFamily(family, (tx) => tx.select().from(householdNotifications));

async function contextOf(family: Family, userId = family.owner) {
  const ctx = await db.fromSession({
    user: { id: userId },
    session: { activeOrganizationId: family.id },
  });
  if (!ctx) throw new Error("sem contexto");
  return ctx;
}

async function undo(family: Family, suggestionId: string) {
  const ctx = await contextOf(family);
  return db.withHousehold(ctx, (tx) => agents.undoSuggestion(tx, ctx, suggestionId));
}

const pendingRow = (
  family: Family,
  kind: "categoria" | "fusao_categoria",
  dedupeKey: string,
  payload: Record<string, unknown>,
) =>
  inFamily(family, async (tx) => {
    const [row] = await tx
      .insert(householdSuggestions)
      .values({
        householdId: family.id,
        agent: "categorias",
        kind,
        title: "Mover?",
        body: "Texto antigo",
        payload,
        dedupeKey,
      })
      .returning({ id: householdSuggestions.id });
    return row!.id;
  });

const pendingPayload = (ids: string[], from: string, to: string, over = {}) => ({
  kind: "despesa",
  transactionIds: ids,
  fromCategoryId: from,
  toCategoryId: to,
  newCategory: null,
  merchant: "loja atomo",
  ...over,
});

let family: Family;

beforeEach(async () => {
  family = await newFamily();
});

afterAll(async () => {
  await db.closeAllPools();
});

describe("o que muda sozinho", () => {
  it("lançamento da família em categoria genérica muda, sem pendência", async () => {
    const [id] = await seed(family, [{ description: "SUPERMERCADO BOM", source: "familia" }]);
    const result = await runRules(family);
    expect(result).toMatchObject({ applied: 1, suggestions: 0 });
    const mercado = await inFamily(family, (tx) => categoryId(tx, "Mercado"));
    expect(await rowOf(family, id!)).toMatchObject({
      categoryId: mercado,
      categorySource: "agente",
    });
    const [applied] = await suggestions(family);
    expect(applied).toMatchObject({ status: "aplicada", appliedBy: "agente", kind: "categoria" });
  });

  it("lançamento antigo sem origem também muda", async () => {
    const [id] = await seed(family, [{ description: "SUPERMERCADO BOM", source: null }]);
    await runRules(family);
    expect((await rowOf(family, id!)).categorySource).toBe("agente");
  });

  it("lançamento da família em categoria específica não muda nem pergunta", async () => {
    const [chosen] = await seed(family, [
      { description: "SUPERMERCADO BOM", source: "familia", category: "Lazer" },
    ]);
    const result = await runRules(family);
    expect(result).toMatchObject({ applied: 0, suggestions: 0 });
    expect(await rowOf(family, chosen!)).toMatchObject({ categorySource: "familia" });
    expect(await suggestions(family)).toEqual([]);
    expect(await notifications(family)).toEqual([]);
  });

  it("aporte e meta ficam de fora, como origem e como destino", async () => {
    const [aporte, corretora] = await seed(family, [
      {
        description: "SUPERMERCADO BOM",
        source: "revisar",
        category: "Aportes e investimentos",
      },
      { description: "CORRETORA ALFA", source: "familia" },
    ]);
    await runRules(family);
    expect((await rowOf(family, aporte!)).categorySource).toBe("revisar");
    expect((await rowOf(family, corretora!)).categorySource).toBe("familia");
    expect(await suggestions(family)).toEqual([]);
  });

  it("junta categorias quase iguais com registro, aviso e Desfazer", async () => {
    await addCategory(family, "Mercado da semana");
    const [id] = await seed(family, [
      { description: "COMPRA X", category: "Mercado da semana", amount: "12.50" },
      { description: "COMPRA Y", category: "Mercado", amount: "1.00" },
      { description: "COMPRA Z", category: "Mercado", amount: "1.00" },
    ]);
    const result = await runRules(family);
    expect(result.applied).toBe(1);
    const mercado = await inFamily(family, (tx) => categoryId(tx, "Mercado"));
    expect((await rowOf(family, id!)).categoryId).toBe(mercado);

    const [merged] = await suggestions(family);
    expect(merged).toMatchObject({
      kind: "fusao_categoria",
      status: "aplicada",
      appliedBy: "agente",
    });
    const [notice] = await notifications(family);
    expect(notice).toMatchObject({ suggestionId: merged!.id });
    expect(notice!.data).toEqual({
      type: "fusao",
      count: 1,
      total: "12.50",
      fromNames: ["Mercado da semana"],
      toName: "Mercado",
    });

    expect((await undo(family, merged!.id)).ok).toBe(true);
    expect((await rowOf(family, id!)).categoryId).not.toBe(mercado);
    // Desfeita, não volta, nem com o outro lado virando a mais usada.
    expect((await runRules(family)).applied).toBe(0);
    await seed(family, Array(5).fill({ description: "COMPRA W", category: "Mercado da semana" }));
    expect((await runRules(family)).applied).toBe(0);
    expect(await notifications(family)).toHaveLength(1);
  });

  it("categoria de sistema nunca é fundida", async () => {
    await addCategory(family, "Metas e objetivos da casa");
    await runRules(family);
    expect(await suggestions(family)).toEqual([]);
  });
});

describe("notificações", () => {
  it("tem o antes e o depois certos, somando em decimal", async () => {
    await seed(family, [
      { description: "SUPERMERCADO BOM 10/10", amount: "0.10" },
      { description: "SUPERMERCADO BOM 11/10", amount: "0.20" },
    ]);
    await runRules(family);
    const [applied] = await suggestions(family);
    const rows = await notifications(family);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "categoria",
      suggestionId: applied!.id,
      title: "De Outras despesas para Mercado",
      readAt: null,
      href: null,
    });
    expect(rows[0]!.body).toContain("2 lançamentos");
    expect(rows[0]!.data).toEqual({
      type: "alteracao",
      merchant: "supermercado bom",
      kind: "despesa",
      count: 2,
      total: "0.30",
      fromNames: ["Outras despesas"],
      toName: "Mercado",
      isNew: false,
    });
  });

  it("diz quando a categoria é nova e de onde veio cada lançamento", async () => {
    await inFamily(family, async (tx) => {
      await tx.update(categories).set({ archived: true }).where(eq(categories.name, "Pets"));
      await tx.delete(categories).where(eq(categories.name, "Pets"));
    });
    await addCategory(family, "Diversos");
    await seed(family, [
      { description: "PETZ CENTRO" },
      { description: "PETZ CENTRO" },
      { description: "PETZ CENTRO", category: "Diversos" },
    ]);
    await runRules(family);
    const [notice] = await notifications(family);
    expect(notice!.data).toMatchObject({
      fromNames: ["Outras despesas", "Diversos"],
      toName: "Pets",
      isNew: true,
    });
  });

  it("rodar duas vezes no dia não repete, e o que chega depois soma na mesma linha", async () => {
    await seed(family, [{ description: "SUPERMERCADO BOM", amount: "10.00" }]);
    await runRules(family);
    await runRules(family);
    expect(await notifications(family)).toHaveLength(1);
    expect(await suggestions(family)).toHaveLength(1);

    const [late] = await seed(family, [{ description: "SUPERMERCADO BOM", amount: "5.00" }]);
    await runRules(family);
    const rows = await notifications(family);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ count: 2, total: "15.00" });
    const applied = await suggestions(family);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.payload).toMatchObject({
      transactionIds: expect.arrayContaining([late]),
    });

    expect((await undo(family, applied[0]!.id)).ok).toBe(true);
    const outras = await inFamily(family, (tx) => categoryId(tx, "Outras despesas"));
    expect((await rowOf(family, late!)).categoryId).toBe(outras);
  });

  it("noite seguinte com o mesmo destino abre outra linha", async () => {
    await seed(family, [{ description: "SUPERMERCADO BOM" }]);
    await runRules(family);
    await seed(family, [{ description: "SUPERMERCADO BOM" }]);
    await runRules(family, agents.shiftDays(today, 1));
    expect(await notifications(family)).toHaveLength(2);
    expect(await suggestions(family)).toHaveLength(2);
  });

  it("depois de 50 linhas, o resto vai para um resumo com a contagem", async () => {
    const shops = Array.from({ length: 53 }, (_, index) => ({
      description: `MERCADO ${letters(index)}`,
      amount: "10.00",
    }));
    await seed(family, shops);
    const result = await runRules(family);
    expect(result.applied).toBe(53);
    const rows = await notifications(family);
    expect(rows).toHaveLength(agents.MAX_NIGHT_NOTIFICATIONS + 1);
    const summary = rows.find((row) => (row.data as { type: string }).type === "resumo");
    expect(summary).toMatchObject({ href: "/app/sugestoes", suggestionId: null });
    expect(summary!.data).toEqual({ type: "resumo", changes: 3, count: 3, total: "30.00" });
    expect(await suggestions(family)).toHaveLength(53);

    await runRules(family);
    expect(await notifications(family)).toHaveLength(agents.MAX_NIGHT_NOTIFICATIONS + 1);
  });

  it("desfazer volta e bloqueia para sempre, e a notificação continua", async () => {
    const [id] = await seed(family, [{ description: "SUPERMERCADO BOM", source: "familia" }]);
    await runRules(family);
    const [notice] = await notifications(family);
    expect((await undo(family, notice!.suggestionId!)).ok).toBe(true);

    const outras = await inFamily(family, (tx) => categoryId(tx, "Outras despesas"));
    expect(await rowOf(family, id!)).toMatchObject({
      categoryId: outras,
      categorySource: "familia",
    });
    const memory = await inFamily(family, (tx) => tx.select().from(categoryMemory));
    expect(memory).toEqual([]);

    await seed(family, [{ description: "SUPERMERCADO BOM", source: "revisar" }]);
    expect((await runRules(family)).applied).toBe(0);
    expect((await rowOf(family, id!)).categoryId).toBe(outras);
    const rows = await notifications(family);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.readAt).toBeNull();
    const [undone] = await suggestions(family);
    expect(undone!.status).toBe("desfeita");
  });

  it("quem só vê não desfaz, e outra família não acha a sugestão", async () => {
    await seed(family, [{ description: "SUPERMERCADO BOM" }]);
    await runRules(family);
    const [applied] = await suggestions(family);
    const viewer = await contextOf(family, family.viewer);
    const blocked = await db.withHousehold(viewer, (tx) =>
      agents.undoSuggestion(tx, viewer, applied!.id),
    );
    expect(blocked.ok).toBe(false);

    const other = await newFamily();
    const ctx = await contextOf(other);
    const foreign = await db.withHousehold(ctx, (tx) =>
      agents.undoSuggestion(tx, ctx, applied!.id),
    );
    expect(foreign.ok).toBe(false);
    expect((await suggestions(family))[0]!.status).toBe("aplicada");
    expect(await notifications(other)).toEqual([]);
  });
});

describe("pendentes de antes da decisão", () => {
  it("aplica o que a regra deixa, na mesma linha, com aviso e Desfazer", async () => {
    const [id] = await seed(family, [{ description: "LOJA ATOMO", amount: "40.00" }]);
    const [from, to] = await inFamily(family, async (tx) => [
      await categoryId(tx, "Outras despesas"),
      await categoryId(tx, "Compras"),
    ]);
    const pending = await pendingRow(
      family,
      "categoria",
      `categoria:despesa:loja atomo:${to}`,
      pendingPayload([id!], from!, to!, { reason: "Regra antiga" }),
    );

    const result = await runRules(family);
    expect(result.applied).toBe(1);
    expect(await rowOf(family, id!)).toMatchObject({ categoryId: to, categorySource: "agente" });
    const rows = await suggestions(family);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: pending, status: "aplicada", appliedBy: "agente" });
    const [notice] = await notifications(family);
    expect(notice).toMatchObject({ suggestionId: pending });
    expect((await undo(family, pending)).ok).toBe(true);
    expect((await rowOf(family, id!)).categoryId).toBe(from);
  });

  it("fecha sem efeito o que a regra não deixa", async () => {
    const [specific] = await seed(family, [
      { description: "LOJA ATOMO", source: "familia", category: "Lazer" },
    ]);
    const [from, to] = await inFamily(family, async (tx) => [
      await categoryId(tx, "Lazer"),
      await categoryId(tx, "Compras"),
    ]);
    const key = `categoria:despesa:loja atomo:${to}`;
    await pendingRow(family, "categoria", key, pendingPayload([specific!], from!, to!));

    expect((await runRules(family)).applied).toBe(0);
    expect((await rowOf(family, specific!)).categoryId).toBe(from);
    const [closed] = await suggestions(family);
    expect(closed).toMatchObject({ status: "ignorada", dedupeKey: `fechada:${key}` });
    expect(await notifications(family)).toEqual([]);
  });

  it("sugestão da IA fecha sem chutar a confiança, e o estabelecimento volta para o modelo", async () => {
    const [id] = await seed(family, [{ description: "LOJA ATOMO" }]);
    const [from, to] = await inFamily(family, async (tx) => [
      await categoryId(tx, "Outras despesas"),
      await categoryId(tx, "Compras"),
    ]);
    await pendingRow(
      family,
      "categoria",
      `categoria:despesa:loja atomo:${to}`,
      pendingPayload([id!], from!, to!, {
        reason: "O assistente reconheceu o estabelecimento pela descrição do extrato",
      }),
    );
    await runRules(family);
    expect((await rowOf(family, id!)).categoryId).toBe(from);
    expect((await suggestions(family))[0]!.status).toBe("ignorada");
    const review = await inFamily(family, (tx) => agents.loadCategoryCandidates(tx, today));
    expect(review.groups.map((group) => group.merchant)).toEqual(["loja atomo"]);
  });

  it("destino de sistema também fecha", async () => {
    const [id] = await seed(family, [{ description: "LOJA ATOMO" }]);
    const [from, aporte] = await inFamily(family, async (tx) => [
      await categoryId(tx, "Outras despesas"),
      await categoryId(tx, "Aportes e investimentos"),
    ]);
    await pendingRow(
      family,
      "categoria",
      `categoria:despesa:loja atomo:${aporte}`,
      pendingPayload([id!], from!, aporte!),
    );
    expect((await runRules(family)).applied).toBe(0);
    expect((await rowOf(family, id!)).categoryId).toBe(from);
  });

  it("fusão pendente é aplicada, e a que perdeu o par fecha", async () => {
    const small = await addCategory(family, "Mercado da semana");
    const [id] = await seed(family, [
      { description: "COMPRA X", category: "Mercado da semana" },
      { description: "COMPRA Y", category: "Mercado" },
      { description: "COMPRA Z", category: "Mercado" },
    ]);
    const mercado = await inFamily(family, (tx) => categoryId(tx, "Mercado"));
    const payload = (from: string, to: string) => ({
      fromCategoryId: from,
      toCategoryId: to,
      transactionIds: [id],
      planIds: [],
      purchaseIds: [],
    });
    const open = await pendingRow(
      family,
      "fusao_categoria",
      `fusao:${small}:${mercado}`,
      payload(small, mercado),
    );
    const orphan = await pendingRow(
      family,
      "fusao_categoria",
      `fusao:sumiu:${mercado}`,
      payload("sumiu", mercado),
    );

    expect((await runRules(family)).applied).toBe(1);
    const rows = await suggestions(family);
    expect(rows.find((row) => row.id === open)).toMatchObject({
      status: "aplicada",
      appliedBy: "agente",
    });
    expect(rows.find((row) => row.id === orphan)).toMatchObject({ status: "ignorada" });
    expect((await rowOf(family, id!)).categoryId).toBe(mercado);
    expect(rows.some((row) => row.status === "pendente")).toBe(false);
  });

  it("aceitar uma pendente antiga pela tela não muda nada: é o agente que resolve", async () => {
    const [id] = await seed(family, [{ description: "LOJA ATOMO" }]);
    const [from, to] = await inFamily(family, async (tx) => [
      await categoryId(tx, "Outras despesas"),
      await categoryId(tx, "Compras"),
    ]);
    const pending = await pendingRow(
      family,
      "categoria",
      `categoria:despesa:loja atomo:${to}`,
      pendingPayload([id!], from!, to!),
    );
    const ctx = await contextOf(family);
    const result = await db.withHousehold(ctx, (tx) => agents.applySuggestion(tx, ctx, pending));
    expect(result.ok).toBe(false);
    expect((await rowOf(family, id!)).categoryId).toBe(from);
  });

  it("o relatório do dia conta o que foi resolvido", async () => {
    await seed(family, [{ description: "SUPERMERCADO BOM" }]);
    await runRules(family);
    const [report] = await inFamily(family, (tx) =>
      tx.select().from(householdReports).where(eq(householdReports.kind, "categorias")),
    );
    expect(report!.data).toMatchObject({ moved: 1, merges: 0 });
    expect(report!.data).not.toHaveProperty("pending");
    expect(report!.summary).not.toContain("sugest");
  });
});

/** Só letras: `merchantKey` tira números, então cada loja precisa de um nome próprio. */
function letters(index: number): string {
  const first = String.fromCharCode(97 + Math.floor(index / 26));
  const second = String.fromCharCode(97 + (index % 26));
  return `${first}${second}x`;
}
