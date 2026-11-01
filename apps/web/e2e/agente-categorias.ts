// Só e2e: faz o papel da madrugada para uma família, com o agente de verdade, pela conexão do worker.
//   tsx apps/web/e2e/agente-categorias.ts rodar "<família>" "<descrição>" <valor>
//   tsx apps/web/e2e/agente-categorias.ts so-ver "<família>"
import { runCategoriasAgent } from "@organizeup/agents";
import {
  accounts,
  and,
  categories,
  closeAllPools,
  eq,
  household,
  householdMember,
  transactions,
  withAdmin,
  withWorkerHousehold,
} from "@organizeup/db";
import { todayIn } from "@organizeup/domain";

const [command, family, description, amount] = process.argv.slice(2);

const [row] = await withAdmin("e2e das notificações", (admin) =>
  admin.select({ id: household.id }).from(household).where(eq(household.name, family!)),
);
if (!row) throw new Error("família não encontrada");
const householdId = row.id;

if (command === "so-ver") {
  await withAdmin("e2e das notificações", (admin) =>
    admin
      .update(householdMember)
      .set({ role: "viewer" })
      .where(eq(householdMember.organizationId, householdId)),
  );
} else {
  const today = todayIn();
  await withWorkerHousehold(householdId, async (tx) => {
    const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
    const [fallback] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, "Outras despesas"), eq(categories.kind, "despesa")));
    await tx.insert(transactions).values({
      householdId,
      accountId: account!.id,
      categoryId: fallback!.id,
      kind: "despesa",
      description: description!,
      amount: amount!,
      occurredOn: today,
      categorySource: "familia",
    });
  });
  await withWorkerHousehold(householdId, (tx) => runCategoriasAgent(tx, { today, householdId }));
}
await closeAllPools();
