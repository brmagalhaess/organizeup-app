// Confirmar o e-mail: aviso, reenvio, volta do link, Configurações e admin, lendo o link no arquivo de captura.
// Roda em `next dev`, com EMAIL_CAPTURE_FILE no servidor e no Playwright, AUTH_RATE_LIMIT=disabled e um worker.
// O projeto mobile mede 375 px. O passo do admin precisa de E2E_ADMIN_EMAIL. Ver docs/runbooks/bootstrap.md.
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import en from "../messages/en.json" with { type: "json" };
import ptBR from "../messages/pt-BR.json" with { type: "json" };
import { animationsDone } from "./animations";
import { newCpf } from "./documents";

const captureFile = process.env.EMAIL_CAPTURE_FILE;
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "";
const shotsFolder = process.env.E2E_SHOTS;
const password = "senha-segura-123!";

test.skip(!captureFile, "precisa de EMAIL_CAPTURE_FILE no servidor e no Playwright");
test.describe.configure({ timeout: 180_000 });

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
});

const unique = () => `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

type Captured = { to: string; template: string; text: string; subject: string };

async function confirmations(to: string) {
  const content = await readFile(captureFile!, "utf8").catch(() => "");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Captured)
    .filter((email) => email.to === to && email.template === "confirmar-email");
}

const linkIn = (email: Captured | undefined) => email?.text.match(/https?:\/\/\S+/)?.[0] ?? "";

async function expectGoodPage(page: Page) {
  await animationsDone(page);
  await expect(page).toHaveTitle(/.+/);
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  if (!shotsFolder) return;
  await mkdir(shotsFolder, { recursive: true });
  const file = path.join(shotsFolder, `${testInfo.project.name}-${name}.png`);
  await page.screenshot({ path: file });
}

async function signUpInPortuguese(page: Page, email: string) {
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Ana Teste");
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/, { timeout: 60_000 });
  await page.getByLabel("Nome da família").fill(`Família ${unique()}`);
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 60_000 });
}

async function signUpInEnglish(page: Page, email: string) {
  await page.goto("/cadastro?lang=en");
  await page.getByLabel("Your name").fill("Bia Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/, { timeout: 60_000 });
  await page.getByLabel("Family name").fill(`Family ${unique()}`);
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 60_000 });
}

/** Abre em outro navegador, sem sessão nenhuma. */
async function openWithoutSession(browser: Browser, url: string, locale: string) {
  const context = await browser.newContext({ locale });
  const page = await context.newPage();
  await page.goto(url);
  return { context, page };
}

const LOCALES = [
  {
    name: "pt-BR",
    messages: ptBR,
    subject: "Confirme seu e-mail no OrganizeUp",
    signUp: signUpInPortuguese,
  },
  {
    name: "en",
    messages: en,
    subject: "Confirm your email on OrganizeUp",
    signUp: signUpInEnglish,
  },
];

for (const locale of LOCALES) {
  const texts = locale.messages.auth.confirmEmail;
  const shell = locale.messages.shell;
  const account = locale.messages.settings.account;

  test(`cadastra, reenvia, confirma pelo link e vê o status (${locale.name})`, async ({
    page,
    browser,
  }, testInfo) => {
    const email = `confirma.${unique()}@example.com`;
    await locale.signUp(page, email);

    // O aviso não bloqueia nada, e o botão só diz "enviado" com o e-mail no arquivo.
    const banner = page.getByRole("region", { name: shell.emailNoticeLabel });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(shell.emailNotice);
    await expectGoodPage(page);
    await shot(page, testInfo, `${locale.name}-1-aviso`);
    await expect.poll(async () => (await confirmations(email)).length).toBe(1);

    await banner.getByRole("button", { name: texts.send }).click();
    await expect(banner.getByRole("status")).toContainText(texts.sent.split(".")[0]!);
    await expect.poll(async () => (await confirmations(email)).length).toBe(2);
    await expectGoodPage(page);
    await shot(page, testInfo, `${locale.name}-2-enviado`);

    await banner.getByRole("button", { name: texts.send }).click();
    await expect(banner.getByRole("alert")).toContainText(texts.waitSeconds.split(" ")[0]!);
    await expect.poll(async () => (await confirmations(email)).length).toBe(2);
    await expectGoodPage(page);
    await shot(page, testInfo, `${locale.name}-3-aguarde`);

    // Link inválido com a sessão aberta: dá para pedir outro ali mesmo.
    await page.goto(
      "/api/auth/verify-email?token=inventado&callbackURL=https%3A%2F%2Fexemplo.invalid",
    );
    await expect(page).toHaveURL(/\/confirmar-email\?error=INVALID_TOKEN$/);
    await expect(page.getByRole("heading", { name: texts.invalidTitle })).toBeVisible();
    await expect(page.getByRole("button", { name: texts.send })).toBeVisible();
    await expectGoodPage(page);
    await shot(page, testInfo, `${locale.name}-4-invalido-com-sessao`);
    await page.getByRole("link", { name: texts.goToPanel }).click();
    await expect(page).toHaveURL(/\/app$/);

    // Dispensar tira a faixa, não a opção em Configurações.
    await banner.getByRole("button", { name: shell.closeNotice }).click();
    await expect(banner).toBeHidden();
    await page.goto("/app/configuracoes");
    await expect(page.getByText(account.emailNotConfirmed, { exact: true })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole("button", { name: texts.send })).toBeVisible();
    await expectGoodPage(page);
    await page.getByRole("button", { name: texts.send }).scrollIntoViewIfNeeded();
    await shot(page, testInfo, `${locale.name}-5-configuracoes-pendente`);

    // O e-mail vem no idioma da conta. Abrir sem sessão confirma, mas não entra na conta.
    const sent = (await confirmations(email)).at(-1);
    expect(sent?.subject).toBe(locale.subject);
    const link = linkIn(sent);
    const visitor = await openWithoutSession(browser, link, locale.name);
    await expect(visitor.page).toHaveURL(/\/confirmar-email\?estado=confirmado$/);
    await expect(visitor.page.getByRole("heading", { name: texts.confirmedTitle })).toBeVisible();
    await expectGoodPage(visitor.page);
    await shot(visitor.page, testInfo, `${locale.name}-6-confirmado`);
    await expect(visitor.page.getByRole("link", { name: texts.goToPanel })).toBeHidden();
    await visitor.page.goto("/app");
    await expect(visitor.page).toHaveURL(/\/entrar/);
    await visitor.context.close();

    // Quem já confirmou nunca mais vê o aviso, com a mesma sessão de antes.
    await page.reload();
    await expect(page.getByText(account.emailConfirmed, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: texts.send })).toBeHidden();
    await page.goto("/app");
    await expect(page.getByRole("region", { name: shell.emailNoticeLabel })).toBeHidden();
    await page.goto("/app/configuracoes");
    await page.getByText(account.emailConfirmed, { exact: true }).scrollIntoViewIfNeeded();
    await shot(page, testInfo, `${locale.name}-7-configuracoes-confirmado`);

    // Abrir o link de novo explica, sem entrar na conta.
    const again = await openWithoutSession(browser, link, locale.name);
    await expect(again.page).toHaveURL(/\/confirmar-email\?estado=ja-confirmado$/);
    await expect(again.page.getByRole("heading", { name: texts.alreadyTitle })).toBeVisible();
    await expect(again.page.getByRole("link", { name: texts.signIn })).toBeVisible();
    await expectGoodPage(again.page);
    await shot(again.page, testInfo, `${locale.name}-8-ja-usado`);
    await again.context.close();
  });

  test(`link inválido sem sessão explica e leva a entrar (${locale.name})`, async ({
    browser,
  }, testInfo) => {
    const invalid = await openWithoutSession(
      browser,
      "/confirmar-email?error=INVALID_TOKEN",
      locale.name,
    );
    await invalid.page.goto("/api/auth/verify-email?token=inventado");
    await expect(invalid.page).toHaveURL(/\/confirmar-email\?error=INVALID_TOKEN$/);
    await expect(invalid.page.getByRole("heading", { name: texts.invalidTitle })).toBeVisible();
    await expect(invalid.page.getByText(texts.signInHint)).toBeVisible();
    await expect(invalid.page.getByRole("button", { name: texts.send })).toBeHidden();
    await expectGoodPage(invalid.page);
    await shot(invalid.page, testInfo, `${locale.name}-9-invalido-sem-sessao`);
    await invalid.page.getByRole("link", { name: texts.signIn }).click();
    await expect(invalid.page).toHaveURL(/\/entrar$/);

    // Sem nada no endereço não há sucesso de mentira, nem resposta crua da API.
    await invalid.page.goto("/confirmar-email");
    await expect(invalid.page.getByRole("heading", { name: texts.invalidTitle })).toBeVisible();
    await invalid.page.goto("/api/auth/verify-email");
    await expect(invalid.page.getByRole("heading", { name: texts.invalidTitle })).toBeVisible();

    await invalid.page.goto("/confirmar-email?error=TOKEN_EXPIRED");
    await expect(invalid.page.getByRole("heading", { name: texts.expiredTitle })).toBeVisible();
    await expectGoodPage(invalid.page);
    await shot(invalid.page, testInfo, `${locale.name}-10-vencido`);
    await invalid.context.close();
  });
}

test("admin reenvia, a pessoa confirma e o painel mostra verificado", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(!adminEmail, "Defina E2E_ADMIN_EMAIL e suba o servidor com ADMIN_EMAILS igual.");
  const email = `admin-confirma.${unique()}@example.com`;
  await signUpInPortuguese(page, email);
  const session = await page.request.get("/api/auth/get-session");
  const { user } = (await session.json()) as { user: { id: string } };

  const adminContext = await browser.newContext({ locale: "pt-BR" });
  const admin = await adminContext.newPage();
  await admin.goto("/entrar");
  await admin.getByLabel("E-mail").fill(adminEmail);
  await admin.getByLabel("Senha").fill(password);
  await admin.getByRole("button", { name: "Entrar", exact: true }).click();
  const outcome = await Promise.race([
    admin.waitForURL(/\/app(\/|$)/, { timeout: 60_000 }).then(() => "entrou" as const),
    admin
      .getByText("E-mail ou senha incorretos.")
      .waitFor()
      .then(() => "sem conta" as const),
  ]);
  if (outcome === "sem conta") {
    await admin.goto("/cadastro");
    await admin.getByLabel("Seu nome").fill("Admin");
    await admin.getByLabel("CPF", { exact: true }).fill(newCpf());
    await admin.getByLabel("E-mail").fill(adminEmail);
    await admin.getByLabel("Senha", { exact: true }).fill(password);
    await admin.getByLabel("Confirmar senha").fill(password);
    await admin.getByRole("checkbox", { name: /Li e aceito/ }).check();
    await admin.getByRole("button", { name: "Criar conta" }).click();
    await expect(admin).toHaveURL(/\/app\/novo-household$/, { timeout: 60_000 });
  }

  await admin.goto(`/admin/usuarios/${user.id}`);
  await expect(admin.getByText("Não verificado", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await confirmations(email)).length).toBe(1);
  await admin.getByRole("button", { name: "Reenviar confirmação" }).click();
  await admin.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Confirmação enviada" })).toBeVisible();
  await expect.poll(async () => (await confirmations(email)).length).toBe(2);
  await expect(admin.locator("body")).not.toContainText("token=");
  await expectGoodPage(admin);
  await shot(admin, testInfo, "admin-1-reenviado");

  const visitor = await openWithoutSession(
    browser,
    linkIn((await confirmations(email)).at(-1)),
    "pt-BR",
  );
  await expect(visitor.page).toHaveURL(/\/confirmar-email\?estado=confirmado$/);
  await visitor.context.close();

  await admin.reload();
  await expect(admin.getByText("Verificado", { exact: true })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Reenviar confirmação" })).toBeHidden();
  await shot(admin, testInfo, "admin-2-verificado");

  await admin.goto("/admin/auditoria");
  await expect(admin.getByText("Pediu reenvio da confirmação de e-mail").first()).toBeVisible();
  await adminContext.close();
});
