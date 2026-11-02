// Importar a carteira (ADR-0024) com arquivos fictícios: prévia, idempotência, nota com taxas, erros claros,
// em computador e 375 px, em português e inglês. Fixe E2E_SHOTS numa pasta para guardar as capturas.
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { animationsDone } from "./animations";
import { newCpf } from "./documents";
import {
  movimentacao,
  negociacao,
  notaComCodigo,
  notaComSenha,
  notaImagem,
  notaSemCodigo,
  posicao,
  unknownSheet,
} from "./b3-fixtures";

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

const shot = async (page: Page, name: string) => {
  if (!process.env.E2E_SHOTS) return;
  await page.screenshot({
    path: path.join(process.env.E2E_SHOTS, `${test.info().project.name}-${name}.png`),
    fullPage: true,
  });
};

async function expectClean(page: Page) {
  await animationsDone(page);
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    a11y.violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target).join(" ")}`),
  ).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const tile = (page: Page, label: string) =>
  page
    .locator("dl > div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("dd");

/** O seletor nasce desligado e liga na hidratação. */
async function open(page: Page) {
  await page.goto("/app/investimentos/importar");
  await expect(page.locator('input[type="file"]')).toBeEnabled();
}

/**
 * Só o conteúdo da tela. O Next deixa fora do `main` um `role=alert` que anuncia rotas, e ele ganha texto depois
 * de navegar por link. Dentro do `main`, dois alertas com texto ainda reprovam o teste.
 */
const problem = (page: Page) => page.getByRole("main").getByRole("alert").filter({ hasText: /\S/ });

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
});

test.describe("em português", () => {
  test("Negociação entra uma vez só, e a nota traz as taxas", async ({ page }) => {
    await signUp(page, "Iara");

    // Entrada por /app/importar e pela aba de Investimentos.
    await page.goto("/app/importar");
    await page.getByRole("link", { name: "Importar da B3 ou da corretora" }).click();
    await expect(page).toHaveURL(/\/app\/investimentos\/importar$/);
    await expect(page.getByRole("link", { name: "Importar", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("Negociação (Excel)")).toBeVisible();
    await expectClean(page);
    await shot(page, "1-escolher");

    const picker = page.getByLabel("Arquivo da B3 ou da corretora");

    // Layout desconhecido: mensagem clara, e dá para tentar de novo.
    await picker.setInputFiles(unknownSheet());
    await expect(problem(page)).toContainText("Não reconhecemos este arquivo");
    await shot(page, "2-erro");
    await page.getByRole("button", { name: "Escolher outro arquivo" }).click();

    // Prévia: nada gravado até confirmar.
    await page.getByLabel("Arquivo da B3 ou da corretora").setInputFiles(negociacao());
    await expect(page.getByRole("heading", { name: "Confira a Negociação" })).toBeVisible();
    await expect(tile(page, "Novas")).toHaveText("4");
    await expect(tile(page, "Ignoradas")).toHaveText("1");
    await expect(tile(page, "Já existem")).toHaveText("0");
    const rows = page.getByRole("list", { name: "Linhas do arquivo" });
    await expect(rows.getByText("Só mercado à vista e fracionário entram por aqui.")).toBeVisible();
    await expect(rows.getByText("Compra · ABCD3").first()).toBeVisible();
    await expect(rows).not.toContainText("ABCD3F");

    // FICT11 está fora do catálogo do ambiente de teste e o final 11 não diz o tipo.
    const submit = page.getByRole("button", { name: "Importar 4 operações" });
    await expect(submit).toBeDisabled();
    await page.getByLabel("Tipo de FICT11").selectOption("fii");
    await expect(submit).toBeEnabled();
    await expect(page.getByLabel("Conta do dinheiro")).toHaveValue("");
    await expectClean(page);
    await shot(page, "3-previa");

    await submit.click();
    await expect(page.getByText("Carteira atualizada")).toBeVisible();
    await expect(page.getByText("4 operações novas")).toBeVisible();
    await shot(page, "4-sucesso");
    await page.getByRole("link", { name: "Ver a carteira" }).click();
    const portfolio = page.getByRole("list", { name: "Carteira", exact: true });
    await expect(portfolio.getByText("ABCD3", { exact: true })).toBeVisible();
    await expect(portfolio.getByText("FICT11", { exact: true })).toBeVisible();
    // 105 × 10 menos 50 vendidas pelo preço médio, mais 10 × 90.
    await expect(tile(page, "Custo")).toContainText("R$ 1.450,00");

    // O mesmo arquivo de novo: nada a importar.
    await open(page);
    await page.getByLabel("Arquivo da B3 ou da corretora").setInputFiles(negociacao("outra.xlsx"));
    await expect(page.getByText("Nada novo neste arquivo")).toBeVisible();
    await expect(tile(page, "Já existem")).toHaveText("4");
    await expect(page.getByRole("button", { name: "Nada marcado" })).toBeDisabled();
    await expectClean(page);
    await shot(page, "5-nada-novo");

    // A nota da mesma operação não duplica: só traz as taxas, rateadas.
    await page.getByRole("button", { name: "Cancelar" }).click();
    await page.getByLabel("Arquivo da B3 ou da corretora").setInputFiles(notaComCodigo());
    await expect(page.getByRole("heading", { name: "Confira a nota de corretagem" })).toBeVisible();
    await expect(tile(page, "Novas")).toHaveText("2");
    await expect(page.getByText("Já existe, com taxas novas").first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText("000.000.000-00");
    await expect(page.locator("main")).not.toContainText("Ficticia");
    await page.getByRole("button", { name: "Importar 2 operações" }).click();
    await expect(page.getByText("2 operações com taxas")).toBeVisible();

    // A venda de 50 em 105 leva parte das taxas: dos R$ 0,30, ficam R$ 0,16 no custo.
    await page.getByRole("link", { name: "Ver a carteira" }).click();
    await expect(tile(page, "Custo")).toContainText("R$ 1.450,16");

    // Movimentação: a liquidação cai como a mesma operação; o resto fica de fora com aviso.
    await open(page);
    await page.getByLabel("Arquivo da B3 ou da corretora").setInputFiles(movimentacao());
    await expect(page.getByRole("heading", { name: "Confira a Movimentação" })).toBeVisible();
    await expect(tile(page, "Novas")).toHaveText("0");
    await expect(tile(page, "Ignoradas")).toHaveText("3");
    await expect(page.getByText(/Provento: o sistema lança sozinho/)).toBeVisible();
    await expect(page.getByText(/Evento da empresa/)).toBeVisible();
    await expect(page.getByText(/Troca de corretora/)).toBeVisible();
    await shot(page, "6-movimentacao");
  });

  test("nota sem código, Posição e PDF que não dá para ler", async ({ page }) => {
    await signUp(page, "Bia");
    await open(page);
    const pick = () => page.getByLabel("Arquivo da B3 ou da corretora");

    await pick().setInputFiles(notaImagem());
    await expect(problem(page)).toContainText("Este PDF é uma imagem");
    await page.getByRole("button", { name: "Escolher outro arquivo" }).click();

    await pick().setInputFiles(notaComSenha());
    await expect(problem(page)).toContainText("Este PDF tem senha");
    await expect(problem(page)).toContainText("Não precisamos da sua senha");
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await page.getByRole("button", { name: "Escolher outro arquivo" }).click();

    // A nota não traz o código: a linha só entra depois de a pessoa informar.
    await pick().setInputFiles(notaSemCodigo());
    await expect(page.getByText("Falta o código de alguns ativos")).toBeVisible();
    await expect(page.getByRole("button", { name: "Nada marcado" })).toBeDisabled();
    await page.getByLabel("Código de EMPRESA FICTICIA ON NM").fill("empr3");
    await page.getByRole("button", { name: "Conferir com estes códigos" }).click();
    await expect(page.getByRole("button", { name: "Importar 1 operação" })).toBeEnabled();
    await expectClean(page);
    await shot(page, "7-codigo");
    await page.getByRole("button", { name: "Importar 1 operação" }).click();
    await expect(page.getByText("Carteira atualizada")).toBeVisible();

    // Posição: compara e só grava o que faltar com o preço pago.
    await page.getByRole("button", { name: "Importar outro arquivo" }).click();
    await pick().setInputFiles(posicao());
    await expect(page.getByRole("heading", { name: "Confira a Posição" })).toBeVisible();
    const positions = page.getByRole("list", { name: "Posição na B3" });
    await expect(positions.getByText("Falta na carteira")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Nada marcado" })).toBeDisabled();
    await page.getByLabel(/Preço médio pago em ABCD3/).fill("9,50");
    await expectClean(page);
    await shot(page, "8-posicao");
    await page.getByRole("button", { name: "Importar 1 operação" }).click();
    await expect(page.getByText("Carteira atualizada")).toBeVisible();

    await page.getByRole("button", { name: "Importar outro arquivo" }).click();
    await pick().setInputFiles(posicao());
    await expect(positions.getByText("Confere")).toHaveCount(1);
    await expect(positions.getByText("Falta na carteira")).toHaveCount(1);
  });
});

test.describe("em inglês", () => {
  test("a tela e os erros mudam de idioma", async ({ page }) => {
    await signUp(page, "Noa");
    await page.goto("/app/configuracoes");
    await page.getByLabel("Idioma", { exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await open(page);
    await expect(page.getByRole("heading", { name: "Bring in your B3 portfolio" })).toBeVisible();
    await expectClean(page);
    await shot(page, "en-1-choose");

    await page.getByLabel("File from B3 or your broker").setInputFiles(unknownSheet());
    await expect(problem(page)).toContainText("We do not recognize this file");
    await page.getByRole("button", { name: "Choose another file" }).click();

    await page.getByLabel("File from B3 or your broker").setInputFiles(negociacao());
    await expect(page.getByRole("heading", { name: "Review Negociação" })).toBeVisible();
    await expect(tile(page, "New")).toHaveText("4");
    await page.getByLabel("Type of FICT11").selectOption("fii");
    await expectClean(page);
    await shot(page, "en-2-review");
    await page.getByRole("button", { name: "Import 4 trades" }).click();
    await expect(page.getByText("Portfolio updated")).toBeVisible();
    await expect(page.getByText("4 new trades")).toBeVisible();
  });
});
