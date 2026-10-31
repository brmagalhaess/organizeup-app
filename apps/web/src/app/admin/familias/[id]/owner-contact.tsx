"use client";
import { useActionState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { revealOwner } from "../actions";

export function OwnerContact({ id, family }: { id: string; family: string }) {
  const [state, action, pending] = useActionState(revealOwner, {
    name: null,
    email: null,
    message: null,
  });
  if (state.email) {
    return (
      <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm">
        <span className="text-muted">Responsável: </span>
        <span className="font-medium">{state.name}</span>
        <span className="text-muted"> · </span>
        <span className="break-all">{state.email}</span>
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="secondary"
        small
        disabled={pending}
        aria-label={`Ver contato do responsável de ${family}`}
      >
        Ver contato do responsável
      </Button>
      <FormMessage message={state.message} />
    </form>
  );
}
