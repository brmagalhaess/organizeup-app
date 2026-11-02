"use server";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/app/actions";
import type { Locale } from "@/i18n/locales";
import { reportActionFailure } from "@/lib/diagnostics";
import { sendConfirmation, type ConfirmationOutcome } from "@/lib/email-confirmation";
import { VERIFY_LINK_HOURS } from "@/lib/email-templates";
import { requireSession } from "@/lib/session";

async function reply(outcome: ConfirmationOutcome): Promise<ActionState> {
  const t = await getTranslations("auth.confirmEmail");
  if (outcome.status === "enviado") {
    return { ok: true, message: t("sent", { hours: VERIFY_LINK_HOURS }) };
  }
  if (outcome.status === "confirmado") {
    revalidatePath("/app", "layout");
    return { ok: true, message: t("alreadyConfirmed") };
  }
  if (outcome.status === "aguarde") {
    const { seconds } = outcome;
    const message =
      seconds <= 60
        ? t("waitSeconds", { seconds })
        : t("waitMinutes", { minutes: Math.ceil(seconds / 60) });
    return { ok: false, message };
  }
  if (outcome.status === "desligado") return { ok: false, message: t("emailOff") };
  if (outcome.status === "manutencao") return { ok: false, message: t("maintenance") };
  return { ok: false, message: t("failed") };
}

/** Sem parâmetro de destino de propósito: a conta e o e-mail vêm só da sessão. */
export async function resendConfirmation(): Promise<ActionState> {
  const { user } = await requireSession();
  try {
    return await reply(await sendConfirmation(user, (await getLocale()) as Locale));
  } catch (error) {
    const { name, cause } = error as { name?: string; cause?: { code?: string } };
    const msg = "email_confirmation_failed";
    console.error(JSON.stringify({ level: "error", msg, name, code: cause?.code }));
    reportActionFailure(msg, error);
    return reply({ status: "falhou" });
  }
}
