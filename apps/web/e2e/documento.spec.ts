// Cadastro com documento: pessoa física, pessoa jurídica, outro país, documento repetido, conta antiga e a
// conta PJ com sócios, em computador e em 375 px, em português e inglês. CPF e CNPJ fictícios. A conta antiga
// usa e2e/apagar-documento.ts e precisa de ADMIN_DATABASE_URL do mesmo banco do servidor.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { newCnpj, newCpf } from "./documents";

const password = "senha-segura-123!";
const shots = process.env.E2E_SHOTS_DIR;
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const uniqueEmail = (prefix: string) =>
  `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
});

async function expectAccessible(page: Page) {
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string) {
  if (!shots) return;
  const project = test.info().project.name;
  await page.screenshot({ path: path.join(shots, `${name}-${project}.png`), fullPage: true });
}

async function fillAccount(page: Page, name: string, email: string) {
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
}

const submit = (page: Page) => page.getByRole("button", { name: "Criar conta" }).click();

async function createSpace(page: Page, label: string, name: string, button: string) {
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel(label).fill(name);
  await page.getByRole("button", { name: button }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function signUpCompany(page: Page, cpf = newCpf()) {
  await page.goto("/cadastro");
  await fillAccount(page, "Dona", uniqueEmail("empresa"));
  await page.getByRole("radio", { name: "Pessoa jurídica" }).check();
  await page.getByLabel("CNPJ", { exact: true }).fill(newCnpj());
  await page.getByLabel("Razão social").fill("Comercio Exemplo Ltda");
  await page.getByLabel("CPF do responsável").fill(cpf);
  await submit(page);
  await createSpace(page, "Nome da empresa", `Padaria ${Date.now()}`, "Criar empresa");
}

/** Só preenche e envia: o resultado fica para o teste conferir. */
async function submitCompany(page: Page, cpf: string, cnpj: string) {
  await page.goto("/cadastro");
  await fillAccount(page, "Dona", uniqueEmail("empresa"));
  await page.getByRole("radio", { name: "Pessoa jurídica" }).check();
  await page.getByLabel("CNPJ", { exact: true }).fill(cnpj);
  await page.getByLabel("Razão social").fill("Comercio Exemplo Ltda");
  await page.getByLabel("CPF do responsável").fill(cpf);
  await submit(page);
}

test("pessoa física: CPF obrigatório, dígito errado não passa e a tela mostra mascarado", async ({
  page,
}) => {
  await page.goto("/cadastro");
  await expect(page.getByRole("radio", { name: "Brasil" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Pessoa física" })).toBeChecked();
  await expectAccessible(page);
  await shot(page, "cadastro-pf");

  await fillAccount(page, "Ana", uniqueEmail("pf"));
  const cpf = newCpf();
  const wrong = `${cpf.slice(0, -1)}${(Number(cpf.at(-1)) + 1) % 10}`;
  await page.getByLabel("CPF", { exact: true }).fill(wrong);
  await submit(page);
  await expect(page.getByText("CPF inválido. Confira os números.")).toBeVisible();
  await expect(page).toHaveURL(/\/cadastro$/);
  await expectAccessible(page);

  await page.getByLabel("CPF", { exact: true }).fill("111.111.111-11");
  await submit(page);
  await expect(page.getByText("CPF inválido. Confira os números.")).toBeVisible();

  await page.getByLabel("CPF", { exact: true }).fill(cpf);
  await submit(page);
  await createSpace(page, "Nome da família", `Família Doc ${Date.now()}`, "Criar família");

  await page.goto("/app/configuracoes");
  const middle = `***.${cpf.slice(4, 7)}.${cpf.slice(8, 11)}-**`;
  await expect(page.getByText(middle)).toBeVisible();
  await expect(page.getByText(cpf)).toHaveCount(0);

  const exported = await (await page.request.get("/app/exportar")).text();
  expect(exported).toContain(middle);
  expect(exported).not.toContain(cpf);
  expect(exported).not.toContain(cpf.replace(/\D/g, ""));
});

test("pessoa jurídica: CNPJ com letras, razão social e CPF de quem cadastra", async ({ page }) => {
  await page.goto("/cadastro");
  await fillAccount(page, "Dona", uniqueEmail("pj"));
  await page.getByRole("radio", { name: "Pessoa jurídica" }).check();
  await expectAccessible(page);
  await shot(page, "cadastro-pj");

  const cnpj = newCnpj();
  const wrong = `${cnpj.slice(0, -1)}${(Number(cnpj.at(-1)) + 1) % 10}`;
  await page.getByLabel("CNPJ", { exact: true }).fill(wrong);
  await page.getByLabel("Razão social").fill("x");
  await page.getByLabel("CPF do responsável").fill(newCpf());
  await submit(page);
  await expect(page.getByText("CNPJ inválido. Confira o que digitou.")).toBeVisible();
  await expect(page.getByText("Informe a razão social.")).toBeVisible();

  await page.getByLabel("CNPJ", { exact: true }).fill(cnpj.toLowerCase());
  await page.getByLabel("Razão social").fill("Comercio Exemplo Ltda");
  await submit(page);
  await createSpace(page, "Nome da empresa", `Padaria ${Date.now()}`, "Criar empresa");

  await page.goto("/app/configuracoes");
  const card = page.getByRole("heading", { name: "Dados da empresa" });
  await expect(card).toBeVisible();
  await expect(page.getByText("Comercio Exemplo Ltda")).toBeVisible();
  await expect(page.getByText(`**.${cnpj.slice(3, 6)}`)).toBeVisible();
  await shot(page, "configuracoes-pj");
});

test("outro país: o documento some e a conta nasce sem ele", async ({ page }) => {
  await page.goto("/cadastro");
  await fillAccount(page, "Noa", uniqueEmail("fora"));
  await page.getByRole("radio", { name: "Outro país" }).check();
  await expect(page.getByLabel("CPF", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Pessoa jurídica" })).toHaveCount(0);
  await expectAccessible(page);
  await submit(page);
  await createSpace(page, "Nome da família", `Família Fora ${Date.now()}`, "Criar família");
  await expect(page.getByRole("link", { name: "Informar agora" })).toHaveCount(0);
});

test("documento repetido recebe mensagem neutra, e a conta não fica pela metade", async ({
  page,
  browser,
}) => {
  const cpf = newCpf();
  await page.goto("/cadastro");
  await fillAccount(page, "Ana", uniqueEmail("primeira"));
  await page.getByLabel("CPF", { exact: true }).fill(cpf);
  await submit(page);
  await expect(page).toHaveURL(/\/app\/novo-household$/);

  const other = await browser.newContext();
  const second = await other.newPage();
  const email = uniqueEmail("segunda");
  await second.goto("/cadastro");
  await fillAccount(second, "Bia", email);
  await second.getByLabel("CPF", { exact: true }).fill(cpf);
  await submit(second);
  const refused = second.getByText("Não foi possível concluir com estes dados.");
  await expect(refused).toBeVisible();
  await expect(second.getByText(/já existe|já está|already/i)).toHaveCount(0);
  await expect(second).toHaveURL(/\/cadastro$/);

  // O e-mail não ficou preso: com outro CPF, a mesma pessoa se cadastra.
  await second.getByLabel("CPF", { exact: true }).fill(newCpf());
  await submit(second);
  await expect(second).toHaveURL(/\/app\/novo-household$/);
  await other.close();
});

test("a mesma pessoa tem conta PF e empresas, mas o CNPJ não repete", async ({ page, browser }) => {
  const cpf = newCpf();
  const cnpj = newCnpj();
  await page.goto("/cadastro");
  await fillAccount(page, "Ana", uniqueEmail("pessoal"));
  await page.getByLabel("CPF", { exact: true }).fill(cpf);
  await submit(page);
  await expect(page).toHaveURL(/\/app\/novo-household$/);

  const open = async () => (await browser.newContext()).newPage();
  const first = await open();
  await submitCompany(first, cpf, cnpj);
  await expect(first).toHaveURL(/\/app\/novo-household$/);

  const second = await open();
  await submitCompany(second, cpf, newCnpj());
  await expect(second).toHaveURL(/\/app\/novo-household$/);

  const repeated = await open();
  await submitCompany(repeated, cpf, cnpj);
  await expect(repeated.getByText("Não foi possível concluir com estes dados.")).toBeVisible();
  await expect(repeated).toHaveURL(/\/cadastro$/);
});

test("quem já tem conta PF entra pelo login e aceita ser sócio, sem repetir o CPF", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("ja-tem-pf");
  const context = await browser.newContext();
  const person = await context.newPage();
  await person.goto("/cadastro");
  await fillAccount(person, "Lia", email);
  await person.getByLabel("CPF", { exact: true }).fill(newCpf());
  await submit(person);
  await expect(person).toHaveURL(/\/app\/novo-household$/);
  await context.close();

  await signUpCompany(page);
  await page.goto("/app/familia");
  await page.getByRole("button", { name: "Convidar" }).click();
  await page.getByLabel("E-mail do sócio").fill(email);
  await page.getByRole("button", { name: "Criar convite" }).click();
  const linkField = page.getByLabel(`Link do convite de ${email}`);
  const link = new URL(await linkField.inputValue()).pathname;

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(link);
  await guest.getByRole("link", { name: "Já tenho conta" }).click();
  await guest.getByLabel("E-mail").fill(email);
  await guest.getByLabel("Senha").fill(password);
  await guest.getByRole("button", { name: "Entrar" }).click();
  await expect(guest.getByRole("button", { name: "Aceitar convite" })).toBeVisible();
  await expect(guest.getByLabel("CPF", { exact: true })).toHaveCount(0);
  await guest.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(guest).toHaveURL(/\/app$/);
  await guest.goto("/app/familia");
  await expect(
    guest.getByRole("list", { name: "Sócios da empresa" }).getByText("Lia"),
  ).toBeVisible();
  await guestContext.close();
});

test("em inglês o cadastro funciona e já vem em outro país", async ({ page }) => {
  await page.goto("/cadastro?lang=en");
  await expect(page.getByRole("radio", { name: "Another country" })).toBeChecked();
  await expect(page.getByLabel("CPF", { exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: "Brazil" }).check();
  await expect(page.getByLabel("CPF", { exact: true })).toBeVisible();
  await expectAccessible(page);
  await shot(page, "cadastro-en");

  await page.getByLabel("Your name").fill("Ana");
  await page.getByLabel("Email").fill(uniqueEmail("en"));
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("checkbox", { name: /I have read/ }).check();
  await page.getByLabel("CPF", { exact: true }).fill("111.111.111-11");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Invalid CPF. Check the numbers.")).toBeVisible();

  await page.getByRole("radio", { name: "Company" }).check();
  await page.getByLabel("CNPJ", { exact: true }).fill(newCnpj());
  await page.getByLabel("Registered company name").fill("Example Trading Ltda");
  await page.getByLabel("CPF of the person in charge").fill(newCpf());
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create your company's space");
});

test("conta antiga: o pedido aparece uma vez, sem bloquear, e dá para informar depois", async ({
  page,
}) => {
  test.skip(
    !process.env.ADMIN_DATABASE_URL,
    "Defina ADMIN_DATABASE_URL do mesmo banco do servidor.",
  );
  const email = uniqueEmail("antiga");
  await page.goto("/cadastro");
  await fillAccount(page, "Rui", email);
  await page.getByRole("radio", { name: "Outro país" }).check();
  await submit(page);
  await createSpace(page, "Nome da família", `Família Antiga ${Date.now()}`, "Criar família");
  execFileSync(process.execPath, ["--import", "tsx", "apps/web/e2e/apagar-documento.ts", email], {
    cwd: repoRoot,
    env: process.env,
    stdio: "pipe",
  });

  await page.goto("/app");
  const notice = page.getByRole("region", { name: "Aviso" });
  await expect(notice.getByText("Falta informar seu documento.")).toBeVisible();

  await page.goto("/app/completar");
  await expect(page.getByRole("heading", { level: 1, name: "Seu documento" })).toBeVisible();
  await expectAccessible(page);
  await shot(page, "completar-documento");

  // Não informa agora: o resto do cadastro continua, e o pedido não volta.
  await page.getByRole("button", { name: "Agora não" }).click();
  await expect(page).toHaveURL(/passo=1$/);
  await page.goto("/app");
  await expect(page.getByText("Falta informar seu documento.")).toHaveCount(0);

  await page.goto("/app/configuracoes");
  await expect(page.getByText("Nenhum documento informado.")).toBeVisible();
  await page.getByRole("link", { name: "Informar documento" }).click();
  await page.getByRole("radio", { name: "Brasil" }).check();
  const cpf = newCpf();
  await page.getByLabel("CPF", { exact: true }).fill("000.000.000-00");
  await page.getByRole("button", { name: "Salvar documento" }).click();
  await expect(page.getByText("CPF inválido. Confira os números.")).toBeVisible();
  await page.getByLabel("CPF", { exact: true }).fill(cpf);
  await page.getByRole("button", { name: "Salvar documento" }).click();
  await expect(page).toHaveURL(/\/app\/completar\?passo=1$/);

  await page.goto("/app/configuracoes");
  await expect(page.getByText(`***.${cpf.slice(4, 7)}.${cpf.slice(8, 11)}-**`)).toBeVisible();
});

async function acceptAsNewPartner(browser: Browser, link: string, name: string, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByText("mostramos qual é a empresa")).toBeVisible();
  await page.getByRole("link", { name: "Criar minha conta" }).click();
  await expect(page.getByRole("radio", { name: "Pessoa jurídica" })).toHaveCount(0);
  await expect(page.getByText("Depois você entra na empresa.")).toBeVisible();
  await fillAccount(page, name, email);
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await submit(page);
  await page.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return { context, page };
}

test("conta PJ convida sócio, e as telas de pessoas e convite não falam em família", async ({
  page,
  browser,
}) => {
  await signUpCompany(page);

  // Menu, tela de pessoas e o que só faz sentido em família.
  await page.goto("/app/familia");
  await expect(page.getByRole("heading", { name: "Sócios da empresa" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/famíl|cônjuge|casamento/i);
  await expectAccessible(page);
  await shot(page, "socios");

  await page.getByRole("button", { name: "Adicionar sócio" }).click();
  const form = page.getByRole("dialog", { name: "Adicionar sócio" });
  await expect(form.getByLabel("Relação")).toHaveCount(0);
  await form.getByLabel("Nome").fill("Sócio Sem Login");
  await form.getByLabel("Participação (%)").fill("150");
  await form.getByRole("button", { name: "Salvar pessoa" }).click();
  await expect(form.getByText("Informe um percentual de 0 a 100")).toBeVisible();
  await form.getByLabel("Participação (%)").fill("12,5");
  await form.getByRole("button", { name: "Salvar pessoa" }).click();
  await expect(form).toBeHidden();
  const list = page.getByRole("list", { name: "Sócios da empresa" });
  await expect(list.getByText("12,5% de participação")).toBeVisible();

  // Ninguém digita o CPF do outro: o convite só pede o e-mail.
  const email = uniqueEmail("socio");
  await page.getByRole("button", { name: "Convidar" }).click();
  const invite = page.getByRole("dialog", { name: "Convidar sócio" });
  await expect(invite.getByLabel(/CPF/)).toHaveCount(0);
  await invite.getByLabel("E-mail do sócio").fill(email);
  await invite.getByRole("button", { name: "Criar convite" }).click();
  const linkField = page.getByLabel(`Link do convite de ${email}`);
  await expect(linkField).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/famíl/i);
  const link = new URL(await linkField.inputValue()).pathname;

  const partner = await acceptAsNewPartner(browser, link, "Caio", email);
  await partner.page.goto("/app/familia");
  await expect(
    partner.page.getByRole("list", { name: "Sócios da empresa" }).getByText("Caio"),
  ).toBeVisible();
  await expect(partner.page.locator("body")).not.toContainText(/famíl/i);
  await shot(partner.page, "socios-convidado");

  // O sócio entra como pessoa: vê o próprio CPF em Configurações, e não o de ninguém mais.
  await partner.page.goto("/app/configuracoes");
  await expect(partner.page.getByRole("heading", { name: "Seu documento" })).toBeVisible();
  await expect(partner.page.getByText("Seu papel na empresa")).toBeVisible();
  await expect(partner.page.locator("body")).not.toContainText(/famíl/i);
  await partner.context.close();

  await page.goto("/app/renda");
  await expect(page.getByLabel("Dependentes")).toHaveCount(0);
});

test("nenhuma tela da conta PJ fala em família ou parentesco", async ({ page }) => {
  await signUpCompany(page);
  const routes = [
    "/app",
    "/app/plano",
    "/app/lancamentos",
    "/app/contas",
    "/app/cartoes",
    "/app/dividas",
    "/app/renda",
    "/app/calendario",
    "/app/reserva",
    "/app/patrimonio",
    "/app/investimentos",
    "/app/metas",
    "/app/aposentadoria",
    "/app/viagens",
    "/app/familia",
    "/app/configuracoes",
    "/app/sugestoes",
    "/app/notificacoes",
    "/app/relatorios",
    "/app/balanceamento",
    "/app/proventos",
    "/app/categorias",
    "/app/importar",
    "/app/completar?passo=1",
    "/app/completar?passo=2",
    "/app/completar?passo=3",
    "/app/completar?passo=4",
    "/app/escolher",
  ];
  const left: string[] = [];
  for (const route of routes) {
    await page.goto(route);
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const found = /.{0,40}(famíl|cônjuge|\bfilhos?\b|casamento|dependentes?\b).{0,40}/i.exec(text);
    if (found) left.push(`${route}: ${found[0]}`);
  }
  expect(left).toEqual([]);
});

test("quem já tem conta informa o próprio CPF ao aceitar ser sócio", async ({ page, browser }) => {
  test.skip(
    !process.env.ADMIN_DATABASE_URL,
    "Defina ADMIN_DATABASE_URL do mesmo banco do servidor.",
  );
  await signUpCompany(page);
  const email = uniqueEmail("ja-tem-conta");

  // Conta de antes do pedido de documento.
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto("/cadastro");
  await fillAccount(guest, "Lia", email);
  await guest.getByRole("radio", { name: "Outro país" }).check();
  await submit(guest);
  await expect(guest).toHaveURL(/\/app\/novo-household$/);
  execFileSync(process.execPath, ["--import", "tsx", "apps/web/e2e/apagar-documento.ts", email], {
    cwd: repoRoot,
    env: process.env,
    stdio: "pipe",
  });

  await page.goto("/app/familia");
  await page.getByRole("button", { name: "Convidar" }).click();
  await page.getByLabel("E-mail do sócio").fill(email);
  await page.getByRole("button", { name: "Criar convite" }).click();
  const linkField = page.getByLabel(`Link do convite de ${email}`);
  const link = new URL(await linkField.inputValue()).pathname;

  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: "Seu CPF" })).toBeVisible();
  await expect(guest.locator("body")).not.toContainText(/famíl/i);
  await expectAccessible(guest);
  await shot(guest, "convite-cpf");
  await guest.getByRole("radio", { name: "Brasil" }).check();
  await guest.getByLabel("CPF", { exact: true }).fill(newCpf());
  await guest.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(guest).toHaveURL(/\/app$/);
  await context.close();
});
