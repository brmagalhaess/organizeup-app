// Idiomas (ADR-0020): escolha na conta e no cookie, detecção pelo navegador, telas traduzidas e
// fallback para o português nas que ainda não foram.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { newCpf } from "./documents";

const password = "senha-segura-123!";

function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function signUpAndCreateFamily(page: Page, name: string) {
  const email = uniqueEmail(name.toLowerCase());
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Nome da família").fill(`Família ${name}`);
  await page.getByLabel("Cidade onde moram").fill("Campinas");
  await page.getByLabel("UF").fill("sp");
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

/** Só o Field de idioma tem este nome; o rótulo muda junto com a tela. */
const languageSelect = (page: Page, label = "Idioma") => page.getByLabel(label, { exact: true });

async function chooseLanguage(page: Page, from: string, locale: string, heading: string) {
  await languageSelect(page, from).selectOption(locale);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page).toHaveTitle(/.+/);
}

async function expectNoAxeViolations(page: Page) {
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
}

/** Nada de transbordo lateral: inglês e espanhol são mais longos no menu. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** O painel usa a navegação lateral no computador e a barra inferior no celular. */
const nav = (page: Page, name: string) =>
  page.getByRole("navigation", { name }).first().locator("visible=true");

async function freshContext(browser: Browser, locale: string) {
  const context = await browser.newContext({ locale, baseURL: test.info().project.use.baseURL! });
  return { context, page: await context.newPage() };
}

test("trocar de idioma traduz menu, painel e Configurações, e recarregar mantém", async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name !== "desktop";
  // Texto ou número diferente entre servidor e navegador apareceria aqui como erro de hidratação.
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signUpAndCreateFamily(page, "Rosa");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.getByRole("heading", { level: 1, name: "Olá, Rosa" })).toBeVisible();

  // Uma despesa paga, para o gráfico e os valores aparecerem em cada idioma.
  await page.getByRole("button", { name: mobile ? "Lançar" : "Novo lançamento" }).click();
  await page.getByLabel("Descrição").fill("Mercado");
  await page.getByLabel("Valor (R$)").fill("1.234,56");
  await page.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(page.getByRole("button", { name: "Salvar lançamento" })).toBeHidden();
  await expect(page.getByText(/R\$\s1\.234,56/).first()).toBeVisible();

  await page.goto("/app/configuracoes");
  await chooseLanguage(page, "Idioma", "en", "Settings");
  await expect(page.getByRole("heading", { name: "Where you live" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Hi, Rosa" })).toBeVisible();
  await expect(page.getByText("Account balance", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Today is [A-Z][a-z]+ \d{1,2}, \d{4}/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trend" })).toBeVisible();
  await expect(page.getByText("R$1,234.56").first()).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  if (mobile) {
    const bar = page.getByRole("navigation", { name: "Shortcuts" });
    await expect(bar.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Transactions" })).toBeVisible();
    await bar.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
  } else {
    await expect(nav(page, "Main menu").getByRole("link", { name: "Net worth" })).toBeVisible();
    await expect(nav(page, "Main menu").getByRole("link", { name: "Settings" })).toBeVisible();
  }

  await page.goto("/app/configuracoes");
  await chooseLanguage(page, "Language", "es", "Configuración");
  await expect(page.getByRole("heading", { name: "Dónde viven" })).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Hola, Rosa" })).toBeVisible();
  await expect(page.getByText("Saldo en cuentas", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Hoy es \d{1,2} de [a-z]+ de \d{4}/)).toBeVisible();
  await expect(page.getByText(/1234,56\sR\$/).first()).toBeVisible();
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);

  await page.goto("/app/configuracoes");
  await chooseLanguage(page, "Idioma", "pt-BR", "Configurações");
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Olá, Rosa" })).toBeVisible();
  await expect(page.getByText("Saldo nas contas", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("documento só em português leva o aviso, sem chave crua", async ({ page }) => {
  await signUpAndCreateFamily(page, "Nina");
  await page.goto("/app/configuracoes");
  await chooseLanguage(page, "Idioma", "en", "Settings");

  await page.goto("/termos");
  await expect(page.getByRole("heading", { level: 1, name: "Termos de Uso" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Portuguese");
  await expect(page.locator("body")).not.toContainText(/shell\.nav|dashboard\.|settings\./);
  await expectNoAxeViolations(page);
});

test("a escolha é da pessoa: fica na conta e vale em outro aparelho", async ({ page, browser }) => {
  const email = await signUpAndCreateFamily(page, "Teo");
  await page.goto("/app/configuracoes");
  await chooseLanguage(page, "Idioma", "es", "Configuración");

  const { context, page: other } = await freshContext(browser, "pt-BR");
  await other.goto("/entrar");
  await other.getByLabel("E-mail").fill(email);
  await other.getByLabel("Senha").fill(password);
  await other.getByRole("button", { name: "Entrar" }).click();
  await expect(other.getByRole("heading", { level: 1, name: "Hola, Teo" })).toBeVisible();
  await context.close();
});

test("sem conta, o idioma vem do navegador e o cookie guarda a escolha", async ({ browser }) => {
  const { context, page } = await freshContext(browser, "es-MX");
  await page.goto("/entrar");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(
    page.getByRole("heading", { level: 1, name: "Qué bueno verte de nuevo" }),
  ).toBeVisible();

  await chooseLanguage(page, "Idioma", "en", "Welcome back");
  await expectNoAxeViolations(page);
  await expectNoHorizontalOverflow(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();

  await page.getByRole("link", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  await page.goto("/esqueci-senha");
  await expect(
    page.getByRole("heading", { level: 1, name: "Forgot your password?" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await page.goto("/redefinir-senha");
  await expect(page.getByRole("heading", { level: 1, name: /no longer valid/ })).toBeVisible();
  await context.close();
});

test("navegador em idioma que não atendemos fica em português", async ({ browser }) => {
  const { context, page } = await freshContext(browser, "fr-FR");
  await page.goto("/entrar");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.getByRole("heading", { level: 1, name: "Bem-vindo de volta" })).toBeVisible();
  await context.close();
});

test("quem escolhe o idioma antes de criar a conta leva a escolha para a conta", async ({
  page,
  browser,
}) => {
  await page.goto("/cadastro");
  await chooseLanguage(page, "Idioma", "en", "Create your account");
  const email = uniqueEmail("ana");
  await page.getByLabel("Your name").fill("Ana");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("checkbox", { name: /I have read and accept/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);

  const { context, page: other } = await freshContext(browser, "pt-BR");
  await other.goto("/entrar");
  await other.getByLabel("E-mail").fill(email);
  await other.getByLabel("Senha").fill(password);
  await other.getByRole("button", { name: "Entrar" }).click();
  await expect(other).toHaveURL(/\/app\/novo-household$/);
  await expect(other.locator("html")).toHaveAttribute("lang", "en");
  await context.close();
});
