// E-mail mensal do plano de aposentadoria (ADR-0039): onde o plano por proventos está hoje. Usa a mesma
// moldura do lembrete do dia.
import {
  formatMoney,
  money,
  toDbAmount,
  type AccountType,
  type Currency,
  type RetirementSummary,
} from "@organizeup/domain";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";
import { appUrl, cleanName, escapeHtml, textsFor } from "./email-templates";
import {
  EMAIL_COLOR as C,
  EMAIL_FONT as FONT,
  emailShell,
  REMINDER_SETTINGS_PATH,
  tileHtml,
  type ReminderEmail,
} from "./reminder-email";

const monthText = (month: string, locale: Locale) => {
  const text = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
};

const monthName = (month: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    new Date(`${month}-01T12:00:00Z`),
  );

export function retirementEmail(input: {
  name: string;
  account: string;
  summary: RetirementSummary;
  locale?: Locale;
  currency?: Currency;
  accountType?: AccountType;
}): ReminderEmail {
  const { summary, locale = DEFAULT_LOCALE, currency = "BRL", accountType } = input;
  const t = textsFor(locale, accountType);
  const cash = (value: string) => formatMoney(value, currency, locale);
  const perMonth = (value: string) => t("retirement.perMonth", { amount: cash(value) });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const covered = Math.min(Math.max(summary.coverage, 0), 100);
  const missing = money(summary.incomeGap).minus(summary.currentIncome);
  const missingText = toDbAmount(missing.lt(0) ? money(0) : missing);

  // O veredito: no ritmo de hoje, chega no ano da meta, depois dele ou não chega.
  const { targetYear, yearWithContribution: reach } = summary;
  const verdict =
    covered >= 100
      ? { tone: "good" as const, text: t("retirement.verdictDone") }
      : targetYear === null
        ? { tone: "warn" as const, text: t("retirement.verdictNoYear") }
        : reach === null
          ? { tone: "warn" as const, text: t("retirement.verdictNever") }
          : reach <= targetYear
            ? { tone: "good" as const, text: t("retirement.verdictOnTime", { year: reach }) }
            : {
                tone: "warn" as const,
                text: summary.requiredContribution
                  ? t("retirement.verdictLate", {
                      year: reach,
                      years: reach - targetYear,
                      amount: cash(summary.requiredContribution),
                      target: targetYear,
                    })
                  : t("retirement.verdictLateNoFix", { year: reach, years: reach - targetYear }),
              };

  const rows: Array<[string, string]> = [
    [t("retirement.rowYear"), targetYear === null ? t("retirement.noYear") : String(targetYear)],
    ...(summary.requiredPortfolio
      ? ([[t("retirement.rowPortfolio"), cash(summary.requiredPortfolio)]] as Array<
          [string, string]
        >)
      : []),
    ...(summary.portfolioGap
      ? ([[t("retirement.rowGap"), cash(summary.portfolioGap)]] as Array<[string, string]>)
      : []),
    [t("retirement.rowContribution"), perMonth(summary.contribution)],
    ...(summary.requiredContribution
      ? ([[t("retirement.rowRequired"), perMonth(summary.requiredContribution)]] as Array<
          [string, string]
        >)
      : []),
    ...(summary.projectedIncomeAtTarget && targetYear !== null
      ? ([
          [
            t("retirement.rowProjected", { year: targetYear }),
            perMonth(summary.projectedIncomeAtTarget),
          ],
        ] as Array<[string, string]>)
      : []),
  ];

  const subject = t("retirement.subject", { month: monthName(summary.month, locale) });
  const heading = t("retirement.heading");
  const account = cleanName(input.account);
  const intro = t("retirement.intro", { account });
  const clean = cleanName(input.name).split(" ")[0] ?? "";
  const hello = clean ? t("helloName", { name: clean }) : t("hello");
  const coverageText = t("retirement.coverage", { percent: percent.format(covered / 100) });
  const tiles = [
    {
      tone: "fresh" as const,
      label: t("retirement.tileTarget"),
      value: cash(summary.targetIncome),
    },
    {
      tone: "receive" as const,
      label: t("retirement.tileCurrent"),
      value: cash(summary.currentIncome),
    },
    { tone: "pay" as const, label: t("retirement.tileMissing"), value: cash(missingText) },
  ].map((tile) => ({ ...tile, hint: t("retirement.tileHint") }));
  const paint =
    verdict.tone === "good"
      ? { soft: C.successSoft, ink: C.success }
      : { soft: "#fdf3dc", ink: "#8a5a00" };
  const openUrl = appUrl("/app/aposentadoria");
  const settingsUrl = appUrl(REMINDER_SETTINGS_PATH);

  const body = `<tr><td class="ou-pad" style="background:${C.card};padding:26px 32px 4px;font-family:${FONT}">
<div style="font-size:12px;line-height:16px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">${escapeHtml(t("retirement.coverageTitle"))}</div>
<div style="margin-top:6px;font-size:40px;line-height:44px;font-weight:bold;color:${C.ink}">${escapeHtml(percent.format(covered / 100))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;background:${C.line};border-radius:999px"><tr>
<td width="${Math.max(Math.round(covered), 2)}%" height="12" style="height:12px;line-height:12px;font-size:0;background:${C.brand};border-radius:999px">&nbsp;</td>
<td height="12" style="height:12px;line-height:12px;font-size:0">&nbsp;</td>
</tr></table>
<p style="margin:10px 0 0;font-size:14px;line-height:21px;color:${C.muted}">${escapeHtml(coverageText)}</p>
</td></tr>
<tr><td class="ou-pad" style="background:${C.card};padding:18px 28px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${tiles.map((tile) => tileHtml(tile, 33)).join("\n")}
</tr></table>
</td></tr>
<tr><td class="ou-pad" style="background:${C.card};padding:14px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-radius:14px;background:${paint.soft};padding:14px 16px;font-family:${FONT};font-size:15px;line-height:22px;font-weight:bold;color:${paint.ink}">${escapeHtml(verdict.text)}</td></tr></table>
</td></tr>
<tr><td class="ou-pad" style="background:${C.card};padding:18px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${rows
  .map(
    ([label, value]) => `<tr>
<td style="padding:11px 8px 11px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted}">${escapeHtml(label)}</td>
<td align="right" style="padding:11px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:15px;line-height:20px;font-weight:bold;white-space:nowrap;color:${C.ink}">${escapeHtml(value)}</td>
</tr>`,
  )
  .join("\n")}
</table>
<p style="margin:12px 0 0;font-family:${FONT};font-size:12px;line-height:17px;color:${C.muted}">${escapeHtml(t("retirement.note"))}</p>
</td></tr>`;

  const html = emailShell({
    locale,
    subject,
    preheader: `${coverageText} ${verdict.text}`,
    dateText: monthText(summary.month, locale),
    hello,
    heading,
    intro,
    body,
    action: { label: t("retirement.action"), url: openUrl },
    footer: {
      why: t("retirement.footerWhy"),
      settings: t("reminder.footerSettings"),
      settingsUrl,
      brand: t("reminder.footerBrand"),
    },
  });
  const text = [
    `${hello} ${heading}`,
    intro,
    coverageText,
    tiles.map((tile) => `${tile.label}: ${tile.value} (${tile.hint})`).join("\n"),
    verdict.text,
    rows.map(([label, value]) => `- ${label}: ${value}`).join("\n"),
    t("retirement.note"),
    `${t("retirement.action")}: ${openUrl}`,
    `${t("retirement.footerWhy")}\n${t("reminder.footerSettings")}: ${settingsUrl}`,
  ].join("\n\n");
  return { subject, html, text, template: "lembrete" };
}
