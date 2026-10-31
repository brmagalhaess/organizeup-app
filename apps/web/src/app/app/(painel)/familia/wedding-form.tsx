"use client";
import { useActionState } from "react";
import { updateWedding, type ActionState } from "@/app/app/actions";
import { Button, Card, FormMessage, submitKeeping } from "@/components/ui";
import { WeddingFields, type WeddingValues } from "./person-fields";

const initial: ActionState = { ok: false, message: null };

export function WeddingForm({ values, writable }: { values: WeddingValues; writable: boolean }) {
  const [state, action, pending] = useActionState(updateWedding, initial);
  return (
    <Card
      title="Casamento"
      description="Opcional. Com o dia, entra no calendário como “Aniversário de casamento”."
    >
      <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
        <fieldset disabled={!writable} className="contents">
          <WeddingFields values={values} errors={state.fieldErrors} />
          {writable ? (
            <div>
              <Button type="submit" variant="secondary" small disabled={pending}>
                {pending ? "Salvando…" : "Salvar casamento"}
              </Button>
            </div>
          ) : null}
        </fieldset>
        <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      </form>
    </Card>
  );
}
