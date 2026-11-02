// Só e2e: põe seis meses de movimento numa família e roda o agente de relatórios, pela conexão do worker.
// Gastos em várias categorias, compra parcelada no cartão, aporte que gera lançamento, transferência,
// carteira e proventos. As datas seguem hoje, com o dia fixo em 1 a 5, para o teste valer em qualquer dia.
//   tsx apps/web/e2e/painel.ts "<família>"
import { runRelatoriosAgent } from "@organizeup/agents";
import {
  accounts,
  accountTransfers,
  and,
  cardPurchases,
  cardStatementPayments,
  cashflowPlans,
  categories,
  closeAllPools,
  creditCards,
  dividends,
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

const [row] = await withAdmin("e2e do painel", (admin) =>
  admin.select({ id: household.id }).from(household).where(eq(household.name, family!)),
);
if (!row) throw new Error("família não encontrada");
const householdId = row.id;
const today = todayIn();
const month = yearMonthOf(today);
const back = (delta: number) => addMonths(month, -delta);

await withWorkerHousehold(householdId, async (tx) => {
  const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
  await tx.update(accounts).set({ openingBalance: "2500.00" }).where(eq(accounts.id, account!.id));
  const [savings] = await tx
    .insert(accounts)
    .values({ householdId, name: "Poupança da família", type: "poupanca" })
    .returning({ id: accounts.id });
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
  const fun = await categoryOf("Lazer", "despesa");
  const health = await categoryOf("Saúde", "despesa");
  const transport = await categoryOf("Transporte", "despesa");
  const pets = await ensureCategory(tx, householdId, "despesa", "Pet", false);
  const school = await ensureCategory(tx, householdId, "despesa", "Escola", false);
  const gifts = await ensureCategory(tx, householdId, "despesa", "Presentes", false);
  const aporte = await ensureCategory(tx, householdId, "despesa", CONTRIBUTION_CATEGORY, false);
  const cardCategory = await ensureCategory(tx, householdId, "despesa", "Cartão de crédito", false);
  const base = { householdId, accountId: account!.id, categorySource: "familia" as const };

  const spent = (ym: string, values: Array<[string, string, string]>) =>
    values.map(([categoryId, description, amount]) => ({
      ...base,
      kind: "despesa" as const,
      categoryId,
      description,
      amount,
      occurredOn: `${ym}-02`,
    }));
  const rows = [5, 4, 3, 2, 1].flatMap((delta) => {
    const ym = back(delta);
    const extra = String(180 + delta * 37);
    return [
      {
        ...base,
        kind: "receita" as const,
        categoryId: salary,
        description: "Salário",
        amount: "9200.00",
        occurredOn: `${ym}-01`,
      },
      ...spent(ym, [
        [home, "Aluguel do apartamento", "2300.00"],
        [groceries, "Supermercado Bom", `${900 + delta * 25}.00`],
        [fun, "Cinema e jantar", `${extra}.00`],
        [health, "Farmácia", "145.90"],
        [transport, "Combustível", "320.00"],
        [pets.id, "Ração", "160.00"],
        [school.id, "Mensalidade", "640.00"],
        [gifts.id, "Presente", "95.00"],
      ]),
    ];
  });
  await tx.insert(transactions).values(rows);

  const [card] = await tx
    .insert(creditCards)
    .values({
      householdId,
      name: "Visa da família",
      closingDay: 25,
      dueDay: 2,
      payingAccountId: account!.id,
      limitAmount: "8000.00",
    })
    .returning({ id: creditCards.id });
  await tx.insert(cardPurchases).values([
    {
      householdId,
      cardId: card!.id,
      categoryId: groceries,
      description: "Geladeira nova",
      amount: "3000.00",
      installments: 6,
      purchasedOn: `${back(3)}-15`,
    },
    {
      householdId,
      cardId: card!.id,
      categoryId: fun,
      description: "Passagens de ônibus",
      amount: "420.00",
      purchasedOn: `${back(2)}-10`,
    },
  ]);
  // Fatura do mês passado paga, igual à confirmação da tela: dia 2, categoria do cartão.
  const [bill] = await tx
    .insert(transactions)
    .values({
      ...base,
      kind: "despesa",
      categoryId: cardCategory.id,
      description: "Fatura Visa da família",
      amount: "920.00",
      occurredOn: `${back(1)}-02`,
    })
    .returning({ id: transactions.id });
  await tx.insert(cardStatementPayments).values({
    householdId,
    cardId: card!.id,
    statementMonth: back(1),
    transactionId: bill!.id,
  });

  await tx.insert(cashflowPlans).values({
    householdId,
    accountId: account!.id,
    categoryId: home,
    kind: "despesa",
    description: "Condomínio previsto",
    amount: "780.00",
    dayOfMonth: 28,
    startMonth: month,
  });
  await tx.insert(cashflowPlans).values({
    householdId,
    accountId: account!.id,
    categoryId: salary,
    kind: "receita",
    description: "Salário previsto",
    amount: "9200.00",
    dayOfMonth: 28,
    startMonth: month,
  });

  await tx.insert(accountTransfers).values({
    householdId,
    fromAccountId: account!.id,
    toAccountId: savings!.id,
    amount: "1000.00",
    occurredOn: `${back(1)}-03`,
  });

  const [fund] = await tx
    .insert(investments)
    .values({
      householdId,
      name: "Fundo imobiliário de teste",
      ticker: "PAIN11",
      assetClass: "fii",
      currentPrice: "112.00000000",
      valuedOn: today,
    })
    .returning({ id: investments.id });
  const [bond] = await tx
    .insert(investments)
    .values({
      householdId,
      name: "CDB de teste",
      assetClass: "renda_fixa",
      currentValue: "5400.00",
      valuedOn: today,
    })
    .returning({ id: investments.id });
  const [paid] = await tx
    .insert(transactions)
    .values({
      ...base,
      kind: "despesa",
      categoryId: aporte.id,
      description: "Aporte em PAIN11",
      amount: "1000.00",
      occurredOn: `${back(1)}-04`,
    })
    .returning({ id: transactions.id });
  await tx.insert(investmentTrades).values([
    {
      householdId,
      investmentId: fund!.id,
      side: "compra",
      occurredOn: `${back(4)}-10`,
      quantity: "100",
      unitPrice: "100",
      fees: "0.00",
    },
    {
      householdId,
      investmentId: fund!.id,
      side: "compra",
      occurredOn: `${back(1)}-04`,
      quantity: "10",
      unitPrice: "100",
      fees: "0.00",
      transactionId: paid!.id,
    },
    {
      householdId,
      investmentId: bond!.id,
      side: "compra",
      occurredOn: `${back(3)}-10`,
      quantity: "1",
      unitPrice: "5000",
      fees: "0.00",
    },
  ]);
  await tx.insert(dividends).values([
    ...[3, 2, 1].map((delta) => ({
      householdId,
      investmentId: fund!.id,
      kind: "rendimento" as const,
      paidOn: `${back(delta)}-05`,
      gross: "95.00",
      withheld: "0.00",
    })),
    {
      householdId,
      investmentId: fund!.id,
      kind: "rendimento" as const,
      paidOn: `${addMonths(month, 1)}-15`,
      gross: "101.00",
      withheld: "0.00",
    },
  ]);
});
await withWorkerHousehold(householdId, (tx) => runRelatoriosAgent(tx, { today, householdId }));
await closeAllPools();
