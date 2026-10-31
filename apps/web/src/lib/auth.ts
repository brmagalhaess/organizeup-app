import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import {
  and,
  eq,
  gt,
  household,
  householdInvitation,
  householdMember,
  inArray,
  legalAcceptance,
  ne,
  readPlatformFlags,
  sql,
  userIsBlocked,
} from "@organizeup/db";
import { authDb, betterAuthSchema } from "@organizeup/db/auth-db";
import { sendEmailInBackground } from "./email";
import {
  INVITE_LINK_DAYS,
  invitationEmail,
  passwordChangedEmail,
  RESET_LINK_HOURS,
  resetPasswordEmail,
  VERIFY_LINK_HOURS,
  verifyEmail,
} from "./email-templates";
import { LEGAL_VERSION } from "./legal";
import { isValidPassword } from "./password";
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

/** Com o cadastro fechado, só entra quem tem convite ainda válido para o e-mail informado. */
async function hasPendingInvite(email: string) {
  const [invite] = await authDb()
    .select({ id: householdInvitation.id })
    .from(householdInvitation)
    .where(
      and(
        sql`lower(${householdInvitation.email}) = ${email.trim().toLowerCase()}`,
        eq(householdInvitation.status, "pending"),
        gt(householdInvitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(invite);
}

/** Rotas que escrevem e ficam fechadas na manutenção. Entrar, sair e abrir a família continuam. */
const writesInMaintenance = (path: string) =>
  path === "/sign-up/email" ||
  path === "/delete-user" ||
  path === "/update-user" ||
  (path.startsWith("/organization/") &&
    !["/organization/set-active", "/organization/list"].includes(path));

function createAuth() {
  return betterAuth({
    appName: "OrganizeUp",
    database: drizzleAdapter(authDb(), { provider: "pg", schema: betterAuthSchema }),
    emailAndPassword: {
      enabled: true,
      // Sem tamanho mínimo, por decisão do fundador: vale a regra de lib/password.ts.
      minPasswordLength: 1,
      maxPasswordLength: 128,
      // A confirmação de e-mail é enviada no cadastro, mas não impede de entrar.
      requireEmailVerification: false,
      // Trocar a senha derruba quem estiver dentro da conta.
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_LINK_HOURS * 60 * 60,
      sendResetPassword: ({ user, token }) =>
        sendEmailInBackground({
          to: user.email,
          ...resetPasswordEmail({ name: user.name, token }),
        }),
      onPasswordReset: ({ user }) =>
        sendEmailInBackground({ to: user.email, ...passwordChangedEmail({ name: user.name }) }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: VERIFY_LINK_HOURS * 60 * 60,
      sendVerificationEmail: ({ user, token }) =>
        sendEmailInBackground({ to: user.email, ...verifyEmail({ name: user.name, token }) }),
    },
    user: {
      deleteUser: { enabled: true, beforeDelete: (user) => closeOwnHouseholds(user.id) },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (_user, ctx) => {
            if (ctx?.path !== "/sign-up/email") return;
            if (ctx.body?.termsAccepted !== true) {
              throw new APIError("BAD_REQUEST", { message: "TERMS_REQUIRED" });
            }
            const closed = (await readPlatformFlags()).signupClosed;
            if (closed && !(await hasPendingInvite(String(ctx.body?.email ?? "")))) {
              throw new APIError("FORBIDDEN", { message: "SIGNUP_CLOSED" });
            }
          },
          after: async (user) => {
            await authDb()
              .insert(legalAcceptance)
              .values({ userId: user.id, version: LEGAL_VERSION });
          },
        },
      },
      // Toda forma de entrar passa por aqui: conta bloqueada não ganha sessão.
      session: {
        create: {
          before: async (session) => {
            if (await userIsBlocked(session.userId)) {
              throw new APIError("FORBIDDEN", { message: "ACCOUNT_BLOCKED" });
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Senha nova passa pela regra aqui: o formulário sozinho pode ser contornado.
        const body = ctx.body as { password?: unknown; newPassword?: unknown } | undefined;
        const password = ctx.path === "/sign-up/email" ? body?.password : body?.newPassword;
        if (typeof password === "string" && !isValidPassword(password)) {
          throw new APIError("BAD_REQUEST", { message: "WEAK_PASSWORD" });
        }
        if (!writesInMaintenance(ctx.path)) return;
        if ((await readPlatformFlags()).maintenance) {
          throw new APIError("SERVICE_UNAVAILABLE", { message: "MAINTENANCE" });
        }
      }),
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
        // Continua desligado mesmo com e-mail: quem chega pelo convite aceita logo depois de criar a
        // conta, ainda sem confirmar, e as contas antigas nunca receberam confirmação. O id
        // aleatório (UUID v4) faz papel de segredo: quem tem o link e o e-mail convidado entra.
        requireEmailVerificationOnInvitation: false,
        invitationExpiresIn: INVITE_LINK_DAYS * 60 * 60 * 24,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: ({ id, email, organization, inviter }) =>
          sendEmailInBackground({
            to: email,
            ...invitationEmail({
              id,
              familyName: organization.name,
              inviterName: inviter.user.name,
            }),
          }),
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
