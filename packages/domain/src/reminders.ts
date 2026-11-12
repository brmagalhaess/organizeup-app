// Lembretes por e-mail (ADR-0039): o que entra no resumo de uma pessoa, a partir do que a família já tem.
// Sem banco e sem relógio: quem chama informa o dia.
import { addDays } from "./income-plan";
import { money, toDbAmount } from "./money";

export interface ReminderSettings {
  enabled: boolean;
  /** Contas, faturas e parcelas a pagar. */
  bills: boolean;
  /** Renda prevista. */
  income: boolean;
  /** Proventos da carteira. */
  dividends: boolean;
  /** Gasto novo que não foi digitado por quem recebe o e-mail. */
  expenses: boolean;
  /** Resumo mensal do plano de aposentadoria. */
  retirement: boolean;
  /** Com quantos dias de antecedência o vencimento aparece (0 a 7). */
  daysAhead: number;
}

/** Sem escolha guardada, tudo ligado, com três dias de antecedência. */
export const REMINDER_DEFAULTS: ReminderSettings = {
  enabled: true,
  bills: true,
  income: true,
  dividends: true,
  expenses: true,
  retirement: true,
  daysAhead: 3,
};

export const REMINDER_MAX_DAYS_AHEAD = 7;
/** Conta vencida e ainda em aberto aparece por este tanto de dias, para o e-mail não virar cobrança eterna. */
export const REMINDER_OVERDUE_DAYS = 10;
/** Linhas por bloco: o resto vira "e mais N". */
export const REMINDER_LIST_LIMIT = 8;

/** Compromisso previsto do mês: conta, fatura, parcela, meta ou renda. */
export interface ReminderEntry {
  kind: "receita" | "despesa";
  source: "lancamento" | "previsao" | "parcela" | "fatura" | "renda" | "meta";
  description: string;
  amount: string;
  date: string;
}

export interface ReminderDividend {
  ticker: string;
  kind: "dividendo" | "jcp" | "rendimento";
  payDate: string;
  amount: string;
}

export interface ReminderExpense {
  description: string;
  amount: string;
  date: string;
  origin: "conta" | "cartao";
  /** Nome da conta ou do cartão. */
  place: string;
}

export type ReminderWhen = "atrasada" | "hoje" | "adiante";

export interface ReminderBlock<T> {
  /** As primeiras linhas, na ordem em que aparecem. */
  items: T[];
  /** Quantas ficaram de fora da lista. */
  more: number;
  /** Soma de todas, inclusive as que ficaram de fora. */
  total: string;
  count: number;
}

export interface ReminderDigest {
  today: string;
  toPay: ReminderBlock<ReminderEntry & { when: ReminderWhen }>;
  toReceive: ReminderBlock<ReminderEntry & { when: ReminderWhen }>;
  dividends: ReminderBlock<ReminderDividend & { when: ReminderWhen }>;
  fresh: ReminderBlock<ReminderExpense>;
  /** O resumo do dia (vencimentos, renda e proventos) entrou neste e-mail. */
  daily: boolean;
}

export interface ReminderInput {
  today: string;
  settings: ReminderSettings;
  /** Compromissos ainda previstos, de perto de hoje. */
  entries: ReminderEntry[];
  /** Proventos da carteira com pagamento perto de hoje. */
  dividends: ReminderDividend[];
  /** Gastos que entraram desde o último aviso. */
  fresh: ReminderExpense[];
  /** O resumo do dia já saiu hoje: só gasto novo justifica outro e-mail. */
  dailyDone: boolean;
  /** Envio pedido na tela: mostra a janela inteira, mesmo sem nada vencendo hoje. */
  force?: boolean;
}

function block<T extends { amount: string }>(rows: T[]): ReminderBlock<T> {
  return {
    items: rows.slice(0, REMINDER_LIST_LIMIT),
    more: Math.max(rows.length - REMINDER_LIST_LIMIT, 0),
    total: toDbAmount(rows.reduce((acc, row) => acc.plus(row.amount), money(0))),
    count: rows.length,
  };
}

const whenOf = (date: string, today: string): ReminderWhen =>
  date < today ? "atrasada" : date === today ? "hoje" : "adiante";

const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);

/**
 * Monta o resumo, ou devolve null quando não há o que avisar. O resumo do dia sai quando alguma coisa pede
 * atenção agora: vence ou entra hoje, venceu ontem e segue em aberto, ou acabou de entrar na janela de
 * antecedência. Nesse caso a lista traz a janela inteira, para a pessoa ver o que vem em seguida. Fora disso,
 * só gasto novo gera e-mail.
 */
export function buildReminder(input: ReminderInput): ReminderDigest | null {
  const { today, settings, dailyDone, force = false } = input;
  if (!settings.enabled && !force) return null;
  const ahead = Math.min(Math.max(Math.trunc(settings.daysAhead), 0), REMINDER_MAX_DAYS_AHEAD);
  const last = addDays(today, ahead);
  const oldest = addDays(today, -REMINDER_OVERDUE_DAYS);
  const yesterday = addDays(today, -1);

  const inWindow = (date: string, withOverdue: boolean) =>
    date <= last && date >= (withOverdue ? oldest : today);
  const pay = settings.bills
    ? input.entries.filter((entry) => entry.kind === "despesa" && inWindow(entry.date, true))
    : [];
  const receive = settings.income
    ? input.entries.filter((entry) => entry.kind === "receita" && inWindow(entry.date, false))
    : [];
  const paid = settings.dividends
    ? input.dividends.filter((event) => inWindow(event.payDate, false))
    : [];

  // O que pede atenção hoje. A antecedência avisa uma vez, no dia em que a conta entra na janela.
  const calls =
    pay.some((entry) => entry.date === today || entry.date === yesterday || entry.date === last) ||
    receive.some((entry) => entry.date === today) ||
    paid.some((event) => event.payDate === today);
  const daily = force || (!dailyDone && calls);
  const fresh = settings.expenses ? input.fresh : [];
  if (!daily && fresh.length === 0) return null;

  return {
    today,
    toPay: block(
      (daily ? pay : [])
        .sort(byDate)
        .map((entry) => ({ ...entry, when: whenOf(entry.date, today) })),
    ),
    toReceive: block(
      (daily ? receive : [])
        .sort(byDate)
        .map((entry) => ({ ...entry, when: whenOf(entry.date, today) })),
    ),
    dividends: block(
      (daily ? paid : [])
        .sort((a, b) => a.payDate.localeCompare(b.payDate) || a.ticker.localeCompare(b.ticker))
        .map((event) => ({ ...event, when: whenOf(event.payDate, today) })),
    ),
    // Do mais novo para o mais antigo: o que acabou de entrar vem primeiro.
    fresh: block([...fresh].sort((a, b) => b.date.localeCompare(a.date))),
    daily,
  };
}

/** Não há nada nos quatro blocos: só acontece no envio pedido na tela. */
export const reminderIsEmpty = (digest: ReminderDigest) =>
  digest.toPay.count + digest.toReceive.count + digest.dividends.count + digest.fresh.count === 0;

/** O que o resumo mensal da aposentadoria mostra: o plano por proventos, como está hoje. */
export interface RetirementSummary {
  /** Mês do resumo, "AAAA-MM". */
  month: string;
  targetYear: number | null;
  /** Renda mensal desejada. */
  targetIncome: string;
  /** Quanto a carteira precisa pagar por mês, descontadas pensões e outras rendas. */
  incomeGap: string;
  /** Renda mensal de hoje em proventos. */
  currentIncome: string;
  /** 0 a 999: quanto da renda que falta a carteira já paga. */
  coverage: number;
  requiredPortfolio: string | null;
  portfolioGap: string | null;
  /** Aporte mensal que o plano usa hoje. */
  contribution: string;
  /** Aporte mensal que fecha a conta no ano da meta. */
  requiredContribution: string | null;
  /** Ano em que a carteira fecha no ritmo de hoje. */
  yearWithContribution: number | null;
  projectedIncomeAtTarget: string | null;
}
