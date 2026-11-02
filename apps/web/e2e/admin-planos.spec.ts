// Painel de planos: VIP, assinaturas, catálogo, receita e chave, no computador e a 375 px, com axe. Precisa de
// E2E_ADMIN_EMAIL, E2E_BILLING=1, E2E_WORKER_DATABASE_URL e ADMIN_DATABASE_URL do mesmo banco do servidor, e do
// servidor com ADMIN_EMAILS igual, STRIPE_SECRET_KEY=sk_test_ e STRIPE_WEBHOOK_SECRET quaisquer: nada aqui chama a
// Stripe. Rode sozinho, com --workers=1: a chave da cobrança é global. Dados fictícios.
import { execFileSync } from "node:child_process";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { animationsDone } from "./animations";
import { newCpf } from "./documents";

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "";
const password = "senha-segura-123!";
const shots = process.env.E2E_SHOTS_DIR;
const liveUrl = process.env.E2E_LIVE_URL;
const repo = path.resolve(import.meta.dirname, "../../..");

test.skip(
  !adminEmail || !process.env.E2E_BILLING,
  "Defina E2E_ADMIN_EMAIL, E2E_BILLING=1 e as duas conexões do banco.",
);
test.describe.configure({ mode: "serial" });

function plano(...args: string[]) {
  execFileSync(process.execPath, ["--import", "tsx", "apps/web/e2e/plano-familia.ts", ...args], {
    cwd: repo,
    env: { ...process.env, DATABASE_URL: process.env.E2E_WORKER_DATABASE_URL ?? "" },
  });
}

const unique = () => `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

async function signUp(page: Page, name: string, email: string) {
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/, { timeout: 30_000 });
}

async function signInAsAdmin(page: Page, base = "") {
  await page.goto(`${base}/entrar`);
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const outcome = await Promise.race([
    page.waitForURL(/\/app(\/|$)/).then(() => "entrou" as const),
    page
      .getByText("E-mail ou senha incorretos.")
      .waitFor()
      .then(() => "sem conta" as const),
  ]);
  if (outcome === "sem conta") await signUp(page, "Admin", adminEmail);
}

/** Conta nova com família própria. */
async function createFamily(page: Page) {
  const family = `Família ${unique()}`;
  await signUp(page, "Pessoa Teste", `planos.${unique()}@example.com`);
  await page.getByLabel(/Nome/).first().fill(family);
  await page.getByRole("button", { name: /Criar/ }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
  return family;
}

async function withMember<T>(browser: Browser, fn: (page: Page) => Promise<T>) {
  const context = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

async function axe(page: Page) {
  await animationsDone(page);
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((v) => ({ id: v.id, html: v.nodes[0]?.html }))).toEqual([]);
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
}

const narrow = (page: Page) => page.setViewportSize({ width: 375, height: 812 });

async function confirm(page: Page, button: string) {
  await page.getByRole("dialog").locator('button[type="submit"]', { hasText: button }).click();
}

async function openFamily(page: Page, family: string) {
  await page.goto("/admin/familias");
  await page.getByRole("searchbox", { name: "Buscar" }).fill(family);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByRole("link", { name: family }).click();
  await expect(page.getByRole("heading", { level: 1, name: family })).toBeVisible();
}

const situation = (page: Page) => page.getByTestId("plano-situacao");

const SCREENS = ["assinaturas", "vip", "catalogo", "receita", "cobranca"];

test.afterAll(() => plano("chave", "off"));

test("as telas novas passam no axe, sem rolagem lateral, nas duas larguras", async ({ page }) => {
  await signInAsAdmin(page);
  for (const width of ["desktop", "375"]) {
    if (width === "375") await narrow(page);
    else await page.setViewportSize({ width: 1280, height: 900 });
    for (const screen of SCREENS) {
      await page.goto(`/admin/${screen}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axe(page);
      await noSideScroll(page);
      await shot(page, `${screen}-${width}`);
    }
  }
});

test("com a chave desligada, receita é honesta e a Stripe fica fora, com o motivo", async ({
  page,
  browser,
}) => {
  plano("chave", "off");
  await signInAsAdmin(page);

  await page.goto("/admin/receita");
  await expect(page.getByText("Sem receita enquanto a cobrança estiver desligada")).toBeVisible();
  await expect(page.getByText("Receita mensal recorrente")).toHaveCount(0);
  await expect(page.locator("main").getByText("R$")).toHaveCount(0);
  await expect(page.getByText("Sem limite enquanto a cobrança estiver desligada")).toBeVisible();
});

test("com a chave desligada, quem já paga sai: família e painel cancelam e devolvem", async ({
  page,
  browser,
}) => {
  await withMember(browser, async (member) => {
    plano("chave", "off");
    const family = await createFamily(member);
    await member.goto("/app");
    await expect(member.getByRole("link", { name: "Plano e assinatura" })).toHaveCount(0);

    plano("plano", family, "familia");
    plano("stripe", family);
    await member.goto("/app/assinatura");
    await expect(situation(member)).toContainText("As novas assinaturas estão pausadas");
    await expect(member.getByRole("button", { name: "Cancelar" }).first()).toBeEnabled();
    await expect(member.getByTestId("plano-total")).toHaveCount(0);
    await axe(member);
    await noSideScroll(member);
    await shot(member, "familia-chave-desligada");

    await signInAsAdmin(page);
    await openFamily(page, family);
    await page.getByRole("link", { name: "Ver assinatura" }).click();
    await expect(page.getByRole("heading", { level: 1, name: family })).toBeVisible();
    for (const name of ["Cancelar assinatura", "Devolver"]) {
      await expect(page.getByRole("button", { name })).toBeEnabled();
    }
    await expect(page.getByRole("button", { name: "Reenviar cobrança" })).toBeDisabled();
    await expect(page.getByText(/reenviar e mexer em desconto só com ela ligada/)).toBeVisible();
    await axe(page);
    await noSideScroll(page);
    await shot(page, "assinatura-chave-desligada");
  });
});

test("VIP sem custo: libera sem cobrança, e vencer ou remover devolve o que havia", async ({
  page,
  browser,
}) => {
  await withMember(browser, async (member) => {
    const family = await createFamily(member);
    plano("vencer", family);
    plano("chave", "on");
    await member.goto("/app/assinatura");
    await expect(situation(member)).toContainText("O teste acabou");

    await signInAsAdmin(page);
    await openFamily(page, family);
    await page.getByRole("link", { name: "Marcar como VIP" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Marcar como VIP" })).toBeVisible();
    await axe(page);
    await noSideScroll(page);
    await page.getByRole("radio", { name: "Módulos e limites escolhidos" }).check();
    await page.getByRole("checkbox", { name: "Metas e viagens" }).check();
    await page.getByLabel("Lançamentos por mês").fill("200");
    await expect(page.getByLabel("Mensagens por mês")).toHaveCount(0);
    await axe(page);
    await shot(page, "vip-novo");
    // Com desconto o formulário abre em "nada a mais": liberar módulos é escolha.
    await page.getByRole("radio", { name: /^Com desconto/ }).check();
    await expect(page.getByRole("radio", { name: /^Só o desconto/ })).toBeChecked();
    await page.getByRole("radio", { name: /^Sem custo/ }).check();
    await expect(page.getByRole("radio", { name: /^Só o desconto/ })).toHaveCount(0);
    await page.getByRole("radio", { name: "Tudo liberado" }).check();
    await page.getByLabel("Motivo").selectOption("imprensa");
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("Válido até (opcional)").fill(soon);
    await page.getByRole("button", { name: "Conceder VIP" }).click();
    await expect(page).toHaveURL(/\/admin\/vip$/);

    // Aviso antes de vencer, na lista e na visão geral.
    await expect(page.getByText(new RegExp(`VIP de ${family} vence em`))).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: family });
    await expect(row).toContainText("Tudo liberado");
    await expect(row).toContainText("Sem custo");
    await expect(row).toContainText("Imprensa");
    await expect(row).toContainText("Vencendo");
    await axe(page);
    await noSideScroll(page);
    await shot(page, "vip-lista");

    await page.goto("/admin/vip?situacao=removido");
    await expect(page.getByRole("row").filter({ hasText: family })).toHaveCount(0);
    await page.goto("/admin");
    await expect(page.getByText(/VIPs? perto de vencer/).first()).toBeVisible();

    await member.goto("/app/assinatura");
    await expect(situation(member)).toContainText("Sua família é VIP");
    await expect(
      member.getByText(/Depois volta ao que era antes, sem nenhuma cobrança/),
    ).toBeVisible();
    // Com data, dá para assinar antes: a primeira cobrança é quando o VIP acaba.
    await expect(member.getByText(/a primeira cobrança é só em/)).toBeVisible();

    await page.goto("/admin/vip");
    await page.getByRole("button", { name: `Remover o VIP de ${family}` }).click();
    await confirm(page, "Remover");
    await expect(page.getByRole("row").filter({ hasText: family })).toHaveCount(0);

    await member.goto("/app/assinatura");
    await expect(situation(member)).toContainText("O teste acabou");

    await page.goto("/admin/vip?situacao=removido");
    await expect(page.getByRole("row").filter({ hasText: family })).toContainText("Removido");
    await page.goto("/admin/auditoria");
    await expect(page.getByText("Concedeu VIP").first()).toBeVisible();
    await expect(page.getByText("Removeu VIP").first()).toBeVisible();
    plano("chave", "off");
  });
});

test("desconto: o total diz o valor real, e a família só vê o que a Stripe aplicou", async ({
  page,
  browser,
}) => {
  await withMember(browser, async (member) => {
    const family = await createFamily(member);
    plano("vencer", family);
    plano("chave", "on");
    await signInAsAdmin(page);

    const giveDiscount = async () => {
      await openFamily(page, family);
      await page.getByRole("link", { name: "Marcar como VIP" }).click();
      await page.getByRole("radio", { name: /^Com desconto/ }).check();
      await page.getByLabel("Desconto em %").fill("30");
      await page.getByRole("button", { name: "Conceder VIP" }).click();
      await expect(page).toHaveURL(/\/admin\/vip$/);
    };

    // Ainda não assina: o cupom entra na primeira cobrança, e o total já diz isso.
    await giveDiscount();
    await member.goto("/app/assinatura");
    await expect(member.getByTestId("plano-total")).toContainText("31,43");
    await expect(member.getByText("Com desconto VIP de 30%.")).toBeVisible();

    // Assina sem o cupom aplicado: concedido, mas a família não vê desconto nenhum.
    plano("plano", family, "familia");
    plano("stripe", family);
    await member.goto("/app/assinatura");
    await expect(member.getByText("Desconto VIP de 30% na assinatura.")).toHaveCount(0);
    await expect(member.getByTestId("plano-total")).not.toContainText("31,43");
    await page.goto("/admin/vip");
    await expect(
      page.getByText(new RegExp(`Desconto de ${family} concedido e não aplicado`)),
    ).toBeVisible();
    await axe(page);
    await noSideScroll(page);
    await shot(page, "vip-desconto-nao-aplicado");

    // O webhook confirmou: agora a família vê.
    plano("desconto", family, "30");
    await member.goto("/app/assinatura");
    await expect(member.getByText("Desconto VIP de 30% na assinatura.")).toBeVisible();
    await page.goto("/admin/vip");
    await expect(page.getByText(/concedido e não aplicado/)).toHaveCount(0);
    plano("chave", "off");
  });
});

test("assinatura mostra plano e valor sem nada financeiro da família, e dias de teste contam", async ({
  page,
  browser,
}) => {
  await withMember(browser, async (member) => {
    const family = await createFamily(member);
    plano("plano", family, "base:50,modulo:metas");
    await signInAsAdmin(page);
    await narrow(page);
    await openFamily(page, family);
    await page.getByRole("link", { name: "Ver assinatura" }).click();
    await expect(page.getByText("Base, até 50 lançamentos")).toBeVisible();
    await expect(page.getByText("Metas e viagens")).toBeVisible();
    await expect(page.getByText("R$ 19,80")).toBeVisible();
    await axe(page);
    await noSideScroll(page);
    await shot(page, "assinatura-detalhe-375");

    await page.getByRole("button", { name: "Conceder dias de teste" }).click();
    await axe(page);
    await page.getByRole("dialog").getByLabel("Dias").fill("10");
    await confirm(page, "Conceder");
    await expect(page.getByText("10 dias de teste concedidos.")).toBeVisible();
    await expect(page.getByText("Teste até")).toBeVisible();
    await expect(page.getByText("Concedeu dias de teste").first()).toBeVisible();
  });
});

test("catálogo: preço novo não troca o antigo de lugar, e contas conectadas ficam bloqueadas", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/admin/catalogo");

  const blocked = page.getByRole("table", { name: "Contas conectadas" });
  await expect(blocked.getByText("Bloqueado")).toBeVisible();
  await expect(blocked.getByRole("switch")).toHaveCount(0);
  await expect(blocked.getByText("Anual")).toHaveCount(0);
  await expect(
    page
      .getByRole("table", { name: "Família completa" })
      .getByText("Família completa, 300 mensagens")
      .first(),
  ).toBeVisible();

  const item = "Moeda adicional EUR, anual";
  const cents = String(10 + Math.floor(Math.random() * 89));
  await page.getByRole("button", { name: `Preço novo: ${item}` }).click();
  await axe(page);
  await page.getByRole("dialog").getByLabel("Preço novo em reais").fill(`50,${cents}`);
  await confirm(page, "Salvar preço");
  await expect(page.getByText("Preço novo salvo.")).toBeVisible();
  await page.reload();
  const table = page.getByRole("table", { name: "Moedas" });
  await expect(table.getByText(`R$ 50,${cents}`)).toBeVisible();
  await expect(table.getByText(/Antes:.*49,00/).first()).toBeVisible();

  const sale = page.getByRole("switch", { name: `Vender ${item}` });
  await expect(sale).toHaveAttribute("aria-checked", "true");
  await sale.click();
  await expect(sale).toHaveAttribute("aria-checked", "false");
  await sale.click();
  await expect(sale).toHaveAttribute("aria-checked", "true");
  await animationsDone(page);
  await axe(page);
});

test("ligar a chave pede a digitação, mostra o checklist e fica na auditoria", async ({ page }) => {
  await signInAsAdmin(page);
  plano("chave", "off");
  await page.goto("/admin/cobranca");
  await expect(
    page.getByText("Chave de teste: nenhum cartão é cobrado de verdade.").first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Ligar cobrança" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("CNPJ, CNAE e regime")).toBeVisible();
  await expect(sheet.getByText(/ainda não citam a Stripe/)).toBeVisible();
  const go = sheet.getByRole("button", { name: "Ligar cobrança" });
  await expect(go).toBeDisabled();
  await sheet.getByLabel("Digite LIGAR COBRANCA para confirmar").fill("ligar");
  await expect(go).toBeDisabled();
  await axe(page);
  await shot(page, "ligar-cobranca");
  await sheet.getByLabel("Digite LIGAR COBRANCA para confirmar").fill("LIGAR COBRANCA");
  await go.click();
  await expect(page.getByRole("button", { name: "Desligar cobrança" })).toBeVisible();

  await page.goto("/admin/receita");
  await expect(page.getByText("Receita mensal recorrente")).toBeVisible();
  await expect(page.getByText(/valores abaixo vêm de assinaturas de teste/)).toBeVisible();
  // Só leitura e sem assistente têm limite zero, e isso não é estar no limite.
  await expect(page.getByText("0 de 0")).toHaveCount(0);
  await axe(page);
  await noSideScroll(page);
  await shot(page, "receita-ligada");

  await page.goto("/admin/cobranca");
  await expect(page.getByRole("alert").filter({ hasText: /segue|seguem cobrando/ })).toBeVisible();
  await page.getByRole("button", { name: "Desligar cobrança" }).click();
  const off = page.getByRole("dialog");
  await expect(off.getByRole("button", { name: "Desligar" })).toBeDisabled();
  await off.getByLabel("Digite DESLIGAR COBRANCA para confirmar").fill("DESLIGAR COBRANCA");
  await confirm(page, "Desligar");
  await expect(page.getByRole("button", { name: "Ligar cobrança" })).toBeVisible();

  await page.goto("/admin/auditoria");
  await expect(page.getByText("Ligou a cobrança").first()).toBeVisible();
  await expect(page.getByText("Desligou a cobrança").first()).toBeVisible();
});

test("com sk_live_, a tela diz que há cobrança real", async ({ page }) => {
  test.skip(!liveUrl, "Defina E2E_LIVE_URL para um servidor com chave de produção falsa.");
  await signInAsAdmin(page, liveUrl);
  await page.goto(`${liveUrl}/admin/cobranca`);
  await expect(page.getByRole("alert").first()).toContainText("cobrança real");
  await axe(page);
  await noSideScroll(page);
  await shot(page, "cobranca-producao");
});

test("usuário comum não abre nada do painel de planos", async ({ page }) => {
  await signUp(page, "Comum", `comum.${unique()}@example.com`);
  for (const screen of [...SCREENS, "vip/novo", "assinaturas/qualquer-id"]) {
    const response = await page.goto(`/admin/${screen}`);
    expect(response?.status(), screen).toBe(404);
    await expect(page.getByText("Painel do serviço")).toHaveCount(0);
  }
});
