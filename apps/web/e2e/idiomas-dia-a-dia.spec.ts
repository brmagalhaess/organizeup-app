// Telas do dia a dia em inglês e espanhol (ADR-0020): cada uma abre traduzida, sem texto português comum,
// sem violação de acessibilidade e sem transbordo em 375 px. Com E2E_SHOTS, grava as telas mais densas.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const password = "senha-segura-123!";
const shots = process.env.E2E_SHOTS;

function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function signUpAndCreateFamily(page: Page, name: string) {
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("E-mail").fill(uniqueEmail(name.toLowerCase()));
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Nome da família").fill(`Família ${name}`);
  await page.getByLabel("Cidade onde moram").fill("Campinas");
  await page.getByLabel("UF").fill("sp");
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function chooseLanguage(page: Page, locale: string, heading: string, label = "Idioma") {
  await page.goto("/app/configuracoes");
  await page.getByLabel(label, { exact: true }).selectOption(locale);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

const SETTINGS = { en: "Settings", es: "Configuración" };

/** Rótulo curto das telas. "Cancelar" e "Editar" também são espanhol. */
const PORTUGUESE = {
  en: /\b(Salvar|Cancelar|Excluir|Editar|Descrição|Lançamentos|Nenhum|Nenhuma|Conferir)\b/,
  es: /\b(Salvar|Excluir|Descrição|Lançamentos|Nenhum|Nenhuma|Conferir)\b/,
};

const SCREENS: Array<{ path: string; en: string | RegExp; es: string | RegExp }> = [
  { path: "/app/lancamentos", en: /^[A-Z][a-z]+ \d{4}$/, es: /^[A-Za-z]+ de \d{4}$/ },
  { path: "/app/contas", en: /^R\$/, es: /R\$$/ },
  { path: "/app/cartoes", en: "Credit cards", es: "Tarjetas de crédito" },
  { path: "/app/dividas", en: "Debts and loans", es: "Deudas y préstamos" },
  { path: "/app/dividas/importar", en: "Import a debt file", es: "Importar archivo de deudas" },
  { path: "/app/categorias", en: "Categories", es: "Categorías" },
  { path: "/app/importar", en: "Bring in your bank statement", es: "Trae el extracto del banco" },
  { path: "/app/renda", en: "How much comes in each month", es: "Cuánto entra al mes" },
  { path: "/app/calendario", en: /^[A-Z][a-z]+ \d{4}$/, es: /^[A-Za-z]+ de \d{4}$/ },
  { path: "/app/sugestoes", en: "Suggestions", es: "Sugerencias" },
  {
    path: "/app/novo-household",
    en: "Create your family's space",
    es: "Crea el espacio de tu familia",
  },
  { path: "/app/completar", en: /^Step 1 of 4/, es: /^Paso 1 de 4/ },
  { path: "/app/completar?passo=2", en: /^Step 2 of 4/, es: /^Paso 2 de 4/ },
  { path: "/app/completar?passo=3", en: /^Step 3 of 4/, es: /^Paso 3 de 4/ },
  { path: "/app/completar?passo=4", en: /^Step 4 of 4/, es: /^Paso 4 de 4/ },
];

async function expectScreen(page: Page, locale: "en" | "es", path: string) {
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("main")).not.toHaveAttribute("lang", "pt-BR");
  const text = await page.locator("main").innerText();
  expect(text, path).not.toMatch(PORTUGUESE[locale]);
  expect(text, path).not.toMatch(/\b(lancamentos|contas|cartoes|dividas|renda)\.[a-z]/);
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    a11y.violations.map((v) => v.id),
    path,
  ).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, path).toBeLessThanOrEqual(0);
}

/** Abre uma tela escolhendo o tamanho: no celular, o menor telefone que atendemos. */
async function narrow(page: Page, mobile: boolean) {
  if (mobile) await page.setViewportSize({ width: 375, height: 812 });
}

/** Renda, conta, dívidas, cartão e evento, para as telas abrirem cheias, em espanhol. */
async function fillFamilyInSpanish(page: Page) {
  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Nuevo ingreso" }).click();
  await page.getByLabel("Empresa").fill("Empresa Ejemplo");
  await page.getByLabel("Salario bruto (R$)").last().fill("5.500,00");
  await page.getByRole("button", { name: "Guardar ingreso" }).click();
  await expect(page.getByRole("heading", { name: "Empresa Ejemplo" })).toBeVisible();

  await page.goto("/app/dividas");
  for (const [name, balance] of [
    ["Préstamo del coche", "12.500,00"],
    ["Tarjeta de la tienda", "3.200,00"],
  ] as const) {
    await page.getByRole("button", { name: /Registrar deuda|Nueva deuda/ }).click();
    await page.getByLabel("Nombre de la deuda").fill(name);
    await page.getByLabel("Saldo pendiente hoy (R$)").fill(balance);
    await page.getByLabel("Interés mensual (%)").fill("2,15");
    await page.getByLabel("Cuotas restantes").fill("24");
    await page.getByRole("button", { name: "Guardar deuda" }).click();
    await expect(page.getByText(name).first()).toBeVisible();
  }

  await page.goto("/app/cartoes");
  await page.getByRole("button", { name: "Registrar tarjeta" }).click();
  await page.getByLabel("Nombre de la tarjeta").fill("Tarjeta azul");
  await page.getByLabel("Día de cierre").fill("20");
  await page.getByLabel("Día de vencimiento").fill("28");
  await page.getByRole("button", { name: "Guardar tarjeta" }).click();
  await expect(page.getByText("Tarjeta azul").first()).toBeVisible();
}

for (const locale of ["en", "es"] as const) {
  test(`telas do dia a dia em ${locale}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const mobile = testInfo.project.name === "mobile";
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await signUpAndCreateFamily(page, locale === "en" ? "Olivia" : "Lucia");
    await chooseLanguage(page, locale, SETTINGS[locale]);
    await narrow(page, mobile);

    for (const screen of SCREENS) {
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1, name: screen[locale] })).toBeVisible();
      await expectScreen(page, locale, screen.path);
    }
    expect(pageErrors).toEqual([]);
  });
}

test("as telas cheias em espanhol cabem em 375 px", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const mobile = testInfo.project.name === "mobile";
  await signUpAndCreateFamily(page, "Marta");
  await chooseLanguage(page, "es", SETTINGS.es);
  await narrow(page, mobile);
  await fillFamilyInSpanish(page);

  for (const path of ["/app/renda", "/app/dividas", "/app/cartoes", "/app/calendario"]) {
    await page.goto(path);
    await expectScreen(page, "es", path);
    if (shots && mobile) {
      const name = path.split("/").at(-1);
      await page.screenshot({ path: `${shots}/es-${name}.png`, fullPage: true });
    }
  }

  await page.goto("/app/dividas");
  await page.getByRole("button", { name: "Ver cuotas de Préstamo del coche" }).click();
  await expect(page.getByRole("dialog")).toContainText("Total de cuotas pendientes:");
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();

  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Nuevo ingreso" }).click();
  await expect(page.getByRole("dialog", { name: "Nuevo ingreso" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Enero" })).toBeAttached();
  if (shots && mobile) await page.screenshot({ path: `${shots}/es-renda-form.png` });
});

test("em inglês, 1,234.56 grava 1234.56 e volta para o campo no mesmo formato", async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  await signUpAndCreateFamily(page, "Peter");
  await chooseLanguage(page, "en", SETTINGS.en);

  await page.goto("/app/lancamentos");
  await page
    .getByRole("button", { name: mobile ? "Add" : "New transaction" })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "New transaction" });
  await dialog.getByLabel("Description").fill("Groceries");
  await expect(dialog.getByLabel("Amount (R$)")).toHaveAttribute("placeholder", "0.00");
  await dialog.getByLabel("Amount (R$)").fill("1,234.56");
  await dialog.getByRole("button", { name: "Save transaction" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("R$1,234.56").first()).toBeVisible();

  await page.getByRole("button", { name: "Edit Groceries" }).first().click();
  await expect(page.getByLabel("Amount (R$)")).toHaveValue("1234.56");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await chooseLanguage(page, "pt-BR", "Configurações", "Language");
  await page.goto("/app/lancamentos");
  await expect(page.getByText(/R\$\s1\.234,56/).first()).toBeVisible();
});

test("confirmar em conta estrangeira sem cotação avisa, e nada é pago", async ({ page }) => {
  await signUpAndCreateFamily(page, "Dora");
  await page.goto("/app/contas");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await page.getByLabel("Nome da conta").fill("Conta em dólar");
  await page.getByLabel("Moeda").selectOption("USD");
  await page.getByRole("button", { name: "Salvar conta" }).click();
  await expect(page.getByText("Conta em dólar").first()).toBeVisible();

  // Vencimento antes do histórico de cotações: só assim falta cotação depois do job de mercado.
  await page.goto("/app/dividas");
  await page.getByRole("button", { name: "Cadastrar dívida" }).click();
  await page.getByLabel("Nome da dívida").fill("Dívida antiga");
  await page.getByLabel("Saldo devedor hoje (R$)").fill("1.000,00");
  await page.getByLabel("Parcelas que faltam").fill("2");
  await page.getByLabel("Próximo vencimento").fill("2001-01-10");
  await page.getByLabel("Conta que paga as parcelas").selectOption({ label: "Conta em dólar" });
  await page.getByRole("button", { name: "Salvar dívida" }).click();
  await expect(page.getByText("Dívida antiga").first()).toBeVisible();

  await page.getByRole("button", { name: "Pagar", exact: true }).click();
  const notice = page.getByRole("dialog", { name: "Ainda sem cotação" });
  await expect(notice).toContainText("Nada foi confirmado");
  await expect(notice).toContainText("10/01/2001");
  await notice.getByRole("button", { name: "Entendi" }).click();
  await expect(notice).toBeHidden();
  await expect(page.getByRole("button", { name: "Pagar", exact: true })).toBeVisible();
  await expect(page.getByText("0 de 2 parcelas pagas")).toBeVisible();
});
