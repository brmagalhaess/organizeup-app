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
  householdAccountType,
  householdInvitation,
  householdMember,
  inArray,
  legalAcceptance,
  ne,
  readPlatformFlags,
  readUserLocale,
  saveUserLocale,
  sql,
  user,
  userIsBlocked,
} from "@organizeup/db";
import { authDb, betterAuthSchema } from "@organizeup/db/auth-db";
import { parseIdentity } from "@organizeup/domain";
import { isLocale, LOCALE_COOKIE, negotiateLocale, type Locale } from "@/i18n/locales";
import { vaultReady } from "./document-vault";
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
import { logVaultMissing, storeIdentity } from "./identity";
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

/** Idioma de quem fez o pedido: o mesmo caminho da tela, sem a conta. */
function requestLocale(request: Request | undefined): Locale {
  const cookies = request?.headers.get("cookie") ?? "";
  const chosen = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`).exec(cookies)?.[1];
  return isLocale(chosen) ? chosen : negotiateLocale(request?.headers.get("accept-language"));
}

/** Idioma de quem recebe: o da conta e, sem escolha, o do pedido. Falhar aqui não barra o e-mail. */
async function emailLocale(userId: string, request: Request | undefined): Promise<Locale> {
  const saved = await readUserLocale(userId).catch(() => null);
  return isLocale(saved) ? saved : requestLocale(request);
}

/** Convite: o idioma de quem recebe, se já tem conta; se não, o de quem convidou. */
async function invitationLocale(email: string, inviterId: string, request: Request | undefined) {
  const [invited] = await authDb()
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`)
    .limit(1)
    .catch(() => []);
  const saved = invited ? await readUserLocale(invited.id).catch(() => null) : null;
  return isLocale(saved) ? saved : emailLocale(inviterId, request);
}

/**
 * Documento do cadastro, ainda antes de criar a conta: dígito errado não passa e, sem a chave do cofre,
 * só quem mora fora se cadastra. Nada é aceito para depois ser perdido ou guardado em texto puro.
 */
function checkSignUpIdentity(raw: unknown) {
  const identity = parseIdentity(raw);
  if (!identity.ok) throw new APIError("BAD_REQUEST", { message: "DOCUMENT_INVALID" });
  if (identity.value.inBrazil && !vaultReady()) {
    logVaultMissing();
    throw new APIError("SERVICE_UNAVAILABLE", { message: "DOCUMENT_UNAVAILABLE" });
  }
}

/**
 * Grava o documento logo depois de criar a conta. A RLS esconde as linhas dos outros, então quem acha a
 * duplicidade é o índice único: se ele recusar, a conta recém-criada sai, e a pessoa recebe a mensagem
 * neutra, que não diz que o documento existe. Vale também para dois cadastros ao mesmo tempo.
 */
async function saveSignUpIdentity(userId: string, raw: unknown) {
  const identity = parseIdentity(raw);
  const result = identity.ok ? await storeIdentity(userId, identity.value) : "refused";
  if (result === "ok") return;
  await authDb().delete(user).where(eq(user.id, userId));
  const message = result === "refused" ? "DOCUMENT_REFUSED" : "DOCUMENT_UNAVAILABLE";
  throw new APIError("BAD_REQUEST", { message });
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
      sendResetPassword: ({ user, token }, request) =>
        sendEmailInBackground(
          emailLocale(user.id, request).then((locale) => ({
            to: user.email,
            ...resetPasswordEmail({ name: user.name, token, locale }),
          })),
        ),
      onPasswordReset: ({ user }, request) =>
        sendEmailInBackground(
          emailLocale(user.id, request).then((locale) => ({
            to: user.email,
            ...passwordChangedEmail({ name: user.name, locale }),
          })),
        ),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: VERIFY_LINK_HOURS * 60 * 60,
      sendVerificationEmail: ({ user, token }, request) =>
        sendEmailInBackground(
          emailLocale(user.id, request).then((locale) => ({
            to: user.email,
            ...verifyEmail({ name: user.name, token, locale }),
          })),
        ),
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
            checkSignUpIdentity(ctx.body?.identity);
          },
          after: async (user, ctx) => {
            if (ctx?.path === "/sign-up/email") {
              await saveSignUpIdentity(user.id, ctx.body?.identity);
            }
            await authDb()
              .insert(legalAcceptance)
              .values({ userId: user.id, version: LEGAL_VERSION });
            // O idioma escolhido antes de ter conta passa para a conta. Falhar aqui não barra ninguém.
            const chosen = ctx?.getCookie(LOCALE_COOKIE);
            if (isLocale(chosen)) await saveUserLocale(user.id, chosen).catch(() => false);
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
    // A recusa de documento repetido é neutra, mas ainda é uma recusa: o cadastro tem limite por hora.
    rateLimit: {
      enabled: process.env.AUTH_RATE_LIMIT !== "disabled",
      window: 60,
      max: 60,
      customRules: { "/sign-up/email": { window: 60 * 60, max: 20 } },
    },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
    },
    telemetry: { enabled: false },
    // Só a rota pública. A tela e a action usam `auth.api`, que não passa por aqui. Fechadas porque
    // devolvem o id dos convites a qualquer membro, e o id é o segredo do link.
    disabledPaths: [
      "/organization/list-invitations",
      "/organization/get-full-organization",
      "/organization/accept-invitation",
    ],
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
        // aleatório (UUID v4) faz papel de segredo, desde que só o e-mail convidado e quem tem o papel
        // de convidar o vejam: ver `disabledPaths`.
        requireEmailVerificationOnInvitation: false,
        invitationExpiresIn: INVITE_LINK_DAYS * 60 * 60 * 24,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: ({ id, email, organization, inviter }, request) =>
          sendEmailInBackground(
            Promise.all([
              invitationLocale(email, inviter.user.id, request),
              householdAccountType(organization.id),
            ]).then(([locale, accountType]) => ({
              to: email,
              ...invitationEmail({
                id,
                familyName: organization.name,
                inviterName: inviter.user.name,
                locale,
                accountType,
              }),
            })),
          ),
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
