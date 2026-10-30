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
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Nome da família").fill(`Família ${name}`);
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function addEntry(
  page: Page,
  entry: {
    kind?: "Receita";
    description: string;
    amount: string;
    repeat?: boolean;
    open?: boolean;
  },
) {
  if (entry.kind) await page.getByText("Receita", { exact: true }).click();
  await page.getByLabel("Descrição").fill(entry.description);
  await page.getByLabel("Valor (R$)").fill(entry.amount);
  if (entry.repeat) await page.getByLabel("Repete todo mês").check();
  if (entry.open) await page.getByLabel("Já foi pago ou recebido").uncheck();
  await page.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(page.getByRole("list", { name: "Lançamentos do mês" })).toContainText(
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
  await page.goto("/app/mes");
  await expect(page.getByText(/Nada por aqui/)).toBeVisible();

  await addEntry(page, { kind: "Receita", description: "Salário de teste", amount: "5.000,00" });
  await page.getByText("Despesa", { exact: true }).click();
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

  const rent = page.getByRole("listitem").filter({ hasText: "Aluguel confidencial" });
  await rent.getByRole("button", { name: "Marcar como pago" }).click();
  await expect(total(page, "Saiu")).toContainText("2.734,56");
  await expect(rent.getByRole("button", { name: "Excluir" })).toBeVisible();

  // A previsão continua no mês seguinte, ainda não paga.
  await page.getByRole("link", { name: "Próximo mês" }).click();
  await expect(page.getByText("Aluguel confidencial")).toBeVisible();
  await expect(total(page, "Previsão para o fim do mês")).toContainText("1.500,00");

  await page.goto("/app");
  await expect(total(page, "Entrou")).toContainText("5.000,00");

  await page.goto("/app/contas");
  await expect(page.getByRole("list", { name: "Contas" })).toContainText("2.265,44");

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Bia");
  await page2.goto("/app/mes");
  await expect(page2.getByText("Aluguel confidencial")).toHaveCount(0);
  await expect(page2.getByText(/Nada por aqui/)).toBeVisible();
  await other.close();
});
