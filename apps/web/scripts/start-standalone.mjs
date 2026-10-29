// Inicia o build `output: "standalone"` localmente (o Dockerfile faz o mesmo layout).
// Copia .next/static e public para dentro do standalone e executa server.js.
import { cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const standaloneApp = path.join(".next", "standalone", "apps", "web");
if (!existsSync(path.join(standaloneApp, "server.js"))) {
  console.error(
    "Build standalone não encontrado. Rode `pnpm --filter @organizeup/web build` antes.",
  );
  process.exit(1);
}
await cp(path.join(".next", "static"), path.join(standaloneApp, ".next", "static"), {
  recursive: true,
});
if (existsSync("public")) {
  await cp("public", path.join(standaloneApp, "public"), { recursive: true });
}
process.chdir(standaloneApp);
await import(pathToFileURL(path.resolve("server.js")).href);
