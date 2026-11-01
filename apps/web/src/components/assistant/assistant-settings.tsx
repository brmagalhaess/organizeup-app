"use client";
import { useActionState, useState } from "react";
import { Badge, Button, ConfirmSheet, Field, FormMessage, Select } from "@/components/ui";
import { changeAutonomy, deactivate, type AssistantActionState } from "./actions";
import { AUTONOMY_OPTIONS } from "./copy";

const initial: AssistantActionState = { ok: false, message: null };

/** Bloco de Configurações: ver o aceite, mudar o nível e desligar. */
export function AssistantSettings({
  active,
  acceptedOn,
  autonomy,
  canManage,
}: {
  active: boolean;
  acceptedOn: string | null;
  autonomy: string;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(changeAutonomy, initial);
  const [confirming, setConfirming] = useState(false);

  if (!active) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <Badge>Desligado</Badge>
        <p className="m-0 text-muted">
          {canManage
            ? "Para ligar, abra o botão Assistente e leia o que é enviado. Nada sai do sistema antes do seu aceite."
            : "Quem é responsável ou adulto na família pode ligar pelo botão Assistente."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="success">Ligado</Badge>
        {acceptedOn ? <span className="text-muted">Autorizado em {acceptedOn}.</span> : null}
      </div>
      <form action={action} className="flex flex-col gap-3">
        <fieldset disabled={!canManage} className="contents">
          <Field
            label="O que ele pode fazer sozinho"
            hint={AUTONOMY_OPTIONS.find((option) => option.value === autonomy)?.text}
          >
            <Select name="autonomy" defaultValue={autonomy}>
              {AUTONOMY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" disabled={pending || !canManage}>
            {pending ? "Salvando…" : "Salvar nível"}
          </Button>
        </fieldset>
        <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      </form>
      {canManage ? (
        <>
          <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
            Desligar o assistente
          </Button>
          <ConfirmSheet
            open={confirming}
            onClose={() => setConfirming(false)}
            title="Desligar o assistente"
            text="Nada mais é enviado para a Anthropic. Suas conversas continuam guardadas, e quem quiser pode apagá-las. Para voltar, será preciso autorizar de novo."
            confirmLabel="Desligar"
            action={deactivate}
            hidden={{}}
          />
        </>
      ) : null}
    </div>
  );
}
