// Relatórios da família: abrir, trocar período, comparar e baixar PDF e CSV, em computador e em 375 px, e
// em inglês. Precisa de E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL, do mesmo banco do servidor: quem
// grava é o agente de verdade, por e2e/relatorios.ts. Com E2E_SHOTS_DIR, grava as telas e os PDFs.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { newCpf } from "./documents";

const shots = process.env.E2E_SHOTS_DIR;
const workerUrl = process.env.E2E_WORKER_DATABASE_URL ?? "";
test.skip(!workerUrl, "Defina E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL.");

const password = "senha-segura-123!";
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const unique = () => `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

function nightRun(family: string, mode = "") {
  execFileSync(process.execPath, ["--import", "tsx", "apps/web/e2e/relatorios.ts", family, mode], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: workerUrl },
    stdio: "pipe",
  });
}

async function signUp(page: Page, family: string) {
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Bia");
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel("E-mail").fill(`relatorios.${unique()}@example.com`);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Nome da família").fill(family);
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function signUpInEnglish(page: Page, family: string) {
  await page.goto("/cadastro?lang=en");
  await page.getByLabel("Your name").fill("Bia");
  await page.getByLabel("Email").fill(`reports.${unique()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Family name").fill(family);
  await page.getByRole("button", { name: "Create family" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function expectAccessible(page: Page) {
  // Trocar o período navega sem recarregar, e o título chega logo depois do conteúdo.
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

async function download(page: Page, link: string, name: string): Promise<Download> {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: link }).click(),
  ]);
  if (shots) copyFileSync(await file.path(), path.join(shots, name));
  return file;
}

const monthBack = (delta: number) => {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const date = new Date(Date.UTC(today.getFullYear(), today.getMonth() - delta, 15));
  return date.toISOString().slice(0, 7);
};

test("abre, troca o período, compara e baixa, sem dado de outra família", async ({
  page,
  browser,
}, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
  const family = `Relatorios ${unique()}`;
  await signUp(page, family);

  // Primeiro uso: estado vazio, com o caminho para começar.
  await page.goto("/app/relatorios");
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios" })).toBeVisible();
  await expect(page.getByText("Seus relatórios aparecem aqui")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ir para os lançamentos" })).toBeVisible();
  await expectAccessible(page);
  await shot(page, "relatorios-vazio", info.project.name);

  nightRun(family);
  await page.reload();

  // O mês em andamento abre primeiro, e o aviso de parcial fica claro.
  await expect(page.getByLabel("Relatório", { exact: true })).toHaveValue("resumo");
  await expect(page.getByLabel("Mês", { exact: true })).toHaveValue(monthBack(0));
  await expect(page.getByText("Relatório parcial.")).toBeVisible();
  await expect(page.getByText(/O período ainda não acabou/)).toBeVisible();
  await expect(page.getByText(/Receitas de R\$\s8\.000,00/)).toBeVisible();
  await expectAccessible(page);
  await shot(page, "relatorios-parcial", info.project.name);

  // Trocar de período: mês fechado, sem aviso de parcial, comparando com o anterior.
  const closed = monthBack(1);
  await page.getByLabel("Mês", { exact: true }).selectOption(closed);
  await expect(page).toHaveURL(new RegExp(`periodo=${closed}`));
  await expect(page.getByText("Relatório parcial.")).toBeHidden();
  await expect(page.getByText("Fechado", { exact: true })).toBeVisible();
  await expect(page.getByText(/despesas de R\$\s3\.234,50/)).toBeVisible();
  await expect(page.getByLabel("Comparar com")).toHaveValue(monthBack(2));
  await expect(page.getByText("A diferença é o primeiro período menos o segundo.")).toBeVisible();
  await expectAccessible(page);
  await shot(page, "relatorios-fechado", info.project.name);

  // Outro tipo, com gráfico.
  await page.getByLabel("Relatório", { exact: true }).selectOption("categorias");
  await expect(page).toHaveURL(/tipo=categorias/);
  await expect(page.getByRole("heading", { name: "Gastos por categoria" })).toBeVisible();
  await page.getByLabel("Mês", { exact: true }).selectOption(closed);
  await expect(page.getByRole("heading", { name: "O que subiu" })).toBeVisible();
  await expect(page.getByText("Moradia").first()).toBeVisible();
  await expectAccessible(page);
  await shot(page, "relatorios-categorias", info.project.name);

  // Baixar nos dois formatos.
  const pdf = await download(page, "Baixar PDF", `relatorio-${info.project.name}.pdf`);
  expect(pdf.suggestedFilename()).toBe(`organizeup-categorias-${closed}.pdf`);
  expect(
    readFileSync(await pdf.path())
      .subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");

  const csv = await download(page, "Baixar CSV", `relatorio-${info.project.name}.csv`);
  expect(csv.suggestedFilename()).toBe(`organizeup-categorias-${closed}.csv`);
  const text = readFileSync(await csv.path(), "utf8");
  expect(text).toContain("Gastos por categoria");
  expect(text).toContain("Moeda;BRL");
  expect(text).toContain("Moradia;2000,00");

  // Outra família não abre nem baixa o que é desta.
  const others = await browser.newContext({ locale: "pt-BR" });
  const other = await others.newPage();
  await signUp(other, `Relatorios Outra ${unique()}`);
  const query = `tipo=resumo&periodo=${closed}`;
  const theirs = await other.request.get(`/app/relatorios/baixar?${query}&formato=pdf`);
  expect(theirs.status()).toBe(404);
  const theirCsv = await other.request.get(`/app/relatorios/baixar?${query}&formato=csv`);
  expect(theirCsv.status()).toBe(404);
  await other.goto(`/app/relatorios?${query}`);
  await expect(other.getByText("Seus relatórios aparecem aqui")).toBeVisible();
  await others.close();

  // Sem sessão, não baixa. E pedido torto não passa.
  const anonymous = await browser.newContext();
  const answer = await anonymous.request.get(`/app/relatorios/baixar?${query}&formato=csv`, {
    maxRedirects: 0,
  });
  expect(answer.status()).toBeGreaterThanOrEqual(300);
  expect(await answer.text()).not.toContain("Moradia");
  await anonymous.close();
  const bad = await page.request.get(`/app/relatorios/baixar?tipo=outro&periodo=x&formato=pdf`);
  expect(bad.status()).toBe(400);
});

test("os dez relatórios abrem e baixam, com a família completa", async ({ page }, info) => {
  test.setTimeout(180_000);
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
  const family = `Relatorios Completa ${unique()}`;
  await signUp(page, family);
  nightRun(family, "completa");

  const kinds: Array<[string, string]> = [
    ["resumo", "Maiores gastos"],
    ["categorias", "Gastos por categoria"],
    ["fluxo", "Previsto × realizado"],
    ["patrimonio", "Evolução em 12 meses"],
    ["investimentos", "Aportes e vendas"],
    ["proventos", "Por ativo"],
    ["dividas", "Plano de quitação"],
    ["metas", "Viagens"],
    ["aposentadoria", "Cobertura"],
    ["anual", "Receitas por categoria"],
  ];
  for (const [kind, section] of kinds) {
    await page.goto(`/app/relatorios?tipo=${kind}`);
    await expect(
      page.getByText(section, { exact: true }).locator("visible=true").first(),
    ).toBeVisible();
    await expectAccessible(page);
    await shot(page, `relatorio-${kind}`, info.project.name);
    const period = await page.getByLabel(/^(Mês|Ano)$/).inputValue();
    const query = `tipo=${kind}&periodo=${period}`;
    const pdf = await page.request.get(`/app/relatorios/baixar?${query}&formato=pdf`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    if (shots) writeFileSync(path.join(shots, `relatorio-${kind}.pdf`), await pdf.body());
    const csv = await page.request.get(`/app/relatorios/baixar?${query}&formato=csv`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["cache-control"]).toContain("no-store");
  }
});

test("em inglês, na tela e nos arquivos", async ({ page }, info) => {
  if (info.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
  const family = `Reports ${unique()}`;
  await signUpInEnglish(page, family);
  nightRun(family);

  await page.goto("/app/relatorios");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await expect(page.getByText("Partial report.")).toBeVisible();
  await expect(page.getByText(/Income of R\$8,000\.00/)).toBeVisible();
  await expectAccessible(page);
  await shot(page, "reports-en", info.project.name);

  await page.getByLabel("Report", { exact: true }).selectOption("anual");
  await expect(page).toHaveURL(/tipo=anual/);
  await expect(page.getByText(/does not replace your income tax return/)).toBeVisible();
  await expectAccessible(page);
  await shot(page, "reports-annual-en", info.project.name);

  const pdf = await download(page, "Download PDF", `report-en-${info.project.name}.pdf`);
  expect(
    readFileSync(await pdf.path())
      .subarray(0, 5)
      .toString(),
  ).toBe("%PDF-");
  const csv = await download(page, "Download CSV", `report-en-${info.project.name}.csv`);
  const text = readFileSync(await csv.path(), "utf8");
  expect(text).toContain("Currency,BRL");
  expect(text).toContain("does not replace your income tax return");
  expect(text).not.toContain("Moeda");
});
