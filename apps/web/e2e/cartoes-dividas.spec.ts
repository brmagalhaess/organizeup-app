// Fluxo de cartão e dívida: compra parcelada, fatura no mês, pagamento e ordem de quitação.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const password = "senha-segura-123!";

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

async function addDebt(
  page: Page,
  debt: { name: string; balance: string; rate: string; installments: string },
) {
  await page.getByRole("button", { name: /^(Cadastrar dívida|Nova dívida)$/ }).click();
  const dialog = page.getByRole("dialog", { name: "Nova dívida" });
  await dialog.getByLabel("Nome da dívida").fill(debt.name);
  await dialog.getByLabel("Saldo devedor hoje (R$)").fill(debt.balance);
  await dialog.getByLabel("Juros ao mês (%)").fill(debt.rate);
  await dialog.getByLabel("Parcelas que faltam").fill(debt.installments);
  await dialog.getByRole("button", { name: "Salvar dívida" }).click();
  await expect(dialog).toBeHidden();
}

const total = (page: Page, label: string) =>
  page.locator("dl > div").filter({ hasText: label }).locator("dd");

test("compra parcelada entra na fatura e a fatura paga sai da conta", async ({ page, browser }) => {
  await signUp(page, "Caio");
  await page.goto("/app/cartoes");
  await page.getByRole("button", { name: "Cadastrar cartão" }).click();
  const form = page.getByRole("dialog", { name: "Novo cartão" });
  await form.getByLabel("Nome do cartão").fill("Cartão de teste");
  await form.getByLabel("Dia do fechamento").fill("25");
  await form.getByLabel("Dia do vencimento").fill("5");
  await form.getByLabel("Limite (R$)").fill("3.000,00");
  await form.getByRole("button", { name: "Salvar cartão" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("list", { name: "Cartões" })).toContainText("Cartão de teste");

  await page.getByRole("button", { name: "Nova compra" }).click();
  const entry = page.getByRole("dialog", { name: "Novo lançamento" });
  await entry.getByLabel("Descrição").fill("Geladeira parcelada");
  await entry.getByLabel("Valor (R$)").fill("1.200,00");
  await entry.getByLabel("Parcelas").fill("3");
  await entry.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(entry).toBeHidden();

  const compras = page.getByRole("table", { name: "Compras da fatura" });
  await expect(compras).toContainText("Geladeira parcelada");
  await expect(compras).toContainText("Parcela 1 de 3");
  await expect(compras).toContainText("400,00");
  await expect(page.getByRole("list", { name: "Cartões" })).toContainText("1.800,00");

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // A parcela seguinte está na próxima fatura.
  await page.getByRole("link", { name: "Próxima fatura" }).click();
  await expect(compras).toContainText("Parcela 2 de 3");
  await page.getByRole("link", { name: "Fatura anterior" }).click();
  await expect(compras).toContainText("Parcela 1 de 3");

  // Pagar a fatura debita a conta e bloqueia a exclusão da compra.
  await page.getByRole("button", { name: "Pagar fatura" }).click();
  await expect(page.getByText("Paga", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Excluir Geladeira parcelada" })).toHaveCount(0);
  await page.goto("/app/contas");
  await expect(page.getByRole("list", { name: "Contas" })).toContainText("-R$");
  await expect(page.getByRole("list", { name: "Contas" })).toContainText("400,00");

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Duda");
  await page2.goto("/app/cartoes");
  await expect(page2.getByText("Cartão de teste")).toHaveCount(0);
  await other.close();
});

test("dívidas entram nos vencimentos e mostram o que pagar primeiro", async ({ page }) => {
  await signUp(page, "Eva");
  await page.goto("/app/dividas");
  await expect(page.getByText("Nenhuma dívida cadastrada")).toBeVisible();

  await addDebt(page, {
    name: "Empréstimo do banco",
    balance: "10.000,00",
    rate: "2",
    installments: "12",
  });
  await addDebt(page, { name: "Loja", balance: "600,00", rate: "1", installments: "6" });

  const list = page.getByRole("list", { name: "Dívidas" });
  await expect(list).toContainText("0 de 12 parcelas pagas");
  await expect(total(page, "Falta pagar")).toContainText("10.600,00");

  // Fórmula de prestações iguais: 10.000 a 2% em 12 meses = 945,60.
  await page.getByRole("button", { name: "Ver parcelas de Empréstimo do banco" }).click();
  const schedule = page.getByRole("dialog", { name: "Empréstimo do banco" });
  await expect(schedule).toContainText("945,60");
  await schedule.getByRole("button", { name: "Fechar" }).click();

  const avalanche = page.getByRole("region", { name: "Maiores juros primeiro" });
  const snowball = page.getByRole("region", { name: "Menor dívida primeiro" });
  await page.getByLabel("Quanto a mais por mês (R$)").fill("300,00");
  await expect(avalanche).toContainText("Comece por Empréstimo do banco");
  await expect(snowball).toContainText("Comece por Loja");

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // Pagar a parcela aparece como lançamento; apagar o lançamento reabre a parcela.
  const card = list.getByRole("listitem").filter({ hasText: "Empréstimo do banco" });
  await card.getByRole("button", { name: "Pagar" }).click();
  await expect(card).toContainText("1 de 12 parcelas pagas");

  await page.goto("/app/lancamentos");
  const row = page.getByRole("row").filter({ hasText: "Empréstimo do banco (1/12)" });
  await expect(row).toContainText("Pago");
  await expect(page.getByRole("row").filter({ hasText: "Loja (1/6)" })).toContainText("Previsto");
  await row
    .getByRole("button", { name: /^Excluir/ })
    .locator("visible=true")
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
  await expect(row).toContainText("Previsto");

  await page.goto("/app/dividas");
  await expect(list).toContainText("0 de 12 parcelas pagas");
});
