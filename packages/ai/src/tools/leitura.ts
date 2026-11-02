// Ferramentas de leitura da família. Devolvem o mínimo que responde à pergunta: sem ids internos,
// com pessoas por rótulo e texto livre marcado como dado não confiável. Conta só de packages/domain.
import {
  ASSET_CLASS_LABELS,
  AUTOMATIC_SUGGESTION_KINDS,
  calendarMonth,
  cardBook,
  currentDebtPlan,
  currentDividendPlan,
  latestStatement,
  loadCommitments,
  loadFiscalTables,
  loadSavingsRule,
  monthlyPlanView,
  readStatement,
  reserveInputs,
  AGENT_MODULE,
  loadTripIntentions,
} from "@organizeup/agents";
import {
  and,
  asc,
  cashflowPlans,
  categories,
  debtInstallments,
  debtPlanReports,
  debts,
  desc,
  dividendGoals,
  dividends,
  eq,
  goals,
  gte,
  householdCurrency,
  householdReports,
  householdSuggestions,
  incomeSources,
  investments,
  investmentTargets,
  investmentTrades,
  loadStockEvents,
  lte,
  notInArray,
  or,
  isNull,
  people,
  transactions,
  tripCosts,
  tripDestinationTemplates,
  tripPeople,
  trips,
  readFamilyAccess,
} from "@organizeup/db";
import {
  buildMonthEntries,
  canUse,
  type BillingModule,
  debtPlanHeadline,
  entryFlow,
  entryOrigin,
  formatYearMonth,
  isExpensiveDebt,
  isSavings,
  money,
  monthBounds,
  monthlyNet,
  netDividend,
  normalizeDescription,
  pendingEntries,
  plainIncomes,
  planTrip,
  receivedDividends,
  recommendedStrategy,
  savingsByCategory,
  spendingByCategory,
  splitCardSavings,
  STATEMENT_KINDS,
  summarizeDividends,
  summarizeMonth,
  summarizePortfolio,
  toDbAmount,
  upcomingDividends,
  yearMonthOf,
  type DebtPlanStrategy,
  type PlanActionKind,
} from "@organizeup/domain";
import { z } from "zod";
import { personLabels, untrusted } from "../privacy";
import { statementView } from "../statement-view";
import { defineTool, monthInput, read } from "./registry";

/** Valor na moeda da conta, em lançamento de conta estrangeira. */
const originFields = (row: Parameters<typeof entryOrigin>[0]) => {
  const origin = entryOrigin(row);
  return origin ? { valor_na_moeda_da_conta: origin.amount, moeda: origin.currency } : {};
};

const noInput = z.strictObject({});
const monthOnly = z.strictObject({ mes: monthInput });

const MAX_ROWS = 50;
const DEFAULT_ROWS = 30;
const MAX_CALENDAR_ITEMS = 60;

const sum = (values: string[]) =>
  toDbAmount(values.reduce((acc, value) => acc.plus(value), money(0)));

const monthWord = (mes: string | undefined) => (mes ? ` de ${formatYearMonth(mes)}` : " do mês");

const resumoDoMes = defineTool({
  name: "resumo_do_mes",
  module: null,
  description:
    "Resumo de um mês: recebido, gasto, resultado, aportado, resgatado, o que sobrou depois de aportar, previsto, gasto por categoria (com as compras do cartão abertas) e contas em aberto. Aporte e resgate vêm à parte: não são gasto nem recebimento. Chame quando perguntarem como foi ou está o mês, quanto sobrou, onde foi o dinheiro ou o que falta pagar.",
  kind: "leitura",
  input: monthOnly,
  label: ({ mes }) => `olhei o resumo${monthWord(mes)}`,
  run: (ctx, { mes }) =>
    read(ctx, async (tx, today) => {
      const month = mes ?? yearMonthOf(today);
      const { first, last } = monthBounds(month);
      const planRows = await tx.select().from(cashflowPlans);
      const rows = await tx
        .select()
        .from(transactions)
        .where(and(gte(transactions.occurredOn, first), lte(transactions.occurredOn, last)));
      const categoryRows = await tx
        .select({ id: categories.id, name: categories.name })
        .from(categories);
      const names = new Map(categoryRows.map((row) => [row.id, row.name]));
      const { scheduled, cardLines, cardCategoryId } = await loadCommitments(tx, {
        from: month,
        to: month,
      });
      const entries = buildMonthEntries(month, planRows, rows, scheduled);
      const rule = await loadSavingsRule(tx);
      const lines = cardLines.filter((line) => line.statementMonth === month);
      const split = splitCardSavings(entries, lines, cardCategoryId, rule);
      const summary = summarizeMonth(split, rule);
      const named = (row: { categoryId: string; amount: string }) => ({
        categoria: names.get(row.categoryId) ?? "Sem categoria",
        valor: row.amount,
      });
      return {
        mes: month,
        recebido: summary.received,
        gasto: summary.spent,
        resultado: summary.balance,
        aportado: summary.contributed,
        resgatado: summary.redeemed,
        sobrou_depois_de_aportar: summary.afterContributions,
        receita_prevista: summary.plannedIncome,
        despesa_prevista: summary.plannedExpense,
        aporte_previsto: summary.plannedContribution,
        resultado_projetado: summary.projectedBalance,
        por_categoria: spendingByCategory(split, lines, cardCategoryId, rule)
          .slice(0, 15)
          .map(named),
        aportes_por_categoria: savingsByCategory(split, "aporte", rule).map(named),
        em_aberto: pendingEntries(entries, today, 15).map((entry) => ({
          data: entry.date,
          tipo: entryFlow(entry, rule),
          descricao: untrusted(entry.description),
          valor: entry.amount,
          atrasado: entry.overdue,
        })),
      };
    }),
});

const listarLancamentos = defineTool({
  name: "listar_lancamentos",
  module: null,
  description:
    "Lista lançamentos de um mês, inclusive as compras da fatura do cartão, com a soma do que foi encontrado. Aporte e resgate têm tipo e soma próprios: não entram em soma_despesas nem em soma_receitas. Chame quando pedirem os gastos de uma categoria, a busca de uma compra ou o detalhe de um mês. A soma devolvida é a única que vale.",
  kind: "leitura",
  input: z.strictObject({
    mes: monthInput,
    categoria: z.string().max(80).optional().describe("Parte do nome da categoria."),
    tipo: z.enum(["receita", "despesa", "aporte", "resgate"]).optional(),
    busca: z.string().max(80).optional().describe("Parte da descrição do lançamento."),
    limite: z
      .number()
      .int()
      .min(1)
      .max(MAX_ROWS)
      .optional()
      .describe(`Quantos itens devolver, até ${MAX_ROWS}.`),
  }),
  label: ({ mes }) => `olhei seus lançamentos${monthWord(mes)}`,
  run: (ctx, input) =>
    read(ctx, async (tx, today) => {
      const month = input.mes ?? yearMonthOf(today);
      const { first, last } = monthBounds(month);
      const rows = await tx
        .select()
        .from(transactions)
        .where(and(gte(transactions.occurredOn, first), lte(transactions.occurredOn, last)))
        .orderBy(desc(transactions.occurredOn));
      const categoryRows = await tx
        .select({ id: categories.id, name: categories.name })
        .from(categories);
      const names = new Map(categoryRows.map((row) => [row.id, row.name]));
      const book = await cardBook(tx);
      const lines = book
        .flatMap((entry) => entry.lines)
        .filter((line) => line.statementMonth === month);
      const rule = await loadSavingsRule(tx);

      const wantedCategory = input.categoria ? normalizeDescription(input.categoria) : null;
      const wantedText = input.busca ? normalizeDescription(input.busca) : null;
      const matches = (description: string, categoryId: string, flow: string) =>
        (!input.tipo || input.tipo === flow) &&
        (!wantedText || normalizeDescription(description).includes(wantedText)) &&
        (!wantedCategory ||
          normalizeDescription(names.get(categoryId) ?? "").includes(wantedCategory));

      const found = [
        ...rows
          .filter((row) => matches(row.description, row.categoryId, entryFlow(row, rule)))
          .map((row) => ({
            data: row.occurredOn,
            origem: "conta",
            tipo: entryFlow(row, rule) as string,
            situacao: row.status,
            categoria: names.get(row.categoryId) ?? "Sem categoria",
            descricao: untrusted(row.description),
            valor: row.amount,
            ...originFields(row),
          })),
        ...lines
          .filter((line) =>
            matches(
              line.description,
              line.categoryId,
              isSavings(line, rule) ? "aporte" : "despesa",
            ),
          )
          .map((line) => ({
            data: line.purchasedOn,
            origem: "cartao",
            tipo: isSavings(line, rule) ? "aporte" : "despesa",
            situacao: "realizado",
            categoria: names.get(line.categoryId) ?? "Sem categoria",
            descricao: untrusted(line.description),
            valor: line.amount,
            parcela: line.installments > 1 ? `${line.installment}/${line.installments}` : null,
          })),
      ].sort((a, b) => b.data.localeCompare(a.data));
      return {
        mes: month,
        encontrados: found.length,
        soma_receitas: sum(found.filter((row) => row.tipo === "receita").map((row) => row.valor)),
        soma_despesas: sum(found.filter((row) => row.tipo === "despesa").map((row) => row.valor)),
        soma_aportes: sum(found.filter((row) => row.tipo === "aporte").map((row) => row.valor)),
        soma_resgates: sum(found.filter((row) => row.tipo === "resgate").map((row) => row.valor)),
        itens: found.slice(0, input.limite ?? DEFAULT_ROWS),
      };
    }),
});

const listarCategorias = defineTool({
  name: "listar_categorias",
  module: null,
  description:
    "Lista as categorias da família, com tipo e se contam como gasto essencial. Chame antes de filtrar por categoria quando não souber o nome.",
  kind: "leitura",
  input: noInput,
  label: () => "olhei suas categorias",
  run: (ctx) =>
    read(ctx, async (tx) => {
      const rows = await tx
        .select({
          name: categories.name,
          kind: categories.kind,
          essential: categories.essential,
        })
        .from(categories)
        .where(eq(categories.archived, false))
        .orderBy(asc(categories.position), asc(categories.name));
      return {
        categorias: rows.map((row) => ({
          nome: row.name,
          tipo: row.kind,
          essencial: row.essential,
        })),
      };
    }),
});

const verRenda = defineTool({
  name: "ver_renda",
  module: null,
  description:
    "Fontes de renda ativas, com o líquido mensal calculado, de quem é cada uma e o dia de pagamento. Chame quando perguntarem quanto a família ganha ou de onde vem a renda.",
  kind: "leitura",
  input: noInput,
  label: () => "olhei sua renda",
  run: (ctx) =>
    read(ctx, async (tx, today) => {
      const month = yearMonthOf(today);
      const sources = plainIncomes(
        await tx
          .select()
          .from(incomeSources)
          .where(or(isNull(incomeSources.endMonth), gte(incomeSources.endMonth, month)))
          .orderBy(asc(incomeSources.createdAt)),
        await householdCurrency(tx),
      );
      const personRows = await tx
        .select({ id: people.id, relation: people.relation })
        .from(people)
        .orderBy(asc(people.createdAt));
      const labels = personLabels(personRows);
      const tables = sources.length > 0 ? await loadFiscalTables(tx) : [];
      const active = sources.filter((source) => source.startMonth <= month);
      const views = active.map((source) => ({
        pessoa: source.personId ? (labels.get(source.personId) ?? null) : null,
        nome: untrusted(source.name),
        tipo: source.kind,
        liquido_mensal: monthlyNet(source, tables, month),
        dia_pagamento: source.payDay,
      }));
      return {
        mes: month,
        total_liquido_mensal: sum(views.map((view) => view.liquido_mensal)),
        fontes: views,
      };
    }),
});

const verReserva = defineTool({
  name: "ver_reserva",
  module: null,
  description:
    "Reserva de emergência: gasto essencial de referência, alvo, quanto está guardado, quanto falta, aporte planejado e em quantos meses completa. Chame quando falarem de reserva ou imprevistos.",
  kind: "leitura",
  input: noInput,
  label: () => "olhei sua reserva",
  run: (ctx) =>
    read(ctx, async (tx, today) => {
      const data = await reserveInputs(tx, { today });
      return {
        meses_alvo: data.targetMonths,
        gasto_essencial_mensal: data.baseline.monthly,
        base_do_gasto: data.baseline.basis,
        alvo: data.status.target,
        guardado: data.status.saved,
        ...(data.fx?.date ? { convertido_pela_cotacao_de: data.fx.date } : {}),
        falta: data.status.missing,
        percentual: data.status.percent,
        meses_cobertos: data.status.coveredMonths,
        aporte_mensal: data.contribution,
        meses_para_completar: data.monthsLeft,
      };
    }),
});

const verDividas = defineTool({
  name: "ver_dividas",
  module: "dividas",
  description:
    "Dívidas ativas: taxa, saldo, juros que faltam, parcelas e próximo vencimento, e quais são caras (vale mais quitar do que investir). Chame quando falarem de dívida, empréstimo ou financiamento.",
  kind: "leitura",
  input: noInput,
  label: () => "olhei suas dívidas",
  run: (ctx) =>
    read(ctx, async (tx) => {
      const debtRows = await tx
        .select()
        .from(debts)
        .where(eq(debts.archived, false))
        .orderBy(asc(debts.createdAt));
      const rows = await tx.select().from(debtInstallments).orderBy(asc(debtInstallments.number));
      const views = debtRows.map((debt) => {
        const own = rows.filter((row) => row.debtId === debt.id);
        const open = own.filter((row) => row.transactionId === null);
        return {
          nome: untrusted(debt.name),
          taxa_mensal_percentual: debt.monthlyRate,
          cara: isExpensiveDebt(debt.monthlyRate, null),
          saldo: sum(open.map((row) => row.principal)),
          juros_a_pagar: sum(open.map((row) => row.interest)),
          parcelas_pagas: own.length - open.length,
          parcelas_restantes: open.length,
          proxima: open[0] ? { vencimento: open[0].dueDate, valor: open[0].amount } : null,
        };
      });
      return { saldo_total: sum(views.map((view) => view.saldo)), dividas: views };
    }),
});

const strategyView = (item: DebtPlanStrategy) => ({
  termina_em: item.payoffMonth,
  nao_termina: item.stalled,
  juros_ate_o_fim: item.totalInterest,
  economia_frente_ao_minimo: item.saved,
  comece_por: item.focus ? untrusted(item.focus.name) : null,
  ordem_de_ataque: item.attack.map((debt) => ({
    divida: untrusted(debt.name),
    termina_em_meses: debt.month,
  })),
});

const verPlanoDividas = defineTool({
  name: "ver_plano_dividas",
  module: "dividas",
  description:
    "Plano de saída das dívidas: quando tudo termina, quanto economiza, qual estratégia sai mais barata, qual dívida atacar, quanto pagar a mais neste mês e os pontos de atenção (juro acima do rendimento, parcela antes da renda, portabilidade ou renegociação, dado faltando). Chame quando perguntarem como sair das dívidas, qual pagar primeiro ou se vale quitar antes.",
  kind: "leitura",
  input: noInput,
  label: () => "olhei seu plano para sair das dívidas",
  run: (ctx) =>
    read(ctx, async (tx, today) => {
      const { plan } = await currentDebtPlan(tx, today);
      if (!plan) return { situacao: "sem_dividas" };
      const best = recommendedStrategy(plan);
      return {
        situacao: "ok",
        resumo: debtPlanHeadline(plan, await householdCurrency(tx)),
        saldo_total: plan.totalBalance,
        valor_extra_mensal: plan.extra,
        estrategia_recomendada: plan.recommended,
        so_pagando_as_parcelas: {
          termina_em: plan.baseline.payoffMonth,
          nao_termina: plan.baseline.stalled,
          juros_ate_o_fim: plan.baseline.totalInterest,
        },
        maior_juro_primeiro: strategyView(plan.avalanche),
        menor_saldo_primeiro: strategyView(plan.snowball),
        pagar_a_mais_neste_mes: best.thisMonth.map((item) => ({
          divida: untrusted(item.name),
          valor: item.amount,
        })),
        pontos_de_atencao: plan.signals.map((signal) => ({
          tipo: signal.kind,
          divida: untrusted(signal.debtName),
          texto: signal.text,
        })),
        aviso: "Estimativa com as parcelas de hoje. Não muda nenhuma parcela.",
      };
    }),
});

const verCarteira = defineTool({
  name: "ver_carteira",
  module: "investimentos",
  description:
    "Carteira de investimentos: total, custo, ganho, divisão por classe comparada às metas da família e posição de cada ativo. Chame quando falarem de investimentos. Nunca use isto para indicar compra ou venda de um ativo.",
  kind: "leitura",
  investment: true,
  input: noInput,
  label: () => "olhei sua carteira",
  run: (ctx) =>
    read(ctx, async (tx) => {
      const events = await loadStockEvents(tx);
      const [holdings, trades, targets] = await Promise.all([
        tx.select().from(investments).orderBy(asc(investments.createdAt)),
        tx.select().from(investmentTrades),
        tx.select().from(investmentTargets),
      ]);
      const list = holdings.map((holding) => ({
        ...holding,
        trades: trades.filter((trade) => trade.investmentId === holding.id),
        events: events.filter((event) => event.investmentId === holding.id),
      }));
      const summary = summarizePortfolio(list, targets);
      return {
        total: summary.total,
        custo: summary.cost,
        ganho: summary.gain,
        ganho_percentual: summary.gainPercent,
        classes: summary.classes.map((row) => ({
          classe: ASSET_CLASS_LABELS[row.assetClass] ?? row.assetClass,
          valor: row.value,
          percentual: row.percent,
          meta_percentual: row.target,
          falta_para_meta: row.toTarget,
        })),
        ativos: list.map((holding, index) => {
          const row = summary.rows[index]!;
          return {
            ativo: holding.ticker ?? untrusted(holding.name),
            classe: ASSET_CLASS_LABELS[holding.assetClass] ?? holding.assetClass,
            valor: row.value,
            ganho: row.gain,
            ganho_percentual: row.gainPercent,
            valor_estimado: row.estimated,
          };
        }),
      };
    }),
});

const verProventos = defineTool({
  name: "ver_proventos",
  module: "investimentos",
  description:
    "Proventos recebidos nos últimos 12 meses, por mês e por ativo, média mensal, meta da família e o que está a receber. Chame quando falarem de dividendos, rendimentos ou renda da carteira.",
  kind: "leitura",
  investment: true,
  input: noInput,
  label: () => "olhei seus proventos",
  run: (ctx) =>
    read(ctx, async (tx, today) => {
      const [holdings, rows, [goal]] = await Promise.all([
        tx.select().from(investments),
        tx.select().from(dividends).orderBy(desc(dividends.paidOn)),
        tx.select().from(dividendGoals),
      ]);
      const nameOf = new Map(
        holdings.map((holding) => [holding.id, holding.ticker ?? untrusted(holding.name)]),
      );
      const upcoming = upcomingDividends(rows, today);
      const summary = summarizeDividends(
        receivedDividends(rows, today),
        yearMonthOf(today),
        goal?.monthlyAmount ?? null,
      );
      return {
        ultimos_12_meses: summary.last12,
        media_mensal: summary.monthlyAverage,
        neste_ano: summary.thisYear,
        imposto_retido_12_meses: summary.withheld12,
        meta_mensal: goal?.monthlyAmount ?? null,
        percentual_da_meta: summary.goalPercent,
        por_mes: summary.months.map((row) => ({ mes: row.month, liquido: row.net })),
        por_ativo: summary.byInvestment.map((row) => ({
          ativo: nameOf.get(row.investmentId) ?? null,
          liquido: row.net,
        })),
        a_receber: upcoming.slice(0, 20).map((row) => ({
          ativo: nameOf.get(row.investmentId) ?? null,
          pagamento: row.paidOn,
          liquido: netDividend(row),
        })),
      };
    }),
});

const verPlanoAposentadoria = defineTool({
  name: "ver_plano_aposentadoria",
  module: "aposentadoria",
  description:
    "Plano de viver dos rendimentos da carteira: ano alvo, renda alvo, quanto a carteira já paga, carteira necessária, aporte que fecha o plano e a divisão sugerida do que sobra por mês. Chame quando falarem de aposentadoria, independência financeira ou quanto guardar.",
  kind: "leitura",
  investment: true,
  input: noInput,
  label: () => "olhei seu plano de aposentadoria",
  run: (ctx) =>
    read(ctx, async (tx, today) => {
      const { plan, planData, contribution, allocation, surplus } = await currentDividendPlan(
        tx,
        today,
      );
      return {
        situacao: plan.status,
        ano_alvo: planData.input.targetYear,
        renda_alvo: plan.targetIncome,
        base_da_renda_alvo: plan.targetBasis,
        outras_rendas_no_ano_alvo: plan.otherIncome,
        renda_que_a_carteira_precisa_pagar: plan.incomeGap,
        renda_atual_em_proventos: plan.currentIncome,
        cobertura_percentual: plan.coverage,
        rendimento_anual_usado_percentual: plan.yieldUsed,
        base_do_rendimento: plan.yieldBasis,
        carteira_necessaria: plan.requiredPortfolio,
        falta_para_a_carteira: plan.portfolioGap,
        meses_ate_o_ano_alvo: plan.monthsToTarget,
        aporte_que_fecha_o_plano: plan.requiredContribution,
        aporte_mensal_considerado: contribution,
        ano_em_que_fecha_com_esse_aporte: plan.yearWithContribution,
        renda_projetada_no_ano_alvo: plan.projectedIncomeAtTarget,
        sobra_mensal: surplus.surplus,
        ja_aporta_por_mes: allocation.alreadyInvesting,
        divisao_sugerida_da_sobra: {
          reserva: allocation.reserve,
          dividas: allocation.debt,
          aposentadoria: allocation.retirement,
          metas: allocation.goalsBudget,
          viagens: allocation.tripsBudget,
        },
        aviso: "Estimativa em reais de hoje, sem garantia de rendimento.",
      };
    }),
});

const listarMetas = defineTool({
  name: "listar_metas",
  module: "metas",
  description:
    "Metas da família: alvo, guardado, quanto falta, parcela mensal do plano, quando termina e se está no prazo. Chame quando falarem de metas ou objetivos.",
  kind: "leitura",
  input: noInput,
  label: () => "olhei suas metas",
  run: (ctx) =>
    read(ctx, async (tx) => {
      const rows = await tx.select().from(goals).orderBy(asc(goals.priority), asc(goals.createdAt));
      return {
        metas: rows.map((goal) => {
          const missing = money(goal.targetAmount).minus(goal.saved);
          return {
            nome: untrusted(goal.name),
            situacao: goal.status,
            prioridade: goal.priority,
            alvo: goal.targetAmount,
            guardado: goal.saved,
            falta: toDbAmount(missing.gt(0) ? missing : 0),
            mes_desejado: goal.desiredMonth,
            parcela_mensal: goal.planMonthly,
            inicio: goal.planStart,
            fim: goal.planEnd,
            observacao: untrusted(goal.planNote, 240),
          };
        }),
      };
    }),
});

const listarViagens = defineTool({
  name: "listar_viagens",
  module: "metas",
  description:
    "Viagens marcadas: destino, datas, quem vai, custo total, quanto falta e quanto guardar por mês. Também os lugares que a família quer conhecer, com mês preferido e dias. Chame quando falarem de viagem ou férias.",
  kind: "leitura",
  input: noInput,
  label: () => "olhei suas viagens",
  run: (ctx) =>
    read(ctx, async (tx, today) => {
      const [tripRows, costs, travelers, personRows, catalog] = await Promise.all([
        tx.select().from(trips).orderBy(asc(trips.startOn)),
        tx.select().from(tripCosts),
        tx.select().from(tripPeople),
        tx
          .select({ id: people.id, relation: people.relation })
          .from(people)
          .orderBy(asc(people.createdAt)),
        tx
          .select({ id: tripDestinationTemplates.id, name: tripDestinationTemplates.name })
          .from(tripDestinationTemplates),
      ]);
      // Fora do Promise.all: é um savepoint, e não pode dividir a conexão com outra consulta.
      const intentionRows = await loadTripIntentions(tx);
      const labels = personLabels(personRows);
      const catalogNames = new Map(catalog.map((row) => [row.id, row.name]));
      return {
        intencoes: intentionRows.map((row) => ({
          // Nome do catálogo é nosso; nome livre foi digitado pela família.
          destino: row.destinationId
            ? (catalogNames.get(row.destinationId) ?? null)
            : untrusted(row.customName, 80),
          regiao: row.customRegion,
          mes_preferido: row.preferredMonth,
          dias: row.days,
          atendida: row.fulfilledAt !== null,
        })),
        viagens: tripRows.map((trip) => {
          const going = travelers.filter((row) => row.tripId === trip.id);
          const own = costs.filter((cost) => cost.tripId === trip.id);
          const plan = planTrip({ ...trip, travelers: going.length, costs: own }, today);
          return {
            destino: untrusted(trip.destination),
            inicio: trip.startOn,
            fim: trip.endOn,
            quem_vai: going.map((row) => labels.get(row.personId) ?? "pessoa da família"),
            custo_total: plan.total,
            guardado: trip.saved,
            falta: plan.missing,
            guardar_por_mes: plan.monthly,
            ja_passou: plan.past,
          };
        }),
      };
    }),
});

const verCalendario = defineTool({
  name: "ver_calendario",
  module: null,
  description:
    "Calendário de um mês: contas e recebimentos por dia, compromissos, fechamentos de fatura, menor saldo previsto e saldo no fim do mês. Chame quando perguntarem o que vence, quando o dinheiro aperta ou como termina o mês.",
  kind: "leitura",
  input: monthOnly,
  label: ({ mes }) => `olhei seu calendário${monthWord(mes)}`,
  run: (ctx, { mes }) =>
    read(ctx, async (tx, today) => {
      const data = await calendarMonth(tx, { today, month: mes ?? yearMonthOf(today) });
      const items = Object.values(data.items)
        .flat()
        .sort((a, b) => a.date.localeCompare(b.date));
      return {
        mes: data.month,
        ...(data.fx?.date ? { saldos_convertidos_pela_cotacao_de: data.fx.date } : {}),
        saldo_no_fim_do_mes: data.closing,
        menor_saldo_previsto: data.lowest,
        itens_no_mes: items.length,
        itens: items.slice(0, MAX_CALENDAR_ITEMS).map((item) => ({
          data: item.date,
          item: item.type,
          titulo: untrusted(item.title),
          ...(item.type === "lancamento"
            ? { tipo: item.kind, situacao: item.status, valor: item.amount }
            : {}),
        })),
      };
    }),
});

const relatoriosDoDia = defineTool({
  name: "relatorios_do_dia",
  module: null,
  description:
    "Relatórios mais recentes das revisões automáticas do sistema (categorias, investimentos, dívidas, aposentadoria, viagens e metas). Chame quando perguntarem o que mudou ou o que há de novo.",
  kind: "leitura",
  input: noInput,
  label: () => "olhei os relatórios de hoje",
  run: async (ctx) => {
    const access = await readFamilyAccess(ctx);
    // Relatório antigo de módulo desligado fica guardado, mas o assistente não fala dele.
    const open = (kind: string) => {
      const module = AGENT_MODULE[kind];
      return !module || canUse(access, module);
    };
    return read(ctx, async (tx) => {
      const rows = await tx
        .select({
          kind: householdReports.kind,
          period: householdReports.period,
          title: householdReports.title,
          summary: householdReports.summary,
        })
        .from(householdReports)
        .orderBy(desc(householdReports.createdAt))
        .limit(5);
      const [debtPlan] = await tx
        .select({
          period: debtPlanReports.day,
          title: debtPlanReports.title,
          summary: debtPlanReports.summary,
        })
        .from(debtPlanReports)
        .orderBy(desc(debtPlanReports.day))
        .limit(1);
      return {
        relatorios: [...(debtPlan ? [{ kind: "dividas", ...debtPlan }] : []), ...rows]
          .filter((row) => open(row.kind))
          .map((row) => ({
            tipo: row.kind,
            periodo: row.period,
            titulo: untrusted(row.title),
            resumo: untrusted(row.summary, 1000),
          })),
      };
    });
  },
});

/** Relatório que mostra dado de um módulo. Fora da lista: Base. */
const STATEMENT_MODULE: Partial<Record<(typeof STATEMENT_KINDS)[number], BillingModule>> = {
  investimentos: "investimentos",
  proventos: "investimentos",
  dividas: "dividas",
  metas: "metas",
  aposentadoria: "aposentadoria",
};

const verRelatorio = defineTool({
  name: "ver_relatorio",
  module: null,
  description:
    "Relatório pronto da família, por tipo e período: resumo do mês, gastos por categoria, fluxo de caixa, patrimônio, investimentos, proventos, dívidas, metas e viagens, aposentadoria ou anual. Chame quando pedirem um relatório, o fechamento de um mês ou do ano. situacao parcial quer dizer que o período ainda não acabou. O anual só organiza o que a família lançou, não substitui a declaração nem é orientação fiscal.",
  kind: "leitura",
  input: z.strictObject({
    tipo: z.enum(STATEMENT_KINDS),
    periodo: z
      .string()
      .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "Use AAAA-MM, ou AAAA no anual.")
      .optional()
      .describe("AAAA-MM, ou AAAA no anual. Sem ele, usa o mais recente."),
  }),
  label: ({ tipo }) => `olhei o relatório ${tipo}`,
  run: async (ctx, { tipo, periodo }) => {
    // Relatórios são da Base, mas o de um módulo desligado fica guardado até religar.
    const module = STATEMENT_MODULE[tipo];
    if (module && !canUse(await readFamilyAccess(ctx), module)) {
      return { situacao: "fora_do_plano", tipo };
    }
    return read(ctx, async (tx) => {
      const row = periodo
        ? await readStatement(tx, tipo, periodo)
        : await latestStatement(tx, tipo);
      if (!row) return { situacao: "sem_relatorio", tipo, periodo: periodo ?? null };
      return {
        tipo: row.kind,
        periodo: row.period,
        situacao: row.status,
        ate: row.data.asOf,
        atualizado_depois_de_fechar: row.revisedAt !== null,
        ...statementView(row.data),
        o_que_mudou: row.whatChanged ? untrusted(row.whatChanged) : null,
      };
    });
  },
});

const sugestoesPendentes = defineTool({
  name: "sugestoes_pendentes",
  module: null,
  description:
    "Sugestões que estão esperando a decisão da família na tela Sugestões. Chame quando perguntarem o que há para decidir ou o que fazer agora.",
  kind: "leitura",
  input: noInput,
  label: () => "olhei as sugestões pendentes",
  run: (ctx) =>
    read(ctx, async (tx) => {
      const rows = await tx
        .select({
          kind: householdSuggestions.kind,
          title: householdSuggestions.title,
          body: householdSuggestions.body,
        })
        .from(householdSuggestions)
        .where(
          and(
            eq(householdSuggestions.status, "pendente"),
            notInArray(householdSuggestions.kind, [...AUTOMATIC_SUGGESTION_KINDS]),
          ),
        )
        .orderBy(desc(householdSuggestions.createdAt))
        .limit(20);
      return {
        sugestoes: rows.map((row) => ({
          tipo: row.kind,
          titulo: untrusted(row.title),
          texto: untrusted(row.body, 800),
        })),
      };
    }),
});

const PLAN_ACTION_MEANING: Record<PlanActionKind, string> = {
  completar: "Falta dado no plano de aposentadoria.",
  reserva: "valor_mensal é quanto guardar na reserva.",
  divida: "valor_mensal é quanto pagar a mais na dívida cara.",
  guardar: "valor_mensal é quanto guardar a mais por mês.",
  gasto: "valor_mensal é o corte sugerido, 10% da categoria, não o gasto total dela.",
};

const verPlanoDoMes = defineTool({
  name: "ver_plano_do_mes",
  module: "aposentadoria",
  description:
    "As três ações que mais aproximam a família da aposentadoria neste mês, com quanto cada uma antecipa em anos. Chame quando perguntarem por onde começar ou o que fazer primeiro.",
  kind: "leitura",
  input: noInput,
  label: () => "olhei o seu plano do mês",
  run: (ctx) =>
    read(ctx, async (tx, today) => {
      const { actions, contribution, targetYear, plan } = await monthlyPlanView(tx, today);
      return {
        ano_alvo: targetYear,
        aporte_mensal: contribution,
        ano_em_que_fecha: plan.yearWithContribution,
        acoes: actions.map((action) => ({
          tipo: action.kind,
          significado: PLAN_ACTION_MEANING[action.kind],
          valor_mensal: action.amount,
          anos_a_menos: action.yearsEarlier,
          categoria: action.category ? untrusted(action.category) : undefined,
        })),
      };
    }),
});

export const READ_TOOLS = [
  listarCategorias,
  listarLancamentos,
  listarMetas,
  listarViagens,
  relatoriosDoDia,
  resumoDoMes,
  sugestoesPendentes,
  verCalendario,
  verCarteira,
  verDividas,
  verPlanoAposentadoria,
  verPlanoDividas,
  verPlanoDoMes,
  verProventos,
  verRelatorio,
  verRenda,
  verReserva,
];
