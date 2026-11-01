"use client";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Badge, Button, ConfirmSheet, Field, FormMessage, Select } from "@/components/ui";
import { acceptInsights, changeAutonomy, deactivate, type AssistantActionState } from "./actions";

const LEVELS = ["sugerir", "organizar", "completo"] as const;

const initial: AssistantActionState = { ok: false, message: null };

/** Aceite que falta para quem autorizou antes das dicas da madrugada. */
function InsightsConsent({ autonomy }: { autonomy: string }) {
  const t = useTranslations("settings.assistant");
  const [state, action, pending] = useActionState(acceptInsights, initial);
  return (
    <form action={action} className="flex flex-col gap-2 rounded-xl border border-line p-3 text-sm">
      <p className="m-0 font-medium">{t("insightsTitle")}</p>
      <p className="m-0 text-muted">{t("insightsText")}</p>
      <input type="hidden" name="autonomy" value={autonomy} />
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-brand-700" />
        <span>{t("consentLabel")}</span>
      </label>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {pending ? t("insightsPending") : t("insightsSubmit")}
      </Button>
    </form>
  );
}

/** Bloco de Configurações: ver o aceite, mudar o nível e desligar. */
export function AssistantSettings({
  active,
  acceptedOn,
  autonomy,
  canManage,
  needsInsightsConsent,
}: {
  active: boolean;
  acceptedOn: string | null;
  autonomy: string;
  canManage: boolean;
  needsInsightsConsent: boolean;
}) {
  const t = useTranslations("settings.assistant");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(changeAutonomy, initial);
  const [confirming, setConfirming] = useState(false);
  const level = LEVELS.find((item) => item === autonomy);

  if (!active) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <Badge>{t("off")}</Badge>
        <p className="m-0 text-muted">{canManage ? t("offHint") : t("offHintReadOnly")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="success">{t("on")}</Badge>
        {acceptedOn ? (
          <span className="text-muted">{t("acceptedOn", { date: acceptedOn })}</span>
        ) : null}
      </div>
      {needsInsightsConsent && canManage ? <InsightsConsent autonomy={autonomy} /> : null}
      <form action={action} className="flex flex-col gap-3">
        <fieldset disabled={!canManage} className="contents">
          <Field label={t("levelLabel")} {...(level ? { hint: t(`levels.${level}Text`) } : {})}>
            <Select name="autonomy" defaultValue={autonomy}>
              {LEVELS.map((option) => (
                <option key={option} value={option}>
                  {t(`levels.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" disabled={pending || !canManage}>
            {pending ? tCommon("saving") : t("levelSave")}
          </Button>
        </fieldset>
        <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      </form>
      {canManage ? (
        <>
          <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
            {t("turnOff")}
          </Button>
          <ConfirmSheet
            open={confirming}
            onClose={() => setConfirming(false)}
            title={t("turnOff")}
            text={t("turnOffText")}
            confirmLabel={t("turnOffConfirm")}
            action={deactivate}
            hidden={{}}
          />
        </>
      ) : null}
    </div>
  );
}
