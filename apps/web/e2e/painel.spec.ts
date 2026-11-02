// Painel por mês: trocar de mês por seta e por endereço, mês inválido, mês futuro, conta vazia e conta cheia,
// em computador e em 375 px, em português e inglês. Precisa de E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL, do
// mesmo banco do servidor, para pôr seis meses de dados. Com E2E_SHOTS_DIR, grava as telas.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { newCpf } from "./documents";

const shots = process.env.E2E_SHOTS_DIR;
const workerUrl = process.env.E2E_WORKER_DATABASE_URL ?? "";

const password = "senha-segura-123!";
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const unique = () => `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

const monthFrom = (delta: number) => {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const date = new Date(Date.UTC(today.getFullYear(), today.getMonth() + delta, 15));
  return date.toISOString().slice(0, 7);
};

async function signUp(page: Page, family: string, english = false) {
  await page.goto(english ? "/cadastro?lang=en" : "/cadastro");
  await page.getByLabel(english ? "Your name" : "Seu nome").fill("Bia");
  // Em inglês o cadastro já vem em outro país, sem documento.
  if (!english) await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel(english ? "Email" : "E-mail").fill(`painel.${unique()}@example.com`);
  await page.getByLabel(english ? "Password" : "Senha", { exact: true }).fill(password);
  await page.getByLabel(english ? "Confirm password" : "Confirmar senha").fill(password);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: english ? "Create account" : "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel(english ? "Family name" : "Nome da família").fill(family);
  await page.getByRole("button", { name: english ? "Create family" : "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

function seed(family: string) {
  execFileSync(process.execPath, ["--import", "tsx", "apps/web/e2e/painel.ts", family], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: workerUrl },
    stdio: "pipe",
  });
}

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/.+/);
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string, project: string) {
  if (!shots) return;
  await page.screenshot({ path: path.join(shots, `${name}-${project}.png`), fullPage: true });
}

/** Pelo rótulo exato: a dica de outro bloco pode citar a mesma palavra. */
const total = (page: Page, label: string | RegExp) =>
  page
    .locator("dl > div")
    .filter({ has: page.locator("dt").getByText(label, { exact: true }) })
    .locator("dd");

test("conta nova abre boa, sem zeros soltos, e o mês inválido não quebra", async ({
  page,
}, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
  await signUp(page, `Painel vazio ${unique()}`);
  await expect(page.getByRole("heading", { name: "Primeiros passos" })).toBeVisible();
  await expect(page.getByText("Seu painel começa aqui")).toBeVisible();
  await expect(page.getByRole("link", { name: "Fazer o primeiro lançamento" })).toBeVisible();
  await expect(page.locator("dl > div")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mês anterior" })).toBeDisabled();
  await expectAccessible(page);
  await shot(page, "painel-vazio", info.project.name);

  await page.goto("/app?mes=isso-nao-e-mes");
  await expect(page.getByLabel("Mês", { exact: true })).toHaveValue(monthFrom(0));
  await expect(page.getByRole("heading", { level: 1, name: /Olá, Bia/ })).toBeVisible();

  // Mês futuro, mesmo em conta vazia, aparece como previsto.
  await page.goto(`/app?mes=${monthFrom(1)}`);
  await expect(page.getByText("Previsto", { exact: true })).toBeVisible();
});

test.describe("conta cheia", () => {
  test.skip(!workerUrl, "Defina E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL.");

  test("troca de mês por seta, por lista e por endereço, e os números batem", async ({
    page,
  }, info) => {
    if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
    const family = `Painel cheio ${unique()}`;
    await signUp(page, family);
    seed(family);
    await page.reload();

    // Mês atual sem movimento: diz isso e leva ao anterior.
    const previous = monthFrom(-1);
    await expect(page.getByText(/Ainda não há movimento/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Próximos vencimentos" })).toBeVisible();
    await expect(total(page, "Saldo nas contas")).toContainText("Previsão para o fim do mês");
    await expectAccessible(page);
    await shot(page, "painel-mes-atual", info.project.name);

    await page.getByRole("link", { name: /^Ver .+ de 20[0-9]{2}$/ }).click();
    await expect(page).toHaveURL(new RegExp(`mes=${previous}`));
    await expect(page.getByLabel("Mês", { exact: true })).toHaveValue(previous);

    // Mês passado cheio: resumo, categorias, conta, investimentos e proventos.
    await expect(total(page, "Receitas")).toContainText("9.200,00");
    await expect(total(page, "Despesas")).toContainText("a mais que no mês anterior");
    await expect(total(page, "Saldo no fim do mês")).toContainText(/R\$\s[\d.]+,\d{2}/);
    await expect(page.getByText(/dinheiro guardado, não consumo/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Por categoria" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Despesas" })).toContainText("Moradia");
    await expect(page.getByRole("list", { name: "Despesas" })).toContainText("Outras");
    await expect(page.getByRole("list", { name: "Receitas" })).toContainText("Salário");
    await expect(page.getByRole("list", { name: "Por conta" })).toContainText(
      "Poupança da família",
    );
    await expect(page.getByRole("list", { name: "Cartões" })).toContainText("Visa da família");
    await expect(page.getByRole("list", { name: "Cartões" })).toContainText("Paga");
    await expect(page.getByText(/a carteira é a de hoje/)).toBeVisible();
    await expect(page.getByText("Valor da carteira")).toBeVisible();
    await expect(page.getByText("Histórico das operações")).toBeVisible();
    await expect(page.getByRole("list", { name: "Divisão por classe, hoje" })).toContainText(
      "Renda fixa",
    );
    await expect(total(page, /^Recebidos em/)).toContainText("95,00");
    await expect(page.getByText("Reserva de emergência hoje")).toBeVisible();
    await expect(
      page.getByRole("table", { name: /Receitas e despesas de 12 meses/ }),
    ).toBeAttached();
    await expectAccessible(page);
    await shot(page, "painel-mes-passado", info.project.name);

    // Os totais batem com a tela de lançamentos do mesmo mês.
    const spent = (
      await total(page, "Despesas").first().locator("span").first().innerText()
    ).trim();
    const received = (
      await total(page, "Receitas").first().locator("span").first().innerText()
    ).trim();
    await page.goto(`/app/lancamentos?m=${previous}`);
    await expect(total(page, "Saiu")).toContainText(spent);
    await expect(total(page, "Entrou")).toContainText(received);

    // Seta para trás e para a frente, e o botão de voltar do navegador.
    await page.goto(`/app?mes=${previous}`);
    await page.getByRole("link", { name: "Mês anterior" }).click();
    await expect(page).toHaveURL(new RegExp(`mes=${monthFrom(-2)}`));
    await expect(page.getByLabel("Mês", { exact: true })).toHaveValue(monthFrom(-2));
    await page.getByRole("link", { name: "Próximo mês" }).click();
    await expect(page).toHaveURL(new RegExp(`mes=${previous}`));
    await page.goBack();
    await expect(page.getByLabel("Mês", { exact: true })).toHaveValue(monthFrom(-2));

    // Por lista, e "Hoje" volta.
    await page.getByLabel("Mês", { exact: true }).selectOption(monthFrom(-3));
    await expect(page).toHaveURL(new RegExp(`mes=${monthFrom(-3)}`));
    await page.getByRole("link", { name: "Hoje", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByLabel("Mês", { exact: true })).toHaveValue(monthFrom(0));

    // Clicar no gráfico leva ao mês.
    await page
      .getByRole("link", { name: new RegExp("Abrir este mês") })
      .nth(9)
      .click();
    await expect(page).toHaveURL(new RegExp(`mes=${monthFrom(-2)}`));

    // Categoria leva aos lançamentos filtrados, com as compras do cartão à vista.
    await page
      .getByRole("list", { name: "Despesas" })
      .getByRole("link", { name: /Mercado/ })
      .click();
    await expect(page).toHaveURL(/\/app\/lancamentos\?m=.*categoria=/);
    await expect(page.getByLabel("Categoria")).not.toHaveValue("");
    await expect(page.getByText(/no cartão nesta categoria/)).toBeVisible();

    // Mês futuro: previsto, sem parecer realizado.
    await page.goto(`/app?mes=${monthFrom(2)}`);
    await expect(page.getByText("Previsto", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/tudo aqui é previsão/)).toBeVisible();
    await expect(total(page, "Receitas previstas")).toContainText("9.200,00");
    await expect(total(page, "Saldo previsto")).toBeVisible();
    await expectAccessible(page);
    await shot(page, "painel-mes-futuro", info.project.name);

    // Mês fora da faixa cai no atual.
    await page.goto("/app?mes=1999-01");
    await expect(page.getByLabel("Mês", { exact: true })).toHaveValue(monthFrom(0));
  });

  test("em inglês", async ({ page }, info) => {
    if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
    const family = `Dashboard ${unique()}`;
    await signUp(page, family, true);
    seed(family);
    await page.goto(`/app?mes=${monthFrom(-1)}`);
    await expect(total(page, "Income").first()).toContainText("R$9,200.00");
    await expect(total(page, "Expenses").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "By category" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trend" })).toBeVisible();
    await expect(page.getByText(/no price history/i)).toBeVisible();
    await expectAccessible(page);
    await shot(page, "painel-ingles", info.project.name);
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page).toHaveURL(new RegExp(`mes=${monthFrom(-2)}`));
    await page.goto(`/app?mes=${monthFrom(1)}`);
    await expect(page.getByText(/everything here is a forecast/)).toBeVisible();
    await expect(total(page, "Planned income")).toContainText("9,200.00");
    await expectAccessible(page);
  });
});
