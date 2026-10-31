// Aposentadoria por proventos: estado vazio, plano preenchido, destaque de quanto guardar e aceite.
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

const axe = async (page: Page) => {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
};

const noOverflow = async (page: Page) => {
  const [scroll, inner] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(inner!);
};

test("plano por proventos: do estado vazio ao valor aceito", async ({ page, browser }) => {
  await signUp(page, "Ivo");
  await page.goto("/app/aposentadoria");
  await expect(page.getByRole("heading", { name: "Viver dos rendimentos" })).toBeVisible();
  await expect(page.getByText("Complete seu plano de aposentadoria")).toBeVisible();
  await expect(page.getByRole("link", { name: "Completar cadastro" })).toHaveAttribute(
    "href",
    "/app/completar",
  );
  await expect(page.getByText(/^Estimativa\. Proventos passados/)).toBeVisible();
  // Sem plano válido a comparação já começa aberta.
  await expect(page.getByText("Monte o primeiro cenário")).toBeVisible();
  await axe(page);
  await noOverflow(page);

  // Renda alvo salva, sem rendimento: o aviso muda depois que há um ano para mirar.
  await page.getByLabel("Renda que você quer por mês (R$)").fill("6.000,00");
  await page.getByRole("button", { name: "Salvar plano" }).click();
  await expect(page.getByText("Plano salvo.")).toBeVisible();

  // O ano vem do nascimento da pessoa titular; o cenário é o caminho mais curto para gravá-lo.
  await page.getByRole("button", { name: "Novo cenário" }).click();
  const scenario = page.getByRole("dialog", { name: "Novo cenário" });
  await scenario.getByLabel("Nome do cenário").fill("Comparação");
  await scenario.getByLabel("Mês e ano de nascimento").fill(`${new Date().getFullYear() - 40}-01`);
  await scenario.getByLabel("Renda desejada por mês (R$)").fill("6.000,00");
  await scenario.getByRole("button", { name: "Salvar cenário" }).click();
  await expect(scenario).toBeHidden();
  await expect(
    page.getByText("Informe o rendimento anual da carteira ou registre proventos"),
  ).toBeVisible();

  // Renda da família: sem ela não sobra nada para dividir.
  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Cadastrar renda" }).click();
  const income = page.getByRole("dialog", { name: "Nova renda" });
  await income.getByLabel("Tipo de renda").selectOption("aluguel");
  await income.getByLabel("De onde vem").fill("Aluguel da sala");
  await income.getByLabel("Valor que cai na conta (R$)").fill("5.000,00");
  // Dia 31 ainda não passou em nenhum mês: a renda já vale para o mês atual.
  await income.getByLabel("Dia do pagamento").fill("31");
  await income.getByRole("button", { name: "Salvar renda" }).click();
  await expect(income).toBeHidden();

  await page.goto("/app/aposentadoria");
  await page.getByLabel("Rendimento anual da carteira (%)").fill("6,00");
  await page.getByRole("button", { name: "Salvar plano" }).click();

  // 6.000 por mês a 6% ao ano pedem R$ 1.200.000 investidos.
  await expect(page.getByText(/Guarde por mês:/)).toBeVisible();
  await expect(page.getByText(/na reserva \+ R\$\s[\d.]+,\d{2} em investimentos/)).toBeVisible();
  await expect(page.getByText("Quanto precisa ter investido", { exact: true })).toBeVisible();
  await expect(page.getByText(/R\$\s1\.200\.000,00/).first()).toBeVisible();
  await expect(page.getByText(/já cobre 0%/)).toBeVisible();
  await expect(page.getByText(/Para fechar em \d{4} seria preciso/)).toBeVisible();
  await expect(page.getByRole("img", { name: /Carteira projetada/ })).toBeVisible();
  await axe(page);
  await noOverflow(page);

  await page.getByRole("button", { name: "Aceitar este valor" }).click();
  await expect(page.getByText("Este é o valor do seu plano.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar este valor" })).toHaveCount(0);
  await expect(page.getByLabel("Quanto guardar por mês (R$)")).not.toHaveValue("");

  // O plano é da família: outra conta não vê nada disso.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signUp(page2, "Eva");
  await page2.goto("/app/aposentadoria");
  await expect(page2.getByText(/Guarde por mês:/)).toHaveCount(0);
  await other.close();
});

test("comparação fica dobrada quando o plano por proventos está completo e não há cenários", async ({
  page,
}) => {
  await signUp(page, "Noa");
  await page.goto("/app/aposentadoria");
  await page.getByRole("button", { name: "Novo cenário" }).click();
  const scenario = page.getByRole("dialog", { name: "Novo cenário" });
  await scenario.getByLabel("Nome do cenário").fill("Temporário");
  await scenario.getByLabel("Mês e ano de nascimento").fill(`${new Date().getFullYear() - 40}-01`);
  await scenario.getByLabel("Renda desejada por mês (R$)").fill("6.000,00");
  await scenario.getByRole("button", { name: "Salvar cenário" }).click();
  await expect(scenario).toBeHidden();

  await page.getByLabel("Renda que você quer por mês (R$)").fill("6.000,00");
  await page.getByLabel("Rendimento anual da carteira (%)").fill("6,00");
  await page.getByRole("button", { name: "Salvar plano" }).click();
  await expect(page.getByText(/Guarde por mês:/)).toBeVisible();

  await page.getByRole("button", { name: "Excluir Temporário" }).click();
  await page
    .getByRole("dialog", { name: "Excluir cenário" })
    .getByRole("button", { name: "Excluir" })
    .click();
  await expect(page.getByRole("heading", { name: "Temporário" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Comparar: gastar o que guardou")).toBeVisible();
  await expect(page.getByText("Monte o primeiro cenário")).toBeHidden();
  await page.getByText("Comparar: gastar o que guardou").click();
  await expect(page.getByText("Monte o primeiro cenário")).toBeVisible();
});
