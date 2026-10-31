// Renda: simulador, cadastro CLT, previsão pelo líquido, 13º, férias e baixa no mês.
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

const total = (page: Page, label: string) =>
  page.locator("dl > div").filter({ hasText: label }).locator("dd");

/** O salário, sem a linha do 13º, que pode cair no mesmo dia. */
const salaryRow = (page: Page) =>
  page.getByRole("row").filter({ hasText: "Empresa Exemplo", hasNotText: "13º" });

const noOverflow = async (page: Page) => {
  const [scroll, inner] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(inner!);
};

/** Mês atual e o seguinte, no fuso do Brasil. */
function months() {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const [year, month] = today.split("-").map(Number) as [number, number];
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  return { current: ym(year, month), next: ym(next[0]!, next[1]!), calendarMonth: month, year };
}

test("simula, cadastra CLT e a renda entra no mês pelo líquido", async ({ page, browser }) => {
  await signUp(page, "Rita");
  await page.goto("/app/renda");
  await expect(page.getByText("Nenhuma renda cadastrada")).toBeVisible();
  await expect(page.getByText(/É uma estimativa/)).toBeVisible();

  // Mesmo caso do teste de regras: R$ 6.000,00 sem dependentes.
  await page.getByLabel("Salário bruto (R$)").fill("6.000,00");
  const simulator = page.getByRole("heading", { name: "Simulador de salário" }).locator("../../..");
  await expect(simulator).toContainText("641,51");
  await expect(simulator).toContainText("385,10");
  await expect(simulator).toContainText("4.973,39");
  await expect(simulator).toContainText("3.000,00");
  await noOverflow(page);

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole("button", { name: "Cadastrar esta renda" }).click();
  const form = page.getByRole("dialog", { name: "Nova renda" });
  await expect(form.getByLabel("Salário bruto (R$)")).toHaveValue("6.000,00");
  await form.getByLabel("Empresa").fill("Empresa Exemplo");
  // Dia 31 ainda não passou em nenhum mês: a renda já vale para o mês atual.
  await form.getByLabel("Dia do pagamento").fill("31");
  await form.getByRole("button", { name: "Salvar renda" }).click();
  await expect(form).toBeHidden();

  await expect(total(page, "Líquido por mês")).toContainText("4.973,39");
  await expect(total(page, "Descontos por mês")).toContainText("1.026,61");

  // Mês seguinte, para não depender do dia de hoje: entra pelo líquido, uma vez só.
  const { current, next } = months();
  await page.goto(`/app/lancamentos?m=${next}`);
  const row = salaryRow(page);
  await expect(row).toContainText("4.973,39");
  await expect(total(page, "Entrou")).toContainText("0,00");

  // Baixa pelo mesmo botão de sempre, e apagar devolve a previsão.
  await page.goto(`/app/lancamentos?m=${current}`);
  const entry = salaryRow(page);
  await entry.getByRole("button", { name: "Receber" }).locator("visible=true").click();
  await expect(total(page, "Entrou")).toContainText("4.973,39");
  await expect(entry).toContainText("Recebido");

  await entry
    .getByRole("button", { name: /^Excluir/ })
    .locator("visible=true")
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
  await expect(total(page, "Entrou")).toContainText("0,00");
  await expect(salaryRow(page)).toContainText("Receber");

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Davi");
  await page2.goto("/app/renda");
  await expect(page2.getByText("Empresa Exemplo")).toHaveCount(0);
  await expect(page2.getByText("Nenhuma renda cadastrada")).toBeVisible();
  await other.close();
});

test("pagamento que já passou não vira previsão atrasada", async ({ page }) => {
  const day = Number(
    new Date().toLocaleDateString("en-GB", { timeZone: "America/Sao_Paulo", day: "numeric" }),
  );
  test.skip(day === 1, "No dia 1 nenhum pagamento deste mês passou.");
  await signUp(page, "Tais");
  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Cadastrar renda" }).click();
  const form = page.getByRole("dialog", { name: "Nova renda" });
  await form.getByLabel("Empresa").fill("Loja Exemplo");
  await form.getByLabel("Salário bruto (R$)").fill("3.000,00");
  await form.getByLabel("Dia do pagamento").fill("1");
  await form.getByRole("button", { name: "Salvar renda" }).click();
  await expect(form).toBeHidden();

  await page.goto("/app/lancamentos");
  await expect(page.getByText(/Nada por aqui/)).toBeVisible();
  await page.goto(`/app/lancamentos?m=${months().next}`);
  await expect(page.getByRole("row").filter({ hasText: "Loja Exemplo" }).first()).toBeVisible();
});

test("13º e férias aparecem nos meses certos", async ({ page }) => {
  await signUp(page, "Beto");
  const { year, calendarMonth } = months();
  const vacationMonth = calendarMonth === 12 ? 1 : calendarMonth + 1;
  const vacationYear = calendarMonth === 12 ? year + 1 : year;

  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Cadastrar renda" }).click();
  const form = page.getByRole("dialog", { name: "Nova renda" });
  await form.getByLabel("Empresa").fill("Fábrica Exemplo");
  await form.getByLabel("Salário bruto (R$)").fill("3.000,00");
  await form.getByLabel("Mês das férias").selectOption(String(vacationMonth));
  await form.getByRole("button", { name: "Salvar renda" }).click();
  await expect(form).toBeHidden();

  await expect(page.getByRole("region", { name: "13º salário" }).first()).toBeVisible();
  await expect(page.getByText(/A Receita ainda não explicou/).first()).toBeVisible();

  const vacation = `${vacationYear}-${String(vacationMonth).padStart(2, "0")}`;
  await page.goto(`/app/lancamentos?m=${vacation}`);
  await expect(page.getByRole("row").filter({ hasText: "Férias · Fábrica Exemplo" })).toHaveCount(
    1,
  );

  const december = calendarMonth === 12 ? `${year + 1}-12` : `${year}-12`;
  await page.goto(`/app/lancamentos?m=${december}`);
  await expect(page.getByRole("row").filter({ hasText: "13º, 2ª parcela" })).toHaveCount(1);
});

test("outras rendas entram pelo valor informado", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signUp(page, "Lina");
  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Cadastrar renda" }).click();
  const form = page.getByRole("dialog", { name: "Nova renda" });
  await form.getByLabel("Tipo de renda").selectOption("aluguel");
  await expect(form.getByLabel("Dependentes")).toHaveCount(0);
  await form.getByLabel("De onde vem").fill("Aluguel da sala");
  await form.getByLabel("Valor que cai na conta (R$)").fill("1.500,00");
  await form.getByRole("button", { name: "Salvar renda" }).click();
  await expect(form).toBeHidden();
  await expect(total(page, "Líquido por mês")).toContainText("1.500,00");
  await noOverflow(page);

  await page.goto(`/app/lancamentos?m=${months().next}`);
  await expect(page.getByRole("row").filter({ hasText: "Aluguel da sala" }).first()).toContainText(
    "Aluguel recebido",
  );
  await page.goto("/app/renda");

  await page.getByRole("button", { name: "Excluir Aluguel da sala" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("Nenhuma renda cadastrada")).toBeVisible();
});
