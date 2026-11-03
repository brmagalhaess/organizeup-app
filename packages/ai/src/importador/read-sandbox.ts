// Chama o processo isolado (ADR-0030): abrir arquivo e comparar lote. O relógio fica aqui, do lado de fora: quem
// trava lá dentro não tem como se defender. Filho sem segredos no ambiente, e com o modelo de permissão do Node: lê
// só o próprio código, não escreve, não abre processo. Rede o Node 24 não sabe bloquear: lá dentro não há código
// que a use nem credencial a roubar, e fechar de verdade pede rede do contêiner, ver o ADR.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SMART_PLAN_MAX_OLD_MB,
  SMART_PLAN_MAX_RSS_MB,
  SMART_PLAN_TIMEOUT_MS,
  SMART_READ_MAX_OLD_MB,
  SMART_READ_MAX_RSS_MB,
  SMART_READ_TIMEOUT_MS,
  type SmartFileKind,
  type SmartVerdict,
} from "@organizeup/domain";
import type { SmartPlanRequest, SmartPlanResult, SmartReadResult } from "./read-child";

/** Saída maior que isto não é leitura de arquivo: 5.000 itens e o texto cabem com folga. */
const MAX_OUTPUT_BYTES = 48 * 1024 * 1024;

/** Permissões do filho. Sem `--allow-child-process` e sem escrita; `--allow-worker` é a thread de leitura. */
export function permissionFlags(reads: string[]): string[] {
  return ["--permission", ...reads.map((target) => `--allow-fs-read=${target}`), "--allow-worker"];
}

/**
 * No bundle do worker, o filho é um arquivo ao lado, e só ele pode ser lido. Na fonte (dev e testes) não há modelo de
 * permissão: o tsx grava cache e abre o esbuild, que é justamente o que o filho não pode. Produção roda sempre o bundle,
 * e o teste do worker prova as permissões nele.
 */
function childArgs(): string[] {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  if (!here.endsWith(".ts")) {
    const script = path.join(dir, "smart-read-child.js");
    return [...permissionFlags([script]), script];
  }
  const tsx = createRequire(import.meta.url).resolve("tsx");
  return ["--import", pathToFileURL(tsx).href, path.join(dir, "read-child.ts")];
}

/** O mínimo para o Node subir. Nada de DATABASE_URL nem ANTHROPIC_API_KEY. */
export function childEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE"];
  return {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    ...Object.fromEntries(
      keep.flatMap((key) => {
        const value = process.env[key];
        return value === undefined ? [] : [[key, value]];
      }),
    ),
  };
}

interface ChildCall<T> {
  header: Record<string, unknown>;
  body: Buffer;
  timeoutMs: number;
  oldMb: number;
  rssMb: number;
  /** Morreu pelo relógio, pela memória ou sem resposta válida. */
  failed: (reason: "tempo" | "memoria" | "saida" | "isolamento") => T;
}

function callChild<T>({ header, body, timeoutMs, oldMb, rssMb, failed }: ChildCall<T>): Promise<T> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`--max-old-space-size=${oldMb}`, ...childArgs()], {
      stdio: ["pipe", "pipe", "ignore"],
      env: childEnv(),
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = (result: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(result);
    };
    const timer = setTimeout(() => done(failed("tempo")), timeoutMs);
    child.on("error", () => done(failed("isolamento")));
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) done(failed("memoria"));
      else chunks.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        done(failed("memoria"));
        return;
      }
      try {
        done(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch {
        done(failed("saida"));
      }
    });
    const encoded = Buffer.from(JSON.stringify({ ...header, oldMb, rssMb }));
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(encoded.length, 0);
    child.stdin.write(prefix);
    child.stdin.write(encoded);
    child.stdin.end(body);
  });
}

export interface SmartReadInput {
  kind: SmartFileKind;
  year: number;
  bytes: Uint8Array;
  timeoutMs?: number;
}

export function readInChild(input: SmartReadInput): Promise<SmartReadResult> {
  const { kind, year, bytes, timeoutMs = SMART_READ_TIMEOUT_MS } = input;
  const failures = {
    tempo: "demorado",
    memoria: "bomba",
    saida: "ilegivel",
    isolamento: "isolamento",
  } as const;
  return callChild<SmartReadResult>({
    header: { mode: "read", kind, year },
    body: Buffer.from(bytes),
    timeoutMs,
    oldMb: SMART_READ_MAX_OLD_MB,
    rssMb: SMART_READ_MAX_RSS_MB,
    failed: (reason) => ({ ok: false, failure: failures[reason] }),
  });
}

/** A comparação do lote, fora do processo do worker. Null: não deu, e quem chama compara aqui mesmo. */
export async function planInChild(
  request: SmartPlanRequest,
  timeoutMs = SMART_PLAN_TIMEOUT_MS,
): Promise<Map<string, SmartVerdict> | null> {
  const result = await callChild<SmartPlanResult>({
    header: { mode: "plan" },
    body: Buffer.from(JSON.stringify(request)),
    timeoutMs,
    oldMb: SMART_PLAN_MAX_OLD_MB,
    rssMb: SMART_PLAN_MAX_RSS_MB,
    failed: () => ({ ok: false }),
  });
  return result.ok ? new Map(result.verdicts) : null;
}
