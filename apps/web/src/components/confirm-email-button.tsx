"use client";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { resendConfirmation } from "@/app/(auth)/confirmar-email/actions";
import { Button, FormMessage } from "@/components/ui";

/** Pede um novo link para o e-mail da própria conta. O resultado aparece logo abaixo do botão. */
export function ConfirmEmailButton() {
  const t = useTranslations("auth.confirmEmail");
  const [state, action, pending] = useActionState(resendConfirmation, {
    ok: false,
    message: null,
  });
  return (
    <form action={action} className="flex min-w-0 flex-col items-start gap-1">
      <Button type="submit" variant="secondary" small disabled={pending}>
        {pending ? t("sending") : t("send")}
      </Button>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
    </form>
  );
}
