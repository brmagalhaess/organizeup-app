"use client";
import { Download, FileText, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import { DEBT_FILE_ACCEPT, DEBT_FILE_MAX_BYTES } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { Badge, EmptyState, FormMessage, IconButton } from "@/components/ui";
import { formatDayMonth, toAmountInput } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";

export interface DebtFileView {
  id: string;
  debtId: string | null;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  status: "guardado" | "lendo" | "lido" | "falhou" | "confirmado";
  createdAt: string;
}

const KILOBYTE = 1024;

export function fileSize(bytes: number, locale: Locale) {
  if (bytes < KILOBYTE * KILOBYTE) return `${Math.max(1, Math.round(bytes / KILOBYTE))} KB`;
  return `${toAmountInput((bytes / (KILOBYTE * KILOBYTE)).toFixed(1), locale)} MB`;
}

export interface UploadResult {
  ok: boolean;
  id?: string;
  status?: DebtFileView["status"];
  duplicate?: boolean;
  message?: string;
}

/** Textos do envio, prontos no idioma da pessoa: a função roda fora de componente. */
export interface UploadTexts {
  tooLarge: (name: string) => string;
  failed: (name: string) => string;
  withName: (name: string, problem: string) => string;
}

export function useUploadTexts(): UploadTexts {
  const t = useTranslations("dividas.files");
  return {
    tooLarge: (name) => t("tooLarge", { name }),
    failed: (name) => t("sendFailed", { name }),
    withName: (name, problem) => t("withName", { name, problem }),
  };
}

/** Envia um arquivo. Quem decide se ele é aceito é o servidor, pelo conteúdo. */
export async function uploadDebtFile(
  file: File,
  texts: UploadTexts,
  debtId?: string,
): Promise<UploadResult> {
  if (file.size > DEBT_FILE_MAX_BYTES) {
    return { ok: false, message: texts.tooLarge(file.name) };
  }
  const body = new FormData();
  body.set("file", file);
  if (debtId) body.set("debtId", debtId);
  try {
    const response = await fetch("/api/dividas/anexos", { method: "POST", body });
    const result = (await response.json()) as UploadResult;
    return result.ok
      ? result
      : { ...result, message: texts.withName(file.name, result.message ?? "") };
  } catch {
    return { ok: false, message: texts.failed(file.name) };
  }
}

/** Arquivos de uma dívida: ver, baixar, anexar e apagar. Só quem pode escrever anexa e apaga. */
export function DebtFiles({
  debtId,
  debtName,
  files,
  writable,
  onDelete,
}: {
  debtId: string;
  debtName: string;
  files: DebtFileView[];
  writable: boolean;
  onDelete: (file: DebtFileView) => void;
}) {
  const t = useTranslations("dividas.files");
  const tDebt = useTranslations("dividas.card");
  const locale = useLocale();
  const texts = useUploadTexts();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const attach = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage(null);
    setSending(true);
    const result = await uploadDebtFile(file, texts, debtId);
    setSending(false);
    setInputKey((key) => key + 1);
    if (!result.ok) {
      setMessage(result.message ?? t("failed"));
      return;
    }
    if (result.duplicate) setMessage(t("duplicate"));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      {files.length === 0 ? (
        <EmptyState title={t("emptyTitle")} text={t("emptyText")} />
      ) : (
        <ul
          aria-label={tDebt("files", { name: debtName })}
          className="m-0 list-none divide-y divide-line p-0"
        >
          {files.map((file) => (
            <li key={file.id} className="flex items-start gap-3 py-3">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="break-words font-medium">{file.fileName}</p>
                <p className="text-xs text-muted">
                  {t("sentOn", {
                    size: fileSize(file.sizeBytes, locale),
                    date: formatDayMonth(file.createdAt, locale),
                  })}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge tone={file.status === "falhou" ? "warning" : "neutral"}>
                    {t(`status.${file.status}`)}
                  </Badge>
                  {writable && file.status !== "confirmado" ? (
                    <Link
                      href={`/app/dividas/importar?arquivo=${file.id}`}
                      className="text-xs font-semibold text-brand-700 underline"
                    >
                      {t("review")}
                    </Link>
                  ) : null}
                </div>
              </div>
              <a
                href={`/api/dividas/anexos/${file.id}`}
                download
                aria-label={t("download", { name: file.fileName })}
                className={buttonClass("secondary", true)}
              >
                <Download className="size-4" aria-hidden="true" />
              </a>
              {writable ? (
                <IconButton
                  label={t("delete", { name: file.fileName })}
                  onClick={() => onDelete(file)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {writable ? (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t("attach")}
          <input
            key={inputKey}
            type="file"
            accept={DEBT_FILE_ACCEPT}
            disabled={sending}
            onChange={attach}
            className="min-h-11 w-full min-w-0 rounded-xl border border-dashed border-line bg-card p-2 text-sm font-normal text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
          />
          <span className="text-xs font-normal text-muted">{t("types")}</span>
        </label>
      ) : null}
      {sending ? (
        <p role="status" className="text-sm text-muted">
          {t("sending")}
        </p>
      ) : null}
      <FormMessage message={message} />
    </div>
  );
}
