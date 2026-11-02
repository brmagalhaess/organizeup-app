// Só e2e: mexe na chave da cobrança e no plano de uma família, como o painel e o webhook fariam. Precisa
// de E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL.
//   tsx apps/web/e2e/plano-familia.ts chave on|off
//   tsx apps/web/e2e/plano-familia.ts plano "<família>" base:50,modulo:metas
//   tsx apps/web/e2e/plano-familia.ts vencer "<família>"
//   tsx apps/web/e2e/plano-familia.ts stripe "<família>"
//   tsx apps/web/e2e/plano-familia.ts desconto "<família>" 30
import {
  closeAllPools,
  eq,
  FLAG_KEYS,
  featureFlags,
  household,
  householdSubscriptions,
  withAdmin,
  withWorkerHousehold,
} from "@organizeup/db";

const [command, first, second] = process.argv.slice(2);

async function familyId(name: string) {
  const [row] = await withAdmin("e2e dos planos", (admin) =>
    admin.select({ id: household.id }).from(household).where(eq(household.name, name)),
  );
  if (!row) throw new Error("família não encontrada");
  return row.id;
}

if (command === "chave") {
  await withAdmin("e2e dos planos", (admin) =>
    admin
      .update(featureFlags)
      .set({ enabled: first === "on" })
      .where(eq(featureFlags.key, FLAG_KEYS.billing)),
  );
} else if (command === "plano") {
  const householdId = await familyId(first!);
  await withWorkerHousehold(householdId, (tx) =>
    tx
      .update(householdSubscriptions)
      .set({
        courtesy: false,
        status: "active",
        cycle: "mes",
        currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        items: (second ?? "").split(",").map((item) => ({
          price: `price_e2e_${item.replace(":", "_")}`,
          item,
          amount: "9.90",
          quantity: 1,
        })),
      })
      .where(eq(householdSubscriptions.householdId, householdId)),
  );
} else if (command === "stripe") {
  // Como se a assinatura existisse na Stripe, com a primeira cobrança ontem. Nada é chamado lá.
  const householdId = await familyId(first!);
  const suffix = householdId.replaceAll("-", "").slice(0, 24);
  await withWorkerHousehold(householdId, (tx) =>
    tx
      .update(householdSubscriptions)
      .set({
        stripeCustomerId: `cus_e2e${suffix}`,
        stripeSubscriptionId: `sub_e2e${suffix}`,
        firstPaidAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      })
      .where(eq(householdSubscriptions.householdId, householdId)),
  );
} else if (command === "desconto") {
  // Como o webhook, quando o cupom entra na assinatura.
  const householdId = await familyId(first!);
  await withWorkerHousehold(householdId, (tx) =>
    tx
      .update(householdSubscriptions)
      .set({ discountPercent: Number(second) })
      .where(eq(householdSubscriptions.householdId, householdId)),
  );
} else if (command === "vencer") {
  const householdId = await familyId(first!);
  await withWorkerHousehold(householdId, (tx) =>
    tx
      .update(householdSubscriptions)
      .set({ courtesy: false, trialEndsAt: new Date(Date.now() - 1000) })
      .where(eq(householdSubscriptions.householdId, householdId)),
  );
} else {
  throw new Error("comando desconhecido");
}
await closeAllPools();
