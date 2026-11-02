// O agente `importador` (ADR-0030): lê um lote, um arquivo por vez. Regras primeiro; modelo só no que elas
// não entendem, com o portão aberto, sempre fora de `withHousehold`. Falha em um arquivo não para os outros.
// Só nasce rascunho: nada vai para o cadastro sem a aprovação na tela (regra 7). No log, só contagens.
import {
  claimSmartFile,
  failSmartFile,
  notifySmartImport,
  priorSmartReading,
  reviewSmartImport,
  saveSmartReading,
  startSmartImport,
} from "@organizeup/agents";
import {
  and,
  eq,
  householdTimezone,
  inArray,
  smartImportFiles,
  withHousehold,
  type TenantContext,
} from "@organizeup/db";
import {
  recognizeSmartFile,
  smartKindOf,
  todayIn,
  type SmartFileKind,
  type SmartReading,
  type SmartRecognizer,
} from "@organizeup/domain";
import { aiLimits, serviceDay, type AiLimits } from "../access";
import { errorCode, reportFailure } from "../api-errors";
import type { ModelClient } from "../client";
import { usageOf } from "../models";
import { loadPrivacyFilter, type PrivacyFilter } from "../privacy";
import { recordUsage } from "../usage";
import { importerGate } from "./gate";
import { openSmartFile, type OpenedFile } from "./read-file";
import { answerOfMessage, IMPORTER_ROUTE, smartBlock, smartRequest } from "./reader";

export interface SmartImportInput {
  ctx: TenantContext;
  /** Null sem chave: o portão fecha antes de usar. */
  client: ModelClient | null;
  importId: string;
  limits?: AiLimits;
  day?: string;
  recognizers?: SmartRecognizer[];
}

export interface SmartImportRun {
  files: number;
  byRules: number;
  byModel: number;
  failed: number;
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
  opened: OpenedFile,
  bytes: Uint8Array,
  privacy: PrivacyFilter,
  today: string,
  day: string,
): Promise<Outcome | string> {
  const { ctx, client, limits = aiLimits() } = input;
  const gate = await importerGate({ ctx, limits, day });
  if (gate !== "pronto" || !client) return gate === "pronto" ? "sem_chave" : gate;
  const prepared = smartBlock(opened.contents, bytes, opened.pages, privacy);
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
  const opened = await openSmartFile(kind, file.content, Number(today.slice(0, 4)));
  if (typeof opened === "string") return opened;
  const recognized = recognizeSmartFile(opened.contents, input.recognizers);
  if (recognized) {
    return { reading: withDocument(recognized), method: "regras", truncated: false };
  }
  // Mesmo arquivo já lido em outro lote: a família não paga duas vezes.
  const prior = await withHousehold(input.ctx, (tx) => priorSmartReading(tx, file.sha256, file.id));
  if (prior) {
    const { truncated, ...reading } = prior;
    return { reading, method: "modelo", truncated };
  }
  if (!useAi) return "precisa_ia";
  return readWithModel(input, opened, file.content, privacy, today, day);
}

/** Sem mensagem: ela pode trazer conteúdo do arquivo. */
function logFailure(error: unknown) {
  const { name, code } = error as { name?: string; code?: string };
  console.error(JSON.stringify({ level: "error", msg: "smart_import_file_failed", name, code }));
}

/** Roda até acabar os arquivos. Repetir não refaz o que está pronto. Lança só se o banco falhar. */
export async function runSmartImport(input: SmartImportInput): Promise<SmartImportRun | null> {
  const { ctx, importId, day = serviceDay() } = input;
  const started = await withHousehold(ctx, async (tx) => {
    const lot = await startSmartImport(tx, importId);
    if (!lot) return null;
    return {
      lot,
      privacy: await loadPrivacyFilter(tx, ctx.householdId),
      today: todayIn(await householdTimezone(tx, ctx.householdId)),
    };
  });
  if (!started) return null;
  const { lot, privacy, today } = started;
  const run: SmartImportRun = { files: 0, byRules: 0, byModel: 0, failed: 0 };
  const fresh = new Set<string>();

  for (;;) {
    const file = await withHousehold(ctx, (tx) => claimSmartFile(tx, importId));
    if (!file) break;
    run.files += 1;
    fresh.add(file.id);
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
        saveSmartReading(tx, {
          fileId: file.id,
          importId,
          householdId: ctx.householdId,
          ...reading,
        }),
      ).then(
        () => true,
        (error: unknown) => {
          logFailure(error);
          return false;
        },
      );
      if (!saved) outcome = "erro_interno";
    }
    if (typeof outcome === "string") {
      const failure = outcome;
      await withHousehold(ctx, (tx) => failSmartFile(tx, file.id, failure));
    }
    if (typeof outcome === "string") run.failed += 1;
    else if (outcome.method === "regras") run.byRules += 1;
    else run.byModel += 1;
  }

  await withHousehold(ctx, async (tx) => {
    // Outro processo ainda lendo: quem acabar por último abre a revisão.
    const open = await tx
      .select({ id: smartImportFiles.id })
      .from(smartImportFiles)
      .where(
        and(
          eq(smartImportFiles.importId, importId),
          inArray(smartImportFiles.status, ["na_fila", "lendo"]),
        ),
      )
      .limit(1);
    if (open.length > 0) return;
    const counts = await reviewSmartImport(tx, importId, fresh);
    await notifySmartImport(tx, ctx.householdId, importId, counts);
  });
  return run;
}
