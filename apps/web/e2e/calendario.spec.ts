// Calendário: vencimentos no dia certo, eventos, filtro, saldo previsto e pagamento pelo dia.
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

const today = () =>
  new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "numeric",
    month: "long",
  });

const itemsOfDay = (page: Page) => page.getByRole("list", { name: "Itens do dia" });

const typeFilter = (page: Page, label: RegExp) =>
  page.getByRole("group", { name: "Filtrar por tipo" }).getByRole("button", { name: label });

test("mostra vencimentos, marca evento, filtra e paga pelo dia", async ({ page, browser }) => {
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
  await expect(total(page, "Sai")).toContainText("1.500,00");
  await expect(total(page, "Sai")).toContainText(/A pagar R\$\s1\.500,00/);
  await expect(total(page, "Menor saldo")).toContainText("1.500,00");
  await expect(total(page, "Saldo final previsto")).toContainText("1.500,00");
  await expect(page.getByText(/seu saldo fica negativo/)).toBeVisible();

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // Hoje já vem aberto, com o tipo escrito por extenso.
  const items = itemsOfDay(page);
  await expect(items).toContainText("Aluguel secreto");
  await expect(items).toContainText("Conta");
  await expect(page.getByText(/Saldo previsto no fim do dia/)).toBeVisible();

  // Filtro por tipo esconde o que não é do tipo, sem mudar o saldo.
  await typeFilter(page, /^Evento/).click();
  await expect(typeFilter(page, /^Evento/)).toHaveAttribute("aria-pressed", "true");
  await expect(items).toBeHidden();
  await expect(page.getByText(/1 item está escondido pelo filtro/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp(`^${today()}, hoje, 0 itens`) }),
  ).toBeVisible();
  await typeFilter(page, /^Todos/).click();
  await expect(items).toContainText("Aluguel secreto");

  // Evento anual aparece no dia e no ano seguinte.
  await page.getByRole("button", { name: "Marcar evento" }).click();
  const form = page.getByRole("dialog", { name: "Novo evento" });
  await form.getByLabel("Nome do evento").fill("Aniversário da Bia");
  await form.getByLabel(/Repete todo ano/).check();
  await form.getByRole("button", { name: "Salvar evento" }).click();
  await expect(form).toBeHidden();
  await expect(items).toContainText("Aniversário da Bia");
  await expect(items).toContainText("Todo ano");
  await expect(items).toContainText("Evento");

  // Pagar pelo dia atualiza o mês sem sair da tela.
  await items.getByRole("button", { name: "Pagar" }).click();
  await expect(items).toContainText("Pago");
  await expect(total(page, "Sai")).toContainText(/A pagar R\$\s0,00/);
  await expect(page.getByText(/seu saldo fica negativo/)).toBeVisible();

  const a11yDay = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11yDay.violations.map((v) => v.id)).toEqual([]);

  const nextYear = new Date(
    new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }),
  );
  const ym = `${nextYear.getUTCFullYear() + 1}-${String(nextYear.getUTCMonth() + 1).padStart(2, "0")}`;
  await page.goto(`/app/calendario?m=${ym}`);
  await page.getByRole("button", { name: new RegExp(`^${today()},`) }).click();
  await expect(items).toContainText("Aniversário da Bia");

  // Setas e Hoje trocam de mês.
  await page.getByRole("link", { name: "Hoje" }).click();
  await expect(page).toHaveURL(/\/app\/calendario$/);
  await expect(items).toContainText("Aluguel secreto");
  await page.getByRole("link", { name: "Próximo mês" }).click();
  await expect(page).toHaveURL(/m=\d{4}-\d{2}$/);
  await page.getByRole("link", { name: "Mês anterior" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${today()}, hoje`) })).toBeVisible();

  // Lançar a partir do dia traz a data escolhida.
  await page.goto("/app/calendario");
  await page.getByRole("button", { name: "Lançar neste dia" }).click();
  await expect(page.getByRole("dialog", { name: "Novo lançamento" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Excluir Aniversário da Bia" }).click();
  await expect(items).not.toContainText("Aniversário da Bia");

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Sol");
  await page2.goto("/app/calendario");
  await expect(total(page2, "Sai")).toContainText("0,00");
  await expect(page2.getByText(/seu saldo fica negativo/)).toHaveCount(0);
  await expect(page2.getByText(/Nada marcado neste mês/)).toBeVisible();
  await other.close();
});

test("no celular cabe na tela e mostra a agenda do dia sem recarregar", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
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
  await expect(itemsOfDay(page)).toContainText("Internet");
  const width = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(width[0]).toBeLessThanOrEqual(width[1]!);

  // Trocar de dia não busca nada no servidor: a marca na página continua e a URL não muda.
  await page.evaluate(() => {
    (window as unknown as { semRecarregar: boolean }).semRecarregar = true;
  });
  const url = page.url();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const days = page.getByRole("list", { name: "Dias do mês" }).getByRole("button");
  const name = await days
    .and(page.locator('[aria-pressed="false"]'))
    .first()
    .getAttribute("aria-label");
  const other = page.getByRole("button", { name: name!, exact: true });
  await other.click();
  await expect(other).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("list", { name: "Itens do dia" })).toBeHidden();
  await expect(page.getByText("Nada marcado neste dia.")).toBeVisible();
  expect(page.url()).toBe(url);
  expect(requests).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { semRecarregar?: boolean }).semRecarregar),
  ).toBe(true);
});
