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
  await upload(page, "extrato.pdf", "%PDF-1.7");
  await expect(page.getByText(/Excel e PDF não são lidos/)).toBeVisible();
});
