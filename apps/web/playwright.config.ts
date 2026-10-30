import { defineConfig, devices } from "@playwright/test";

// O app (web + worker + Postgres) é iniciado fora do Playwright:
// no CI pelo workflow (imagem Docker); localmente com `pnpm db:local`, worker e `next start`.
export default defineConfig({
  testDir: "./e2e",
  // Fluxos longos, com duas famílias, passam de 30 s quando os testes rodam em paralelo.
  timeout: 90_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
