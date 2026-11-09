"use client";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import type { ActionState } from "@/app/app/actions";
import { Button, Field, FormMessage, Input, Sheet } from "@/components/ui";
import { deleteAccount } from "./actions";

const initial: ActionState = { ok: false, message: null };

function DeleteForm({
  onCancel,
  twoFactorEnabled,
}: {
  onCancel: () => void;
  twoFactorEnabled: boolean;
}) {
  const t = useTranslations("settings.deleteAccount");
  const tTwo = useTranslations("settings.twoFactor");
  const tCommon = useTranslations("common");
  const [state, action, pending] = useActionState(deleteAccount, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("text")}</p>
      {!twoFactorEnabled ? <FormMessage message={tTwo("requiredToContinue")} /> : null}
      <Field label={t("password")} error={state.fieldErrors?.password}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Field label={tTwo("codeLabel")} hint={tTwo("codeHint")} error={state.fieldErrors?.code}>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" required />
      </Field>
      <FormMessage message={state.message} />
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="danger"
          className="flex-1"
          disabled={pending || !twoFactorEnabled}
        >
          {pending ? t("pending") : t("submit")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
      </div>
    </form>
  );
}

export function DeleteAccount({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const t = useTranslations("settings.deleteAccount");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" small onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("open")}>
        <DeleteForm onCancel={() => setOpen(false)} twoFactorEnabled={twoFactorEnabled} />
      </Sheet>
    </>
  );
}
