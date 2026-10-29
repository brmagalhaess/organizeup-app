import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { authDb, betterAuthSchema } from "@organizeup/db/auth-db";
import { ac, roles } from "./permissions";

function createAuth() {
  return betterAuth({
    appName: "OrganizeUp",
    database: drizzleAdapter(authDb(), { provider: "pg", schema: betterAuthSchema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // Verificação de e-mail entra com o SMTP (Fase 2).
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
    },
    // Limite por IP (inclui regras mais rígidas do Better Auth para cadastro/login).
    // AUTH_RATE_LIMIT=disabled só no e2e do CI/local — nunca em produção.
    rateLimit: { enabled: process.env.AUTH_RATE_LIMIT !== "disabled", window: 60, max: 60 },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
    },
    telemetry: { enabled: false },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: true,
        organizationLimit: 5,
        membershipLimit: 12,
      }),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** Instância preguiçosa: o build do Next não precisa de DATABASE_URL. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
