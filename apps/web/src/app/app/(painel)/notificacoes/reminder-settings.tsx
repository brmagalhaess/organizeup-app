"use client";
import {
  CalendarClock,
  CircleDollarSign,
  Mail,
  ReceiptText,
  Sunrise,
  TrendingUp,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState, type ReactNode } from "react";
import { REMINDER_MAX_DAYS_AHEAD, type ReminderSettings } from "@organizeup/domain";
import { cx } from "@/components/styles";
import { Badge, Button, Card, FormMessage, Select } from "@/components/ui";
import {
  saveReminders,
  sendReminderNow,
  sendRetirementNow,
  type ReminderFormState,
} from "./actions";

export interface ReminderEmailInfo {
  address: string;
  verified: boolean;
  /** O serviço de e-mail está configurado neste ambiente. */
  canSend: boolean;
}

const initial: ReminderFormState = { ok: false, message: "" };

function Choice({
  name,
  icon,
  title,
  text,
  checked,
  disabled,
  onChange,
  children,
}: {
  name: string;
  icon: ReactNode;
  title: string;
  text: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <li
      className={cx(
        "rounded-xl border border-line p-4 transition-colors",
        checked && !disabled ? "bg-brand-50/60" : "bg-card",
        disabled && "opacity-60",
      )}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-brand-500"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-brand-500">{icon}</span>
            {title}
          </span>
          <span className="mt-0.5 block text-sm text-muted">{text}</span>
        </span>
      </label>
      {children}
    </li>
  );
}

/** O que a pessoa recebe por e-mail (ADR-0039). Vale para o acesso dela nesta conta. */
export function ReminderSettingsCard({
  settings,
  email,
}: {
  settings: ReminderSettings;
  email: ReminderEmailInfo;
}) {
  const t = useTranslations("notificacoes.reminders");
  const [values, setValues] = useState(settings);
  const [saved, save, saving] = useActionState(saveReminders, initial);
  const [sent, send, sending] = useActionState(sendReminderNow, initial);
  const [plan, sendPlan, sendingPlan] = useActionState(sendRetirementNow, initial);
  const set = (key: keyof ReminderSettings) => (value: boolean) =>
    setValues((current) => ({ ...current, [key]: value }));
  const off = !values.enabled;

  return (
    <Card
      title={t("title")}
      description={t("text", { email: email.address })}
      actions={
        <Badge tone={values.enabled ? "success" : "neutral"}>
          {t(values.enabled ? "on" : "off")}
        </Badge>
      }
    >
      {email.verified ? null : <FormMessage message={t("unverified")} tone="error" />}
      <form action={save} className="flex flex-col gap-4">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-card-soft p-4">
          <input
            type="checkbox"
            name="enabled"
            checked={values.enabled}
            onChange={(event) => set("enabled")(event.target.checked)}
            className="size-5 shrink-0 accent-brand-500"
          />
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
            <Mail className="size-4 text-brand-500" aria-hidden="true" />
            {t("master")}
          </span>
        </label>

        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
          <Choice
            name="bills"
            icon={<ReceiptText className="size-4" aria-hidden="true" />}
            title={t("bills.title")}
            text={t("bills.text")}
            checked={values.bills}
            disabled={off}
            onChange={set("bills")}
          >
            <label className="mt-3 flex flex-wrap items-center gap-2 pl-7 text-sm text-muted">
              {t("daysAhead")}
              <span className="w-60 max-w-full">
                <Select
                  name="daysAhead"
                  value={values.daysAhead}
                  disabled={off || !values.bills}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, daysAhead: Number(event.target.value) }))
                  }
                >
                  {Array.from({ length: REMINDER_MAX_DAYS_AHEAD + 1 }, (_, days) => (
                    <option key={days} value={days}>
                      {t("days", { count: days })}
                    </option>
                  ))}
                </Select>
              </span>
            </label>
          </Choice>
          <Choice
            name="income"
            icon={<CircleDollarSign className="size-4" aria-hidden="true" />}
            title={t("income.title")}
            text={t("income.text")}
            checked={values.income}
            disabled={off}
            onChange={set("income")}
          />
          <Choice
            name="dividends"
            icon={<TrendingUp className="size-4" aria-hidden="true" />}
            title={t("dividends.title")}
            text={t("dividends.text")}
            checked={values.dividends}
            disabled={off}
            onChange={set("dividends")}
          />
          <Choice
            name="expenses"
            icon={<CalendarClock className="size-4" aria-hidden="true" />}
            title={t("expenses.title")}
            text={t("expenses.text")}
            checked={values.expenses}
            disabled={off}
            onChange={set("expenses")}
          />
          <Choice
            name="retirement"
            icon={<Sunrise className="size-4" aria-hidden="true" />}
            title={t("retirement.title")}
            text={t("retirement.text")}
            checked={values.retirement}
            disabled={off}
            onChange={set("retirement")}
          />
        </ul>
        {/* Campo desligado não vai no formulário: a antecedência segue junto mesmo assim. */}
        {off || !values.bills ? (
          <input type="hidden" name="daysAhead" value={values.daysAhead} />
        ) : null}
        {off
          ? (["bills", "income", "dividends", "expenses", "retirement"] as const).map((key) =>
              values[key] ? <input key={key} type="hidden" name={key} value="on" /> : null,
            )
          : null}

        <p className="m-0 text-xs text-muted">{t("when")}</p>
        <FormMessage message={saved.message} tone={saved.ok ? "ok" : "error"} />
        <FormMessage message={sent.message} tone={sent.ok ? "ok" : "error"} />
        <FormMessage message={plan.message} tone={plan.ok ? "ok" : "error"} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? t("saving") : t("save")}
          </Button>
          <Button
            type="submit"
            variant="secondary"
            formAction={send}
            disabled={sending || !email.canSend || !email.verified}
          >
            {sending ? t("sending") : t("sendNow")}
          </Button>
          <Button
            type="submit"
            variant="secondary"
            formAction={sendPlan}
            disabled={sendingPlan || !email.canSend || !email.verified}
          >
            {sendingPlan ? t("sending") : t("sendRetirement")}
          </Button>
          {email.canSend ? null : <span className="text-xs text-muted">{t("emailOff")}</span>}
        </div>
      </form>
    </Card>
  );
}
