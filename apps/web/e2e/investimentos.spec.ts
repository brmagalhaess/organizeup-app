// Carteira, preço médio, metas por classe, proventos e reflexo no patrimônio.
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

async function newInvestment(page: Page, name: string, assetClass: string, ticker = "") {
  await page.getByRole("button", { name: "Novo investimento" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo investimento" });
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByLabel("Classe").selectOption(assetClass);
  await dialog.getByLabel("Código").fill(ticker);
  await dialog.getByRole("button", { name: "Salvar investimento" }).click();
  await expect(
    page.getByRole("list", { name: "Carteira", exact: true }).getByText(name),
  ).toBeVisible();
}

const tile = (page: Page, label: string) =>
  page
    .locator("dl > div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("dd");

test("carteira, proventos e patrimônio", async ({ page, browser }) => {
  await signUp(page, "Iara");
  await page.goto("/app/proventos");
  await expect(page.getByText("Primeiro, um investimento")).toBeVisible();

  await page.goto("/app/investimentos");
  await expect(page.getByText("Sua carteira começa aqui")).toBeVisible();
  await newInvestment(page, "Banco Exemplo", "acao", "exmp3");
  await expect(page.getByText("EXMP3")).toBeVisible();

  // Duas compras: 100 × 10 + 5 de taxa e 100 × 12 dão preço médio de 11,025.
  for (const [quantity, price, fees] of [
    ["100", "10,00", "5,00"],
    ["100", "12,00", ""],
  ] as const) {
    await page.getByRole("button", { name: "Registrar operação de Banco Exemplo" }).click();
    const dialog = page.getByRole("dialog", { name: "Registrar operação" });
    await dialog.getByLabel("Quantidade").fill(quantity);
    await dialog.getByLabel("Preço (R$)").fill(price);
    await dialog.getByLabel("Taxas (R$)").fill(fees);
    await dialog.getByRole("button", { name: "Salvar operação" }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(tile(page, "Custo")).toContainText("R$ 2.205,00");
  await expect(page.getByText("Sem valor atual: mostrando o custo.")).toBeVisible();

  // Venda maior que a posição é recusada.
  await page.getByRole("button", { name: "Registrar operação de Banco Exemplo" }).click();
  const selling = page.getByRole("dialog", { name: "Registrar operação" });
  await selling.getByLabel("Operação").selectOption("venda");
  await selling.getByLabel("Quantidade").fill("500");
  await selling.getByLabel("Preço (R$)").fill("15,00");
  await selling.getByRole("button", { name: "Salvar operação" }).click();
  await expect(selling.getByText("Você não tinha essa quantidade nessa data.")).toBeVisible();
  await selling.getByRole("button", { name: "Fechar" }).click();

  // Preço de hoje define o valor.
  await page.getByRole("button", { name: "Atualizar valor de Banco Exemplo" }).click();
  const pricing = page.getByRole("dialog", { name: "Atualizar valor" });
  await pricing.getByLabel("Preço de hoje (R$)").fill("15,00");
  await pricing.getByRole("button", { name: "Salvar valor" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "R$ 3.000,00" })).toBeVisible();
  await expect(tile(page, "Resultado")).toContainText("R$ 795,00");

  // Renda fixa vale o total informado, e o resgate baixa o aplicado na proporção.
  await newInvestment(page, "Tesouro Exemplo", "renda_fixa");
  await page.getByRole("button", { name: "Registrar operação de Tesouro Exemplo" }).click();
  const deposit = page.getByRole("dialog", { name: "Registrar operação" });
  await deposit.getByLabel("Valor (R$)").fill("1.000,00");
  await deposit.getByRole("button", { name: "Salvar operação" }).click();
  await expect(deposit).toBeHidden();
  await page.getByRole("button", { name: "Atualizar valor de Tesouro Exemplo" }).click();
  const statement = page.getByRole("dialog", { name: "Atualizar valor" });
  await statement.getByLabel("Valor total hoje (R$)").fill("1.100,00");
  await statement.getByRole("button", { name: "Salvar valor" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "R$ 4.100,00" })).toBeVisible();
  await page.getByRole("button", { name: "Registrar operação de Tesouro Exemplo" }).click();
  const redeem = page.getByRole("dialog", { name: "Registrar operação" });
  await redeem.getByLabel("Operação").selectOption("venda");
  await redeem.getByLabel("Valor (R$)").fill("550,00");
  await redeem.getByRole("button", { name: "Salvar operação" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "R$ 3.550,00" })).toBeVisible();
  await expect(tile(page, "Já realizado")).toContainText("R$ 50,00");

  // Meta por classe só compara.
  await page.getByRole("button", { name: "Metas", exact: true }).click();
  const targets = page.getByRole("dialog", { name: "Metas por classe" });
  await targets.getByLabel("Ações (%)").fill("90");
  await targets.getByLabel("Renda fixa (%)").fill("20");
  await targets.getByRole("button", { name: "Salvar metas" }).click();
  await expect(targets.getByText("A soma das metas passa de 100%.")).toBeVisible();
  await targets.getByLabel("Renda fixa (%)").fill("10");
  await targets.getByRole("button", { name: "Salvar metas" }).click();
  await expect(page.getByText(/Meta de 90%: R\$\s195,00 abaixo/)).toBeVisible();

  let a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // Provento entra líquido.
  await page.goto("/app/proventos");
  await page.getByRole("button", { name: "Novo provento" }).click();
  const dividend = page.getByRole("dialog", { name: "Novo provento" });
  await dividend.getByLabel("Investimento").selectOption({ label: "EXMP3" });
  await dividend.getByLabel("Tipo").selectOption("jcp");
  await dividend.getByLabel("Valor bruto (R$)").fill("100,00");
  await dividend.getByLabel("Imposto retido (R$)").fill("200,00");
  await dividend.getByRole("button", { name: "Salvar provento" }).click();
  await expect(dividend.getByText("O imposto não pode passar do valor bruto.")).toBeVisible();
  await dividend.getByLabel("Imposto retido (R$)").fill("15,00");
  await dividend.getByRole("button", { name: "Salvar provento" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "R$ 85,00" })).toBeVisible();

  await page.getByRole("button", { name: "Definir meta" }).click();
  const goal = page.getByRole("dialog", { name: "Meta de proventos" });
  await goal.getByLabel("Meta de renda por mês (R$)").fill("100,00");
  await goal.getByRole("button", { name: "Salvar meta" }).click();
  await expect(page.getByText("A média já cobre 7% da meta.")).toBeVisible();

  a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // O valor da carteira entra no patrimônio.
  await page.goto("/app/patrimonio");
  await expect(
    page.getByRole("list", { name: "Investimentos" }).getByText("R$ 3.550,00"),
  ).toBeVisible();

  // Outra família não vê nada.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Davi");
  await page2.goto("/app/investimentos");
  await expect(page2.getByText("Banco Exemplo")).toHaveCount(0);
  await other.close();
});
