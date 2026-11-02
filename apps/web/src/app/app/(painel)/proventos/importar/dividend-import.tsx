"use client";
import { CheckCircle2, CircleAlert, Copy, Plus, SearchCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, useTransition, type ChangeEvent } from "react";
import {
  checkDividendFile,
  decodeStatement,
  DIVIDEND_FILE_ACCEPT,
  dividendCsvColumns,
  DividendFileError,
  dividendSelectable,
  dividendSelectedByDefault,
  columnsComplete,
  MARKET_RULES,
  money,
  parseCsvTable,
  parseDividendFile,
  type DividendColumns,
  type IgnoredDividendLine,
  type ParsedDividendFile,
  type PlannedDividend,
} from "@organizeup/domain";
import { buttonClass } from "@/components/styles";
import { Badge, Button, Card, EmptyState, Field, FormMessage, Select } from "@/components/ui";
import { formatDate, formatPercentExact } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { useMoney } from "@/i18n/money";
import { readWorkbook } from "@/lib/statement-files";
import {
  commitDividendImport,
  prepareDividendImport,
  type CommitResult,
  type HoldingOption,
  type PrepareResult,
} from "./actions";

const GUIDES = ["recebidos", "movimentacao", "csv"] as const;
const COLUMN_FIELDS = ["date", "asset", "kind", "value", "gross", "withheld"] as const;
const REQUIRED_FIELDS = new Set<ColumnField>(["date", "asset", "kind", "value"]);

type ColumnField = (typeof COLUMN_FIELDS)[number];
type Prepared = Extract<PrepareResult, { ok: true }>;
type Done = Extract<CommitResult, { ok: true }>;
type Assignments = Record<string, string>;

/** CSV que a leitura automática não entendeu: fica aqui até a pessoa escolher as colunas. */
interface PendingCsv {
  text: string;
  names: string[];
  columns: DividendColumns;
}

const noSubscription = () => () => undefined;

function GuideList() {
  const t = useTranslations("proventos.importar.how");
  return (
    <ul aria-label={t("label")} className="m-0 flex list-none flex-col gap-3 p-0 text-sm">
      {GUIDES.map((guide) => (
        <li key={guide}>
          <p className="font-medium">{t(`${guide}.name`)}</p>
          <p className="text-muted">{t(`${guide}.text`)}</p>
        </li>
      ))}
    </ul>
  );
}

function StateBadge({ row }: { row: PlannedDividend }) {
  const t = useTranslations("proventos.importar.states");
  if (row.state === "novo")
    return (
      <Badge tone="success">
        <Plus className="size-3" aria-hidden="true" />
        {t("novo")}
      </Badge>
    );
  if (row.state === "conferir")
    return (
      <Badge tone="warning">
        <CircleAlert className="size-3" aria-hidden="true" />
        {t("conferir")}
      </Badge>
    );
  if (row.state === "existe")
    return (
      <Badge>
        <Copy className="size-3" aria-hidden="true" />
        {t("existe")}
      </Badge>
    );
  return <Badge>{t("ignorado")}</Badge>;
}

function AmountLine({ row }: { row: PlannedDividend }) {
  const t = useTranslations("proventos.importar.review");
  const moneyText = useMoney();
  const { amounts } = row;
  if (!amounts) {
    return <>{t("netOnly", { net: moneyText((row.net ?? row.gross)!) })}</>;
  }
  if (money(amounts.withheld).isZero()) {
    return <>{t("netOnly", { net: moneyText(amounts.net) })}</>;
  }
  return (
    <>
      {t("amounts", {
        net: moneyText(amounts.net),
        gross: moneyText(amounts.gross),
        withheld: moneyText(amounts.withheld),
      })}
    </>
  );
}

function DividendRow({
  row,
  checked,
  onToggle,
}: {
  row: PlannedDividend;
  checked: boolean;
  onToggle: (value: boolean) => void;
}) {
  const t = useTranslations("proventos.importar");
  const tKinds = useTranslations("proventos.kinds");
  const locale = useLocale() as Locale;
  const moneyText = useMoney();
  const date = formatDate(row.paidOn, locale);
  const title = `${tKinds(row.kind)} · ${row.ticker}`;
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 border-b border-line py-3 last:border-0">
      {dividendSelectable(row) ? (
        <input
          type="checkbox"
          aria-label={t("review.selectRow", { name: title, date })}
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
          className="mt-0.5 size-5 accent-brand-500"
        />
      ) : (
        <span aria-hidden="true" />
      )}
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="font-medium">{title}</p>
          <StateBadge row={row} />
        </div>
        <p className="text-xs tabular-nums text-muted">
          {date} · <AmountLine row={row} />
        </p>
        {row.calculation ? (
          <p className="text-xs text-muted">
            {t(`calculations.${row.calculation}`, {
              rate: row.rate
                ? formatPercentExact(money(row.rate).times(100).toNumber(), locale, 1)
                : "",
            })}
          </p>
        ) : null}
        {row.state === "ignorado" && row.ignoreReason ? (
          <p className="text-xs text-muted">{t(`reasons.${row.ignoreReason}`)}</p>
        ) : null}
        {row.state === "conferir" && row.doubtReason ? (
          <p className="text-xs text-warning">
            {t(`doubts.${row.doubtReason}`, {
              limit: moneyText(MARKET_RULES.dividendMonthlyLimit),
            })}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function IgnoredRow({ line }: { line: IgnoredDividendLine }) {
  const t = useTranslations("proventos.importar");
  const locale = useLocale() as Locale;
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 border-b border-line py-3 last:border-0">
      <span aria-hidden="true" />
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 break-words font-medium">{line.label}</p>
          <Badge>{t("states.ignorado")}</Badge>
        </div>
        <p className="text-xs text-muted">
          {[line.date ? formatDate(line.date, locale) : null, t(`reasons.${line.reason}`)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </li>
  );
}

function MissingAssets({
  tickers,
  options,
  assignments,
  busy,
  onChange,
  onApply,
}: {
  tickers: string[];
  options: HoldingOption[];
  assignments: Assignments;
  busy: boolean;
  onChange: (ticker: string, value: string) => void;
  onApply: () => void;
}) {
  const t = useTranslations("proventos.importar.missing");
  if (tickers.length === 0) return null;
  return (
    <section aria-label={t("title")} className="mt-4 rounded-xl bg-card-soft p-4">
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted">{t("text")}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tickers.map((ticker) => (
          <Field key={ticker} label={t("holdingOf", { ticker })}>
            <Select
              value={assignments[ticker] ?? ""}
              onChange={(event) => onChange(ticker, event.target.value)}
            >
              <option value="">{t("leaveOut")}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <div className="mt-3">
        <Button variant="secondary" small disabled={busy} onClick={onApply}>
          {t("apply")}
        </Button>
      </div>
    </section>
  );
}

function ColumnPicker({
  pending,
  message,
  onPick,
  onUse,
  onCancel,
}: {
  pending: PendingCsv;
  message: string | null;
  onPick: (field: ColumnField, column: number) => void;
  onUse: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("proventos.importar.columns");
  const { columns, names } = pending;
  const ready = columnsComplete(columns);
  return (
    <Card title={t("title")} description={t("text")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {COLUMN_FIELDS.map((field) => (
          <Field
            key={field}
            label={t(`fields.${field}`)}
            hint={REQUIRED_FIELDS.has(field) ? undefined : t("optional")}
          >
            <Select
              value={columns[field]}
              onChange={(event) => onPick(field, Number(event.target.value))}
            >
              <option value={-1}>{t("none")}</option>
              {names.map((name, index) => (
                <option key={`${index}-${name}`} value={index}>
                  {name || t("unnamed", { number: index + 1 })}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={!ready} onClick={onUse}>
          {t("use")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
      <div className="mt-2">
        <FormMessage message={message} />
      </div>
    </Card>
  );
}

function Preview({
  file,
  prepared,
  assignments,
  busy,
  message,
  onAssign,
  onApply,
  onCommit,
  onCancel,
}: {
  file: ParsedDividendFile;
  prepared: Prepared;
  assignments: Assignments;
  busy: boolean;
  message: string | null;
  onAssign: (ticker: string, value: string) => void;
  onApply: () => void;
  onCommit: (selected: number[]) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("proventos.importar");
  const { rows, options } = prepared;
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(rows.filter(dividendSelectedByDefault).map((row) => row.line)),
  );
  const count = (state: PlannedDividend["state"]) =>
    rows.filter((row) => row.state === state).length;
  const ignored = count("ignorado") + file.ignored.length;
  const missing = [
    ...new Set([
      ...rows.flatMap((row) => (row.doubtReason === "sem_ativo" ? [row.ticker] : [])),
      ...Object.keys(assignments),
    ]),
  ];
  const chosen = rows.filter((row) => selected.has(row.line) && dividendSelectable(row));
  const hasAnything = count("novo") + count("conferir") > 0;
  const toggle = (line: number, value: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (value) next.add(line);
      else next.delete(line);
      return next;
    });
  const list = useMemo(
    () =>
      [
        ...rows.map((row) => ({ key: `r${row.line}`, line: row.line, row })),
        ...file.ignored.map((line) => ({ key: `i${line.line}`, line: line.line, ignored: line })),
      ].sort((a, b) => a.line - b.line),
    [rows, file.ignored],
  );
  const tiles: Array<[string, number]> = [
    [t("review.new"), count("novo")],
    [t("review.check"), count("conferir")],
    [t("review.exists"), count("existe")],
    [t("review.ignored"), ignored],
  ];

  return (
    <Card title={t(`review.title.${file.kind}`)} description={t("review.text")}>
      <dl className="m-0 grid grid-cols-2 gap-3 rounded-xl bg-card-soft p-4 text-sm lg:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="m-0 font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {hasAnything ? null : (
        <div className="mt-4">
          <EmptyState title={t("review.nothingTitle")} text={t("review.nothingText")} />
        </div>
      )}

      <MissingAssets
        tickers={missing}
        options={options}
        assignments={assignments}
        busy={busy}
        onChange={onAssign}
        onApply={onApply}
      />

      {list.length > 0 ? (
        <ul aria-label={t("review.rows")} className="m-0 mt-4 list-none p-0">
          {list.map((item) =>
            "row" in item ? (
              <DividendRow
                key={item.key}
                row={item.row}
                checked={selected.has(item.line)}
                onToggle={(value) => toggle(item.line, value)}
              />
            ) : (
              <IgnoredRow key={item.key} line={item.ignored} />
            ),
          )}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          disabled={chosen.length === 0 || busy}
          onClick={() => onCommit(chosen.map((row) => row.line))}
        >
          {busy ? t("review.importing") : t("review.submit", { count: chosen.length })}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("review.cancel")}
        </Button>
      </div>
      <div className="mt-2">
        <FormMessage message={message} />
      </div>
    </Card>
  );
}

export function DividendImport() {
  const t = useTranslations("proventos.importar");
  const tErrors = useTranslations("proventos.importar.errors");
  const outdated = useTranslations("importar.errors")("outdated");
  const [file, setFile] = useState<ParsedDividendFile | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [pending, setPending] = useState<PendingCsv | null>(null);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [message, setMessage] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [version, setVersion] = useState(0);
  const [busy, startTransition] = useTransition();
  // Num celular lento, o arquivo escolhido antes da hidratação se perderia sem aviso.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  const reset = () => {
    setFile(null);
    setPrepared(null);
    setPending(null);
    setAssignments({});
    setMessage(null);
    setDone(null);
    setFileKey((key) => key + 1);
  };

  const prepare = (parsed: ParsedDividendFile, chosen: Assignments) => {
    startTransition(async () => {
      const result = await prepareDividendImport({
        rows: parsed.rows,
        assignments: chosen,
      }).catch(() => ({ ok: false as const, message: outdated }));
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setMessage(null);
      setPending(null);
      setFile(parsed);
      setPrepared(result);
      setVersion((value) => value + 1);
    });
  };

  // O texto do erro nunca aparece nem vai para log: pode trazer trechos do arquivo.
  const problemOf = (error: unknown) =>
    error instanceof DividendFileError ? tErrors(error.code) : tErrors("readFailed");

  const readCsv = (text: string) => {
    try {
      prepare(parseDividendFile({ format: "csv", text }), {});
    } catch (error) {
      if (!(error instanceof DividendFileError) || error.code !== "colunas") throw error;
      const table = parseCsvTable(text);
      const columns = dividendCsvColumns(table);
      // Uma coluna só não dá para mapear: falta o separador, ou nem é uma tabela.
      if (columns.header < 0) throw new DividendFileError("layout");
      setPending({ text, names: table[columns.header]!, columns });
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    setMessage(null);
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setReading(chosen.name);
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      if (checkDividendFile(bytes, chosen.name) === "csv") {
        readCsv(decodeStatement(bytes));
      } else {
        prepare(parseDividendFile({ format: "xlsx", sheets: await readWorkbook(chosen) }), {});
      }
    } catch (error) {
      setMessage(problemOf(error));
    } finally {
      setReading(null);
    }
  };

  const useColumns = () => {
    if (!pending) return;
    try {
      prepare(
        parseDividendFile({ format: "csv", text: pending.text, columns: pending.columns }),
        {},
      );
    } catch (error) {
      setPending(null);
      setMessage(problemOf(error));
    }
  };

  const commit = (selected: number[]) => {
    if (!file) return;
    startTransition(async () => {
      const result = await commitDividendImport({
        rows: file.rows,
        assignments,
        selected,
      }).catch(() => ({ ok: false as const, message: outdated }));
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setFile(null);
      setPrepared(null);
      setMessage(null);
      setDone(result);
    });
  };

  if (done) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
          <p className="text-lg font-semibold" role="status">
            {t("done.title")}
          </p>
          <p className="text-sm text-muted">
            {t("done.counts", { created: done.created, replaced: done.replaced })}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link href="/app/proventos" className={buttonClass()}>
              {t("done.list")}
            </Link>
            <Button variant="secondary" onClick={reset}>
              {t("done.another")}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (pending) {
    return (
      <ColumnPicker
        pending={pending}
        message={message}
        onPick={(field, column) =>
          setPending({ ...pending, columns: { ...pending.columns, [field]: column } })
        }
        onUse={useColumns}
        onCancel={reset}
      />
    );
  }

  if (file && prepared) {
    return (
      <Preview
        key={version}
        file={file}
        prepared={prepared}
        assignments={assignments}
        busy={busy}
        message={message}
        onAssign={(ticker, value) =>
          setAssignments((all) => {
            const next = { ...all };
            if (value) next[ticker] = value;
            else delete next[ticker];
            return next;
          })
        }
        onApply={() => prepare(file, assignments)}
        onCommit={commit}
        onCancel={reset}
      />
    );
  }

  return (
    <>
      <Card title={t("choose.title")} description={t("choose.text")}>
        <div className="max-w-md">
          <Field label={t("choose.file")} hint={t("choose.fileHint")}>
            <input
              key={fileKey}
              type="file"
              accept={DIVIDEND_FILE_ACCEPT}
              disabled={!hydrated || busy || reading !== null}
              onChange={onFile}
              className="min-h-11 w-full min-w-0 rounded-xl border border-dashed border-line bg-card p-2 text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
            />
          </Field>
        </div>
        <div className="mt-3">
          {message ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 rounded-xl border border-danger bg-card-soft p-4 text-sm"
            >
              <p className="flex items-start gap-2 font-medium">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                {message}
              </p>
              <Button variant="secondary" small onClick={reset}>
                {t("choose.other")}
              </Button>
            </div>
          ) : null}
          {reading || busy ? (
            <p className="flex items-center gap-2 text-sm text-muted" role="status">
              <SearchCheck className="size-4" aria-hidden="true" />
              {reading ? t("choose.reading", { name: reading }) : t("choose.checking")}
            </p>
          ) : null}
        </div>
      </Card>
      <Card title={t("how.title")} description={t("how.text")}>
        <GuideList />
      </Card>
    </>
  );
}
