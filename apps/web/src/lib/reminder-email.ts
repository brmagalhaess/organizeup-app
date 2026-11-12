// E-mail de lembretes (ADR-0039): o resumo do dia e os gastos novos. Tabelas e estilo em linha, porque é o que
// os programas de e-mail entendem; as cores repetem as de globals.css (tema claro).
import {
  formatMoney,
  money,
  reminderIsEmpty,
  toDbAmount,
  type AccountType,
  type Currency,
  type ReminderBlock,
  type ReminderDigest,
  type ReminderWhen,
} from "@organizeup/domain";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import type { EmailMessage } from "./email";
import { appUrl, cleanName, escapeHtml, textsFor } from "./email-templates";

export type ReminderEmail = Omit<EmailMessage, "to">;

/** Onde a pessoa escolhe o que receber. */
export const REMINDER_SETTINGS_PATH = "/app/notificacoes";

const MAX_TEXT = 60;

export const EMAIL_COLOR = {
  page: "#eef3ef",
  card: "#ffffff",
  soft: "#f7f3ea",
  line: "#efe9dc",
  ink: "#15231d",
  muted: "#55645c",
  band: "#183c32",
  bandText: "#d6eadd",
  bandMuted: "#a9c7b8",
  peach: "#f6c9a8",
  brand: "#2f7a5b",
  brandSoft: "#eaf3ee",
  income: "#1273a8",
  incomeSoft: "#e6f1f7",
  clay: "#a84c2a",
  claySoft: "#f8ebe4",
  danger: "#b42318",
  dangerSoft: "#fdecea",
  success: "#1f6b4a",
  successSoft: "#e4f3ea",
};
export const EMAIL_FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

export type EmailTone = "pay" | "receive" | "fresh";
export const EMAIL_TONE: Record<EmailTone, { accent: string; soft: string; amount: string }> = {
  pay: { accent: EMAIL_COLOR.clay, soft: EMAIL_COLOR.claySoft, amount: EMAIL_COLOR.ink },
  receive: { accent: EMAIL_COLOR.income, soft: EMAIL_COLOR.incomeSoft, amount: EMAIL_COLOR.income },
  fresh: { accent: EMAIL_COLOR.brand, soft: EMAIL_COLOR.brandSoft, amount: EMAIL_COLOR.ink },
};

interface Row {
  date: string;
  title: string;
  detail: string;
  amount: string;
  badge?: "hoje" | "atrasada";
}

interface Section {
  tone: EmailTone;
  title: string;
  total: string;
  rows: Row[];
  more: number;
  link: { label: string; url: string };
  note?: string;
}

/** Texto digitado por alguém: uma linha só, curta, sem deixar o e-mail virar mural. */
function clip(value: string) {
  const clean = cleanName(value);
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1).trimEnd()}…` : clean;
}

const utcDay = (date: string) => new Date(`${date}T12:00:00Z`);

function dateParts(date: string, locale: Locale) {
  const day = new Intl.DateTimeFormat(locale, { day: "2-digit", timeZone: "UTC" }).format(
    utcDay(date),
  );
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" })
    .format(utcDay(date))
    .replace(".", "");
  const short = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(utcDay(date));
  return { day, month, short };
}

function longDate(date: string, locale: Locale) {
  const text = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(utcDay(date));
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

function rowHtml(row: Row, tone: EmailTone, locale: Locale, t: ReturnType<typeof textsFor>) {
  const { day, month } = dateParts(row.date, locale);
  const paint = EMAIL_TONE[tone];
  const badge =
    row.badge === "atrasada"
      ? `<span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:${EMAIL_COLOR.dangerSoft};color:${EMAIL_COLOR.danger};font-size:11px;font-weight:bold;line-height:18px">${escapeHtml(t("reminder.badgeLate"))}</span>`
      : row.badge === "hoje"
        ? `<span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:${EMAIL_COLOR.successSoft};color:${EMAIL_COLOR.success};font-size:11px;font-weight:bold;line-height:18px">${escapeHtml(t("reminder.badgeToday"))}</span>`
        : "";
  return `<tr>
<td width="56" valign="middle" style="padding:12px 0;border-bottom:1px solid ${EMAIL_COLOR.line}">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" width="44" height="44" style="width:44px;height:44px;border-radius:12px;background:${paint.soft};font-family:${EMAIL_FONT}">
<div style="font-size:16px;line-height:18px;font-weight:bold;color:${EMAIL_COLOR.ink}">${escapeHtml(day)}</div>
<div style="font-size:10px;line-height:12px;text-transform:uppercase;letter-spacing:.06em;color:${EMAIL_COLOR.muted}">${escapeHtml(month)}</div>
</td></tr></table>
</td>
<td valign="middle" style="padding:12px 8px 12px 0;border-bottom:1px solid ${EMAIL_COLOR.line};font-family:${EMAIL_FONT}">
<div style="font-size:15px;line-height:20px;font-weight:bold;color:${EMAIL_COLOR.ink}">${escapeHtml(row.title)}${badge}</div>
<div style="font-size:13px;line-height:18px;color:${EMAIL_COLOR.muted}">${escapeHtml(row.detail)}</div>
</td>
<td align="right" valign="middle" style="padding:12px 0;border-bottom:1px solid ${EMAIL_COLOR.line};font-family:${EMAIL_FONT};font-size:15px;line-height:20px;font-weight:bold;white-space:nowrap;color:${paint.amount}">${escapeHtml(row.amount)}</td>
</tr>`;
}

function sectionHtml(section: Section, locale: Locale, t: ReturnType<typeof textsFor>) {
  const paint = EMAIL_TONE[section.tone];
  const more =
    section.more > 0
      ? `<tr><td colspan="3" style="padding:10px 0 0;font-family:${EMAIL_FONT};font-size:13px;color:${EMAIL_COLOR.muted}">${escapeHtml(t("reminder.more", { count: section.more }))}</td></tr>`
      : "";
  const note = section.note
    ? `<p style="margin:10px 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:17px;color:${EMAIL_COLOR.muted}">${escapeHtml(section.note)}</p>`
    : "";
  return `<tr><td class="ou-pad" style="background:${EMAIL_COLOR.card};padding:22px 32px 4px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-family:${EMAIL_FONT};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:${EMAIL_COLOR.muted}"><span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${paint.accent};margin-right:8px"></span>${escapeHtml(section.title)}</td>
<td align="right" style="font-family:${EMAIL_FONT};font-size:13px;line-height:16px;color:${EMAIL_COLOR.muted};white-space:nowrap">${escapeHtml(t("reminder.total"))} <strong style="color:${EMAIL_COLOR.ink}">${escapeHtml(section.total)}</strong></td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px">
${section.rows.map((row) => rowHtml(row, section.tone, locale, t)).join("\n")}
${more}
</table>
${note}
<p style="margin:12px 0 0;font-family:${EMAIL_FONT};font-size:13px;line-height:18px"><a href="${escapeHtml(section.link.url)}" style="color:${EMAIL_COLOR.brand};font-weight:bold;text-decoration:none">${escapeHtml(section.link.label)} &rarr;</a></p>
</td></tr>`;
}

export function tileHtml(
  tile: { tone: EmailTone; label: string; value: string; hint: string },
  width: number,
) {
  const paint = EMAIL_TONE[tile.tone];
  return `<td class="ou-tile" width="${width}%" valign="top" style="padding:0 4px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-radius:14px;background:${EMAIL_COLOR.soft};border-top:3px solid ${paint.accent};padding:14px 16px;font-family:${EMAIL_FONT}">
<div style="font-size:11px;line-height:14px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:${EMAIL_COLOR.muted}">${escapeHtml(tile.label)}</div>
<div style="margin-top:6px;font-size:20px;line-height:24px;font-weight:bold;color:${EMAIL_COLOR.ink};white-space:nowrap">${escapeHtml(tile.value)}</div>
<div style="margin-top:2px;font-size:12px;line-height:16px;color:${EMAIL_COLOR.muted}">${escapeHtml(tile.hint)}</div>
</td></tr></table>
</td>`;
}

/**
 * Moldura dos e-mails de lembrete: faixa escura com a saudação, o miolo em linhas de tabela (`<tr>`), o botão
 * e o rodapé com o caminho para desligar. Tudo o que entra em texto é escapado aqui; `body` já vem em HTML.
 */
export function emailShell(shell: {
  locale: Locale;
  subject: string;
  preheader: string;
  /** Texto no canto da faixa: o dia ou o mês do resumo. */
  dateText: string;
  hello: string;
  heading: string;
  intro: string;
  body: string;
  action: { label: string; url: string };
  footer: { why: string; settings: string; settingsUrl: string; brand: string };
}) {
  const { locale, subject, preheader, dateText, hello, heading, intro, body, action, footer } =
    shell;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(subject)}</title>
<style>
@media (max-width:520px){
.ou-pad{padding-left:20px!important;padding-right:20px!important}
.ou-tile{display:block!important;width:100%!important;padding:0 0 8px!important}
.ou-h1{font-size:25px!important;line-height:30px!important}
.ou-date{display:block!important;text-align:left!important;padding-top:6px!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLOR.page};color:${EMAIL_COLOR.ink};font-family:${EMAIL_FONT};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:${EMAIL_COLOR.page}">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_COLOR.page}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td class="ou-pad" style="background:${EMAIL_COLOR.band};border-radius:20px 20px 0 0;padding:26px 32px 30px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-family:${SERIF};font-size:21px;line-height:26px;font-weight:bold;color:#ffffff">OrganizeUp</td>
<td class="ou-date" align="right" style="font-family:${EMAIL_FONT};font-size:13px;line-height:18px;color:${EMAIL_COLOR.bandMuted}">${escapeHtml(dateText)}</td>
</tr></table>
<div style="margin-top:26px;font-family:${EMAIL_FONT};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:${EMAIL_COLOR.peach}">${escapeHtml(hello)}</div>
<h1 class="ou-h1" style="margin:8px 0 0;font-family:${SERIF};font-size:30px;line-height:36px;font-weight:bold;color:#ffffff">${escapeHtml(heading)}</h1>
<p style="margin:10px 0 0;font-family:${EMAIL_FONT};font-size:15px;line-height:22px;color:${EMAIL_COLOR.bandText}">${escapeHtml(intro)}</p>
</td></tr>
${body}
<tr><td class="ou-pad" align="center" style="background:${EMAIL_COLOR.card};border-radius:0 0 20px 20px;padding:28px 32px 34px">
<a href="${escapeHtml(action.url)}" style="display:inline-block;padding:14px 28px;border-radius:12px;background:${EMAIL_COLOR.brand};color:#ffffff;font-family:${EMAIL_FONT};font-size:15px;line-height:20px;font-weight:bold;text-decoration:none">${escapeHtml(action.label)}</a>
</td></tr>
<tr><td class="ou-pad" align="center" style="padding:22px 32px 8px;font-family:${EMAIL_FONT};font-size:12px;line-height:18px;color:${EMAIL_COLOR.muted}">
${escapeHtml(footer.why)}<br>
<a href="${escapeHtml(footer.settingsUrl)}" style="color:${EMAIL_COLOR.brand};font-weight:bold;text-decoration:underline">${escapeHtml(footer.settings)}</a>
<div style="margin-top:14px">${escapeHtml(footer.brand)}</div>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

export function reminderEmail(input: {
  name: string;
  /** Nome da conta (família ou empresa) de onde saem os dados. */
  account: string;
  digest: ReminderDigest;
  locale?: Locale;
  currency?: Currency;
  accountType?: AccountType;
}): ReminderEmail {
  const { digest, locale = DEFAULT_LOCALE, currency = "BRL", accountType } = input;
  const t = textsFor(locale, accountType);
  const cash = (value: string) => formatMoney(value, currency, locale);
  const short = (date: string) => dateParts(date, locale).short;
  const whenText = (when: ReminderWhen, date: string, incoming: boolean) =>
    when === "hoje"
      ? t(incoming ? "reminder.whenToday" : "reminder.whenDueToday")
      : incoming
        ? t("reminder.whenComes", { date: short(date) })
        : when === "atrasada"
          ? t("reminder.whenLate", { date: short(date) })
          : t("reminder.whenDue", { date: short(date) });
  const badgeOf = (when: ReminderWhen) => (when === "adiante" ? undefined : when);

  const sections: Section[] = [];
  const add = <T>(
    block: ReminderBlock<T>,
    section: Omit<Section, "rows" | "more" | "total">,
    toRow: (item: T) => Row,
  ) => {
    if (block.count === 0) return;
    sections.push({
      ...section,
      total: cash(block.total),
      more: block.more,
      rows: block.items.map(toRow),
    });
  };
  add(
    digest.toPay,
    {
      tone: "pay",
      title: t("reminder.payTitle"),
      link: { label: t("reminder.linkEntries"), url: appUrl("/app/lancamentos") },
    },
    (item) => ({
      date: item.date,
      title: clip(item.description),
      detail: `${t(`reminder.source.${item.source}`)} · ${whenText(item.when, item.date, false)}`,
      amount: cash(item.amount),
      badge: badgeOf(item.when),
    }),
  );
  add(
    digest.toReceive,
    {
      tone: "receive",
      title: t("reminder.receiveTitle"),
      link: { label: t("reminder.linkEntries"), url: appUrl("/app/lancamentos") },
    },
    (item) => ({
      date: item.date,
      title: clip(item.description),
      detail: `${t(`reminder.source.${item.source}`)} · ${whenText(item.when, item.date, true)}`,
      amount: cash(item.amount),
      badge: item.when === "hoje" ? "hoje" : undefined,
    }),
  );
  add(
    digest.dividends,
    {
      tone: "receive",
      title: t("reminder.dividendsTitle"),
      link: { label: t("reminder.linkCalendar"), url: appUrl("/app/calendario") },
      note: t("reminder.dividendNote"),
    },
    (item) => ({
      date: item.payDate,
      title: clip(item.ticker),
      detail: `${t(`reminder.kind.${item.kind}`)} · ${whenText(item.when, item.payDate, true)}`,
      amount: cash(item.amount),
      badge: item.when === "hoje" ? "hoje" : undefined,
    }),
  );
  add(
    digest.fresh,
    {
      tone: "fresh",
      title: t("reminder.freshTitle"),
      link: {
        label: t(
          digest.fresh.items.some((item) => item.origin === "conta")
            ? "reminder.linkEntries"
            : "reminder.linkCards",
        ),
        url: appUrl(
          digest.fresh.items.some((item) => item.origin === "conta")
            ? "/app/lancamentos"
            : "/app/cartoes",
        ),
      },
    },
    (item) => ({
      date: item.date,
      title: clip(item.description),
      detail: `${t(`reminder.origin.${item.origin}`)} · ${clip(item.place)}`,
      amount: cash(item.amount),
    }),
  );

  // Assunto só com contagens: nome digitado por alguém aparece apenas dentro do e-mail.
  const counts = [
    digest.toPay.count > 0 ? t("reminder.countPay", { count: digest.toPay.count }) : "",
    digest.toReceive.count > 0 ? t("reminder.countReceive", { count: digest.toReceive.count }) : "",
    digest.dividends.count > 0
      ? t("reminder.countDividends", { count: digest.dividends.count })
      : "",
    digest.fresh.count > 0 ? t("reminder.countFresh", { count: digest.fresh.count }) : "",
  ].filter(Boolean);
  const items = new Intl.ListFormat(locale, { type: "conjunction" }).format(counts);
  const empty = reminderIsEmpty(digest);
  const subject = empty
    ? t("reminder.subjectEmpty")
    : t(digest.daily ? "reminder.subjectDaily" : "reminder.subjectFresh", { items });
  const heading = t(digest.daily ? "reminder.headingDaily" : "reminder.headingFresh");
  const account = cleanName(input.account);
  const intro = t(digest.daily ? "reminder.intro" : "reminder.introFresh", { account });
  // Só o primeiro nome: é um bilhete, e não um cadastro.
  const clean = cleanName(input.name).split(" ")[0] ?? "";
  const hello = clean ? t("helloName", { name: clean }) : t("hello");
  const preheader = empty ? t("reminder.emptyTitle") : t("reminder.preheader", { items });

  const receiveTotal = toDbAmount(money(digest.toReceive.total).plus(digest.dividends.total));
  const tiles = [
    digest.toPay.count > 0
      ? {
          tone: "pay" as const,
          label: t("reminder.tilePay"),
          value: cash(digest.toPay.total),
          hint: t("reminder.countPay", { count: digest.toPay.count }),
        }
      : null,
    digest.toReceive.count + digest.dividends.count > 0
      ? {
          tone: "receive" as const,
          label: t("reminder.tileReceive"),
          value: cash(receiveTotal),
          hint: t("reminder.countReceive", {
            count: digest.toReceive.count + digest.dividends.count,
          }),
        }
      : null,
    digest.fresh.count > 0
      ? {
          tone: "fresh" as const,
          label: t("reminder.tileFresh"),
          value: cash(digest.fresh.total),
          hint: t("reminder.countFresh", { count: digest.fresh.count }),
        }
      : null,
  ].filter((tile) => tile !== null);

  const tilesHtml =
    tiles.length === 0
      ? ""
      : `<tr><td class="ou-pad" style="background:${EMAIL_COLOR.card};padding:24px 28px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${tiles.map((tile) => tileHtml(tile, Math.floor(100 / tiles.length))).join("\n")}
</tr></table>
</td></tr>`;
  const emptyHtml = empty
    ? `<tr><td class="ou-pad" align="center" style="background:${EMAIL_COLOR.card};padding:36px 32px 8px;font-family:${EMAIL_FONT}">
<div style="font-size:17px;line-height:24px;font-weight:bold;color:${EMAIL_COLOR.ink}">${escapeHtml(t("reminder.emptyTitle"))}</div>
<div style="margin-top:6px;font-size:14px;line-height:21px;color:${EMAIL_COLOR.muted}">${escapeHtml(t("reminder.emptyText"))}</div>
</td></tr>`
    : "";
  const openUrl = appUrl("/app");
  const settingsUrl = appUrl(REMINDER_SETTINGS_PATH);

  const html = emailShell({
    locale,
    subject,
    preheader,
    dateText: longDate(digest.today, locale),
    hello,
    heading,
    intro,
    body: [tilesHtml, emptyHtml, ...sections.map((section) => sectionHtml(section, locale, t))]
      .filter(Boolean)
      .join("\n"),
    action: { label: t("reminder.action"), url: openUrl },
    footer: {
      why: t("reminder.footerWhy"),
      settings: t("reminder.footerSettings"),
      settingsUrl,
      brand: t("reminder.footerBrand"),
    },
  });

  const text = [
    `${hello} ${heading}`,
    intro,
    empty ? `${t("reminder.emptyTitle")}\n${t("reminder.emptyText")}` : "",
    ...sections.map((section) =>
      [
        `${section.title.toLocaleUpperCase(locale)} (${t("reminder.total")} ${section.total})`,
        ...section.rows.map(
          (row) => `- ${short(row.date)}  ${row.title}: ${row.amount} (${row.detail})`,
        ),
        section.more > 0 ? t("reminder.more", { count: section.more }) : "",
        section.note ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    `${t("reminder.action")}: ${openUrl}`,
    `${t("reminder.footerWhy")}\n${t("reminder.footerSettings")}: ${settingsUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject, html, text, template: "lembrete" };
}
