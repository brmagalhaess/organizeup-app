// Metas: cadastro, estado do plano, valor guardado, pausa e isolamento entre famílias.
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

test("com renda, a meta vira plano, entra nos lançamentos e guardar soma na meta", async ({
  page,
}) => {
  await signUp(page, "Bia");
  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Cadastrar renda" }).click();
  const income = page.getByRole("dialog", { name: "Nova renda" });
  await income.getByLabel("Tipo de renda").selectOption("aluguel");
  await income.getByLabel("De onde vem").fill("Aluguel da sala");
  await income.getByLabel("Valor que cai na conta (R$)").fill("5.000,00");
  await income.getByLabel("Dia do pagamento").fill("31");
  await income.getByRole("button", { name: "Salvar renda" }).click();
  await expect(income).toBeHidden();

  await page.goto("/app/metas");
  await page.getByRole("button", { name: "Criar meta" }).click();
  const form = page.getByRole("dialog", { name: "Nova meta" });
  await form.getByLabel("Nome da meta").fill("Moto");
  await form.getByLabel("Tipo").selectOption({ label: "Carro ou moto" });
  await form.getByLabel("Valor (R$)").fill("4.500,00");
  await form.getByRole("button", { name: "Salvar meta" }).click();
  await expect(form).toBeHidden();

  // Sobra 5.000 − 10% de folga = 4.500; sem reserva a formar e sem plano de aposentadoria, metade
  // fica para metas: 2.250 por mês, em duas parcelas.
  await expect(page.getByText(/Guarde R\$\s2\.250,00 por mês/)).toBeVisible();

  // Dia 5 já passou? A primeira parcela é do mês seguinte.
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + (now.getDate() > 5 ? 1 : 0), 1);
  const month = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}`;
  await page.goto(`/app/lancamentos?m=${month}`);
  await expect(page.getByText(/Meta: Moto \(1\/2\)/).first()).toBeVisible();
  await page
    .getByRole("button", { name: /Guardar/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /Guardar/ })).toHaveCount(0);

  await page.goto("/app/metas");
  await expect(page.getByRole("progressbar", { name: /Moto/ })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
});

test("meta do cadastro ao plano", async ({ page, browser }) => {
  await signUp(page, "Ana");
  await page.goto("/app/metas");
  await expect(page.getByText("Qual é o próximo sonho da família?")).toBeVisible();

  let a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole("button", { name: "Criar meta" }).click();
  const form = page.getByRole("dialog", { name: "Nova meta" });
  await form.getByLabel("Nome da meta").fill("Trocar de carro");
  await form.getByLabel("Tipo").selectOption({ label: "Carro ou moto" });
  await form.getByLabel("Valor (R$)").fill("abc");
  await form.getByRole("button", { name: "Salvar meta" }).click();
  await expect(form.getByText("Informe o valor como 50.000,00.")).toBeVisible();

  // Erro não apaga o que já foi preenchido.
  await expect(form.getByLabel("Nome da meta")).toHaveValue("Trocar de carro");
  await form.getByLabel("Valor (R$)").fill("40.000,00");
  await expect(form.getByLabel("Dia do mês para guardar")).toHaveValue("5");
  await expect(form.getByLabel("De onde sai")).not.toHaveValue("");
  await form.getByRole("button", { name: "Salvar meta" }).click();
  await expect(form).toBeHidden();

  await expect(page.getByRole("heading", { name: "Trocar de carro" })).toBeVisible();
  // Família recém-criada não tem renda nem despesas: o plano sai na hora e não inventa número.
  await expect(page.getByText("Sem espaço no orçamento")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /Trocar de carro/ })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );

  await page.getByRole("button", { name: "Recalcular agora" }).click();
  await expect(page.getByText("Plano atualizado.")).toBeVisible();

  await page.getByRole("button", { name: "Registrar valor guardado em Trocar de carro" }).click();
  const saved = page.getByRole("dialog", { name: "Valor guardado" });
  await saved.getByLabel("Quanto você separou (R$)").fill("10.000,00");
  await saved.getByRole("button", { name: "Registrar valor" }).click();
  await expect(saved).toBeHidden();
  await expect(page.getByRole("progressbar", { name: /Trocar de carro/ })).toHaveAttribute(
    "aria-valuenow",
    "25",
  );

  // Sem conta destino, o guardado entra no patrimônio.
  await page.goto("/app/patrimonio");
  await expect(page.getByRole("list", { name: "Metas" })).toContainText("R$ 10.000,00");

  await page.goto("/app/metas");
  await page.getByRole("button", { name: "Pausar Trocar de carro" }).click();
  await expect(page.getByText("Pausada")).toBeVisible();
  await page.getByRole("button", { name: "Retomar Trocar de carro" }).click();
  await expect(page.getByText("Sem espaço no orçamento")).toBeVisible();

  await page.getByRole("button", { name: "Editar Trocar de carro" }).click();
  const edit = page.getByRole("dialog", { name: "Editar meta" });
  await edit.getByLabel("Nome da meta").fill("Carro novo");
  await edit.getByRole("button", { name: "Salvar meta" }).click();
  await expect(page.getByRole("heading", { name: "Carro novo" })).toBeVisible();

  a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  const width = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(width[0]).toBeLessThanOrEqual(width[1]!);

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Bia");
  await page2.goto("/app/metas");
  await expect(page2.getByText("Carro novo")).toHaveCount(0);
  await other.close();

  await page.getByRole("button", { name: "Excluir Carro novo" }).click();
  await page
    .getByRole("dialog", { name: "Excluir meta" })
    .getByRole("button", { name: "Excluir" })
    .click();
  await expect(page.getByText("Qual é o próximo sonho da família?")).toBeVisible();
});

test("reserva guarda quanto separar por mês sem mudar o gasto essencial", async ({ page }) => {
  await signUp(page, "Eva");
  await page.goto("/app/reserva");
  await page.getByRole("button", { name: "Informar gasto essencial" }).click();
  const form = page.getByRole("dialog", { name: "Gasto essencial" });
  await form.getByLabel("Gasto essencial por mês (R$)").fill("1.000,00");
  await form.getByRole("button", { name: "Salvar gasto essencial" }).click();
  await expect(form).toBeHidden();

  await page.getByLabel("Quanto consigo guardar por mês (R$)").fill("500,00");
  await page.getByRole("button", { name: "Salvar quanto guardar por mês" }).click();
  await expect(page.getByRole("button", { name: "Salvar quanto guardar por mês" })).toBeHidden();

  await page.reload();
  await expect(page.getByText(/de R\$\s1\.000,00 por mês/)).toBeVisible();
  // Falta 6.000,00 guardando 500,00 por mês.
  await expect(page.getByLabel("Quanto consigo guardar por mês (R$)")).toHaveValue("500,00");
  await expect(page.getByText(/daqui a 12 meses/)).toBeVisible();
});
