// Recuperar senha, confirmar e-mail e convite por e-mail. Sem Brevo: o servidor grava as mensagens
// em EMAIL_CAPTURE_FILE, que só funciona fora de produção. Ver docs/runbooks/bootstrap.md.
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newCpf } from "./documents";

const captureFile = process.env.EMAIL_CAPTURE_FILE;
const password = "senha-segura-123!";
const newPassword = "senha-nova-456789";

type CapturedEmail = { to: string; subject: string; text: string; html: string; template: string };

test.skip(!captureFile, "precisa de EMAIL_CAPTURE_FILE no servidor e no Playwright");

function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function capturedFor(to: string) {
  const content = await readFile(captureFile!, "utf8").catch(() => "");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedEmail)
    .filter((email) => email.to === to);
}

/** O envio é em segundo plano: espera o e-mail aparecer no arquivo. */
async function linkFrom(to: string, template: string) {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const email = (await capturedFor(to)).findLast((item) => item.template === template);
      link = email?.text.match(/https?:\/\/\S+/)?.[0];
      return link;
    })
    .toBeTruthy();
  return link!;
}

async function expectAccessible(page: Page) {
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
}

async function signUp(page: Page, email: string) {
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Ana Teste");
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  // Este spec roda em `next dev`: a primeira visita a cada tela ainda compila.
  await expect(page).toHaveURL(/\/app\/novo-household$/, { timeout: 30_000 });
}

async function requestReset(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByRole("link", { name: "Esqueci minha senha" }).click();
  await expect(page).toHaveURL(/\/esqueci-senha$/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(page.getByRole("status")).toHaveText(/Se este e-mail tiver conta/);
}

async function signIn(page: Page, email: string, secret: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(secret);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("troca a senha pelo link do e-mail", async ({ browser, page }) => {
  const email = uniqueEmail("recuperar");
  await signUp(page, email);

  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  await visitorPage.goto("/esqueci-senha");
  await expectAccessible(visitorPage);
  await requestReset(visitorPage, email);
  await expectAccessible(visitorPage);

  const link = await linkFrom(email, "redefinir-senha");
  await visitorPage.goto(link);
  await expect(visitorPage).toHaveURL(/\/redefinir-senha\?token=/);
  await expect(visitorPage.getByRole("heading", { name: "Crie uma nova senha" })).toBeVisible();
  await expectAccessible(visitorPage);

  await visitorPage.getByLabel("Nova senha", { exact: true }).fill(newPassword);
  await visitorPage.getByLabel("Confirmar nova senha").fill("outra-senha-123");
  await visitorPage.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(visitorPage.getByText("As senhas não conferem.")).toBeVisible();

  await visitorPage.getByLabel("Confirmar nova senha").fill(newPassword);
  await visitorPage.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(visitorPage.getByRole("heading", { name: "Senha alterada" })).toBeVisible();
  await expectAccessible(visitorPage);
  await linkFrom(email, "senha-alterada");

  // A senha antiga parou de valer, a nova entra.
  await signIn(visitorPage, email, password);
  await expect(visitorPage.getByText("E-mail ou senha incorretos.")).toBeVisible();
  await signIn(visitorPage, email, newPassword);
  await expect(visitorPage).toHaveURL(/\/app/);
  await visitor.close();

  // O link só vale uma vez.
  const reuse = await browser.newContext();
  const reusePage = await reuse.newPage();
  await reusePage.goto(link);
  await expect(reusePage).toHaveURL(/\/redefinir-senha\?error=INVALID_TOKEN/);
  await expect(reusePage.getByRole("heading", { name: "Este link não vale mais" })).toBeVisible();
  await reuse.close();
});

test("pedido é igual com ou sem conta, e só quem tem conta recebe", async ({ page, request }) => {
  const existing = uniqueEmail("existe");
  const missing = uniqueEmail("nao-existe");
  await signUp(page, existing);

  const [withAccount, withoutAccount] = await Promise.all(
    [existing, missing].map((email) =>
      request.post("/api/auth/request-password-reset", { data: { email } }),
    ),
  );
  expect(withAccount!.status()).toBe(withoutAccount!.status());
  expect(await withAccount!.json()).toEqual(await withoutAccount!.json());

  await requestReset(page, missing);
  await linkFrom(existing, "redefinir-senha");
  expect(await capturedFor(missing)).toEqual([]);
});

test("link incompleto, vencido ou inventado leva a pedir outro", async ({ page }) => {
  for (const path of [
    "/redefinir-senha",
    "/api/auth/reset-password/inventado?callbackURL=/redefinir-senha",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Este link não vale mais" })).toBeVisible();
  }
  await expectAccessible(page);
  await page.getByRole("link", { name: "Pedir novo link" }).click();
  await expect(page).toHaveURL(/\/esqueci-senha$/);

  // Token que passou na abertura da tela e foi recusado na hora de salvar.
  await page.goto("/redefinir-senha?token=inventado");
  await page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirmar nova senha").fill(newPassword);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page.getByRole("heading", { name: "Este link não vale mais" })).toBeVisible();
});

test("cadastro envia a confirmação e o link confirma e já entra", async ({ browser, page }) => {
  const email = uniqueEmail("confirmar");
  await signUp(page, email);
  const session = await page.request.get("/api/auth/get-session");
  expect((await session.json()).user.emailVerified).toBe(false);

  const link = await linkFrom(email, "confirmar-email");
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(link);
  await expect(otherPage).toHaveURL(/\/app\/novo-household$/);
  const verified = await otherPage.request.get("/api/auth/get-session");
  expect((await verified.json()).user.emailVerified).toBe(true);
  await other.close();
});

test("convite chega por e-mail com o mesmo link da tela", async ({ page }) => {
  await signUp(page, uniqueEmail("dona"));
  await page.getByLabel("Nome da família").fill(`Família E-mail ${Date.now()}`);
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);

  const guest = uniqueEmail("convidada");
  await page.goto("/app/familia");
  await page.getByRole("button", { name: "Convidar" }).click();
  await page.getByLabel("E-mail da pessoa").fill(guest);
  await page.getByLabel("O que ela pode fazer").selectOption("viewer");
  await page.getByRole("button", { name: "Criar convite" }).click();
  const linkField = page.getByLabel(`Link do convite de ${guest}`);
  await expect(linkField).toBeVisible();

  const shown = new URL(await linkField.inputValue());
  const sent = new URL(await linkFrom(guest, "convite"));
  expect(sent.pathname).toBe(shown.pathname);
});
