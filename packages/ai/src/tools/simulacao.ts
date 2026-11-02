// Simulações: nada aqui grava. Toda conta vem de packages/domain.
import { currentDividendPlan } from "@organizeup/agents";
import { asc, goals } from "@organizeup/db";
import {
  addMonths,
  money,
  monthsToReserve,
  normalizeDescription,
  planDividendRetirement,
  toDbAmount,
  yearMonthOf,
  type DividendPlan,
} from "@organizeup/domain";
import { z } from "zod";
import { untrusted } from "../privacy";
import { amountInput, defineTool, read } from "./registry";

const INCOMPLETE: Record<string, string> = {
  sem_dados: "Faltam dados: a família precisa informar a renda desejada ou lançar os gastos.",
  sem_yield: "Falta o rendimento: a carteira ainda não tem histórico de proventos.",
  sem_ano: "Falta o ano em que a família quer parar de trabalhar.",
};

const scenario = (plan: DividendPlan, contribution: string, targetYear: number | null) => ({
  ano_alvo: targetYear,
  aporte_mensal: contribution,
  aporte_que_fecha_o_plano: plan.requiredContribution,
  ano_em_que_fecha: plan.yearWithContribution,
  renda_projetada_no_ano_alvo: plan.projectedIncomeAtTarget,
  falta_para_a_carteira: plan.portfolioGap,
});

const NOTE = "Estimativa em reais de hoje, sem garantia de rendimento. Nada foi alterado.";

const simularGuardarMais = defineTool({
  name: "simular_guardar_mais",
  module: "aposentadoria",
  description:
    'Simula guardar um valor a mais por mês para a aposentadoria e compara com o plano de hoje. Chame em perguntas como "e se eu guardar mais 500?". Não grava nada.',
  kind: "simulacao",
  investment: true,
  input: z.strictObject({
    valor_mensal: amountInput("Quanto guardar a mais por mês."),
  }),
  label: () => "simulei guardar mais por mês",
  run: (ctx, { valor_mensal }) =>
    read(ctx, async (tx, today) => {
      const { plan, planData, contribution } = await currentDividendPlan(tx, today);
      if (plan.status !== "ok") {
        return { simulado: false, motivo: INCOMPLETE[plan.status] ?? "Faltam dados no plano." };
      }
      const raised = toDbAmount(money(contribution).plus(valor_mensal));
      const next = planDividendRetirement({ ...planData.input, contribution: raised });
      const targetYear = planData.input.targetYear;
      return {
        simulado: true,
        hoje: scenario(plan, contribution, targetYear),
        guardando_mais: scenario(next, raised, targetYear),
        anos_a_menos:
          plan.yearWithContribution !== null && next.yearWithContribution !== null
            ? plan.yearWithContribution - next.yearWithContribution
            : null,
        aviso: NOTE,
      };
    }),
});

const simularAnteciparAposentadoria = defineTool({
  name: "simular_antecipar_aposentadoria",
  module: "aposentadoria",
  description:
    'Simula parar de trabalhar alguns anos antes e mostra o aporte mensal que isso exige. Chame em perguntas como "e se eu me aposentar 5 anos antes?". Não grava nada.',
  kind: "simulacao",
  investment: true,
  input: z.strictObject({
    anos_antes: z.number().int().min(1).max(30).describe("Quantos anos antes, de 1 a 30."),
  }),
  label: () => "simulei antecipar a aposentadoria",
  run: (ctx, { anos_antes }) =>
    read(ctx, async (tx, today) => {
      const { plan, planData, contribution } = await currentDividendPlan(tx, today);
      const targetYear = planData.input.targetYear;
      if (plan.status !== "ok" || targetYear === null) {
        return { simulado: false, motivo: INCOMPLETE[plan.status] ?? "Falta o ano alvo." };
      }
      const earlier = targetYear - anos_antes;
      const next = planDividendRetirement({
        ...planData.input,
        targetYear: earlier,
        contribution,
        pensions: planData.input.pensions.map((pension) => ({
          ...pension,
          ageAtTarget: pension.ageAtTarget === null ? null : pension.ageAtTarget - anos_antes,
        })),
      });
      return {
        simulado: true,
        hoje: scenario(plan, contribution, targetYear),
        antecipando: scenario(next, contribution, earlier),
        aviso: NOTE,
      };
    }),
});

const simularMeta = defineTool({
  name: "simular_meta",
  module: "metas",
  description:
    'Calcula em quantos meses uma meta fecha guardando um valor por mês. Chame em perguntas como "em quanto tempo fecho a meta do carro?". Sem aporte informado, usa a parcela do plano da meta. Não grava nada.',
  kind: "simulacao",
  input: z.strictObject({
    meta: z.string().min(1).max(120).describe("Nome da meta, como aparece em listar_metas."),
    aporte_mensal: amountInput("Quanto guardar por mês para a meta.").optional(),
  }),
  label: () => "simulei o prazo da sua meta",
  run: (ctx, { meta, aporte_mensal }) =>
    read(ctx, async (tx, today) => {
      const rows = await tx.select().from(goals).orderBy(asc(goals.priority));
      const wanted = normalizeDescription(meta);
      const goal = rows.find((row) => normalizeDescription(row.name).includes(wanted));
      if (!goal) {
        return {
          simulado: false,
          motivo: "Não achei essa meta.",
          metas: rows.map((row) => untrusted(row.name)),
        };
      }
      const missing = money(goal.targetAmount).minus(goal.saved);
      const left = toDbAmount(missing.gt(0) ? missing : 0);
      const monthly = aporte_mensal ?? goal.planMonthly;
      if (!monthly) {
        return {
          simulado: false,
          motivo: "A meta ainda não tem plano. Pergunte quanto a família quer guardar por mês.",
          falta: left,
        };
      }
      const months = monthsToReserve(left, monthly);
      return {
        simulado: true,
        meta: untrusted(goal.name),
        falta: left,
        aporte_mensal: toDbAmount(monthly),
        meses: months,
        termina_em: months === null ? null : addMonths(yearMonthOf(today), months),
        aviso: "Nada foi alterado.",
      };
    }),
});

export const SIMULATION_TOOLS = [simularAnteciparAposentadoria, simularGuardarMais, simularMeta];
