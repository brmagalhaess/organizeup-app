"use client";
import { useState, useTransition } from "react";
import { Button, FormMessage } from "@/components/ui";
import type { AdminResult } from "../painel-result";
import { testAssistantModel } from "./actions";

/** Roda o ciclo completo com pergunta fixa. Nenhum dado de família é enviado. */
export function TestAssistant() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminResult | null>(null);
  return (
    <div className="mt-3 flex flex-col gap-2">
      <FormMessage message={result?.message} tone={result?.ok ? "ok" : "error"} />
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        className="self-start"
        onClick={() => start(async () => setResult(await testAssistantModel()))}
      >
        {pending ? "Testando…" : "Testar a IA"}
      </Button>
    </div>
  );
}
