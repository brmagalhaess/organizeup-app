// Painel do serviço: cada tela com axe, ações reais e 404 para quem não é administrador.
// Precisa de E2E_ADMIN_EMAIL e do servidor no ar com ADMIN_EMAILS igual a esse valor e com
// ADMIN_DATABASE_URL. Sem worker, Rodar agora só deixa o pedido na fila. Rode sozinho e com
// --workers=1: os controles mudam chaves globais (cadastro, manutenção) que afetam outras abas.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { animationsDone } from "./animations";
import { newCpf } from "./documents";

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "";
const password = "senha-segura-123!";

test.skip(!adminEmail, "Defina E2E_ADMIN_EMAIL e suba o servidor com ADMIN_EMAILS igual.");

const SCREENS = [
  { path: "/admin", title: "Visão geral", visit: "Visão geral" },
  { path: "/admin/familias", title: "Famílias", visit: "Famílias" },
  { path: "/admin/usuarios", title: "Usuários", visit: "Usuários" },
  { path: "/admin/agentes", title: "Agentes", visit: "Agentes" },
  { path: "/admin/sistema", title: "Sistema", visit: "Sistema" },
  { path: "/admin/controles", title: "Controles", visit: "Controles" },
  { path: "/admin/auditoria", title: "Auditoria", visit: "Auditoria" },
  { path: "/admin/assinaturas", title: "Assinaturas", visit: "Assinaturas" },
  { path: "/admin/vip", title: "VIP", visit: "VIP" },
  { path: "/admin/catalogo", title: "Catálogo", visit: "Catálogo" },
  { path: "/admin/receita", title: "Receita e uso", visit: "Receita e uso" },
  { path: "/admin/cobranca", title: "Chave da cobrança", visit: "Chave" },
];

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
  await expect(page).toHaveURL(/\/app\/novo-household$/);
}

async function fillSignIn(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

/**
 * Único usuário fixo da suíte: a lista de administradores é por e-mail, então ele não pode ser
 * único por execução. Num banco novo ainda não existe e é cadastrado; depois, entra com a senha.
 */
async function signInAsAdmin(page: Page) {
  await fillSignIn(page, adminEmail);
  const outcome = await Promise.race([
    page.waitForURL(/\/app(\/|$)/).then(() => "entrou" as const),
    page
      .getByText("E-mail ou senha incorretos.")
      .waitFor()
      .then(() => "sem conta" as const),
  ]);
  if (outcome === "sem conta") await signUp(page, "Admin", adminEmail);
}

/** Conta nova com família própria. Devolve o nome da família. */
async function createFamily(page: Page, email: string) {
  const family = `Família ${unique()}`;
  await signUp(page, "Pessoa Teste", email);
  await page.getByLabel(/Nome/).first().fill(family);
  await page.getByRole("button", { name: /Criar/ }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/);
  return family;
}

async function expectAccessible(page: Page) {
  await animationsDone(page);
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => ({ id: v.id, html: v.nodes[0]?.html }))).toEqual([]);
}

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Abre uma família pela busca do painel e fica no detalhe dela. */
async function openFamily(page: Page, family: string) {
  await page.goto("/admin/familias");
  await page.getByRole("searchbox", { name: "Buscar" }).fill(family);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByRole("link", { name: family }).click();
  await expect(page.getByRole("heading", { level: 1, name: family })).toBeVisible();
}

async function confirmSheet(page: Page, button: string) {
  await page.getByRole("dialog").locator('button[type="submit"]', { hasText: button }).click();
}

async function withSecondUser<T>(browser: Browser, fn: (page: Page) => Promise<T>) {
  const context = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

test("administrador navega por todas as telas, sem violação de acessibilidade", async ({
  page,
}) => {
  await signInAsAdmin(page);

  for (const screen of SCREENS) {
    const response = await page.goto(screen.path);
    expect(response?.status(), screen.path).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: screen.title })).toBeVisible();
    await expectAccessible(page);
    await expectNoSideScroll(page);
  }

  // No celular, as seções que não cabem na barra ficam em Mais.
  const more = page.getByRole("button", { name: "Mais" });
  if (await more.isVisible()) {
    await more.click();
    await page.getByRole("dialog").getByRole("link", { name: "Controles" }).click();
    await expect(page).toHaveURL(/\/admin\/controles$/);
  }

  await page.goto("/admin/agentes");
  await expect(page.getByText("Os cinco agentes")).toHaveCount(0);
  for (const name of [
    "Categorias",
    "Categorias com IA",
    "Investimentos",
    "Aposentadoria",
    "Viagens",
    "Metas",
    "Mercado",
    "Dicas",
  ]) {
    // Com um worker no ar sem as chaves, o título ganha o aviso dele.
    const title = new RegExp(`^${name}( Sem chave de cotações| Worker sem a chave)?$`);
    await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
    await expect(page.getByRole("switch", { name: `Agente ${name}`, exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Rodar agora: ${name}`, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Abrir o Paperclip" })).toHaveAttribute(
    "href",
    "https://paperclip.home.crowntech.com.br/ORG",
  );
  const team = page.getByRole("table", { name: "Equipe de agentes no Paperclip" });
  for (const name of [
    "Tech Lead",
    "Revisor QA",
    "Dívidas",
    "Relatórios",
    "Segurança",
    "Documentação",
  ]) {
    await expect(team.getByRole("cell", { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(page.getByRole("link", { name: `Ver ${name} no Paperclip` })).toBeVisible();
  }

  await page.goto("/admin/sistema");
  for (const name of [
    "Inteligência artificial",
    "Dicas da madrugada",
    "Dados de mercado",
    "Base de conhecimento",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.getByText("claude-haiku-5-5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Testar a IA" })).toBeVisible();

  await page.goto("/admin");
  await expect(page.getByRole("list", { name: "Adoção do assistente" })).toBeVisible();
});

test("a busca não vai para a URL e nada aparece além do permitido", async ({ page, browser }) => {
  const email = `busca.${unique()}@example.com`;
  const family = await withSecondUser(browser, (other) => createFamily(other, email));
  await signInAsAdmin(page);

  await page.goto("/admin/familias");
  await page.getByRole("searchbox", { name: "Buscar" }).fill(email);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByRole("link", { name: family })).toBeVisible();
  expect(page.url()).not.toContain("example.com");
  expect(page.url()).not.toContain("%40");

  await page.getByRole("link", { name: family }).click();
  await expect(page.getByRole("heading", { level: 1, name: family })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Responsável" }).first()).toBeVisible();
  await expect(page.getByText(email)).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole("button", { name: `Ver contato do responsável de ${family}` }).click();
  await expect(page.getByText(email)).toBeVisible();

  await page.goto("/admin/auditoria");
  await page.getByLabel("Tipo").selectOption("dados");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByText("Viu o contato do responsável").first()).toBeVisible();
});

test("suspender bloqueia a família de verdade e reativar devolve", async ({ page, browser }) => {
  const email = `suspensa.${unique()}@example.com`;
  await withSecondUser(browser, async (member) => {
    const family = await createFamily(member, email);
    await signInAsAdmin(page);

    await openFamily(page, family);
    await page.getByRole("button", { name: "Suspender família" }).click();
    await expectAccessible(page);
    await confirmSheet(page, "Suspender");
    await expect(page.getByText("Suspensa", { exact: true }).first()).toBeVisible();

    // A sessão aberta morreu: a próxima tela pede para entrar de novo.
    await member.goto("/app");
    await expect(member).toHaveURL(/\/entrar/);

    // Entrar funciona, mas a família mostra o motivo em vez dos dados.
    await fillSignIn(member, email);
    await expect(member).toHaveURL(/\/app\/suspensa$/);
    await expect(
      member.getByRole("heading", { name: "O acesso a esta família está suspenso" }),
    ).toBeVisible();
    await expectAccessible(member);
    await member.goto("/app/lancamentos");
    await expect(member).toHaveURL(/\/app\/suspensa$/);

    await openFamily(page, family);
    await page.getByRole("button", { name: "Reativar família" }).click();
    await confirmSheet(page, "Reativar");
    await expect(page.getByRole("button", { name: "Suspender família" })).toBeVisible();

    await member.goto("/app");
    await expect(member).toHaveURL(/\/app$/);
    await expect(member.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto("/admin/auditoria");
    await expect(page.getByText("Suspendeu uma família").first()).toBeVisible();
    await expect(page.getByText("Reativou uma família").first()).toBeVisible();
  });
});

test("bloquear impede o login; redefinir senha responde; excluir pede digitação", async ({
  page,
  browser,
}) => {
  const email = `bloqueado.${unique()}@example.com`;
  await withSecondUser(browser, async (member) => {
    const family = await createFamily(member, email);
    await signInAsAdmin(page);

    await page.goto("/admin/usuarios");
    await page.getByRole("searchbox", { name: "Buscar" }).fill(email);
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(page.getByRole("table").getByRole("link")).toHaveCount(1);
    await expect(page.getByRole("cell").filter({ hasText: "responsável" })).toBeVisible();
    await page.getByRole("table").getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1, name: /^Conta / })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("button", { name: "Ver nome e e-mail" }).click();
    await expect(page.getByText(email)).toBeVisible();

    await page.getByRole("button", { name: "Enviar redefinição de senha" }).click();
    await confirmSheet(page, "Enviar");
    await expect(page.getByText(/Pedido (enviado|registrado)/)).toBeVisible();

    await page.getByRole("button", { name: "Bloquear conta" }).click();
    await confirmSheet(page, "Bloquear");
    await expect(page.getByRole("button", { name: "Desbloquear conta" })).toBeVisible();

    await member.goto("/app");
    await expect(member).toHaveURL(/\/entrar/);
    await fillSignIn(member, email);
    await expect(member.getByText("Esta conta está bloqueada.")).toBeVisible();

    await page.getByRole("button", { name: "Desbloquear conta" }).click();
    await confirmSheet(page, "Desbloquear");
    await expect(page.getByRole("button", { name: "Bloquear conta" })).toBeVisible();
    await fillSignIn(member, email);
    await expect(member).toHaveURL(/\/app(\/|$)/);

    await page.getByRole("button", { name: "Excluir conta" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: "Excluir para sempre" })).toBeDisabled();
    await sheet.getByLabel("Digite EXCLUIR para confirmar").fill("EXCLUIR");
    await sheet.getByRole("button", { name: "Excluir para sempre" }).click();
    await expect(page).toHaveURL(/\/admin\/usuarios$/);

    await page.goto("/admin/familias");
    await page.getByRole("searchbox", { name: "Buscar" }).fill(family);
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(page.getByText("Nenhuma família encontrada")).toBeVisible();
  });
});

test("excluir família exige digitar o nome", async ({ page, browser }) => {
  const email = `excluida.${unique()}@example.com`;
  const family = await withSecondUser(browser, (other) => createFamily(other, email));
  await signInAsAdmin(page);

  await openFamily(page, family);
  await page.getByRole("button", { name: "Excluir família" }).click();
  const sheet = page.getByRole("dialog");
  const confirm = sheet.getByRole("button", { name: "Excluir para sempre" });
  await expect(confirm).toBeDisabled();
  await sheet.getByLabel(`Digite ${family} para confirmar`).fill("outro nome");
  await expect(confirm).toBeDisabled();
  await sheet.getByLabel(`Digite ${family} para confirmar`).fill(family);
  await confirm.click();
  await expect(page).toHaveURL(/\/admin\/familias$/);
  await page.getByRole("searchbox", { name: "Buscar" }).fill(family);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByText("Nenhuma família encontrada")).toBeVisible();
});

// Mexem em chaves globais: rodam uma de cada vez e sempre devolvem o estado, para não interferir
// em outras suítes num banco compartilhado.
test.describe.serial("controles do sistema", () => {
  test("manutenção deixa as famílias só leitura, com aviso", async ({ page, browser }) => {
    const email = `leitura.${unique()}@example.com`;
    await withSecondUser(browser, async (member) => {
      await createFamily(member, email);
      await signInAsAdmin(page);

      await page.goto("/admin/controles");
      await page.getByRole("button", { name: "Ligar manutenção" }).click();
      await confirmSheet(page, "Ligar");
      await expect(page.getByRole("button", { name: "Desligar manutenção" })).toBeVisible();
      try {
        await member.goto("/app");
        await expect(member.getByText(/Estamos em manutenção/)).toBeVisible();
        await expect(member.getByRole("button", { name: "Novo lançamento" })).toHaveCount(0);
        await expectAccessible(member);
      } finally {
        await page.getByRole("button", { name: "Desligar manutenção" }).click();
        await confirmSheet(page, "Desligar");
        await expect(page.getByRole("button", { name: "Ligar manutenção" })).toBeVisible();
      }
      await member.goto("/app");
      await expect(member.getByText(/Estamos em manutenção/)).toHaveCount(0);
    });
  });

  test("cadastro fechado esconde o formulário e aviso aparece para todos", async ({
    page,
    browser,
  }) => {
    const email = `aviso.${unique()}@example.com`;
    const text = `Parada programada ${unique()}`;
    await withSecondUser(browser, async (member) => {
      await createFamily(member, email);
      await signInAsAdmin(page);

      await page.goto("/admin/controles");
      await page.getByLabel("Texto do aviso").fill(text);
      await page.getByRole("button", { name: "Publicar aviso" }).click();
      await expect(page.getByText("Aviso publicado.")).toBeVisible();
      await page.reload();
      await expect(page.getByRole("list", { name: "Avisos publicados" })).toContainText(text);

      await member.goto("/app");
      await expect(member.getByText(text)).toBeVisible();

      await page.getByRole("button", { name: `Remover o aviso: ${text}` }).click();
      await confirmSheet(page, "Remover");
      await expect(page.getByRole("list", { name: "Avisos publicados" })).toHaveCount(0, {
        timeout: 10_000,
      });
      await member.goto("/app");
      await expect(member.getByText(text)).toHaveCount(0);

      await page.getByRole("button", { name: "Fechar cadastro" }).click();
      await confirmSheet(page, "Fechar");
      await expect(page.getByRole("button", { name: "Abrir cadastro" })).toBeVisible();
      try {
        await withSecondUser(browser, async (visitor) => {
          await visitor.goto("/cadastro");
          await expect(visitor.getByText("Os cadastros estão fechados no momento")).toBeVisible();
          await expect(visitor.getByLabel("Seu nome")).toHaveCount(0);
        });
      } finally {
        await page.getByRole("button", { name: "Abrir cadastro" }).click();
        await confirmSheet(page, "Abrir");
        await expect(page.getByRole("button", { name: "Fechar cadastro" })).toBeVisible();
      }
    });
  });

  test("ligar e desligar agente e pedir a rodada ficam registrados", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/agentes");

    const toggle = page.getByRole("switch", { name: "Agente Viagens" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await page.getByRole("button", { name: "Rodar os diários" }).click();
    await expect(page.getByText(/Rodada pedida|Já existe uma rodada/)).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Rodar agora: Metas" }).click();
    await expect(page.getByText(/Pedido feito|Já existe um pedido igual/)).toBeVisible({
      timeout: 20_000,
    });

    // Desligado, o agente some do botão: o worker só pularia em silêncio.
    const market = page.getByRole("switch", { name: "Agente Mercado" });
    await market.click();
    await expect(market).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("button", { name: "Rodar agora: Mercado" })).toHaveCount(0);
    await market.click();
    await expect(market).toHaveAttribute("aria-checked", "true");

    await page.goto("/admin/auditoria");
    await expect(page.getByText("Desligou o agente viagens").first()).toBeVisible();
    await expect(page.getByText("Ligou o agente viagens").first()).toBeVisible();
    await expect(page.getByText("Pediu para rodar os agentes").first()).toBeVisible();
    await expect(page.getByText("Pediu para rodar o agente metas").first()).toBeVisible();
  });
});

test("usuário comum recebe 404 no painel", async ({ page }) => {
  await signUp(page, "Comum", `comum.${unique()}@example.com`);

  for (const { path } of SCREENS) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByText("Painel do serviço")).toHaveCount(0);
  }
  const detail = await page.goto("/admin/familias/qualquer-id");
  expect(detail?.status()).toBe(404);
});
