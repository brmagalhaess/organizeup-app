"use server";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  accounts,
  canWrite,
  eq,
  householdCurrency,
  householdTimezone,
  investments,
  investmentTrades,
  listMarketAssets,
  loadStockEvents,
  lockFamilyImport,
  TRADE_SIDES,
  withHousehold,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  brazilRulesApply,
  investmentClassAllowed,
  money,
  newAssetsOf,
  normalizeTicker,
  parseMoney,
  planInvestmentImport,
  planPositions,
  todayIn,
  toDbAmount,
  withResolvedTickers,
  type CatalogAsset,
  type KnownHolding,
  type NewAsset,
  type PlannedPosition,
  type PlannedTrade,
  type TradeInput,
  type UnitPricedClass,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { reportActionFailure } from "@/lib/diagnostics";
import { requireModule } from "@/lib/billing/plan-gate";
import { MissingQuote, recordTradeCash } from "@/lib/trade-cash";

// O arquivo fica no navegador (ADR-0006, ADR-0024). Aqui só chegam as linhas já lidas, e nada confia nelas:
// o formato é validado e a comparação com a carteira roda de novo, dentro da transação.
const MAX_LINES = 2000;
/** `investment_trades.quantity` e `unit_price` são numeric(20,8). */
const DECIMAL = /^\d{1,12}(\.\d{1,8})?$/;
const CENTS = /^\d{1,12}\.\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER = /^[A-Z]{4}\d{1,2}$/;
const positive = z
  .string()
  .regex(DECIMAL)
  .refine((value) => money(value).gt(0));
const validDate = z
  .string()
  .regex(DATE)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));

const tradeSchema = z.object({
  line: z.number().int().min(0).max(10_000_000),
  ticker: z.string().regex(TICKER).nullable(),
  title: z.string().max(80).nullable(),
  side: z.enum(TRADE_SIDES),
  date: validDate,
  quantity: positive,
  unitPrice: positive,
  fees: z.string().regex(CENTS),
  doubt: z.literal("nota_nao_fecha").nullable(),
});

const positionSchema = z.object({
  line: z.number().int().min(0).max(10_000_000),
  ticker: z.string().regex(TICKER),
  name: z.string().max(80).nullable(),
  quantity: positive,
  closePrice: z.string().regex(DECIMAL).nullable(),
});

const fileSchema = z.object({
  trades: z.array(tradeSchema).max(MAX_LINES),
  positions: z.array(positionSchema).max(MAX_LINES),
  /** Código informado pela pessoa para cada título da nota. */
  tickers: z.record(z.string().max(80), z.string().max(12)),
});

const classSchema = z.enum(["acao", "fii", "etf_bdr"]);

const commitSchema = fileSchema.extend({
  accountId: z.string().max(100),
  selected: z.array(z.number().int()).max(MAX_LINES),
  classes: z.record(z.string().regex(TICKER), classSchema),
  /** Preço pago de cada linha da Posição, digitado na prévia. */
  prices: z.record(z.string().max(12), z.string().max(30)),
  /** Data das operações que vêm da Posição. */
  positionDate: validDate.nullable(),
});

export type ImportFileInput = z.input<typeof fileSchema>;
export type ImportCommitInput = z.input<typeof commitSchema>;

export type PrepareResult =
  | {
      ok: true;
      rows: PlannedTrade[];
      positions: PlannedPosition[];
      assets: NewAsset[];
      today: string;
    }
  | { ok: false; message: string };

export type CommitResult =
  | { ok: true; created: number; feesUpdated: number; assets: number; skipped: number }
  | { ok: false; message: string };

const blocked = async () => (await getTranslations("settings"))("noPermission");
const texts = () => getTranslations("investimentos.importar.errors");

async function loadHoldings(tx: TenantTx): Promise<KnownHolding[]> {
  const events = await loadStockEvents(tx);
  const [holdings, trades] = await Promise.all([
    tx.select().from(investments),
    tx.select().from(investmentTrades),
  ]);
  return holdings.map((holding) => ({
    id: holding.id,
    name: holding.name,
    ticker: holding.ticker,
    assetClass: holding.assetClass,
    trades: trades.filter((trade) => trade.investmentId === holding.id),
    events: events.filter((event) => event.investmentId === holding.id),
  }));
}

/** Catálogo por código. Sem o job de mercado ainda, vem vazio e a pessoa escolhe o tipo. */
async function loadCatalog() {
  const rows = await listMarketAssets();
  return new Map<string, CatalogAsset>(rows.map((row) => [row.ticker, row]));
}

function planOf(
  input: z.output<typeof fileSchema>,
  holdings: KnownHolding[],
  catalog: ReadonlyMap<string, CatalogAsset>,
  selected?: ReadonlySet<number>,
) {
  const known = [...catalog.values(), ...holdings];
  const trades = withResolvedTickers(input.trades, known, input.tickers);
  const rows = planInvestmentImport({ trades, holdings, ...(selected ? { selected } : {}) });
  return { rows, positions: planPositions(input.positions, holdings) };
}

const needsAsset = (row: PlannedTrade) => row.state === "novo" || row.state === "conferir";

/** Confere a linha com a carteira de agora. Só lê, e o resultado é a prévia. */
export async function prepareInvestmentImport(input: ImportFileInput): Promise<PrepareResult> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return { ok: false, message: await blocked() };
  const t = await texts();
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: t("invalid") };
  try {
    const catalog = await loadCatalog();
    return await withHousehold(ctx, async (tx) => {
      if (!brazilRulesApply(await householdCurrency(tx))) {
        return { ok: false, message: t("onlyBrazil") };
      }
      const today = todayIn(await householdTimezone(tx, ctx.householdId));
      const holdings = await loadHoldings(tx);
      const { rows, positions } = planOf(parsed.data, holdings, catalog);
      const assets = newAssetsOf(
        [...rows.filter(needsAsset), ...positions.filter((position) => position.state === "falta")],
        holdings,
        catalog,
      );
      return { ok: true as const, rows, positions, assets, today };
    });
  } catch (error) {
    return failed("prepare_investment_import_failed", error, t("failed"));
  }
}

function failed(event: string, error: unknown, message: string) {
  // Só nome e código: a mensagem do banco pode trazer dados da família.
  const { name, code } = error as { name?: string; code?: string };
  console.error(JSON.stringify({ level: "error", msg: event, name, code }));
  reportActionFailure(event, error);
  return { ok: false as const, message };
}

interface NewTrade {
  ticker: string;
  side: TradeInput["side"];
  trade: TradeInput;
}

/** Linhas da Posição que a pessoa completou com o preço pago. */
function positionTrades(
  positions: PlannedPosition[],
  prices: Record<string, string>,
  date: string,
  locale: string,
): NewTrade[] | null {
  const trades: NewTrade[] = [];
  for (const position of positions) {
    const typed = prices[String(position.line)]?.trim();
    if (!typed || position.state !== "falta") continue;
    let price;
    try {
      price = parseMoney(typed, locale);
    } catch {
      return null;
    }
    if (price.lte(0) || price.gte("100000000000")) return null;
    trades.push({
      ticker: position.ticker,
      side: "compra",
      trade: {
        side: "compra",
        occurredOn: date,
        quantity: position.difference,
        unitPrice: price.toFixed(8),
        fees: toDbAmount(0),
      },
    });
  }
  return trades;
}

class ImportRefused extends Error {}

/** O catálogo manda; fora dele, vale a escolha da pessoa e, sem escolha, o que o código deixa claro. */
const classOf = (asset: NewAsset, classes: Record<string, UnitPricedClass>) =>
  asset.inCatalog ? asset.assetClass : (classes[asset.ticker] ?? asset.assetClass);

async function createAssets(
  tx: TenantTx,
  ctx: TenantContext,
  assets: NewAsset[],
  classes: Record<string, UnitPricedClass>,
  catalog: ReadonlyMap<string, CatalogAsset>,
  today: string,
  noClass: string,
) {
  const created = new Map<string, string>();
  for (const asset of assets) {
    const assetClass = classOf(asset, classes);
    if (!assetClass) throw new ImportRefused(noClass);
    const close = catalog.get(asset.ticker)?.close ?? null;
    const [row] = await tx
      .insert(investments)
      .values({
        householdId: ctx.householdId,
        name: asset.name.slice(0, 80),
        ticker: asset.ticker,
        assetClass,
        ...(close ? { currentPrice: close, valuedOn: today, priceSource: "mercado" as const } : {}),
      })
      .returning({ id: investments.id });
    created.set(asset.ticker, row!.id);
    await audit(tx, ctx, "create", "investments", row!.id);
  }
  return created;
}

/** Tudo numa transação: se uma linha falhar, nem ativo novo fica para trás. */
export async function commitInvestmentImport(input: ImportCommitInput): Promise<CommitResult> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return { ok: false, message: await blocked() };
  const [t, locale] = await Promise.all([texts(), getLocale()]);
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: t("invalid") };
  const data = parsed.data;
  const selected = new Set(data.selected);
  try {
    const catalog = await loadCatalog();
    return await withHousehold(ctx, async (tx) => {
      await lockFamilyImport(tx, ctx.householdId);
      const currency = await householdCurrency(tx);
      if (!brazilRulesApply(currency)) throw new ImportRefused(t("onlyBrazil"));
      const today = todayIn(await householdTimezone(tx, ctx.householdId));
      const holdings = await loadHoldings(tx);
      const { rows, positions } = planOf(data, holdings, catalog, selected);

      const chosen = rows.filter((row) => selected.has(row.line));
      const oversold = chosen.find((row) => row.ignoreReason === "venda_maior_que_posicao");
      if (oversold) throw new ImportRefused(t("oversold", { ticker: oversold.ticker ?? "" }));
      const creating = chosen.filter(needsAsset);
      if (creating.some((row) => row.date > today)) throw new ImportRefused(t("future"));

      const positionDate = data.positionDate ?? today;
      if (positionDate > today) throw new ImportRefused(t("future"));
      const fromPositions = positionTrades(positions, data.prices, positionDate, locale);
      if (!fromPositions) throw new ImportRefused(t("priceFormat"));

      const planned: NewTrade[] = [
        ...creating.map((row) => ({
          ticker: row.ticker!,
          side: row.side,
          trade: {
            side: row.side,
            occurredOn: row.date,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            fees: row.fees,
          },
        })),
        ...fromPositions,
      ];
      const nameOf = new Map(data.positions.map((position) => [position.ticker, position.name]));
      const assets = newAssetsOf(
        planned.map((item) => ({ ticker: item.ticker, name: nameOf.get(item.ticker) ?? null })),
        holdings,
        catalog,
      );
      for (const asset of assets) {
        const assetClass = classOf(asset, data.classes);
        if (assetClass && !investmentClassAllowed(assetClass, currency)) {
          throw new ImportRefused(t("onlyBrazil"));
        }
      }
      if (data.accountId) {
        const [account] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.id, data.accountId));
        if (!account) throw new ImportRefused(t("noAccount"));
      }
      const created = await createAssets(
        tx,
        ctx,
        assets,
        data.classes,
        catalog,
        today,
        t("classRequired"),
      );
      const idOf = new Map(
        holdings.flatMap((holding) => {
          const ticker = normalizeTicker(holding.ticker);
          return ticker ? [[ticker, holding.id] as const] : [];
        }),
      );
      for (const item of planned) {
        const transactionId = data.accountId
          ? await recordTradeCash(tx, ctx, {
              accountId: data.accountId,
              side: item.side,
              name: item.ticker,
              trade: item.trade,
            })
          : null;
        await tx.insert(investmentTrades).values({
          householdId: ctx.householdId,
          investmentId: (created.get(item.ticker) ?? idOf.get(item.ticker))!,
          transactionId,
          ...item.trade,
        });
      }

      const updates = chosen.flatMap((row) => (row.state === "taxas" ? row.feeUpdates : []));
      for (const update of updates) {
        await tx
          .update(investmentTrades)
          .set({ fees: update.fees })
          .where(eq(investmentTrades.id, update.tradeId));
      }
      if (planned.length > 0 || updates.length > 0) {
        await audit(tx, ctx, "import", "investment_trades");
      }
      return {
        ok: true as const,
        created: planned.length,
        feesUpdated: updates.length,
        assets: assets.length,
        skipped: chosen.length - creating.length - chosen.filter((r) => r.state === "taxas").length,
      };
    }).then((result) => {
      revalidatePath("/app", "layout");
      return result;
    });
  } catch (error) {
    if (error instanceof ImportRefused) return { ok: false, message: error.message };
    if (error instanceof MissingQuote) return { ok: false, message: t("noQuote") };
    return failed("commit_investment_import_failed", error, t("failed"));
  }
}
