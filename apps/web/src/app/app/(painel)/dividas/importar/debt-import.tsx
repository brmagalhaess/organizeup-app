"use client";
import { CheckCircle2, CircleAlert, FileText, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition, type ChangeEvent } from "react";
import { DEBT_FILE_ACCEPT, type DebtExtraction } from "@organizeup/domain";
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
import { toAmountInput } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { systemTextOf } from "@/i18n/system-text";
import { acceptFiles, confirmDebtImport, deleteDocument, type DebtFormState } from "../actions";
import { DebtFields, type DebtFieldName, type DebtFieldValues } from "../debt-fields";
import { uploadDebtFile, useUploadTexts, type DebtFileView } from "../debt-files";
import { useMoney } from "@/i18n/money";

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
const READ_REASONS = ["muito_grande", "sem_texto", "nao_entendi"] as const;
const GATE_STATES = [
  "sem_chave",
  "desligado",
  "manutencao",
  "teto_mensal",
  "teto_diario",
  "sem_permissao",
] as const;

/** Número do banco para o campo, no jeito que a pessoa digita: 12500,00. */
const toInput = (value: string | null, locale: Locale) =>
  value ? toAmountInput(value, locale) : "";
const rateInput = (value: string | null, locale: Locale) =>
  value === null ? "" : toAmountInput(Number(value).toFixed(2), locale);

function valuesOf(found: DebtExtraction | null, today: string, locale: Locale): DebtFieldValues {
  if (!found) return { firstDueDate: today };
  const hasInstallment = found.installmentAmount.value !== null;
  return {
    system: found.system.value ?? (hasInstallment ? "manual" : "price"),
    balance: toInput(found.balance.value, locale),
    installmentAmount: toInput(found.installmentAmount.value, locale),
    monthlyRate: rateInput(found.monthlyRate.value, locale),
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
  const t = useTranslations("dividas");
  const tReview = useTranslations("dividas.import.review");
  const tCommon = useTranslations("common");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const moneyText = useMoney();
  // Confirmado, o arquivo sai da lista junto com este cartão: o aviso precisa ficar no pai.
  const [state, action, pending] = useActionState(
    async (previous: DebtFormState, form: FormData) => {
      const result = await confirmDebtImport(previous, form);
      if (result.ok) {
        onConfirmed(t("files.withName", { name: item.fileName, problem: result.message ?? "" }));
      }
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
      <Card title={item.fileName} description={tReview(found ? "found" : "manual")}>
        <div className="mb-3 flex flex-wrap items-center gap-2 empty:hidden">
          {doubts > 0 ? (
            <Badge tone="warning">
              <CircleAlert className="size-3" aria-hidden="true" />
              {tReview("doubts", { count: doubts })}
            </Badge>
          ) : null}
          {item.status === "falhou" ? <Badge tone="warning">{tReview("unreadable")}</Badge> : null}
          {canRead && !found ? (
            <Button variant="secondary" small disabled={reading} onClick={onRead}>
              <Sparkles className="size-4" aria-hidden="true" />
              {tReview(reading ? "reading" : "readAi")}
            </Button>
          ) : null}
        </div>
        {found?.moreThanOne ? (
          <p className="mb-3 text-sm font-medium text-warning" role="status">
            {tReview("moreThanOne")}
          </p>
        ) : null}
        {found?.installmentAmount.value || found?.cetAnnual.value ? (
          <p className="mb-3 text-sm text-muted">
            {found.installmentAmount.value
              ? `${tReview("inFile", { value: moneyText(found.installmentAmount.value) })} `
              : ""}
            {found.cetAnnual.value
              ? tReview("cet", { rate: rateInput(found.cetAnnual.value, locale) })
              : ""}
          </p>
        ) : null}
        <form action={action} className="flex max-w-xl flex-col gap-4">
          <input type="hidden" name="documentId" value={item.id} />
          {debts.length > 0 ? (
            <Field
              label={tReview("target")}
              {...(item.matchId ? { hint: tReview("targetHint") } : {})}
            >
              <Select name="target" defaultValue={item.matchId ?? "nova"}>
                <option value="nova">{tReview("createNew")}</option>
                {debts.map((debt) => (
                  <option key={debt.id} value={debt.id}>
                    {tReview("update", { name: debt.name })}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="target" value="nova" />
          )}
          <Field
            label={t("form.name")}
            {...(doubtful?.name ? { hint: t("form.doubt") } : {})}
            error={state.fieldErrors?.name}
          >
            <Input
              name="name"
              required
              maxLength={80}
              placeholder={t("form.loanExample")}
              defaultValue={found?.creditor.value ?? ""}
              className={doubtful?.name ? "border-warning" : undefined}
            />
          </Field>
          <DebtFields
            values={valuesOf(found, today, locale)}
            doubtful={flagged}
            errors={state.fieldErrors}
          />
          <Field label={t("form.payingAccount")} error={state.fieldErrors?.accountId}>
            <Select name="accountId" required>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {system.name(account.name)}
                </option>
              ))}
            </Select>
          </Field>
          <FormMessage message={state.message} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("saving") : tReview("confirm")}
            </Button>
            <Button type="button" variant="secondary" onClick={onDelete}>
              {tReview("deleteFile")}
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
  const t = useTranslations("dividas.import.consent");
  if (gate === "pronto") return <p className="text-sm text-muted">{t("ready")}</p>;
  if (gate === "precisa_aceitar") {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted">{t("needed")}</p>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => onAccept(event.target.checked)}
            className="mt-0.5 size-4 accent-brand-700"
          />
          <span>
            {t.rich("accept", {
              privacy: (chunks) => (
                <Link
                  href="/privacidade"
                  target="_blank"
                  className="font-semibold text-brand-700 underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
      </div>
    );
  }
  const state = GATE_STATES.find((known) => known === gate);
  return (
    <p className="text-sm text-muted">
      {gate === "precisa_ativar" ? t("activate") : state ? t(`states.${state}`) : t("unavailable")}{" "}
      {t("meanwhile")}
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
  const t = useTranslations("dividas.import");
  const tFiles = useTranslations("dividas.files");
  const tDelete = useTranslations("dividas.deleteFile");
  const texts = useUploadTexts();
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
      if (!response.ok) return t("readError.indisponivel");
      const result = (await response.json()) as { status: string; reason?: string };
      if (result.status === "lido" || result.status === "ignorado") return null;
      if (result.status === "bloqueado") return t("readError.blocked");
      if (result.reason === "indisponivel") return t("readError.indisponivel");
      const reason = READ_REASONS.find((known) => known === result.reason);
      return reason ? t(`readError.${reason}`) : t("readError.other");
    } catch {
      return t("readError.indisponivel");
    }
  };

  const readOne = (item: ReviewItem) => {
    setProblems([]);
    setReading(item.id);
    startTransition(async () => {
      const problem = await read(item.id);
      setReading(null);
      if (problem) setProblems([tFiles("withName", { name: item.fileName, problem })]);
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
        setProgress(t("sending", { name: file.name, current: index + 1, total: files.length }));
        const uploaded = await uploadDebtFile(file, texts);
        if (!uploaded.ok || !uploaded.id) {
          found.push(uploaded.message ?? tFiles("sendFailedShort", { name: file.name }));
          continue;
        }
        if (open && (uploaded.status === "guardado" || uploaded.status === "falhou")) {
          setProgress(t("readingFile", { name: file.name }));
          const problem = await read(uploaded.id);
          if (problem) found.push(tFiles("withName", { name: file.name, problem }));
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
      <Card title={t("sendTitle")} description={t("sendText")}>
        <div className="flex max-w-2xl flex-col gap-4">
          <ConsentNotice gate={gate} accepted={accepted} onAccept={setAccepted} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t("filesLabel")}
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
          {accounts.length === 0 ? <p className="text-sm text-muted">{t("noAccount")}</p> : null}
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
            {t("seeDebts")}
          </Link>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            title={t("emptyTitle")}
            text={t("emptyText")}
            action={
              <Link href="/app/dividas" className={buttonClass("secondary")}>
                {t("back")}
              </Link>
            }
          />
        </Card>
      ) : (
        <section aria-label={t("reviewLabel")} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <FileText className="size-4 text-muted" aria-hidden="true" />
            {t("reviewTitle")}
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
        title={tDelete("title")}
        text={tDelete("textOnly", { name: deleting?.fileName ?? "" })}
        confirmLabel={tDelete("confirm")}
        action={deleteDocument}
        hidden={{ id: deleting?.id ?? "" }}
      />
    </>
  );
}
