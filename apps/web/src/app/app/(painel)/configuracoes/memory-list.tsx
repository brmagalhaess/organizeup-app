"use client";
import { useState } from "react";
import { Badge, Button, ConfirmSheet, FormMessage } from "@/components/ui";
import { removeAllMemories, removeMemory } from "./actions";

export interface MemoryView {
  id: string;
  kind: string;
  content: string;
  createdOn: string;
  expired: boolean;
}

export function MemoryList({
  memories,
  canDelete,
}: {
  memories: MemoryView[];
  canDelete: boolean;
}) {
  const [target, setTarget] = useState<MemoryView | null>(null);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; message: string | null }>) {
    const result = await action();
    setMessage(result.ok ? null : result.message);
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {memories.map((memory) => (
          <li
            key={memory.id}
            className="flex flex-col gap-2 rounded-xl border border-line p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{memory.kind}</Badge>
              {memory.expired ? <Badge>Vencida</Badge> : null}
              <span className="text-xs text-muted">{memory.createdOn}</span>
            </div>
            <p className="m-0 break-words">{memory.content}</p>
            {canDelete ? (
              <Button
                variant="secondary"
                small
                className="self-start"
                aria-label={`Apagar a anotação: ${memory.content}`}
                onClick={() => setTarget(memory)}
              >
                Apagar
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <FormMessage message={message} />
      {canDelete ? (
        <Button variant="secondary" small className="self-start" onClick={() => setClearing(true)}>
          Apagar tudo
        </Button>
      ) : (
        <p className="m-0 text-sm text-muted">Só adultos da família podem apagar as anotações.</p>
      )}
      <ConfirmSheet
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Apagar esta anotação?"
        text="O assistente deixa de usar essa anotação, e ela não pode ser recuperada."
        confirmLabel="Apagar"
        hidden={{ id: target?.id ?? "" }}
        action={(form) => run(() => removeMemory(String(form.get("id") ?? "")))}
      />
      <ConfirmSheet
        open={clearing}
        onClose={() => setClearing(false)}
        title="Apagar todas as anotações?"
        text="O assistente esquece tudo o que foi anotado sobre a família. Isso não pode ser desfeito."
        confirmLabel="Apagar tudo"
        hidden={{}}
        action={() => run(removeAllMemories)}
      />
    </div>
  );
}
