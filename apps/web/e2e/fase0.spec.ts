// Critério de pronto da Fase 0: cadastro → criar família → gravar e ler dados → isolamento.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const password = "senha-segura-123";

function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function signUpAndCreateFamily(page: Page, name: string, family: string) {
  const email = uniqueEmail(name.toLowerCase());
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);

  await page.getByLabel("Nome da família").fill(family);
  await page.getByLabel("Cidade onde moram").fill("Campinas");
  await page.getByLabel("UF").fill("sp");
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: family })).toBeVisible();
  return email;
}

test("health devolve o commit e o estado do banco", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.commit).toBeTruthy();
  expect(body.db.schemaVersion).toMatch(/^\d{4}_/);
});

test("ops api exige token", async ({ request }) => {
  const res = await request.get("/api/ops/deployments");
  expect(res.status()).toBe(401);
});

test("fluxo da família e isolamento entre famílias", async ({ page, browser }) => {
  const family = `Família Teste ${Date.now()}`;
  const email = await signUpAndCreateFamily(page, "Ana", family);

  const list = page.getByRole("list", { name: "Pessoas da família" });
  await expect(list.getByText("Ana")).toBeVisible();
  await expect(list.getByText("Titular")).toBeVisible();
  await expect(page.getByText("Campinas/SP")).toBeVisible();

  await page.getByLabel("Nome", { exact: true }).fill("Maria Segredo");
  await page.getByLabel("Relação").selectOption("conjuge");
  await page.getByLabel("Nascimento").fill("1990-06");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(list.getByText("Maria Segredo")).toBeVisible();

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // Sair e entrar de novo volta para a mesma família.
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText("Maria Segredo")).toBeVisible();

  // Outra pessoa, outra família: não enxerga nada da primeira.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUpAndCreateFamily(page2, "Beto", `Família Beto ${Date.now()}`);
  await expect(page2.getByText("Maria Segredo")).toHaveCount(0);
  await expect(page2.getByText(family)).toHaveCount(0);
  await other.close();
});
