// Fluxo do módulo de receitas e despesas: lançar, recorrência, confirmar e isolamento.
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
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Nome da família").fill(`Família ${name}`);
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function addEntry(
  page: Page,
  entry: {
    income?: boolean;
    description: string;
    amount: string;
    repeat?: boolean;
    open?: boolean;
  },
) {
  await page
    .getByRole("button", { name: /^(Novo lançamento|Lançar)$/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Novo lançamento" });
  if (entry.income) await dialog.getByText("Receita", { exact: true }).click();
  await dialog.getByLabel("Descrição").fill(entry.description);
  await dialog.getByLabel("Valor (R$)").fill(entry.amount);
  if (entry.repeat) await dialog.getByLabel("Repete todo mês").check();
  if (entry.open) await dialog.getByLabel(/^Já foi/).uncheck();
  await dialog.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("table", { name: "Lançamentos do mês" })).toContainText(
    entry.description,
  );
}

const total = (page: Page, label: string) =>
  page.locator("dl > div").filter({ hasText: label }).locator("dd");

test("lança receitas e despesas, confirma previsão e mantém famílias separadas", async ({
  page,
  browser,
}) => {
  await signUp(page, "Lia");
  await expect(page.getByRole("heading", { name: "Primeiros passos" })).toBeVisible();
  await page.goto("/app/lancamentos");
  await expect(page.getByText(/Nada por aqui/)).toBeVisible();

  await addEntry(page, { income: true, description: "Salário de teste", amount: "5.000,00" });
  await addEntry(page, { description: "Mercado do mês", amount: "1.234,56" });
  await addEntry(page, {
    description: "Aluguel confidencial",
    amount: "1500",
    repeat: true,
    open: true,
  });

  await expect(total(page, "Entrou")).toContainText("5.000,00");
  await expect(total(page, "Saiu")).toContainText("1.234,56");
  await expect(total(page, "Sobrou até agora")).toContainText("3.765,44");
  await expect(total(page, "Previsão para o fim do mês")).toContainText("2.265,44");

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // Filtro por busca.
  await page.getByLabel("Buscar").fill("aluguel");
  await expect(page.getByRole("row").filter({ hasText: "Mercado do mês" })).toHaveCount(0);
  await page.getByLabel("Buscar").fill("");

  // Editar um lançamento pelo painel lateral.
  await page.getByRole("button", { name: "Editar Mercado do mês" }).click();
  const editor = page.getByRole("dialog", { name: "Editar lançamento" });
  await editor.getByLabel("Valor (R$)").fill("1.000,00");
  await editor.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(editor).toBeHidden();
  await expect(total(page, "Saiu")).toContainText("1.000,00");

  const rent = page.getByRole("row").filter({ hasText: "Aluguel confidencial" });
  await rent.getByRole("button", { name: "Pagar" }).click();
  await expect(total(page, "Saiu")).toContainText("2.500,00");
  await expect(rent.getByRole("button", { name: /^Excluir/ })).toBeVisible();

  // A previsão continua no mês seguinte, ainda não paga.
  await page.getByRole("link", { name: "Próximo mês" }).click();
  await expect(page.getByText("Aluguel confidencial")).toBeVisible();
  await expect(total(page, "Previsão para o fim do mês")).toContainText("1.500,00");

  await page.goto("/app");
  await expect(total(page, "Entrou")).toContainText("5.000,00");
  await expect(total(page, "Saldo nas contas")).toContainText("2.500,00");
  await expect(page.getByRole("list", { name: "Próximos vencimentos" })).toContainText(
    "Aluguel confidencial",
  );
  const pageWidth = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(pageWidth[0]).toBeLessThanOrEqual(pageWidth[1]!);
  const home = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(home.violations.map((v) => v.id)).toEqual([]);

  await page.goto("/app/contas");
  await expect(page.getByRole("list", { name: "Contas" })).toContainText("2.500,00");

  // Endereço antigo continua funcionando.
  await page.goto("/app/mes");
  await expect(page).toHaveURL(/\/app\/lancamentos$/);

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Bia");
  await page2.goto("/app/lancamentos");
  await expect(page2.getByText("Aluguel confidencial")).toHaveCount(0);
  await expect(page2.getByText(/Nada por aqui/)).toBeVisible();
  await other.close();
});

test("categorias e contas podem ser criadas e arquivadas", async ({ page }) => {
  await signUp(page, "Rui");

  await page.goto("/app/categorias");
  await page.getByRole("button", { name: "Nova categoria" }).click();
  await page.getByRole("dialog").getByLabel("Nome da categoria").fill("Pet");
  await page.getByRole("button", { name: "Salvar categoria" }).click();
  const expenses = page.getByRole("list", { name: "Despesas" });
  await expect(expenses.getByText("Pet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Arquivar Pet" }).click();
  await expect(expenses.getByText("Pet", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reativar Pet" })).toBeVisible();

  await page.goto("/app/contas");
  await page.getByRole("button", { name: "Nova conta" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome da conta").fill("Reserva da casa");
  await dialog.getByLabel("Saldo inicial (R$)").fill("1.000,00");
  await page.getByRole("button", { name: "Salvar conta" }).click();
  await expect(page.getByRole("list", { name: "Contas" })).toContainText("Reserva da casa");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("1.000,00");
});

test("no celular o menu abre pela barra inferior", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signUp(page, "Nina");
  await page.getByRole("button", { name: "Mais", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Menu" })
    .getByRole("link", { name: "Categorias" })
    .click();
  await expect(page).toHaveURL(/\/app\/categorias$/);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
