// Chama o processo isolado de leitura (ADR-0030). O relógio fica aqui, do lado de fora: quem trava lá dentro não
// tem como se defender. Filho sem segredos no ambiente: nem banco, nem chave. Qualquer saída que não seja o JSON
// esperado vira falha do arquivo, nunca do worker.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SMART_READ_MAX_OLD_MB,
  SMART_READ_TIMEOUT_MS,
  type SmartFileKind,
} from "@organizeup/domain";
import type { SmartReadResult } from "./read-child";

/** Saída maior que isto não é leitura de arquivo: 5.000 itens e o texto cabem com folga. */
const MAX_OUTPUT_BYTES = 48 * 1024 * 1024;

/** No bundle do worker, o filho é um arquivo ao lado. Na fonte, roda pelo tsx. */
function childArgs(): string[] {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  if (!here.endsWith(".ts")) return [path.join(dir, "smart-read-child.js")];
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

export interface SmartReadInput {
  kind: SmartFileKind;
  year: number;
  bytes: Uint8Array;
  timeoutMs?: number;
}

export function readInChild(input: SmartReadInput): Promise<SmartReadResult> {
  const { kind, year, bytes, timeoutMs = SMART_READ_TIMEOUT_MS } = input;
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${SMART_READ_MAX_OLD_MB}`, ...childArgs()],
      { stdio: ["pipe", "pipe", "ignore"], env: childEnv(), windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = (result: SmartReadResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(result);
    };
    const timer = setTimeout(() => done({ ok: false, failure: "demorado" }), timeoutMs);
    child.on("error", () => done({ ok: false, failure: "isolamento" }));
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) done({ ok: false, failure: "bomba" });
      else chunks.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        // Morreu sem responder: pela memória, do jeito dele ou do V8.
        done({ ok: false, failure: "bomba" });
        return;
      }
      try {
        done(JSON.parse(Buffer.concat(chunks).toString("utf8")) as SmartReadResult);
      } catch {
        done({ ok: false, failure: "ilegivel" });
      }
    });
    const header = Buffer.from(JSON.stringify({ kind, year }));
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(header.length, 0);
    child.stdin.write(prefix);
    child.stdin.write(header);
    child.stdin.end(Buffer.from(bytes));
  });
}
