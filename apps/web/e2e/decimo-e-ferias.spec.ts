// 13º e férias da renda CLT: 1ª parcela já recebida, tudo de uma vez, férias integrais, divididas e
// vendidas, no computador e a 375 px, em português e inglês, com axe. Rode com E2E_375=1 para os 375 px.
// E2E_SHOTS=<pasta> guarda as capturas.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { newCpf } from "./documents";

const password = "senha-segura-123!";
const form = (page: Page, title = "Nova renda") => page.getByRole("dialog", { name: title });

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

const narrow = async (page: Page, project: string) => {
  if (project !== "desktop") await page.setViewportSize({ width: 375, height: 812 });
};

const shot = async (target: Page | Locator, name: string, project: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await target.screenshot({ path: `${dir}/${name}-${project}.png` });
};

const fullShot = async (page: Page, name: string, project: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}-${project}.png`, fullPage: true });
};

const accessible = async (page: Page) => {
  const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(report.violations.map((violation) => violation.id)).toEqual([]);
};

const noOverflow = async (page: Page) => {
  const [scroll, inner] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(inner!);
};

/** Mês do calendário de hoje e meses vizinhos, no fuso do Brasil. */
function today() {
  const text = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const [year, month] = text.split("-").map(Number) as [number, number];
  return { year, month };
}

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

async function openNew(page: Page, name: string, gross = "6.000,00") {
  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Cadastrar renda" }).click();
  const sheet = form(page);
  await sheet.getByLabel("Empresa").fill(name);
  await sheet.getByLabel("Salário bruto (R$)").fill(gross);
  return sheet;
}

const saveForm = async (sheet: Locator) => {
  await sheet.getByRole("button", { name: "Salvar renda" }).click();
  await expect(sheet).toBeHidden();
};

const result = (sheet: Locator) => sheet.getByRole("region", { name: "Quanto e quando entra" });

const row = (page: Page, text: string | RegExp) =>
  page.getByRole("row").filter({ hasText: text }).first();

test("caso de julho: a 1ª já recebida não vira atraso e a 2ª vem certa", async ({ page }, info) => {
  const { year, month } = today();
  test.skip(month <= 2, "A 1ª parcela começa em fevereiro: ainda não há mês que tenha passado.");
  await narrow(page, info.project.name);
  await signUp(page, "Julia");
  const paid = month > 7 ? 7 : month - 1;

  const sheet = await openNew(page, "Empresa Julho");
  await expect(sheet.getByRole("group", { name: "13º salário" })).toBeVisible();
  await expect(sheet.getByRole("group", { name: "Férias" })).toBeVisible();
  await expect(sheet.getByLabel("Mês das férias")).toBeVisible();
  await expect(result(sheet)).toContainText("1.973,39");

  await sheet.getByLabel("Mês da 1ª parcela").selectOption(String(paid));
  // Mês que já passou: a marca liga sozinha, à vista.
  await expect(sheet.getByRole("checkbox", { name: /Já recebi a primeira/ })).toBeChecked();
  await expect(result(sheet)).toContainText("Recebida");
  await expect(result(sheet)).toContainText("3.000,00");
  await accessible(page);
  await noOverflow(page);
  await shot(sheet, "13-julho", info.project.name);
  await saveForm(sheet);

  await expect(page.getByRole("region", { name: "13º salário" }).first()).toContainText(
    "(recebida)",
  );
  // O ano seguinte herda o mês, sem a marca de recebido.
  await expect(page.getByText(`Mesma escolha de ${year}.`)).toBeVisible();
  await expect(page.getByRole("region", { name: "13º salário" }).last()).not.toContainText(
    "(recebida)",
  );
  await fullShot(page, "cartao-julho", info.project.name);

  // Nada em novembro nem no mês escolhido, sem lançamento criado.
  await page.goto(`/app/lancamentos?m=${ym(year, paid)}`);
  await expect(page.getByRole("row").filter({ hasText: "13º, 1ª parcela" })).toHaveCount(0);
  if (month <= 11) {
    await page.goto(`/app/lancamentos?m=${ym(year, 11)}`);
    await expect(page.getByRole("row").filter({ hasText: "1ª parcela" })).toHaveCount(0);
  }

  const december = ym(year, 12);
  await page.goto(`/app/lancamentos?m=${december}`);
  await expect(row(page, "13º, 2ª parcela")).toContainText("1.973,39");
  // Calendário: salário de dezembro + 2ª parcela, a mesma conta de Lançamentos.
  await page.goto(`/app/calendario?m=${december}`);
  await expect(page.locator("main")).toContainText("6.946,78");

  // Pelo botão com texto do cartão, a pessoa volta e registra o lançamento.
  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Ajustar 13º e férias" }).click();
  const edit = form(page, "Editar renda");
  await expect(edit.getByRole("checkbox", { name: /Já recebi a primeira/ })).toBeChecked();
  await edit.getByLabel("Valor da 1ª parcela (R$)").fill("2.800,00");
  await expect(result(edit)).toContainText("2.800,00");
  await edit.getByRole("checkbox", { name: "Registrar também em Lançamentos" }).check();
  await saveForm(edit);

  await page.goto(`/app/lancamentos?m=${ym(year, paid)}`);
  await expect(row(page, "13º, 1ª parcela")).toContainText("2.800,00");
  await expect(row(page, "13º, 1ª parcela")).toContainText("Recebido");
  await page.goto(`/app/lancamentos?m=${december}`);
  await expect(row(page, "13º, 2ª parcela")).toContainText("2.173,39");

  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Ajustar 13º e férias" }).click();
  await expect(form(page, "Editar renda")).toContainText("A 1ª parcela já está em Lançamentos");
});

test("tudo de uma vez: um pagamento só, no mês escolhido", async ({ page }, info) => {
  await narrow(page, info.project.name);
  await signUp(page, "Iara");
  const { year, month } = today();
  const sheet = await openNew(page, "Empresa Integral");
  await sheet.getByRole("radio", { name: "Tudo de uma vez" }).check();
  await expect(sheet.getByLabel("Mês da 1ª parcela")).toHaveCount(0);
  await expect(sheet.getByRole("group", { name: "13º salário" })).toContainText(
    "O INSS e o imposto saem deste pagamento",
  );
  await expect(result(sheet)).toContainText("4.973,39");
  await accessible(page);
  await noOverflow(page);
  await shot(sheet, "13-integral", info.project.name);
  await saveForm(sheet);

  await page.goto(`/app/lancamentos?m=${ym(year, 12)}`);
  await expect(row(page, "13º salário · Empresa Integral")).toContainText("4.973,39");
  await expect(page.getByRole("row").filter({ hasText: "2ª parcela" })).toHaveCount(0);
  if (month <= 11) {
    await page.goto(`/app/lancamentos?m=${ym(year, 11)}`);
    await expect(page.getByRole("row").filter({ hasText: "1ª parcela" })).toHaveCount(0);
  }
});

test("férias integrais: pagas 2 dias antes, sem salário nos dias de férias", async ({
  page,
}, info) => {
  await narrow(page, info.project.name);
  await signUp(page, "Tomas");
  const { year, month } = today();
  // Daqui a dois meses, para o pagamento ainda não ter passado.
  const later = month + 2;
  const start = later > 12 ? [year + 1, later - 12] : [year, later];
  const [startYear, startMonth] = start as [number, number];
  const before = startMonth === 1 ? ym(startYear - 1, 12) : ym(startYear, startMonth - 1);

  const sheet = await openNew(page, "Empresa Inteira", "3.000,00");
  await sheet.getByLabel("Ano destas escolhas").selectOption(String(startYear));
  await sheet.getByLabel("Mês das férias").selectOption(String(startMonth));
  await sheet.getByLabel("Começa no dia").fill("1");
  await expect(result(sheet)).toContainText("Férias, 30 dias");
  await expect(result(sheet)).toContainText("por isso este pagamento cai no mês anterior");
  await accessible(page);
  await noOverflow(page);
  await shot(sheet, "ferias-integrais", info.project.name);
  await saveForm(sheet);

  await page.goto(`/app/lancamentos?m=${before}`);
  await expect(row(page, "Férias · Empresa Inteira")).toBeVisible();
  await page.goto(`/app/lancamentos?m=${ym(startYear, startMonth)}`);
  await expect(page.getByRole("row").filter({ hasText: "Férias · Empresa Inteira" })).toHaveCount(
    0,
  );
});

test("férias divididas: valida os limites da lei e gera um pagamento por período", async ({
  page,
}, info) => {
  await narrow(page, info.project.name);
  await signUp(page, "Dora");
  const next = today().year + 1;
  const sheet = await openNew(page, "Empresa Dividida");
  await sheet.getByLabel("Ano destas escolhas").selectOption(String(next));
  await sheet.getByLabel("Mês das férias").selectOption("1");
  await sheet.getByLabel("Começa no dia").fill("10");
  await sheet.getByLabel("Dias", { exact: true }).fill("10");
  await sheet.getByRole("button", { name: "Adicionar período" }).click();

  const second = sheet.getByRole("group", { name: "Período 2" });
  await second.getByLabel("Mês das férias").selectOption("9");
  await second.getByLabel("Começa no dia").fill("10");
  await second.getByLabel("Dias", { exact: true }).fill("10");
  await expect(sheet.getByText("Um dos períodos precisa de pelo menos 14 dias.")).toBeVisible();
  await expect(result(sheet)).toContainText("Corrija os campos acima");

  const first = sheet.getByRole("group", { name: "Período 1" });
  await first.getByLabel("Dias", { exact: true }).fill("14");
  await second.getByLabel("Dias", { exact: true }).fill("4");
  await expect(sheet.getByText("Cada período precisa de pelo menos 5 dias.")).toBeVisible();
  await second.getByLabel("Dias", { exact: true }).fill("11");

  await sheet.getByRole("button", { name: "Adicionar período" }).click();
  const third = sheet.getByRole("group", { name: "Período 3" });
  await third.getByLabel("Mês das férias").selectOption("11");
  await third.getByLabel("Começa no dia").fill("20");
  await third.getByLabel("Dias", { exact: true }).fill("5");
  await expect(sheet.getByRole("button", { name: "Adicionar período" })).toHaveCount(0);
  await expect(result(sheet)).toContainText("Férias, 14 dias");
  await expect(result(sheet)).toContainText("Férias, 11 dias");
  await expect(result(sheet)).toContainText("Férias, 5 dias");
  await accessible(page);
  await noOverflow(page);
  await shot(sheet, "ferias-divididas", info.project.name);
  await saveForm(sheet);

  await expect(page.getByRole("region", { name: "Férias" }).last()).toContainText("14 dias");
  await expect(page.getByRole("region", { name: "Férias" }).last()).toContainText("11 dias");
  await expect(page.getByText(`Em ${next}`)).toBeVisible();
  await fullShot(page, "cartao-dividido", info.project.name);

  // A escolha é do ano seguinte, com um pagamento por período.
  await page.goto(`/app/lancamentos?m=${ym(next, 9)}`);
  await expect(row(page, "Férias · Empresa Dividida")).toBeVisible();
  await page.goto(`/app/lancamentos?m=${ym(next, 11)}`);
  await expect(row(page, "Férias · Empresa Dividida")).toBeVisible();
});

test("férias vendidas: abono com a conta certa e limite de 10 dias", async ({ page }, info) => {
  await narrow(page, info.project.name);
  await signUp(page, "Vera");
  const { year, month } = today();
  const later = month + 2;
  const startMonth = later > 12 ? later - 12 : later;
  const startYear = later > 12 ? year + 1 : year;

  const sheet = await openNew(page, "Empresa Vendida", "3.000,00");
  await sheet.getByLabel("Ano destas escolhas").selectOption(String(startYear));
  await sheet.getByLabel("Mês das férias").selectOption(String(startMonth));
  await sheet.getByLabel("Começa no dia").fill("6");
  // Apagar os dias não derruba a tela.
  await sheet.getByLabel("Dias", { exact: true }).fill("");
  await expect(sheet.getByText("Confira o mês e os dias de cada período.")).toBeVisible();
  await sheet.getByLabel("Dias", { exact: true }).fill("20");
  await expect(result(sheet)).toContainText("Faltam 10 dias");
  await sheet.getByRole("checkbox", { name: "Vender dias de férias" }).check();
  await sheet.getByLabel("Quantos dias").fill("11");
  await expect(sheet.getByText("Dá para vender até 10 dias")).toBeVisible();
  // Apagar o campo não derruba a tela.
  await sheet.getByLabel("Quantos dias").fill("");
  await expect(sheet.getByText("Informe quantos dias, de 1 a 10.")).toBeVisible();
  await expect(result(sheet)).toContainText("Corrija os campos acima");
  await sheet.getByLabel("Quantos dias").fill("10");
  await expect(result(sheet)).toContainText("Com 10 dias vendidos");
  // Mesmo caso do teste de regras: R$ 3.000, 20 dias e 10 vendidos.
  await expect(result(sheet)).toContainText("3.784,31");
  await expect(result(sheet)).toContainText("887,09");
  await expect(result(sheet)).not.toContainText("Faltam");
  await accessible(page);
  await noOverflow(page);
  await shot(sheet, "ferias-vendidas", info.project.name);
  await saveForm(sheet);

  await page.goto(`/app/lancamentos?m=${ym(startYear, startMonth)}`);
  await expect(row(page, "Férias · Empresa Vendida")).toContainText("3.784,31");
  await expect(row(page, /^(?!.*Férias).*Empresa Vendida/)).toContainText("887,09");
});

test("período recebido movido para o futuro volta para a previsão", async ({ page }, info) => {
  const { year, month } = today();
  test.skip(month === 1 || month === 12, "Precisa de um mês passado e de um por vir no ano.");
  await narrow(page, info.project.name);
  await signUp(page, "Mara");
  const sheet = await openNew(page, "Empresa Movida");
  await sheet.getByLabel("Mês das férias").selectOption(String(month - 1));
  await sheet.getByLabel("Começa no dia").fill("10");
  await sheet.getByLabel("Dias", { exact: true }).fill("20");
  await expect(sheet.getByRole("checkbox", { name: /Já recebi/ }).last()).toBeChecked();
  await sheet.getByLabel("Mês das férias").selectOption(String(month + 1));
  await expect(sheet.getByRole("group", { name: "Período 1" })).not.toContainText("Já recebi");
  await expect(result(sheet)).not.toContainText("Recebida · Férias");
  await saveForm(sheet);
  await page.goto(`/app/lancamentos?m=${ym(year, month + 1)}`);
  await expect(row(page, "Férias · Empresa Movida")).toBeVisible();
});

test("tudo de uma vez em mês passado oferece Já recebi", async ({ page }, info) => {
  const { year, month } = today();
  test.skip(month === 1, "Em janeiro nenhum mês deste ano passou.");
  await narrow(page, info.project.name);
  await signUp(page, "Nina");
  const sheet = await openNew(page, "Empresa Passada");
  await sheet.getByRole("radio", { name: "Tudo de uma vez" }).check();
  await sheet.getByLabel("Mês do pagamento").selectOption(String(month - 1));
  await expect(sheet.getByRole("checkbox", { name: "Já recebi" })).toBeChecked();
  await expect(result(sheet)).toContainText("Recebida");
  await sheet.getByRole("checkbox", { name: "Já recebi" }).scrollIntoViewIfNeeded();
  await shot(sheet, "integral-passado", info.project.name);
  await saveForm(sheet);
  await page.goto(`/app/lancamentos?m=${ym(year, month - 1)}`);
  await expect(page.getByRole("row").filter({ hasText: "13º salário" })).toHaveCount(0);
});

test("1ª parcela que cobre o 13º explica por que não há 2ª", async ({ page }, info) => {
  const { month } = today();
  test.skip(month <= 2, "A 1ª parcela começa em fevereiro.");
  await narrow(page, info.project.name);
  await signUp(page, "Bela");
  const sheet = await openNew(page, "Empresa Coberta");
  await sheet.getByLabel("Mês da 1ª parcela").selectOption(String(month > 7 ? 7 : month - 1));
  await sheet.getByLabel("Valor da 1ª parcela (R$)").fill("5.000,00");
  await expect(result(sheet)).toContainText("A 1ª parcela já cobre todo o 13º líquido");
  await result(sheet).scrollIntoViewIfNeeded();
  await shot(sheet, "segunda-coberta", info.project.name);
  await saveForm(sheet);
  await expect(page.getByRole("region", { name: "13º salário" }).first()).toContainText(
    "não há mais nada a receber",
  );
});

test("o ano seguinte pode ter escolha própria, e janeiro não é mês da 1ª parcela", async ({
  page,
}, info) => {
  await narrow(page, info.project.name);
  await signUp(page, "Lia");
  const { year } = today();
  const sheet = await openNew(page, "Empresa Anos");
  const options = sheet.getByLabel("Mês da 1ª parcela").getByRole("option");
  await expect(options.first()).toHaveText("Fevereiro");
  await sheet.getByLabel("Mês da 1ª parcela").selectOption("9");
  await sheet.getByLabel("Ano destas escolhas").selectOption(String(year + 1));
  // Trocar o ano não leva o que foi digitado.
  await expect(sheet.getByLabel("Mês da 1ª parcela")).toHaveValue("11");
  await sheet.getByLabel("Mês da 1ª parcela").selectOption("5");
  await expect(sheet.getByText(/Mesma escolha de/)).toHaveCount(0);
  await result(sheet).scrollIntoViewIfNeeded();
  await shot(sheet, "ano-seguinte", info.project.name);
  await saveForm(sheet);
  await page.goto(`/app/lancamentos?m=${ym(year + 1, 5)}`);
  await expect(row(page, "13º, 1ª parcela")).toContainText("3.000,00");
  // A escolha segue valendo nos anos seguintes.
  await page.goto(`/app/lancamentos?m=${ym(year + 2, 5)}`);
  await expect(row(page, "13º, 1ª parcela")).toContainText("3.000,00");
});

test("a escolha de um ano segue no seguinte, e o formulário diz de onde veio", async ({
  page,
}, info) => {
  const { year } = today();
  await narrow(page, info.project.name);
  await signUp(page, "Clara");
  const sheet = await openNew(page, "Empresa Herdada");
  await sheet.getByLabel("Mês da 1ª parcela").selectOption("9");
  await saveForm(sheet);
  await page.getByRole("button", { name: "Ajustar 13º e férias" }).click();
  const edit = form(page, "Editar renda");
  await edit.getByLabel("Ano destas escolhas").selectOption(String(year + 1));
  await expect(edit.getByText(`Mesma escolha de ${year}.`)).toBeVisible();
  await expect(edit.getByLabel("Mês da 1ª parcela")).toHaveValue("9");
  await expect(edit.getByRole("checkbox", { name: /Já recebi a primeira/ })).toHaveCount(0);
  await result(edit).scrollIntoViewIfNeeded();
  await shot(edit, "ano-herdado", info.project.name);
});

test("renda sem mês de férias: escolher pelo botão do cartão fica salvo", async ({
  page,
}, info) => {
  await narrow(page, info.project.name);
  await signUp(page, "Rute");
  const sheet = await openNew(page, "Empresa Sem Mes");
  await saveForm(sheet);

  await page.getByRole("button", { name: "Ajustar 13º e férias" }).click();
  const edit = form(page, "Editar renda");
  await edit.getByLabel("Ano destas escolhas").selectOption(String(today().year + 1));
  await edit.getByLabel("Mês das férias").selectOption("7");
  await saveForm(edit);
  await expect(page.getByRole("region", { name: "Férias" }).last()).toContainText("julho");

  // É o pedido central: ao recarregar, o mês continua escolhido.
  await page.reload();
  await page.getByRole("button", { name: "Ajustar 13º e férias" }).click();
  const again = form(page, "Editar renda");
  await again.getByLabel("Ano destas escolhas").selectOption(String(today().year + 1));
  await expect(again.getByLabel("Mês das férias")).toHaveValue("7");
});

test("13º recebido de uma vez não volta em duas parcelas", async ({ page }, info) => {
  const { year, month } = today();
  test.skip(month === 1, "Em janeiro nenhum mês deste ano passou.");
  await narrow(page, info.project.name);
  await signUp(page, "Duda");
  const sheet = await openNew(page, "Empresa Quitada");
  await sheet.getByRole("radio", { name: "Tudo de uma vez" }).check();
  await sheet.getByLabel("Mês do pagamento").selectOption(String(month - 1));
  await saveForm(sheet);

  await page.getByRole("button", { name: "Ajustar 13º e férias" }).click();
  const edit = form(page, "Editar renda");
  await edit.getByRole("radio", { name: "Em duas parcelas" }).check();
  await expect(edit.getByText(/já está quitado/)).toBeVisible();
  await expect(edit.getByRole("checkbox", { name: /Já recebi a primeira/ })).toHaveCount(0);
  await result(edit).scrollIntoViewIfNeeded();
  await shot(edit, "quitado", info.project.name);
  await saveForm(edit);
  await page.goto(`/app/lancamentos?m=${ym(year, 12)}`);
  await expect(page.getByRole("row").filter({ hasText: /parcela/ })).toHaveCount(0);
});

test("tirar período com baixa avisa que a baixa fica sem período", async ({ page }, info) => {
  const { year, month } = today();
  test.skip(month === 12, "Precisa de um mês por vir neste ano.");
  await narrow(page, info.project.name);
  await signUp(page, "Iris");
  const sheet = await openNew(page, "Empresa Baixa");
  await sheet.getByLabel("Mês das férias").selectOption(String(month + 1));
  await saveForm(sheet);

  await page.goto(`/app/lancamentos?m=${ym(year, month + 1)}`);
  await row(page, "Férias · Empresa Baixa")
    .getByRole("button", { name: "Receber" })
    .locator("visible=true")
    .click();
  await expect(row(page, "Férias · Empresa Baixa")).toContainText("Recebido");

  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Ajustar 13º e férias" }).click();
  const edit = form(page, "Editar renda");
  await edit.getByLabel("Mês das férias").selectOption("0");
  await expect(edit.getByText(/fica sem período/)).toBeVisible();
  await edit.getByText(/fica sem período/).scrollIntoViewIfNeeded();
  await shot(edit, "baixa-sem-periodo", info.project.name);
  await saveForm(edit);
  await expect(page.getByText(/fica sem período/).first()).toBeVisible();
});

test("em inglês: formulário e resultado traduzidos", async ({ page }, info) => {
  await narrow(page, info.project.name);
  await signUp(page, "Olivia");
  await page.goto("/app/configuracoes");
  await page.getByLabel("Idioma", { exact: true }).selectOption("en");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  await page.goto("/app/renda");
  await page.getByRole("button", { name: "Add income" }).click();
  const sheet = page.getByRole("dialog", { name: "New income" });
  await sheet.getByLabel("Company").fill("Example Inc.");
  await sheet.getByLabel("Gross salary (R$)").fill("6,000.00");
  await sheet.getByRole("radio", { name: "All at once" }).check();
  await sheet.getByLabel("Vacation month").selectOption("3");
  await sheet.getByLabel("Starts on day").fill("16");
  await sheet.getByRole("checkbox", { name: "Sell vacation days" }).check();
  await sheet.getByLabel("Days", { exact: true }).fill("20");
  const box = sheet.getByRole("region", { name: "How much comes in, and when" });
  await expect(box).toContainText("13th salary, all at once");
  await expect(box).toContainText("With 10 days sold");
  await expect(sheet).not.toContainText("Férias");
  await accessible(page);
  await noOverflow(page);
  await shot(sheet, "formulario-ingles", info.project.name);
  await sheet.getByRole("button", { name: "Save income" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Adjust 13th salary and vacation" })).toBeVisible();
  await fullShot(page, "cartao-ingles", info.project.name);
});
