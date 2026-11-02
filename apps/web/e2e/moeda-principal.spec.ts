// Família com moeda principal em dólar: do cadastro às telas, no computador e no celular (ADR-0020,
// Fase 6). Precisa de cotação em market_fx, que o job de mercado do worker grava.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const password = "senha-segura-123!";
const shots = process.env.E2E_SHOTS_DIR;

async function signUp(page: Page, name: string, currency?: string) {
  const email = `${name}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Nome da família").fill(`Família ${name}`);
  if (currency) await page.getByLabel("Moeda principal").selectOption(currency);
  if (shots) await page.screenshot({ path: `${shots}/${name}-cadastro.png`, fullPage: true });
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function axe(page: Page) {
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((violation) => violation.id)).toEqual([]);
}

async function screen(page: Page, name: string, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main").getByText(/R\$/)).toHaveCount(0);
  await axe(page);
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

async function newAccount(page: Page, name: string, currency: string, label: string) {
  await page.goto("/app/contas");
  await page.getByRole("button", { name: "Nova conta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova conta" });
  await dialog.getByLabel("Nome da conta").fill(name);
  await dialog.getByLabel("Moeda").selectOption(currency);
  await dialog.getByLabel(label).fill("1.000,00");
  await dialog.getByRole("button", { name: "Salvar conta" }).click();
  await expect(dialog).toBeHidden();
}

async function newEntry(page: Page, description: string, account: string, label: string) {
  await page.goto("/app/lancamentos");
  await page
    .getByRole("button", { name: /^(Novo lançamento|Lançar)$/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Novo lançamento" });
  await dialog.getByLabel("Descrição").fill(description);
  await dialog
    .getByLabel("Conta ou cartão")
    .or(dialog.getByLabel("Conta", { exact: true }))
    .selectOption({ label: account });
  await dialog.getByLabel(label).fill("100,00");
  return dialog;
}

async function journey(page: Page, label: string) {
  const name = `Bia${label}`;
  await signUp(page, name, "USD");

  // Painel e menu já na moeda da família, sem o que só vale no Brasil.
  await expect(page.getByRole("link", { name: "Proventos" })).toHaveCount(0);

  // Conta em dólar é a principal; conta em real é a estrangeira.
  await newAccount(page, "Banco no Brasil", "BRL", "Saldo inicial (R$)");
  const card = page
    .getByRole("list", { name: "Contas" })
    .getByRole("listitem")
    .filter({ hasText: "Banco no Brasil" });
  await expect(card).toContainText("R$ 1.000,00");
  await expect(card).toContainText(/≈ US\$\s[\d.]+,\d{2}/);
  await expect(card).toContainText("em dólares, varia com a cotação");

  // Lançamento em dólar, sem conversão.
  const usd = await newEntry(page, "Mercado", "Conta principal", "Valor (US$)");
  await usd.getByRole("button", { name: "Salvar" }).click();
  await expect(usd).toBeHidden();
  await expect(page.getByRole("main")).toContainText("US$ 100,00");

  // Lançamento em real: a prévia sai em dólar, e a linha mostra os dois.
  const brl = await newEntry(page, "Feira no Brasil", "Banco no Brasil", "Valor (R$)");
  await expect(brl.getByText(/≈ US\$\s[\d.]+,\d{2}, cotação de/)).toBeVisible();
  await expect(brl.getByLabel("Repete todo mês")).toBeHidden();
  await brl.getByRole("button", { name: "Salvar" }).click();
  await expect(brl).toBeHidden();
  await expect(page.getByRole("main")).toContainText("R$ 100,00");

  // Transferência de dólar para real.
  await page.goto("/app/contas");
  await page.getByRole("button", { name: "Transferir" }).first().click();
  const transfer = page.getByRole("dialog");
  await transfer.getByLabel("De", { exact: true }).selectOption({ label: "Conta principal" });
  await transfer.getByLabel("Para", { exact: true }).selectOption({ label: "Banco no Brasil" });
  await transfer.getByLabel(/Saiu \(US\$\)/).fill("50,00");
  await expect(transfer.getByLabel(/Entrou \(R\$\)/)).not.toHaveValue("");
  if (shots) await page.screenshot({ path: `${shots}/${label}-transferencia.png` });
  await transfer.getByRole("button", { name: "Transferir" }).click();
  await expect(transfer).toBeHidden();

  // Trava: já tem movimento.
  await page.goto("/app/configuracoes");
  await expect(page.getByLabel("Moeda principal")).toBeDisabled();
  await expect(page.getByText("A família já tem movimentos")).toBeVisible();
  await axe(page);
  if (shots) await page.screenshot({ path: `${shots}/${label}-configuracoes.png`, fullPage: true });

  // Renda simples, sem CLT nem simulador de holerite.
  await page.goto("/app/renda");
  await expect(page.getByText("Veja quanto de um salário CLT sobra")).toHaveCount(0);
  await page.getByRole("button", { name: "Nova renda" }).first().click();
  const income = page.getByRole("dialog");
  await expect(income.getByLabel("Tipo").locator("option", { hasText: "CLT" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Investimento só de classes com valor informado.
  await page.goto("/app/investimentos");
  await page
    .getByRole("button", { name: /Adicionar investimento/ })
    .first()
    .click();
  const invest = page.getByRole("dialog");
  await expect(invest.getByText("Na bolsa")).toHaveCount(0);
  await expect(invest.getByText("Outro", { exact: true })).toBeVisible();
  await invest.getByText("Outro", { exact: true }).click();
  await invest.getByLabel("Nome").fill("Fundo no exterior");
  await invest.getByLabel("Tipo").selectOption("exterior");
  await invest.getByLabel(/Valor aplicado \(US\$\)/).fill("1.000,00");
  await invest.getByRole("button", { name: "Adicionar à carteira" }).click();
  await expect(invest).toBeHidden();
  await expect(page.getByRole("main")).toContainText("Fundo no exterior");

  // Quem digita o endereço de proventos não cai numa tela que não vale.
  await page.goto("/app/proventos");
  await expect(page).toHaveURL(/\/app\/investimentos$/);

  // Aposentadoria sem INSS.
  await page.goto("/app/aposentadoria");
  await expect(page.getByRole("main").getByText("INSS")).toHaveCount(0);

  // Pessoas sem CLT, INSS e benefício.
  await page.goto("/app/familia");
  await expect(page.getByText("Contribui para o INSS?")).toHaveCount(0);

  for (const [slug, path] of [
    ["painel", "/app"],
    ["contas", "/app/contas"],
    ["reserva", "/app/reserva"],
    ["metas", "/app/metas"],
    ["cartoes", "/app/cartoes"],
    ["dividas", "/app/dividas"],
    ["patrimonio", "/app/patrimonio"],
    ["investimentos", "/app/investimentos"],
    ["aposentadoria", "/app/aposentadoria"],
    ["renda", "/app/renda"],
  ] as const) {
    if (slug === "contas" || slug === "patrimonio") {
      // Estas têm a conta em real, que é para mostrar R$.
      await page.goto(path);
      await axe(page);
      if (shots) await page.screenshot({ path: `${shots}/${label}-${slug}.png`, fullPage: true });
    } else {
      await screen(page, `${label}-${slug}`, path);
    }
  }
}

test("família em dólar, do cadastro às telas", async ({ page }, info) => {
  await journey(page, info.project.name);
});

test("família em euro vê euro, e sem movimento ainda muda", async ({ page }, info) => {
  await signUp(page, `Eva${info.project.name}`, "EUR");
  await page.goto("/app/contas");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("€");
  await page.goto("/app/configuracoes");
  await expect(page.getByText("Fora do real, as regras brasileiras").last()).toBeVisible();
  await page.getByLabel("Moeda principal").selectOption("USD");
  await page.getByRole("button", { name: "Salvar moeda" }).click();
  await expect(page.getByText("Moeda principal salva.")).toBeVisible();
  await page.goto("/app/contas");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("US$");
});

test("família em real não muda nada", async ({ page }, info) => {
  await signUp(page, `Rui${Date.now()}`);
  await page.goto("/app/contas");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("R$");
  // No celular, o menu fica fechado.
  if (info.project.name === "desktop")
    await expect(page.getByRole("link", { name: "Proventos" })).toBeVisible();
  await page.goto("/app/renda");
  await expect(page.getByText("Veja quanto de um salário CLT sobra")).toBeVisible();
  await page.goto("/app/configuracoes");
  await expect(page.getByLabel("Moeda principal")).toHaveValue("BRL");
});
