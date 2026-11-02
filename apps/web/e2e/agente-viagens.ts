// Só e2e: faz o papel da madrugada para uma família, com o agente de viagens de verdade, pela conexão do
// worker. O orçamento vem em memória, como o worker passa depois de calcular a divisão.
//   tsx apps/web/e2e/agente-viagens.ts rodar "<família>" <viagens por ano> <orçamento mensal>
//   tsx apps/web/e2e/agente-viagens.ts so-ver "<família>"
import { runViagensAgent } from "@organizeup/agents";
import {
  closeAllPools,
  eq,
  household,
  householdMember,
  householdSettings,
  people,
  withAdmin,
  withWorkerHousehold,
} from "@organizeup/db";
import { todayIn } from "@organizeup/domain";

const [command, family, tripsPerYear, budget] = process.argv.slice(2);

const [row] = await withAdmin("e2e das intenções de viagem", (admin) =>
  admin.select({ id: household.id }).from(household).where(eq(household.name, family!)),
);
if (!row) throw new Error("família não encontrada");
const householdId = row.id;

if (command === "so-ver") {
  await withAdmin("e2e das intenções de viagem", (admin) =>
    admin
      .update(householdMember)
      .set({ role: "viewer" })
      .where(eq(householdMember.organizationId, householdId)),
  );
} else {
  const today = todayIn();
  await withWorkerHousehold(householdId, async (tx) => {
    await tx
      .update(householdSettings)
      .set({ tripsPerYear: Number(tripsPerYear), tripDays: 5 })
      .where(eq(householdSettings.householdId, householdId));
    const known = await tx.select({ id: people.id }).from(people);
    if (known.length === 0)
      await tx.insert(people).values({ householdId, name: "Titular", relation: "titular" });
    await runViagensAgent(tx, {
      today,
      householdId,
      allocation: {
        reserve: "0.00",
        debt: "0.00",
        retirement: "0.00",
        goalsBudget: "0.00",
        tripsBudget: budget!,
        tripsCommitted: "0.00",
        shortfall: "0.00",
        notes: [],
      },
    });
  });
}
await closeAllPools();
