import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import nextVitals from "eslint-config-next/core-web-vitals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      ".pg/**",
      ".claude/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
      // App de celular: pastas nativas geradas e cache do Expo (ADR-0045).
      "apps/mobile/ios/**",
      "apps/mobile/android/**",
      "apps/mobile/.expo/**",
      "apps/mobile/expo-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Regra de ouro do isolamento: ninguém importa a conexão crua do Better Auth.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@organizeup/db/auth-db",
              message:
                "Só apps/web/src/lib/auth.ts pode usar a conexão do Better Auth. Use withHousehold().",
            },
            {
              name: "postgres",
              message: "Acesse o banco só via @organizeup/db (withHousehold / helpers de ops).",
            },
          ],
          patterns: [
            {
              group: ["@organizeup/db/src/*", "**/packages/db/src/client*"],
              message: "Não importe internals do pacote de banco.",
            },
          ],
        },
      ],
    },
  },
  // Exceções explícitas e revisadas (CODEOWNERS).
  {
    files: ["apps/web/src/lib/auth.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["packages/db/**"],
    rules: { "no-restricted-imports": "off" },
  },
  // Next.js (somente a app web).
  ...nextVitals.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{ts,tsx,js,jsx,mjs}"],
    settings: { ...config.settings, next: { rootDir: "apps/web" } },
  })),
);
