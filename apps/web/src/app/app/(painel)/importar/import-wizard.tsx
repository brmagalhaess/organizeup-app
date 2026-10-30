"use client";
import { CheckCircle2, CircleAlert, CircleCheck, Copy, FileUp, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition, type ChangeEvent } from "react";
import {
  csvRows,
  decodeStatement,
  detectCsvMapping,
  formatBRL,
  formatShortDate,
  parseCsvTable,
  parseOfx,
  yearMonthOf,
  type CsvMapping,
  type StatementRow,
  type StatementSource,
} from "@organizeup/domain";
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
  Select,
} from "@/components/ui";
import { commitImport, prepareImport, undoImport, type PreparedRow } from "./actions";

const counted = (value: number, one: string, many: string) =>
  `${value} ${value === 1 ? one : many}`;

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;

interface Option {
  id: string;
  name: string;
}
interface CategoryOption extends Option {
  kind: "receita" | "despesa";
}
interface BatchRow {
  id: string;
  accountName: string;
  source: string;
  rowCount: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

interface CsvState {
  table: string[][];
  mapping: CsvMapping;
}

type Choice = { selected: boolean; categoryId: string | null };

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
  return (
    <Field label={label}>
      <Select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {allowEmpty ? <option value={-1}>Não tem</option> : null}
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
  onChange,
  onContinue,
  onCancel,
  busy,
}: {
  csv: CsvState;
  onChange: (mapping: CsvMapping) => void;
  onContinue: (rows: StatementRow[]) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { table, mapping } = csv;
  const headerRow = mapping.header >= 0 ? table[mapping.header] : table[0];
  const columns = (headerRow ?? []).map((cell, index) =>
    mapping.header >= 0 && cell ? cell : `Coluna ${index + 1}`,
  );
  const preview = useMemo(() => csvRows(table, mapping), [table, mapping]);
  const set = (field: keyof CsvMapping) => (value: number) =>
    onChange({ ...mapping, [field]: value });
  const ready = preview.rows.length > 0;

  return (
    <Card
      title="Confira as colunas"
      description="Encontramos estas colunas no arquivo. Ajuste se alguma estiver errada."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ColumnSelect label="Data" value={mapping.date} columns={columns} onChange={set("date")} />
        <ColumnSelect
          label="Descrição"
          value={mapping.description}
          columns={columns}
          allowEmpty
          onChange={set("description")}
        />
        <ColumnSelect
          label="Valor"
          value={mapping.amount}
          columns={columns}
          allowEmpty
          onChange={set("amount")}
        />
        {mapping.amount < 0 ? (
          <>
            <ColumnSelect
              label="Crédito"
              value={mapping.credit}
              columns={columns}
              allowEmpty
              onChange={set("credit")}
            />
            <ColumnSelect
              label="Débito"
              value={mapping.debit}
              columns={columns}
              allowEmpty
              onChange={set("debit")}
            />
          </>
        ) : null}
      </div>

      <p className="mt-4 text-sm text-muted" role="status">
        {counted(preview.rows.length, "lançamento encontrado", "lançamentos encontrados")}
        {preview.skipped > 0
          ? `, ${counted(preview.skipped, "linha ignorada", "linhas ignoradas")}`
          : ""}
        .
      </p>
      {ready ? (
        <ul className="m-0 mt-2 list-none divide-y divide-line p-0 text-sm" aria-label="Amostra">
          {preview.rows.slice(0, 3).map((row, index) => (
            <li key={index} className="flex justify-between gap-3 py-2">
              <span className="min-w-0 truncate">
                {formatShortDate(row.date)} · {row.description}
              </span>
              <span className="whitespace-nowrap font-medium tabular-nums">
                {row.kind === "receita" ? "+ " : "− "}
                {formatBRL(row.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={!ready || busy} onClick={() => onContinue(preview.rows)}>
          {busy ? "Conferindo…" : "Continuar"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Trocar arquivo
        </Button>
      </div>
    </Card>
  );
}

function RowBadge({ row }: { row: PreparedRow }) {
  if (row.state === "previsto")
    return (
      <Badge tone="success">
        <CircleCheck className="size-3" aria-hidden="true" />
        Baixa: {row.match?.description}
      </Badge>
    );
  if (row.state === "lancado")
    return (
      <Badge tone="warning">
        <CircleAlert className="size-3" aria-hidden="true" />
        Parece já lançado
      </Badge>
    );
  if (row.state === "importado")
    return (
      <Badge>
        <Copy className="size-3" aria-hidden="true" />
        Já importado
      </Badge>
    );
  return null;
}

function Review({
  rows,
  categories,
  busy,
  message,
  onSubmit,
  onCancel,
}: {
  rows: PreparedRow[];
  categories: CategoryOption[];
  busy: boolean;
  message: string | null;
  onSubmit: (choices: Record<string, Choice>) => void;
  onCancel: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      rows.map((row) => [
        row.fingerprint,
        {
          selected: row.state === "novo" || row.state === "previsto",
          categoryId: row.categoryId,
        },
      ]),
    ),
  );
  const count = (state: PreparedRow["state"]) => rows.filter((r) => r.state === state).length;
  const selected = rows.filter((row) => choices[row.fingerprint]?.selected).length;
  const update = (fingerprint: string, change: Partial<Choice>) =>
    setChoices((current) => ({
      ...current,
      [fingerprint]: { ...current[fingerprint]!, ...change },
    }));

  return (
    <Card
      title="Revise antes de importar"
      description="Nada foi gravado ainda. Desmarque o que não quiser e ajuste as categorias."
    >
      <dl className="m-0 grid grid-cols-2 gap-3 rounded-xl bg-card-soft p-4 text-sm lg:grid-cols-4">
        {(
          [
            ["Novos", count("novo")],
            ["Dão baixa em previsão", count("previsto")],
            ["Parecem já lançados", count("lancado")],
            ["Já importados", count("importado")],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="m-0 font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <ul aria-label="Lançamentos do extrato" className="m-0 mt-4 list-none p-0">
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
                aria-label={`Importar ${row.description}`}
                checked={choice.selected}
                disabled={locked}
                onChange={(event) => update(row.fingerprint, { selected: event.target.checked })}
                className="mt-0.5 size-5 accent-brand-500 md:mt-0"
              />
              <span className="hidden text-sm tabular-nums text-muted md:block">
                {formatShortDate(row.date)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.description}</p>
                <p className="text-xs tabular-nums text-muted md:hidden">
                  {formatShortDate(row.date)}
                </p>
                <div className="mt-1 empty:hidden">
                  <RowBadge row={row} />
                </div>
              </div>
              <span className="col-start-3 row-start-1 whitespace-nowrap text-right text-sm font-semibold tabular-nums md:col-start-5">
                {row.kind === "receita" ? "+ " : "− "}
                {formatBRL(row.amount)}
              </span>
              <div className="col-span-2 col-start-2 min-w-0 md:col-span-1 md:col-start-4 md:row-start-1">
                {row.state === "previsto" || locked ? null : (
                  <Select
                    aria-label={`Categoria de ${row.description}`}
                    value={choice.categoryId ?? ""}
                    onChange={(event) =>
                      update(row.fingerprint, { categoryId: event.target.value })
                    }
                  >
                    {categories
                      .filter((category) => category.kind === row.kind)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </Select>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={selected === 0 || busy} onClick={() => onSubmit(choices)}>
          {busy
            ? "Importando…"
            : selected === 1
              ? "Importar 1 lançamento"
              : `Importar ${selected} lançamentos`}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      <div className="mt-2">
        <FormMessage message={message} />
      </div>
    </Card>
  );
}

export function ImportWizard({
  accounts,
  categories,
  batches,
}: {
  accounts: Option[];
  categories: CategoryOption[];
  batches: BatchRow[];
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [source, setSource] = useState<StatementSource>("csv");
  const [csv, setCsv] = useState<CsvState | null>(null);
  const [rows, setRows] = useState<PreparedRow[] | null>(null);
  const [done, setDone] = useState<{ imported: number; settled: number } | null>(null);
  const [undoing, setUndoing] = useState<BatchRow | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, startTransition] = useTransition();

  const reset = () => {
    setCsv(null);
    setRows(null);
    setDone(null);
    setMessage(null);
    setFileKey((key) => key + 1);
  };

  const review = (nextSource: StatementSource, parsed: StatementRow[]) => {
    if (parsed.length === 0) {
      setMessage("Não encontramos lançamentos neste arquivo.");
      return;
    }
    if (parsed.length > MAX_ROWS) {
      setMessage("O arquivo tem mais de 2.000 lançamentos. Exporte um período menor.");
      return;
    }
    startTransition(async () => {
      const result = await prepareImport({ accountId, source: nextSource, rows: parsed });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setSource(nextSource);
      setCsv(null);
      setRows(result.rows);
    });
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    setMessage(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setMessage("O arquivo passa de 5 MB. Exporte um período menor.");
      return;
    }
    if (!/\.(ofx|qfx|csv|txt)$/i.test(file.name)) {
      setMessage(
        "Use um arquivo OFX ou CSV. Excel e PDF não são lidos: exporte de novo pelo banco.",
      );
      return;
    }
    const text = decodeStatement(new Uint8Array(await file.arrayBuffer()));
    try {
      if (/\.(ofx|qfx)$/i.test(file.name) || /<OFX/i.test(text)) {
        review("ofx", parseOfx(text).rows);
        return;
      }
      const table = parseCsvTable(text);
      const mapping = detectCsvMapping(table);
      if (!mapping) {
        setMessage("Não reconhecemos as colunas deste CSV. Veja se ele tem data e valor.");
        return;
      }
      setCsv({ table, mapping });
    } catch (error) {
      setMessage(error instanceof RangeError ? error.message : "Não conseguimos ler este arquivo.");
    }
  };

  const submit = (choices: Record<string, Choice>) => {
    if (!rows) return;
    const chosen = rows.flatMap((row) => {
      const choice = choices[row.fingerprint];
      if (!choice?.selected || !choice.categoryId) return [];
      const settles = row.state === "previsto" && row.match;
      return [
        {
          date: row.date,
          description: row.description,
          amount: row.amount,
          kind: row.kind,
          fingerprint: row.fingerprint,
          categoryId: choice.categoryId,
          matchKey: settles ? row.match!.key : null,
          matchMonth: settles ? yearMonthOf(row.match!.date) : null,
        },
      ];
    });
    startTransition(async () => {
      const result = await commitImport({ accountId, source, rows: chosen });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setRows(null);
      setMessage(null);
      setDone({ imported: result.imported, settled: result.settled });
    });
  };

  return (
    <>
      {done ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
            <p className="text-lg font-semibold" role="status">
              Extrato importado
            </p>
            <p className="text-sm text-muted">
              {counted(done.imported, "novo lançamento", "novos lançamentos")} e{" "}
              {counted(done.settled, "previsão baixada", "previsões baixadas")}.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Link href="/app/lancamentos" className={buttonClass()}>
                Ver lançamentos
              </Link>
              <Button variant="secondary" onClick={reset}>
                Importar outro
              </Button>
            </div>
          </div>
        </Card>
      ) : rows ? (
        <Review
          rows={rows}
          categories={categories}
          busy={busy}
          message={message}
          onSubmit={submit}
          onCancel={reset}
        />
      ) : csv ? (
        <CsvMapper
          csv={csv}
          busy={busy}
          onChange={(mapping) => setCsv({ ...csv, mapping })}
          onContinue={(parsed) => review("csv", parsed)}
          onCancel={reset}
        />
      ) : (
        <Card
          title="Escolha o extrato"
          description="Baixe no site ou app do banco, em OFX ou CSV. O arquivo é lido aqui no navegador e não fica guardado."
        >
          <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Conta do extrato">
              <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Arquivo" hint="OFX ou CSV, até 5 MB.">
              <input
                key={fileKey}
                type="file"
                accept=".ofx,.qfx,.csv,.txt"
                disabled={busy || !accountId}
                onChange={onFile}
                className="min-h-11 w-full min-w-0 rounded-xl border border-dashed border-line bg-card p-2 text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
              />
            </Field>
          </div>
          <div className="mt-3">
            <FormMessage message={message} />
            {busy ? (
              <p className="text-sm text-muted" role="status">
                Conferindo com seus lançamentos…
              </p>
            ) : null}
          </div>
        </Card>
      )}

      {message && (csv || done) ? <FormMessage message={message} /> : null}

      <Card
        title="Importações recentes"
        description="Desfazer apaga o que a importação criou e reabre o que ela baixou."
      >
        {batches.length === 0 ? (
          <EmptyState
            title="Nenhuma importação ainda"
            text="Depois da primeira, ela aparece aqui e você pode desfazer."
          />
        ) : (
          <ul aria-label="Importações" className="m-0 list-none divide-y divide-line p-0">
            {batches.map((batch) => (
              <li key={batch.id} className="flex items-center gap-3 py-2.5">
                <FileUp className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">
                    {counted(batch.rowCount, "lançamento", "lançamentos")} · {batch.accountName}
                  </p>
                  <p className="text-xs text-muted">
                    {batch.source.toUpperCase()} · de {formatShortDate(batch.periodStart)} a{" "}
                    {formatShortDate(batch.periodEnd)} · importado em{" "}
                    {formatShortDate(batch.createdAt)}
                  </p>
                </div>
                <IconButton
                  label={`Desfazer importação de ${batch.rowCount} lançamentos`}
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
        title="Desfazer importação"
        text="Os lançamentos desta importação serão apagados, inclusive os que você editou depois. Previsões, parcelas e faturas baixadas voltam a ficar em aberto."
        confirmLabel="Desfazer"
        action={undoImport}
        hidden={{ id: undoing?.id ?? "" }}
      />
    </>
  );
}
