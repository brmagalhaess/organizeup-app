"use client";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("settings.memories");
  const tCommon = useTranslations("common");
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
              {memory.expired ? <Badge>{t("expired")}</Badge> : null}
              <span className="text-xs text-muted">{memory.createdOn}</span>
            </div>
            <p className="m-0 break-words">{memory.content}</p>
            {canDelete ? (
              <Button
                variant="secondary"
                small
                className="self-start"
                aria-label={t("deleteLabel", { content: memory.content })}
                onClick={() => setTarget(memory)}
              >
                {tCommon("delete")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <FormMessage message={message} />
      {canDelete ? (
        <Button variant="secondary" small className="self-start" onClick={() => setClearing(true)}>
          {t("clearConfirm")}
        </Button>
      ) : (
        <p className="m-0 text-sm text-muted">{t("readOnly")}</p>
      )}
      <ConfirmSheet
        open={target !== null}
        onClose={() => setTarget(null)}
        title={t("deleteTitle")}
        text={t("deleteText")}
        confirmLabel={tCommon("delete")}
        hidden={{ id: target?.id ?? "" }}
        action={(form) => run(() => removeMemory(String(form.get("id") ?? "")))}
      />
      <ConfirmSheet
        open={clearing}
        onClose={() => setClearing(false)}
        title={t("clearTitle")}
        text={t("clearText")}
        confirmLabel={t("clearConfirm")}
        hidden={{}}
        action={() => run(removeAllMemories)}
      />
    </div>
  );
}
