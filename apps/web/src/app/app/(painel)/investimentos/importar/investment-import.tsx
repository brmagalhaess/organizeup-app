"use client";
import { CheckCircle2, CircleAlert, Copy, Landmark, Plus, SearchCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, useTransition, type ChangeEvent } from "react";
import {
  checkInvestmentFile,
  INVESTMENT_FILE_ACCEPT,
  InvestmentFileError,
  parseB3Workbook,
  parseBrokerageNotes,
  selectedByDefault,
  type IgnoredLine,
  type NewAsset,
  type ParsedInvestmentFile,
  type PlannedPosition,
  type PlannedTrade,
  type UnitPricedClass,
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
} from "@/components/ui";
import { formatDate, toInputValue } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { useMoney } from "@/i18n/money";
import { systemTextOf } from "@/i18n/system-text";
import { readPdfLines, readWorkbook } from "@/lib/statement-files";
import { fetchBankPortfolio } from "../../contas/conexoes/actions";
import { quantityText } from "../shared";
import {
  commitInvestmentImport,
  prepareInvestmentImport,
  type CommitResult,
  type PrepareResult,
} from "./actions";

const CLASSES: UnitPricedClass[] = ["acao", "fii", "etf_bdr"];
const GUIDES = ["negociacao", "movimentacao", "posicao", "nota"] as const;

type Prepared = Extract<PrepareResult, { ok: true }>;
type Done = Extract<CommitResult, { ok: true }>;
type Account = { id: string; name: string };

const rowTitle = (row: PlannedTrade) => row.ticker ?? row.title ?? "—";
const noSubscription = () => () => undefined;

function GuideList() {
  const t = useTranslations("investimentos.importar.how");
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

function StateBadge({ row }: { row: PlannedTrade }) {
  const t = useTranslations("investimentos.importar.states");
  if (row.state === "novo")
    return (
      <Badge tone="success">
        <Plus className="size-3" aria-hidden="true" />
        {t("novo")}
      </Badge>
    );
  if (row.state === "taxas")
    return (
      <Badge tone="success">
        <Plus className="size-3" aria-hidden="true" />
        {t("taxas")}
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

function TradeRow({
  row,
  checked,
  onToggle,
}: {
  row: PlannedTrade;
  checked: boolean;
  onToggle: (value: boolean) => void;
}) {
  const t = useTranslations("investimentos.importar");
  const locale = useLocale() as Locale;
  const moneyText = useMoney();
  const selectable = row.state === "novo" || row.state === "conferir" || row.state === "taxas";
  const name = rowTitle(row);
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 border-b border-line py-3 last:border-0">
      {selectable ? (
        <input
          type="checkbox"
          aria-label={t("review.selectRow", { name, date: formatDate(row.date, locale) })}
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
          className="mt-0.5 size-5 accent-brand-500"
        />
      ) : (
        <span aria-hidden="true" />
      )}
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="font-medium">
            {t(`sides.${row.side}`)} · {name}
          </p>
          <StateBadge row={row} />
        </div>
        <p className="text-xs tabular-nums text-muted">
          {[
            formatDate(row.date, locale),
            t("review.quantityAt", {
              quantity: quantityText(row.quantity, locale),
              price: moneyText(row.unitPrice),
            }),
            row.fees !== "0.00" ? t("review.fees", { value: moneyText(row.fees) }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {row.state === "ignorado" && row.ignoreReason ? (
          <p className="text-xs text-muted">{t(`reasons.${row.ignoreReason}`)}</p>
        ) : null}
        {row.state === "conferir" && row.doubtReason ? (
          <p className="text-xs text-warning">{t(`doubts.${row.doubtReason}`)}</p>
        ) : null}
      </div>
    </li>
  );
}

function IgnoredRow({ line }: { line: IgnoredLine }) {
  const t = useTranslations("investimentos.importar");
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

function PositionRow({
  row,
  price,
  onPrice,
}: {
  row: PlannedPosition;
  price: string;
  onPrice: (value: string) => void;
}) {
  const t = useTranslations("investimentos.importar");
  const locale = useLocale() as Locale;
  return (
    <li className="flex flex-col gap-2 border-b border-line py-3 text-sm last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="font-medium">{row.ticker}</p>
        <Badge tone={row.state === "confere" ? "success" : "warning"}>
          {t(`positions.states.${row.state}`)}
        </Badge>
      </div>
      <p className="text-xs tabular-nums text-muted">
        {t("positions.compare", {
          b3: quantityText(row.quantity, locale),
          held: quantityText(row.held, locale),
        })}
      </p>
      {row.state === "falta" ? (
        <div className="max-w-56">
          <Field
            label={t("positions.price", { ticker: row.ticker })}
            hint={t("positions.priceHint", { quantity: quantityText(row.difference, locale) })}
          >
            <Input
              inputMode="decimal"
              placeholder="32,50"
              value={price}
              onChange={(event) => onPrice(event.target.value)}
            />
          </Field>
        </div>
      ) : null}
    </li>
  );
}

function NewAssets({
  assets,
  classes,
  onClass,
}: {
  assets: NewAsset[];
  classes: Record<string, UnitPricedClass>;
  onClass: (ticker: string, value: UnitPricedClass | "") => void;
}) {
  const t = useTranslations("investimentos.importar.assets");
  const tClass = useTranslations("investimentos.add.stockClasses");
  if (assets.length === 0) return null;
  return (
    <section aria-label={t("title")} className="mt-4">
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
        {assets.map((asset) => (
          <li key={asset.ticker} className="min-w-0 rounded-xl bg-card-soft p-3 text-sm">
            {asset.inCatalog ? (
              <>
                <p className="font-medium">{asset.ticker}</p>
                <p className="text-xs text-muted">
                  {asset.name} · {tClass(asset.assetClass ?? "acao")}
                </p>
              </>
            ) : (
              <Field label={t("classOf", { ticker: asset.ticker })} hint={t("notInCatalog")}>
                <Select
                  value={classes[asset.ticker] ?? asset.assetClass ?? ""}
                  onChange={(event) =>
                    onClass(asset.ticker, event.target.value as UnitPricedClass | "")
                  }
                >
                  <option value="">{t("choose")}</option>
                  {CLASSES.map((value) => (
                    <option key={value} value={value}>
                      {tClass(value)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MissingCodes({
  titles,
  tickers,
  busy,
  onChange,
  onApply,
}: {
  titles: string[];
  tickers: Record<string, string>;
  busy: boolean;
  onChange: (title: string, value: string) => void;
  onApply: () => void;
}) {
  const t = useTranslations("investimentos.importar.codes");
  if (titles.length === 0) return null;
  return (
    <section aria-label={t("title")} className="mt-4 rounded-xl bg-card-soft p-4">
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted">{t("text")}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {titles.map((title) => (
          <Field key={title} label={t("codeOf", { title })}>
            <Input
              maxLength={12}
              placeholder="ABCD3"
              value={tickers[title] ?? ""}
              onChange={(event) => onChange(title, event.target.value.toUpperCase())}
            />
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

function Preview({
  file,
  prepared,
  accounts,
  busy,
  message,
  tickers,
  initialPrices,
  initialClasses,
  onTicker,
  onApplyTickers,
  onCommit,
  onCancel,
}: {
  file: ParsedInvestmentFile;
  prepared: Prepared;
  accounts: Account[];
  busy: boolean;
  message: string | null;
  tickers: Record<string, string>;
  /** Preço pago já conhecido, por linha da posição. A pessoa pode trocar. */
  initialPrices: Record<string, string>;
  /** Tipo de cada ativo, quando a instituição já informa. */
  initialClasses: Record<string, UnitPricedClass>;
  onTicker: (title: string, value: string) => void;
  onApplyTickers: () => void;
  onCommit: (choice: {
    selected: number[];
    classes: Record<string, UnitPricedClass>;
    prices: Record<string, string>;
    accountId: string;
    positionDate: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("investimentos.importar");
  const tAccount = useTranslations("investimentos.account");
  const system = systemTextOf(useTranslations("sistema"));
  const { rows, positions, assets, today } = prepared;
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(rows.filter(selectedByDefault).map((row) => row.line)),
  );
  const [classes, setClasses] = useState<Record<string, UnitPricedClass>>(initialClasses);
  const [prices, setPrices] = useState<Record<string, string>>(initialPrices);
  const [accountId, setAccountId] = useState("");
  const [positionDate, setPositionDate] = useState(today);

  const count = (...states: PlannedTrade["state"][]) =>
    rows.filter((row) => states.includes(row.state)).length;
  const ignored = count("ignorado") + file.ignored.length;
  const filled = positions.filter((row) => row.state === "falta" && prices[row.line]?.trim());
  const chosen = rows.filter((row) => selected.has(row.line));
  const creating = chosen.filter((row) => row.state === "novo" || row.state === "conferir");
  const pendingTickers = new Set([
    ...creating.map((row) => row.ticker),
    ...filled.map((row) => row.ticker),
  ]);
  const shownAssets = assets.filter((asset) => pendingTickers.has(asset.ticker));
  const missingClass = shownAssets.some(
    (asset) => !asset.inCatalog && !(classes[asset.ticker] ?? asset.assetClass),
  );
  const titles = [
    ...new Set(
      rows.flatMap((row) => (row.ignoreReason === "sem_codigo" && row.title ? [row.title] : [])),
    ),
  ];
  const total = chosen.length + filled.length;
  const isPosition = file.kind === "posicao";
  const hasAnything = isPosition
    ? positions.some((row) => row.state === "falta")
    : count("novo", "conferir", "taxas") > 0 || titles.length > 0;
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
  const tiles: Array<[string, number]> = isPosition
    ? [
        [t("positions.states.confere"), positions.filter((r) => r.state === "confere").length],
        [t("positions.states.falta"), positions.filter((r) => r.state === "falta").length],
        [t("positions.states.sobra"), positions.filter((r) => r.state === "sobra").length],
        [t("review.ignored"), positions.filter((r) => r.state === "ignorado").length + ignored],
      ]
    : [
        [t("review.new"), count("novo", "taxas")],
        [t("review.check"), count("conferir")],
        [t("review.exists"), count("existe")],
        [t("review.ignored"), ignored],
      ];

  return (
    <Card
      title={t(`review.title.${file.kind}`)}
      description={t(isPosition ? "positions.text" : "review.text")}
    >
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

      <MissingCodes
        titles={titles}
        tickers={tickers}
        busy={busy}
        onChange={onTicker}
        onApply={onApplyTickers}
      />

      {isPosition ? (
        <>
          {positions.some((row) => row.state === "falta") ? (
            <div className="mt-4 max-w-56">
              <Field label={t("positions.date")} hint={t("positions.dateHint")}>
                <Input
                  type="date"
                  max={today}
                  value={positionDate}
                  onChange={(event) => setPositionDate(event.target.value)}
                />
              </Field>
            </div>
          ) : null}
          <ul aria-label={t("positions.list")} className="m-0 mt-4 list-none p-0">
            {positions.map((row) => (
              <PositionRow
                key={row.line}
                row={row}
                price={prices[row.line] ?? ""}
                onPrice={(value) => setPrices((all) => ({ ...all, [row.line]: value }))}
              />
            ))}
          </ul>
        </>
      ) : null}

      {list.length > 0 ? (
        <ul aria-label={t("review.rows")} className="m-0 mt-4 list-none p-0">
          {list.map((item) =>
            "row" in item ? (
              <TradeRow
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

      <NewAssets
        assets={shownAssets}
        classes={classes}
        onClass={(ticker, value) =>
          setClasses((all) => {
            const next = { ...all };
            if (value) next[ticker] = value;
            else delete next[ticker];
            return next;
          })
        }
      />

      {hasAnything ? (
        <div className="mt-4 max-w-md">
          <Field label={tAccount("tradeLabel")} hint={t("review.accountHint")}>
            <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">{tAccount("none")}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {system.name(account.name)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          disabled={total === 0 || busy || missingClass}
          onClick={() =>
            onCommit({
              selected: [...selected],
              classes,
              prices,
              accountId,
              positionDate: isPosition ? positionDate : null,
            })
          }
        >
          {busy ? t("review.importing") : t("review.submit", { count: total })}
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

export function InvestmentImport({
  accounts,
  bank,
}: {
  accounts: Account[];
  /** Conexão com bancos (ADR-0038). Null: não vê. Falso: vê, mas ainda não guardou chave. */
  bank: boolean | null;
}) {
  const t = useTranslations("investimentos.importar");
  const tErrors = useTranslations("investimentos.importar.errors");
  const outdated = useTranslations("importar.errors")("outdated");
  const [file, setFile] = useState<ParsedInvestmentFile | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [tickers, setTickers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [version, setVersion] = useState(0);
  // Preço médio pago que a instituição informou, por linha da posição: já entra preenchido na conferência.
  const [paid, setPaid] = useState<Record<string, string>>({});
  const [bankClasses, setBankClasses] = useState<Record<string, UnitPricedClass>>({});
  // A instituição não disse quanto foi pago: o preço que entrou preenchido é o de mercado.
  const [estimated, setEstimated] = useState(false);
  const locale = useLocale();
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
    setTickers({});
    setPaid({});
    setBankClasses({});
    setEstimated(false);
    setMessage(null);
    setDone(null);
    setFileKey((key) => key + 1);
  };

  const onBank = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await fetchBankPortfolio().catch(() => ({
        ok: false as const,
        message: outdated,
      }));
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      if (result.file.positions.length === 0 && result.file.ignored.length === 0) {
        setMessage(t("bank.empty"));
        return;
      }
      setPaid(
        Object.fromEntries(
          Object.entries(result.paid).map(([line, price]) => [line, toInputValue(price, locale)]),
        ),
      );
      setBankClasses(result.classes);
      setEstimated(result.estimated.length > 0);
      prepare(result.file, {});
    });
  };

  const prepare = (parsed: ParsedInvestmentFile, typed: Record<string, string>) => {
    startTransition(async () => {
      const result = await prepareInvestmentImport({
        trades: parsed.trades,
        positions: parsed.positions,
        tickers: typed,
      }).catch(() => ({ ok: false as const, message: outdated }));
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setMessage(null);
      setFile(parsed);
      setPrepared(result);
      setVersion((value) => value + 1);
    });
  };

  // O texto do erro nunca aparece nem vai para log: pode trazer trechos do arquivo.
  const problemOf = (error: unknown) => {
    if (error instanceof InvestmentFileError) return tErrors(error.code);
    if ((error as { name?: string }).name === "PasswordException") {
      return tErrors("pdf_com_senha");
    }
    return tErrors("readFailed");
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    setMessage(null);
    setPaid({});
    setBankClasses({});
    setEstimated(false);
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setReading(chosen.name);
    try {
      const kind = checkInvestmentFile(new Uint8Array(await chosen.arrayBuffer()), chosen.name);
      prepare(
        kind === "pdf"
          ? parseBrokerageNotes(await readPdfLines(chosen))
          : parseB3Workbook(await readWorkbook(chosen)),
        {},
      );
    } catch (error) {
      setMessage(problemOf(error));
    } finally {
      setReading(null);
    }
  };

  const commit = (choice: Parameters<React.ComponentProps<typeof Preview>["onCommit"]>[0]) => {
    if (!file) return;
    startTransition(async () => {
      const result = await commitInvestmentImport({
        trades: file.trades,
        positions: file.positions,
        tickers,
        ...choice,
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
            {t("done.counts", {
              created: done.created,
              assets: done.assets,
              fees: done.feesUpdated,
            })}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link href="/app/investimentos" className={buttonClass()}>
              {t("done.portfolio")}
            </Link>
            <Button variant="secondary" onClick={reset}>
              {t("done.another")}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (file && prepared) {
    return (
      <>
        {estimated ? (
          <p
            role="status"
            className="m-0 flex items-start gap-2 rounded-xl border border-warning bg-card-soft p-4 text-sm"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            {t("bank.estimated")}
          </p>
        ) : null}
        <Preview
          key={version}
          file={file}
          prepared={prepared}
          accounts={accounts}
          busy={busy}
          message={message}
          tickers={tickers}
          initialPrices={paid}
          initialClasses={bankClasses}
          onTicker={(title, value) => setTickers((all) => ({ ...all, [title]: value }))}
          onApplyTickers={() => prepare(file, tickers)}
          onCommit={commit}
          onCancel={reset}
        />
      </>
    );
  }

  return (
    <>
      {bank === null ? null : (
        <Card title={t("bank.title")} description={t(bank ? "bank.text" : "bank.connectText")}>
          {bank ? (
            <Button onClick={onBank} disabled={!hydrated || busy || reading !== null}>
              <Landmark className="size-4" aria-hidden="true" />
              {busy ? t("bank.fetching") : t("bank.fetch")}
            </Button>
          ) : (
            <Link href="/app/contas/conexoes" className={buttonClass("secondary")}>
              {t("bank.connect")}
            </Link>
          )}
        </Card>
      )}
      <Card title={t("choose.title")} description={t("choose.text")}>
        <div className="max-w-md">
          <Field label={t("choose.file")} hint={t("choose.fileHint")}>
            <input
              key={fileKey}
              type="file"
              accept={INVESTMENT_FILE_ACCEPT}
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
