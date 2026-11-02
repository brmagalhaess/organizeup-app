// Tela de sugestões vazia, menu, cartão do painel e aviso do cadastro complementar.
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

test("sugestões vazias, menu e aviso do cadastro", async ({ page }) => {
  await signUp(page, "Bia");

  // O menu leva para a tela; no celular ele abre pela barra inferior.
  const more = page.getByRole("button", { name: "Mais", exact: true });
  if (await more.isVisible()) await more.click();
  await page.getByRole("link", { name: "Sugestões", exact: true }).locator("visible=true").click();
  await expect(page).toHaveURL(/\/app\/sugestoes$/);

  await expect(page.getByRole("heading", { level: 2, name: "Para você decidir" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "O que o assistente fez sozinho" }),
  ).toBeVisible();
  await expect(page.getByText("Nada para revisar por enquanto")).toBeVisible();
  await expect(
    page.getByText("O assistente passa por aqui toda madrugada e deixa aqui o que notar."),
  ).toBeVisible();

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // O aviso some até o fim do dia e continua sumido depois de recarregar.
  const notice = page.getByRole("region", { name: "Aviso" });
  await expect(notice.getByRole("link", { name: "Completar agora" })).toBeVisible();
  await notice.getByRole("button", { name: "Fechar aviso" }).click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Para você decidir" })).toBeVisible();
  await expect(notice).toBeHidden();
});
