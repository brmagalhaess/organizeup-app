// Erro enviado por uma tela aparece no painel do serviço: alerta na Visão geral e bloco em Sistema.
// Precisa de E2E_ADMIN_EMAIL, como admin.spec.ts. Sem E2E_OPS_TOKEN, a parte de resolver não roda.
import AxeBuilder from "@axe-core/playwright";
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { newCpf } from "./documents";

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "";
const opsToken = process.env.E2E_OPS_TOKEN ?? "";
const password = "senha-segura-123!";

test.skip(!adminEmail, "Defina E2E_ADMIN_EMAIL e suba o servidor com ADMIN_EMAILS igual.");

/** Só letras: número em segmento de rota vira `[id]`, e o teste precisa de rota própria. */
const letters = () =>
  [...randomBytes(8)].map((byte) => String.fromCharCode(97 + (byte % 26))).join("");

async function signInAsAdmin(page: Page) {
  await page.goto("/entrar");
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
  if (outcome === "entrou") return;
  await page.goto("/cadastro");
  await page.getByLabel("Seu nome").fill("Admin");
  await page.getByLabel("CPF", { exact: true }).fill(newCpf());
  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/app\/novo-household$/);
}

test("erro de tela aparece no alerta e no bloco de erros, sem nada pessoal", async ({ page }) => {
  await signInAsAdmin(page);

  const route = `/app/teste-${letters()}/[id]`;
  const sent = await page.request.post("/api/diagnostics", {
    data: { fingerprint: randomBytes(16).toString("hex"), route },
  });
  expect(sent.status()).toBe(204);
  const refused = await page.request.post("/api/diagnostics", {
    data: { fingerprint: "a".repeat(32), route, message: "ana@example.com" },
  });
  expect(refused.status()).toBe(422);

  await page.goto("/admin");
  const alerts = page.getByRole("list", { name: "Alertas" });
  await expect(alerts.getByText(/Erros? novos? no serviço/)).toBeVisible();

  await page.goto("/admin/sistema");
  await expect(page.getByRole("heading", { name: "Erros", exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: route });
  await expect(row).toContainText("ErroDeTela");
  await expect(row).toContainText("Web");

  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations.map((v) => ({ id: v.id, html: v.nodes[0]?.html }))).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  if (!opsToken) return;
  const headers = { Authorization: `Bearer ${opsToken}` };
  const open = await page.request.get("/api/ops/diagnostics", {
    headers,
    params: { route },
  });
  const { diagnostics } = (await open.json()) as { diagnostics: Array<{ fingerprint: string }> };
  expect(diagnostics).toHaveLength(1);
  const done = await page.request.post("/api/ops/diagnostics", {
    headers,
    data: { fingerprint: diagnostics[0]!.fingerprint },
  });
  expect(await done.json()).toEqual({ resolved: 1 });

  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: route })).toHaveCount(0);
});
