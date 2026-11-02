// Intenções de viagem (ADR-0026), em computador e em 375 px, em português e em inglês. Precisa de
// E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL, do mesmo banco do servidor: quem sugere é o agente de
// verdade, por e2e/agente-viagens.ts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { animationsDone } from "./animations";
import { newCpf } from "./documents";

const shots = process.env.E2E_SHOTS_DIR;
const workerUrl = process.env.E2E_WORKER_DATABASE_URL ?? "";
test.skip(!workerUrl, "Defina E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL.");

const password = "senha-segura-123!";
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

/** Roda o agente como na madrugada, ou troca o papel da família. */
function agent(...args: string[]) {
  execFileSync(process.execPath, ["--import", "tsx", "apps/web/e2e/agente-viagens.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: workerUrl },
    stdio: "pipe",
  });
}

async function signUp(page: Page, family: string, currency?: string) {
  const email = `intencao.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Bia");
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
  await page.getByLabel("Nome da família").fill(family);
  if (currency) await page.getByLabel("Moeda principal").selectOption(currency);
  await page.getByRole("button", { name: "Criar família" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function look(page: Page, name: string) {
  await animationsDone(page);
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((violation) => violation.id)).toEqual([]);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

const COPY = {
  pt: {
    cookie: "pt-BR",
    block: "Quero conhecer",
    add: "Adicionar lugar",
    search: "Destino",
    sheetSave: "Salvar lugar",
    month: "Mês preferido",
    monthValue: "Agosto",
    notListed: "Não está na lista",
    name: "Nome do lugar",
    region: "Região",
    regionValue: "Europa",
    days: "Dias",
    waiting: "Na fila",
    asked: "Você quer conhecer",
    regional: /Estimativa pela região Europa/,
    accept: /Adicionar às minhas viagens/,
    done: "Atendida",
    redo: "Refazer",
    list: "Lugares que você quer conhecer",
    suggestions: "Sugestões para o próximo ano",
    later: /Agora não/,
    refused: /não sugere este lugar de novo antes de/,
    remove: "Remover",
  },
  en: {
    cookie: "en",
    block: "Places to visit",
    add: "Add a place",
    search: "Destination",
    sheetSave: "Save place",
    month: "Preferred month",
    monthValue: "August",
    notListed: "It's not on the list",
    name: "Place name",
    region: "Region",
    regionValue: "Europe",
    days: "Days",
    waiting: "In line",
    asked: "On your list",
    regional: /Estimated by region, Europe/,
    accept: /Add to my trips/,
    done: "Done",
    redo: "Redo",
    list: "Places you want to visit",
    suggestions: "Suggestions for next year",
    later: /Not now/,
    refused: /won't suggest this place again before/,
    remove: "Remove",
  },
};

for (const [lang, copy] of Object.entries(COPY)) {
  for (const width of [1280, 375]) {
    test(`quero conhecer, em ${lang} e ${width} px`, async ({ page, context, baseURL }, info) => {
      test.skip(info.project.name !== "desktop", "A largura é definida aqui.");
      await page.setViewportSize({ width, height: 900 });
      const family = `Família Intenções ${lang} ${width} ${Date.now()}`;
      const shot = (name: string) => `intencoes-${lang}-${width}-${name}`;
      await signUp(page, family);
      await context.addCookies([
        { name: "organizeup_locale", value: copy.cookie, url: baseURL ?? "http://localhost:3000" },
      ]);

      await page.goto("/app/viagens");
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 2, name: copy.block })).toBeVisible();
      await look(page, shot("vazio"));

      // Do catálogo, achado pelo país, com mês preferido.
      await main.getByRole("button", { name: copy.add }).click();
      await page.getByLabel(copy.search).fill("portugal");
      await page.getByRole("button", { name: /Lisboa/ }).click();
      await page.getByLabel(copy.month).selectOption({ label: copy.monthValue });
      await look(page, shot("formulario"));
      await page.getByRole("button", { name: copy.sheetSave }).click();
      const list = main.getByRole("list", { name: copy.list });
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await expect(list.getByText(copy.waiting)).toBeVisible();

      // Fora do catálogo, com região.
      await main.getByRole("button", { name: copy.add }).click();
      await page.getByLabel(copy.search).fill("Praga");
      await page.getByRole("button", { name: copy.notListed }).click();
      await expect(page.getByLabel(copy.name)).toHaveValue("Praga");
      await page.getByRole("button", { name: copy.sheetSave }).click();
      // O navegador segura o envio sem a região; escolhe e envia.
      await page.getByLabel(copy.region).selectOption({ label: copy.regionValue });
      await page.getByLabel(copy.days).fill("6");
      await page.getByRole("button", { name: copy.sheetSave }).click();
      await expect(list.getByRole("listitem")).toHaveCount(2);
      await look(page, shot("cadastrado"));

      // A madrugada, de verdade.
      agent("rodar", family, "2", "5000.00");
      await page.reload();
      const suggestions = main.getByRole("list", { name: copy.suggestions });
      await expect(suggestions.getByRole("listitem")).toHaveCount(2);
      await expect(suggestions.getByText(copy.asked, { exact: true })).toHaveCount(2);
      await expect(suggestions.getByText(copy.regional)).toBeVisible();
      await look(page, shot("sugestoes"));

      // Recusar não apaga nem repete; a outra é aceita e entra nas viagens.
      const lisbon = suggestions.getByRole("listitem").filter({ hasText: "Lisboa" });
      await lisbon.getByRole("button", { name: copy.accept }).click();
      await expect(list.getByRole("listitem").filter({ hasText: "Lisboa" })).toContainText(
        copy.done,
      );
      await expect(
        main.getByRole("heading", { level: 2, name: "Lisboa", exact: true }),
      ).toBeVisible();
      await expect(list.getByRole("button", { name: new RegExp(copy.redo) })).toBeVisible();

      const prague = suggestions.getByRole("listitem").filter({ hasText: "Praga" });
      await prague.getByRole("button", { name: copy.later }).click();
      await expect(list.getByRole("listitem").filter({ hasText: "Praga" })).toContainText(
        copy.refused,
      );
      agent("rodar", family, "2", "5000.00");
      await page.reload();
      await expect(list.getByRole("listitem")).toHaveCount(2);
      await expect(list.getByRole("listitem").filter({ hasText: "Praga" })).toContainText(
        copy.refused,
      );
      await expect(main.getByText(copy.asked, { exact: true })).toHaveCount(0);
      await look(page, shot("decidido"));

      // Refazer: a intenção volta para a fila, e a viagem criada fica.
      await list.getByRole("button", { name: new RegExp(copy.redo) }).click();
      await page.getByRole("dialog").getByRole("button", { name: copy.redo }).click();
      await expect(list.getByRole("listitem").filter({ hasText: "Lisboa" })).toContainText(
        copy.waiting,
      );
      await expect(
        main.getByRole("heading", { level: 2, name: "Lisboa", exact: true }),
      ).toBeVisible();

      // Remover é da família.
      await list.getByRole("button", { name: new RegExp(`${copy.remove} Praga`) }).click();
      await page.getByRole("dialog").getByRole("button", { name: copy.remove }).click();
      await expect(list.getByRole("listitem")).toHaveCount(1);
    });
  }
}

test("não cabe: o cartão explica, e quem só vê não mexe", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Um tamanho basta: o conteúdo é o mesmo.");
  const family = `Família Sem Folga ${Date.now()}`;
  await signUp(page, family);
  await page.goto("/app/viagens");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Adicionar lugar" }).click();
  await page.getByLabel("Destino").fill("Quioto");
  await page.getByRole("button", { name: "Não está na lista" }).click();
  await page.getByLabel("Região").selectOption({ label: "Ásia e Oceania" });
  await page.getByRole("button", { name: "Salvar lugar" }).click();
  const list = main.getByRole("list", { name: "Lugares que você quer conhecer" });
  await expect(list.getByRole("listitem")).toHaveCount(1);

  agent("rodar", family, "1", "300.00");
  await page.reload();
  await expect(list.getByRole("listitem")).toContainText("Ainda não cabe");
  await expect(list.getByRole("listitem")).toContainText(/Guarde .* a mais por mês/);
  await look(page, "intencoes-nao-cabe");

  agent("so-ver", family);
  await page.reload();
  await expect(list.getByRole("listitem")).toContainText("Quioto");
  await expect(main.getByRole("button", { name: "Adicionar lugar" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: /Editar Quioto/ })).toHaveCount(0);
  await expect(main.getByRole("button", { name: /Remover Quioto/ })).toHaveCount(0);
});

test("fora do real, o bloco diz que não será usado", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Um tamanho basta: o conteúdo é o mesmo.");
  await signUp(page, `Família Dólar ${Date.now()}`, "USD");
  await page.goto("/app/viagens");
  const main = page.getByRole("main");
  await expect(main.getByText(/não usa esta lista nesta moeda/)).toBeVisible();
  await expect(main.getByRole("button", { name: "Adicionar lugar" })).toHaveCount(0);
  await look(page, "intencoes-fora-do-real");
});
