import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const LANDINGS = [
  {
    path: "/",
    lang: "pt-BR",
    heading: "Organize o hoje",
    title: "OrganizeUp · O plano financeiro da sua família",
    description: /^Receitas, despesas/,
    badge: "Em construção",
    image: /Família de mãos dadas/,
    start: "Começar meu plano",
  },
  {
    path: "/en",
    lang: "en",
    heading: "Organize today",
    title: "OrganizeUp · Your family’s financial plan",
    description: /^Income, expenses/,
    badge: "In progress",
    image: /Family holding hands/,
    start: "Start my plan",
  },
  {
    path: "/es",
    lang: "es",
    heading: "Organiza el hoy",
    title: "OrganizeUp · El plan financiero de tu familia",
    description: /^Ingresos, gastos/,
    badge: "En construcción",
    image: /Familia tomada de la mano/,
    start: "Empezar mi plan",
  },
];

async function expectFits(page: Page) {
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("landing explica o produto, é acessível e leva ao cadastro", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Organize o hoje");
  await expect(page.getByText("Em construção").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /Família de mãos dadas/ })).toBeVisible();

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole("link", { name: "Começar meu plano" }).first().click();
  await expect(page).toHaveURL(/\/cadastro$/);
});

for (const landing of LANDINGS) {
  test(`landing em ${landing.lang}, com título, idioma e endereços para a busca`, async ({
    page,
  }, testInfo) => {
    const context = await page.context().browser()!.newContext({
      locale: landing.lang,
      baseURL: testInfo.project.use.baseURL!,
      viewport: testInfo.project.use.viewport!,
    });
    const visitor = await context.newPage();
    await visitor.goto(landing.path);
    await expect(visitor.locator("html")).toHaveAttribute("lang", landing.lang);
    await expect(visitor.getByRole("heading", { level: 1 })).toContainText(landing.heading);
    await expect(visitor.getByText(landing.badge).first()).toBeVisible();
    await expect(visitor.getByRole("img", { name: landing.image })).toBeVisible();
    await expect(visitor).toHaveTitle(landing.title);
    await expect(visitor.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      landing.description,
    );
    const href = (lang: string) =>
      visitor.locator(`link[rel="alternate"][hreflang="${lang}"]`).getAttribute("href");
    expect(new URL((await href("pt-BR"))!).pathname).toBe("/");
    expect(new URL((await href("en"))!).pathname).toBe("/en");
    expect(new URL((await href("es"))!).pathname).toBe("/es");
    expect(new URL((await href("x-default"))!).pathname).toBe("/");
    expect(
      new URL((await visitor.locator('link[rel="canonical"]').getAttribute("href"))!).pathname,
    ).toBe(landing.path);
    await expectFits(visitor);
    await visitor.screenshot({
      path: testInfo.outputPath(`landing-${landing.lang}.png`),
      fullPage: true,
    });

    await visitor.setViewportSize({ width: 375, height: 812 });
    await expectFits(visitor);
    await visitor.screenshot({
      path: testInfo.outputPath(`landing-${landing.lang}-375.png`),
      fullPage: true,
    });

    await visitor.getByRole("link", { name: landing.start }).first().click();
    // Em `/en` e `/es`, o link leva o idioma: quem entra sem cookie não cai em português.
    await expect(visitor).toHaveURL(
      landing.path === "/" ? /\/cadastro$/ : new RegExp(`/cadastro\\?lang=${landing.lang}$`),
    );
    await expect(visitor.locator("html")).toHaveAttribute("lang", landing.lang);
    await context.close();
  });
}

test("o endereço manda em /en e /es, e o seletor guarda a escolha", async ({ page, context }) => {
  // Conta ou cookie em outro idioma não mudam a página que a busca indexa.
  await page.goto("/");
  await page.locator("footer").getByRole("link", { name: "Español" }).click();
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  expect((await context.cookies()).find((c) => c.name === "organizeup_locale")?.value).toBe("es");

  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Organize today");

  await page.locator("footer").getByRole("link", { name: "Português (Brasil)" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Organize o hoje");
});
