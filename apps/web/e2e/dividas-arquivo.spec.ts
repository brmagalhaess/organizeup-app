// Importar arquivo de dívida com o servidor falso do modelo. Precisa do servidor em `next dev` com
// ANTHROPIC_API_KEY qualquer e AI_TEST_BASE_URL apontando para e2e/fake-model.mjs, e de E2E_ASSISTANT=1
// no Playwright. Ver docs/runbooks/bootstrap.md. Nada aqui chama a API real.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newCpf } from "./documents";

test.skip(!process.env.E2E_ASSISTANT, "precisa do servidor com o modelo falso");

const password = "senha-segura-123!";

async function signUp(page: Page, name: string) {
  const email = `${name}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
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

const violations = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.map(
    (violation) => violation.id,
  );

const contract = () => ({
  name: "contrato-renegociacao.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from(`%PDF-1.7 contrato fictício ${Date.now()} ${Math.random()}`),
});

test("sem aceite o arquivo fica guardado; com aceite, confere e só então vira dívida", async ({
  page,
}) => {
  await signUp(page, "Iara");
  await page.goto("/app/dividas");
  await page.getByRole("link", { name: "Importar de um arquivo" }).click();
  await expect(page).toHaveURL(/\/app\/dividas\/importar$/);
  await expect(page.getByText("Nenhum arquivo para conferir")).toBeVisible();

  // Assistente desligado: guarda e não lê.
  await expect(page.getByText("Para ler os arquivos, ative o assistente")).toBeVisible();
  const picker = page.getByLabel("Arquivos das dívidas");
  await picker.setInputFiles(contract());
  await expect(page.getByRole("region", { name: "Conferência" })).toContainText(
    "contrato-renegociacao.pdf",
  );
  await expect(page.getByLabel("Nome da dívida")).toHaveValue("");

  // Ativa o assistente: agora falta o aceite dos arquivos, sem nome de fornecedor na tela.
  await page.getByRole("button", { name: "Assistente", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Assistente" });
  await panel.getByRole("checkbox", { name: /Autorizo o uso/ }).check();
  await panel.getByRole("button", { name: "Ativar o assistente" }).click();
  await expect(panel.getByLabel("Sua pergunta")).toBeVisible();
  await panel.getByRole("button", { name: "Fechar" }).click();
  await page.reload();
  await expect(page.getByText(/inclusive fora do Brasil/)).toBeVisible();
  expect(await page.locator("main").innerText()).not.toMatch(/anthropic|claude/i);
  expect(await violations(page)).toEqual([]);

  await page.getByRole("checkbox", { name: /Autorizo a leitura/ }).check();
  await page.getByLabel("Arquivos das dívidas").setInputFiles(contract());

  // Conferência: os valores vieram do arquivo, e nada foi gravado ainda.
  const review = page.getByRole("region", { name: "Conferência" });
  const name = review.getByLabel("Nome da dívida").filter({ visible: true });
  await expect(name.first()).toHaveValue("Financeira Exemplo");
  await expect(review.getByText("1 campo para conferir")).toBeVisible();
  await expect(review.getByLabel("Juros ao mês (%)").first()).toHaveValue("3,50");
  await expect(review.getByText("Custo efetivo total: 55,00% ao ano")).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await page.goto("/app/dividas");
  await expect(page.getByText("Nenhuma dívida cadastrada")).toBeVisible();

  await page.goto("/app/dividas/importar");
  const card = page.getByRole("listitem").filter({ hasText: "1 campo para conferir" });
  await card.getByLabel("Juros ao mês (%)").fill("3,20");
  await card.getByRole("button", { name: "Confirmar dívida" }).click();
  await expect(page.getByText("Dívida criada.")).toBeVisible();

  await page.goto("/app/dividas");
  const list = page.getByRole("list", { name: "Dívidas" });
  await expect(list).toContainText("Financeira Exemplo");
  await expect(list).toContainText("3,20% ao mês");
  await expect(list).toContainText("0 de 24 parcelas pagas");
  await expect(page.getByRole("heading", { name: /^Quite tudo em/ })).toBeVisible();
  await page.getByRole("button", { name: /Arquivos de Financeira Exemplo/ }).click();
  await expect(page.getByRole("dialog", { name: /Arquivos de/ })).toContainText("Conferido");
});
