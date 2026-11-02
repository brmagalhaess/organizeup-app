// Conta em dólar: criar, lançar, ver os dois valores e transferir entre real e dólar (ADR-0020), no
// computador e no celular. Precisa de cotação em market_fx, que o job de mercado do worker grava.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newCpf } from "./documents";

const password = "senha-segura-123!";
const shots = process.env.E2E_SHOTS_DIR;

async function signUp(page: Page, name: string) {
  const email = `${name}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
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
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function newAccount(
  page: Page,
  name: string,
  currency: string,
  label: string,
  value: string,
) {
  await page.goto("/app/contas");
  await page.getByRole("button", { name: "Nova conta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova conta" });
  await dialog.getByLabel("Nome da conta").fill(name);
  await dialog.getByLabel("Moeda").selectOption(currency);
  await dialog.getByLabel(label).fill(value);
  await dialog.getByRole("button", { name: "Salvar conta" }).click();
  await expect(dialog).toBeHidden();
}

const card = (page: Page, name: string) =>
  page.getByRole("list", { name: "Contas" }).getByRole("listitem").filter({ hasText: name });

async function journey(page: Page, label: string) {
  const name = `Dora${label}`;
  await signUp(page, name);

  // Conta em real e conta em dólar.
  await newAccount(page, "Banco", "BRL", "Saldo inicial (R$)", "1.000,00");
  await newAccount(page, "Conta em dólar", "USD", "Saldo inicial (US$)", "200,00");

  await expect(card(page, "Conta em dólar")).toContainText("US$ 200,00");
  await expect(card(page, "Conta em dólar")).toContainText(/≈ R\$\s[\d.]+,\d{2}/);
  await expect(card(page, "Conta em dólar")).toContainText("em reais, varia com a cotação");
  await expect(page.getByText(/^Convertido pela cotação de \d{2}\/\d{2}\/\d{4}\.$/)).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/${label}-contas.png`, fullPage: true });

  // Lançamento: valor digitado em dólar, com a prévia em reais.
  await page.goto("/app/lancamentos");
  await page
    .getByRole("button", { name: /^(Novo lançamento|Lançar)$/ })
    .first()
    .click();
  const entry = page.getByRole("dialog", { name: "Novo lançamento" });
  await entry.getByLabel("Descrição").fill("Hotel em Lisboa");
  await entry
    .getByLabel("Conta ou cartão")
    .or(entry.getByLabel("Conta", { exact: true }))
    .selectOption({
      label: "Conta em dólar",
    });
  await expect(entry.getByLabel("Valor (R$)")).toBeHidden();
  await entry.getByLabel("Valor (US$)").fill("100,00");
  await expect(
    entry.getByText(/≈ R\$\s[\d.]+,\d{2}, cotação de \d{2}\/\d{2}\/\d{4}/),
  ).toBeVisible();
  await expect(entry.getByLabel("Repete todo mês")).toBeHidden();
  if (shots) await page.screenshot({ path: `${shots}/${label}-lancar.png`, fullPage: true });
  await entry.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(entry).toBeHidden();

  // A lista mostra os dois valores, e o resumo do mês soma reais.
  const row = page.getByRole("row").filter({ hasText: "Hotel em Lisboa" });
  await expect(row).toContainText("US$ 100,00");
  await expect(row).toContainText(/≈ R\$\s[\d.]+,\d{2}/);
  await expect(
    page
      .locator("dl > div")
      .filter({ has: page.locator("dt").getByText("Despesas", { exact: true }) })
      .locator("dd"),
  ).toContainText(/R\$\s[\d.]+,\d{2}/);
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByText("US$ 100,00")).toBeInViewport();
  if (shots) await page.screenshot({ path: `${shots}/${label}-lista.png` });

  // Saldo da conta: 200 − 100, na moeda dela.
  await page.goto("/app/contas");
  await expect(card(page, "Conta em dólar")).toContainText("US$ 100,00");

  // Transferência de real para dólar: pede os dois lados e sugere pela cotação.
  await page.getByRole("button", { name: "Transferir entre contas" }).click();
  const move = page.getByRole("dialog", { name: "Transferir entre contas" });
  await move.getByLabel("De").selectOption({ label: "Banco" });
  await move.getByLabel("Para").selectOption({ label: "Conta em dólar" });
  await move.getByLabel("Saiu (R$)").fill("540,00");
  await expect(move.getByLabel("Entrou (US$)")).toHaveValue(/^\d+,\d{2}$/);
  await move.getByLabel("Entrou (US$)").fill("100,00");
  await expect(move.getByText(/a diferença de câmbio também não/)).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/${label}-transferir.png`, fullPage: true });
  await move.getByRole("button", { name: "Transferir" }).click();
  await expect(move).toBeHidden();

  await expect(card(page, "Conta em dólar")).toContainText("US$ 200,00");
  await expect(card(page, "Banco")).toContainText("R$ 460,00");
  const transfers = page.getByRole("list", { name: "Transferências" });
  await expect(transfers).toContainText("R$ 540,00");
  await expect(transfers).toContainText("entrou US$ 100,00");
  if (shots) await page.screenshot({ path: `${shots}/${label}-fim.png`, fullPage: true });

  // Sem rolagem para o lado e sem problema de acessibilidade.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  // A transferência entre moedas fica fora do mês.
  await page.goto("/app/lancamentos");
  await expect(page.locator("tbody tr")).toHaveCount(1);
}

test("família com conta em dólar, no computador", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await journey(page, "desktop");
});

test("família com conta em dólar, em 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await journey(page, "mobile");
});

test("quem só tem conta em real não vê moeda nenhuma", async ({ page }) => {
  await signUp(page, "Rui");
  await newAccount(page, "Banco", "BRL", "Saldo inicial (R$)", "500,00");
  await expect(card(page, "Banco")).toContainText("R$ 500,00");
  await expect(card(page, "Banco")).not.toContainText("≈");
  await expect(page.getByText(/cotação/)).toHaveCount(0);
});
