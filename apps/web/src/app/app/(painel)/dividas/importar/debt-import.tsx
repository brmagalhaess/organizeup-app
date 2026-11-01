"use client";
import { CheckCircle2, CircleAlert, FileText, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition, type ChangeEvent } from "react";
import { DEBT_FILE_ACCEPT, formatBRL, type DebtExtraction } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  FormMessage,
  Input,
  Select,
} from "@/components/ui";
import { STATE_TEXT } from "@/components/assistant/copy";
import { acceptFiles, confirmDebtImport, deleteDocument, type DebtFormState } from "../actions";
import { DebtFields, type DebtFieldName, type DebtFieldValues } from "../debt-fields";
import { uploadDebtFile, type DebtFileView } from "../debt-files";

type DoubtFlags = Record<DebtFieldName | "name", boolean>;

export interface ReviewItem {
  id: string;
  fileName: string;
  status: DebtFileView["status"];
  found: DebtExtraction | null;
  doubtful: DoubtFlags | null;
  matchId: string | null;
}

interface Option {
  id: string;
  name: string;
}

const initial: DebtFormState = { ok: false, message: null };
const OTHER_READ_ERROR = "Não conseguimos ler este arquivo. Preencha os campos à mão.";
const READ_ERRORS: Record<string, string> = {
  muito_grande: "Este arquivo é grande demais para a leitura. Preencha os campos à mão.",
  sem_texto: "Não achamos texto neste arquivo. Preencha os campos à mão.",
  nao_entendi: "A leitura não entendeu este arquivo. Preencha os campos à mão.",
  indisponivel: "A leitura não respondeu agora. O arquivo está guardado: tente de novo.",
};

/** Número do banco para o campo, no jeito que a pessoa digita: 12500,00. */
const toInput = (value: string | null) => value?.replace(".", ",") ?? "";
const rateInput = (value: string | null) =>
  value === null ? "" : Number(value).toFixed(2).replace(".", ",");

function valuesOf(found: DebtExtraction | null, today: string): DebtFieldValues {
  if (!found) return { firstDueDate: today };
  const hasInstallment = found.installmentAmount.value !== null;
  return {
    system: found.system.value ?? (hasInstallment ? "manual" : "price"),
    balance: toInput(found.balance.value),
    installmentAmount: toInput(found.installmentAmount.value),
    monthlyRate: rateInput(found.monthlyRate.value),
    installments: found.installments.value ?? "",
    firstDueDate: found.nextDueDate.value ?? today,
  };
}

function ReviewCard({
  item,
  today,
  accounts,
  debts,
  canRead,
  reading,
  onRead,
  onConfirmed,
  onDelete,
}: {
  item: ReviewItem;
  today: string;
  accounts: Option[];
  debts: Option[];
  canRead: boolean;
  reading: boolean;
  onRead: () => void;
  onConfirmed: (message: string) => void;
  onDelete: () => void;
}) {
  // Confirmado, o arquivo sai da lista junto com este cartão: o aviso precisa ficar no pai.
  const [state, action, pending] = useActionState(
    async (previous: DebtFormState, form: FormData) => {
      const result = await confirmDebtImport(previous, form);
      if (result.ok) onConfirmed(`${item.fileName}: ${result.message}`);
      return result;
    },
    initial,
  );
  const { found, doubtful } = item;
  const flagged = doubtful
    ? new Set(
        (Object.keys(doubtful) as Array<keyof DoubtFlags>).filter(
          (key): key is DebtFieldName => key !== "name" && doubtful[key],
        ),
      )
    : undefined;
  const doubts = doubtful ? Object.values(doubtful).filter(Boolean).length : 0;

  return (
    <li>
      <Card
        title={item.fileName}
        description={
          found
            ? "Nada foi gravado ainda. Confira e ajuste antes de confirmar."
            : "Preencha os campos com os dados do arquivo."
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 empty:hidden">
          {doubts > 0 ? (
            <Badge tone="warning">
              <CircleAlert className="size-3" aria-hidden="true" />
              {doubts === 1 ? "1 campo para conferir" : `${doubts} campos para conferir`}
            </Badge>
          ) : null}
          {item.status === "falhou" ? <Badge tone="warning">Não deu para ler</Badge> : null}
          {canRead && !found ? (
            <Button variant="secondary" small disabled={reading} onClick={onRead}>
              <Sparkles className="size-4" aria-hidden="true" />
              {reading ? "Lendo…" : "Ler com IA"}
            </Button>
          ) : null}
        </div>
        {found?.moreThanOne ? (
          <p className="mb-3 text-sm font-medium text-warning" role="status">
            Este arquivo parece ter mais de uma dívida. Trouxemos a maior; cadastre as outras à mão.
          </p>
        ) : null}
        {found?.installmentAmount.value || found?.cetAnnual.value ? (
          <p className="mb-3 text-sm text-muted">
            {found.installmentAmount.value
              ? `No arquivo, a parcela é de ${formatBRL(found.installmentAmount.value)}. `
              : ""}
            {found.cetAnnual.value
              ? `Custo efetivo total: ${rateInput(found.cetAnnual.value)}% ao ano, só para consulta.`
              : ""}
          </p>
        ) : null}
        <form action={action} className="flex max-w-xl flex-col gap-4">
          <input type="hidden" name="documentId" value={item.id} />
          {debts.length > 0 ? (
            <Field
              label="O que fazer com este arquivo"
              {...(item.matchId
                ? { hint: "Parece ser de uma dívida que já existe. Atualizar não duplica." }
                : {})}
            >
              <Select name="target" defaultValue={item.matchId ?? "nova"}>
                <option value="nova">Criar uma dívida nova</option>
                {debts.map((debt) => (
                  <option key={debt.id} value={debt.id}>
                    Atualizar: {debt.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="target" value="nova" />
          )}
          <Field
            label="Nome da dívida"
            {...(doubtful?.name ? { hint: "Confira este campo." } : {})}
            error={state.fieldErrors?.name}
          >
            <Input
              name="name"
              required
              maxLength={80}
              placeholder="Ex.: Empréstimo pessoal"
              defaultValue={found?.creditor.value ?? ""}
              className={doubtful?.name ? "border-warning" : undefined}
            />
          </Field>
          <DebtFields
            values={valuesOf(found, today)}
            doubtful={flagged}
            errors={state.fieldErrors}
          />
          <Field label="Conta que paga as parcelas" error={state.fieldErrors?.accountId}>
            <Select name="accountId" required>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
          <FormMessage message={state.message} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Confirmar dívida"}
            </Button>
            <Button type="button" variant="secondary" onClick={onDelete}>
              Apagar arquivo
            </Button>
          </div>
        </form>
      </Card>
    </li>
  );
}

function ConsentNotice({
  gate,
  accepted,
  onAccept,
}: {
  gate: string;
  accepted: boolean;
  onAccept: (value: boolean) => void;
}) {
  if (gate === "pronto") {
    return (
      <p className="text-sm text-muted">
        O arquivo é lido por um serviço de inteligência artificial, inclusive fora do Brasil.
      </p>
    );
  }
  if (gate === "precisa_aceitar") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted">
          Para preencher os campos, o arquivo inteiro é lido por um serviço de inteligência
          artificial, inclusive fora do Brasil. Sem o seu aceite, ele fica guardado e nada é
          enviado.
        </p>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => onAccept(event.target.checked)}
            className="mt-0.5 size-4 accent-brand-700"
          />
          <span>
            Autorizo a leitura dos arquivos que eu enviar, como explica a{" "}
            <Link
              href="/privacidade"
              target="_blank"
              className="font-semibold text-brand-700 underline"
            >
              Política de Privacidade
            </Link>
            .
          </span>
        </label>
      </div>
    );
  }
  const state = STATE_TEXT[gate as keyof typeof STATE_TEXT];
  return (
    <p className="text-sm text-muted">
      {gate === "precisa_ativar"
        ? "Para ler os arquivos, ative o assistente no botão Assistente."
        : (state?.text ?? "A leitura automática não está disponível agora.")}{" "}
      Enquanto isso, o arquivo fica guardado, nada é enviado, e você preenche os campos à mão.
    </p>
  );
}

export function DebtImport({
  gate,
  items,
  today,
  accounts,
  debts,
}: {
  gate: string;
  items: ReviewItem[];
  today: string;
  accounts: Option[];
  debts: Option[];
}) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [reading, setReading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ReviewItem | null>(null);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [busy, startTransition] = useTransition();

  const read = async (id: string): Promise<string | null> => {
    try {
      const response = await fetch(`/api/dividas/anexos/${id}/ler`, { method: "POST" });
      if (!response.ok) return READ_ERRORS.indisponivel!;
      const result = (await response.json()) as { status: string; reason?: string };
      if (result.status === "lido" || result.status === "ignorado") return null;
      if (result.status === "bloqueado") return "A leitura não está liberada agora.";
      return READ_ERRORS[result.reason ?? ""] ?? OTHER_READ_ERROR;
    } catch {
      return READ_ERRORS.indisponivel!;
    }
  };

  const readOne = (item: ReviewItem) => {
    setProblems([]);
    setReading(item.id);
    startTransition(async () => {
      const problem = await read(item.id);
      setReading(null);
      if (problem) setProblems([`${item.fileName}: ${problem}`]);
      router.refresh();
    });
  };

  const send = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;
    setProblems([]);
    startTransition(async () => {
      let open = gate === "pronto";
      if (gate === "precisa_aceitar" && accepted) {
        const result = await acceptFiles().catch(() => ({ ok: false, message: null }));
        open = result.ok;
        if (!result.ok && result.message) setProblems([result.message]);
      }
      const found: string[] = [];
      for (const [index, file] of files.entries()) {
        setProgress(`Enviando ${file.name} (${index + 1} de ${files.length})…`);
        const uploaded = await uploadDebtFile(file);
        if (!uploaded.ok || !uploaded.id) {
          found.push(uploaded.message ?? `${file.name}: não foi possível enviar.`);
          continue;
        }
        if (open && (uploaded.status === "guardado" || uploaded.status === "falhou")) {
          setProgress(`Lendo ${file.name}…`);
          const problem = await read(uploaded.id);
          if (problem) found.push(`${file.name}: ${problem}`);
        }
      }
      setProblems((current) => [...current, ...found]);
      setProgress(null);
      setInputKey((key) => key + 1);
      router.refresh();
    });
  };

  return (
    <>
      <Card
        title="Enviar arquivos"
        description="PDF, PNG, JPG, CSV ou Excel (.xlsx), até 10 MB cada. Pode escolher vários."
      >
        <div className="flex max-w-2xl flex-col gap-4">
          <ConsentNotice gate={gate} accepted={accepted} onAccept={setAccepted} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Arquivos das dívidas
            <input
              key={inputKey}
              type="file"
              multiple
              accept={DEBT_FILE_ACCEPT}
              disabled={busy || accounts.length === 0}
              onChange={send}
              className="min-h-11 w-full min-w-0 rounded-xl border border-dashed border-line bg-card p-2 text-sm font-normal text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
            />
          </label>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted">
              Cadastre uma conta antes: a dívida precisa saber de onde saem as parcelas.
            </p>
          ) : null}
          {progress ? (
            <p role="status" className="text-sm text-muted">
              {progress}
            </p>
          ) : null}
          {problems.map((problem) => (
            <FormMessage key={problem} message={problem} />
          ))}
        </div>
      </Card>

      {confirmed.length > 0 ? (
        <Card>
          <ul className="m-0 list-none space-y-2 p-0" role="status">
            {confirmed.map((message) => (
              <li key={message} className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />
                {message}
              </li>
            ))}
          </ul>
          <Link href="/app/dividas" className={`${buttonClass("secondary", true)} mt-3`}>
            Ver minhas dívidas
          </Link>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum arquivo para conferir"
            text="Depois de enviar, os dados de cada arquivo aparecem aqui para você conferir."
            action={
              <Link href="/app/dividas" className={buttonClass("secondary")}>
                Voltar para Dívidas
              </Link>
            }
          />
        </Card>
      ) : (
        <section aria-label="Conferência" className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <FileText className="size-4 text-muted" aria-hidden="true" />
            Confira antes de gravar
          </h2>
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {items.map((item) => (
              <ReviewCard
                key={`${item.id}:${item.status}`}
                item={item}
                today={today}
                accounts={accounts}
                debts={debts}
                canRead={gate === "pronto"}
                reading={reading === item.id}
                onRead={() => readOne(item)}
                onConfirmed={(message) => setConfirmed((current) => [...current, message])}
                onDelete={() => setDeleting(item)}
              />
            ))}
          </ul>
        </section>
      )}

      <ConfirmSheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Apagar arquivo"
        text={`"${deleting?.fileName ?? ""}" será apagado de vez.`}
        confirmLabel="Apagar"
        action={deleteDocument}
        hidden={{ id: deleting?.id ?? "" }}
      />
    </>
  );
}
