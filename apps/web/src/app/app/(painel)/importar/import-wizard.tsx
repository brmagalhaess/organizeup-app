"use client";
import {
  Brain,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  Copy,
  FileUp,
  Landmark,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState, useTransition, type ChangeEvent } from "react";
import {
  csvRows,
  decodeStatement,
  detectCsvMapping,
  isForeign,
  merchantKey,
  parseCsvTable,
  parseOfx,
  parsePdfLines,
  yearMonthOf,
  type CsvMapping,
  type Currency,
  type StatementRow,
  type StatementSource,
} from "@organizeup/domain";
import { amountClass, buttonClass, cx } from "@/components/styles";
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
} from "@/components/ui";
import { formatDayMonth } from "@/i18n/format";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { readPdfLines, readSpreadsheet } from "@/lib/statement-files";
import { systemTextOf } from "@/i18n/system-text";
import {
  commitImport,
  prepareImport,
  undoImport,
  type ImportRoom,
  type PreparedRow,
} from "./actions";
import { useFamilyCurrency, useMoney } from "@/i18n/money";
import { confirmBankSync, fetchBankStatement } from "../contas/conexoes/actions";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;

interface Option {
  id: string;
  name: string;
}
interface AccountOption extends Option {
  currency: Currency;
}
interface CategoryOption extends Option {
  kind: "receita" | "despesa";
}
/** Conta do banco ligada a uma conta daqui (ADR-0038). */
export interface BankFeedOption {
  id: string;
  name: string;
  accountId: string;
  syncedOn: string | null;
}
interface BatchRow {
  id: string;
  accountName: string;
  source: string;
  rowCount: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  summary: string | null;
  /** Falso: relatório de antes das chaves, em português. */
  summaryTranslated: boolean;
}

interface CsvState {
  table: string[][];
  mapping: CsvMapping;
}

type Choice = {
  selected: boolean;
  categoryId: string | null;
  /** Nome da categoria que será criada ao importar. */
  newCategory: string | null;
  essential: boolean;
  /** A família está digitando o nome. */
  typing: boolean;
};

const ANOTHER = "__outra";
const newValue = (name: string) => `new:${name}`;
const choiceValue = (choice: Choice) =>
  choice.typing ? ANOTHER : (choice.categoryId ?? newValue(choice.newCategory ?? ""));

function ColumnSelect({
  label,
  value,
  columns,
  allowEmpty,
  onChange,
}: {
  label: string;
  value: number;
  columns: string[];
  allowEmpty?: boolean;
  onChange: (value: number) => void;
}) {
  const t = useTranslations("importar.csv");
  return (
    <Field label={label}>
      <Select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {allowEmpty ? <option value={-1}>{t("none")}</option> : null}
        {columns.map((column, index) => (
          <option key={index} value={index}>
            {column}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function CsvMapper({
  csv,
  currency,
  onChange,
  onContinue,
  onCancel,
  busy,
}: {
  csv: CsvState;
  currency: Currency;
  onChange: (mapping: CsvMapping) => void;
  onContinue: (rows: StatementRow[]) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const t = useTranslations("importar.csv");
  const locale = useLocale();
  const moneyText = useMoney();
  const { table, mapping } = csv;
  const headerRow = mapping.header >= 0 ? table[mapping.header] : table[0];
  const columns = (headerRow ?? []).map((cell, index) =>
    mapping.header >= 0 && cell ? cell : t("column", { number: index + 1 }),
  );
  const preview = useMemo(() => csvRows(table, mapping), [table, mapping]);
  const set = (field: keyof CsvMapping) => (value: number) =>
    onChange({ ...mapping, [field]: value });
  const ready = preview.rows.length > 0;

  return (
    <Card title={t("title")} description={t("text")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ColumnSelect
          label={t("date")}
          value={mapping.date}
          columns={columns}
          onChange={set("date")}
        />
        <ColumnSelect
          label={t("description")}
          value={mapping.description}
          columns={columns}
          allowEmpty
          onChange={set("description")}
        />
        <ColumnSelect
          label={t("amount")}
          value={mapping.amount}
          columns={columns}
          allowEmpty
          onChange={set("amount")}
        />
        {mapping.amount < 0 ? (
          <>
            <ColumnSelect
              label={t("credit")}
              value={mapping.credit}
              columns={columns}
              allowEmpty
              onChange={set("credit")}
            />
            <ColumnSelect
              label={t("debit")}
              value={mapping.debit}
              columns={columns}
              allowEmpty
              onChange={set("debit")}
            />
          </>
        ) : null}
      </div>

      <p className="mt-4 text-sm text-muted" role="status">
        {preview.skipped > 0
          ? t("foundSkipped", { count: preview.rows.length, skipped: preview.skipped })
          : t("found", { count: preview.rows.length })}
      </p>
      {ready ? (
        <ul
          className="m-0 mt-2 list-none divide-y divide-line p-0 text-sm"
          aria-label={t("sample")}
        >
          {preview.rows.slice(0, 3).map((row, index) => (
            <li key={index} className="flex justify-between gap-3 py-2">
              <span className="min-w-0 truncate">
                {formatDayMonth(row.date, locale)} · {row.description}
              </span>
              <span
                className={cx("whitespace-nowrap font-medium tabular-nums", amountClass(row.kind))}
              >
                {row.kind === "receita" ? "+ " : "− "}
                {moneyText(row.amount, "full", currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={!ready || busy} onClick={() => onContinue(preview.rows)}>
          {t(busy ? "checking" : "continue")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("changeFile")}
        </Button>
      </div>
    </Card>
  );
}

function Problem({ message }: { message: string | null }) {
  const t = useTranslations("importar.errors");
  if (!message) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <FormMessage message={message} />
      {message === t("outdated") ? <ReloadButton /> : null}
    </div>
  );
}

function ReloadButton() {
  const t = useTranslations("importar");
  return (
    <Button variant="secondary" small onClick={() => window.location.reload()}>
      {t("reload")}
    </Button>
  );
}

function RowBadge({ row }: { row: PreparedRow }) {
  const t = useTranslations("importar.review.badges");
  if (row.state === "previsto")
    return (
      <Badge tone="success">
        <CircleCheck className="size-3" aria-hidden="true" />
        {t("settle", { name: row.match?.description ?? "" })}
      </Badge>
    );
  if (row.state === "lancado")
    return (
      <Badge tone="warning">
        <CircleAlert className="size-3" aria-hidden="true" />
        {t("entered")}
      </Badge>
    );
  if (row.state === "importado")
    return (
      <Badge>
        <Copy className="size-3" aria-hidden="true" />
        {t("imported")}
      </Badge>
    );
  return null;
}

function AgentBadge({ row }: { row: PreparedRow }) {
  const t = useTranslations("importar.review.badges");
  if (row.state === "importado" || row.state === "previsto") return null;
  if (row.source === "memoria")
    return (
      <Badge>
        <Brain className="size-3" aria-hidden="true" />
        {t("memory")}
      </Badge>
    );
  if (row.source === "nova")
    return (
      <Badge tone="success">
        <Sparkles className="size-3" aria-hidden="true" />
        {t("newCategory")}
      </Badge>
    );
  if (row.source === "revisar")
    return (
      <Badge tone="warning">
        <CircleAlert className="size-3" aria-hidden="true" />
        {t("review")}
      </Badge>
    );
  return null;
}

function Review({
  notice,
  rows,
  room,
  currency,
  categories,
  busy,
  message,
  onSubmit,
  onCancel,
}: {
  notice: string | null;
  rows: PreparedRow[];
  room: ImportRoom;
  currency: Currency;
  categories: CategoryOption[];
  busy: boolean;
  message: string | null;
  onSubmit: (choices: Record<string, Choice>) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("importar.review");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  const moneyText = useMoney();
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      rows.map((row) => [
        row.fingerprint,
        {
          selected: row.state === "novo" || row.state === "previsto",
          categoryId: row.categoryId,
          newCategory: row.newCategory?.name ?? null,
          essential: row.newCategory?.essential ?? false,
          typing: false,
        },
      ]),
    ),
  );
  const count = (state: PreparedRow["state"]) => rows.filter((r) => r.state === state).length;
  const selected = rows.filter((row) => choices[row.fingerprint]?.selected).length;
  // Dar baixa em algo previsto não é lançamento novo: só o resto conta para o limite do plano.
  const newRows = rows.filter(
    (row) => choices[row.fingerprint]?.selected && row.state !== "previsto",
  ).length;
  const overRoom = room !== null && newRows > room;
  const update = (fingerprint: string, change: Partial<Choice>) =>
    setChoices((current) => ({
      ...current,
      [fingerprint]: { ...current[fingerprint]!, ...change },
    }));
  /** Trocar a categoria vale para o mesmo estabelecimento nas outras linhas do extrato. */
  const pick = (row: PreparedRow, value: string) => {
    const change: Partial<Choice> =
      value === ANOTHER
        ? { categoryId: null, newCategory: "", essential: false, typing: true }
        : value.startsWith("new:")
          ? {
              categoryId: null,
              newCategory: value.slice(4),
              essential: proposals.find((p) => p.name === value.slice(4))?.essential ?? false,
              typing: false,
            }
          : { categoryId: value, newCategory: null, typing: false };
    const merchant = merchantKey(row.description);
    setChoices((current) => {
      const next = { ...current };
      for (const other of rows) {
        const same =
          other.fingerprint === row.fingerprint ||
          (merchant !== "" &&
            other.kind === row.kind &&
            other.state !== "importado" &&
            merchantKey(other.description) === merchant);
        if (same) next[other.fingerprint] = { ...next[other.fingerprint]!, ...change };
      }
      return next;
    });
  };
  const proposals = [
    ...new Map(
      rows.flatMap((row) =>
        row.newCategory ? [[row.newCategory.name, { ...row.newCategory, kind: row.kind }]] : [],
      ) as Array<[string, { name: string; essential: boolean; kind: string }]>,
    ).values(),
  ];
  const agent = (source: PreparedRow["source"]) =>
    rows.filter((r) => r.source === source && r.state !== "importado").length;
  const categorized = agent("memoria") + agent("palavra") + agent("nova");
  const unnamed = rows.some((row) => {
    const choice = choices[row.fingerprint]!;
    return choice.selected && !choice.categoryId && !choice.newCategory?.trim();
  });

  return (
    <Card title={t("title")} description={t("text")}>
      {notice ? (
        <p className="mb-3 text-sm font-medium text-warning" role="status">
          {notice}
        </p>
      ) : null}
      <dl className="m-0 grid grid-cols-2 gap-3 rounded-xl bg-card-soft p-4 text-sm lg:grid-cols-4">
        {(
          [
            [t("new"), count("novo")],
            [t("settle"), count("previsto")],
            [t("likelyEntered"), count("lancado")],
            [t("imported"), count("importado")],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="m-0 font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 flex items-start gap-2 text-sm text-muted" role="status">
        <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          {proposals.length > 0
            ? t("agentProposed", { count: categorized, proposed: proposals.length })
            : t("agent", { count: categorized })}{" "}
          {agent("revisar") > 0 ? t("noClue", { count: agent("revisar") }) : ""}
        </span>
      </p>

      <ul aria-label={t("rows")} className="m-0 mt-4 list-none p-0">
        {rows.map((row) => {
          const choice = choices[row.fingerprint]!;
          const locked = row.state === "importado";
          return (
            <li
              key={row.fingerprint}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-b border-line py-3 last:border-0 md:grid-cols-[auto_3.5rem_minmax(0,1fr)_13rem_8rem] md:items-center"
            >
              <input
                type="checkbox"
                aria-label={t("importRow", { name: row.description })}
                checked={choice.selected}
                disabled={locked}
                onChange={(event) => update(row.fingerprint, { selected: event.target.checked })}
                className="mt-0.5 size-5 accent-brand-500 md:mt-0"
              />
              <span className="hidden text-sm tabular-nums text-muted md:block">
                {formatDayMonth(row.date, locale)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.description}</p>
                <p className="text-xs tabular-nums text-muted md:hidden">
                  {formatDayMonth(row.date, locale)}
                </p>
                <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
                  <RowBadge row={row} />
                  <AgentBadge row={row} />
                </div>
              </div>
              <span
                className={cx(
                  "col-start-3 row-start-1 whitespace-nowrap text-right text-sm font-semibold tabular-nums md:col-start-5",
                  amountClass(row.kind),
                )}
              >
                {row.kind === "receita" ? "+ " : "− "}
                {moneyText(row.amount, "full", currency)}
              </span>
              <div className="col-span-2 col-start-2 min-w-0 md:col-span-1 md:col-start-4 md:row-start-1">
                {row.state === "previsto" || locked ? null : (
                  <div className="flex flex-col gap-1.5">
                    <Select
                      aria-label={t("categoryOf", { name: row.description })}
                      value={choiceValue(choice)}
                      onChange={(event) => pick(row, event.target.value)}
                    >
                      {categories
                        .filter((category) => category.kind === row.kind)
                        .map((category) => (
                          <option key={category.id} value={category.id}>
                            {system.name(category.name)}
                          </option>
                        ))}
                      {proposals
                        .filter((proposal) => proposal.kind === row.kind)
                        .map((proposal) => (
                          <option key={proposal.name} value={newValue(proposal.name)}>
                            {t("createCategory", { name: system.name(proposal.name) })}
                          </option>
                        ))}
                      <option value={ANOTHER}>{t("anotherCategory")}</option>
                    </Select>
                    {choice.typing ? (
                      <Input
                        aria-label={t("newCategoryOf", { name: row.description })}
                        maxLength={60}
                        placeholder={t("categoryName")}
                        value={choice.newCategory ?? ""}
                        onChange={(event) =>
                          update(row.fingerprint, { newCategory: event.target.value })
                        }
                      />
                    ) : null}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {room !== null ? (
        <p
          role={overRoom ? "alert" : undefined}
          className={`m-0 mt-4 text-sm ${overRoom ? "text-danger" : "text-muted"}`}
        >
          {overRoom ? t("overRoom", { room, count: newRows }) : t("room", { room })}{" "}
          {overRoom ? (
            <a href="/app/assinatura" className="font-semibold underline">
              {t("roomLink")}
            </a>
          ) : null}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          disabled={selected === 0 || busy || unnamed || overRoom}
          onClick={() => onSubmit(choices)}
        >
          {busy ? t("importing") : t("submit", { count: selected })}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
      <div className="mt-2">
        <Problem message={message} />
      </div>
    </Card>
  );
}

export function ImportWizard({
  accounts,
  categories,
  batches,
  bank,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  batches: BatchRow[];
  /** Null: a pessoa não vê a conexão com bancos. Lista vazia: vê, mas ainda não ligou nenhuma conta. */
  bank: BankFeedOption[] | null;
}) {
  const t = useTranslations("importar");
  const tErrors = useTranslations("importar.errors");
  const system = systemTextOf(useTranslations("sistema"));
  const locale = useLocale();
  // Cada publicação troca os endereços internos, e uma página já aberta deixa de alcançar o servidor.
  const outdated = tErrors("outdated");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const main = useFamilyCurrency();
  const currency = accounts.find((account) => account.id === accountId)?.currency ?? main;
  const [message, setMessage] = useState<string | null>(null);
  const [source, setSource] = useState<StatementSource>("csv");
  const [csv, setCsv] = useState<CsvState | null>(null);
  const [rows, setRows] = useState<PreparedRow[] | null>(null);
  const [room, setRoom] = useState<ImportRoom>(null);
  const [done, setDone] = useState<{
    imported: number;
    settled: number;
    summary: string;
  } | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<BatchRow | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [bankLink, setBankLink] = useState(bank?.[0]?.id ?? "");
  const [bankSince, setBankSince] = useState("");
  const [bankMessage, setBankMessage] = useState<string | null>(null);
  // Conferência que veio do banco: depois de gravar, a próxima busca parte deste dia.
  const [feed, setFeed] = useState<{ linkId: string; to: string } | null>(null);
  const [busy, startTransition] = useTransition();

  const reset = () => {
    setFeed(null);
    setBankMessage(null);
    setCsv(null);
    setRows(null);
    setDone(null);
    setMessage(null);
    setNotice(null);
    setReading(null);
    setFileKey((key) => key + 1);
  };

  const review = (nextSource: StatementSource, parsed: StatementRow[], account = accountId) => {
    if (parsed.length === 0) {
      setMessage(tErrors("noRows"));
      return;
    }
    if (parsed.length > MAX_ROWS) {
      setMessage(tErrors("tooManyRows"));
      return;
    }
    startTransition(async () => {
      const result = await prepareImport({
        accountId: account,
        source: nextSource,
        rows: parsed,
      }).catch(() => ({ ok: false as const, message: outdated }));
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setSource(nextSource);
      setCsv(null);
      setRows(result.rows);
      setRoom(result.room);
    });
  };

  // As linhas do banco entram na mesma conferência de um arquivo OFX: o identificador de cada uma evita repetir.
  const onBank = () => {
    setMessage(null);
    setBankMessage(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fetchBankStatement({ linkId: bankLink, from: bankSince || null }).catch(
        () => ({ ok: false as const, message: outdated }),
      );
      if (!result.ok) {
        setBankMessage(result.message);
        return;
      }
      if (result.rows.length === 0) {
        setBankMessage(
          result.pending > 0 ? t("bank.pending", { count: result.pending }) : t("bank.empty"),
        );
        return;
      }
      const notes = [
        result.truncated ? t("bank.truncated") : null,
        result.pending > 0 ? t("bank.pending", { count: result.pending }) : null,
      ].filter(Boolean);
      setNotice(notes.length > 0 ? notes.join(" ") : null);
      setAccountId(result.accountId);
      setFeed({ linkId: result.linkId, to: result.to });
      review("ofx", result.rows, result.accountId);
    });
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    setMessage(null);
    setBankMessage(null);
    setFeed(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setMessage(tErrors("tooLarge"));
      return;
    }
    if (/\.xls$/i.test(file.name)) {
      setMessage(tErrors("oldExcel"));
      return;
    }
    if (!/\.(ofx|qfx|csv|txt|xlsx|pdf)$/i.test(file.name)) {
      setMessage(tErrors("fileType"));
      return;
    }
    setReading(file.name);
    try {
      if (/\.pdf$/i.test(file.name)) {
        const parsed = parsePdfLines(await readPdfLines(file), new Date().getFullYear());
        if (parsed.rows.length === 0) {
          setMessage(tErrors("pdfEmpty"));
          return;
        }
        setNotice(tErrors("pdfNotice"));
        review("csv", parsed.rows);
        return;
      }
      if (/\.xlsx$/i.test(file.name)) {
        const table = await readSpreadsheet(file);
        const mapping = detectCsvMapping(table);
        if (!mapping) {
          setMessage(tErrors("sheetColumns"));
          return;
        }
        setCsv({ table, mapping });
        return;
      }
      const text = decodeStatement(new Uint8Array(await file.arrayBuffer()));
      if (/\.(ofx|qfx)$/i.test(file.name) || /<OFX/i.test(text)) {
        review("ofx", parseOfx(text).rows);
        return;
      }
      const table = parseCsvTable(text);
      const mapping = detectCsvMapping(table);
      if (!mapping) {
        setMessage(tErrors("csvColumns"));
        return;
      }
      setCsv({ table, mapping });
    } catch (error) {
      // O erro do leitor vem pronto, em português.
      if (error instanceof RangeError && /OFX/.test(error.message)) setMessage(tErrors("ofxEmpty"));
      else if (error instanceof RangeError && locale === DEFAULT_LOCALE) setMessage(error.message);
      else setMessage(tErrors("readFailed"));
    } finally {
      setReading(null);
    }
  };

  const submit = (choices: Record<string, Choice>) => {
    if (!rows) return;
    const chosen = rows.flatMap((row) => {
      const choice = choices[row.fingerprint];
      if (!choice?.selected || (!choice.categoryId && !choice.newCategory?.trim())) return [];
      const settles = row.state === "previsto" && row.match;
      return [
        {
          date: row.date,
          description: row.description,
          amount: row.amount,
          kind: row.kind,
          fingerprint: row.fingerprint,
          categoryId: choice.categoryId,
          newCategory:
            !choice.categoryId && choice.newCategory
              ? { name: choice.newCategory.trim(), essential: choice.essential }
              : null,
          source: row.source,
          corrected:
            choice.categoryId !== row.categoryId ||
            (choice.newCategory ?? null) !== (row.newCategory?.name ?? null),
          matchKey: settles ? row.match!.key : null,
          matchMonth: settles ? yearMonthOf(row.match!.date) : null,
        },
      ];
    });
    startTransition(async () => {
      const result = await commitImport({ accountId, source, rows: chosen }).catch(() => ({
        ok: false as const,
        message: outdated,
      }));
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      // Falhar ao anotar o dia não desfaz a importação: a próxima busca só refaz um período maior.
      if (feed) await confirmBankSync(feed.linkId, feed.to).catch(() => undefined);
      setFeed(null);
      setRows(null);
      setMessage(null);
      setNotice(null);
      setDone({ imported: result.imported, settled: result.settled, summary: result.summary });
    });
  };

  return (
    <>
      {done ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
            <p className="text-lg font-semibold" role="status">
              {t("done.title")}
            </p>
            <p className="text-sm text-muted">
              {t("done.counts", { imported: done.imported, settled: done.settled })}
            </p>
            {done.summary ? <p className="max-w-xl text-sm text-muted">{done.summary}</p> : null}
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Link href="/app/lancamentos" className={buttonClass()}>
                {t("done.seeEntries")}
              </Link>
              <Button variant="secondary" onClick={reset}>
                {t("done.another")}
              </Button>
            </div>
          </div>
        </Card>
      ) : rows ? (
        <Review
          notice={notice}
          rows={rows}
          room={room}
          currency={currency}
          categories={categories}
          busy={busy}
          message={message}
          onSubmit={submit}
          onCancel={reset}
        />
      ) : csv ? (
        <CsvMapper
          csv={csv}
          currency={currency}
          busy={busy}
          onChange={(mapping) => setCsv({ ...csv, mapping })}
          onContinue={(parsed) => review("csv", parsed)}
          onCancel={reset}
        />
      ) : (
        <>
          {bank === null ? null : (
            <Card
              title={t("bank.title")}
              description={t(bank.length > 0 ? "bank.text" : "bank.connectText")}
              actions={
                <Link href="/app/contas/conexoes" className={buttonClass("secondary", true)}>
                  {t(bank.length > 0 ? "bank.manage" : "bank.connect")}
                </Link>
              }
            >
              {bank.length > 0 ? (
                <div className="grid max-w-2xl grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
                  <Field label={t("bank.account")}>
                    <Select value={bankLink} onChange={(event) => setBankLink(event.target.value)}>
                      {bank.map((link) => (
                        <option key={link.id} value={link.id}>
                          {link.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("bank.since")}>
                    <Input
                      type="date"
                      value={bankSince}
                      onChange={(event) => setBankSince(event.target.value)}
                    />
                  </Field>
                  <Button onClick={onBank} disabled={busy || reading !== null || !bankLink}>
                    <Landmark className="size-4" aria-hidden="true" />
                    {busy ? t("bank.fetching") : t("bank.fetch")}
                  </Button>
                </div>
              ) : (
                <p className="m-0 text-sm text-muted">{t("bank.linkFirst")}</p>
              )}
              {bankMessage ? (
                <p
                  role="alert"
                  className="m-0 mt-3 flex items-start gap-2 rounded-xl border border-danger bg-card-soft p-3 text-sm font-medium"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                  {bankMessage}
                </p>
              ) : null}
            </Card>
          )}
          <Card title={t("choose.title")} description={t("choose.text")}>
            <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t("choose.account")}>
                <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {system.name(account.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("choose.file")} hint={t("choose.fileHint")}>
                <input
                  key={fileKey}
                  type="file"
                  accept=".ofx,.qfx,.csv,.txt,.xlsx,.xls,.pdf"
                  disabled={busy || reading !== null || !accountId}
                  onChange={onFile}
                  className="min-h-11 w-full min-w-0 rounded-xl border border-dashed border-line bg-card p-2 text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
                />
              </Field>
            </div>
            <div className="mt-3">
              {isForeign(currency, main) ? (
                <p className="m-0 mb-2 text-sm text-muted">{t("choose.foreign", { currency })}</p>
              ) : null}
              {message ? (
                <div
                  role="alert"
                  className="flex flex-col items-start gap-3 rounded-xl border border-danger bg-card-soft p-4 text-sm"
                >
                  <p className="flex items-start gap-2 font-medium">
                    <CircleAlert
                      className="mt-0.5 size-4 shrink-0 text-danger"
                      aria-hidden="true"
                    />
                    {message}
                  </p>
                  {message === outdated ? (
                    <ReloadButton />
                  ) : (
                    <Button variant="secondary" small onClick={reset}>
                      {t("choose.other")}
                    </Button>
                  )}
                </div>
              ) : null}
              {busy || reading ? (
                <p className="text-sm text-muted" role="status">
                  {reading ? t("choose.reading", { name: reading }) : t("choose.checking")}
                </p>
              ) : null}
            </div>
          </Card>
        </>
      )}

      {csv || done ? <Problem message={message} /> : null}

      <Card title={t("batches.title")} description={t("batches.text")}>
        {batches.length === 0 ? (
          <EmptyState title={t("batches.emptyTitle")} text={t("batches.emptyText")} />
        ) : (
          <ul aria-label={t("batches.list")} className="m-0 list-none divide-y divide-line p-0">
            {batches.map((batch) => (
              <li key={batch.id} className="flex items-center gap-3 py-2.5">
                <FileUp className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">
                    {t("batches.row", { count: batch.rowCount, account: batch.accountName })}
                  </p>
                  <p className="text-xs text-muted">
                    {t("batches.detail", {
                      source: batch.source.toUpperCase(),
                      from: formatDayMonth(batch.periodStart, locale),
                      to: formatDayMonth(batch.periodEnd, locale),
                      date: formatDayMonth(batch.createdAt, locale),
                    })}
                  </p>
                  {batch.summary ? (
                    <p
                      lang={batch.summaryTranslated ? undefined : DEFAULT_LOCALE}
                      className="text-xs text-muted"
                    >
                      {batch.summary}
                    </p>
                  ) : null}
                </div>
                <IconButton
                  label={t("batches.undo", { count: batch.rowCount })}
                  onClick={() => setUndoing(batch)}
                >
                  <Undo2 className="size-4" aria-hidden="true" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmSheet
        open={undoing !== null}
        onClose={() => setUndoing(null)}
        title={t("batches.undoTitle")}
        text={t("batches.undoText")}
        confirmLabel={t("batches.undoConfirm")}
        action={undoImport}
        hidden={{ id: undoing?.id ?? "" }}
      />
    </>
  );
}
