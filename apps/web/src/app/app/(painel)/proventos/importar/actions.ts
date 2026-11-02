"use server";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadBlocks } from "@organizeup/agents";
import {
  and,
  canWrite,
  DIVIDEND_KINDS,
  dividends,
  eq,
  householdCurrency,
  householdTimezone,
  inArray,
  investments,
  lockFamilyImport,
  marketDividends,
  withHousehold,
  type TenantTx,
} from "@organizeup/db";
import {
  amountsProblem,
  brazilRulesApply,
  DIVIDEND_DOUBTS,
  DIVIDEND_STATES,
  dividendsToWrite,
  importedDividendId,
  isB3Ticker,
  isCalendarDate,
  normalizeTicker,
  planDividendImport,
  todayIn,
  type DividendHolding,
  type PlannedDividend,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";
import { requireModule } from "@/lib/billing/plan-gate";
import { reportActionFailure } from "@/lib/diagnostics";

// O arquivo fica no navegador (ADR-0006, ADR-0029). Aqui só chegam código, tipo, data e valores, e nada confia
// neles: o formato é validado, e a comparação com a família roda de novo, dentro da transação.
const MAX_LINES = 2000;
const CENTS = /^\d{1,12}\.\d{2}$/;
/** Pelo menos um dígito diferente de zero. */
const POSITIVE_CENTS = /^(?=[\d.]*[1-9])\d{1,12}\.\d{2}$/;

const cents = z.string().regex(CENTS);
const positive = z.string().regex(POSITIVE_CENTS);
const validDate = z.string().refine(isCalendarDate);
const ticker = z.string().max(8).refine(isB3Ticker);

const rowSchema = z
  .object({
    line: z.number().int().min(0).max(10_000_000),
    ticker,
    kind: z.enum(DIVIDEND_KINDS),
    paidOn: validDate,
    gross: positive.nullable(),
    withheld: cents.nullable(),
    net: positive.nullable(),
    ambiguous: z.literal(true).optional(),
  })
  .refine((row) => row.gross !== null || row.net !== null);

const fileSchema = z.object({
  rows: z
    .array(rowSchema)
    .max(MAX_LINES)
    .refine((rows) => new Set(rows.map((row) => row.line)).size === rows.length),
  /** Investimento escolhido na prévia para cada código fora da carteira. */
  assignments: z.record(ticker, z.string().max(100)),
});

const commitSchema = fileSchema.extend({
  selected: z.array(z.number().int()).max(MAX_LINES),
  /** O que a pessoa viu: o que mudou depois da prévia é pulado, sem gravar nada que ela não aceitou. */
  seen: z
    .array(
      z.object({
        line: z.number().int(),
        state: z.enum(DIVIDEND_STATES),
        doubtReason: z.enum(DIVIDEND_DOUBTS).nullable(),
      }),
    )
    .max(MAX_LINES),
});

export type DividendFileInput = z.input<typeof fileSchema>;
export type DividendCommitInput = z.input<typeof commitSchema>;
export interface HoldingOption {
  id: string;
  label: string;
}

export type PrepareResult =
  { ok: true; rows: PlannedDividend[]; options: HoldingOption[] } | { ok: false; message: string };

export type CommitResult =
  { ok: true; created: number; replaced: number; skipped: number } | { ok: false; message: string };

const blocked = async () => (await getTranslations("settings"))("noPermission");
const texts = () => getTranslations("proventos.importar.errors");

class ImportRefused extends Error {}

/** Depois do formato, os valores entre si: o que chega aqui não confia na leitura do navegador. */
function amountsRefusal(
  rows: z.output<typeof fileSchema>["rows"],
  t: Awaited<ReturnType<typeof texts>>,
): string | null {
  const problems = rows.map(amountsProblem);
  if (problems.includes("retido_maior")) return t("withheldTooHigh");
  return problems.includes("nao_fecham") ? t("amountsOff") : null;
}

function failed(event: string, error: unknown, message: string) {
  // Só nome e código: a mensagem do banco pode trazer dados da família.
  const { name, code } = error as { name?: string; code?: string };
  console.error(JSON.stringify({ level: "error", msg: event, name, code }));
  reportActionFailure(event, error);
  return { ok: false as const, message };
}

/** Carteira, proventos de cada ativo e o que a fonte conhece, para o plano comparar. */
async function planOf(tx: TenantTx, data: z.output<typeof fileSchema>, today: string) {
  const [holdings, recorded, blocks] = await Promise.all([
    tx.select().from(investments),
    tx.select().from(dividends),
    loadBlocks(tx),
  ]);
  const tickers = [...new Set(data.rows.map((row) => row.ticker))];
  const events = tickers.length
    ? await tx
        .select({
          id: marketDividends.id,
          ticker: marketDividends.ticker,
          kind: marketDividends.kind,
          comDate: marketDividends.comDate,
          payDate: marketDividends.payDate,
        })
        .from(marketDividends)
        .where(inArray(marketDividends.ticker, tickers))
    : [];
  const owned: DividendHolding[] = holdings.map((holding) => ({
    id: holding.id,
    name: holding.name,
    ticker: holding.ticker,
    assetClass: holding.assetClass,
    dividends: recorded.filter((row) => row.investmentId === holding.id),
  }));
  const rows = planDividendImport({
    rows: data.rows,
    holdings: owned,
    events,
    blocked: blocks.proventos,
    today,
    assignments: data.assignments,
  });
  const options = owned.map(({ id, name, ticker: code }) => ({
    id,
    label: normalizeTicker(code) ? `${normalizeTicker(code)} · ${name}` : name,
  }));
  return { rows, options };
}

/** Confere as linhas com a família agora. Só lê, e o resultado é a prévia. */
export async function prepareDividendImport(input: DividendFileInput): Promise<PrepareResult> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return { ok: false, message: await blocked() };
  const t = await texts();
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: t("invalid") };
  const refusal = amountsRefusal(parsed.data.rows, t);
  if (refusal) return { ok: false, message: refusal };
  try {
    return await withHousehold(ctx, async (tx) => {
      if (!brazilRulesApply(await householdCurrency(tx))) {
        return { ok: false, message: t("onlyBrazil") };
      }
      const today = todayIn(await householdTimezone(tx, ctx.householdId));
      return { ok: true as const, ...(await planOf(tx, parsed.data, today)) };
    });
  } catch (error) {
    return failed("prepare_dividend_import_failed", error, t("failed"));
  }
}

async function replaceAutomatic(tx: TenantTx, row: PlannedDividend) {
  const { gross, withheld } = row.amounts!;
  const [changed] = await tx
    .update(dividends)
    .set({ kind: row.kind, paidOn: row.paidOn, gross, withheld, source: "familia" })
    .where(and(eq(dividends.id, row.replaces!), eq(dividends.source, "agente")))
    .returning({ id: dividends.id });
  return changed !== undefined;
}

/** Tudo numa transação, sob a trava da família: dois envios seguidos gravam uma vez. */
export async function commitDividendImport(input: DividendCommitInput): Promise<CommitResult> {
  const { ctx } = await requireModule("investimentos");
  if (!canWrite(ctx)) return { ok: false, message: await blocked() };
  const t = await texts();
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: t("invalid") };
  const refusal = amountsRefusal(parsed.data.rows, t);
  if (refusal) return { ok: false, message: refusal };
  const selected = new Set(parsed.data.selected);
  try {
    const result = await withHousehold(ctx, async (tx) => {
      await lockFamilyImport(tx, ctx.householdId);
      if (!brazilRulesApply(await householdCurrency(tx))) {
        throw new ImportRefused(t("onlyBrazil"));
      }
      const today = todayIn(await householdTimezone(tx, ctx.householdId));
      const { rows } = await planOf(tx, parsed.data, today);
      const chosen = rows.filter((row) => selected.has(row.line));
      const writing = dividendsToWrite(rows, selected, parsed.data.seen);
      const fresh = writing.filter((row) => row.replaces === null);
      if (fresh.length > 0) {
        await tx.insert(dividends).values(
          fresh.map((row) => ({
            id: importedDividendId(crypto.randomUUID()),
            householdId: ctx.householdId,
            investmentId: row.investmentId!,
            kind: row.kind,
            paidOn: row.paidOn,
            gross: row.amounts!.gross,
            withheld: row.amounts!.withheld,
          })),
        );
      }
      let replaced = 0;
      for (const row of writing) {
        if (row.replaces !== null && (await replaceAutomatic(tx, row))) replaced += 1;
      }
      if (writing.length > 0) await audit(tx, ctx, "import", "dividends");
      return {
        ok: true as const,
        created: fresh.length,
        replaced,
        skipped: chosen.length - writing.length,
      };
    });
    revalidatePath("/app", "layout");
    return result;
  } catch (error) {
    if (error instanceof ImportRefused) return { ok: false, message: error.message };
    return failed("commit_dividend_import_failed", error, t("failed"));
  }
}
