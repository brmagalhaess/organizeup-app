import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { and, eq, household, householdMember, inArray, legalAcceptance, ne } from "@organizeup/db";
import { authDb, betterAuthSchema } from "@organizeup/db/auth-db";
import { LEGAL_VERSION } from "./legal";
import { ac, roles } from "./permissions";

/**
 * Antes de apagar a conta: famílias só da pessoa somem junto, em cascata.
 * Família com mais gente bloqueia, para ninguém perder o acesso sem aviso.
 */
async function closeOwnHouseholds(userId: string) {
  const db = authDb();
  const owned = await db
    .select({ id: householdMember.organizationId })
    .from(householdMember)
    .where(and(eq(householdMember.userId, userId), eq(householdMember.role, "owner")));
  const ids = owned.map((row) => row.id);
  if (ids.length === 0) return;
  const others = await db
    .select({ id: householdMember.id })
    .from(householdMember)
    .where(and(inArray(householdMember.organizationId, ids), ne(householdMember.userId, userId)))
    .limit(1);
  if (others.length > 0) throw new APIError("BAD_REQUEST", { message: "FAMILY_HAS_MEMBERS" });
  await db.delete(household).where(inArray(household.id, ids));
}

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
    user: {
      deleteUser: { enabled: true, beforeDelete: (user) => closeOwnHouseholds(user.id) },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (_user, ctx) => {
            if (ctx?.path === "/sign-up/email" && ctx.body?.termsAccepted !== true) {
              throw new APIError("BAD_REQUEST", { message: "TERMS_REQUIRED" });
            }
          },
          after: async (user) => {
            await authDb()
              .insert(legalAcceptance)
              .values({ userId: user.id, version: LEGAL_VERSION });
          },
        },
      },
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
        // Sem e-mail ainda: o responsável envia o link, e o id aleatório (UUID v4) faz papel de
        // segredo. Quem tem o link e o e-mail convidado entra. Com SMTP, passa a exigir verificação.
        requireEmailVerificationOnInvitation: false,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        cancelPendingInvitationsOnReInvite: true,
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
