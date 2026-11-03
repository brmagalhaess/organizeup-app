// Comparar e gravar proventos importados (ADR-0029). Uma rotina só, para `/app/proventos/importar` e o importador
// de arquivos (ADR-0030): a marca da linha importada é o que faz o Mercado e o Desfazer respeitarem o que entrou.
// Quem chama toma `lockFamilyImport` antes: a comparação e a gravação precisam ver a mesma foto.
import "server-only";
import { loadBlocks } from "@organizeup/agents";
import {
  accessWithin,
  and,
  dividends,
  eq,
  inArray,
  investments,
  marketDividends,
  type TenantContext,
  type TenantTx,
} from "@organizeup/db";
import {
  canUse,
  importedDividendId,
  normalizeTicker,
  planDividendImport,
  type DividendHolding,
  type ParsedDividend,
  type PlannedDividend,
} from "@organizeup/domain";
import { audit } from "@/lib/audit";

/** Carteira, proventos de cada ativo e o que a fonte conhece, para o plano comparar. */
export async function planDividends(
  tx: TenantTx,
  rows: ParsedDividend[],
  assignments: Record<string, string>,
  today: string,
) {
  const [holdings, recorded, blocks] = await Promise.all([
    tx.select().from(investments),
    tx.select().from(dividends),
    loadBlocks(tx),
  ]);
  const tickers = [...new Set(rows.map((row) => row.ticker))];
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
  const planned = planDividendImport({
    rows,
    holdings: owned,
    events,
    blocked: blocks.proventos,
    today,
    assignments,
  });
  const options = owned.map(({ id, name, ticker: code }) => ({
    id,
    label: normalizeTicker(code) ? `${normalizeTicker(code)} · ${name}` : name,
  }));
  return { rows: planned, options };
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

export interface WrittenDividends {
  created: number;
  replaced: number;
  /** Linha do arquivo → provento gravado. */
  ids: Map<number, string>;
}

/** Linha nova com a marca de importada; linha que troca o automático, no lugar dele. */
export async function writeDividends(
  tx: TenantTx,
  ctx: TenantContext,
  writing: PlannedDividend[],
): Promise<WrittenDividends> {
  const ids = new Map<number, string>();
  if (writing.length === 0 || !canUse(await accessWithin(tx), "investimentos")) {
    return { created: 0, replaced: 0, ids };
  }
  const fresh = writing.filter((row) => row.replaces === null);
  if (fresh.length > 0) {
    await tx.insert(dividends).values(
      fresh.map((row) => {
        const id = importedDividendId(crypto.randomUUID());
        ids.set(row.line, id);
        return {
          id,
          householdId: ctx.householdId,
          investmentId: row.investmentId!,
          kind: row.kind,
          paidOn: row.paidOn,
          gross: row.amounts!.gross,
          withheld: row.amounts!.withheld,
        };
      }),
    );
  }
  let replaced = 0;
  for (const row of writing) {
    if (row.replaces !== null && (await replaceAutomatic(tx, row))) {
      replaced += 1;
      ids.set(row.line, row.replaces);
    }
  }
  await audit(tx, ctx, "import", "dividends");
  return { created: fresh.length, replaced, ids };
}
