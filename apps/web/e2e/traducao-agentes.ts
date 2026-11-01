// Só e2e: põe na família o que a madrugada e as telas gravam, com os agentes de verdade.
//   tsx apps/web/e2e/traducao-agentes.ts "<família>"
import { runAposentadoriaAgent, runCategoriasAgent } from "@organizeup/agents";
import {
  accounts,
  and,
  categories,
  closeAllPools,
  eq,
  household,
  householdNotifications,
  householdSuggestions,
  transactions,
  withAdmin,
  withWorkerHousehold,
} from "@organizeup/db";
import { CONTRIBUTION_CATEGORY, todayIn } from "@organizeup/domain";

const [family] = process.argv.slice(2);

const [row] = await withAdmin("e2e da tradução dos agentes", (admin) =>
  admin.select({ id: household.id }).from(household).where(eq(household.name, family!)),
);
if (!row) throw new Error("família não encontrada");
const householdId = row.id;
const today = todayIn();

await withWorkerHousehold(householdId, async (tx) => {
  const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
  const [fallback] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, "Outras despesas"), eq(categories.kind, "despesa")));
  const [contribution] = await tx
    .insert(categories)
    .values({ householdId, name: CONTRIBUTION_CATEGORY, kind: "despesa" })
    .onConflictDoNothing()
    .returning({ id: categories.id });
  const [existing] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, CONTRIBUTION_CATEGORY), eq(categories.kind, "despesa")));
  const base = { householdId, accountId: account!.id, occurredOn: today, kind: "despesa" as const };
  await tx.insert(transactions).values([
    {
      ...base,
      categoryId: fallback!.id,
      description: "SUPERMERCADO BOM",
      amount: "80.00",
      categorySource: "familia",
    },
    // Lançamento que o sistema gera ao registrar uma compra de investimento.
    {
      ...base,
      categoryId: (contribution ?? existing)!.id,
      description: "Aporte em PETR4",
      amount: "500.00",
      categorySource: "familia",
    },
  ]);
  // Linha de antes das chaves: tem que continuar aparecendo como foi gravada.
  await tx.insert(householdSuggestions).values({
    householdId,
    agent: "investimentos",
    kind: "lembrete",
    title: "Texto antigo gravado em português",
    body: "Linha sem chave, de antes da tradução.",
    payload: { href: "/app/investimentos" },
    dedupeKey: "lembrete:antigo",
  });
  await tx.insert(householdNotifications).values({
    householdId,
    kind: "categoria",
    title: "Aviso antigo em português",
    body: "Notificação sem chave.",
    data: {},
    dedupeKey: "antiga",
  });
});
await withWorkerHousehold(householdId, (tx) => runCategoriasAgent(tx, { today, householdId }));
await withWorkerHousehold(householdId, (tx) => runAposentadoriaAgent(tx, { today, householdId }));
await closeAllPools();
