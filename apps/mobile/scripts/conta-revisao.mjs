// Cria a conta de demonstração para os revisores da Apple e do Google, com dados fictícios.
// Uso (o fundador roda): node scripts/conta-revisao.mjs [endereço do site]
// A senha é gerada aqui e fica só em ~/.organizeup/conta-revisao.json (permissão 600). Não aparece na tela.
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const base = (process.argv[2] ?? "https://organizeup.crowntech.com.br").replace(/\/$/, "");
const dir = join(homedir(), ".organizeup");
const file = join(dir, "conta-revisao.json");
if (existsSync(file)) {
  console.log(`Já existe ${file}. Apague o arquivo antes de criar outra conta.`);
  process.exit(1);
}

const account = {
  name: "Ana Exemplo",
  email: "revisao.lojas@crowntech.com.br",
  password: `Rev-${randomBytes(9).toString("base64url")}-${randomInt(10, 100)}`, // letra, número e símbolo
};

const jar = new Map();
const cookie = () => [...jar.values()].join("; ");
async function call(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: { "content-type": "application/json", origin: base, cookie: cookie() },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of response.headers.getSetCookie()) {
    const value = c.split(";")[0];
    jar.set(value.split("=")[0], value);
  }
  if (!response.ok)
    throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
  return response.json();
}

await call("POST", "/api/auth/sign-up/email", {
  ...account,
  termsAccepted: true,
  identity: { inBrazil: false },
});
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(
  file,
  JSON.stringify({ site: base, email: account.email, password: account.password }, null, 2),
  {
    mode: 0o600,
  },
);

const family = await call("POST", "/api/auth/organization/create", {
  name: "Família Exemplo",
  slug: `familia-exemplo-${randomBytes(3).toString("hex")}`,
});
await call("POST", "/api/auth/organization/set-active", { organizationId: family.id });
await call("GET", "/api/mobile/v1/me"); // cria a conta e as categorias padrão
const form = await call("GET", "/api/mobile/v1/entries");
const accountId = form.accounts[0].id;
const category = (kind, name) =>
  (
    form.categories.find((c) => c.kind === kind && c.name.startsWith(name)) ??
    form.categories.find((c) => c.kind === kind)
  ).id;

const today = new Date();
const day = (d) => {
  const date = new Date(today.getFullYear(), today.getMonth(), d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const past = Math.max(1, Math.min(today.getDate(), 5));
const later = Math.min(28, today.getDate() + 4);
const entries = [
  ["receita", "Salário", "7800,00", "Salário", 1, true],
  ["despesa", "Aluguel", "2100,00", "Moradia", 1, true],
  ["despesa", "Supermercado", "642,35", "Mercado", past, true],
  ["despesa", "Conta de luz", "214,90", "Luz", past, true],
  ["receita", "Projeto extra", "1250,00", "Trabalho", past, true],
  ["despesa", "Farmácia", "86,40", "Saúde", past, true],
  ["despesa", "Combustível", "230,00", "Transporte", past, true],
  ["despesa", "Escola", "980,00", "Educação", later, false],
  ["despesa", "Internet", "119,90", "Luz", later, false],
  ["receita", "Reembolso do plano de saúde", "180,00", "Outras", 28, false],
];
for (const [kind, description, amount, cat, d, done] of entries) {
  await call("POST", "/api/mobile/v1/entries", {
    kind,
    description,
    amount,
    date: day(d),
    categoryId: category(kind, cat),
    accountId,
    done,
  });
}
console.log(
  `Conta criada: ${account.email}, família "Família Exemplo", ${entries.length} lançamentos.`,
);
console.log(`E-mail e senha guardados em ${file}.`);
