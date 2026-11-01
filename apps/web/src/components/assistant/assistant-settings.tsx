"use client";
import { useActionState, useState } from "react";
import { Badge, Button, ConfirmSheet, Field, FormMessage, Select } from "@/components/ui";
import { acceptInsights, changeAutonomy, deactivate, type AssistantActionState } from "./actions";
import { AUTONOMY_OPTIONS } from "./copy";

const initial: AssistantActionState = { ok: false, message: null };

/** Aceite que falta para quem autorizou antes das dicas da madrugada. */
function InsightsConsent({ autonomy }: { autonomy: string }) {
  const [state, action, pending] = useActionState(acceptInsights, initial);
  return (
    <form action={action} className="flex flex-col gap-2 rounded-xl border border-line p-3 text-sm">
      <p className="m-0 font-medium">Dicas em cada tela</p>
      <p className="m-0 text-muted">
        Todas as madrugadas o assistente olha os números da família e deixa dicas nas telas.
      </p>
      <input type="hidden" name="autonomy" value={autonomy} />
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-brand-700" />
        <span>
          Autorizo o uso dos dados da família para preparar essas dicas, inclusive fora do Brasil.
        </span>
      </label>
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {pending ? "Ligando…" : "Ligar as dicas"}
      </Button>
    </form>
  );
}

/** Bloco de Configurações: ver o aceite, mudar o nível e desligar. */
export function AssistantSettings({
  active,
  acceptedOn,
  autonomy,
  canManage,
  needsInsightsConsent,
}: {
  active: boolean;
  acceptedOn: string | null;
  autonomy: string;
  canManage: boolean;
  needsInsightsConsent: boolean;
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
      {needsInsightsConsent && canManage ? <InsightsConsent autonomy={autonomy} /> : null}
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
