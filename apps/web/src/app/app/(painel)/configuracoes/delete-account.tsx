"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/app/app/actions";
import { Button, Field, FormMessage, Input, Sheet } from "@/components/ui";
import { deleteAccount } from "./actions";

const initial: ActionState = { ok: false, message: null };

function DeleteForm({ onCancel }: { onCancel: () => void }) {
  const [state, action, pending] = useActionState(deleteAccount, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Isso não pode ser desfeito. Sua conta é apagada e, se a família for só sua, todos os dados
        dela também. As cópias de segurança são substituídas em até 30 dias.
      </p>
      <Field label="Sua senha" error={state.fieldErrors?.password}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage message={state.message} />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" className="flex-1" disabled={pending}>
          {pending ? "Apagando…" : "Apagar minha conta"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" small onClick={() => setOpen(true)}>
        Apagar conta
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Apagar conta">
        <DeleteForm onCancel={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
