// Rotina da madrugada (§5): o orquestrador lê os relatórios do dia e escolhe os especialistas; cada um
// olha os números com as ferramentas e propõe dicas; o verificador reprova o que não confere; o resto
// vai para `household_insights`. Uma família por vez, sem transação aberta durante a chamada ao modelo,
// e idempotente por dia. Só para quem autorizou esta versão do aceite. Log só com contagens.
import type Anthropic from "@anthropic-ai/sdk";
import { shiftDays } from "@organizeup/agents";
import {
  and,
  eq,
  gte,
  householdAccountType,
  householdCurrency,
  householdInsights,
  INSIGHT_SCREENS,
  lt,
  ne,
  readPlatformFlags,
  tolerateSchemaLag,
  withHousehold,
  type InsightScreen,
  type TenantContext,
  readFamilyAccess,
} from "@organizeup/db";
import {
  canUse,
  legalVersionAtLeast,
  normalizeDescription,
  type AccountType,
  type Currency,
  type FamilyAccess,
} from "@organizeup/domain";
import { z } from "zod";
import {
  aiLimits,
  monthSpend,
  nightLocale,
  readAssistantSettings,
  serviceDay,
  type AiLimits,
} from "../access";
import { assistantConfigured, type ModelClient } from "../client";
import { turnContext, type AssistantLocale } from "../instructions";
import { echoContent, requestParams, type OutputFormat } from "../loop";
import { usageOf, type AiRoute } from "../models";
import { loadPrivacyFilter, type PrivacyFilter } from "../privacy";
import { executeTool, toolsFor } from "../tools";
import { recordUsage } from "../usage";
import { knownNumbers } from "../verify";
import { rejectionOf } from "./verify";

/** Aceite que já cita a rotina da madrugada. Família que aceitou antes precisa aceitar de novo. */
export const INSIGHTS_CONSENT_VERSION = "2026-11-01.1";

export const NIGHT_ROUTE: AiRoute = {
  name: "noite",
  effort: "medium",
  maxTokens: 8_000,
  maxIterations: 5,
  toolKinds: ["leitura", "simulacao"],
};

const VALID_DAYS = 7;
const BLOCK_DAYS = 30;
const MAX_PER_SPECIALIST = 2;
const MAX_TITLE = 90;
const MAX_BODY = 400;
const MAX_WHY = 600;

const SPECIALISTS = {
  financas: {
    focus: "gastos do mês, contas em aberto, calendário, reserva de emergência e dívidas",
    screens: ["painel", "lancamentos", "calendario", "reserva", "dividas"],
  },
  dividas: {
    focus:
      "plano de saída das dívidas (ver_plano_dividas): qual atacar, quanto pagar a mais neste mês, juro acima do rendimento, parcela antes da renda, portabilidade ou renegociação, sem citar banco, e dado faltando",
    screens: ["dividas", "painel"],
  },
  aposentadoria: {
    focus: "plano de aposentadoria, quanto guardar por mês e o efeito de guardar mais",
    screens: ["aposentadoria", "painel"],
  },
  investimentos: {
    focus: "divisão da carteira por classes contra a meta da família, proventos e valores antigos",
    screens: ["investimentos", "proventos"],
  },
  metas: { focus: "prazo, parcela e prioridade das metas", screens: ["metas"] },
  viagens: { focus: "custo, prazo e orçamento das viagens", screens: ["viagens"] },
} as const satisfies Record<string, { focus: string; screens: readonly InsightScreen[] }>;

type Specialist = keyof typeof SPECIALISTS;
const SPECIALIST_NAMES = Object.keys(SPECIALISTS) as Specialist[];
const DEFAULT_SPECIALISTS: Specialist[] = ["financas", "aposentadoria"];

const jsonFormat = (schema: Record<string, unknown>): OutputFormat => ({
  type: "json_schema",
  schema,
});

const ORCHESTRATOR_FORMAT = jsonFormat({
  type: "object",
  properties: { especialistas: { type: "array", items: { enum: SPECIALIST_NAMES } } },
  required: ["especialistas"],
  additionalProperties: false,
});

const INSIGHTS_FORMAT = jsonFormat({
  type: "object",
  properties: {
    dicas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tela: { enum: INSIGHT_SCREENS },
          titulo: { type: "string" },
          texto: { type: "string" },
          porque: { type: "string" },
          destino: { enum: INSIGHT_SCREENS },
          prioridade: { enum: [1, 2, 3] },
        },
        required: ["tela", "titulo", "texto", "porque", "destino", "prioridade"],
        additionalProperties: false,
      },
    },
  },
  required: ["dicas"],
  additionalProperties: false,
});

const orchestratorAnswer = z.object({ especialistas: z.array(z.enum(SPECIALIST_NAMES)) });
const insightAnswer = z.object({
  dicas: z.array(
    z.object({
      tela: z.enum(INSIGHT_SCREENS),
      titulo: z.string().trim().min(1).max(MAX_TITLE),
      texto: z.string().trim().min(1).max(MAX_BODY),
      porque: z.string().trim().min(1).max(MAX_WHY),
      destino: z.enum(INSIGHT_SCREENS),
      prioridade: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    }),
  ),
});
type InsightDraft = z.infer<typeof insightAnswer>["dicas"][number];

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ModelMessage = Anthropic.Beta.Messages.BetaMessage;

export type InsightGate =
  "pronto" | "sem_chave" | "desligado" | "teto_mensal" | "sem_aceite" | "ja_rodou" | "sem_plano";

/** Mesmo portão da conversa, sem papel: quem roda é o sistema, em nome de quem autorizou. */
export async function nightGate(
  ctx: TenantContext,
  day: string,
  limits: AiLimits,
): Promise<Exclude<InsightGate, "ja_rodou">> {
  if (!assistantConfigured()) return "sem_chave";
  const flags = await readPlatformFlags();
  if (!flags.aiEnabled || flags.maintenance) return "desligado";
  // Sem o assistente no plano, nem dicas nem categorias com IA: nada disso gasta mensagem, mas tem custo.
  if (!canUse(await readFamilyAccess(ctx, flags), "assistente")) return "sem_plano";
  if ((await monthSpend(day, limits)).reached) return "teto_mensal";
  const settings = await readAssistantSettings(ctx);
  const version = settings?.consentVersion ?? "";
  if (!settings?.consentAt || !legalVersionAtLeast(version, INSIGHTS_CONSENT_VERSION)) {
    return "sem_aceite";
  }
  return "pronto";
}

export async function insightGate(ctx: TenantContext, day: string, limits: AiLimits) {
  const gate = await nightGate(ctx, day, limits);
  if (gate !== "pronto") return gate;
  const done = await withHousehold(ctx, (tx) =>
    tx
      .select({ id: householdInsights.id })
      .from(householdInsights)
      .where(eq(householdInsights.day, day))
      .limit(1),
  );
  return done.length > 0 ? ("ja_rodou" as const) : ("pronto" as const);
}

const SPECIALIST_BRIEF = (name: Specialist) =>
  `Rotina da madrugada: não há pessoa conversando com você. Você é o especialista em ${SPECIALISTS[name].focus}. Olhe os números com as ferramentas e escolha até ${MAX_PER_SPECIALIST} dicas que mais ajudem esta família a organizar o dinheiro e chegar à aposentadoria. Cada dica diz o que fazer agora e o efeito disso, com valores copiados das ferramentas. Sem dado para sustentar uma dica, devolva a lista vazia: isso é melhor que uma dica genérica. Nunca cite ativo específico nem diga para comprar ou vender. "tela" é uma destas: ${SPECIALISTS[name].screens.join(", ")}. "destino" é a tela onde a família resolve. "porque" explica de onde veio a dica, em uma ou duas frases. Prioridade 1 é a mais urgente. Termine só com o JSON.`;

const ORCHESTRATOR_BRIEF = `Rotina da madrugada: não há pessoa conversando com você. Abaixo estão os relatórios de hoje da família. Escolha só os especialistas com algo novo ou importante a dizer, no máximo três: ${SPECIALIST_NAMES.join(", ")}. Responda só com o JSON.`;

function textOf(message: ModelMessage): string {
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface InsightRun {
  gate: InsightGate;
  specialists: number;
  created: number;
  discarded: number;
}

interface Night {
  ctx: TenantContext;
  client: ModelClient;
  day: string;
  limits: AiLimits;
  privacy: PrivacyFilter;
  /** Idioma de quem definiu o aceite: é nele que as dicas ficam gravadas. */
  locale: AssistantLocale;
  currency: Currency;
  accountType: AccountType;
  access: FamilyAccess;
}

async function ask(
  night: Night,
  messages: MessageParam[],
  withTools: boolean,
  format: OutputFormat,
) {
  const { ctx, client, day, limits } = night;
  if ((await monthSpend(day, limits)).reached) throw new NightStop();
  const params = requestParams(NIGHT_ROUTE, messages, withTools, format, night.access);
  const message = await client.stream(params, {}).finalMessage();
  await recordUsage(ctx, NIGHT_ROUTE.name, day, usageOf(message));
  return message;
}

class NightStop extends Error {}

async function chooseSpecialists(night: Night, reports: string): Promise<Specialist[]> {
  const message = await ask(
    night,
    [
      { role: "user", content: reports },
      {
        role: "system",
        content: `${ORCHESTRATOR_BRIEF} ${turnContext({ today: night.day, currency: night.currency, accountType: night.accountType })}`,
      },
    ],
    false,
    ORCHESTRATOR_FORMAT,
  );
  const parsed = orchestratorAnswer.safeParse(parseJson(textOf(message)));
  const chosen = parsed.success ? [...new Set(parsed.data.especialistas)].slice(0, 3) : [];
  return parsed.success ? chosen : DEFAULT_SPECIALISTS;
}

/** Roda um especialista. Devolve as dicas propostas e o texto de tudo o que as ferramentas deram. */
async function runSpecialist(night: Night, name: Specialist, reports: string) {
  const tools = toolsFor(NIGHT_ROUTE, night.access);
  const sources = [reports];
  const messages: MessageParam[] = [
    { role: "user", content: reports },
    {
      role: "system",
      content: `${SPECIALIST_BRIEF(name)} ${turnContext({
        today: night.day,
        locale: night.locale,
        currency: night.currency,
        accountType: night.accountType,
      })}`,
    },
  ];
  for (let step = 0; step < NIGHT_ROUTE.maxIterations; step += 1) {
    const withTools = step < NIGHT_ROUTE.maxIterations - 1;
    const message = await ask(night, messages, withTools, INSIGHTS_FORMAT);
    if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") break;
    const calls = message.content.filter((block) => block.type === "tool_use");
    if (calls.length === 0) {
      const parsed = insightAnswer.safeParse(parseJson(textOf(message)));
      return { drafts: parsed.success ? parsed.data.dicas : [], sources };
    }
    messages.push({ role: "assistant", content: echoContent(message.content) });
    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const outcome = await executeTool(tools, night.ctx, night.privacy, call.name, call.input);
      if (outcome.ok) sources.push(outcome.content);
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: outcome.content,
        ...(outcome.ok ? {} : { is_error: true }),
      });
    }
    messages.push({ role: "user", content: results });
  }
  return { drafts: [] as InsightDraft[], sources };
}

const dedupeOf = (draft: InsightDraft) =>
  `${draft.tela}:${normalizeDescription(draft.titulo)}`.slice(0, 160);

/** Dica que a família dispensou ou fez não volta por 30 dias; as de ontem saem de cena nas telas novas. */
async function saveInsights(night: Night, drafts: InsightDraft[]): Promise<number> {
  const { ctx, day } = night;
  if (drafts.length === 0) return 0;
  return withHousehold(ctx, async (tx) => {
    const decided = await tx
      .select({ key: householdInsights.dedupeKey })
      .from(householdInsights)
      .where(
        and(
          ne(householdInsights.status, "ativa"),
          gte(householdInsights.day, shiftDays(day, -BLOCK_DAYS)),
        ),
      );
    const blocked = new Set(decided.map((row) => row.key));
    const fresh = drafts.filter((draft) => !blocked.has(dedupeOf(draft)));
    for (const screen of new Set(fresh.map((draft) => draft.tela))) {
      await tx
        .update(householdInsights)
        .set({ status: "vencida" })
        .where(
          and(
            eq(householdInsights.screen, screen),
            eq(householdInsights.status, "ativa"),
            lt(householdInsights.day, day),
          ),
        );
    }
    if (fresh.length === 0) return 0;
    const rows = await tx
      .insert(householdInsights)
      .values(
        fresh.map((draft) => ({
          householdId: ctx.householdId,
          screen: draft.tela,
          destination: draft.destino,
          title: draft.titulo,
          body: draft.texto,
          why: draft.porque,
          priority: draft.prioridade,
          day,
          expiresOn: shiftDays(day, VALID_DAYS),
          dedupeKey: dedupeOf(draft),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: householdInsights.id });
    return rows.length;
  });
}

export interface NightInput {
  ctx: TenantContext;
  client: ModelClient;
  day?: string;
  limits?: AiLimits;
}

/** Uma família. Falha da API sobe para o job, que conta e segue para a próxima. */
export async function runNightlyInsights(input: NightInput): Promise<InsightRun> {
  const { ctx, client, day = serviceDay(), limits = aiLimits() } = input;
  const run: InsightRun = { gate: "pronto", specialists: 0, created: 0, discarded: 0 };
  const gate = await tolerateSchemaLag(() => insightGate(ctx, day, limits), "desligado" as const);
  if (gate !== "pronto") return { ...run, gate };

  const privacy = await withHousehold(ctx, (tx) => loadPrivacyFilter(tx, ctx.householdId));
  const locale = await nightLocale(ctx);
  const currency = await withHousehold(ctx, householdCurrency);
  const accountType = await householdAccountType(ctx.householdId);
  const access = await readFamilyAccess(ctx);
  const night: Night = { ctx, client, day, limits, privacy, locale, currency, accountType, access };
  const tools = toolsFor(NIGHT_ROUTE, access);
  const report = await executeTool(tools, ctx, privacy, "relatorios_do_dia", {});
  if (!report.ok) return run;

  try {
    const chosen = await chooseSpecialists(night, report.content);
    run.specialists = chosen.length;
    const approved: InsightDraft[] = [];
    for (const name of chosen) {
      const { drafts, sources } = await runSpecialist(night, name, report.content);
      const known = knownNumbers(sources);
      const allowed: readonly InsightScreen[] = SPECIALISTS[name].screens;
      for (const draft of drafts.slice(0, MAX_PER_SPECIALIST)) {
        const text = `${draft.titulo}\n${draft.texto}\n${draft.porque}`;
        if (!allowed.includes(draft.tela) || rejectionOf(text, known, privacy)) {
          run.discarded += 1;
        } else {
          approved.push(draft);
        }
      }
    }
    run.created = await saveInsights(night, approved);
  } catch (error) {
    if (!(error instanceof NightStop)) throw error;
    return { ...run, gate: "teto_mensal" };
  }
  return run;
}
