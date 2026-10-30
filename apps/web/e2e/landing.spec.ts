import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
