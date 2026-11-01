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
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { percentOf, toDbAmount, money } from "@organizeup/domain";
import { ConfirmEntryButton } from "@/components/confirm-entry-button";
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
import { formatAmount, formatDayMonth, toAmountInput } from "@/i18n/format";
import type { loadDebts } from "@/lib/commitments";
import { systemTextOf } from "@/i18n/system-text";
import { closeDebt, deleteDocument, reopenDebt, saveDebt, type DebtFormState } from "./actions";
import { DebtFields } from "./debt-fields";
import { DebtFiles, type DebtFileView } from "./debt-files";

type Data = Awaited<ReturnType<typeof loadDebts>>;
type DebtView = Data["debts"][number];

const initial: DebtFormState = { ok: false, message: null };

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
  const t = useTranslations("dividas.form");
  const tCommon = useTranslations("common");
  const system = systemTextOf(useTranslations("sistema"));
  const [state, action, pending] = useActionState(saveDebt, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={debt?.id ?? ""} />
      <Field label={t("name")} error={state.fieldErrors?.name}>
        <Input
          name="name"
          required
          maxLength={80}
          placeholder={t("nameExample")}
          defaultValue={debt?.name}
        />
      </Field>
      {debt ? null : <DebtFields values={{ firstDueDate: today }} errors={state.fieldErrors} />}
      <Field label={t("payingAccount")} error={state.fieldErrors?.accountId}>
        <Select name="accountId" required defaultValue={debt?.accountId}>
          {accounts
            .filter((a) => !a.archived || a.id === debt?.accountId)
            .map((account) => (
              <option key={account.id} value={account.id}>
                {system.name(account.name)}
              </option>
            ))}
        </Select>
      </Field>
      {debt ? <p className="rounded-xl bg-brand-50 p-3 text-sm text-muted">{t("locked")}</p> : null}
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("save")}
      </Button>
    </form>
  );
}

function Schedule({ debt, today }: { debt: DebtView; today: string }) {
  const t = useTranslations("dividas.schedule");
  const locale = useLocale();
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{t("caption", { name: debt.name })}</caption>
      <thead>
        <tr className="border-b border-line text-left text-xs text-muted">
          <th scope="col" className="py-2 pr-2 font-medium">
            {t("number")}
          </th>
          <th scope="col" className="px-2 py-2 font-medium">
            {t("due")}
          </th>
          <th scope="col" className="px-2 py-2 text-right font-medium">
            {t("interest")}
          </th>
          <th scope="col" className="py-2 pl-2 text-right font-medium">
            {t("installment")}
          </th>
        </tr>
      </thead>
      <tbody>
        {debt.installments.map((row) => (
          <tr key={row.id} className="border-b border-line last:border-0">
            <td className="py-2 pr-2 tabular-nums text-muted">{row.number}</td>
            <td className="px-2 py-2">
              <span className="tabular-nums">{formatDayMonth(row.dueDate, locale)}</span>
              <span className="text-xs text-muted">/{row.dueDate.slice(0, 4)}</span>{" "}
              {row.paid ? (
                <Badge tone="success">
                  <Check className="size-3" aria-hidden="true" />
                  {t("paid")}
                </Badge>
              ) : row.dueDate < today ? (
                <Badge tone="danger">
                  <AlertCircle className="size-3" aria-hidden="true" />
                  {t("overdue")}
                </Badge>
              ) : null}
            </td>
            <td className="px-2 py-2 text-right tabular-nums text-muted">
              {formatAmount(row.interest, locale)}
            </td>
            <td className="py-2 pl-2 text-right font-medium tabular-nums">
              {formatAmount(row.amount, locale)}
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
  const t = useTranslations("dividas");
  const tCard = useTranslations("dividas.card");
  const locale = useLocale();
  const { name } = debt;
  const rate = money(debt.monthlyRate);
  const rateLabel = rate.isZero()
    ? t("noRate")
    : t("rate", { rate: toAmountInput(rate.toFixed(2), locale) });
  const total = debt.installments.length;
  const overdue = debt.next !== null && debt.next.dueDate < today;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{debt.name}</p>
          <p className="text-xs text-muted">
            {t(`systems.${debt.system}`)} · {rateLabel}
          </p>
        </div>
        <div className="flex shrink-0">
          <IconButton label={tCard("schedule", { name })} onClick={onSchedule}>
            <List className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            label={
              files > 0 ? tCard("filesCount", { name, count: files }) : tCard("files", { name })
            }
            onClick={onFiles}
          >
            <FileText className="size-4" aria-hidden="true" />
          </IconButton>
          {writable ? (
            <>
              <IconButton label={tCard("edit", { name })} onClick={onEdit}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                label={tCard(debt.paidCount > 0 ? "close" : "delete", { name })}
                onClick={onClose}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </>
          ) : null}
        </div>
      </div>
      <div>
        <p className="text-xs text-muted">{tCard("left")}</p>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">
          {formatAmount(debt.balance, locale)}
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
          {tCard("progress", { paid: debt.paidCount, total })}
        </p>
      </div>
      {debt.next ? (
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0 text-sm">
            <p className="font-medium tabular-nums">{formatAmount(debt.next.amount, locale)}</p>
            <p className="flex items-center gap-1 text-xs text-muted">
              {tCard("dueOn", { date: formatDayMonth(debt.next.dueDate, locale) })}
              {overdue ? (
                <span className="font-semibold text-danger">{tCard("overdue")}</span>
              ) : null}
            </p>
          </div>
          {writable ? (
            <ConfirmEntryButton entryKey={`d:${debt.next.id}`} label={tCard("pay")} />
          ) : null}
        </div>
      ) : (
        <div className="mt-auto border-t border-line pt-3">
          <Badge tone="success">
            <Check className="size-3" aria-hidden="true" />
            {tCard("paidOff")}
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
  const t = useTranslations("dividas");
  const locale = useLocale();
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
            title={t("empty.title")}
            text={t("empty.text")}
            action={
              writable ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => open(null)}>{t("empty.action")}</Button>
                  <Link href={importLink} className={buttonClass("secondary")}>
                    {t("card.import")}
                  </Link>
                </div>
              ) : null
            }
          />
        </Card>
      ) : (
        <ul
          aria-label={t("list")}
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
                {t("card.new")}
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
                {t("card.import")}
              </Link>
            </li>
          ) : null}
        </ul>
      )}

      {writable && loose.length > 0 ? (
        <Card
          title={t("waiting.title")}
          description={t("waiting.text")}
          actions={
            <Link href={importLink} className={buttonClass("secondary", true)}>
              {t("waiting.action")}
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
        <Card title={t("closed.title")} description={t("closed.text")}>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {closed.map((debt) => (
              <li key={debt.id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-sm">{debt.name}</span>
                {writable ? (
                  <form action={reopenDebt}>
                    <input type="hidden" name="id" value={debt.id} />
                    <IconButton type="submit" label={t("card.reopen", { name: debt.name })}>
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
        title={t(editing?.debt ? "sheet.edit" : "sheet.new")}
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
        title={viewing?.name ?? t("schedule.fallbackTitle")}
      >
        {viewing ? (
          <>
            <p className="mb-3 text-sm text-muted">
              {t("schedule.openTotal")}{" "}
              <span className="font-semibold text-ink">
                {formatAmount(
                  toDbAmount(
                    viewing.installments
                      .filter((row) => !row.paid)
                      .reduce((acc, row) => acc.plus(row.amount), money(0)),
                  ),
                  locale,
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
        title={filesOf ? t("card.files", { name: filesOf.name }) : t("card.filesTitle")}
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
        title={t("deleteFile.title")}
        text={t("deleteFile.text", { name: deleting?.fileName ?? "" })}
        confirmLabel={t("deleteFile.confirm")}
        action={deleteDocument}
        hidden={{ id: deleting?.id ?? "" }}
      />
      <ConfirmSheet
        open={closing !== null}
        onClose={() => setClosing(null)}
        title={t(hasHistory ? "close.closeTitle" : "close.deleteTitle")}
        text={t(hasHistory ? "close.closeText" : "close.deleteText", {
          name: closing?.name ?? "",
        })}
        confirmLabel={t(hasHistory ? "close.closeConfirm" : "close.deleteConfirm")}
        action={closeDebt}
        hidden={{ id: closing?.id ?? "" }}
      />
    </>
  );
}
