"use client";
// Botões e retorno de uma sugestão, usados em Sugestões, Viagens e Investimentos. O estado fica em
// quem chama: aceitar tira o cartão da tela, e a mensagem precisa sobreviver a ele.
import type { ApplyResult } from "@organizeup/agents";
import { useId, useState, useTransition } from "react";
import { Button, FormMessage } from "@/components/ui";
import { applySuggestion, dismissSuggestion } from "./actions";

type SuggestionAction = (form: FormData) => Promise<ApplyResult>;

const FAILED: ApplyResult = {
  ok: false,
  message: "Não foi possível concluir agora. Atualize a página e tente de novo.",
};

export function useSuggestionActions() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [, startTransition] = useTransition();

  async function settle(action: SuggestionAction, form: FormData) {
    try {
      setResult(await action(form));
    } catch {
      setResult(FAILED);
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
  acceptLabel = "Aceitar",
  actions,
}: {
  id: string;
  title: string;
  acceptLabel?: string;
  actions: SuggestionActions;
}) {
  const hintId = useId();
  const disabled = actions.busy !== null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button
        small
        disabled={disabled}
        aria-label={`${acceptLabel}: ${title}`}
        onClick={() => actions.run(applySuggestion, id)}
      >
        {acceptLabel}
      </Button>
      <Button
        variant="secondary"
        small
        disabled={disabled}
        aria-label={`Agora não: ${title}`}
        aria-describedby={hintId}
        onClick={() => actions.run(dismissSuggestion, id)}
      >
        Agora não
      </Button>
      <span id={hintId} className="text-xs text-muted">
        Voltamos a sugerir daqui a 30 dias
      </span>
    </div>
  );
}
