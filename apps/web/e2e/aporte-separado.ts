// Só e2e: mês passado com salário, mercado, aporte em real, aporte em dólar e resgate, tudo ligado a
// operações, e roda o agente de relatórios pela conexão do worker. Dia fixo em 1 a 5, para valer em qualquer dia.
//   tsx apps/web/e2e/aporte-separado.ts "<família>"
import { runRelatoriosAgent } from "@organizeup/agents";
import {
  accounts,
  and,
  categories,
  closeAllPools,
  ensureCategory,
  eq,
  household,
  investments,
  investmentTrades,
  transactions,
  withAdmin,
  withWorkerHousehold,
} from "@organizeup/db";
import { addMonths, CONTRIBUTION_CATEGORY, todayIn, yearMonthOf } from "@organizeup/domain";

const [family] = process.argv.slice(2);

const [row] = await withAdmin("e2e do aporte separado", (admin) =>
  admin.select({ id: household.id }).from(household).where(eq(household.name, family!)),
);
if (!row) throw new Error("família não encontrada");
const householdId = row.id;
const today = todayIn();
const month = addMonths(yearMonthOf(today), -1);

await withWorkerHousehold(householdId, async (tx) => {
  const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
  await tx.update(accounts).set({ openingBalance: "1000.00" }).where(eq(accounts.id, account!.id));
  const [dollars] = await tx
    .insert(accounts)
    .values({ householdId, name: "Conta em dólar", currency: "USD", openingBalance: "200.00" })
    .returning({ id: accounts.id });
  const categoryOf = async (name: string, kind: "receita" | "despesa") => {
    const [found] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, name), eq(categories.kind, kind)));
    if (!found) throw new Error(`sem categoria ${name}`);
    return found.id;
  };
  const out = await ensureCategory(tx, householdId, "despesa", CONTRIBUTION_CATEGORY, false);
  const back = await ensureCategory(tx, householdId, "receita", CONTRIBUTION_CATEGORY, false);
  const base = { householdId, accountId: account!.id, categorySource: "familia" as const };
  await tx.insert(transactions).values([
    {
      ...base,
      kind: "receita",
      categoryId: await categoryOf("Salário", "receita"),
      description: "Salário",
      amount: "9200.00",
      occurredOn: `${month}-01`,
    },
    {
      ...base,
      kind: "despesa",
      categoryId: await categoryOf("Mercado", "despesa"),
      description: "Supermercado Bom",
      amount: "2000.00",
      occurredOn: `${month}-02`,
    },
  ]);
  const [asset] = await tx
    .insert(investments)
    .values({
      householdId,
      name: "CDB de teste",
      assetClass: "renda_fixa",
      currentValue: "1700.00",
      valuedOn: today,
    })
    .returning({ id: investments.id });
  const cash = await tx
    .insert(transactions)
    .values([
      {
        ...base,
        kind: "despesa",
        categoryId: out.id,
        description: "Aporte em CDB de teste",
        amount: "1500.00",
        occurredOn: `${month}-03`,
      },
      {
        ...base,
        accountId: dollars!.id,
        kind: "despesa",
        categoryId: out.id,
        description: "Aporte em CDB de teste",
        amount: "500.00",
        originalAmount: "100.00",
        originalCurrency: "USD",
        fxRate: "5.00000000",
        occurredOn: `${month}-04`,
      },
      {
        ...base,
        kind: "receita",
        categoryId: back.id,
        description: "Resgate de CDB de teste",
        amount: "300.00",
        occurredOn: `${month}-05`,
      },
    ])
    .returning({ id: transactions.id });
  const trade = (side: "compra" | "venda", amount: string, day: string, cashId: string) => ({
    householdId,
    investmentId: asset!.id,
    side,
    occurredOn: `${month}-${day}`,
    quantity: amount,
    unitPrice: "1",
    fees: "0.00",
    transactionId: cashId,
  });
  await tx
    .insert(investmentTrades)
    .values([
      trade("compra", "1500", "03", cash[0]!.id),
      trade("compra", "500", "04", cash[1]!.id),
      trade("venda", "300", "05", cash[2]!.id),
    ]);
});
await withWorkerHousehold(householdId, (tx) => runRelatoriosAgent(tx, { today, householdId }));
await closeAllPools();
