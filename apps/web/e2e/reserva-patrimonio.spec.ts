// Reserva de emergência e patrimônio líquido, somando contas, bens, dívidas e cartões.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const password = "senha-segura-123";

async function signUp(page: Page, name: string) {
  const email = `${name}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Nome da família").fill(`Família ${name}`);
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

const total = (page: Page, label: string) =>
  page.locator("dl > div").filter({ hasText: label }).locator("dd");

async function newAccount(page: Page, name: string, balance: string) {
  await page.goto("/app/contas");
  await page.getByRole("button", { name: "Nova conta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova conta" });
  await dialog.getByLabel("Nome da conta").fill(name);
  await dialog.getByLabel("Saldo inicial (R$)").fill(balance);
  await dialog.getByRole("button", { name: "Salvar conta" }).click();
  await expect(dialog).toBeHidden();
}

test("reserva mostra meta, progresso e prazo", async ({ page, browser }) => {
  await signUp(page, "Gil");
  await page.goto("/app/reserva");
  await expect(page.getByText("Falta saber seu gasto essencial")).toBeVisible();

  // Conta fixa em categoria essencial, ainda não paga: serve de estimativa no primeiro mês.
  await page
    .getByRole("button", { name: /^(Novo lançamento|Lançar)$/ })
    .first()
    .click();
  const entry = page.getByRole("dialog", { name: "Novo lançamento" });
  await entry.getByLabel("Descrição").fill("Aluguel secreto");
  await entry.getByLabel("Valor (R$)").fill("3.000,00");
  await entry.getByLabel("Repete todo mês").check();
  await entry.getByLabel(/^Já foi/).uncheck();
  await entry.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(entry).toBeHidden();

  await newAccount(page, "Poupança da reserva", "9.000,00");
  await page.goto("/app/reserva");
  await expect(total(page, "Gasto essencial por mês")).toContainText("3.000,00");
  await expect(total(page, "Gasto essencial por mês")).toContainText("Estimativa");
  await expect(total(page, "Meta")).toContainText("18.000,00");
  await expect(page.getByText("Nenhuma conta marcada")).toBeVisible();

  await page.getByRole("button", { name: "Ajustar reserva" }).click();
  const form = page.getByRole("dialog", { name: "Ajustar reserva" });
  await form.getByLabel(/Poupança da reserva/).check();
  await form.getByRole("button", { name: "Salvar reserva" }).click();
  await expect(form).toBeHidden();

  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByText("cobre 3 meses de gastos essenciais")).toBeVisible();
  await expect(total(page, "Falta")).toContainText("9.000,00");
  await page.getByLabel("Guardar por mês (R$)").fill("2.000,00");
  await expect(page.getByText(/Em 5 meses você chega à meta/)).toBeVisible();

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // Gasto informado substitui o calculado.
  await page.getByRole("button", { name: "Ajustar reserva" }).click();
  await form.getByLabel("Gasto essencial por mês (R$)").fill("1.000,00");
  await form.getByLabel("Meta em meses").fill("9");
  await form.getByRole("button", { name: "Salvar reserva" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText("Meta atingida")).toBeVisible();

  await page.goto("/app");
  await expect(page.getByRole("link", { name: /Reserva de emergência/ })).toContainText("100%");

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Lea");
  await page2.goto("/app/reserva");
  await expect(page2.getByText("Poupança da reserva")).toHaveCount(0);
  await other.close();
});

test("patrimônio soma bens e contas e tira dívidas e cartões", async ({ page, browser }) => {
  await signUp(page, "Noa");
  await newAccount(page, "Conta de teste", "2.000,00");

  await page.goto("/app/dividas");
  await page.getByRole("button", { name: "Cadastrar dívida" }).click();
  const debt = page.getByRole("dialog", { name: "Nova dívida" });
  await debt.getByLabel("Nome da dívida").fill("Financiamento secreto");
  await debt.getByLabel("Saldo devedor hoje (R$)").fill("30.000,00");
  await debt.getByLabel("Juros ao mês (%)").fill("1");
  await debt.getByLabel("Parcelas que faltam").fill("24");
  await debt.getByRole("button", { name: "Salvar dívida" }).click();
  await expect(debt).toBeHidden();

  await page.goto("/app/cartoes");
  await page.getByRole("button", { name: "Cadastrar cartão" }).click();
  const card = page.getByRole("dialog", { name: "Novo cartão" });
  await card.getByLabel("Nome do cartão").fill("Cartão de teste");
  await card.getByLabel("Dia do fechamento").fill("25");
  await card.getByLabel("Dia do vencimento").fill("5");
  await card.getByRole("button", { name: "Salvar cartão" }).click();
  await expect(card).toBeHidden();
  await page.getByRole("button", { name: "Nova compra" }).click();
  const entry = page.getByRole("dialog", { name: "Novo lançamento" });
  await entry.getByLabel("Descrição").fill("Sofá parcelado");
  await entry.getByLabel("Valor (R$)").fill("1.000,00");
  await entry.getByLabel("Parcelas").fill("4");
  await entry.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(entry).toBeHidden();

  await page.goto("/app/patrimonio");
  await page.getByRole("button", { name: "Novo bem" }).click();
  const asset = page.getByRole("dialog", { name: "Novo bem" });
  await asset.getByLabel("Nome do bem").fill("Apartamento secreto");
  await asset.getByLabel("Valor hoje (R$)").fill("100.000,00");
  await asset.getByLabel("Dívida ligada a este bem").selectOption({
    label: "Financiamento secreto",
  });
  await asset.getByRole("button", { name: "Salvar bem" }).click();
  await expect(asset).toBeHidden();

  await expect(total(page, "O que você tem")).toContainText("102.000,00");
  await expect(total(page, "O que você deve")).toContainText("31.000,00");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("71.000,00");
  await expect(page.getByRole("list", { name: "Bens" })).toContainText("Já é seu: R$ 70.000,00");
  await expect(page.getByRole("list", { name: "Cartões" })).toContainText("1.000,00");

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  const width = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(width[0]).toBeLessThanOrEqual(width[1]!);

  await page.goto("/app");
  await expect(page.getByRole("link", { name: /Patrimônio líquido/ })).toContainText("71.000,00");

  // Excluir o bem refaz a conta.
  await page.goto("/app/patrimonio");
  await page.getByRole("button", { name: "Excluir Apartamento secreto" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("29.000,00");

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Teo");
  await page2.goto("/app/patrimonio");
  await expect(page2.getByText("Financiamento secreto")).toHaveCount(0);
  await expect(page2.getByRole("heading", { level: 1 })).toContainText("0,00");
  await other.close();
});
