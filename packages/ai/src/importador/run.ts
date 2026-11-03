// Entrada própria do pacote (`@organizeup/ai/importador`): só o worker abre processo filho, e a web não leva isto.
// O agente `importador` (ADR-0030): lê um lote, um arquivo por vez. Regras primeiro; modelo só no que elas
// não entendem, com o portão aberto, sempre fora de `withHousehold`. Falha em um arquivo não para os outros.
// Só nasce rascunho: nada vai para o cadastro sem a aprovação na tela (regra 7). No log, só contagens.
import {
  applySmartReview,
  claimSmartFile,
  failSmartFile,
  notifySmartImport,
  otherLotReading,
  planSmartReview,
  prepareSmartReview,
  priorSmartReading,
  saveSmartReading,
  startSmartImport,
} from "@organizeup/agents";
import {
  and,
  eq,
  householdTimezone,
  inArray,
  smartImportFiles,
  smartImports,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import { smartKindOf, todayIn, type SmartFileKind, type SmartReading } from "@organizeup/domain";
import { aiLimits, serviceDay, type AiLimits } from "../access";
import { errorCode, reportFailure } from "../api-errors";
import type { ModelClient } from "../client";
import { usageOf } from "../models";
import { loadPrivacyFilter, type PrivacyFilter } from "../privacy";
import { recordUsage } from "../usage";
import { importerGate } from "./gate";
import type { SmartReadResult } from "./read-child";
import { planInChild, readInChild } from "./read-sandbox";
import { answerOfMessage, IMPORTER_ROUTE, smartBlock, smartRequest } from "./reader";

export interface SmartImportInput {
  ctx: TenantContext;
  /** Null sem chave: o portão fecha antes de usar. */
  client: ModelClient | null;
  importId: string;
  limits?: AiLimits;
  day?: string;
  /** Quantos arquivos ler nesta rodada. O worker lê um e volta para o fim da fila: nenhuma família espera outra. */
  maxFiles?: number;
  /** Cada família lê um lote por vez: quem tem dois não passa a frente de quem tem um. */
  oneLotPerFamily?: boolean;
  maxOpenItems?: number;
}

export interface SmartImportRun {
  files: number;
  byRules: number;
  byModel: number;
  failed: number;
  /** Ficou arquivo para a próxima rodada. */
  remaining: boolean;
  /** Nada foi lido: outro lote da família está na vez, ou o arquivo segue em leitura. */
  waiting: boolean;
}

interface Outcome {
  reading: SmartReading;
  method: "regras" | "modelo";
  truncated: boolean;
}

/** Contrato, nota e apólice ficam disponíveis como documento. Extrato e fatura, não: já viram lançamentos. */
function withDocument(reading: SmartReading): SmartReading {
  const statement = reading.docType === "extrato" || reading.docType === "fatura";
  if (statement || reading.proposals.some((row) => row.payload.destination === "documento")) {
    return reading;
  }
  return {
    ...reading,
    proposals: [
      ...reading.proposals,
      {
        confidence: reading.confidence,
        excerpt: null,
        payload: { destination: "documento", title: reading.issuer },
      },
    ],
  };
}

async function readWithModel(
  input: SmartImportInput,
  opened: Extract<SmartReadResult, { ok: true }>,
  kind: SmartFileKind,
  bytes: Uint8Array,
  privacy: PrivacyFilter,
  today: string,
  day: string,
): Promise<Outcome | string> {
  const { ctx, client, limits = aiLimits() } = input;
  const gate = await importerGate({ ctx, limits, day });
  if (gate !== "pronto" || !client) return gate === "pronto" ? "sem_chave" : gate;
  const prepared = smartBlock({ kind, text: opened.text }, bytes, opened.pages, privacy);
  if (typeof prepared === "string") return prepared;
  let message;
  try {
    message = await client.stream(smartRequest(prepared.block, today), {}).finalMessage();
  } catch (error) {
    const code = errorCode(error);
    reportFailure(code, error);
    return "indisponivel";
  }
  await recordUsage(ctx, IMPORTER_ROUTE.name, day, usageOf(message));
  const reading = answerOfMessage(message, privacy, today);
  if (!reading) return "nao_entendi";
  return { reading: withDocument(reading), method: "modelo", truncated: prepared.truncated };
}

async function readFile(
  input: SmartImportInput,
  file: { id: string; mediaType: string; content: Uint8Array; sha256: string },
  useAi: boolean,
  privacy: PrivacyFilter,
  today: string,
  day: string,
): Promise<Outcome | string> {
  const kind: SmartFileKind | null = smartKindOf(file.mediaType);
  if (!kind) return "tipo";
  const opened = await readInChild({
    kind,
    bytes: file.content,
    year: Number(today.slice(0, 4)),
  });
  if (!opened.ok) return opened.failure;
  if (opened.reading) {
    return { reading: withDocument(opened.reading), method: "regras", truncated: false };
  }
  // Mesmo arquivo já lido em outro lote: a família não paga duas vezes.
  const prior = await withHousehold(input.ctx, (tx) => priorSmartReading(tx, file.sha256, file.id));
  if (prior) {
    const { truncated, ...reading } = prior;
    return { reading, method: "modelo", truncated };
  }
  if (!useAi) return "precisa_ia";
  return readWithModel(input, opened, kind, file.content, privacy, today, day);
}

/** Sem mensagem: ela pode trazer conteúdo do arquivo. */
function logFailure(error: unknown) {
  const { name, code } = error as { name?: string; code?: string };
  console.error(JSON.stringify({ level: "error", msg: "smart_import_file_failed", name, code }));
}

/** Roda até acabar os arquivos. Repetir não refaz o que está pronto. Lança só se o banco falhar. */
export async function runSmartImport(input: SmartImportInput): Promise<SmartImportRun | null> {
  const { ctx, importId, day = serviceDay(), maxFiles = Infinity } = input;
  const started = await withHousehold(ctx, async (tx) => {
    if (input.oneLotPerFamily && (await otherLotReading(tx, importId))) {
      return { deferred: true as const };
    }
    const lot = await startSmartImport(tx, importId);
    if (!lot) return null;
    return {
      lot,
      privacy: await loadPrivacyFilter(tx, ctx.householdId),
      today: todayIn(await householdTimezone(tx, ctx.householdId)),
    };
  });
  if (!started) return null;
  const run: SmartImportRun = {
    files: 0,
    byRules: 0,
    byModel: 0,
    failed: 0,
    remaining: false,
    waiting: false,
  };
  if ("deferred" in started) return { ...run, remaining: true, waiting: true };
  const { lot, privacy, today } = started;

  while (run.files < maxFiles) {
    const file = await withHousehold(ctx, (tx) => claimSmartFile(tx, importId));
    if (!file) break;
    run.files += 1;
    let outcome: Outcome | string;
    try {
      outcome = await readFile(input, file, lot.useAi, privacy, today, day);
    } catch (error) {
      logFailure(error);
      outcome = "erro_interno";
    }
    if (typeof outcome !== "string") {
      const reading = outcome;
      const saved = await withHousehold(ctx, (tx) =>
        saveSmartReading(
          tx,
          {
            fileId: file.id,
            importId,
            householdId: ctx.householdId,
            ...reading,
          },
          input.maxOpenItems,
        ),
      ).then(
        (fits) => (fits ? null : "teto_itens"),
        (error: unknown) => {
          logFailure(error);
          return "erro_interno";
        },
      );
      if (saved) outcome = saved;
    }
    if (typeof outcome === "string") {
      const failure = outcome;
      await withHousehold(ctx, (tx) => failSmartFile(tx, file.id, failure));
    }
    if (typeof outcome === "string") run.failed += 1;
    else if (outcome.method === "regras") run.byRules += 1;
    else run.byModel += 1;
  }

  const plan = await withHousehold(ctx, async (tx) => {
    // Família apagada no meio da leitura: não há o que abrir, nem a quem avisar.
    const [lotNow] = await tx
      .select({ id: smartImports.id })
      .from(smartImports)
      .where(eq(smartImports.id, importId));
    if (!lotNow) return null;
    // Outro processo ainda lendo: quem acabar por último abre a revisão.
    const open = await tx
      .select({ id: smartImportFiles.id })
      .from(smartImportFiles)
      .where(
        and(
          eq(smartImportFiles.importId, importId),
          inArray(smartImportFiles.status, ["na_fila", "lendo"]),
        ),
      );
    if (open.length > 0) {
      run.remaining = true;
      run.waiting = run.files === 0;
      return null;
    }
    return prepareSmartReview(tx, ctx, importId);
  });
  if (!plan) return run;
  // Fora de transação e fora deste processo: 50 mil itens não seguram nem o banco nem o worker.
  const verdicts =
    (await planInChild({
      items: plan.refs,
      known: plan.known,
      sha: plan.sha,
      scope: plan.scope,
    })) ?? planSmartReview(plan);
  await withHousehold(ctx, async (tx) => {
    const counts = await applySmartReview(tx, ctx.householdId, plan, verdicts);
    await notifySmartImport(tx, ctx.householdId, importId, counts);
  });
  return run;
}
