// Memória da família (§3): o que a família pediu para o assistente lembrar. Vale a que não foi
// substituída nem venceu. Apagar é DELETE de verdade, e leva junto as versões antigas (FK em cascata).
import {
  and,
  desc,
  eq,
  gte,
  householdMemories,
  isNull,
  or,
  sql,
  tolerateSchemaLag,
  withHousehold,
  type HouseholdMemoryKind,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";

/** Memórias vigentes por família. Passou disso, a pessoa escolhe o que apagar em Configurações. */
export const MAX_ACTIVE_MEMORIES = 50;
/** Quantas vão para o contexto de cada conversa, das mais novas às mais antigas. */
export const MAX_TURN_MEMORIES = 20;

/** Vigente: não foi substituída e não venceu. */
export const activeMemory = (today: string) =>
  and(
    isNull(householdMemories.supersededBy),
    or(isNull(householdMemories.expiresOn), gte(householdMemories.expiresOn, today)),
  );

export interface TurnMemory {
  tipo: HouseholdMemoryKind;
  texto: string;
}

/** Sem a tabela, a conversa segue sem memória: a web pode subir antes do worker. */
export const memoriesForTurn = (ctx: TenantContext, today: string): Promise<TurnMemory[]> =>
  tolerateSchemaLag(
    () =>
      withHousehold(ctx, (tx) =>
        tx
          .select({ tipo: householdMemories.kind, texto: householdMemories.content })
          .from(householdMemories)
          .where(activeMemory(today))
          .orderBy(desc(householdMemories.createdAt))
          .limit(MAX_TURN_MEMORIES),
      ),
    [],
  );

export interface MemoryRow {
  id: string;
  kind: HouseholdMemoryKind;
  content: string;
  expiresOn: string | null;
  createdAt: Date;
}

/** Para a tela "O que o assistente sabe": sem as substituídas, com as vencidas, que ainda estão guardadas. */
export const listMemories = (ctx: TenantContext): Promise<MemoryRow[]> =>
  tolerateSchemaLag(
    () =>
      withHousehold(ctx, (tx) =>
        tx
          .select({
            id: householdMemories.id,
            kind: householdMemories.kind,
            content: householdMemories.content,
            expiresOn: householdMemories.expiresOn,
            createdAt: householdMemories.createdAt,
          })
          .from(householdMemories)
          .where(isNull(householdMemories.supersededBy))
          .orderBy(desc(householdMemories.createdAt)),
      ),
    [],
  );

/** Quantas foram apagadas, contando as versões antigas. O RLS só deixa quem pode escrever. */
export const deleteMemory = (tx: TenantTx, id: string) =>
  tx.delete(householdMemories).where(eq(householdMemories.id, id)).returning({
    id: householdMemories.id,
  });

export const deleteAllMemories = (tx: TenantTx) =>
  tx.delete(householdMemories).returning({ id: householdMemories.id });

/** Radicais em português, sem acento e sem palavras vazias. Para comparar memórias. */
export async function memoryWords(tx: TenantTx, text: string): Promise<string[]> {
  const rows = await tx.execute<{ words: string }>(
    sql`select array_to_string(
          tsvector_to_array(to_tsvector('portuguese', sem_acento(${text}))), ' ') as words`,
  );
  return splitWords(rows[0]?.words);
}

const splitWords = (text: string | null | undefined) => (text ? text.split(" ") : []);

/** Parte das palavras que as duas têm em comum: 1 é igual, 0 é nada a ver. */
export function overlap(first: string[], second: string[]): number {
  const one = new Set(first);
  const two = new Set(second);
  const shared = [...one].filter((word) => two.has(word)).length;
  const total = new Set([...one, ...two]).size;
  return total === 0 ? 0 : shared / total;
}

/** A partir daqui, é a mesma memória dita de outro jeito ou atualizada. */
const SAME_MEMORY = 0.6;

export interface ActiveMemoryWords {
  id: string;
  words: string[];
}

/** Memórias vigentes do mesmo tipo, com as palavras de cada uma. */
export async function activeOfKind(
  tx: TenantTx,
  kind: HouseholdMemoryKind,
  today: string,
): Promise<ActiveMemoryWords[]> {
  const rows = await tx
    .select({
      id: householdMemories.id,
      words: sql<string>`array_to_string(tsvector_to_array(household_memories.search), ' ')`,
    })
    .from(householdMemories)
    .where(and(activeMemory(today), eq(householdMemories.kind, kind)));
  return rows.map((row) => ({ id: row.id, words: splitWords(row.words) }));
}

export const similarMemories = (rows: ActiveMemoryWords[], words: string[]) =>
  rows.filter((row) => overlap(row.words, words) >= SAME_MEMORY).map((row) => row.id);

/** Vigentes da família inteira, para o limite. */
export async function countActive(tx: TenantTx, today: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(householdMemories)
    .where(activeMemory(today));
  return row?.total ?? 0;
}
