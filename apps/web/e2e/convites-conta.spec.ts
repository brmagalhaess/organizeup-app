// Convite por link, aceite dos termos, exportação e exclusão da conta.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const password = "senha-segura-123";

function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function fillSignUp(page: Page, name: string, email: string) {
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
}

async function createOwner(page: Page, family: string) {
  const email = uniqueEmail("dona");
  await page.goto("/cadastro");
  await fillSignUp(page, "Dona", email);
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Nome da família").fill(family);
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return email;
}

test("documentos abrem sem conta e passam na acessibilidade", async ({ page }) => {
  for (const [path, title] of [
    ["/termos", "Termos de Uso"],
    ["/privacidade", "Política de Privacidade"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(a11y.violations.map((v) => v.id)).toEqual([]);
  }
});

test("cadastro sem aceitar os termos é recusado pelo servidor", async ({ request }) => {
  const res = await request.post("/api/auth/sign-up/email", {
    data: { name: "Sem Aceite", email: uniqueEmail("sem"), password },
    headers: { origin: "http://localhost:3000" },
  });
  expect(res.ok()).toBeFalsy();
});

test("convite, papéis, remoção, exportação e exclusão da conta", async ({ page, browser }) => {
  const family = `Família Convite ${Date.now()}`;
  await createOwner(page, family);

  // Responsável convida alguém para só ver.
  const guestEmail = uniqueEmail("convidada");
  await page.goto("/app/familia");
  await page.getByRole("button", { name: "Convidar" }).click();
  await page.getByLabel("E-mail da pessoa").fill(guestEmail);
  await page.getByLabel("O que ela pode fazer").selectOption("viewer");
  await page.getByRole("button", { name: "Criar convite" }).click();
  const linkField = page.getByLabel(`Link do convite de ${guestEmail}`);
  await expect(linkField).toBeVisible();
  const link = new URL(await linkField.inputValue());

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // Sem login, o link não revela a família.
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(link.pathname);
  await expect(guestPage.getByRole("heading", { name: "Você recebeu um convite" })).toBeVisible();
  await expect(guestPage.getByText(family)).toHaveCount(0);

  // Outro e-mail não aceita.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(`/cadastro?convite=${link.pathname.split("/").pop()}`);
  await fillSignUp(strangerPage, "Estranha", uniqueEmail("estranha"));
  await expect(
    strangerPage.getByRole("heading", { name: "Este convite é para outro e-mail" }),
  ).toBeVisible();
  await expect(strangerPage.getByText(family)).toHaveCount(0);
  await stranger.close();

  // A pessoa convidada cria a conta e entra direto na família.
  await guestPage.getByRole("link", { name: "Criar minha conta" }).click();
  await fillSignUp(guestPage, "Convidada", guestEmail);
  await expect(guestPage.getByRole("heading", { name: `Entrar em ${family}` })).toBeVisible();
  await guestPage.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(guestPage).toHaveURL(/\/app$/);

  // Só leitura vê a família, mas não altera nem exporta.
  await guestPage.goto("/app/familia");
  await expect(
    guestPage.getByRole("list", { name: "Quem acessa" }).getByText("Convidada", { exact: true }),
  ).toBeVisible();
  await expect(guestPage.getByRole("button", { name: "Adicionar pessoa" })).toHaveCount(0);
  await expect(guestPage.getByRole("button", { name: "Convidar" })).toHaveCount(0);
  expect((await guestPage.request.get("/app/exportar")).status()).toBe(403);

  // Com outra pessoa na família, a conta da responsável não pode ser apagada.
  await page.goto("/app/configuracoes");
  await page.getByRole("button", { name: "Apagar conta" }).click();
  await page.getByLabel("Sua senha").fill("senha-errada-123");
  await page.getByRole("button", { name: "Apagar minha conta" }).click();
  await expect(page.getByText("Senha incorreta.")).toBeVisible();
  await page.getByLabel("Sua senha").fill(password);
  await page.getByRole("button", { name: "Apagar minha conta" }).click();
  await expect(page.getByText(/Remova o acesso delas/)).toBeVisible();

  // Removida, a pessoa perde o acesso.
  await page.goto("/app/familia");
  await page.getByRole("button", { name: "Remover acesso de Convidada" }).click();
  await page.getByRole("button", { name: "Remover acesso" }).last().click();
  await expect(
    page.getByRole("list", { name: "Quem acessa" }).getByText("Convidada", { exact: true }),
  ).toHaveCount(0);
  await guestPage.goto("/app/familia");
  await expect(guestPage).toHaveURL(/\/app\/novo-household$/);
  await guest.close();

  // Exporta os dados da própria família.
  const exported = await page.request.get("/app/exportar");
  expect(exported.ok()).toBeTruthy();
  const body = await exported.json();
  expect(body.tables.people.map((p: { name: string }) => p.name)).toContain("Dona");

  // Apagar a conta acaba com o acesso.
  await page.goto("/app/configuracoes");
  const email = await page.getByText(/^dona\./).innerText();
  await page.getByRole("button", { name: "Apagar conta" }).click();
  await page.getByLabel("Sua senha").fill(password);
  await page.getByRole("button", { name: "Apagar minha conta" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
});
