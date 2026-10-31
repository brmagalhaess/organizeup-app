// Painel do serviço: administrador abre; qualquer outro usuário recebe 404.
// Precisa de E2E_ADMIN_EMAIL e do servidor no ar com ADMIN_EMAILS igual a esse valor.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "";
const password = "senha-segura-123";

test.skip(!adminEmail, "Defina E2E_ADMIN_EMAIL e suba o servidor com ADMIN_EMAILS igual.");

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
}

/**
 * Único usuário fixo da suíte: a lista de administradores é por e-mail, então ele não pode ser
 * único por execução. Num banco novo ainda não existe e é cadastrado; depois, entra com a senha.
 */
async function signInAsAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const outcome = await Promise.race([
    page.waitForURL(/\/app(\/|$)/).then(() => "entrou" as const),
    page
      .getByText("E-mail ou senha incorretos.")
      .waitFor()
      .then(() => "sem conta" as const),
  ]);
  if (outcome === "sem conta") await signUp(page, "Admin", adminEmail);
}

async function expectAccessible(page: Page) {
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
}

test("administrador abre o painel e a lista de famílias", async ({ page }) => {
  await signInAsAdmin(page);

  const response = await page.goto("/admin");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Painel do serviço" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agentes diários" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saúde" })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Famílias", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/familias$/);
  await expect(
    page.getByText("Dados pessoais mínimos para suporte; cada acesso é registrado."),
  ).toBeVisible();
  await expectAccessible(page);
});

test("usuário comum recebe 404 no painel", async ({ page }) => {
  const unique = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  await signUp(page, "Comum", `comum.${unique}@example.com`);

  for (const path of ["/admin", "/admin/familias"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Painel do serviço" })).toHaveCount(0);
  }
});
