// Dados iniciais do financeiro de um household. Idempotente e seguro sob concorrência
// (a abertura da primeira tela dispara requisições simultâneas). Rode dentro de withHousehold.
import { normalizeDescription } from "@organizeup/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, categories, categoryTemplates, type EntryKind } from "./schema";
import type { TenantTx } from "./tenant";

async function hasDefaults(tx: TenantTx): Promise<boolean> {
  const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
  const [category] = await tx.select({ id: categories.id }).from(categories).limit(1);
  return Boolean(account && category);
}

/**
 * Categorias usadas pelo próprio sistema (cartão, dívidas, metas, aportes). Famílias antigas não
 * as receberam na criação; `ensureFinanceDefaults` completa o que faltar.
 */
export const SYSTEM_TEMPLATES = ["d-cartao", "d-dividas", "d-metas", "r-metas", "d-aportes"];

async function ensureSystemCategories(tx: TenantTx, householdId: string): Promise<void> {
  const templates = await tx
    .select()
    .from(categoryTemplates)
    .where(inArray(categoryTemplates.id, SYSTEM_TEMPLATES));
  const existing = await tx
    .select({ name: categories.name, kind: categories.kind })
    .from(categories)
    .where(
      inArray(
        categories.name,
        templates.map((t) => t.name),
      ),
    );
  // "Metas e objetivos" existe como despesa e como receita: compara o par (tipo, nome).
  const have = new Set(existing.map((c) => `${c.kind}:${c.name}`));
  const missing = templates.filter((t) => !have.has(`${t.kind}:${t.name}`));
  if (missing.length === 0) return;
  await tx
    .insert(categories)
    .values(
      missing.map((t) => ({
        householdId,
        name: t.name,
        kind: t.kind,
        essential: t.essential,
        position: t.position,
      })),
    )
    .onConflictDoNothing();
}

export async function ensureFinanceDefaults(tx: TenantTx, householdId: string): Promise<void> {
  if (await hasDefaults(tx)) {
    await ensureSystemCategories(tx, householdId);
    return;
  }

  // Trava liberada no fim da transação: só uma requisição cria os dados por household.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${householdId}, 7310))`);

  const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
  if (!account) {
    await tx.insert(accounts).values({ householdId, name: "Conta principal", type: "corrente" });
  }
  const [category] = await tx.select({ id: categories.id }).from(categories).limit(1);
  if (!category) {
    const templates = await tx.select().from(categoryTemplates);
    await tx
      .insert(categories)
      .values(
        templates.map((t) => ({
          householdId,
          name: t.name,
          kind: t.kind,
          essential: t.essential,
          position: t.position,
        })),
      )
      .onConflictDoNothing();
  }
}

/**
 * Garante uma categoria pelo nome (comparado sem acento, caixa ou pontuação) e tipo. Se existir
 * arquivada, desarquiva; se não existir, cria. Usado pela importação e pelo agente de categorias.
 */
export async function ensureCategory(
  tx: TenantTx,
  householdId: string,
  kind: EntryKind,
  name: string,
  essential: boolean,
): Promise<{ id: string; created: boolean }> {
  const trimmed = name.trim();
  const wanted = normalizeDescription(trimmed);
  const rows = await tx
    .select({ id: categories.id, name: categories.name, archived: categories.archived })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.kind, kind)));
  const known = rows.find((c) => normalizeDescription(c.name) === wanted);
  if (known) {
    if (known.archived) {
      await tx.update(categories).set({ archived: false }).where(eq(categories.id, known.id));
    }
    return { id: known.id, created: false };
  }
  const [created] = await tx
    .insert(categories)
    .values({ householdId, name: trimmed, kind, essential })
    .returning({ id: categories.id });
  return { id: created!.id, created: true };
}
