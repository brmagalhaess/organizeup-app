// Central de notificações: o que o agente mudou sozinho, em computador e em 375 px. Precisa de
// E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL, do mesmo banco do servidor: quem grava é o agente de
// verdade, por e2e/agente-categorias.ts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { newCpf } from "./documents";

const shots = process.env.E2E_SHOTS_DIR;
const workerUrl = process.env.E2E_WORKER_DATABASE_URL ?? "";
test.skip(!workerUrl, "Defina E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL.");

const password = "senha-segura-123!";
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

/** Roda o agente como na madrugada, ou troca o papel da família. */
function agent(...args: string[]) {
  execFileSync(
    process.execPath,
    ["--import", "tsx", "apps/web/e2e/agente-categorias.ts", ...args],
    { cwd: repoRoot, env: { ...process.env, DATABASE_URL: workerUrl }, stdio: "pipe" },
  );
}

async function signUp(page: Page, family: string) {
  const email = `notif.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Bia");
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Nome da família").fill(family);
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

const bell = (page: Page) =>
  page.getByRole("link", { name: /^Notificações/ }).locator("visible=true");

async function expectAccessible(page: Page) {
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("o agente muda, a família vê o antes e o depois e desfaz", async ({ page }) => {
  const family = `Família Notif ${Date.now()}-${test.info().project.name}`;
  await signUp(page, family);

  // Primeiro uso: nada ainda.
  await expect(bell(page)).toHaveAccessibleName("Notificações");
  await bell(page).click();
  await expect(page).toHaveURL(/\/app\/notificacoes$/);
  await expect(page.getByRole("heading", { level: 1, name: "Notificações" })).toBeVisible();
  await expect(page.getByText("Nenhuma notificação por enquanto")).toBeVisible();
  await expect(page.getByRole("button", { name: "Marcar todas como lidas" })).toBeHidden();
  await expectAccessible(page);

  agent("rodar", family, "SUPERMERCADO BOM PRECO", "123.45");
  await page.reload();
  await expect(bell(page)).toHaveAccessibleName("Notificações, 1 não lida");
  const change = "Outras despesas → Mercado";
  await expect(page.getByText(change, { exact: true })).toBeVisible();
  await expect(page.getByText(/supermercado bom preco: 1 lançamento, R\$\s?123,45/)).toBeVisible();
  await expectAccessible(page);
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-lista.png` });

  // Em 375 px, com o sininho no topo e sem transbordar.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByText(change, { exact: true })).toBeVisible();
  await expect(bell(page)).toBeVisible();
  await expectAccessible(page);
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-375.png` });

  // Abrir a tela não marca nada.
  await page.reload();
  await expect(bell(page)).toHaveAccessibleName("Notificações, 1 não lida");

  // Desfazer volta, mostra que foi desfeito e também não marca como lida.
  await page.getByRole("button", { name: `Desfazer: ${change}` }).click();
  await expect(page.getByText("Desfeito", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Desfazer: ${change}` })).toBeHidden();
  await expect(bell(page)).toHaveAccessibleName("Notificações, 1 não lida");

  // Filtros e marcar todas.
  const filters = page.getByRole("navigation", { name: "Filtrar notificações" });
  await filters.getByRole("link", { name: "Lidas", exact: true }).click();
  await expect(page).toHaveURL(/filtro=lidas$/);
  await expect(page.getByText("Nada lido ainda")).toBeVisible();
  await filters.getByRole("link", { name: "Não lidas", exact: true }).click();
  await expect(page.getByText(change, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Marcar todas como lidas" }).click();
  await expect(page.getByText("Nada novo por aqui")).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName("Notificações");
  await filters.getByRole("link", { name: "Lidas", exact: true }).click();
  await expect(page.getByText(change, { exact: true })).toBeVisible();
  await expectAccessible(page);

  // Desfeito não volta: outra rodada, com outro lançamento do mesmo lugar, não muda nem avisa.
  agent("rodar", family, "SUPERMERCADO BOM PRECO", "10.00");
  await page.reload();
  await expect(bell(page)).toHaveAccessibleName("Notificações");

  // Quem só vê lê, mas não desfaz nem marca.
  agent("rodar", family, "FARMACIA SAO JOAO", "45.00");
  agent("so-ver", family);
  await page.goto("/app/notificacoes");
  await expect(page.getByText("Outras despesas → Saúde", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Desfazer/ })).toBeHidden();
  await expect(page.getByRole("button", { name: "Marcar todas como lidas" })).toBeHidden();
  await expect(bell(page)).toHaveAccessibleName("Notificações, 1 não lida");
  await expectAccessible(page);
});

test("o texto vem dos dados e sai no idioma da pessoa", async ({ page, context }) => {
  const family = `Família Idioma ${Date.now()}-${test.info().project.name}`;
  await signUp(page, family);
  agent("rodar", family, "SUPERMERCADO BOM PRECO", "1234.50");
  await context.addCookies([
    { name: "organizeup_locale", value: "es", url: new URL(page.url()).origin },
  ]);
  await page.goto("/app/notificacoes");
  await expect(page.getByRole("heading", { level: 1, name: "Notificaciones" })).toBeVisible();
  await expect(page.locator("main")).not.toHaveAttribute("lang", "pt-BR");
  await expect(page.getByText(/supermercado bom preco: 1 movimiento/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Deshacer: / })).toBeVisible();
  await expectAccessible(page);
});
