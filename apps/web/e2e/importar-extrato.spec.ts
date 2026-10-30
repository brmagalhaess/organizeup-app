// Importação de extrato: revisão, baixa de previsão, reimportação sem duplicar e desfazer.
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

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const compact = today.replaceAll("-", "");
const brazilian = today.split("-").reverse().join("/");

const ofx = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${compact}<TRNAMT>5000.00<FITID>E1<MEMO>Salario de teste
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${compact}<TRNAMT>-1500.00<FITID>E2<MEMO>Transferencia imobiliaria
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${compact}<TRNAMT>-200.00<FITID>E3<MEMO>SUPERMERCADO EXEMPLO
</STMTTRN>
</BANKTRANLIST></OFX>`;

const upload = (page: Page, name: string, content: string) =>
  page.getByLabel("Arquivo").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(content, "latin1"),
  });

const upload2 = (page: Page, name: string, content: string) =>
  page
    .getByRole("button", { name: "Escolher outro arquivo" })
    .click()
    .then(() => upload(page, name, content));

const total = (page: Page, label: string) =>
  page.locator("dl > div").filter({ hasText: label }).locator("dd");

test("importa OFX, baixa a previsão, não duplica e pode desfazer", async ({ page }) => {
  await signUp(page, "Iris");

  // Previsão recorrente do mesmo valor que aparece no extrato.
  await page.goto("/app/lancamentos");
  await page
    .getByRole("button", { name: /^(Novo lançamento|Lançar)$/ })
    .first()
    .click();
  const entry = page.getByRole("dialog", { name: "Novo lançamento" });
  await entry.getByLabel("Descrição").fill("Aluguel do apartamento");
  await entry.getByLabel("Valor (R$)").fill("1.500,00");
  await entry.getByLabel("Repete todo mês").check();
  await entry.getByLabel(/^Já foi/).uncheck();
  await entry.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(entry).toBeHidden();

  await page.goto("/app/importar");
  await upload(page, "extrato.ofx", ofx);

  const list = page.getByRole("list", { name: "Lançamentos do extrato" });
  await expect(list).toContainText("Baixa: Aluguel do apartamento");
  await expect(
    list.getByRole("listitem").filter({ hasText: "SUPERMERCADO" }).getByRole("combobox"),
  ).toHaveValue(/.+/);
  const selected = await list
    .getByRole("listitem")
    .filter({ hasText: "SUPERMERCADO" })
    .getByRole("combobox")
    .evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent);
  expect(selected).toBe("Mercado");

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole("button", { name: "Importar 3 lançamentos" }).click();
  await expect(page.getByText("Extrato importado")).toBeVisible();
  await expect(page.getByText("2 novos lançamentos e 1 previsão baixada.")).toBeVisible();

  await page.goto("/app/lancamentos");
  await expect(total(page, "Entrou")).toContainText("5.000,00");
  await expect(total(page, "Saiu")).toContainText("1.700,00");
  await expect(page.getByRole("row").filter({ hasText: "Aluguel do apartamento" })).toHaveCount(1);
  await expect(page.getByRole("row").filter({ hasText: "Aluguel do apartamento" })).toContainText(
    "Pago",
  );

  // O mesmo arquivo de novo não entra.
  await page.goto("/app/importar");
  await upload(page, "extrato.ofx", ofx);
  await expect(list.getByText("Já importado")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Importar 0 lançamentos" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancelar" }).click();

  // Desfazer devolve o mês ao estado anterior.
  await page.getByRole("button", { name: /^Desfazer importação de 3/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("list", { name: "Importações" })).toHaveCount(0);

  await page.goto("/app/lancamentos");
  await expect(total(page, "Entrou")).toContainText("0,00");
  await expect(page.getByRole("row").filter({ hasText: "Aluguel do apartamento" })).toContainText(
    "Previsto",
  );
});

test("importa CSV com acentos em Windows-1252 e confere as colunas", async ({ page }) => {
  await signUp(page, "Otto");
  await page.goto("/app/importar");
  await upload(
    page,
    "extrato.csv",
    [
      "Extrato da conta",
      "Data;Histórico;Valor;Saldo",
      `${brazilian};Farmácia exemplo;-45,90;100,00`,
      `${brazilian};Saldo do dia;;100,00`,
    ].join("\n"),
  );
  await expect(page.getByRole("heading", { name: "Confira as colunas" })).toBeVisible();
  await expect(page.getByText("1 lançamento encontrado, 1 linha ignorada.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Amostra" })).toContainText("Farmácia exemplo");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByRole("button", { name: "Importar 1 lançamento" }).click();
  await expect(page.getByText("Extrato importado")).toBeVisible();

  await page.goto("/app/lancamentos");
  const row = page.getByRole("row").filter({ hasText: "Farmácia exemplo" });
  await expect(row).toContainText("Saúde");
  await expect(row).toContainText("45,90");
});

test("recusa arquivo que não é extrato", async ({ page }) => {
  await signUp(page, "Yara");
  await page.goto("/app/importar");
  await upload(page, "extrato.doc", "qualquer coisa");
  await expect(page.getByText(/Este tipo de arquivo não é lido/)).toBeVisible();

  // Erro sempre deixa uma saída, e o mesmo arquivo pode ser escolhido de novo.
  await page.getByRole("button", { name: "Escolher outro arquivo" }).click();
  await expect(page.getByText(/Este tipo de arquivo não é lido/)).toHaveCount(0);
  await upload(page, "extrato.pdf", "%PDF-1.7 sem conteudo");
  await expect(page.getByRole("button", { name: "Escolher outro arquivo" })).toBeVisible();
  await upload2(page, "antigo.xls", "x");
});

const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 600 400]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 150>>stream
BT /F1 11 Tf 40 340 Td (${brazilian} DROGARIA PDF -45,90 100,00) Tj 0 -20 Td (${brazilian} SALARIO PDF 1.000,00 1.100,00) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

test("lê extrato em PDF no navegador", async ({ page }) => {
  await signUp(page, "Pia");
  await page.goto("/app/importar");
  await upload(page, "extrato.pdf", pdf);
  const list = page.getByRole("list", { name: "Lançamentos do extrato" });
  await expect(list).toContainText("DROGARIA PDF");
  await expect(list).toContainText("+ R$\u00a01.000,00");
  await expect(page.getByText(/PDF não diz sempre/)).toBeVisible();
  await page.getByRole("button", { name: "Importar 2 lançamentos" }).click();
  await expect(page.getByText("Extrato importado")).toBeVisible();
});

test("lê planilha do Excel no navegador", async ({ page }) => {
  await signUp(page, "Eva");
  await page.goto("/app/importar");
  await page.getByLabel("Arquivo").setInputFiles({
    name: "extrato.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(
      "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",
      "base64",
    ),
  });
  await expect(page.getByText("2 lançamentos encontrados.")).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("list", { name: "Lançamentos do extrato" })).toContainText(
    "Farmácia planilha",
  );
});

test("o agente categoriza, cria categoria, lembra e registra", async ({ page }) => {
  await signUp(page, "Nina");
  const statement = (id: string, lines: Array<[string, string]>) => `<OFX><BANKTRANLIST>
${lines
  .map(
    ([memo, value], index) =>
      `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${compact}<TRNAMT>${value}<FITID>${id}${index}<MEMO>${memo}\n</STMTTRN>`,
  )
  .join("\n")}
</BANKTRANLIST></OFX>`;

  await page.goto("/app/importar");
  await upload(
    page,
    "um.ofx",
    statement("A", [
      ["IFOOD PIZZA EXEMPLO", "-40.00"],
      ["LOJA XPTO CENTRO", "-30.00"],
      ["LOJA XPTO CENTRO", "-10.00"],
      ["SUPERMERCADO EXEMPLO", "-200.00"],
    ]),
  );
  const list = page.getByRole("list", { name: "Lançamentos do extrato" });
  const line = (text: string) => list.getByRole("listitem").filter({ hasText: text });

  // Categoria que não existe vem proposta, e o que não tem pista pede revisão.
  await expect(line("IFOOD")).toContainText("Categoria nova");
  await expect(line("IFOOD").getByRole("combobox")).toHaveValue("new:Restaurantes");
  await expect(line("LOJA XPTO").first()).toContainText("Revisar");
  await expect(page.getByText(/O agente categorizou 2 lançamentos/)).toBeVisible();

  // Trocar a categoria vale para o mesmo estabelecimento.
  await line("LOJA XPTO")
    .first()
    .getByRole("combobox")
    .selectOption({ label: "Criar outra categoria…" });
  await expect(page.getByRole("button", { name: "Importar 4 lançamentos" })).toBeDisabled();
  await line("LOJA XPTO").first().getByRole("textbox").fill("Papelaria");
  await line("LOJA XPTO").nth(1).getByRole("textbox").fill("Papelaria");

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole("button", { name: "Importar 4 lançamentos" }).click();
  await expect(page.getByText("Extrato importado")).toBeVisible();
  await expect(page.getByText(/Categorias criadas: Restaurantes, Papelaria/).first()).toBeVisible();

  await page.goto("/app/categorias");
  await expect(page.getByText("Restaurantes")).toBeVisible();
  await expect(page.getByText("Papelaria")).toBeVisible();

  // Próximo extrato: o agente já sabe, mesmo com outra escrita do mesmo lugar.
  await page.goto("/app/importar");
  await expect(page.getByRole("list", { name: "Importações" })).toContainText(
    "A família corrigiu 2",
  );
  await upload(page, "dois.ofx", statement("B", [["COMPRA CARTAO LOJA XPTO CENTRO 22", "-55.00"]]));
  await expect(line("LOJA XPTO")).toContainText("Memória da família");
  const chosen = await line("LOJA XPTO")
    .getByRole("combobox")
    .evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent);
  expect(chosen).toBe("Papelaria");
});
