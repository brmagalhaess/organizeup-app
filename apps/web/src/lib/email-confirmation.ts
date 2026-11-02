import "server-only";
import {
  readUserLocale,
  releaseConfirmationEmail,
  reserveConfirmationEmail,
  userIsBlocked,
  type ConfirmationTarget,
} from "@organizeup/db";
import { createEmailVerificationToken } from "better-auth/api";
import { isLocale, type Locale } from "@/i18n/locales";
import { getAuth } from "./auth";
import { emailCanSend, sendEmail } from "./email";
import { VERIFY_LINK_HOURS, verifyEmail } from "./email-templates";
import { platformFlags } from "./session";

export type ConfirmationOutcome =
  | { status: "enviado" | "desligado" | "falhou" | "manutencao" | "confirmado" | "bloqueada" }
  | { status: "aguarde"; seconds: number };

/**
 * Reenvia a confirmação para o e-mail gravado na conta. Quem chama diz qual conta, nunca qual endereço. Espera
 * a Brevo, ao contrário do cadastro: a tela só diz "enviado" se saiu, e a vaga do limite volta se não saiu.
 */
export async function sendConfirmation(
  account: ConfirmationTarget,
  fallbackLocale: Locale,
): Promise<ConfirmationOutcome> {
  if (account.emailVerified) return { status: "confirmado" };
  if (await userIsBlocked(account.id)) return { status: "bloqueada" };
  if ((await platformFlags()).maintenance) return { status: "manutencao" };
  if (!emailCanSend()) return { status: "desligado" };
  const slot = await reserveConfirmationEmail(account.id);
  if ("retryAfterSeconds" in slot) return { status: "aguarde", seconds: slot.retryAfterSeconds };
  const { secret } = await getAuth().$context;
  const token = await createEmailVerificationToken(
    secret,
    account.email,
    undefined,
    VERIFY_LINK_HOURS * 60 * 60,
  );
  const saved = await readUserLocale(account.id).catch(() => null);
  const locale = isLocale(saved) ? saved : fallbackLocale;
  const content = verifyEmail({ name: account.name, token, locale });
  if (await sendEmail({ to: account.email, ...content })) return { status: "enviado" };
  await releaseConfirmationEmail(slot.id);
  return { status: "falhou" };
}
