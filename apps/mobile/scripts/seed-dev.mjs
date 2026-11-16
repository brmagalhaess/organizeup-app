// Cria uma conta e uma família fictícias no servidor LOCAL, para abrir o app no simulador.
// Uso: node scripts/seed-dev.mjs [http://localhost:3100]
// A senha é sorteada e fica só em `.dev-account.json`, que o Git ignora. Recusa qualquer endereço que
// não seja desta máquina: nunca cria conta em produção.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "");
const { hostname } = new URL(base);
if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
  console.error("Só roda contra o servidor local.");
  process.exit(1);
}

const file = path.resolve(import.meta.dirname, "..", ".dev-account.json");
if (existsSync(file)) {
  const known = JSON.parse(readFileSync(file, "utf8"));
  console.log(`Conta de teste já existe: ${known.email} (senha em ${path.basename(file)}).`);
  process.exit(0);
}

const account = {
  name: "Pessoa de Teste",
  email: `app-${randomBytes(3).toString("hex")}@example.com`,
  // Só minúsculas, números e hífen: dá para digitar no simulador sem depender do Shift.
  password: `teste-${randomBytes(8).toString("hex")}`,
};

let cookie = "";
async function post(route, body) {
  const response = await fetch(`${base}/api/auth${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: JSON.stringify(body),
  });
  const set = response.headers.getSetCookie().map((item) => item.split(";")[0]);
  if (set.length > 0) cookie = set.join("; ");
  if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
  return response.json();
}

await post("/sign-up/email", {
  ...account,
  termsAccepted: true,
  // Mora fora do Brasil: sem documento, nada de CPF em ambiente de teste.
  identity: { inBrazil: false },
});
const family = await post("/organization/create", {
  name: "Família de Teste",
  slug: `familia-teste-${randomBytes(3).toString("hex")}`,
});
await post("/organization/set-active", { organizationId: family.id });

writeFileSync(file, `${JSON.stringify(account, null, 2)}\n`, { mode: 0o600 });
console.log(`Conta criada: ${account.email} (senha em ${path.basename(file)}).`);
