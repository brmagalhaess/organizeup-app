import "server-only";
import {
  AUTOMATIC_SUGGESTION_KINDS,
  linkPayloadSchema,
  viagemPayloadSchema,
  type ViagemPayload,
} from "@organizeup/agents";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  householdSettings,
  householdSuggestions,
  notInArray,
  people,
  sql,
  tolerateSchemaLag,
  withHousehold,
  type SuggestionKind,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import { ageFromBirth, DEFAULT_TIMEZONE, todayIn, TRIP_RULES } from "@organizeup/domain";

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
  /** Tela relacionada, nos avisos que só apontam para outro lugar. */
  href: string | null;
}

export interface AutomaticItem {
  id: string;
  title: string;
  body: string;
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
  "id" | "kind" | "title" | "body" | "payload"
>;

const pendingColumns = {
  id: householdSuggestions.id,
  kind: householdSuggestions.kind,
  title: householdSuggestions.title,
  body: householdSuggestions.body,
  payload: householdSuggestions.payload,
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

function hrefOf(row: PendingRow): string | null {
  if (row.kind !== "investimento" && row.kind !== "lembrete") return null;
  const parsed = linkPayloadSchema.safeParse(row.payload);
  return parsed.success && parsed.data.href.startsWith("/app/") ? parsed.data.href : null;
}

const toItem = (row: PendingRow): PendingItem => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  href: hrefOf(row),
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
  automatic: AutomaticItem[];
}> {
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
        const groups = GROUPS.flatMap(({ key, kinds }) => {
          const rows = pending.filter((row) => kinds.includes(row.kind));
          return rows.length === 0 ? [] : [{ key, items: rows.map(toItem), bulk: bulkOf(rows) }];
        });
        return { groups, automatic };
      }),
    { groups: [], automatic: [] },
  );
}

/** Pendentes de um tipo, para mostrar na tela do assunto. */
export async function loadPendingOfKind(
  ctx: TenantContext,
  kind: SuggestionKind,
): Promise<PendingItem[]> {
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
        return rows.map(toItem);
      }),
    [],
  );
}

/** Cartão do painel: as mais recentes e o total. */
export async function loadTopSuggestions(
  ctx: TenantContext,
  limit = 3,
): Promise<{ items: Array<{ id: string; title: string }>; total: number }> {
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const items = await tx
          .select({ id: householdSuggestions.id, title: householdSuggestions.title })
          .from(householdSuggestions)
          .where(waitingForFamily)
          .orderBy(desc(householdSuggestions.createdAt))
          .limit(limit);
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
