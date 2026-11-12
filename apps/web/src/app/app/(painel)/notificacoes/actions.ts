"use server";
import { undoSuggestion, type ApplyResult } from "@organizeup/agents";
import { canWrite, eq, householdNotifications, isNull, withHousehold } from "@organizeup/db";
import { REMINDER_MAX_DAYS_AHEAD, SAVINGS_NOTICE_KEY } from "@organizeup/domain";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/locales";
import { reportActionFailure } from "@/lib/diagnostics";
import {
  remindersOpen,
  saveReminderPrefs,
  sendReminder,
  sendRetirementSummary,
} from "@/lib/reminders";
import { platformFlags, requireTenant } from "@/lib/session";

/** Desfaz a mudança que a notificação avisa. A regra é a mesma da tela Sugestões. */
export async function undoNotification(form: FormData): Promise<ApplyResult> {
  const { ctx } = await requireTenant();
  const t = await getTranslations("notificacoes");
  if (!canWrite(ctx)) return { ok: false, message: t("noPermission") };
  const id = String(form.get("id") ?? "");
  const result = await withHousehold(ctx, async (tx) => {
    const [row] = await tx
      .select({ suggestionId: householdNotifications.suggestionId })
      .from(householdNotifications)
      .where(eq(householdNotifications.id, id));
    return row?.suggestionId ? undoSuggestion(tx, ctx, row.suggestionId) : null;
  });
  if (!result?.ok) return { ok: false, message: t("undoFailed") };
  revalidatePath("/app", "layout");
  return { ok: true, message: t("undoDone") };
}

/** Marca tudo como lido, para a família inteira. Nada mais marca: abrir a tela não muda nada. */
export async function markAllRead(): Promise<ApplyResult> {
  const { ctx } = await requireTenant();
  const t = await getTranslations("notificacoes");
  if (!canWrite(ctx)) return { ok: false, message: t("noPermission") };
  await withHousehold(ctx, (tx) =>
    tx
      .update(householdNotifications)
      .set({ readAt: new Date() })
      .where(isNull(householdNotifications.readAt)),
  );
  revalidatePath("/app", "layout");
  return { ok: true, message: t("allRead") };
}

/** Fecha, para a família inteira, a nota do painel sobre aportes. A linha nasce lida: não é aviso novo. */
export async function dismissSavingsNotice(): Promise<void> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return;
  await withHousehold(ctx, (tx) =>
    tx
      .insert(householdNotifications)
      .values({
        householdId: ctx.householdId,
        kind: "aviso_painel",
        title: "Aportes separados",
        body: "Nota do painel fechada.",
        dedupeKey: SAVINGS_NOTICE_KEY,
        readAt: new Date(),
      })
      .onConflictDoNothing(),
  );
  revalidatePath("/app", "layout");
}

export interface ReminderFormState {
  ok: boolean;
  message: string;
}

/** Guarda o que a pessoa quer receber por e-mail. Vale só para o acesso dela, inclusive o de quem só lê. */
export async function saveReminders(
  _prev: ReminderFormState,
  form: FormData,
): Promise<ReminderFormState> {
  const { ctx, session } = await requireTenant();
  const t = await getTranslations("notificacoes.reminders");
  if (!remindersOpen(await platformFlags(), session.user))
    return { ok: false, message: t("failed") };
  const days = Number(form.get("daysAhead"));
  if (!Number.isInteger(days) || days < 0 || days > REMINDER_MAX_DAYS_AHEAD) {
    return { ok: false, message: t("invalid") };
  }
  const on = (name: string) => form.get(name) === "on";
  try {
    await saveReminderPrefs(ctx, {
      enabled: on("enabled"),
      bills: on("bills"),
      income: on("income"),
      dividends: on("dividends"),
      expenses: on("expenses"),
      retirement: on("retirement"),
      daysAhead: days,
    });
  } catch (error) {
    reportActionFailure("reminder_save_failed", error);
    return { ok: false, message: t("failed") };
  }
  revalidatePath("/app/notificacoes");
  return { ok: true, message: t(on("enabled") ? "saved" : "savedOff") };
}

async function sendSample(kind: "dia" | "aposentadoria"): Promise<ReminderFormState> {
  const { ctx, session } = await requireTenant();
  const t = await getTranslations("notificacoes.reminders");
  if (!remindersOpen(await platformFlags(), session.user)) {
    return { ok: false, message: t("sendFailed") };
  }
  if (!session.user.emailVerified) return { ok: false, message: t("unverified") };
  const locale = await getLocale();
  const recipient = {
    email: session.user.email,
    name: session.user.name,
    locale: isLocale(locale) ? locale : DEFAULT_LOCALE,
  };
  try {
    const outcome =
      kind === "dia"
        ? await sendReminder(ctx, recipient, { force: true })
        : await sendRetirementSummary(ctx, recipient, { force: true });
    if (outcome === "enviado") {
      const key = kind === "dia" ? "sent" : "sentRetirement";
      return { ok: true, message: t(key, { email: session.user.email }) };
    }
    if (outcome === "nada") return { ok: false, message: t("noPlan") };
    return { ok: false, message: t(outcome === "sem_email" ? "emailOff" : "sendFailed") };
  } catch (error) {
    reportActionFailure("reminder_send_failed", error);
    return { ok: false, message: t("sendFailed") };
  }
}

/** Envia agora, para quem pediu, o resumo com o que está por perto. Não muda o aviso de verdade. */
export async function sendReminderNow(_prev: ReminderFormState): Promise<ReminderFormState> {
  return sendSample("dia");
}

/** Envia agora o resumo mensal da aposentadoria, sem gastar o envio do mês. */
export async function sendRetirementNow(_prev: ReminderFormState): Promise<ReminderFormState> {
  return sendSample("aposentadoria");
}
