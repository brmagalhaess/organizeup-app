"use client";
import { useTranslations } from "next-intl";
import { useTransition, useState } from "react";
import { confirmEntryNotice } from "@/app/app/(painel)/lancamentos/actions";
import type { ButtonVariant } from "@/components/styles";
import { Button, Sheet } from "@/components/ui";

/**
 * Botão de pagar, receber ou guardar. Em conta estrangeira sem cotação nada é confirmado, e a pessoa
 * precisa saber: o aviso abre por cima da tela, porque a linha do botão não tem lugar para ele.
 */
export function ConfirmEntryButton({
  entryKey,
  month,
  label,
  ariaLabel,
  variant = "secondary",
  small = true,
}: {
  entryKey: string;
  month?: string;
  label: string;
  /** Nome do botão quando há vários iguais na tela. */
  ariaLabel?: string;
  variant?: ButtonVariant;
  small?: boolean;
}) {
  const t = useTranslations("lancamentos.confirmNotice");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm(form: FormData) {
    startTransition(async () => {
      setNotice(await confirmEntryNotice(form).catch(() => t("failed")));
    });
  }

  return (
    <>
      <form action={confirm}>
        <input type="hidden" name="key" value={entryKey} />
        {month ? <input type="hidden" name="month" value={month} /> : null}
        <Button
          type="submit"
          variant={variant}
          small={small}
          disabled={pending}
          aria-label={ariaLabel}
        >
          {label}
        </Button>
      </form>
      <Sheet open={notice !== null} onClose={() => setNotice(null)} title={t("title")}>
        <p role="alert" className="text-sm">
          {notice}
        </p>
        <Button type="button" className="mt-6 w-full" onClick={() => setNotice(null)}>
          {t("close")}
        </Button>
      </Sheet>
    </>
  );
}
