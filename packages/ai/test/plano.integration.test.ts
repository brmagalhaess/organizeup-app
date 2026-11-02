// O plano no assistente (ADR-0023), contra um Postgres real, pela conexão do worker, que também aceita o
// papel da pessoa. O modelo é sempre o cliente falso: nada aqui chama a API.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TenantContext } from "@organizeup/db";
import type { AssistantEvent } from "../src/index";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;
process.env.ANTHROPIC_API_KEY = "chave-de-teste";

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const ai = await import("../src/index");
const { fakeClient, modelMessage, textReply, toolCall } = await import("./fake-client");

const { eq, featureFlags, household, householdMember, householdSettings } = db;
const { householdSubscriptions, householdUsage, user } = db;

const limits = { monthlyBudgetUsd: 1000, familyDailyTokens: 1_000_000 };
const day = domain.todayIn();

let families = 0;

interface Family {
  id: string;
  ctx: TenantContext;
  job: TenantContext;
}

async function plan(family: Family, items: string[], status = "active") {
  await db.withWorkerHousehold(family.id, (tx) =>
    tx
      .update(householdSubscriptions)
      .set({
        courtesy: false,
        trialEndsAt: new Date(0),
        status,
        cycle: "mes",
        items: items.map((item) => ({ price: `price_${item}`, item, amount: "9.90", quantity: 1 })),
      })
      .where(eq(householdSubscriptions.householdId, family.id)),
  );
}

async function newFamily(items: string[]): Promise<Family> {
  families += 1;
  const id = `hh-plano-ia-${families}`;
  const owner = `user-plano-ia-${families}`;
  await db.withAdmin("seed do teste do plano", async (admin) => {
    await admin.insert(user).values({ id: owner, name: "Teste", email: `${owner}@example.com` });
    await admin.insert(household).values({ id, name: "Família", slug: id });
    await admin
      .insert(householdMember)
      .values({ id: `m-${id}`, organizationId: id, userId: owner, role: "owner" });
  });
  const ctx = await db.fromSession({ user: { id: owner }, session: { activeOrganizationId: id } });
  if (!ctx) throw new Error("sem contexto");
  await db.withHousehold(ctx, async (tx) => {
    await tx.insert(householdSettings).values({ householdId: id });
    await db.ensureFinanceDefaults(tx, id);
  });
  const family = { id, ctx, job: db.fromJob({ householdId: id }) };
  // A chave vem ligada em todo o arquivo: família nova começa no teste, e daqui vira assinante.
  await plan(family, items);
  await ai.activateAssistant(ctx, {
    autonomy: "organizar",
    version: ai.INSIGHTS_CONSENT_VERSION,
  });
  return family;
}

const used = async (family: Family) => (await db.readMonthUsage(family.ctx))?.messages ?? 0;

function ask(family: Family, client: ReturnType<typeof fakeClient>["client"]) {
  const events: AssistantEvent[] = [];
  return ai
    .runChatTurn({
      ctx: family.ctx,
      client,
      message: "Quanto gastei?",
      limits,
      day,
      emit: (event) => events.push(event),
    })
    .then(() => events);
}

const blocked = (events: AssistantEvent[]) =>
  events.find((event) => event.type === "blocked")?.state ?? null;

const setBilling = (enabled: boolean) =>
  db.withAdmin("teste do plano: chave", (admin) =>
    admin.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, db.FLAG_KEYS.billing)),
  );

beforeAll(() => setBilling(true));
afterAll(() => setBilling(false));

describe("mensagens", () => {
  it("cada pergunta gasta uma, mesmo com várias chamadas ao modelo", async () => {
    const family = await newFamily(["base:50", "assistente:30"]);
    const { client, calls } = fakeClient([
      modelMessage([toolCall("resumo_do_mes", {})], "tool_use"),
      textReply("Pronto."),
    ]);
    await ask(family, client);
    expect(calls).toHaveLength(2);
    expect(await used(family)).toBe(1);
  });

  it("a pergunta da última vaga termina, e a seguinte pausa sem chamar o modelo", async () => {
    const family = await newFamily(["base:50", "assistente:30"]);
    await db.withHousehold(family.ctx, (tx) =>
      tx.insert(householdUsage).values({
        householdId: family.id,
        month: domain.yearMonthOf(domain.todayIn()),
        messages: 29,
      }),
    );
    const last = fakeClient([
      modelMessage([toolCall("resumo_do_mes", {})], "tool_use"),
      textReply("Última resposta."),
    ]);
    const events = await ask(family, last.client);
    expect(events.at(-1)).toMatchObject({ type: "done", status: "completa" });
    expect(last.calls).toHaveLength(2);

    const next = fakeClient([textReply("Não devia chegar aqui.")]);
    expect(blocked(await ask(family, next.client))).toBe("limite_mensagens");
    expect(next.calls).toHaveLength(0);
    expect(await used(family)).toBe(30);
    expect(await ai.assistantState({ ctx: family.ctx, limits, day })).toBe("limite_mensagens");
  });

  it("duas perguntas na última vaga: só uma passa", async () => {
    const family = await newFamily(["base:50", "assistente:30"]);
    await db.withHousehold(family.ctx, (tx) =>
      tx.insert(householdUsage).values({
        householdId: family.id,
        month: domain.yearMonthOf(domain.todayIn()),
        messages: 29,
      }),
    );
    const results = await Promise.all([
      ask(family, fakeClient([textReply("A")]).client),
      ask(family, fakeClient([textReply("B")]).client),
    ]);
    expect(results.map(blocked).filter(Boolean)).toEqual(["limite_mensagens"]);
    expect(await used(family)).toBe(30);
  });

  it("subir de degrau libera na hora", async () => {
    const family = await newFamily(["base:50", "assistente:30"]);
    await db.withHousehold(family.ctx, (tx) =>
      tx.insert(householdUsage).values({
        householdId: family.id,
        month: domain.yearMonthOf(domain.todayIn()),
        messages: 30,
      }),
    );
    expect(await ai.assistantState({ ctx: family.ctx, limits, day })).toBe("limite_mensagens");
    await plan(family, ["base:50", "assistente:100"]);
    expect(await ai.assistantState({ ctx: family.ctx, limits, day })).toBe("pronto");
  });

  it("chamada que falha devolve a mensagem", async () => {
    const family = await newFamily(["base:50", "assistente:30"]);
    const { client } = fakeClient([new Error("fora do ar")]);
    const events = await ask(family, client);
    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(await used(family)).toBe(0);
  });

  it("conversa que não existe não gasta", async () => {
    const family = await newFamily(["base:50", "assistente:30"]);
    const events: AssistantEvent[] = [];
    await ai.runChatTurn({
      ctx: family.ctx,
      client: fakeClient([]).client,
      message: "Oi",
      threadId: "00000000-0000-4000-8000-000000000000",
      limits,
      day,
      emit: (event) => events.push(event),
    });
    expect(events).toEqual([{ type: "error", code: "sem_conversa" }]);
    expect(await used(family)).toBe(0);
  });

  it("cortesia e teste não têm limite de mensagens", async () => {
    const family = await newFamily(["base:50"]);
    await db.withWorkerHousehold(family.id, (tx) =>
      tx
        .update(householdSubscriptions)
        .set({ courtesy: true, status: null, items: [] })
        .where(eq(householdSubscriptions.householdId, family.id)),
    );
    await ask(family, fakeClient([textReply("Oi")]).client);
    expect(await used(family)).toBe(1);
    expect(await ai.assistantState({ ctx: family.ctx, limits, day })).toBe("pronto");
  });
});

describe("módulos", () => {
  it("sem o assistente no plano, a conversa nem começa", async () => {
    const family = await newFamily(["base:50"]);
    const { client, calls } = fakeClient([textReply("Não devia chegar aqui.")]);
    expect(blocked(await ask(family, client))).toBe("sem_modulo");
    expect(calls).toHaveLength(0);
    expect(await used(family)).toBe(0);
  });

  it("teste acabou: só leitura, com o motivo certo", async () => {
    const family = await newFamily(["base:50"]);
    await plan(family, [], "canceled");
    expect(await ai.assistantState({ ctx: family.ctx, limits, day })).toBe("somente_leitura");
  });

  it("ferramenta de módulo desligado não vai ao modelo e não roda se ele insistir", async () => {
    const family = await newFamily(["base:50", "assistente:30"]);
    const { client, calls } = fakeClient([
      modelMessage([toolCall("ver_carteira", {})], "tool_use"),
      textReply("Não consegui."),
    ]);
    await ask(family, client);
    const offered = (calls[0]!.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(offered).toContain("resumo_do_mes");
    expect(offered).not.toContain("ver_carteira");
    expect(offered).not.toContain("ver_plano_dividas");
    expect(JSON.stringify(calls[1]!.messages)).toContain("não existe");
  });

  it("sugestão de aporte na aposentadoria respeita o módulo; na reserva, não precisa dele", async () => {
    const family = await newFamily(["base:50", "assistente:30"]);
    const tool = ai.ALL_TOOLS.find((item) => item.name === "sugerir_aporte")!;
    const run = (destino: string) =>
      tool.run(family.ctx, { destino, valor_mensal: "100.00" } as never) as Promise<{
        aviso: string;
      }>;
    expect((await run("aposentadoria")).aviso).toContain("não tem Aposentadoria");
    expect((await run("reserva")).aviso).toContain("Sugestões");
  });

  it("relatório de módulo desligado fica de fora, e o da Base responde", async () => {
    const family = await newFamily(["base:50", "assistente:30"]);
    const tool = ai.ALL_TOOLS.find((item) => item.name === "ver_relatorio")!;
    const run = (tipo: string) => tool.run(family.ctx, { tipo } as never);
    expect(await run("investimentos")).toMatchObject({ situacao: "fora_do_plano" });
    expect(await run("anual")).toMatchObject({ situacao: "sem_relatorio" });
  });

  it("ler arquivo de dívida é do módulo Dívidas, mesmo sem o assistente no plano", async () => {
    const family = await newFamily(["base:50", "modulo:dividas"]);
    const gate = await ai.debtFileGate({ ctx: family.ctx, limits, day });
    expect(gate).not.toBe("sem_modulo");
    await plan(family, ["base:50", "assistente:30"]);
    expect(await ai.debtFileGate({ ctx: family.ctx, limits, day })).toBe("sem_modulo");
  });
});

describe("madrugada", () => {
  const empty = () => textReply(JSON.stringify({ especialistas: [], dicas: [] }));

  it("dicas e categorias com IA não gastam mensagem", async () => {
    const family = await newFamily(["base:50", "assistente:30"]);
    const night = fakeClient([empty(), empty(), empty(), empty()]);
    const insights = await ai.runNightlyInsights({
      ctx: family.job,
      client: night.client,
      day,
      limits,
    });
    expect(insights.gate).toBe("pronto");
    expect(night.calls.length).toBeGreaterThan(0);

    const review = await ai.runCategoryReview({
      ctx: family.job,
      client: fakeClient([empty()]).client,
      day,
      limits,
    });
    expect(review.gate).toBe("pronto");
    expect(await used(family)).toBe(0);
  });

  it("sem o assistente no plano, a madrugada não chama o modelo", async () => {
    const family = await newFamily(["base:50"]);
    const { client, calls } = fakeClient([empty()]);
    const insights = await ai.runNightlyInsights({ ctx: family.job, client, day, limits });
    const review = await ai.runCategoryReview({ ctx: family.job, client, day, limits });
    expect(insights.gate).toBe("sem_plano");
    expect(review.gate).toBe("sem_plano");
    expect(calls).toHaveLength(0);
  });

  it("em só leitura também não", async () => {
    const family = await newFamily(["base:50"]);
    await plan(family, [], "canceled");
    const { client, calls } = fakeClient([empty()]);
    const run = await ai.runNightlyInsights({ ctx: family.job, client, day, limits });
    expect(run.gate).toBe("sem_plano");
    expect(calls).toHaveLength(0);
  });

  it("especialista da madrugada não vê ferramenta de módulo desligado", async () => {
    const family = await newFamily(["base:50", "assistente:30"]);
    const { client, calls } = fakeClient([
      textReply(JSON.stringify({ especialistas: ["investimentos"] })),
      textReply(JSON.stringify({ dicas: [] })),
    ]);
    await ai.runNightlyInsights({ ctx: family.job, client, day, limits });
    for (const call of calls) {
      const names = (call.tools as Array<{ name: string }>).map((tool) => tool.name);
      expect(names).not.toContain("ver_carteira");
    }
  });
});

describe("chave desligada", () => {
  it("tudo como hoje, sem contar limite", async () => {
    const family = await newFamily(["base:50"]);
    await setBilling(false);
    try {
      expect(await ai.assistantState({ ctx: family.ctx, limits, day })).toBe("pronto");
      expect((await db.readFamilyAccess(family.ctx)).mode).toBe("livre");
    } finally {
      await setBilling(true);
    }
  });
});
