"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Button, FormMessage } from "@/components/ui";
import { activate, type AssistantActionState } from "./actions";
import { AUTONOMY_OPTIONS } from "./copy";

const initial: AssistantActionState = { ok: false, message: null };

function Topic({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">{title}</h3>
      <div className="mt-1 text-sm text-muted">{children}</div>
    </section>
  );
}

/** Primeiro uso. Sem este aceite, o servidor não chama o modelo. */
export function Activation({ headingId }: { headingId: string }) {
  const [state, action, pending] = useActionState(activate, initial);
  return (
    <form action={action} className="flex flex-col gap-5">
      <div>
        <h2 id={headingId} className="m-0 font-display text-xl font-medium">
          Antes de começar
        </h2>
        <p className="mt-1 text-sm text-muted">
          O assistente responde perguntas sobre o dinheiro da família, com os números do próprio
          OrganizeUp. Para isso, parte dos dados precisa sair daqui. Veja o que muda.
        </p>
      </div>
      <Topic title="O que é enviado">
        O que você pergunta e, só quando a pergunta precisa, seus lançamentos, categorias, renda,
        reserva, dívidas, investimentos, proventos, metas, viagens e calendário. Descrições de
        lançamentos vão como estão no extrato.
      </Topic>
      <Topic title="Para quem">
        Para a Anthropic, empresa dos Estados Unidos que opera o modelo de inteligência artificial.
        Por isso, seus dados saem do Brasil. Ela usa esses dados para gerar a resposta, não os usa
        para treinar modelos e os apaga em até 30 dias. O que for marcado como violação das regras
        de uso dela pode ficar guardado por até 2 anos.
      </Topic>
      <Topic title="Por quê">Para responder ao que você pediu, com base nos seus números.</Topic>
      <Topic title="O que não é enviado">
        Nomes, e-mails, CPF e senhas. As pessoas aparecem como titular, cônjuge, filho 1. O
        assistente não acessa banco nenhum e não move dinheiro.
      </Topic>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">O que ele pode fazer sozinho</legend>
        {AUTONOMY_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-card-soft p-3 text-sm"
          >
            <input
              type="radio"
              name="autonomy"
              value={option.value}
              defaultChecked={option.value === "organizar"}
              className="mt-0.5 size-4 accent-brand-700"
            />
            <span className="min-w-0">
              <span className="block font-medium">{option.label}</span>
              <span className="block text-muted">{option.text}</span>
            </span>
          </label>
        ))}
        <p className="m-0 text-xs text-muted">
          Por enquanto ele só lê e simula. Sua escolha passa a valer quando as próximas funções
          chegarem, e dá para mudar em Configurações.
        </p>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-brand-700" />
        <span>
          Li e autorizo o envio desses dados para a Anthropic, como explica a{" "}
          <Link
            href="/privacidade"
            target="_blank"
            className="font-semibold text-brand-700 underline"
          >
            Política de Privacidade
          </Link>
          . Dá para desligar depois em Configurações.
        </span>
      </label>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Ativando…" : "Ativar o assistente"}
      </Button>
    </form>
  );
}
