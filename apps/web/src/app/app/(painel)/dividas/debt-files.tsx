"use client";
import { Download, FileText, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import { DEBT_FILE_ACCEPT, DEBT_FILE_MAX_BYTES, formatShortDate } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { Badge, EmptyState, FormMessage, IconButton } from "@/components/ui";

export interface DebtFileView {
  id: string;
  debtId: string | null;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  status: "guardado" | "lendo" | "lido" | "falhou" | "confirmado";
  createdAt: string;
}

const STATUS_LABEL: Record<DebtFileView["status"], string> = {
  guardado: "Guardado",
  lendo: "Sendo lido",
  lido: "Lido, falta conferir",
  falhou: "Não deu para ler",
  confirmado: "Conferido",
};

const KILOBYTE = 1024;

export function fileSize(bytes: number) {
  if (bytes < KILOBYTE * KILOBYTE) return `${Math.max(1, Math.round(bytes / KILOBYTE))} KB`;
  return `${(bytes / (KILOBYTE * KILOBYTE)).toFixed(1).replace(".", ",")} MB`;
}

export interface UploadResult {
  ok: boolean;
  id?: string;
  status?: DebtFileView["status"];
  duplicate?: boolean;
  message?: string;
}

/** Envia um arquivo. Quem decide se ele é aceito é o servidor, pelo conteúdo. */
export async function uploadDebtFile(file: File, debtId?: string): Promise<UploadResult> {
  if (file.size > DEBT_FILE_MAX_BYTES) {
    return { ok: false, message: `${file.name}: passa de 10 MB.` };
  }
  const body = new FormData();
  body.set("file", file);
  if (debtId) body.set("debtId", debtId);
  try {
    const response = await fetch("/api/dividas/anexos", { method: "POST", body });
    const result = (await response.json()) as UploadResult;
    return result.ok ? result : { ...result, message: `${file.name}: ${result.message}` };
  } catch {
    return { ok: false, message: `${file.name}: não foi possível enviar. Tente de novo.` };
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
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const attach = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage(null);
    setSending(true);
    const result = await uploadDebtFile(file, debtId);
    setSending(false);
    setInputKey((key) => key + 1);
    if (!result.ok) {
      setMessage(result.message ?? "Não foi possível enviar.");
      return;
    }
    if (result.duplicate) setMessage("Este arquivo já estava guardado.");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      {files.length === 0 ? (
        <EmptyState
          title="Nenhum arquivo nesta dívida"
          text="Anexe contrato, extrato ou renegociação para ter tudo em um lugar só."
        />
      ) : (
        <ul
          aria-label={`Arquivos de ${debtName}`}
          className="m-0 list-none divide-y divide-line p-0"
        >
          {files.map((file) => (
            <li key={file.id} className="flex items-start gap-3 py-3">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="break-words font-medium">{file.fileName}</p>
                <p className="text-xs text-muted">
                  {fileSize(file.sizeBytes)} · enviado em {formatShortDate(file.createdAt)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge tone={file.status === "falhou" ? "warning" : "neutral"}>
                    {STATUS_LABEL[file.status]}
                  </Badge>
                  {writable && file.status !== "confirmado" ? (
                    <Link
                      href={`/app/dividas/importar?arquivo=${file.id}`}
                      className="text-xs font-semibold text-brand-700 underline"
                    >
                      Conferir valores
                    </Link>
                  ) : null}
                </div>
              </div>
              <a
                href={`/api/dividas/anexos/${file.id}`}
                download
                aria-label={`Baixar ${file.fileName}`}
                className={buttonClass("secondary", true)}
              >
                <Download className="size-4" aria-hidden="true" />
              </a>
              {writable ? (
                <IconButton label={`Apagar ${file.fileName}`} onClick={() => onDelete(file)}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {writable ? (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Anexar arquivo
          <input
            key={inputKey}
            type="file"
            accept={DEBT_FILE_ACCEPT}
            disabled={sending}
            onChange={attach}
            className="min-h-11 w-full min-w-0 rounded-xl border border-dashed border-line bg-card p-2 text-sm font-normal text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
          />
          <span className="text-xs font-normal text-muted">
            PDF, PNG, JPG, CSV ou Excel (.xlsx), até 10 MB.
          </span>
        </label>
      ) : null}
      {sending ? (
        <p role="status" className="text-sm text-muted">
          Enviando…
        </p>
      ) : null}
      <FormMessage message={message} />
    </div>
  );
}
