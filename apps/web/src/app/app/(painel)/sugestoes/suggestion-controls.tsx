"use client";
// Botões e retorno de uma sugestão, usados em Sugestões, Viagens e Investimentos. O estado fica em
// quem chama: aceitar tira o cartão da tela, e a mensagem precisa sobreviver a ele.
import type { ApplyResult } from "@organizeup/agents";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Button, FormMessage } from "@/components/ui";
import { applySuggestion, dismissSuggestion } from "./actions";

type SuggestionAction = (form: FormData) => Promise<ApplyResult>;

export function useSuggestionActions() {
  const t = useTranslations("sugestoes.decision");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [, startTransition] = useTransition();

  async function settle(action: SuggestionAction, form: FormData) {
    try {
      setResult(await action(form));
    } catch {
      setResult({ ok: false, message: t("failed") });
    }
  }

  function run(action: SuggestionAction, id: string) {
    setBusy(id);
    const form = new FormData();
    form.set("id", id);
    startTransition(async () => {
      await settle(action, form);
      setBusy(null);
    });
  }

  return { busy, result, run, settle };
}

export type SuggestionActions = ReturnType<typeof useSuggestionActions>;

export function SuggestionFeedback({ result }: { result: ApplyResult | null }) {
  return <FormMessage message={result?.message} tone={result?.ok ? "ok" : "error"} />;
}

export function DecisionButtons({
  id,
  title,
  acceptLabel,
  fromIntention = false,
  actions,
}: {
  id: string;
  title: string;
  acceptLabel?: string;
  /** Recusar uma intenção vale o ano, não 30 dias. */
  fromIntention?: boolean;
  actions: SuggestionActions;
}) {
  const t = useTranslations("sugestoes.decision");
  const accept = acceptLabel ?? t("accept");
  const hintId = useId();
  const disabled = actions.busy !== null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button
        small
        disabled={disabled}
        aria-label={t("labeled", { action: accept, name: title })}
        onClick={() => actions.run(applySuggestion, id)}
      >
        {accept}
      </Button>
      <Button
        variant="secondary"
        small
        disabled={disabled}
        aria-label={t("labeled", { action: t("later"), name: title })}
        aria-describedby={hintId}
        onClick={() => actions.run(dismissSuggestion, id)}
      >
        {t("later")}
      </Button>
      <span id={hintId} className="text-xs text-muted">
        {t(fromIntention ? "laterHintIntention" : "laterHint")}
      </span>
    </div>
  );
}
