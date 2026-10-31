"use client";
import { useActionState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { revealUser } from "../actions";

export function UserContact({ id }: { id: string }) {
  const [state, action, pending] = useActionState(revealUser, {
    name: null,
    email: null,
    message: null,
  });
  if (state.email) {
    return (
      <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm">
        <span className="font-medium">{state.name}</span>
        <span className="text-muted"> · </span>
        <span className="break-all">{state.email}</span>
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="secondary" small disabled={pending}>
        Ver nome e e-mail
      </Button>
      <FormMessage message={state.message} />
    </form>
  );
}
