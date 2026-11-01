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
          Pergunte sobre o dinheiro da família, simule uma decisão e receba os próximos passos para
          metas, viagens e aposentadoria.
        </p>
      </div>
      <Topic title="O que ele usa">
        Sua pergunta e, quando ela precisar, lançamentos, renda, reserva, dívidas, investimentos,
        metas, viagens e calendário. As descrições vão como estão no extrato. De madrugada, ele usa
        os mesmos dados para preparar dicas em cada tela e arrumar as categorias dos lançamentos.
      </Topic>
      <Topic title="O que fica de fora">
        Nomes, e-mails, CPF e senhas. Ele não acessa banco nenhum e não move dinheiro.
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
        <p className="m-0 text-xs text-muted">Dá para mudar quando quiser em Configurações.</p>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-brand-700" />
        <span>
          Autorizo o uso desses dados para gerar as respostas, inclusive fora do Brasil, como
          explica a{" "}
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
