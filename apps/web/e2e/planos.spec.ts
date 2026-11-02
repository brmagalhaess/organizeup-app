// Aposentadoria com cenários e viagens com custo, aporte mensal e calendário.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newCpf } from "./documents";

const password = "senha-segura-123!";

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

test("cenário de aposentadoria", async ({ page, browser }) => {
  await signUp(page, "Rui");
  await page.goto("/app/aposentadoria");
  await expect(page.getByText("Monte o primeiro cenário")).toBeVisible();

  await page.getByRole("button", { name: "Novo cenário" }).click();
  const form = page.getByRole("dialog", { name: "Novo cenário" });
  await form.getByLabel("Nome do cenário").fill("Parar aos 60");
  const year = new Date().getFullYear() - 40;
  await form.getByLabel("Mês e ano de nascimento").fill(`${year}-01`);
  await form.getByLabel("Parar aos").fill("60");
  await form.getByLabel("Planejar até os").fill("60");
  await form.getByLabel("Renda desejada por mês (R$)").fill("6.000,00");
  await form.getByLabel("INSS e outras rendas por mês (R$)").fill("2.000,00");
  await form.getByLabel("Já guardado (R$)").fill("10.000,00");
  await form.getByLabel("Quanto você guarda por mês (R$)").fill("500,00");
  await form.getByRole("button", { name: "Salvar cenário" }).click();
  await expect(form.getByText("Planeje até uma idade maior que a de parar.")).toBeVisible();

  // Erro não apaga o que já foi preenchido.
  await expect(form.getByLabel("Nome do cenário")).toHaveValue("Parar aos 60");
  await form.getByLabel("Planejar até os").fill("90");
  await form.getByRole("button", { name: "Salvar cenário" }).click();
  await expect(form).toBeHidden();

  await expect(page.getByRole("heading", { name: "Parar aos 60" })).toBeVisible();
  await expect(page.getByText("Aporte que fecha a conta")).toBeVisible();
  await expect(page.getByText("Renda que o plano sustenta")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Aos 60 anos:/ })).toBeVisible();

  // Editar para um plano que fecha.
  await page.getByRole("button", { name: "Editar Parar aos 60" }).click();
  const edit = page.getByRole("dialog", { name: "Editar cenário" });
  await edit.getByLabel("Quanto você guarda por mês (R$)").fill("9.000,00");
  await edit.getByRole("button", { name: "Salvar cenário" }).click();
  await expect(page.getByText("O plano fecha")).toBeVisible();

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Lia");
  await page2.goto("/app/aposentadoria");
  await expect(page2.getByText("Parar aos 60")).toHaveCount(0);
  await other.close();
});

test("viagem com custos, aporte mensal e calendário", async ({ page }) => {
  await signUp(page, "Tom");
  await page.goto("/app/familia");
  await page.getByRole("button", { name: "Adicionar pessoa" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Lia");
  await page.getByRole("button", { name: "Salvar pessoa" }).click();
  await expect(
    page.getByRole("list", { name: "Pessoas da família" }).getByText("Lia"),
  ).toBeVisible();

  await page.goto("/app/viagens");
  await expect(page.getByText("Qual é a próxima viagem?")).toBeVisible();

  const start = new Date();
  start.setDate(15);
  start.setMonth(start.getMonth() + 4);
  const startOn = start.toISOString().slice(0, 10);

  await page.getByRole("button", { name: "Nova viagem" }).click();
  const form = page.getByRole("dialog", { name: "Nova viagem" });
  await form.getByLabel("Destino").fill("Gramado");
  await form.getByLabel("Ida").fill(startOn);
  await form.getByRole("button", { name: "Salvar viagem" }).click();
  await expect(page.getByRole("heading", { name: "Gramado" })).toBeVisible();
  await expect(page.getByText(/Adicione os custos/)).toBeVisible();

  await page.getByRole("button", { name: "Adicionar custo em Gramado" }).click();
  let cost = page.getByRole("dialog", { name: "Novo custo" });
  await cost.getByLabel("Valor (R$)").fill("1.000,00");
  await cost.getByLabel("Este valor é por pessoa").check();
  await cost.getByRole("button", { name: "Salvar custo" }).click();
  await expect(page.getByText("R$ 2.000,00").first()).toBeVisible();

  await page.getByRole("button", { name: "Adicionar custo em Gramado" }).click();
  cost = page.getByRole("dialog", { name: "Novo custo" });
  await cost.getByLabel("Tipo").selectOption("hospedagem");
  await cost.getByLabel("Valor (R$)").fill("2.000,00");
  await cost.getByRole("button", { name: "Salvar custo" }).click();
  await expect(page.getByText(/R\$\s1\.000,00 por mês|Guarde/).first()).toBeVisible();
  await expect(page.getByText(/por mês, por 4 meses/)).toBeVisible();
  await expect(page.getByText(/R\$\s2\.000,00 por pessoa/)).toBeVisible();

  await page.getByRole("button", { name: "Registrar valor guardado em Gramado" }).click();
  const saved = page.getByRole("dialog", { name: "Valor guardado" });
  await saved.getByLabel("Quanto você separou (R$)").fill("4.000,00");
  await saved.getByRole("button", { name: "Registrar valor" }).click();
  await expect(page.getByText("Viagem já coberta.")).toBeVisible();

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // A data aparece no calendário do mês da viagem, e sai junto com a viagem.
  const month = startOn.slice(0, 7);
  await page.goto(`/app/calendario?m=${month}`);
  await expect(page.getByRole("list", { name: "Itens do dia" })).toContainText("Viagem: Gramado");
  await expect(page.getByRole("list", { name: "Itens do dia" })).toContainText("Viagem");
  await expect(
    page.getByRole("group", { name: "Filtrar por tipo" }).getByRole("button", { name: /^Viagem/ }),
  ).toContainText("1");

  await page.goto("/app/viagens");
  await page.getByRole("button", { name: "Excluir Gramado" }).click();
  await page
    .getByRole("dialog", { name: "Excluir viagem" })
    .getByRole("button", { name: "Excluir" })
    .click();
  await expect(page.getByText("Qual é a próxima viagem?")).toBeVisible();
  await page.goto(`/app/calendario?m=${month}`);
  await expect(page.getByText("Viagem: Gramado")).toHaveCount(0);
});
