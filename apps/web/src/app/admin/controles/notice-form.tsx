"use client";
import { useRef, useState, useTransition } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import type { AdminResult } from "../painel-result";
import { createNotice } from "./actions";

export function NoticeForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminResult | null>(null);
  return (
    <form
      ref={ref}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        start(async () => {
          const outcome = await createNotice(form);
          setResult(outcome);
          if (outcome.ok) ref.current?.reset();
        });
      }}
    >
      <Field label="Texto do aviso" hint="Aparece no topo do app. Não coloque dados de ninguém.">
        <Input name="text" maxLength={300} required autoComplete="off" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Início" hint="Vazio: começa agora. Horário de Brasília.">
          <Input name="startsAt" type="datetime-local" />
        </Field>
        <Field label="Fim" hint="Vazio: fica até você remover.">
          <Input name="endsAt" type="datetime-local" />
        </Field>
      </div>
      <FormMessage message={result?.message} tone={result?.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Publicando…" : "Publicar aviso"}
      </Button>
    </form>
  );
}
