// Aporte fora de "Despesas" (ADR-0027): painel, Lançamentos, Categorias, Calendário e relatório batem, em
// computador e em 375 px, em português e inglês, com axe. Rode com E2E_375=1 para a largura de 375 px.
// Precisa de E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL. Com E2E_SHOTS_DIR, grava as telas.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { newCpf } from "./documents";

const shots = process.env.E2E_SHOTS_DIR;
const workerUrl = process.env.E2E_WORKER_DATABASE_URL ?? "";
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const password = "senha-segura-123!";
const unique = () => `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

const previousMonth = () => {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return new Date(Date.UTC(today.getFullYear(), today.getMonth() - 1, 15))
    .toISOString()
    .slice(0, 7);
};

async function signUp(page: Page, family: string, english: boolean) {
  await page.goto(english ? "/cadastro?lang=en" : "/cadastro");
  await page.getByLabel(english ? "Your name" : "Seu nome").fill("Bia");
  if (!english) await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel(english ? "Email" : "E-mail").fill(`aporte.${unique()}@example.com`);
  await page.getByLabel(english ? "Password" : "Senha", { exact: true }).fill(password);
  await page.getByLabel(english ? "Confirm password" : "Confirmar senha").fill(password);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: english ? "Create account" : "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel(english ? "Family name" : "Nome da família").fill(family);
  await page.getByRole("button", { name: english ? "Create family" : "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

function seed(family: string) {
  execFileSync(process.execPath, ["--import", "tsx", "apps/web/e2e/aporte-separado.ts", family], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: workerUrl },
    stdio: "pipe",
  });
}

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/.+/);
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string, project: string) {
  if (!shots) return;
  await page.screenshot({
    path: path.join(shots, `aporte-${name}-${project}.png`),
    fullPage: true,
  });
}

const total = (page: Page, label: string) =>
  page
    .locator("dl > div")
    .filter({ has: page.locator("dt").getByText(label, { exact: true }) })
    .locator("dd")
    .first();

test.skip(!workerUrl, "Defina E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL.");

const narrow = async (page: Page, project: string) => {
  if (project === "desktop") return;
  await page.setViewportSize({ width: 375, height: 812 });
};

test("em português: aporte e resgate à parte, batendo em todas as telas", async ({
  page,
}, info) => {
  await narrow(page, info.project.name);
  const family = `Aporte ${unique()}`;
  await signUp(page, family, false);
  seed(family);
  const month = previousMonth();

  await page.goto(`/app?mes=${month}`);
  await expect(page.getByText(/guardar dinheiro não é gasto/)).toBeVisible();
  await expect(total(page, "Receitas")).toContainText("9.200,00");
  await expect(total(page, "Despesas")).toContainText("2.000,00");
  await expect(total(page, "Resultado")).toContainText("7.200,00");
  await expect(total(page, "Aportado")).toContainText("2.000,00");
  await expect(total(page, "Aportado")).toContainText("Não entra em despesas");
  await expect(total(page, "Sobrou depois de aportar")).toContainText("5.200,00");
  await expect(total(page, "Voltou para as contas")).toContainText("300,00");
  await expect(page.getByRole("list", { name: "Despesas" })).not.toContainText("Aportes");
  await expect(page.getByRole("list", { name: "Receitas" })).not.toContainText("Aportes");
  await expect(page.getByRole("list", { name: "Aportes" })).toContainText(
    "Aportes e investimentos",
  );
  await expectAccessible(page);
  await shot(page, "painel", info.project.name);

  // A nota aparece uma vez: fechada, não volta.
  await page.getByRole("button", { name: "Entendi" }).click();
  await expect(page.getByText(/guardar dinheiro não é gasto/)).toBeHidden();
  await page.reload();
  await expect(total(page, "Aportado")).toBeVisible();
  await expect(page.getByText(/guardar dinheiro não é gasto/)).toBeHidden();

  await page.goto(`/app/lancamentos?m=${month}`);
  await expect(total(page, "Receitas")).toContainText("9.200,00");
  await expect(total(page, "Despesas")).toContainText("2.000,00");
  await expect(total(page, "Aportado")).toContainText("2.000,00");
  await expect(total(page, "Sobrou depois de aportar")).toContainText("5.200,00");
  await expect(total(page, "Voltou para as contas")).toContainText("300,00");
  const line = page.getByRole("row").filter({ hasText: "Aporte em CDB de teste" }).first();
  await expect(line).toContainText("Aporte");
  await expect(page.getByRole("row").filter({ hasText: "Resgate de CDB" })).toContainText(
    "Resgate",
  );
  await page.getByLabel("Tipo").selectOption("aporte");
  await expect(page.getByRole("row").filter({ hasText: "Supermercado" })).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "Aporte em CDB" })).toHaveCount(2);
  await expectAccessible(page);
  await shot(page, "lancamentos", info.project.name);

  await page.goto(`/app/relatorios?tipo=resumo&periodo=${month}`);
  await expect(total(page, "Despesas")).toContainText("2.000,00");
  await expect(total(page, "Aportado")).toContainText("2.000,00");
  await expect(total(page, "Sobrou depois de aportar")).toContainText("5.200,00");
  await expect(total(page, "Voltou para as contas")).toContainText("300,00");
  await expect(page.getByText(/ficam fora de receitas e despesas/)).toBeVisible();
  await expectAccessible(page);
  await shot(page, "relatorio", info.project.name);

  await page.goto(`/app/relatorios?tipo=categorias&periodo=${month}`);
  await expect(total(page, "Total de gastos")).toContainText("2.000,00");
  await expect(page.getByRole("heading", { name: "Aportes por categoria" })).toBeVisible();

  await page.goto(`/app/calendario?m=${month}`);
  await expect(total(page, "Despesas")).toContainText("2.000,00");
  await expect(total(page, "Aportes")).toContainText("2.000,00");
  await expectAccessible(page);

  await page.goto("/app/categorias");
  await expect(page.getByText("Fora de despesas").first()).toBeVisible();
  await expectAccessible(page);

  // Aporte que vai para a reserva conta como investimento: a divisão diz isso e mostra o caminho.
  await page.goto("/app/aposentadoria");
  await expect(page.getByText(/contam como investimento, mesmo que o dinheiro vá/)).toBeVisible();
  const toReserve = page.getByRole("main").getByRole("link", { name: "Reserva", exact: true });
  await expect(toReserve).toHaveAttribute("href", "/app/reserva");
  await expectAccessible(page);
  await shot(page, "aposentadoria", info.project.name);
});

test("em inglês, com os mesmos números", async ({ page }, info) => {
  await narrow(page, info.project.name);
  const family = `Contribution ${unique()}`;
  await signUp(page, family, true);
  seed(family);
  const month = previousMonth();

  await page.goto(`/app?mes=${month}`);
  await expect(page.getByText(/saving money is not spending/)).toBeVisible();
  await expect(total(page, "Income")).toContainText("9,200.00");
  await expect(total(page, "Expenses")).toContainText("2,000.00");
  await expect(total(page, "Contributed")).toContainText("2,000.00");
  await expect(total(page, "Left after contributing")).toContainText("5,200.00");
  await expect(total(page, "Back in your accounts")).toContainText("300.00");
  await expectAccessible(page);
  await shot(page, "painel-en", info.project.name);

  await page.goto(`/app/lancamentos?m=${month}`);
  await expect(total(page, "Contributed")).toContainText("2,000.00");
  await expect(page.getByRole("row").filter({ hasText: "CDB de teste" }).first()).toContainText(
    "Contribution",
  );
  await expectAccessible(page);

  await page.goto(`/app/relatorios?tipo=resumo&periodo=${month}`);
  await expect(total(page, "Left after contributing")).toContainText("5,200.00");
  await expectAccessible(page);
  await shot(page, "relatorio-en", info.project.name);
});
