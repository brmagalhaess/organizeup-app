import "server-only";
import {
  AUTOMATIC_SUGGESTION_KINDS,
  linkPayloadSchema,
  loadIntentionDecisions,
  viagemPayloadSchema,
  type ReportViagens,
  type ViagemPayload,
} from "@organizeup/agents";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  householdReports,
  householdSettings,
  householdSuggestions,
  inArray,
  notInArray,
  people,
  sql,
  tolerateSchemaLag,
  tripDestinationTemplates,
  tripIntentions,
  trips,
  withHousehold,
  type DestinationRegion,
  type SuggestionKind,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  ageFromBirth,
  DEFAULT_TIMEZONE,
  todayIn,
  TRIP_RULES,
  type IntentionOutcome,
} from "@organizeup/domain";
import { agentText } from "@/i18n/agent-text";
import type { Locale } from "@/i18n/locales";
import { resolveLocale } from "@/i18n/resolve";

/** Só estes tipos aceitam "Aplicar tudo": nenhum deles decide sobre dinheiro da família. */
export const BULK_KINDS = ["investimento", "lembrete"] as const;
export type BulkKind = (typeof BULK_KINDS)[number];

/** Quantos dias "O que o assistente fez sozinho" olha para trás. */
const AUTOMATIC_DAYS = 7;

export type SuggestionGroupKey = "aportes" | "viagens" | "metas" | "investimentos" | "lembretes";

const GROUPS: Array<{ key: SuggestionGroupKey; kinds: SuggestionKind[] }> = [
  { key: "aportes", kinds: ["aporte_reserva", "aporte_investimento", "aporte_divida"] },
  { key: "viagens", kinds: ["viagem"] },
  { key: "metas", kinds: ["meta"] },
  { key: "investimentos", kinds: ["investimento"] },
  { key: "lembretes", kinds: ["lembrete"] },
];

export interface PendingItem {
  id: string;
  kind: SuggestionKind;
  title: string;
  body: string;
  /** Falso: texto gravado em português, de antes das chaves. */
  translated: boolean;
  /** Tela relacionada, nos avisos que só apontam para outro lugar. */
  href: string | null;
  /** Veio de uma intenção de viagem: recusar vale o ano, não 30 dias. */
  fromIntention: boolean;
  /** Aceitar muda algum dado (cria meta ou viagem, grava valor). Falso: é só um aviso para marcar como visto. */
  acts: boolean;
}

/** Sugestão que a família aceitou e que mudou algo: aparece na tela com o caminho de onde ficou. */
export interface AcceptedItem extends AutomaticItem {
  /** Tela onde o resultado ficou. */
  href: string;
}

export interface AutomaticItem {
  id: string;
  title: string;
  body: string;
  translated: boolean;
}

export interface SuggestionBulk {
  kind: BulkKind;
  /** Quantos itens a pergunta do ConfirmSheet de "Aplicar tudo" cita. */
  count: number;
}

export interface SuggestionGroup {
  key: SuggestionGroupKey;
  items: PendingItem[];
  bulk: SuggestionBulk | null;
}

type PendingRow = Pick<
  typeof householdSuggestions.$inferSelect,
  "id" | "kind" | "title" | "body" | "payload" | "messageKey" | "messageParams"
>;

const pendingColumns = {
  id: householdSuggestions.id,
  kind: householdSuggestions.kind,
  title: householdSuggestions.title,
  body: householdSuggestions.body,
  payload: householdSuggestions.payload,
  messageKey: householdSuggestions.messageKey,
  messageParams: householdSuggestions.messageParams,
};

export { tolerateSchemaLag } from "@organizeup/db";

/**
 * O que espera a família. Categoria não pergunta mais: pendente antiga é resolvida na próxima rodada do
 * agente, e até lá não aparece.
 */
const waitingForFamily = and(
  eq(householdSuggestions.status, "pendente"),
  notInArray(householdSuggestions.kind, [...AUTOMATIC_SUGGESTION_KINDS]),
);

export const noticeCookie = (key: string) => `ou_notice_${key}`;

/** Segundos até a próxima meia-noite no fuso da família. */
export function secondsUntilMidnight(
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return 86_400 - (value("hour") * 3_600 + value("minute") * 60 + value("second"));
}

/** Sugestões pendentes da família. Rode dentro de withHousehold. */
export async function countPending(tx: TenantTx): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(householdSuggestions)
    .where(waitingForFamily);
  return row?.total ?? 0;
}

/** Onde fica o que a sugestão cria ou muda quando é aceita. */
const RESULT_HREF: Partial<Record<SuggestionKind, string>> = {
  aporte_reserva: "/app/reserva",
  aporte_investimento: "/app/aposentadoria",
  viagem: "/app/viagens",
  meta: "/app/metas",
};

/** Aceitar muda dado? Aviso, lembrete, pagamento extra de dívida e meta sem data proposta só anotam. */
function changesData(row: Pick<PendingRow, "kind" | "payload">): boolean {
  if (row.kind === "meta") {
    const { draft, proposedMonth } = row.payload as { draft?: unknown; proposedMonth?: unknown };
    return Boolean(draft) || typeof proposedMonth === "string";
  }
  return row.kind in RESULT_HREF;
}

function hrefOf(row: PendingRow): string | null {
  if (row.kind === "aporte_divida") return "/app/dividas";
  if (row.kind === "meta") return changesData(row) ? null : "/app/metas";
  if (row.kind !== "investimento" && row.kind !== "lembrete") return null;
  const parsed = linkPayloadSchema.safeParse(row.payload);
  return parsed.success && parsed.data.href.startsWith("/app/") ? parsed.data.href : null;
}

const toItem = (row: PendingRow, locale: Locale): PendingItem => ({
  id: row.id,
  kind: row.kind,
  ...agentText(row, locale),
  href: hrefOf(row),
  fromIntention: row.kind === "viagem" && "intentionId" in row.payload,
  acts: changesData(row),
});

function bulkOf(rows: PendingRow[]): SuggestionBulk | null {
  for (const kind of BULK_KINDS) {
    const same = rows.filter((row) => row.kind === kind);
    if (same.length < 2) continue;
    return { kind, count: same.length };
  }
  return null;
}

/** Tudo da tela /app/sugestoes: o que espera decisão e o que o assistente fez sozinho na semana. */
export async function loadSuggestions(ctx: TenantContext): Promise<{
  groups: SuggestionGroup[];
  accepted: AcceptedItem[];
  automatic: AutomaticItem[];
}> {
  const locale = await resolveLocale();
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const pending = await tx
          .select(pendingColumns)
          .from(householdSuggestions)
          .where(waitingForFamily)
          .orderBy(desc(householdSuggestions.createdAt));
        const since = new Date(Date.now() - AUTOMATIC_DAYS * 86_400_000);
        const automatic = await tx
          .select({
            id: householdSuggestions.id,
            title: householdSuggestions.title,
            body: householdSuggestions.body,
            messageKey: householdSuggestions.messageKey,
            messageParams: householdSuggestions.messageParams,
          })
          .from(householdSuggestions)
          .where(
            and(
              eq(householdSuggestions.status, "aplicada"),
              eq(householdSuggestions.appliedBy, "agente"),
              gte(householdSuggestions.decidedAt, since),
            ),
          )
          .orderBy(desc(householdSuggestions.decidedAt));
        const acceptedRows = await tx
          .select(pendingColumns)
          .from(householdSuggestions)
          .where(
            and(
              eq(householdSuggestions.status, "aplicada"),
              eq(householdSuggestions.appliedBy, "familia"),
              inArray(householdSuggestions.kind, Object.keys(RESULT_HREF) as SuggestionKind[]),
              gte(householdSuggestions.decidedAt, since),
            ),
          )
          .orderBy(desc(householdSuggestions.decidedAt));
        const groups = GROUPS.flatMap(({ key, kinds }) => {
          const rows = pending.filter((row) => kinds.includes(row.kind));
          if (rows.length === 0) return [];
          const items = rows.map((row) => toItem(row, locale));
          return [{ key, items, bulk: bulkOf(rows) }];
        });
        return {
          groups,
          accepted: acceptedRows.filter(changesData).map((row) => ({
            id: row.id,
            ...agentText(row, locale),
            href: RESULT_HREF[row.kind]!,
          })),
          automatic: automatic.map((row) => ({ id: row.id, ...agentText(row, locale) })),
        };
      }),
    { groups: [], accepted: [], automatic: [] },
  );
}

/** Pendentes de um tipo, para mostrar na tela do assunto. */
export async function loadPendingOfKind(
  ctx: TenantContext,
  kind: SuggestionKind,
): Promise<PendingItem[]> {
  const locale = await resolveLocale();
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const rows = await tx
          .select(pendingColumns)
          .from(householdSuggestions)
          .where(
            and(eq(householdSuggestions.status, "pendente"), eq(householdSuggestions.kind, kind)),
          )
          .orderBy(desc(householdSuggestions.createdAt));
        return rows.map((row) => toItem(row, locale));
      }),
    [],
  );
}

/** Cartão do painel: as mais recentes e o total. */
export async function loadTopSuggestions(
  ctx: TenantContext,
  limit = 3,
): Promise<{ items: Array<{ id: string; title: string }>; total: number }> {
  const locale = await resolveLocale();
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const rows = await tx
          .select({
            id: householdSuggestions.id,
            title: householdSuggestions.title,
            body: householdSuggestions.body,
            messageKey: householdSuggestions.messageKey,
            messageParams: householdSuggestions.messageParams,
          })
          .from(householdSuggestions)
          .where(waitingForFamily)
          .orderBy(desc(householdSuggestions.createdAt))
          .limit(limit);
        const items = rows.map((row) => ({ id: row.id, title: agentText(row, locale).title }));
        return { items, total: await countPending(tx) };
      }),
    { items: [], total: 0 },
  );
}

export interface TripSuggestionItem extends ViagemPayload {
  id: string;
}

export interface TripSuggestions {
  tripsPerYear: number;
  today: string;
  /** Ano mais recente citado nas fontes da tabela de custos. */
  tableYear: string;
  adults: number;
  children: number;
  items: TripSuggestionItem[];
}

/** Ano da consulta mais recente citada na fonte ("consulta 10/2026", "jul/2026"). */
function sourceYear(items: ViagemPayload[], today: string): string {
  const years = items.flatMap((item) =>
    [...item.source.matchAll(/\/(20\d{2})\b/g)].map((match) => match[1]!),
  );
  return years.sort().at(-1) ?? today.slice(0, 4);
}

/** Sugestões de viagem pendentes. Null enquanto a migração não chegou. */
export async function loadTripSuggestions(ctx: TenantContext): Promise<TripSuggestions | null> {
  return tolerateSchemaLag<TripSuggestions | null>(
    () =>
      withHousehold(ctx, async (tx) => {
        const [settings] = await tx
          .select({
            tripsPerYear: householdSettings.tripsPerYear,
            timezone: householdSettings.timezone,
          })
          .from(householdSettings);
        const today = todayIn(settings?.timezone);
        const rows = await tx
          .select({ id: householdSuggestions.id, payload: householdSuggestions.payload })
          .from(householdSuggestions)
          .where(
            and(
              eq(householdSuggestions.status, "pendente"),
              eq(householdSuggestions.kind, "viagem"),
            ),
          );
        const items = rows
          .flatMap((row) => {
            const parsed = viagemPayloadSchema.safeParse(row.payload);
            return parsed.success ? [{ ...parsed.data, id: row.id }] : [];
          })
          .sort((a, b) => a.month.localeCompare(b.month));

        const going = new Set(items.flatMap((item) => item.personIds));
        const personRows = await tx
          .select({
            id: people.id,
            birthYear: people.birthYear,
            birthMonth: people.birthMonth,
          })
          .from(people)
          .orderBy(asc(people.createdAt));
        const [year, month] = today.split("-").map(Number) as [number, number];
        const children = personRows.filter(
          (person) =>
            going.has(person.id) &&
            person.birthYear !== null &&
            ageFromBirth(person.birthYear, person.birthMonth ?? 1, { year, month }) <
              TRIP_RULES.childAge,
        ).length;

        return {
          tripsPerYear: settings?.tripsPerYear ?? 0,
          today,
          tableYear: sourceYear(items, today),
          adults: going.size - children,
          children,
          items,
        };
      }),
    null,
  );
}

export interface CatalogDestination {
  id: string;
  name: string;
  /** Código ISO: a busca acha pelo nome do país. */
  country: string;
  region: DestinationRegion;
}

/** Só o que a tela mostra: as outras saídas do agente viram a própria situação. */
type AgentReason = Extract<
  IntentionOutcome,
  { status: "nao_cabe" | "sem_vaga" | "uma_por_ano" | "criancas" | "sem_estimativa" }
>;

export type IntentionState =
  | { status: "aguardando" }
  | { status: "sugerida"; month: string }
  | { status: "recusada"; untilYear: number }
  | { status: "atendida"; trip: { destination: string; startOn: string } | null }
  | AgentReason;

export interface TripIntentionItem {
  id: string;
  destinationId: string | null;
  /** Nome do catálogo, ou o que a família digitou. */
  name: string;
  region: DestinationRegion | null;
  customRegion: DestinationRegion | null;
  preferredMonth: number | null;
  days: number | null;
  state: IntentionState;
}

export interface TripIntentions {
  items: TripIntentionItem[];
  catalog: CatalogDestination[];
}

const AGENT_REASONS = new Set([
  "nao_cabe",
  "sem_vaga",
  "uma_por_ano",
  "criancas",
  "sem_estimativa",
]);

/** O bloco "Quero conhecer". Null enquanto a migração não chegou: a tela de Viagens segue sem ele. */
export async function loadTripIntentionItems(ctx: TenantContext): Promise<TripIntentions | null> {
  return tolerateSchemaLag<TripIntentions | null>(
    () =>
      withHousehold(ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(tripIntentions)
          .orderBy(asc(tripIntentions.createdAt), asc(tripIntentions.id));
        const catalog = await tx
          .select({
            id: tripDestinationTemplates.id,
            name: tripDestinationTemplates.name,
            country: tripDestinationTemplates.country,
            region: tripDestinationTemplates.region,
          })
          .from(tripDestinationTemplates)
          .orderBy(asc(tripDestinationTemplates.position), asc(tripDestinationTemplates.id));
        if (rows.length === 0) return { items: [], catalog };

        const [settings] = await tx
          .select({ timezone: householdSettings.timezone })
          .from(householdSettings);
        const year = Number(todayIn(settings?.timezone).slice(0, 4));
        const { refused } = await loadIntentionDecisions(tx);
        const pendingRows = await tx
          .select({ payload: householdSuggestions.payload })
          .from(householdSuggestions)
          .where(
            and(
              eq(householdSuggestions.status, "pendente"),
              eq(householdSuggestions.kind, "viagem"),
            ),
          );
        const pending = new Map(
          pendingRows.flatMap((row) => {
            const parsed = viagemPayloadSchema.safeParse(row.payload);
            return parsed.success && parsed.data.intentionId
              ? [[parsed.data.intentionId, parsed.data.month] as const]
              : [];
          }),
        );
        const [report] = await tx
          .select({ data: householdReports.data })
          .from(householdReports)
          .where(eq(householdReports.kind, "viagens"))
          .orderBy(desc(householdReports.period))
          .limit(1);
        const outcomes = (report?.data as ReportViagens | undefined)?.intentions?.outcomes ?? [];
        const tripIds = rows.flatMap((row) => row.fulfilledTripId ?? []);
        const tripRows =
          tripIds.length > 0
            ? await tx
                .select({ id: trips.id, destination: trips.destination, startOn: trips.startOn })
                .from(trips)
                .where(inArray(trips.id, tripIds))
            : [];

        const stateOf = (row: (typeof rows)[number]): IntentionState => {
          if (row.fulfilledAt) {
            const trip = tripRows.find((item) => item.id === row.fulfilledTripId);
            return {
              status: "atendida",
              trip: trip ? { destination: trip.destination, startOn: trip.startOn } : null,
            };
          }
          const month = pending.get(row.id);
          if (month) return { status: "sugerida", month };
          const untilYear = refused.get(row.id);
          if (untilYear !== undefined && untilYear >= year)
            return { status: "recusada", untilYear };
          // Editada depois da rodada: o motivo guardado é da versão antiga.
          const outcome = outcomes.find(
            (item) => item.intentionId === row.id && item.updatedAt === row.updatedAt.toISOString(),
          );
          return outcome && AGENT_REASONS.has(outcome.status)
            ? (outcome as AgentReason)
            : { status: "aguardando" };
        };

        return {
          catalog,
          items: rows.map((row) => {
            const known = catalog.find((item) => item.id === row.destinationId);
            return {
              id: row.id,
              destinationId: row.destinationId,
              name: known?.name ?? row.customName ?? "",
              region: known?.region ?? row.customRegion,
              customRegion: row.customRegion,
              preferredMonth: row.preferredMonth,
              days: row.days,
              state: stateOf(row),
            };
          }),
        };
      }),
    null,
  );
}
