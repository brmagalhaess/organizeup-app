// Cadastro complementar: os quatro passos, o aviso do painel e o que fica gravado.
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

async function expectStep(page: Page, step: number, title: string) {
  await expect(
    page.getByRole("heading", { level: 1, name: `Passo ${step} de 4 · ${title}` }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Progresso do cadastro" })).toHaveAttribute(
    "value",
    String(step),
  );
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
}

test("os quatro passos gravam o cadastro e o aviso some", async ({ page }) => {
  await signUp(page, "Bia");
  const notice = page.getByRole("region", { name: "Aviso" });
  await expect(notice).toBeVisible();

  await page.getByRole("link", { name: "Complete o cadastro da família" }).click();
  await expect(page).toHaveURL(/\/app\/completar$/);
  await expectStep(page, 1, "Sua família");
  await expect(page.getByRole("link", { name: "Veja o que mudou." })).toBeVisible();

  const birthYear = new Date().getFullYear() - 40;
  await page.getByLabel("Nascimento de Bia").fill(`${birthYear}-03`);

  await page.getByLabel("Nome", { exact: true }).fill("Caio");
  await page.getByRole("button", { name: "Adicionar pessoa" }).click();
  const list = page.getByRole("list", { name: "Pessoas da família" });
  await expect(list.getByText("Caio")).toBeVisible();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Nascimento de Bia")).toHaveValue(`${birthYear}-03`);

  // Dia sem mês não passa, e o que foi digitado continua no formulário.
  await page.getByLabel("Dia", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Escolha o mês.")).toBeVisible();
  await expect(page.getByLabel("Dia", { exact: true })).toHaveValue("12");
  await page.getByLabel("Mês", { exact: true }).selectOption("6");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expectStep(page, 2, "Aposentadoria");
  await expect(page.getByLabel("Ano em que querem parar")).toHaveValue(String(birthYear + 65));
  await page.getByLabel("Renda que você quer por mês").fill("8.000,00");
  await page.getByLabel("Rendimento anual da carteira (%)").fill("50");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Informe um percentual até 30, como 6 ou 6,5.")).toBeVisible();
  await expect(page.getByLabel("Renda que você quer por mês")).toHaveValue("8.000,00");
  await page.getByLabel("Rendimento anual da carteira (%)").fill("6,5");

  const bia = page.getByRole("group", { name: "Bia" });
  await bia.getByLabel("Situação de trabalho").selectOption("clt");
  await bia.getByLabel("Contribui para o INSS?").selectOption("sim");
  await bia.getByLabel("Benefício mensal esperado (R$)").fill("2.500,00");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expectStep(page, 3, "Viagens");
  await page.getByLabel("Quantas viagens por ano").fill("2");
  await page.getByLabel("Quantos dias costumam durar").fill("7");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expectStep(page, 4, "Primeira meta");
  await page.getByLabel("Nome da meta").fill("Carro novo");
  await page.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByText("Informe quanto custa.")).toBeVisible();
  await page.getByLabel("Quanto custa (R$)").fill("80.000,00");
  await page.getByRole("button", { name: "Concluir" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(notice).toHaveCount(0);

  // O que foi informado aparece nas telas de edição.
  await page.goto("/app/configuracoes");
  await expect(page.getByLabel("Ano em que querem parar")).toHaveValue(String(birthYear + 65));
  await expect(page.getByLabel("Viagens por ano")).toHaveValue("2");
  await expect(page.getByLabel("Dias de cada viagem")).toHaveValue("7");
  await expect(page.getByText("ID da conta")).toBeVisible();

  await page.goto("/app/familia");
  await expect(page.getByLabel("Dia", { exact: true })).toHaveValue("12");
  await page.getByRole("button", { name: "Editar Bia" }).click();
  const edit = page.getByRole("dialog", { name: "Editar pessoa" });
  await expect(edit.getByLabel("Situação de trabalho")).toHaveValue("clt");
  await expect(edit.getByLabel("Benefício mensal esperado (R$)")).toHaveValue("2500,00");
  await edit.getByLabel("Idade em que quer parar").fill("60");
  await edit.getByRole("button", { name: "Salvar pessoa" }).click();
  await expect(edit).toBeHidden();
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  await page.goto("/app/metas");
  await expect(page.getByText("Carro novo").first()).toBeVisible();
});

test("pular avança sem gravar e “Não mostrar mais” dispensa o aviso", async ({ page }) => {
  await signUp(page, "Noa");
  await page.goto("/app/completar");
  await page.getByRole("link", { name: "Pular por agora" }).click();
  await expectStep(page, 2, "Aposentadoria");
  await page.getByRole("link", { name: "Pular por agora" }).click();
  await expectStep(page, 3, "Viagens");
  await page.getByRole("link", { name: "Voltar ao painel" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Sem concluir, o convite continua no painel.
  const notice = page.getByRole("region", { name: "Aviso" });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Não mostrar mais" }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(notice).toHaveCount(0);
});
