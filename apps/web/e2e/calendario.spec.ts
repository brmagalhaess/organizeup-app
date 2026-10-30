// Calendário: vencimentos no dia certo, compromissos, saldo previsto e pagamento pelo dia.
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

const total = (page: Page, label: string) =>
  page.locator("dl > div").filter({ hasText: label }).locator("dd");

const today = () =>
  new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "numeric",
    month: "long",
  });

const openToday = (page: Page) =>
  page.getByRole("button", { name: new RegExp(`^${today()}, hoje`) }).click();

test("mostra vencimentos, marca compromisso e paga pelo dia", async ({ page, browser }) => {
  await signUp(page, "Ivo");

  // Conta fixa vencendo hoje, ainda sem saldo: o mês fica negativo.
  await page
    .getByRole("button", { name: /^(Novo lançamento|Lançar)$/ })
    .first()
    .click();
  const entry = page.getByRole("dialog", { name: "Novo lançamento" });
  await entry.getByLabel("Descrição").fill("Aluguel secreto");
  await entry.getByLabel("Valor (R$)").fill("1.500,00");
  await entry.getByLabel("Repete todo mês").check();
  await entry.getByLabel(/^Já foi/).uncheck();
  await entry.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(entry).toBeHidden();

  await page.goto("/app/calendario");
  await expect(total(page, "A pagar")).toContainText("1.500,00");
  await expect(total(page, "Menor saldo previsto")).toContainText("1.500,00");
  await expect(page.getByText(/seu saldo fica negativo/)).toBeVisible();

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  await openToday(page);
  const day = page.getByRole("dialog");
  const items = day.getByRole("list", { name: "Itens do dia" });
  await expect(items).toContainText("Aluguel secreto");
  await expect(day.getByText(/Saldo previsto no fim do dia/)).toBeVisible();

  // Compromisso anual aparece no dia e no ano seguinte.
  await day.getByLabel("Novo compromisso").fill("Aniversário da Bia");
  await day.getByLabel(/Repete todo ano/).check();
  await day.getByRole("button", { name: "Salvar compromisso" }).click();
  await expect(items).toContainText("Aniversário da Bia");
  await expect(items).toContainText("Todo ano");

  const a11yDay = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11yDay.violations.map((v) => v.id)).toEqual([]);

  // Pagar pelo dia atualiza o mês.
  await items.getByRole("button", { name: "Pagar" }).click();
  await expect(items).toContainText("Pago");
  await day.getByRole("button", { name: "Fechar" }).click();
  await expect(total(page, "A pagar")).toContainText("0,00");

  const nextYear = new Date(
    new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }),
  );
  const ym = `${nextYear.getUTCFullYear() + 1}-${String(nextYear.getUTCMonth() + 1).padStart(2, "0")}`;
  await page.goto(`/app/calendario?m=${ym}`);
  await page.getByRole("button", { name: new RegExp(`^${today()},`) }).click();
  await expect(page.getByRole("dialog")).toContainText("Aniversário da Bia");
  await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).click();

  // Lançar a partir do dia traz a data escolhida.
  await page.goto("/app/calendario");
  await openToday(page);
  await page.getByRole("button", { name: "Lançar neste dia" }).click();
  await expect(page.getByRole("dialog", { name: "Novo lançamento" })).toBeVisible();
  await page.keyboard.press("Escape");

  await openToday(page);
  await page.getByRole("button", { name: "Excluir Aniversário da Bia" }).click();
  await expect(page.getByRole("list", { name: "Itens do dia" })).not.toContainText(
    "Aniversário da Bia",
  );

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Sol");
  await page2.goto("/app/calendario");
  await expect(total(page2, "A pagar")).toContainText("0,00");
  await expect(page2.getByText(/seu saldo fica negativo/)).toHaveCount(0);
  await other.close();
});

test("no celular cabe na tela e tem agenda do mês", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signUp(page, "Mel");
  await page
    .getByRole("button", { name: /^(Novo lançamento|Lançar)$/ })
    .first()
    .click();
  const entry = page.getByRole("dialog", { name: "Novo lançamento" });
  await entry.getByLabel("Descrição").fill("Internet");
  await entry.getByLabel("Valor (R$)").fill("100,00");
  await entry.getByLabel(/^Já foi/).uncheck();
  await entry.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(entry).toBeHidden();

  await page.goto("/app/calendario");
  await expect(page.getByRole("list", { name: "Agenda do mês" })).toContainText("Internet");
  const width = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(width[0]).toBeLessThanOrEqual(width[1]!);
});
