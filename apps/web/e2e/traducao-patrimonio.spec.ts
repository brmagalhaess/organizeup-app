// Plano, reserva, patrimônio, investimentos, proventos, metas, aposentadoria, viagens e família em
// inglês e espanhol: título traduzido, sem português, sem violação de acessibilidade e sem transbordo.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newCpf } from "./documents";

const password = "senha-segura-123!";
const PHONE = { width: 375, height: 812 };

async function signUp(page: Page, name: string) {
  const email = `${name.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Nome da família").fill(`Casa ${name}`);
  await page.getByLabel("Cidade onde moram").fill("Campinas");
  await page.getByLabel("UF").fill("sp");
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function chooseLanguage(page: Page, locale: string) {
  await page.goto("/app/configuracoes");
  await page.getByLabel("Idioma", { exact: true }).selectOption(locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

/** Dados nas telas, ainda em português: é com eles que as telas ficam mais densas. */
async function seedFamily(page: Page) {
  await page.goto("/app/contas");
  await page.getByRole("button", { name: "Nova conta" }).click();
  const account = page.getByRole("dialog", { name: "Nova conta" });
  await account.getByLabel("Nome da conta").fill("Banco Azul");
  await account.getByLabel("Saldo inicial (R$)").fill("20.000,00");
  await account.getByRole("button", { name: "Salvar conta" }).click();
  await expect(account).toBeHidden();

  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Cadastrar renda" }).click();
  const income = page.getByRole("dialog", { name: "Nova renda" });
  await income.getByLabel("Tipo de renda").selectOption("aluguel");
  await income.getByLabel("De onde vem").fill("Sala");
  await income.getByLabel("Valor que cai na conta (R$)").fill("5.000,00");
  await income.getByLabel("Dia do pagamento").fill("20");
  await income.getByRole("button", { name: "Salvar renda" }).click();
  await expect(income).toBeHidden();

  await page.goto("/app/investimentos");
  await page.getByRole("button", { name: "Novo investimento" }).click();
  const investment = page.getByRole("dialog", { name: "Novo investimento" });
  await investment.getByRole("button", { name: "Preencher à mão" }).click();
  await investment.getByLabel("Código").fill("exmp3");
  await investment.getByLabel("Nome").fill("Banco Exemplo");
  await investment.getByLabel("Quantidade").fill("100");
  await investment.getByLabel("Preço pago (R$)").fill("10,00");
  await investment.getByRole("button", { name: "Adicionar à carteira" }).click();
  await expect(investment).toBeHidden();

  await page.goto("/app/metas");
  await page.getByRole("button", { name: "Criar meta" }).click();
  const goal = page.getByRole("dialog", { name: "Nova meta" });
  await goal.getByLabel("Nome da meta").fill("Moto");
  await goal.getByLabel("Tipo").selectOption({ label: "Carro ou moto" });
  await goal.getByLabel("Valor (R$)").fill("4.500,00");
  await goal.getByRole("button", { name: "Salvar meta" }).click();
  await expect(goal).toBeHidden();

  const start = new Date();
  start.setDate(15);
  start.setMonth(start.getMonth() + 4);
  await page.goto("/app/viagens");
  await page.getByRole("button", { name: "Nova viagem" }).click();
  const trip = page.getByRole("dialog", { name: "Nova viagem" });
  await trip.getByLabel("Destino").fill("Gramado");
  await trip.getByLabel("Ida").fill(start.toISOString().slice(0, 10));
  await trip.getByRole("button", { name: "Salvar viagem" }).click();
  await expect(page.getByRole("heading", { name: "Gramado" })).toBeVisible();
}

type Language = "en" | "es";

/** Um texto da tela em cada idioma, de preferência o título, e o que não pode aparecer. */
const SCREENS: Array<{ path: string; text: Record<Language, string>; pt: string[] }> = [
  {
    path: "/app/plano",
    text: { en: "Your plan", es: "Tu plan" },
    pt: ["Seu plano", "Este mês", "Ver o plano"],
  },
  {
    path: "/app/reserva",
    text: { en: "Emergency fund", es: "Fondo de emergencia" },
    pt: ["Próximo passo", "Quanto falta", "gasto essencial"],
  },
  {
    path: "/app/patrimonio",
    text: { en: "What you own", es: "Lo que tienes" },
    pt: ["O que você tem", "Novo bem", "Evolução"],
  },
  {
    path: "/app/investimentos",
    text: { en: "Portfolio", es: "Cartera" },
    pt: ["Sua carteira", "Custo", "Novo investimento"],
  },
  {
    path: "/app/investimentos/lancamentos",
    text: { en: "Transactions", es: "Movimientos" },
    pt: ["Lançamentos", "Nenhuma operação", "Saldo aplicado"],
  },
  {
    path: "/app/investimentos/balanceamento",
    text: { en: "Rebalancing", es: "Rebalanceo" },
    pt: ["Balanceamento", "Por classe", "Comparação"],
  },
  {
    path: "/app/proventos",
    text: { en: "Dividends", es: "Dividendos" },
    pt: ["Proventos", "Recebidos", "Média por mês"],
  },
  {
    path: "/app/metas",
    text: { en: "Family goals", es: "Metas de la familia" },
    pt: ["Guardando por mês", "Nova meta"],
  },
  {
    path: "/app/aposentadoria",
    text: { en: "How much to save to stop working", es: "Cuánto guardar para dejar de trabajar" },
    pt: ["Viver dos rendimentos", "Guarde por mês", "Cenário"],
  },
  {
    path: "/app/viagens",
    text: { en: "Family trips", es: "Viajes de la familia" },
    pt: ["Nova viagem", "Falta guardar", "Passagens"],
  },
  {
    path: "/app/familia",
    text: { en: "Family members", es: "Personas de la familia" },
    pt: ["Adicionar pessoa", "Quem acessa", "Casamento"],
  },
];

/** Letras e palavras que não existem nos outros dois idiomas. O seed não usa nenhuma delas. */
const PORTUGUESE = /[ãõç]|\b(você|não|nenhum|nenhuma|salvar|adicionar|apagar|cadastrar)\b/i;

for (const language of ["en", "es"] as const) {
  test(`as telas do patrimônio e da família em ${language}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await signUp(page, language === "en" ? "Olivia" : "Lucia");
    await seedFamily(page);
    await chooseLanguage(page, language);
    await page.setViewportSize(PHONE);

    for (const screen of SCREENS) {
      await test.step(screen.path, async () => {
        await page.goto(screen.path);
        const main = page.locator("main");
        await expect(main.getByText(screen.text[language], { exact: true }).first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(main).not.toHaveAttribute("lang", "pt-BR");

        const text = await main.innerText();
        expect(text).not.toMatch(PORTUGUESE);
        for (const phrase of screen.pt) expect(text).not.toContain(phrase);

        const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(a11y.violations.map((violation) => violation.id)).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);

        const name = screen.path.split("/").at(-1);
        await page.screenshot({
          path: testInfo.outputPath(`${language}-${name}.png`),
          fullPage: true,
        });
      });
    }
    expect(pageErrors).toEqual([]);
  });
}

test("compra digitada em inglês grava o valor certo", async ({ page }) => {
  await signUp(page, "Noah");
  await chooseLanguage(page, "en");

  await page.goto("/app/investimentos");
  await page.getByRole("button", { name: "New investment" }).click();
  const form = page.getByRole("dialog", { name: "New investment" });
  await form.getByRole("button", { name: "Fill in by hand" }).click();
  await form.getByLabel("Ticker").fill("exmp3");
  await form.getByLabel("Name").fill("Example Bank");
  await form.getByLabel("Quantity").fill("2");
  await form.getByLabel("Price paid (R$)").fill("1,234.56");
  await expect(form.getByText("Purchase total: R$2,469.12")).toBeVisible();
  await form.getByLabel("Fees (R$)").fill("0.50");
  await form.getByRole("button", { name: "Add to portfolio" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText("R$2,469.62").first()).toBeVisible();

  // Mais uma compra, com vírgula de milhar: 1.234 aqui seria um número pequeno, e 1,000.5 são mil.
  await page.getByRole("button", { name: "Record trade for Example Bank" }).click();
  const trade = page.getByRole("dialog", { name: "Record trade" });
  await trade.getByLabel("Quantity").fill("1,000.5");
  await trade.getByLabel("Price (R$)").fill("2");
  await trade.getByRole("button", { name: "Save trade" }).click();
  await expect(trade).toBeHidden();
  await expect(page.getByText("R$4,470.62").first()).toBeVisible();

  // O número com separador errado para o idioma não vira outro valor em silêncio.
  await page.goto("/app/investimentos/lancamentos");
  await expect(page.getByText("1,000.5").first()).toBeVisible();

  // Em português, a mesma família vê os mesmos valores no formato de sempre.
  await page.goto("/app/configuracoes");
  await page.getByLabel("Language", { exact: true }).selectOption("pt-BR");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await page.goto("/app/investimentos");
  await expect(page.getByText(/R\$\s4\.470,62/).first()).toBeVisible();
});

test("erro de validação sai no idioma da pessoa, com exemplo no formato dele", async ({ page }) => {
  await signUp(page, "Elena");
  await chooseLanguage(page, "es");
  await page.goto("/app/metas");
  await page.getByRole("button", { name: "Crear meta" }).click();
  const form = page.getByRole("dialog", { name: "Nueva meta" });
  await form.getByLabel("Nombre de la meta").fill("Moto");
  await form.getByLabel("Monto (R$)").fill("muchos");
  await form.getByRole("button", { name: "Guardar meta" }).click();
  await expect(form.getByText(/50\.000,00/)).toBeVisible();
  await expect(form).not.toContainText(PORTUGUESE);
});
