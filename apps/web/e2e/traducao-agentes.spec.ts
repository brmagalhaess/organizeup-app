// Fase 3 da tradução, de ponta a ponta em inglês: entrar pela landing em inglês, Sugestões, Notificações e
// o lançamento gerado por aporte. Duas pessoas, mesma linha: quem escolheu português vê em português.
// Precisa de E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL, do mesmo banco do servidor: quem grava é o
// agente de verdade, por e2e/traducao-agentes.ts. Com E2E_SHOTS_DIR, grava as telas em 375 px.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

const shots = process.env.E2E_SHOTS_DIR;
const workerUrl = process.env.E2E_WORKER_DATABASE_URL ?? "";
test.skip(!workerUrl, "Defina E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL.");

const password = "senha-segura-123!";
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const unique = () => `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

function nightRun(family: string) {
  execFileSync(process.execPath, ["--import", "tsx", "apps/web/e2e/traducao-agentes.ts", family], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: workerUrl },
    stdio: "pipe",
  });
}

async function expectAccessible(page: Page) {
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string, projectName: string) {
  if (!shots || projectName !== "mobile") return;
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
}

test("inglês de ponta a ponta, e português para quem escolheu", async ({ page }, info) => {
  const family = `Traducao ${unique()}`;
  const email = `traducao.${unique()}@example.com`;

  // Sem cookie: quem chega em /en e cria a conta segue em inglês.
  await page.goto("/en");
  await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
  await expect(page).toHaveURL(/\/entrar\?lang=en$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/en");
  await page
    .getByRole("link", { name: /Start|Create|Sign up/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/cadastro\?lang=en$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.getByLabel("Your name").fill("Bia");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByLabel("Family name").fill(family);
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/app$/);

  nightRun(family);
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });

  await page.goto("/app/sugestoes");
  await expect(page.getByRole("heading", { level: 2, name: "For you to decide" })).toBeVisible();
  // Sugestão por chave, no idioma da pessoa e sem marca de português.
  const reminder = page.getByText("Enter your portfolio's annual yield", { exact: true });
  await expect(reminder).toBeVisible();
  await expect(reminder).not.toHaveAttribute("lang", "pt-BR");
  // O que o agente fez sozinho, com o nome padrão da categoria traduzido.
  await expect(
    page.getByText(/We moved 1 entry from ‘Other expenses’ to ‘Groceries’/),
  ).toBeVisible();
  // Linha antiga, sem chave: aparece como foi gravada e marcada como português.
  await expect(page.getByText("Texto antigo gravado em português")).toHaveAttribute(
    "lang",
    "pt-BR",
  );
  await expectAccessible(page);
  await shot(page, "sugestoes-en", info.project.name);

  await page.goto("/app/notificacoes");
  await expect(page.getByText("Other expenses → Groceries")).toBeVisible();
  await expect(page.getByText(/1 entry, R\$80\.00/)).toBeVisible();
  await expect(page.getByText("Aviso antigo em português")).toHaveAttribute("lang", "pt-BR");
  await expectAccessible(page);
  await shot(page, "notificacoes-en", info.project.name);

  await page.goto("/app/lancamentos");
  await expect(page.getByText("Contribution to PETR4").locator("visible=true")).toBeVisible();
  await expect(page.getByText("Contributions and investments").first()).toBeAttached();
  await expect(page.getByText("Main account").first()).toBeAttached();
  await expectAccessible(page);
  await shot(page, "lancamentos-en", info.project.name);

  // A mesma família em português: a linha é a mesma, e o texto volta a ser o de sempre.
  await page.goto("/app/configuracoes");
  await page.getByLabel("Language", { exact: true }).selectOption("pt-BR");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await page.goto("/app/sugestoes");
  await expect(
    page.getByText("Informe o rendimento anual da carteira", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Movemos 1 lançamento de ‘Outras despesas’ para ‘Mercado’/),
  ).toBeVisible();
  await page.goto("/app/lancamentos");
  await expect(page.getByText("Aporte em PETR4").locator("visible=true")).toBeVisible();
});
