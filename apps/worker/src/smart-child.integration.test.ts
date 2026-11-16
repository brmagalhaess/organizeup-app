// O filho que abre arquivo, como vai para produção: montado pelo esbuild e com o modelo de permissão do Node. Na fonte
// ele roda sem permissões (o tsx precisa gravar cache e abrir o esbuild), então é aqui que elas valem (ADR-0030).
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { childEnv, permissionFlags } from "../../../packages/ai/src/importador/read-sandbox";

// Caminho real: no macOS a pasta temporária fica atrás de um link (/var → /private/var), e o modelo de permissão
// libera só o caminho que recebeu. Sem isto o filho não consegue ler nem o próprio código.
const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "filho-"));
const script = path.join(dir, "smart-read-child.js");
const secret = path.join(dir, "..", `segredo-${process.pid}.txt`);

function run(bytes: Buffer, header: object) {
  const encoded = Buffer.from(JSON.stringify({ oldMb: 256, rssMb: 640, ...header }));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(encoded.length, 0);
  const result = spawnSync(
    process.execPath,
    ["--max-old-space-size=256", ...permissionFlags([script]), script],
    { input: Buffer.concat([prefix, encoded, bytes]), timeout: 60_000, env: childEnv() },
  );
  return { status: result.status, output: result.stdout?.toString() ?? "" };
}

/** Roda um script qualquer com as mesmas permissões: é o que um código malicioso teria. */
function attack(code: string) {
  const file = path.join(dir, "ataque.cjs");
  writeFileSync(file, code);
  const result = spawnSync(process.execPath, [...permissionFlags([script, file]), file], {
    timeout: 20_000,
    env: childEnv(),
  });
  return result.stdout?.toString().trim() ?? "";
}

beforeAll(async () => {
  writeFileSync(secret, "segredo");
  await build({
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    logLevel: "silent",
    entryPoints: ["../../packages/ai/src/importador/read-child.ts"],
    outfile: script,
  });
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(secret, { force: true });
});

const STREAM = "BT /F1 12 Tf 72 720 Td (Extrato Exemplo) Tj ET";
const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${STREAM.length}>>stream
${STREAM}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

describe("filho montado, com permissões", () => {
  it("lê PDF e texto com só o próprio arquivo liberado", () => {
    const pdf = run(Buffer.from(PDF), { mode: "read", kind: "pdf", year: 2026 });
    expect(pdf.status).toBe(0);
    expect(JSON.parse(pdf.output)).toMatchObject({ ok: true, pages: 1 });
    const csv = run(Buffer.from("data;descricao;valor\n01/10/2026;PADARIA;-10,00\n"), {
      mode: "read",
      kind: "csv",
      year: 2026,
    });
    expect(JSON.parse(csv.output)).toMatchObject({ ok: true });
  }, 60_000);

  it("compara o lote lá dentro", () => {
    const body = Buffer.from(
      JSON.stringify({
        items: [],
        known: {
          realized: [],
          forecasts: [],
          purchases: [],
          holdings: [],
          debts: [],
          incomes: [],
          plans: [],
          goals: [],
          dividendHoldings: [],
          dividendEvents: [],
          dividendBlocked: [],
          today: "2026-11-02",
          documents: {},
        },
        shaOf: [],
        scope: [],
      }),
    );
    const plan = run(body, { mode: "plan" });
    expect(plan.status).toBe(0);
    expect(JSON.parse(plan.output)).toMatchObject({ ok: true });
  }, 30_000);

  it("bomba morre no limite, sem levar o pai", () => {
    const bomb = Buffer.concat([
      Buffer.from("%PDF-1.4\n1 0 obj<</Filter/FlateDecode>>stream\n"),
      deflateSync(Buffer.alloc(512 * 1024 * 1024)),
      Buffer.from("\nendstream endobj\n%%EOF"),
    ]);
    const result = run(bomb, { mode: "read", kind: "pdf", year: 2026 });
    expect(result.output.includes('"ok":true')).toBe(false);
  }, 90_000);

  it("não lê arquivo de fora, não grava e não abre processo", () => {
    expect(
      attack(`const fs = require("node:fs");
try { console.log(fs.readFileSync(${JSON.stringify(secret)}, "utf8")); } catch (e) { console.log(e.code); }`),
    ).toBe("ERR_ACCESS_DENIED");
    expect(
      attack(`const fs = require("node:fs");
try { fs.writeFileSync(${JSON.stringify(`${secret}.novo`)}, "x"); console.log("gravou"); } catch (e) { console.log(e.code); }`),
    ).toBe("ERR_ACCESS_DENIED");
    expect(
      attack(`const { spawnSync } = require("node:child_process");
try { const r = spawnSync("whoami"); console.log(r.error ? r.error.code : "abriu"); } catch (e) { console.log(e.code); }`),
    ).toBe("ERR_ACCESS_DENIED");
  }, 30_000);

  it("ambiente sem banco nem chave do modelo", () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://exemplo";
    process.env.ANTHROPIC_API_KEY = "chave-de-teste";
    const env = childEnv();
    expect(Object.keys(env)).not.toContain("DATABASE_URL");
    expect(Object.keys(env)).not.toContain("ANTHROPIC_API_KEY");
    expect(Object.keys(env)).not.toContain("ADMIN_DATABASE_URL");
    delete process.env.ANTHROPIC_API_KEY;
  });
});
