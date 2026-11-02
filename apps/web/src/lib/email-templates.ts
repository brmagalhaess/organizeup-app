import type { AccountType } from "@organizeup/domain";
import { createTranslator } from "next-intl";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import type { EmailTemplate } from "./email";

export const RESET_LINK_HOURS = 1;
export const VERIFY_LINK_HOURS = 24;
export const INVITE_LINK_DAYS = 7;
/** Tela de volta do link de confirmação. */
export const CONFIRM_EMAIL_PATH = "/confirmar-email";

const MAX_NAME_LENGTH = 80;

// Mesmas cores de globals.css (tema claro): e-mail não lê variável de CSS.
const COLOR = {
  brand: "#1f5641",
  brandDark: "#183c32",
  surface: "#ffffff",
  page: "#eaf3ee",
  text: "#1f2933",
  muted: "#52606d",
};

type RenderedEmail = { subject: string; html: string; text: string; template: EmailTemplate };

type Layout = {
  locale: Locale;
  template: EmailTemplate;
  subject: string;
  heading: string;
  /** Parágrafos em texto puro: o escape é feito aqui, uma vez, só na versão HTML. */
  paragraphs: string[];
  action: { label: string; url: string };
  note?: string;
};

/** Links sempre a partir de BETTER_AUTH_URL, nunca do cabeçalho Host de quem pediu. */
export function appUrl(path: string) {
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}${path}`;
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Nome vem do usuário: sem quebra de linha e curto, para o e-mail não virar mural de quem cadastra. */
function cleanName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH).trim();
}

/** Textos do e-mail no idioma de quem recebe. */
const textsFor = (locale: Locale, accountType: AccountType = "pf") =>
  createTranslator({
    locale,
    messages: messagesFor(locale, "BRL", accountType),
    namespace: "emails" as never,
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;

function greeting(name: string, locale: Locale) {
  const t = textsFor(locale);
  const clean = cleanName(name);
  return clean ? t("helloName", { name: clean }) : t("hello");
}

function render(layout: Layout): RenderedEmail {
  const { locale, template, subject, heading, paragraphs, action, note } = layout;
  const url = escapeHtml(action.url);
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(text)}</p>`)
    .join("");
  const html = `<!doctype html>
<html lang="${locale}">
<body style="margin:0;padding:24px 12px;background:${COLOR.page};color:${COLOR.text};font-family:Arial,Helvetica,sans-serif;font-size:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${COLOR.surface};border-radius:12px">
<tr><td style="padding:24px 24px 0;font-size:18px;font-weight:bold;color:${COLOR.brandDark}">OrganizeUp</td></tr>
<tr><td style="padding:16px 24px 24px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${COLOR.brandDark}">${escapeHtml(heading)}</h1>
${body}
<p style="margin:24px 0"><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${COLOR.brand};color:#ffffff;font-weight:bold;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 8px;font-size:14px;color:${COLOR.muted}">${escapeHtml(textsFor(locale)("fallbackLink"))}</p>
<p style="margin:0 0 16px;font-size:14px;word-break:break-all"><a href="${url}" style="color:${COLOR.brand}">${url}</a></p>
${note ? `<p style="margin:0;font-size:14px;color:${COLOR.muted}">${escapeHtml(note)}</p>` : ""}
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
  const text = [heading, ...paragraphs, `${action.label}: ${action.url}`, note ?? ""]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html, text, template };
}

export function resetPasswordEmail(input: { name: string; token: string; locale?: Locale }) {
  const { name, token, locale = DEFAULT_LOCALE } = input;
  const t = textsFor(locale);
  return render({
    locale,
    template: "redefinir-senha",
    subject: t("reset.subject"),
    heading: t("reset.heading"),
    paragraphs: [greeting(name, locale), t("reset.text", { hours: RESET_LINK_HOURS })],
    action: {
      label: t("reset.action"),
      url: appUrl(
        `/api/auth/reset-password/${encodeURIComponent(token)}?callbackURL=%2Fredefinir-senha`,
      ),
    },
    note: t("reset.note"),
  });
}

export function passwordChangedEmail(input: { name: string; locale?: Locale }) {
  const { name, locale = DEFAULT_LOCALE } = input;
  const t = textsFor(locale);
  return render({
    locale,
    template: "senha-alterada",
    subject: t("changed.subject"),
    heading: t("changed.heading"),
    paragraphs: [greeting(name, locale), t("changed.text")],
    action: { label: t("changed.action"), url: appUrl("/esqueci-senha") },
    note: t("changed.note"),
  });
}

export function verifyEmail(input: { name: string; token: string; locale?: Locale }) {
  const { name, token, locale = DEFAULT_LOCALE } = input;
  const t = textsFor(locale);
  return render({
    locale,
    template: "confirmar-email",
    subject: t("verify.subject"),
    heading: t("verify.heading"),
    paragraphs: [greeting(name, locale), t("verify.text", { hours: VERIFY_LINK_HOURS })],
    action: {
      label: t("verify.action"),
      url: appUrl(
        `/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(CONFIRM_EMAIL_PATH)}`,
      ),
    },
    note: t("verify.note"),
  });
}

export function invitationEmail(input: {
  id: string;
  familyName: string;
  inviterName: string;
  locale?: Locale;
  accountType?: AccountType;
}) {
  const { id, familyName, inviterName, locale = DEFAULT_LOCALE, accountType } = input;
  const t = textsFor(locale, accountType);
  return render({
    locale,
    template: "convite",
    // Assunto fixo: nome digitado por outra pessoa só aparece dentro do e-mail.
    subject: t("invite.subject"),
    heading: t("invite.heading"),
    paragraphs: [
      t("invite.text", { inviter: cleanName(inviterName), family: cleanName(familyName) }),
      t("invite.validity", { days: INVITE_LINK_DAYS }),
    ],
    action: { label: t("invite.action"), url: appUrl(`/convite/${encodeURIComponent(id)}`) },
    note: t("invite.note"),
  });
}
