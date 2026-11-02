// Montar o plano, módulo desligado e só leitura, no computador e a 375 px, em português e inglês. Precisa
// de E2E_BILLING=1, E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL do mesmo banco do servidor. Rode sozinho,
// com --workers=1: a chave da cobrança é global. Nada aqui chama a Stripe.
import { execFileSync } from "node:child_process";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newCpf } from "./documents";

const password = "senha-segura-123!";
const shots = process.env.E2E_SHOTS_DIR;
const repo = path.resolve(import.meta.dirname, "../../..");

test.skip(!process.env.E2E_BILLING, "Defina E2E_BILLING=1 e as duas conexões do banco.");
test.describe.configure({ mode: "serial" });

function plano(...args: string[]) {
  execFileSync(process.execPath, ["--import", "tsx", "apps/web/e2e/plano-familia.ts", ...args], {
    cwd: repo,
    env: {
      ...process.env,
      DATABASE_URL: process.env.E2E_WORKER_DATABASE_URL ?? "",
    },
  });
}

const unique = (name: string) => `${name}${Date.now()}${Math.random().toString(36).slice(2, 7)}`;

async function signUp(page: Page, name: string) {
  const email = `${name}@example.com`;
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Teste");
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  // No `next dev`, a primeira tela de cada área ainda compila.
  await expect(page).toHaveURL(/\/app\/novo-household$/, { timeout: 30_000 });
  await page.getByLabel("Nome da família").fill(name);
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
}

async function axe(page: Page) {
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((violation) => violation.id)).toEqual([]);
}

const total = (page: Page) => page.getByTestId("plano-total");

async function narrow(page: Page) {
  await page.setViewportSize({ width: 375, height: 812 });
}

test.afterAll(() => plano("chave", "off"));

test("com a chave desligada, ninguém vê planos e tudo segue como hoje", async ({ page }) => {
  plano("chave", "off");
  const name = unique("Off");
  await signUp(page, name);
  // A resposta já começou pelo `loading.tsx` do painel: o status fica 200, e o conteúdo é o do 404.
  await page.goto("/app/assinatura");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("plano-total")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Plano e assinatura" })).toHaveCount(0);

  await page.goto("/app/metas");
  await expect(page.getByRole("heading", { name: "Este módulo está desligado" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Plano e assinatura" })).toHaveCount(0);
});

test("o webhook não pede sessão nem passa pelo idioma", async ({ request }) => {
  const response = await request.post("/api/webhooks/stripe", {
    data: "{}",
    maxRedirects: 0,
    headers: { "stripe-signature": "t=1,v1=errada" },
  });
  // Sem o segredo no servidor, 503; com ele, assinatura errada dá 400. Nunca 3xx, 401 ou 404.
  expect([400, 503]).toContain(response.status());
});

for (const viewport of ["computador", "375 px"] as const) {
  test(`monta o plano ao vivo, em ${viewport}`, async ({ page }, info) => {
    test.skip(
      (viewport === "375 px") !== (info.project.name === "mobile"),
      "cada projeto cobre uma largura",
    );
    if (viewport === "375 px") await narrow(page);
    plano("chave", "on");
    await signUp(page, unique("Monta"));
    await page.goto("/app/assinatura");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("plano-situacao")).toContainText("Teste grátis");
    await expect(page.getByRole("checkbox", { name: /Família completa/ })).toBeChecked();
    await expect(total(page)).toContainText("44,90");
    await expect(total(page)).toContainText("por mês");
    if (viewport === "375 px") {
      await expect(page.getByTestId("plano-total-fixo")).toContainText("44,90");
    }
    await expect(page.getByText("100 mensagens ao assistente, dicas")).toBeVisible();
    // Fora de venda até a conexão com bancos existir: nem o campo aparece.
    await expect(page.getByText("Contas conectadas")).toHaveCount(0);
    await axe(page);
    if (shots) {
      await page.screenshot({
        path: `${shots}/plano-familia-${info.project.name}.png`,
        fullPage: true,
      });
    }

    // Sair da Família completa custa mais: a tela diz, e volta com um clique.
    await page.getByRole("checkbox", { name: /Dívidas/ }).uncheck();
    await expect(total(page)).toContainText("71,50");
    await expect(page.getByText(/pagaria R\$\s?26,60 a menos/)).toBeVisible();
    await page.getByRole("button", { name: "Voltar para a Família completa" }).click();
    await expect(total(page)).toContainText("44,90");

    // No avulso, desmarcar um módulo mostra o preço cair.
    await page.getByRole("checkbox", { name: /Família completa/ }).uncheck();
    await page.getByLabel("Lançamentos por mês", { exact: true }).selectOption("50");
    await page.getByLabel("Mensagens ao assistente por mês", { exact: true }).selectOption("0");
    await expect(total(page)).toContainText("44,50");
    await page.getByRole("checkbox", { name: /Dívidas/ }).uncheck();
    await expect(total(page)).toContainText("36,60");
    await expect(
      page.getByRole("complementary", { name: "Seu plano" }).getByText("Dívidas"),
    ).toHaveCount(0);
    await page.getByRole("checkbox", { name: /Metas e viagens/ }).uncheck();
    await expect(total(page)).toContainText("29,70");

    // Degrau, moeda e ciclo mudam o total sem recarregar.
    await page.getByLabel("Mensagens ao assistente por mês", { exact: true }).selectOption("300");
    await expect(total(page)).toContainText("59,60");
    await page.getByRole("checkbox", { name: /Dólar/ }).check();
    await expect(total(page)).toContainText("64,50");
    await page.getByRole("radio", { name: "Por ano" }).check();
    await expect(total(page)).toContainText("645,00");
    await expect(total(page)).toContainText("por ano");
    await axe(page);
    if (shots) {
      await page.screenshot({
        path: `${shots}/plano-avulso-${info.project.name}.png`,
        fullPage: true,
      });
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Sem chave da Stripe no ambiente: recusa com calma, e nada é cobrado.
    await page.getByRole("button", { name: "Assinar" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
  });
}

test("em inglês, a tela e o convite saem traduzidos", async ({ page }, info) => {
  if (info.project.name === "mobile") await narrow(page);
  plano("chave", "on");
  const name = unique("Lingua");
  await signUp(page, name);
  await page.goto("/app/configuracoes");
  await page.getByLabel("Idioma", { exact: true }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.goto("/app/assinatura");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Plan and subscription" })).toBeVisible();
  await expect(total(page)).toContainText("44.90");
  await expect(total(page)).toContainText("a month");
  await axe(page);
  if (shots) {
    await page.screenshot({ path: `${shots}/plano-en-${info.project.name}.png`, fullPage: true });
  }

  plano("plano", name, "base:50");
  await page.goto("/app/investimentos");
  await expect(page.getByRole("heading", { name: "This module is off" })).toBeVisible();
  await expect(page.getByText("From R$9.90 a month")).toBeVisible();
});

test("módulo fora do plano vira convite, e os outros seguem", async ({ page }, info) => {
  if (info.project.name === "mobile") await narrow(page);
  plano("chave", "on");
  const name = unique("Modulo");
  await signUp(page, name);
  plano("plano", name, "base:50,modulo:dividas");

  await page.goto("/app/metas");
  await expect(page.getByRole("heading", { name: "Este módulo está desligado" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Metas e viagens" })).toBeVisible();
  await expect(page.getByText("A partir de R$ 6,90 por mês")).toBeVisible();
  await expect(page.getByText("seus dados continuam guardados")).toBeVisible();
  await axe(page);
  if (shots) {
    await page.screenshot({
      path: `${shots}/plano-convite-${info.project.name}.png`,
      fullPage: true,
    });
  }

  await page.getByRole("link", { name: "Ver planos" }).last().click();
  await expect(page).toHaveURL(/\/app\/assinatura$/);
  await expect(page.getByTestId("plano-situacao")).toContainText("Assinatura ativa");

  await page.goto("/app/dividas");
  await expect(page.getByRole("heading", { name: "Este módulo está desligado" })).toHaveCount(0);
  await page.goto("/app/investimentos/balanceamento");
  await expect(page.getByRole("heading", { name: "Este módulo está desligado" })).toBeVisible();
  await page.goto("/app/plano");
  await expect(page.getByRole("heading", { name: "Este módulo está desligado" })).toBeVisible();
});

test("teste vencido: só leitura, vê tudo, exporta, e nada foi apagado", async ({ page }, info) => {
  if (info.project.name === "mobile") await narrow(page);
  plano("chave", "on");
  const name = unique("Leitura");
  await signUp(page, name);
  plano("vencer", name);

  await page.goto("/app");
  await expect(page.getByText("Seu teste acabou. Você vê e exporta tudo")).toBeVisible();
  await axe(page);
  await page.goto("/app/metas");
  await expect(page.getByRole("heading", { name: "Este módulo está desligado" })).toHaveCount(0);

  await page.goto("/app/assinatura");
  await expect(page.getByTestId("plano-situacao")).toContainText("Nada foi apagado");
  await expect(page.getByRole("button", { name: "Assinar" })).toBeVisible();

  const response = await page.request.get("/app/exportar");
  expect(response.status()).toBe(200);
  expect(await response.json()).toHaveProperty("tables");
  await page.goto("/app/configuracoes");
  await expect(page.getByRole("link", { name: "Baixar dados da família" })).toBeVisible();
});
