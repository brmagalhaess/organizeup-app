"use client";
import { Download, FileText, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import {
  parseMoney,
  SMART_DESTINATIONS,
  type SmartDestination,
  type SmartField,
  type SmartPayload,
} from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  Input,
  Select,
  StatTile,
} from "@/components/ui";
import { formatDate, toAmountInput } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { useMoney } from "@/i18n/money";
import {
  approveImport,
  nudgeImport,
  reprocessFile,
  saveItem,
  setFileTarget,
  toggleAll,
  toggleItem,
} from "../actions";

export interface ItemView {
  id: string;
  fileId: string;
  destination: SmartDestination;
  status: string;
  selected: boolean;
  duplicate: "novo" | "possivel" | "ja_lancado";
  duplicateReason: string | null;
  otherFile: string | null;
  confidence: "alta" | "media" | "baixa";
  excerpt: string | null;
  payload: SmartPayload;
  failure: string | null;
  saved: boolean;
  flow: { amount: string; in: boolean } | null;
  missing: string[];
  blockedModule: string | null;
}

export interface FileView {
  id: string;
  fileName: string;
  status: string;
  docType: string | null;
  issuer: string | null;
  confidence: "alta" | "media" | "baixa" | null;
  method: "regras" | "modelo" | null;
  failure: string | null;
  truncated: boolean;
  notes: string[];
  fields: SmartField[];
  accountId: string | null;
  cardId: string | null;
}

interface Option {
  id: string;
  name: string;
}

interface CategoryOption extends Option {
  kind: "receita" | "despesa";
}

const POLL_MS = 3_000;

/** Chaves que vêm do banco. O que não tiver texto cai na mensagem genérica de quem chama. */
type LooseTranslate = ((key: string, values?: Record<string, string | number>) => string) & {
  has(key: string): boolean;
};
const loose = (t: unknown) => t as LooseTranslate;

/** Título curto do item, por destino. */
function titleOf(payload: SmartPayload): string {
  switch (payload.destination) {
    case "lancamento":
    case "compra_cartao":
    case "previsao":
      return payload.description ?? "";
    case "operacao":
      return payload.ticker ?? payload.title ?? "";
    case "provento":
      return payload.ticker ?? "";
    case "documento":
      return payload.title ?? "";
    default:
      return payload.name ?? "";
  }
}

const dateOf = (payload: SmartPayload): string | null =>
  "date" in payload ? payload.date : "firstDueDate" in payload ? payload.firstDueDate : null;

function valueOf(payload: SmartPayload): string | null {
  switch (payload.destination) {
    case "divida":
    case "consorcio":
      return payload.balance ?? payload.installmentAmount;
    case "renda":
    case "previsao":
      return payload.amount;
    case "meta":
      return payload.targetAmount;
    default:
      return null;
  }
}

/** O que a edição mostra, por destino. Cada campo vira o `name` que o servidor reconhece. */
const FIELDS: Record<
  SmartDestination,
  Array<
    | "description"
    | "date"
    | "amount"
    | "kind"
    | "installments"
    | "installmentAmount"
    | "rate"
    | "day"
    | "ticker"
    | "quantity"
    | "unitPrice"
    | "fees"
    | "side"
    | "system"
  >
> = {
  lancamento: ["description", "date", "amount", "kind"],
  compra_cartao: ["description", "date", "amount", "installments"],
  operacao: ["ticker", "side", "date", "quantity", "unitPrice", "fees"],
  provento: ["ticker", "date", "amount"],
  divida: ["description", "system", "amount", "rate", "installments", "installmentAmount", "date"],
  consorcio: ["description", "amount", "installments", "installmentAmount", "date"],
  renda: ["description", "amount", "day"],
  previsao: ["description", "amount", "kind", "day"],
  meta: ["description", "amount"],
  documento: ["description"],
};

/** Campos que vão ao servidor como número, sempre `123.45`: lá, vírgula não é número. */
const NUMBERS = new Set(["amount", "installmentAmount", "rate", "quantity", "unitPrice", "fees"]);

/** Casas todas, no separador do idioma: "0.125" aparece "0,125", e nunca vira 125. */
const decimalInput = (value: string, locale: Locale) =>
  locale === "en" ? value : value.replace(".", ",");

const wireValue = (name: string, value: string, locale: Locale) => {
  const text = value.trim();
  return NUMBERS.has(name) && text ? parseMoney(text, locale).toFixed() : text;
};

function initialField(payload: SmartPayload, name: string, locale: Locale): string {
  const money = (value: string | null | undefined) => (value ? toAmountInput(value, locale) : "");
  const decimal = (value: string | null | undefined) => (value ? decimalInput(value, locale) : "");
  switch (name) {
    case "description":
      return titleOf(payload);
    case "date":
      return dateOf(payload) ?? "";
    case "amount":
      if (payload.destination === "provento") return money(payload.gross);
      if (payload.destination === "meta") return money(payload.targetAmount);
      if (payload.destination === "divida" || payload.destination === "consorcio") {
        return money(payload.balance);
      }
      return "amount" in payload ? money(payload.amount) : "";
    case "kind":
      return "kind" in payload ? payload.kind : "despesa";
    case "installments":
      return "installments" in payload ? String(payload.installments ?? "") : "";
    case "installmentAmount":
      return "installmentAmount" in payload ? money(payload.installmentAmount) : "";
    case "rate":
      return "monthlyRate" in payload ? decimal(payload.monthlyRate) : "";
    case "day":
      if ("payDay" in payload) return String(payload.payDay ?? "");
      return "day" in payload ? String(payload.day ?? "") : "";
    case "ticker":
      return "ticker" in payload ? (payload.ticker ?? "") : "";
    case "quantity":
      return "quantity" in payload ? decimal(payload.quantity) : "";
    case "unitPrice":
      return "unitPrice" in payload ? decimal(payload.unitPrice) : "";
    case "fees":
      return "fees" in payload ? decimal(payload.fees) : "";
    case "side":
      return "side" in payload ? (payload.side ?? "") : "";
    case "system":
      return "system" in payload ? (payload.system ?? "") : "";
    default:
      return "";
  }
}

function EditItem({
  item,
  categories,
  onDone,
}: {
  item: ItemView;
  categories: CategoryOption[];
  onDone: () => void;
}) {
  const t = useTranslations("importador");
  const locale = useLocale() as Locale;
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { payload } = item;
  const kind = "kind" in payload && payload.kind === "receita" ? "receita" : "despesa";
  const hasCategory = "categoryId" in payload;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let fields: Record<string, string>;
    try {
      fields = Object.fromEntries(
        FIELDS[item.destination].map((name) => [
          name,
          wireValue(name, String(form.get(name) ?? ""), locale),
        ]),
      );
    } catch {
      setMessage(t("errors.invalid"));
      return;
    }
    const categoryId = String(form.get("categoryId") ?? "") || null;
    startTransition(async () => {
      const result = await saveItem({ id: item.id, fields, categoryId });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      onDone();
    });
  };

  return (
    <form onSubmit={submit} className="mt-2 grid gap-3 rounded-xl bg-surface p-3 sm:grid-cols-2">
      {FIELDS[item.destination].map((name) => (
        <Field key={name} label={t(`field.${name}`)}>
          {name === "kind" ? (
            <Select name={name} defaultValue={initialField(payload, name, locale)}>
              <option value="despesa">{t("field.despesa")}</option>
              <option value="receita">{t("field.receita")}</option>
            </Select>
          ) : name === "side" ? (
            <Select name={name} defaultValue={initialField(payload, name, locale)}>
              <option value="compra">{t("field.compra")}</option>
              <option value="venda">{t("field.venda")}</option>
            </Select>
          ) : name === "system" ? (
            <Select name={name} defaultValue={initialField(payload, name, locale)}>
              <option value="price">{t("field.price")}</option>
              <option value="sac">{t("field.sac")}</option>
              <option value="manual">{t("field.manual")}</option>
            </Select>
          ) : (
            <Input
              name={name}
              type={name === "date" ? "date" : "text"}
              defaultValue={initialField(payload, name, locale)}
            />
          )}
        </Field>
      ))}
      {hasCategory ? (
        <Field label={t("field.category")}>
          <Select
            name="categoryId"
            defaultValue={("categoryId" in payload ? payload.categoryId : null) ?? ""}
          >
            <option value="">
              {"newCategory" in payload && payload.newCategory
                ? t("field.newCategory", { name: payload.newCategory.name })
                : t("field.chooseCategory")}
            </option>
            {categories
              .filter((row) => row.kind === kind)
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </Select>
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" small disabled={pending}>
          {t("item.save")}
        </Button>
        <Button type="button" small variant="secondary" onClick={onDone}>
          {t("item.cancel")}
        </Button>
        <FormMessage message={message} />
      </div>
    </form>
  );
}

function ItemRow({
  item,
  writable,
  categories,
  onToggle,
}: {
  item: ItemView;
  writable: boolean;
  categories: CategoryOption[];
  onToggle: (id: string, selected: boolean) => void;
}) {
  const t = useTranslations("importador");
  const locale = useLocale() as Locale;
  const moneyText = useMoney();
  const [editing, setEditing] = useState(false);
  // A caixa responde na hora; o servidor confirma depois, e a chave do item troca junto.
  const [checked, setChecked] = useState(item.selected);
  const { payload } = item;
  const name = titleOf(payload) || t("item.untitled");
  const date = dateOf(payload);
  const amount = item.flow?.amount ?? valueOf(payload);
  const checkable = writable && !item.saved && !item.blockedModule;

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        {checkable ? (
          <input
            type="checkbox"
            checked={checked}
            aria-label={t("item.select", { name })}
            onChange={(event) => {
              setChecked(event.target.checked);
              onToggle(item.id, event.target.checked);
            }}
            className="mt-1 size-4 shrink-0 accent-brand-700"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="m-0 min-w-0 break-words font-medium">{name}</p>
            {amount ? (
              <p className="m-0 whitespace-nowrap font-medium tabular-nums">
                {item.flow && !item.flow.in ? "−" : ""}
                {moneyText(amount)}
              </p>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
            {date ? <span>{formatDate(date, locale)}</span> : null}
            {item.saved ? (
              <Badge tone="success">{t("item.saved")}</Badge>
            ) : item.duplicate === "ja_lancado" ? (
              <Badge tone="neutral">{t("duplicate.ja_lancado")}</Badge>
            ) : item.duplicate === "possivel" ? (
              <Badge tone="warning">{t("duplicate.possivel")}</Badge>
            ) : (
              <Badge tone="success">{t("duplicate.novo")}</Badge>
            )}
            {item.confidence !== "alta" ? (
              <Badge tone="warning">{t(`confidence.${item.confidence}`)}</Badge>
            ) : null}
            {item.status === "falhou" && item.failure ? (
              <Badge tone="danger">{failureText(t, item.failure)}</Badge>
            ) : null}
          </div>
          {item.otherFile ? (
            <p className="m-0 mt-1 text-sm text-muted">
              {item.duplicateReason === "pagamento_fatura"
                ? t("duplicate.payment", { name: item.otherFile })
                : t("duplicate.inFile", { name: item.otherFile })}
            </p>
          ) : null}
          {item.blockedModule ? (
            <p className="m-0 mt-1 text-sm text-warning">{t("item.moduleOff")}</p>
          ) : null}
          {item.missing.length > 0 && !item.saved && !item.blockedModule ? (
            <p className="m-0 mt-1 text-sm text-warning">
              {t("item.missing", {
                fields: item.missing.map((field) => loose(t)(`field.${field}`)).join(", "),
              })}
            </p>
          ) : null}
          {item.excerpt ? (
            <details className="mt-1 text-sm text-muted">
              <summary className="cursor-pointer">{t("item.source")}</summary>
              <p className="m-0 mt-1 break-words">{item.excerpt}</p>
            </details>
          ) : null}
          {checkable && !editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-1 text-sm font-medium text-brand-700 underline"
            >
              {t("item.edit")}
            </button>
          ) : null}
          {editing ? (
            <EditItem item={item} categories={categories} onDone={() => setEditing(false)} />
          ) : null}
        </div>
      </div>
    </li>
  );
}

function noteText(note: string, translate: unknown): string {
  const t = loose(translate);
  const [mark, code, count] = note.split(":");
  if (mark !== "codigo" || !code || !t.has(`note.${code}`)) return note;
  return t(`note.${code}`, { count: Number(count ?? 0) });
}

function failureText(translate: unknown, failure: string): string {
  const t = loose(translate);
  if (t.has(`failure.${failure}`)) return t(`failure.${failure}`);
  return t.has(`gate.${failure}`) ? t(`gate.${failure}`) : t("failure.erro_interno");
}

function FileBlock({
  file,
  items,
  accounts,
  cards,
  categories,
  writable,
  groupTotals,
  onToggle,
}: {
  file: FileView;
  items: ItemView[];
  accounts: Option[];
  cards: Option[];
  categories: CategoryOption[];
  writable: boolean;
  groupTotals: Record<string, number>;
  onToggle: (id: string, selected: boolean) => void;
}) {
  const t = useTranslations("importador");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const needsAccount = items.some((item) =>
    ["lancamento", "divida", "consorcio", "renda", "previsao"].includes(item.destination),
  );
  const needsCard = items.some((item) => item.destination === "compra_cartao");
  const groups = SMART_DESTINATIONS.flatMap((destination) => {
    const rows = items.filter((item) => item.destination === destination);
    return rows.length > 0 ? [{ destination, rows }] : [];
  });

  const target = (change: { accountId?: string; cardId?: string }) =>
    startTransition(async () => {
      const result = await setFileTarget({
        fileId: file.id,
        accountId: change.accountId ?? file.accountId ?? "",
        cardId: change.cardId ?? file.cardId ?? "",
      });
      setMessage(result.ok ? null : result.message);
    });

  const retry = () =>
    startTransition(async () => {
      const result = await reprocessFile(file.id);
      setMessage(result.ok ? null : result.message);
    });

  const title = loose(t)(file.docType ? `docType.${file.docType}` : `fileStatus.${file.status}`);

  return (
    <Card>
      <section aria-label={file.fileName} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="m-0 flex flex-wrap items-center gap-2 text-base font-semibold">
              <FileText className="size-4 shrink-0" aria-hidden="true" />
              <span className="break-words">{file.fileName}</span>
            </h2>
            <p className="m-0 mt-1 text-sm text-muted">
              {title}
              {file.issuer ? ` · ${file.issuer}` : ""}
              {file.method ? ` · ${t(`method.${file.method}`)}` : ""}
              {file.confidence && file.confidence !== "alta"
                ? ` · ${t(`confidence.${file.confidence}`)}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/importador/arquivos/${file.id}`}
              className={buttonClass("secondary", true)}
            >
              <Download className="size-4" aria-hidden="true" />
              {t("file.download")}
            </a>
            {writable && file.status === "falhou" ? (
              <Button type="button" small variant="secondary" disabled={pending} onClick={retry}>
                <RefreshCw className="size-4" aria-hidden="true" />
                {t("file.retry")}
              </Button>
            ) : null}
          </div>
        </div>
        {file.status === "falhou" && file.failure ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {failureText(t, file.failure)}
          </p>
        ) : null}
        {file.truncated ? <p className="m-0 text-sm text-warning">{t("file.truncated")}</p> : null}
        {file.notes.length > 0 ? (
          <div className="text-sm">
            <p className="m-0 font-medium">{t("file.notes")}</p>
            <ul className="m-0 list-disc pl-5 text-muted">
              {file.notes.map((note) => (
                <li key={note}>{noteText(note, t)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {file.fields.length > 0 ? (
          <dl className="m-0 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {file.fields.map((field) => (
              <div key={field.label} className="min-w-0">
                <dt className="inline text-muted">{field.label}: </dt>
                <dd className="m-0 inline break-words">{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {writable && (needsAccount || needsCard) ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {needsAccount ? (
              <Field label={t("file.account")}>
                <Select
                  value={file.accountId ?? ""}
                  disabled={pending}
                  onChange={(event) => target({ accountId: event.target.value })}
                >
                  <option value="">{t("file.choose")}</option>
                  {accounts.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {needsCard ? (
              <Field label={t("file.card")}>
                <Select
                  value={file.cardId ?? ""}
                  disabled={pending}
                  onChange={(event) => target({ cardId: event.target.value })}
                >
                  <option value="">{t("file.choose")}</option>
                  {cards.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
        ) : null}
        <FormMessage message={message} />
        {groups.map(({ destination, rows }) => (
          <div key={destination}>
            <h3 className="m-0 text-sm font-semibold">
              {t(`destination.${destination}`)} (
              {groupTotals[`${file.id}:${destination}`] ?? rows.length})
            </h3>
            {(groupTotals[`${file.id}:${destination}`] ?? 0) > rows.length ? (
              <p className="m-0 text-sm text-muted">
                {t("review.hidden", {
                  shown: rows.length,
                  total: groupTotals[`${file.id}:${destination}`] ?? rows.length,
                })}
              </p>
            ) : null}
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {rows.map((item) => (
                <ItemRow
                  key={`${item.id}:${item.selected}`}
                  item={item}
                  writable={writable}
                  categories={categories}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </Card>
  );
}

export function ReviewBoard({
  importId,
  status,
  files,
  items,
  accounts,
  cards,
  categories,
  totals,
  summary,
  groupTotals,
  writable,
}: {
  importId: string;
  status: string;
  files: FileView[];
  items: ItemView[];
  accounts: Option[];
  cards: Option[];
  categories: CategoryOption[];
  totals: { in: string; out: string };
  summary: { novo: number; possivel: number; jaLancado: number; blocked: number; selected: number };
  groupTotals: Record<string, number>;
  writable: boolean;
}) {
  const t = useTranslations("importador");
  const moneyText = useMoney();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const reading = status === "na_fila" || status === "lendo";

  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => {
      void nudgeImport(importId);
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [reading, importId, router]);

  const ready = files.filter((file) => file.status === "lido" || file.status === "falhou").length;

  const report = (result: { ok: boolean; message?: string }) => {
    if (!result.ok) setMessage({ text: result.message ?? "", tone: "error" });
  };
  const toggle = (id: string, value: boolean) =>
    startTransition(async () => report(await toggleItem(id, value)));
  const toggleEverything = (value: boolean) =>
    startTransition(async () => report(await toggleAll(importId, value)));

  const approve = () =>
    startTransition(async () => {
      const result = await approveImport(importId);
      if (result.ok) {
        setMessage({
          tone: result.failed > 0 ? "error" : "ok",
          text: t("review.report", {
            saved: result.saved,
            existed: result.existed,
            failed: result.failed,
          }),
        });
      } else if (result.code === "cota") {
        setMessage({ tone: "error", text: t("review.quota", { count: result.left ?? 0 }) });
      } else {
        setMessage({ tone: "error", text: t(`review.${result.code}`) });
      }
    });

  if (status === "enviando") {
    return <EmptyState title={t("review.notStarted")} text={t("review.notStartedText")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {reading ? (
        <Card>
          <p role="status" className="m-0 font-medium">
            {t("progress.reading", { done: ready, total: files.length })}
          </p>
          <div
            role="progressbar"
            aria-label={t("progress.label")}
            aria-valuemin={0}
            aria-valuemax={files.length}
            aria-valuenow={ready}
            className="mt-2 h-2 overflow-hidden rounded-full bg-surface"
          >
            <div
              className="h-full bg-brand-700 transition-all"
              style={{ width: `${files.length ? (ready / files.length) * 100 : 0}%` }}
            />
          </div>
          <p className="m-0 mt-2 text-sm text-muted">{t("progress.leave")}</p>
        </Card>
      ) : null}
      {!reading ? (
        <dl className="m-0 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile label={t("review.totalNew")} value={String(summary.novo)} />
          <StatTile label={t("review.totalSeen")} value={String(summary.jaLancado)} />
          <StatTile label={t("review.totalMaybe")} value={String(summary.possivel)} />
          <StatTile label={t("review.totalBlocked")} value={String(summary.blocked)} />
          <StatTile label={t("review.totalIn")} value={moneyText(totals.in)} />
          <StatTile label={t("review.totalOut")} value={moneyText(totals.out)} />
        </dl>
      ) : null}
      {files.map((file) => (
        <FileBlock
          key={file.id}
          file={file}
          items={items.filter((item) => item.fileId === file.id)}
          accounts={accounts}
          cards={cards}
          categories={categories}
          writable={writable}
          groupTotals={groupTotals}
          onToggle={toggle}
        />
      ))}
      {!reading && writable ? (
        <Card>
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm text-muted">{t("review.nothingSaved")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={approve} disabled={pending || summary.selected === 0}>
                {t("review.approve", { count: summary.selected })}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => toggleEverything(true)}
              >
                {t("review.selectAll")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => toggleEverything(false)}
              >
                {t("review.selectNone")}
              </Button>
            </div>
            {message ? <FormMessage message={message.text} tone={message.tone} /> : null}
          </div>
        </Card>
      ) : null}
      {!writable ? <p className="text-sm text-muted">{t("noPermission")}</p> : null}
    </div>
  );
}
