// Ativação e conversa com o assistente. Precisa do servidor em `next dev` com ANTHROPIC_API_KEY
// qualquer e AI_TEST_BASE_URL apontando para e2e/fake-model.mjs, e de E2E_ASSISTANT=1 no Playwright.
// Ver docs/runbooks/bootstrap.md. Nada aqui chama a API real.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.E2E_ASSISTANT, "precisa do servidor com o modelo falso");

const password = "senha-segura-123!";

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

const violations = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.map(
    (violation) => violation.id,
  );

test("ativa, conversa, vê o que foi olhado, reabre e desliga", async ({ page }) => {
  await signUp(page, "Lia");

  // Sem aceite, o servidor recusa mesmo com o pedido feito à mão.
  const refused = await page.request.post("/api/assistente", {
    data: { message: "Quanto gastei?" },
  });
  expect(await refused.text()).toContain('"state":"precisa_ativar"');
  const otherSite = await page.request.post("/api/assistente", {
    data: { message: "Oi" },
    headers: { "sec-fetch-site": "cross-site" },
  });
  expect(otherSite.status()).toBe(403);

  const open = page.getByRole("button", { name: "Assistente", exact: true });
  await open.click();
  const panel = page.getByRole("dialog", { name: "Assistente" });
  await expect(panel.getByRole("heading", { name: "Antes de começar" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "O que fica de fora" })).toBeVisible();
  await expect(panel.getByText("Nomes, e-mails, CPF e senhas.")).toBeVisible();
  await expect(panel.getByRole("radio", { name: /^Organizar/ })).toBeChecked();
  expect(await violations(page)).toEqual([]);

  await panel.getByRole("radio", { name: /^Sugerir/ }).check();
  await panel.getByRole("checkbox", { name: /Autorizo o uso/ }).check();
  await panel.getByRole("button", { name: "Ativar o assistente" }).click();

  // Ativado, a conversa aparece no lugar da explicação.
  const question = panel.getByLabel("Sua pergunta");
  await expect(question).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await question.fill("Como foi este mês?");
  await panel.getByRole("button", { name: "Enviar" }).click();

  await expect(panel.getByText("Você disse:")).toBeAttached();
  await expect(panel.getByRole("list", { name: "O que o assistente olhou" })).toContainText(
    "olhei o resumo do mês",
  );
  await expect(panel.getByText("Tudo em ordem")).toBeVisible();
  await expect(panel.getByText("por aqui, sem surpresas.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Enviar" })).toBeVisible();
  expect(await violations(page)).toEqual([]);

  // Histórico: a conversa continua lá depois de recarregar.
  await page.reload();
  await open.click();
  await panel.getByRole("button", { name: "Conversas anteriores" }).click();
  await panel.getByRole("button", { name: "Como foi este mês?", exact: true }).click();
  await expect(panel.getByText("Tudo em ordem")).toBeVisible();
  await panel.getByRole("button", { name: "Fechar" }).click();

  // Configurações mostra o nível escolhido e desliga.
  await page.goto("/app/configuracoes");
  await expect(page.getByLabel("O que ele pode fazer sozinho")).toHaveValue("sugerir");
  await page.getByRole("button", { name: "Desligar o assistente" }).click();
  await page.getByRole("button", { name: "Desligar", exact: true }).click();
  await expect(page.getByText("Para ligar, abra o botão Assistente")).toBeVisible();

  const off = await page.request.post("/api/assistente", { data: { message: "Oi" } });
  expect(await off.text()).toContain('"state":"precisa_ativar"');
});

test("anota na conversa, mostra em Configurações e apaga de verdade", async ({ page }) => {
  await signUp(page, "Noa");
  await page.goto("/app/configuracoes");
  await expect(page.getByText("Nada anotado ainda")).toBeVisible();

  const open = page.getByRole("button", { name: "Assistente", exact: true });
  await open.click();
  const panel = page.getByRole("dialog", { name: "Assistente" });
  await panel.getByRole("checkbox", { name: /Autorizo o uso/ }).check();
  await panel.getByRole("button", { name: "Ativar o assistente" }).click();

  for (const note of ["Prefere resumo aos domingos", "Quer viajar para a praia em família"]) {
    const question = panel.getByLabel("Sua pergunta");
    await question.fill(`Anote: ${note}`);
    await panel.getByRole("button", { name: "Enviar" }).click();
    await expect(panel.getByText("Tudo em ordem").last()).toBeVisible();
    await expect(panel.getByRole("button", { name: "Enviar" })).toBeVisible();
  }
  await expect(panel.getByRole("list", { name: "O que o assistente olhou" }).last()).toContainText(
    "deixei anotado",
  );

  await page.goto("/app/configuracoes");
  await expect(page.getByText("Prefere resumo aos domingos")).toBeVisible();
  await expect(page.getByText("Quer viajar para a praia em família")).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await page.getByRole("button", { name: /Apagar a anotação: Prefere resumo/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Apagar", exact: true }).click();
  await expect(page.getByText("Prefere resumo aos domingos")).toBeHidden();
  await expect(page.getByText("Quer viajar para a praia em família")).toBeVisible();

  await page.getByRole("button", { name: "Apagar tudo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Apagar tudo" }).click();
  await expect(page.getByText("Nada anotado ainda")).toBeVisible();
});

const PANEL_TEXTS = [
  {
    locale: "en",
    settings: "Idioma",
    name: "Assistant",
    title: "Before you start",
    outside: "including outside Brazil",
    level: /^Organize/,
    consent: /I authorize the use/,
    submit: "Turn on the assistant",
    question: "Your question",
    suggestion: "How did this month go?",
    send: "Send",
    tools: "What the assistant looked at",
    looked: "looked at the month’s summary",
    previous: "Previous conversations",
  },
  {
    locale: "es",
    settings: "Idioma",
    name: "Asistente",
    title: "Antes de empezar",
    outside: "incluso fuera de Brasil",
    level: /^Organizar/,
    consent: /Autorizo el uso/,
    submit: "Activar el asistente",
    question: "Tu pregunta",
    suggestion: "¿Cómo fue este mes?",
    send: "Enviar",
    tools: "Qué revisó el asistente",
    looked: "revisé el resumen del mes",
    previous: "Conversaciones anteriores",
  },
];

for (const texts of PANEL_TEXTS) {
  test(`ativação e conversa em ${texts.locale}, com os botões prontos no idioma`, async ({
    page,
  }) => {
    await signUp(page, "Eva");
    await page.goto("/app/configuracoes");
    await page.getByLabel("Idioma", { exact: true }).selectOption(texts.locale);
    await expect(page.locator("html")).toHaveAttribute("lang", texts.locale);

    await page.getByRole("button", { name: texts.name, exact: true }).click();
    const panel = page.getByRole("dialog", { name: texts.name });
    await expect(panel.getByRole("heading", { name: texts.title })).toBeVisible();
    await expect(panel.getByRole("radio", { name: texts.level })).toBeChecked();
    await expect(panel.getByRole("checkbox", { name: texts.consent })).toBeVisible();
    await expect(panel.getByText(texts.outside)).toBeVisible();
    await expect(panel).not.toContainText(/[ãõç]|você|Autorizo o/);
    expect(await violations(page)).toEqual([]);

    await panel.getByRole("checkbox", { name: texts.consent }).check();
    await panel.getByRole("button", { name: texts.submit }).click();
    await expect(panel.getByLabel(texts.question)).toBeVisible();
    await panel.getByRole("button", { name: texts.suggestion, exact: true }).click();
    await expect(panel.getByRole("list", { name: texts.tools })).toContainText(texts.looked);
    await expect(panel.getByRole("button", { name: texts.send })).toBeVisible();
    await expect(panel.getByRole("button", { name: texts.previous })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
}
