"use client";
import { useActionState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { revealUserDocument } from "../actions";

/** Fica só na memória da página: cada consulta é uma ação nova, registrada na auditoria. */
export function UserDocument({ id }: { id: string }) {
  const [state, action, pending] = useActionState(revealUserDocument, {
    cpf: null,
    cnpj: null,
    companyName: null,
    message: null,
  });
  if (state.cpf) {
    return (
      <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm">
        {state.companyName ? <span className="font-medium">{state.companyName} · </span> : null}
        {state.cnpj ? <span className="break-all">{state.cnpj} · </span> : null}
        <span className="break-all">{state.cpf}</span>
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="secondary" small disabled={pending}>
        Ver documento completo
      </Button>
      <FormMessage message={state.message} />
    </form>
  );
}
