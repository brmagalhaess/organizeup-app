// Importar proventos (ADR-0029) com arquivos fictícios: prévia por linha, valor calculado à vista, ativo fora da
// carteira, CSV com escolha de colunas, idempotência e erros claros, em computador e 375 px, português e inglês.
// O conflito com o job de Mercado é provado em `src/lib/importar-proventos.integration.test.ts`, com o job de
// verdade. Fixe E2E_SHOTS numa pasta para guardar as capturas.
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { animationsDone } from "./animations";
import { newCpf } from "./documents";
import {
  csvTexto,
  FICTIONAL_CPF,
  FICTIONAL_NAME,
  movimentacaoProventos,
  negociacao,
  proventosCsv,
  proventosCsvOutroValor,
  proventosCsvSemTitulos,
  proventosRecebidos,
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

/** ABCD3 e FICT11 na carteira, pela importação de verdade. */
async function seedPortfolio(page: Page) {
  await page.goto("/app/investimentos/importar");
  await expect(page.locator('input[type="file"]')).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles(negociacao());
  await expect(page.getByRole("button", { name: "Importar 4 operações" })).toBeVisible();
  await page.getByLabel("Tipo de FICT11").selectOption("fii");
  await page.getByRole("button", { name: "Importar 4 operações" }).click();
  await expect(page.getByText("Carteira atualizada")).toBeVisible();
}

const shot = async (page: Page, name: string) => {
  if (!process.env.E2E_SHOTS) return;
  await page.screenshot({
    path: path.join(process.env.E2E_SHOTS, `${test.info().project.name}-${name}.png`),
    fullPage: true,
  });
};

async function expectClean(page: Page) {
  await expect(page).toHaveTitle(/.+/);
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

const problem = (page: Page) => page.getByRole("main").getByRole("alert").filter({ hasText: /\S/ });

async function open(page: Page) {
  await page.goto("/app/proventos/importar");
  await expect(page.locator('input[type="file"]')).toBeEnabled();
}

/** Tudo o que sai do navegador para o servidor, para provar o que não sai. */
function watchPosts(page: Page) {
  const bodies: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") bodies.push(request.postData() ?? "");
  });
  return bodies;
}

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
});

test.describe("em português", () => {
  test("Proventos recebidos: prévia, cálculo, ativo fora da carteira e nada repetido", async ({
    page,
  }) => {
    await signUp(page, "Lia");

    // Sem investimento, a tela explica o primeiro passo.
    await page.goto("/app/proventos/importar");
    await expect(page.getByText("Primeiro, os investimentos")).toBeVisible();
    await expectClean(page);
    await shot(page, "prov-0-vazio");
    await page.getByRole("link", { name: "Importar a carteira" }).click();
    await expect(page).toHaveURL(/\/app\/investimentos\/importar$/);

    await seedPortfolio(page);

    // Entradas: tela de Proventos e /app/importar.
    await page.goto("/app/importar");
    await page.getByRole("link", { name: "Importar proventos" }).click();
    await expect(page).toHaveURL(/\/app\/proventos\/importar$/);
    await page.goto("/app/proventos");
    await page.getByRole("link", { name: "Importar arquivo" }).click();
    await expect(page).toHaveURL(/\/app\/proventos\/importar$/);
    await expect(page.locator('input[type="file"]')).toBeEnabled();
    await expect(page.getByText("Proventos recebidos (Excel)")).toBeVisible();
    await expectClean(page);
    await shot(page, "prov-1-escolher");

    const picker = () => page.getByLabel("Arquivo de proventos");

    // Erro claro, e dá para tentar de novo.
    await picker().setInputFiles(unknownSheet());
    await expect(problem(page)).toContainText("Não reconhecemos este arquivo");
    await shot(page, "prov-2-erro");
    await page.getByRole("button", { name: "Escolher outro arquivo" }).click();

    // Prévia: nada gravado até confirmar.
    await picker().setInputFiles(proventosRecebidos());
    await expect(
      page.getByRole("heading", { name: "Confira os Proventos recebidos" }),
    ).toBeVisible();
    await expect(tile(page, "Novos")).toHaveText("3");
    await expect(tile(page, "Para conferir")).toHaveText("2");
    await expect(tile(page, "Já existem")).toHaveText("0");
    await expect(tile(page, "Ignorados")).toHaveText("1");
    const rows = page.getByRole("list", { name: "Linhas do arquivo" });
    await expect(rows.getByText(/bruto e imposto saem do JCP a 15%/)).toBeVisible();
    await expect(
      rows.getByText(/R\$\s85,00 líquido · R\$\s100,00 bruto · R\$\s15,00 de imposto/),
    ).toBeVisible();
    await expect(rows.getByText(/Não dá para saber o imposto/)).toBeVisible();
    await expect(rows.getByText(/Reembolso não entra como provento/)).toBeVisible();
    await expect(rows.getByText(/Este ativo não está na carteira/)).toBeVisible();
    await expect(rows).not.toContainText("Total líquido");
    await expect(page.getByRole("button", { name: "Importar 3 proventos" })).toBeEnabled();
    await expectClean(page);
    await shot(page, "prov-3-previa");

    // Ativo fora da carteira: deixa de fora ou escolhe. Nada cria posição.
    await expect(page.getByLabel("Investimento de QWER4")).toHaveValue("");
    await page.getByLabel("Investimento de QWER4").selectOption({ label: "FICT11 · FICT11" });
    await page.getByRole("button", { name: "Conferir com esta escolha" }).click();
    await expect(tile(page, "Novos")).toHaveText("4");
    await page.getByLabel("Investimento de QWER4").selectOption("");
    await page.getByRole("button", { name: "Conferir com esta escolha" }).click();
    await expect(tile(page, "Novos")).toHaveText("3");

    // Marcação sobrevive a refazer a prévia: a linha sem imposto certo continua como a pessoa deixou.
    const uncertain = page.getByRole("checkbox", { name: /JCP · ABCD3 de 20\/03\/2026/ });
    await uncertain.check();
    await page.getByRole("button", { name: "Conferir com esta escolha" }).click();
    await expect(uncertain).toBeChecked();
    await uncertain.uncheck();

    // Linha em conferir só entra marcada.
    await page.getByRole("button", { name: "Importar 3 proventos" }).click();
    await expect(page.getByText("Proventos atualizados")).toBeVisible();
    await expect(page.getByText("3 proventos novos")).toBeVisible();
    await shot(page, "prov-4-sucesso");

    await page.getByRole("link", { name: "Ver proventos" }).click();
    const received = page.getByRole("list", { name: "Proventos recebidos" });
    await expect(received.getByText("importado").first()).toBeVisible();
    await expect(received.getByText("Reembolso")).toHaveCount(0);
    await expectClean(page);
    await shot(page, "prov-5-lista");

    // Provento não vira lançamento em conta.
    await page.goto("/app/lancamentos");
    await expect(page.getByRole("main")).not.toContainText("ABCD3");

    // O mesmo arquivo de novo: nada novo.
    await open(page);
    await picker().setInputFiles(proventosRecebidos("outra-copia.xlsx"));
    await expect(tile(page, "Já existem")).toHaveText("3");
    await expect(tile(page, "Novos")).toHaveText("0");
    await expect(page.getByRole("button", { name: "Nada marcado" })).toBeDisabled();
    await expectClean(page);
    await shot(page, "prov-6-repetido");

    // Movimentação sobreposta: só o que faltava, e a saída repetida fica de fora.
    await page.getByRole("button", { name: "Cancelar" }).click();
    await picker().setInputFiles(movimentacaoProventos());
    await expect(page.getByRole("heading", { name: "Confira a Movimentação" })).toBeVisible();
    await expect(tile(page, "Novos")).toHaveText("1");
    await expect(tile(page, "Já existem")).toHaveText("1");
    await expect(tile(page, "Ignorados")).toHaveText("2");
    await expect(page.getByText("Repete outra linha do extrato.")).toBeVisible();
    await expect(page.getByText("Não é provento.")).toBeVisible();
    await page.getByRole("button", { name: "Importar 1 provento" }).click();
    await expect(page.getByText("1 provento novo")).toBeVisible();
  });

  test("CSV: colunas reconhecidas, escolha de colunas, erro claro e dados pessoais em casa", async ({
    page,
  }) => {
    await signUp(page, "Rui");
    await seedPortfolio(page);
    await open(page);
    const picker = () => page.getByLabel("Arquivo de proventos");
    const posts = watchPosts(page);

    await picker().setInputFiles(proventosCsv());
    await expect(page.getByRole("heading", { name: "Confira o CSV" })).toBeVisible();
    await expect(tile(page, "Novos")).toHaveText("2");
    await expect(page.getByRole("main")).not.toContainText(FICTIONAL_NAME);
    await page.getByRole("button", { name: "Importar 2 proventos" }).click();
    await expect(page.getByText("Proventos atualizados")).toBeVisible();
    expect(posts.length).toBeGreaterThan(0);
    for (const body of posts) {
      expect(body).not.toContain(FICTIONAL_NAME);
      expect(body).not.toContain(FICTIONAL_CPF);
    }

    await page.getByRole("button", { name: "Importar outro arquivo" }).click();
    await picker().setInputFiles(csvTexto());
    await expect(problem(page)).toContainText("Não reconhecemos este arquivo");
    await page.getByRole("button", { name: "Escolher outro arquivo" }).click();

    // Títulos que não conhecemos: a pessoa diz o que é cada coluna.
    await picker().setInputFiles(proventosCsvSemTitulos());
    await expect(page.getByText("Diga o que há em cada coluna")).toBeVisible();
    const use = page.getByRole("button", { name: "Usar estas colunas" });
    await expect(use).toBeDisabled();
    await page.getByLabel("Data do pagamento").selectOption({ label: "Quando" });
    await page.getByLabel("Tipo do provento").selectOption({ label: "Natureza" });
    await page.getByLabel("Valor líquido").selectOption({ label: "Quanto" });
    await expect(use).toBeEnabled();
    await page.getByLabel("Valor líquido").selectOption("-1");
    await expect(use).toBeDisabled();
    await page.getByLabel("Valor recebido").selectOption({ label: "Quanto" });
    await expect(page.getByLabel("Ativo")).toHaveValue("1");
    await expectClean(page);
    await shot(page, "prov-7-colunas");
    await use.click();
    await expect(tile(page, "Novos")).toHaveText("1");
    await expect(page.getByRole("button", { name: "Importar 1 provento" })).toBeEnabled();

    // Dá para voltar e trocar a escolha.
    await page.getByRole("button", { name: "Trocar as colunas" }).click();
    await expect(page.getByLabel("Valor recebido")).toHaveValue("3");
    await page.getByRole("button", { name: "Usar estas colunas" }).click();
    await expect(tile(page, "Novos")).toHaveText("1");
    await page.getByRole("button", { name: "Importar 1 provento" }).click();
    await expect(page.getByText("1 provento novo")).toBeVisible();

    // Mesmo dia, outro valor: os dois valores aparecem antes de decidir.
    await page.getByRole("button", { name: "Importar outro arquivo" }).click();
    await picker().setInputFiles(proventosCsvOutroValor());
    await expect(tile(page, "Para conferir")).toHaveText("1");
    await expect(page.getByText(/Hoje: R\$\s12,00 · no arquivo: R\$\s15,00/)).toBeVisible();
    await expectClean(page);
    await shot(page, "prov-8-dois-valores");
  });
});

test.describe("em inglês", () => {
  test("a tela, a prévia e os erros mudam de idioma", async ({ page }) => {
    await signUp(page, "Ana");
    await seedPortfolio(page);
    await page.goto("/app/configuracoes");
    await page.getByLabel("Idioma", { exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await open(page);
    await expect(page.getByRole("heading", { name: "Bring in your dividends" })).toBeVisible();
    await expectClean(page);
    await shot(page, "prov-en-1-choose");

    await page.getByLabel("Dividend file").setInputFiles(unknownSheet());
    await expect(problem(page)).toContainText("We do not recognize this file");
    await page.getByRole("button", { name: "Choose another file" }).click();

    await page.getByLabel("Dividend file").setInputFiles(proventosRecebidos());
    await expect(page.getByRole("heading", { name: "Review Proventos recebidos" })).toBeVisible();
    await expect(tile(page, "New")).toHaveText("3");
    await expect(page.getByText(/gross and tax come from JCP at 15%/)).toBeVisible();
    await expectClean(page);
    await shot(page, "prov-en-2-review");
    await page.getByRole("button", { name: "Import 3 dividends" }).click();
    await expect(page.getByText("Dividends updated")).toBeVisible();
    await expect(page.getByText("3 new dividends")).toBeVisible();
    await shot(page, "prov-en-3-done");
  });
});
