"use client";
import { expandWipeScopes, WIPE_REQUIRES, WIPE_SCOPES, type WipeScope } from "@organizeup/domain";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import type { ActionState } from "@/app/app/actions";
import { Button, Field, FormMessage, Input, Sheet } from "@/components/ui";
import { wipeData } from "./actions";

const initial: ActionState = { ok: false, message: null };

function WipeForm({
  onCancel,
  twoFactorEnabled,
}: {
  onCancel: () => void;
  twoFactorEnabled: boolean;
}) {
  const t = useTranslations("settings.wipe");
  const tTwo = useTranslations("settings.twoFactor");
  const tCommon = useTranslations("common");
  const [chosen, setChosen] = useState<Set<WipeScope>>(new Set());
  const [state, action, pending] = useActionState(wipeData, initial);
  // O que vai junto aparece marcado e travado: o servidor fecha a mesma lista.
  const effective = new Set(expandWipeScopes(chosen));
  const allChosen = chosen.size === WIPE_SCOPES.length;
  const toggle = (scope: WipeScope, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("text")}</p>
      {!twoFactorEnabled ? <FormMessage message={tTwo("requiredToContinue")} /> : null}
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-sm font-medium">{t("choose")}</p>
        <Button
          type="button"
          variant="secondary"
          small
          onClick={() => setChosen(allChosen ? new Set() : new Set(WIPE_SCOPES))}
        >
          {allChosen ? t("clearAll") : t("selectAll")}
        </Button>
      </div>
      <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-lg border border-line p-0">
        {WIPE_SCOPES.map((scope) => {
          const implied = effective.has(scope) && !chosen.has(scope);
          const requires = WIPE_REQUIRES[scope];
          return (
            <li key={scope} className="flex items-start gap-3 px-3 py-2.5 text-sm">
              <input
                id={`wipe-${scope}`}
                type="checkbox"
                name="scope"
                value={scope}
                className="mt-1 size-4 accent-brand-700"
                checked={effective.has(scope)}
                disabled={implied}
                onChange={(event) => toggle(scope, event.target.checked)}
              />
              <label htmlFor={`wipe-${scope}`} className="flex-1">
                <span className="font-medium">{t(`scopes.${scope}.label`)}</span>
                <span className="block text-xs text-muted">{t(`scopes.${scope}.detail`)}</span>
                {requires ? (
                  <span className="block text-xs text-warning">
                    {t("pulls", {
                      list: requires.map((item) => t(`scopes.${item}.label`)).join(", "),
                    })}
                  </span>
                ) : null}
                {implied ? (
                  <span className="block text-xs text-warning">{t("goesAlong")}</span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
      <Field label={t("confirmLabel")} error={state.fieldErrors?.confirm}>
        <Input name="confirm" autoComplete="off" placeholder="APAGAR" required />
      </Field>
      <Field label={tTwo("codeLabel")} hint={tTwo("codeHint")} error={state.fieldErrors?.code}>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" required />
      </Field>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="danger"
          className="flex-1"
          disabled={pending || !twoFactorEnabled || effective.size === 0}
        >
          {pending ? t("pending") : t("submit", { count: effective.size })}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
      </div>
    </form>
  );
}

export function WipeData({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const t = useTranslations("settings.wipe");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" small onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("open")}>
        <WipeForm onCancel={() => setOpen(false)} twoFactorEnabled={twoFactorEnabled} />
      </Sheet>
    </>
  );
}
