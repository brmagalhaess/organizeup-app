// Dados iniciais do financeiro de um household. Idempotente e seguro sob concorrência
// (a abertura da primeira tela dispara requisições simultâneas). Rode dentro de withHousehold.
import { sql } from "drizzle-orm";
import { accounts, categories, categoryTemplates } from "./schema";
import type { TenantTx } from "./tenant";

async function hasDefaults(tx: TenantTx): Promise<boolean> {
  const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
  const [category] = await tx.select({ id: categories.id }).from(categories).limit(1);
  return Boolean(account && category);
}

export async function ensureFinanceDefaults(tx: TenantTx, householdId: string): Promise<void> {
  if (await hasDefaults(tx)) return;

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
