"use client";
import { FileSignature } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  calculateSeverance,
  fiscalTableFor,
  parseMoney,
  SEVERANCE_REASONS,
  type FiscalTable,
  type SeveranceReason,
} from "@organizeup/domain";
import { Button, ConfirmSheet, Field, Input, Select } from "@/components/ui";
import { formatDate, toAmountInput } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { useMoney } from "@/i18n/money";
import { settleSeverance } from "./actions";

export interface SeveranceSource {
  id: string;
  name: string;
  gross: string;
  dependents: number;
  pension: string;
  jobStartedOn: string | null;
  /** Adiantamento do 13º já recebido no ano, pelo plano ou pelo lançamento. */
  thirteenthAdvancePaid: string;
}

function parseOptional(value: string, locale: Locale): string | null {
  if (!value.trim()) return null;
  try {
    const parsed = parseMoney(value, locale);
    return parsed.lt(0) ? null : parsed.toFixed(2);
  } catch {
    return null;
  }
}

/**
 * Rescisão estimada hoje (ADR-0031). Só informativo, recalculado a cada visita; grava algo só em
 * "Lançar rescisão", que cria a receita e encerra a renda.
 */
export function SeveranceCard({
  source,
  tables,
  today,
  writable,
}: {
  source: SeveranceSource;
  tables: FiscalTable[];
  today: string;
  writable: boolean;
}) {
  const t = useTranslations("renda.severance");
  const locale = useLocale() as Locale;
  const moneyText = useMoney();
  const [open, setOpen] = useState(false);
  const [exitDate, setExitDate] = useState(today);
  const [reason, setReason] = useState<SeveranceReason>("sem_justa_causa");
  const [notice, setNotice] = useState(true);
  const [fgts, setFgts] = useState("");
  const [confirming, setConfirming] = useState(false);

  const date = /^\d{4}-\d{2}-\d{2}$/.test(exitDate) ? exitDate : today;
  const result = calculateSeverance(
    {
      gross: source.gross,
      dependents: source.dependents,
      pension: source.pension,
      otherDiscounts: "0",
      jobStartedOn: source.jobStartedOn,
      exitDate: date,
      reason,
      noticeIndemnified: notice,
      thirteenthAdvancePaid: source.thirteenthAdvancePaid,
      fgtsBalance: parseOptional(fgts, locale),
    },
    fiscalTableFor(tables, date.slice(0, 7)),
  );
  const line = (label: string, value: string, hint?: string) => (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <dt className="text-muted">
        {label}
        {hint ? <span className="block text-xs">{hint}</span> : null}
      </dt>
      <dd className="m-0 font-medium tabular-nums">{moneyText(value)}</dd>
    </div>
  );

  return (
    <section aria-label={t("title")} className="rounded-xl bg-card-soft p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <p className="m-0 text-xs text-muted">
            {t("subtitle", { total: moneyText(result.total), date: formatDate(date, locale) })}
          </p>
        </div>
        <Button variant="ghost" small onClick={() => setOpen((value) => !value)}>
          {open ? t("hide") : t("show")}
        </Button>
      </div>
      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t("exitDate")}>
              <Input
                type="date"
                value={exitDate}
                min="2000-01-01"
                max="2100-12-31"
                onChange={(event) => setExitDate(event.target.value)}
              />
            </Field>
            <Field label={t("reason")}>
              <Select
                value={reason}
                onChange={(event) => setReason(event.target.value as SeveranceReason)}
              >
                {SEVERANCE_REASONS.map((value) => (
                  <option key={value} value={value}>
                    {t(`reasons.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("fgts")} hint={t("fgtsHint")}>
              <Input
                inputMode="decimal"
                value={fgts}
                placeholder={toAmountInput(result.fgts.balance, locale)}
                onChange={(event) => setFgts(event.target.value)}
              />
            </Field>
          </div>
          {reason !== "pedido" ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notice}
                onChange={(event) => setNotice(event.target.checked)}
              />
              {t("noticeIndemnified")}
            </label>
          ) : null}
          <dl className="m-0 divide-y divide-line">
            {line(
              t("lines.salaryBalance", { days: result.salaryBalance.days }),
              result.salaryBalance.net,
              t("lines.taxed", {
                inss: moneyText(result.salaryBalance.inss),
                tax: moneyText(result.salaryBalance.tax),
              }),
            )}
            {result.notice.days > 0
              ? line(t("lines.notice", { days: result.notice.days }), result.notice.amount)
              : null}
            {line(
              t("lines.thirteenth", { twelfths: result.thirteenth.twelfths }),
              result.thirteenth.net,
              t("lines.taxed", {
                inss: moneyText(result.thirteenth.inss),
                tax: moneyText(result.thirteenth.tax),
              }),
            )}
            {line(
              t("lines.vacation", { twelfths: result.vacation.twelfths }),
              result.vacation.amount,
            )}
            <div className="flex items-baseline justify-between gap-3 py-2 text-sm font-semibold">
              <dt>{t("lines.total")}</dt>
              <dd className="m-0 tabular-nums">{moneyText(result.total)}</dd>
            </div>
            {line(
              t("lines.fgts"),
              result.fgts.withdrawable,
              t(result.fgts.estimated ? "lines.fgtsEstimated" : "lines.fgtsInformed", {
                balance: moneyText(result.fgts.balance),
                fine: moneyText(result.fgts.fine),
              }),
            )}
          </dl>
          <ul className="m-0 list-none p-0 text-xs text-muted">
            {result.notes.map((note) => (
              <li key={note}>{t(`notes.${note}`)}</li>
            ))}
            <li>{t("notes.estimate")}</li>
          </ul>
          {writable ? (
            <div>
              <Button variant="secondary" onClick={() => setConfirming(true)}>
                <FileSignature className="size-4" aria-hidden="true" />
                {t("settle")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("confirm.title")}
        text={t("confirm.text", {
          total: moneyText(result.total),
          date: formatDate(date, locale),
          name: source.name,
        })}
        confirmLabel={t("confirm.action")}
        action={settleSeverance}
        hidden={{
          id: source.id,
          exitDate: date,
          reason,
          noticeIndemnified: notice ? "on" : "",
          fgtsBalance: parseOptional(fgts, locale) ?? "",
        }}
      />
    </section>
  );
}
