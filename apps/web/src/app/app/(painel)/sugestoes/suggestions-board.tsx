"use client";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, ConfirmSheet, EmptyState, PageHeader } from "@/components/ui";
import type { loadSuggestions, PendingItem, SuggestionBulk } from "@/lib/suggestions";
import { applyAll, undoSuggestion } from "./actions";
import {
  DecisionButtons,
  SuggestionFeedback,
  useSuggestionActions,
  type SuggestionActions,
} from "./suggestion-controls";

type Data = Awaited<ReturnType<typeof loadSuggestions>>;

function PendingCard({
  item,
  writable,
  actions,
}: {
  item: PendingItem;
  writable: boolean;
  actions: SuggestionActions;
}) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <p className="text-sm font-medium">{item.title}</p>
      <p className="mt-1 text-sm text-muted">{item.body}</p>
      {item.href ? (
        <Link
          href={item.href}
          aria-label={`Abrir: ${item.title}`}
          className="mt-1 inline-block text-sm font-medium underline underline-offset-2"
        >
          Abrir
        </Link>
      ) : null}
      {writable ? (
        <DecisionButtons
          id={item.id}
          title={item.title}
          actions={actions}
          {...(item.kind === "viagem" ? { acceptLabel: "Adicionar às minhas viagens" } : {})}
        />
      ) : null}
    </li>
  );
}

export function SuggestionsBoard({ data, writable }: { data: Data; writable: boolean }) {
  const actions = useSuggestionActions();
  const [bulk, setBulk] = useState<SuggestionBulk | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Assistente"
        title="Sugestões"
        description="O que o assistente notou nas suas finanças. O que for decisão sua espera você aceitar."
      />
      <SuggestionFeedback result={actions.result} />

      <Card title="Para você decidir">
        {data.groups.length === 0 ? (
          <EmptyState
            title="Nada para revisar por enquanto"
            text="O assistente passa por aqui toda madrugada e deixa aqui o que notar."
          />
        ) : (
          <div className="flex flex-col gap-6">
            {data.groups.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{group.title}</h3>
                  {writable && group.bulk ? (
                    <Button
                      variant="secondary"
                      small
                      aria-label={`Aplicar tudo em ${group.title}`}
                      onClick={() => setBulk(group.bulk)}
                    >
                      Aplicar tudo
                    </Button>
                  ) : null}
                </div>
                <ul aria-label={group.title} className="m-0 list-none divide-y divide-line p-0">
                  {group.items.map((item) => (
                    <PendingCard key={item.id} item={item} writable={writable} actions={actions} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card title="O que o assistente fez sozinho" description="Nos últimos 7 dias.">
        {data.automatic.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma alteração nos últimos 7 dias.</p>
        ) : (
          <ul
            aria-label="O que o assistente fez sozinho"
            className="m-0 list-none divide-y divide-line p-0"
          >
            {data.automatic.map((item) => (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-sm text-muted">{item.body}</p>
                {writable ? (
                  <Button
                    variant="secondary"
                    small
                    className="mt-3"
                    disabled={actions.busy !== null}
                    aria-label={`Desfazer: ${item.title}`}
                    onClick={() => actions.run(undoSuggestion, item.id)}
                  >
                    Desfazer
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmSheet
        open={bulk !== null}
        onClose={() => setBulk(null)}
        title="Aplicar tudo"
        text={bulk?.question ?? ""}
        confirmLabel="Aplicar tudo"
        action={(form) => actions.settle(applyAll, form)}
        hidden={{ kind: bulk?.kind ?? "" }}
      />
    </div>
  );
}
