"use client";
import { CheckCircle2, CircleAlert, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent } from "react";
import { SMART_ACCEPT, SMART_MAX_FILES } from "@organizeup/domain";
import type { ImporterGate } from "@organizeup/ai";
import { Button, Card, FormMessage } from "@/components/ui";
import { acceptImporter, removeImport, startImport } from "./actions";

interface Sent {
  name: string;
  ok: boolean;
  message: string | null;
  otherImportId: string | null;
}

interface Answer {
  ok: boolean;
  importId?: string;
  duplicate?: boolean;
  message?: string;
  /** Este arquivo está num envio aberto: a pessoa pode abrir aquele ou descartar. */
  otherImportId?: string;
}

export function UploadPanel({
  gate,
  used,
  limit,
}: {
  gate: ImporterGate;
  used: number;
  limit: number;
}) {
  const t = useTranslations("importador");
  const router = useRouter();
  const [importId, setImportId] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const [sending, setSending] = useState(false);
  const [useAi, setUseAi] = useState(gate === "pronto");
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const accept = (checked: boolean) => {
    setAccepted(checked);
    if (!checked) return;
    startTransition(async () => {
      const result = await acceptImporter();
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setUseAi(true);
      router.refresh();
    });
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    setMessage(null);
    if (sent.filter((row) => row.ok).length + files.length > SMART_MAX_FILES) {
      setMessage(t("upload.muitos"));
      return;
    }
    setSending(true);
    let current = importId;
    for (const file of files) {
      const form = new FormData();
      form.set("file", file);
      if (current) form.set("importId", current);
      const answer = (await fetch("/api/importador", { method: "POST", body: form })
        .then((response) => response.json())
        .catch(() => ({ ok: false, message: t("upload.failed") }))) as Answer;
      if (answer.importId) {
        current = answer.importId;
        setImportId(answer.importId);
      }
      setSent((rows) => [
        ...rows,
        {
          name: file.name,
          ok: answer.ok,
          message: answer.ok
            ? answer.duplicate
              ? t("upload.repeated")
              : null
            : (answer.message ?? t("upload.failed")),
          otherImportId: answer.otherImportId ?? null,
        },
      ]);
    }
    setSending(false);
  };

  /** Lote abandonado não prende o arquivo: some, e a pessoa escolhe o arquivo de novo. */
  const discard = (id: string) =>
    startTransition(async () => {
      const form = new FormData();
      form.set("id", id);
      await removeImport(form);
      setSent((rows) => rows.filter((row) => row.otherImportId !== id));
      setMessage(t("upload.discarded"));
    });

  const begin = () => {
    if (!importId) return;
    startTransition(async () => {
      const result = await startImport(importId, useAi && gate === "pronto");
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.push(`/app/importar/arquivos/${importId}`);
    });
  };

  const ready = sent.some((row) => row.ok) && !sending;

  return (
    <Card title={t("upload.title")} description={t("upload.text")}>
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-line bg-surface p-3 text-sm">
          <p className="m-0 font-medium">{t("privacy.title")}</p>
          <p className="m-0 mt-1 text-muted">{t("privacy.text")}</p>
          {gate === "pronto" ? (
            <p className="m-0 mt-1 text-muted">{t("privacy.quota", { used, limit })}</p>
          ) : null}
        </div>
        {gate === "precisa_aceitar" ? (
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={accepted}
              disabled={pending}
              onChange={(event) => accept(event.target.checked)}
              className="mt-0.5 size-4 accent-brand-700"
            />
            <span>{t("gate.accept")}</span>
          </label>
        ) : gate === "pronto" ? (
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={useAi}
              onChange={(event) => setUseAi(event.target.checked)}
              className="mt-0.5 size-4 accent-brand-700"
            />
            <span>{t("gate.useAi")}</span>
          </label>
        ) : (
          <p className="m-0 text-sm text-muted">{t(`gate.${gate}`)}</p>
        )}
        <div>
          <label htmlFor="smart-files" className="mb-1 block text-sm font-medium">
            {t("upload.label")}
          </label>
          <input
            id="smart-files"
            type="file"
            multiple
            accept={SMART_ACCEPT}
            disabled={sending || pending}
            onChange={(event) => void choose(event)}
            aria-describedby="smart-files-hint"
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
          />
          <p id="smart-files-hint" className="m-0 mt-1 text-sm text-muted">
            {t("upload.hint", { count: SMART_MAX_FILES })}
          </p>
        </div>
        {sent.length > 0 ? (
          <ul aria-label={t("upload.listLabel")} className="flex flex-col gap-1 text-sm">
            {sent.map((row, index) => (
              <li key={`${row.name}-${index}`} className="flex min-w-0 items-start gap-2">
                {row.ok ? (
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                )}
                <span className="min-w-0 break-words">
                  {row.name}
                  {row.message ? <span className="text-muted"> · {row.message}</span> : null}
                  {row.otherImportId ? (
                    <span className="ml-2 inline-flex gap-2">
                      <Link
                        href={`/app/importar/arquivos/${row.otherImportId}`}
                        className="font-medium text-brand-700 underline"
                      >
                        {t("upload.openOther")}
                      </Link>
                      <button
                        type="button"
                        onClick={() => discard(row.otherImportId!)}
                        className="font-medium text-brand-700 underline"
                      >
                        {t("upload.discardOther")}
                      </button>
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {sending ? (
          <p role="status" className="m-0 text-sm text-muted">
            {t("upload.sending")}
          </p>
        ) : null}
        <FormMessage message={message} />
        <div>
          <Button type="button" onClick={begin} disabled={!ready || pending}>
            <Upload className="size-4" aria-hidden="true" />
            {pending ? t("upload.starting") : t("upload.start")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
