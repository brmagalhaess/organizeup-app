// Só e2e: põe lançamentos em três meses e roda o agente de relatórios de verdade, pela conexão do worker.
// Roda como se fosse dia 15: dá um mês em andamento e dois fechados, em qualquer dia do mês.
// Com "completa", a família também tem meta, viagem, carteira, proventos, dívida e fotos do patrimônio.
//   tsx apps/web/e2e/relatorios.ts "<família>" [completa]
import { createDebtWithSchedule, runRelatoriosAgent } from "@organizeup/agents";
import {
  accounts,
  and,
  categories,
  closeAllPools,
  dividends,
  eq,
  fromJob,
  goals,
  household,
  investments,
  investmentTargets,
  investmentTrades,
  netWorthSnapshots,
  transactions,
  tripCosts,
  trips,
  withAdmin,
  withWorkerHousehold,
} from "@organizeup/db";
import { addMonths, todayIn, yearMonthOf } from "@organizeup/domain";

const [family, mode] = process.argv.slice(2);

const [row] = await withAdmin("e2e dos relatórios", (admin) =>
  admin.select({ id: household.id }).from(household).where(eq(household.name, family!)),
);
if (!row) throw new Error("família não encontrada");
const householdId = row.id;
const month = yearMonthOf(todayIn());
const today = `${month}-15`;

await withWorkerHousehold(householdId, async (tx) => {
  const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
  const categoryOf = async (name: string, kind: "receita" | "despesa") => {
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, name), eq(categories.kind, kind)));
    if (!category) throw new Error(`sem categoria ${name}`);
    return category.id;
  };
  const salary = await categoryOf("Salário", "receita");
  const home = await categoryOf("Moradia", "despesa");
  const groceries = await categoryOf("Mercado", "despesa");
  const base = { householdId, accountId: account!.id, categorySource: "familia" as const };
  const monthRows = (ym: string, spent: string) => [
    {
      ...base,
      kind: "receita" as const,
      categoryId: salary,
      description: "Salário",
      amount: "8000.00",
      occurredOn: `${ym}-05`,
    },
    {
      ...base,
      kind: "despesa" as const,
      categoryId: home,
      description: "Aluguel",
      amount: "2000.00",
      occurredOn: `${ym}-06`,
    },
    {
      ...base,
      kind: "despesa" as const,
      categoryId: groceries,
      description: "Supermercado Bom",
      amount: spent,
      occurredOn: `${ym}-08`,
    },
  ];
  await tx
    .insert(transactions)
    .values([
      ...monthRows(addMonths(month, -2), "900.00"),
      ...monthRows(addMonths(month, -1), "1234.50"),
      ...monthRows(month, "300.00"),
    ]);
});
if (mode === "completa") {
  await withWorkerHousehold(householdId, async (tx) => {
    const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
    await tx.insert(goals).values({
      householdId,
      name: "Reforma da cozinha e do banheiro da casa de praia",
      kind: "reforma",
      targetAmount: "40000.00",
      saved: "12500.00",
      desiredMonth: addMonths(month, 12),
      planEnd: addMonths(month, 15),
      status: "juntando",
    });
    const [trip] = await tx
      .insert(trips)
      .values({
        householdId,
        destination: "Lisboa",
        startOn: `${addMonths(month, 8)}-10`,
        saved: "1000.00",
      })
      .returning({ id: trips.id });
    await tx
      .insert(tripCosts)
      .values({ householdId, tripId: trip!.id, kind: "passagem", amount: "9000.00" });
    const [fund] = await tx
      .insert(investments)
      .values({
        householdId,
        name: "Fundo imobiliário de teste",
        ticker: "TEST11",
        assetClass: "fii",
        currentPrice: "110.00000000",
        valuedOn: `${month}-01`,
      })
      .returning({ id: investments.id });
    await tx.insert(investmentTrades).values({
      householdId,
      investmentId: fund!.id,
      side: "compra",
      occurredOn: `${addMonths(month, -2)}-10`,
      quantity: "100",
      unitPrice: "100",
      fees: "5.00",
    });
    await tx.insert(investmentTargets).values({ householdId, assetClass: "fii", percent: "60" });
    await tx.insert(dividends).values({
      householdId,
      investmentId: fund!.id,
      kind: "rendimento",
      paidOn: `${addMonths(month, -1)}-15`,
      gross: "95.00",
      withheld: "0.00",
    });
    await createDebtWithSchedule(tx, fromJob({ householdId }), {
      name: "Empréstimo do carro",
      accountId: account!.id,
      terms: {
        system: "price",
        balance: "12000.00",
        monthlyRate: "2.5000",
        installments: 24,
        firstDueDate: `${addMonths(month, 1)}-05`,
      },
    });
    await tx.insert(netWorthSnapshots).values(
      [
        { month: addMonths(month, -2), net: "-15000.00" },
        { month: addMonths(month, -1), net: "4000.00" },
      ].map(({ month: shot, net }) => ({
        householdId,
        month: shot,
        owned: "20000.00",
        owed: "16000.00",
        net,
      })),
    );
  });
}
await withWorkerHousehold(householdId, (tx) => runRelatoriosAgent(tx, { today, householdId }));
await closeAllPools();
