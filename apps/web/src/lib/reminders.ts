// Lembretes por e-mail (ADR-0039): junta o que a família tem, monta o resumo de cada login e envia. Roda na
// web, porque a chave do e-mail só existe aqui. Do que vai no e-mail, nada fica guardado nem vai para o log.
import "server-only";
import {
  accounts,
  and,
  cardPurchaseImports,
  cardPurchases,
  cashflowPlans,
  creditCards,
  emailReminders,
  eq,
  fromSession,
  gt,
  gte,
  household,
  householdAccountType,
  householdCurrency,
  householdIsSuspended,
  householdMember,
  householdTimezone,
  isSchemaLag,
  lte,
  readFamilyAccess,
  readPlatformFlags,
  readUserLocale,
  recordAgentRun,
  tolerateSchemaLag,
  transactions,
  user,
  userIsBlocked,
  withAdmin,
  withAdminRead,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  addDays,
  addMonths,
  buildMonthEntries,
  buildReminder,
  canView,
  monthBounds,
  REMINDER_DEFAULTS,
  REMINDER_MAX_DAYS_AHEAD,
  REMINDER_OVERDUE_DAYS,
  todayIn,
  yearMonthOf,
  type ReminderDividend,
  type ReminderEntry,
  type ReminderExpense,
  type ReminderSettings,
  type RetirementSummary,
  type YearMonth,
} from "@organizeup/domain";
import { LEMBRETES_AGENT } from "@/app/admin/agentes/catalogo";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import { currentDividendPlan } from "@organizeup/agents";
import { loadCommitments } from "./commitments";
import { loadDividendCalendar } from "./dividend-calendar-data";
import { emailCanSend, sendEmail } from "./email";
import { reminderEmail } from "./reminder-email";
import { retirementEmail } from "./retirement-email";
import { isServiceAdmin } from "./session";

export { LEMBRETES_AGENT };

/** Sem aviso anterior, o e-mail olha um dia para trás; com aviso antigo, no máximo três. */
const FIRST_LOOK_HOURS = 24;
const MAX_LOOK_HOURS = 72;

export interface ReminderPrefs extends ReminderSettings {
  dailySentOn: string | null;
  expensesSeenAt: Date | null;
  /** Mês do último resumo da aposentadoria. */
  retirementMonth: string | null;
}

const DEFAULT_PREFS: ReminderPrefs = {
  ...REMINDER_DEFAULTS,
  dailySentOn: null,
  expensesSeenAt: null,
  retirementMonth: null,
};

/** A escolha de quem está logado. Sem linha, ou antes de a migração chegar, vale o padrão. */
export async function loadReminderPrefs(ctx: TenantContext): Promise<ReminderPrefs> {
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        // O responsável também lê as linhas dos outros membros (0057): aqui vale só a de quem está logado.
        const [row] = await tx
          .select()
          .from(emailReminders)
          .where(eq(emailReminders.userId, ctx.userId ?? ""));
        if (!row) return DEFAULT_PREFS;
        const { enabled, bills, income, dividends, expenses, retirement, daysAhead } = row;
        return {
          enabled,
          bills,
          income,
          dividends,
          expenses,
          retirement,
          daysAhead,
          dailySentOn: row.dailySentOn,
          expensesSeenAt: row.expensesSeenAt,
          retirementMonth: row.retirementMonth,
        };
      }),
    DEFAULT_PREFS,
  );
}

type Mark = Partial<Pick<ReminderPrefs, "dailySentOn" | "expensesSeenAt" | "retirementMonth">>;

/** Grava a escolha, ou só até onde o aviso foi, na linha de quem está logado. */
async function upsertReminder(ctx: TenantContext, values: Partial<ReminderSettings> & Mark) {
  if (!ctx.userId) return;
  const userId = ctx.userId;
  await withHousehold(ctx, (tx) =>
    tx
      .insert(emailReminders)
      .values({ householdId: ctx.householdId, userId, ...values })
      .onConflictDoUpdate({
        target: [emailReminders.householdId, emailReminders.userId],
        set: { ...values, updatedAt: new Date() },
      }),
  );
}

/**
 * Avisos por e-mail ligados de cada login da família, para a tela Pessoas do responsável. Sem linha, vale o
 * padrão (ligado). Antes da migração 0057, o responsável só lê a própria linha: os outros ficam no padrão.
 */
export async function loadMembersReminders(ctx: TenantContext): Promise<Map<string, boolean>> {
  return tolerateSchemaLag(
    () =>
      withHousehold(ctx, async (tx) => {
        const rows = await tx
          .select({ userId: emailReminders.userId, enabled: emailReminders.enabled })
          .from(emailReminders);
        return new Map(rows.map((row) => [row.userId, row.enabled]));
      }),
    new Map<string, boolean>(),
  );
}

/** O responsável liga ou desliga os avisos de outro login da família. Devolve falso se o banco recusou. */
export async function saveMemberReminders(
  ctx: TenantContext,
  userId: string,
  enabled: boolean,
): Promise<boolean> {
  if (ctx.role !== "owner") return false;
  return withHousehold(ctx, (tx) =>
    tx.transaction((step) =>
      step
        .insert(emailReminders)
        .values({ householdId: ctx.householdId, userId, enabled })
        .onConflictDoUpdate({
          target: [emailReminders.householdId, emailReminders.userId],
          set: { enabled, updatedAt: new Date() },
        })
        .returning({ id: emailReminders.id })
        .then((rows) => rows.length > 0),
    ),
  ).catch(() => false);
}

export async function saveReminderPrefs(ctx: TenantContext, settings: ReminderSettings) {
  const daysAhead = Math.min(Math.max(Math.trunc(settings.daysAhead), 0), REMINDER_MAX_DAYS_AHEAD);
  await upsertReminder(ctx, { ...settings, daysAhead });
}

interface DigestData {
  today: string;
  account: string;
  currency: Awaited<ReturnType<typeof householdCurrency>>;
  entries: ReminderEntry[];
  dividends: ReminderDividend[];
  fresh: ReminderExpense[];
}

const monthsBetween = (from: YearMonth, to: YearMonth) => {
  const months: YearMonth[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month);
  return months;
};

/** Tudo o que pode entrar no resumo de quem está em `ctx`, de perto de hoje. */
async function loadDigestData(ctx: TenantContext, since: Date, now: Date): Promise<DigestData> {
  const family = await withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId), now);
    const from = yearMonthOf(addDays(today, -REMINDER_OVERDUE_DAYS));
    const to = yearMonthOf(addDays(today, REMINDER_MAX_DAYS_AHEAD));
    const inRange = await tx
      .select()
      .from(transactions)
      .where(
        and(
          gte(transactions.occurredOn, monthBounds(from).first),
          lte(transactions.occurredOn, monthBounds(to).last),
        ),
      );
    const planRows = await tx.select().from(cashflowPlans);
    const { scheduled } = await loadCommitments(tx, { from, to });
    const entries: ReminderEntry[] = monthsBetween(from, to).flatMap((month) =>
      buildMonthEntries(
        month,
        planRows,
        inRange.filter((entry) => yearMonthOf(entry.occurredOn) === month),
        scheduled,
      )
        .filter((entry) => entry.status === "previsto")
        .map(({ kind, source, description, amount, date }) => ({
          kind,
          source,
          description,
          amount,
          date,
        })),
    );

    // Gasto novo: o que entrou depois do último aviso e não foi digitado por quem recebe o e-mail.
    const typedByMe = (row: { createdBy: string | null; fingerprint: string | null }) =>
      row.createdBy === ctx.userId && !row.fingerprint;
    const accountRows = await tx.select({ id: accounts.id, name: accounts.name }).from(accounts);
    const accountNames = new Map(accountRows.map((row) => [row.id, row.name]));
    const entered = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.kind, "despesa"),
          eq(transactions.status, "realizado"),
          gt(transactions.createdAt, since),
        ),
      );
    const fresh: ReminderExpense[] = entered
      .filter((row) => !typedByMe({ createdBy: row.createdBy, fingerprint: row.importFingerprint }))
      .map((row) => ({
        description: row.description,
        amount: row.amount,
        date: row.occurredOn,
        origin: "conta" as const,
        place: accountNames.get(row.accountId) ?? "",
      }));
    const cardRows = await tx
      .select({ id: creditCards.id, name: creditCards.name })
      .from(creditCards);
    const cardNames = new Map(cardRows.map((row) => [row.id, row.name]));
    const bought = await tx.select().from(cardPurchases).where(gt(cardPurchases.createdAt, since));
    // A marca de onde a compra veio mora numa coluna da 0051: antes de ela chegar, ninguém tem marca.
    const marks = await tx
      .transaction((step) =>
        step
          .select({ id: cardPurchaseImports.id, mark: cardPurchaseImports.importFingerprint })
          .from(cardPurchaseImports),
      )
      .catch((error: unknown) => {
        if (isSchemaLag(error)) return [];
        throw error;
      });
    const markOf = new Map(marks.map((row) => [row.id, row.mark]));
    for (const row of bought) {
      const fingerprint = markOf.get(row.id) ?? null;
      // Saldo de fatura paga em parte não é compra nova.
      if (fingerprint?.startsWith("saldo:")) continue;
      if (typedByMe({ createdBy: row.createdBy, fingerprint })) continue;
      fresh.push({
        description: row.description,
        amount: row.amount,
        date: row.purchasedOn,
        origin: "cartao",
        place: cardNames.get(row.cardId) ?? "",
      });
    }
    const [home] = await tx
      .select({ name: household.name })
      .from(household)
      .where(eq(household.id, ctx.householdId));
    return {
      today,
      entries,
      fresh,
      account: home?.name ?? "",
      currency: await householdCurrency(tx),
    };
  });

  // Proventos: tabelas globais, fora da transação da família (ADR-0017).
  const last = addDays(family.today, REMINDER_MAX_DAYS_AHEAD);
  const dividends: ReminderDividend[] = [];
  for (const month of monthsBetween(yearMonthOf(family.today), yearMonthOf(last))) {
    const calendar = await loadDividendCalendar(ctx, month, true);
    for (const event of calendar.events) {
      if (!event.amount || event.payDate < family.today || event.payDate > last) continue;
      dividends.push({
        ticker: event.ticker,
        kind: event.kind,
        payDate: event.payDate,
        amount: event.amount,
      });
    }
  }
  return { ...family, dividends };
}

/**
 * Liberação em etapas: com a chave desligada, só quem administra o serviço recebe e vê a escolha. A Política
 * de Privacidade publicada dizia que dado financeiro não ia em e-mail; quem liga para todos é o painel.
 */
export const remindersOpen = (
  flags: { emailRemindersEnabled: boolean },
  person: { id: string; email: string },
) => flags.emailRemindersEnabled || isServiceAdmin(person);

export type ReminderOutcome = "enviado" | "nada" | "desligado" | "sem_email" | "falhou";

/**
 * Monta e envia o resumo de quem está em `ctx`. `force` é o botão da tela: envia a janela inteira, mesmo sem
 * nada para hoje, e não mexe nas marcas, para o aviso de verdade sair igual.
 */
export async function sendReminder(
  ctx: TenantContext,
  recipient: { email: string; name: string; locale: Locale },
  options: { force?: boolean; now?: Date } = {},
): Promise<ReminderOutcome> {
  const { force = false, now = new Date() } = options;
  if (!emailCanSend()) return "sem_email";
  const prefs = await loadReminderPrefs(ctx);
  if (!prefs.enabled && !force) return "desligado";
  const oldest = new Date(now.getTime() - MAX_LOOK_HOURS * 3_600_000);
  const first = new Date(now.getTime() - FIRST_LOOK_HOURS * 3_600_000);
  const seen = prefs.expensesSeenAt ?? first;
  const data = await loadDigestData(ctx, seen > oldest ? seen : oldest, now);
  const digest = buildReminder({
    today: data.today,
    settings: prefs,
    entries: data.entries,
    dividends: data.dividends,
    fresh: data.fresh,
    dailyDone: prefs.dailySentOn === data.today,
    force,
  });
  if (!digest) return "nada";
  const content = reminderEmail({
    name: recipient.name,
    account: data.account,
    digest,
    locale: recipient.locale,
    currency: data.currency,
    accountType: await householdAccountType(ctx.householdId),
  });
  if (!(await sendEmail({ to: recipient.email, ...content }))) return "falhou";
  if (!force) {
    await upsertReminder(ctx, {
      expensesSeenAt: now,
      ...(digest.daily ? { dailySentOn: data.today } : {}),
    });
  }
  return "enviado";
}

/** O plano por proventos como está hoje, ou null quando ainda não há dado para resumir. */
async function loadRetirementSummary(ctx: TenantContext, now: Date) {
  return withHousehold(ctx, async (tx) => {
    const today = todayIn(await householdTimezone(tx, ctx.householdId), now);
    const { plan, planData, contribution } = await currentDividendPlan(tx, today);
    if (!plan.targetIncome || (plan.status !== "ok" && plan.status !== "sem_ano")) return null;
    const [home] = await tx
      .select({ name: household.name })
      .from(household)
      .where(eq(household.id, ctx.householdId));
    const summary: RetirementSummary = {
      month: yearMonthOf(today),
      targetYear: planData.input.targetYear,
      targetIncome: plan.targetIncome,
      incomeGap: plan.incomeGap,
      currentIncome: plan.currentIncome,
      coverage: plan.coverage,
      requiredPortfolio: plan.requiredPortfolio,
      portfolioGap: plan.portfolioGap,
      contribution,
      requiredContribution: plan.requiredContribution,
      yearWithContribution: plan.yearWithContribution,
      projectedIncomeAtTarget: plan.projectedIncomeAtTarget,
    };
    return { summary, account: home?.name ?? "", currency: await householdCurrency(tx) };
  });
}

/**
 * Resumo mensal do plano de aposentadoria, uma vez por mês para cada login. Só sai para quem tem o módulo e
 * um plano com dados. `force` é o botão da tela e não gasta o envio do mês.
 */
export async function sendRetirementSummary(
  ctx: TenantContext,
  recipient: { email: string; name: string; locale: Locale },
  options: { force?: boolean; now?: Date } = {},
): Promise<ReminderOutcome> {
  const { force = false, now = new Date() } = options;
  if (!emailCanSend()) return "sem_email";
  const prefs = await loadReminderPrefs(ctx);
  if (!force && (!prefs.enabled || !prefs.retirement)) return "desligado";
  if (!canView(await readFamilyAccess(ctx, undefined, now), "aposentadoria")) return "nada";
  const data = await loadRetirementSummary(ctx, now);
  if (!data) return "nada";
  if (!force && prefs.retirementMonth === data.summary.month) return "nada";
  const content = retirementEmail({
    name: recipient.name,
    account: data.account,
    summary: data.summary,
    locale: recipient.locale,
    currency: data.currency,
    accountType: await householdAccountType(ctx.householdId),
  });
  if (!(await sendEmail({ to: recipient.email, ...content }))) return "falhou";
  if (!force) await upsertReminder(ctx, { retirementMonth: data.summary.month });
  return "enviado";
}

/**
 * Rodada de todos os logins com e-mail confirmado, a pedido do Paperclip (agente `lembretes`, e logo depois
 * do agente `bancos`). Para a equipe de agentes vão só contagens.
 */
export async function sendAllReminders(now: Date = new Date()) {
  const started = Date.now();
  const members = await withAdminRead("lembretes por e-mail", (db) =>
    db
      .select({
        householdId: householdMember.organizationId,
        userId: householdMember.userId,
        email: user.email,
        name: user.name,
      })
      .from(householdMember)
      .innerJoin(user, eq(user.id, householdMember.userId))
      .where(eq(user.emailVerified, true)),
  );
  const flags = await readPlatformFlags();
  const households = new Set<string>();
  let ok = 0;
  let failed = 0;
  if (emailCanSend() && !flags.maintenance) {
    for (const member of members) {
      try {
        if (!remindersOpen(flags, { id: member.userId, email: member.email })) continue;
        if (await userIsBlocked(member.userId)) continue;
        if (await householdIsSuspended(member.householdId)) continue;
        const ctx = await fromSession({
          user: { id: member.userId },
          session: { activeOrganizationId: member.householdId },
        });
        if (!ctx) continue;
        // Plano vencido: a família só lê, e o lembrete para até ela voltar.
        if ((await readFamilyAccess(ctx, flags, now)).mode === "leitura") continue;
        households.add(member.householdId);
        const saved = await readUserLocale(member.userId).catch(() => null);
        const recipient = {
          email: member.email,
          name: member.name,
          locale: isLocale(saved) ? saved : DEFAULT_LOCALE,
        };
        for (const outcome of [
          await sendReminder(ctx, recipient, { now }),
          await sendRetirementSummary(ctx, recipient, { now }),
        ]) {
          if (outcome === "enviado") ok += 1;
          if (outcome === "falhou") failed += 1;
        }
      } catch (error) {
        failed += 1;
        // Só o nome e o código: a mensagem pode trazer dados da família.
        const { name, code } = error as { name?: string; code?: string };
        console.error(JSON.stringify({ level: "error", msg: "reminder_failed", name, code }));
      }
    }
  }
  const counts = {
    households: households.size,
    ok,
    failed,
    suggestions: 0,
    applied: ok,
    durationMs: Date.now() - started,
  };
  // A conexão da web não grava rodadas de agente, de propósito: a contagem vai pela administrativa.
  await withAdmin("rodada do agente lembretes", (db) =>
    recordAgentRun(todayIn(), LEMBRETES_AGENT, counts, db),
  );
  return counts;
}
