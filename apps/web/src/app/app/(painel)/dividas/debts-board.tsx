"use client";
import {
  AlertCircle,
  ArchiveRestore,
  Check,
  FileText,
  FileUp,
  List,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { formatBRL, formatShortDate, percentOf, toDbAmount, money } from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  Field,
  FormMessage,
  IconButton,
  Input,
  Select,
  Sheet,
} from "@/components/ui";
import type { loadDebts } from "@/lib/commitments";
import { confirmEntry } from "../lancamentos/actions";
import { closeDebt, deleteDocument, reopenDebt, saveDebt, type DebtFormState } from "./actions";
import { DebtFields } from "./debt-fields";
import { DebtFiles, type DebtFileView } from "./debt-files";

type Data = Awaited<ReturnType<typeof loadDebts>>;
type DebtView = Data["debts"][number];

const SYSTEM_LABEL = {
  price: "Parcelas fixas",
  sac: "Parcelas que diminuem",
  manual: "Parcela informada",
} as const;

const initial: DebtFormState = { ok: false, message: null };

function rateLabel(debt: DebtView) {
  const rate = money(debt.monthlyRate);
  if (rate.isZero()) return "Sem juros informados";
  return `${rate.toFixed(2).replace(".", ",")}% ao mês`;
}

function DebtForm({
  debt,
  today,
  accounts,
  onDone,
}: {
  debt: DebtView | null;
  today: string;
  accounts: Data["accounts"];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveDebt, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={debt?.id ?? ""} />
      <Field label="Nome da dívida" error={state.fieldErrors?.name}>
        <Input
          name="name"
          required
          maxLength={80}
          placeholder="Ex.: Financiamento do carro"
          defaultValue={debt?.name}
        />
      </Field>
      {debt ? null : <DebtFields values={{ firstDueDate: today }} errors={state.fieldErrors} />}
      <Field label="Conta que paga as parcelas" error={state.fieldErrors?.accountId}>
        <Select name="accountId" required defaultValue={debt?.accountId}>
          {accounts
            .filter((a) => !a.archived || a.id === debt?.accountId)
            .map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
        </Select>
      </Field>
      {debt ? (
        <p className="rounded-xl bg-brand-50 p-3 text-sm text-muted">
          Valores e parcelas não mudam aqui. Se algo estiver errado, exclua e cadastre de novo.
        </p>
      ) : null}
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando…" : "Salvar dívida"}
      </Button>
    </form>
  );
}

function Schedule({ debt, today }: { debt: DebtView; today: string }) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">Parcelas de {debt.name}</caption>
      <thead>
        <tr className="border-b border-line text-left text-xs text-muted">
          <th scope="col" className="py-2 pr-2 font-medium">
            Nº
          </th>
          <th scope="col" className="px-2 py-2 font-medium">
            Vencimento
          </th>
          <th scope="col" className="px-2 py-2 text-right font-medium">
            Juros
          </th>
          <th scope="col" className="py-2 pl-2 text-right font-medium">
            Parcela
          </th>
        </tr>
      </thead>
      <tbody>
        {debt.installments.map((row) => (
          <tr key={row.id} className="border-b border-line last:border-0">
            <td className="py-2 pr-2 tabular-nums text-muted">{row.number}</td>
            <td className="px-2 py-2">
              <span className="tabular-nums">{formatShortDate(row.dueDate)}</span>
              <span className="text-xs text-muted">/{row.dueDate.slice(0, 4)}</span>{" "}
              {row.paid ? (
                <Badge tone="success">
                  <Check className="size-3" aria-hidden="true" />
                  Paga
                </Badge>
              ) : row.dueDate < today ? (
                <Badge tone="danger">
                  <AlertCircle className="size-3" aria-hidden="true" />
                  Atrasada
                </Badge>
              ) : null}
            </td>
            <td className="px-2 py-2 text-right tabular-nums text-muted">
              {formatBRL(row.interest)}
            </td>
            <td className="py-2 pl-2 text-right font-medium tabular-nums">
              {formatBRL(row.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DebtCard({
  debt,
  today,
  writable,
  files,
  onEdit,
  onSchedule,
  onFiles,
  onClose,
}: {
  debt: DebtView;
  today: string;
  writable: boolean;
  files: number;
  onEdit: () => void;
  onSchedule: () => void;
  onFiles: () => void;
  onClose: () => void;
}) {
  const total = debt.installments.length;
  const overdue = debt.next !== null && debt.next.dueDate < today;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{debt.name}</p>
          <p className="text-xs text-muted">
            {SYSTEM_LABEL[debt.system]} · {rateLabel(debt)}
          </p>
        </div>
        <div className="flex shrink-0">
          <IconButton label={`Ver parcelas de ${debt.name}`} onClick={onSchedule}>
            <List className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            label={`Arquivos de ${debt.name}${files > 0 ? ` (${files})` : ""}`}
            onClick={onFiles}
          >
            <FileText className="size-4" aria-hidden="true" />
          </IconButton>
          {writable ? (
            <>
              <IconButton label={`Editar ${debt.name}`} onClick={onEdit}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                label={`${debt.paidCount > 0 ? "Encerrar" : "Excluir"} ${debt.name}`}
                onClick={onClose}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </>
          ) : null}
        </div>
      </div>
      <div>
        <p className="text-xs text-muted">Falta pagar</p>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">
          {formatBRL(debt.balance)}
        </p>
      </div>
      <div>
        <div aria-hidden="true" className="h-2 rounded-full bg-brand-50">
          <div
            className="h-full rounded-full bg-brand-500"
            style={{ width: `${percentOf(String(debt.paidCount), String(total))}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-muted">
          {debt.paidCount} de {total} parcelas pagas
        </p>
      </div>
      {debt.next ? (
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0 text-sm">
            <p className="font-medium tabular-nums">{formatBRL(debt.next.amount)}</p>
            <p className="flex items-center gap-1 text-xs text-muted">
              Vence em {formatShortDate(debt.next.dueDate)}
              {overdue ? <span className="font-semibold text-danger">· Atrasada</span> : null}
            </p>
          </div>
          {writable ? (
            <form action={confirmEntry}>
              <input type="hidden" name="key" value={`d:${debt.next.id}`} />
              <Button type="submit" variant="secondary" small>
                Pagar
              </Button>
            </form>
          ) : null}
        </div>
      ) : (
        <div className="mt-auto border-t border-line pt-3">
          <Badge tone="success">
            <Check className="size-3" aria-hidden="true" />
            Quitada
          </Badge>
        </div>
      )}
    </li>
  );
}

const importLink = "/app/dividas/importar";

export function DebtsBoard({
  data,
  files,
  writable,
}: {
  data: Data;
  files: DebtFileView[];
  writable: boolean;
}) {
  const [editing, setEditing] = useState<{ nonce: number; debt: DebtView | null } | null>(null);
  const [viewing, setViewing] = useState<DebtView | null>(null);
  const [closing, setClosing] = useState<DebtView | null>(null);
  const [filesOf, setFilesOf] = useState<DebtView | null>(null);
  const [deleting, setDeleting] = useState<DebtFileView | null>(null);
  const filesFor = (id: string) => files.filter((file) => file.debtId === id);
  const loose = files.filter((file) => file.debtId === null);
  const active = data.debts.filter((debt) => !debt.archived);
  const closed = data.debts.filter((debt) => debt.archived);
  const close = () => setEditing(null);
  const open = (debt: DebtView | null) => setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, debt }));
  const hasHistory = (closing?.paidCount ?? 0) > 0;

  return (
    <>
      {active.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma dívida cadastrada"
            text="Cadastre empréstimos e financiamentos. As parcelas entram sozinhas nos vencimentos do mês, e você vê qual pagar primeiro."
            action={
              writable ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => open(null)}>Cadastrar dívida</Button>
                  <Link href={importLink} className={buttonClass("secondary")}>
                    Importar de um arquivo
                  </Link>
                </div>
              ) : null
            }
          />
        </Card>
      ) : (
        <ul
          aria-label="Dívidas"
          className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
        >
          {active.map((debt) => (
            <DebtCard
              key={debt.id}
              debt={debt}
              today={data.today}
              writable={writable}
              files={filesFor(debt.id).length}
              onEdit={() => open(debt)}
              onSchedule={() => setViewing(debt)}
              onFiles={() => setFilesOf(debt)}
              onClose={() => setClosing(debt)}
            />
          ))}
          {writable ? (
            <li>
              <button
                type="button"
                onClick={() => open(null)}
                className="flex h-full min-h-32 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-sm font-semibold text-muted transition hover:bg-brand-50 hover:text-ink"
              >
                <Plus className="size-4" aria-hidden="true" />
                Nova dívida
              </button>
            </li>
          ) : null}
          {writable ? (
            <li>
              <Link
                href={importLink}
                className="flex h-full min-h-32 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-sm font-semibold text-muted transition hover:bg-brand-50 hover:text-ink"
              >
                <FileUp className="size-4" aria-hidden="true" />
                Importar de um arquivo
              </Link>
            </li>
          ) : null}
        </ul>
      )}

      {writable && loose.length > 0 ? (
        <Card
          title="Arquivos esperando conferência"
          description="Ainda não viraram dívida. Confira os valores ou apague o arquivo."
          actions={
            <Link href={importLink} className={buttonClass("secondary", true)}>
              Conferir
            </Link>
          }
        >
          <ul className="m-0 list-none divide-y divide-line p-0">
            {loose.map((file) => (
              <li key={file.id} className="truncate py-2 text-sm">
                {file.fileName}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {closed.length > 0 ? (
        <Card
          title="Encerradas"
          description="Fora do mês. O que foi pago continua nos lançamentos."
        >
          <ul className="m-0 list-none divide-y divide-line p-0">
            {closed.map((debt) => (
              <li key={debt.id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-sm">{debt.name}</span>
                {writable ? (
                  <form action={reopenDebt}>
                    <input type="hidden" name="id" value={debt.id} />
                    <IconButton type="submit" label={`Reabrir ${debt.name}`}>
                      <ArchiveRestore className="size-4" aria-hidden="true" />
                    </IconButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Sheet
        open={editing !== null}
        onClose={close}
        title={editing?.debt ? "Editar dívida" : "Nova dívida"}
      >
        <DebtForm
          key={editing?.nonce}
          debt={editing?.debt ?? null}
          today={data.today}
          accounts={data.accounts}
          onDone={close}
        />
      </Sheet>
      <Sheet
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing?.name ?? "Parcelas"}
      >
        {viewing ? (
          <>
            <p className="mb-3 text-sm text-muted">
              Total das parcelas em aberto:{" "}
              <span className="font-semibold text-ink">
                {formatBRL(
                  toDbAmount(
                    viewing.installments
                      .filter((row) => !row.paid)
                      .reduce((acc, row) => acc.plus(row.amount), money(0)),
                  ),
                )}
              </span>
            </p>
            <Schedule debt={viewing} today={data.today} />
          </>
        ) : null}
      </Sheet>
      <Sheet
        open={filesOf !== null}
        onClose={() => setFilesOf(null)}
        title={filesOf ? `Arquivos de ${filesOf.name}` : "Arquivos"}
      >
        {filesOf ? (
          <DebtFiles
            debtId={filesOf.id}
            debtName={filesOf.name}
            files={filesFor(filesOf.id)}
            writable={writable}
            onDelete={setDeleting}
          />
        ) : null}
      </Sheet>
      <ConfirmSheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Apagar arquivo"
        text={`"${deleting?.fileName ?? ""}" será apagado de vez. A dívida continua como está.`}
        confirmLabel="Apagar"
        action={deleteDocument}
        hidden={{ id: deleting?.id ?? "" }}
      />
      <ConfirmSheet
        open={closing !== null}
        onClose={() => setClosing(null)}
        title={hasHistory ? "Encerrar dívida" : "Excluir dívida"}
        text={
          hasHistory
            ? `"${closing?.name ?? ""}" sai do mês e as parcelas em aberto deixam de aparecer. O que já foi pago continua nos lançamentos.`
            : `"${closing?.name ?? ""}", o calendário de parcelas e os arquivos anexados serão apagados.`
        }
        confirmLabel={hasHistory ? "Encerrar" : "Excluir"}
        action={closeDebt}
        hidden={{ id: closing?.id ?? "" }}
      />
    </>
  );
}
