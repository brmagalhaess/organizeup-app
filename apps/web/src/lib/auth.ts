import "server-only";
import { betterAuth, type GenericEndpointContext } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  createEmailVerificationToken,
} from "better-auth/api";
import { verifyJWT } from "better-auth/crypto";
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
  releaseConfirmationEmail,
  reserveConfirmationEmail,
  saveUserLocale,
  sql,
  user,
  userIsBlocked,
} from "@organizeup/db";
import { authDb, betterAuthSchema } from "@organizeup/db/auth-db";
import { parseIdentity, parseInviteeIdentity } from "@organizeup/domain";
import { isLocale, LOCALE_COOKIE, negotiateLocale, type Locale } from "@/i18n/locales";
import { cancelBeforeDelete } from "./billing/close-family";
import { clientIp, withClientIp } from "./client-ip";
import { noteRefusal, refusalsBlocked } from "./document-refusals";
import { sendEmailInBackground } from "./email";
import {
  CONFIRM_EMAIL_PATH,
  INVITE_LINK_DAYS,
  invitationEmail,
  passwordChangedEmail,
  RESET_LINK_HOURS,
  resetPasswordEmail,
  VERIFY_LINK_HOURS,
  verifyEmail,
} from "./email-templates";
import { releaseDocument, reserveDocument, storeIdentity } from "./identity";
import { inviteId } from "./invites";
import { LEGAL_VERSION } from "./legal";
import { isValidPassword } from "./password";
import { ac, roles } from "./permissions";

/**
 * Antes de apagar a conta: famílias só da pessoa somem junto, em cascata.
 * Família com mais gente bloqueia, para ninguém perder o acesso sem aviso.
 */
export async function closeOwnHouseholds(userId: string) {
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
  await stopBilling(ids);
  await db.delete(household).where(inArray(household.id, ids));
}

/** Nada é apagado com a cobrança de pé: sem cancelar na Stripe, a exclusão é recusada (ADR-0023). */
async function stopBilling(householdIds: string[]) {
  try {
    await cancelBeforeDelete(householdIds);
  } catch (error) {
    const { name, code } = error as { name?: string; code?: string };
    console.error(JSON.stringify({ level: "error", msg: "billing_cancel_failed", name, code }));
    throw new APIError("BAD_REQUEST", { message: "BILLING_CANCEL_FAILED" });
  }
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

interface SignUpBody {
  identity?: unknown;
  invitation?: unknown;
}

/** Quem se cadastra por convite é pessoa: o id do convite vem do link, e o servidor é que decide o tipo. */
const signUpIdentity = (body: SignUpBody) =>
  inviteId(body.invitation) ? parseInviteeIdentity(body.identity) : parseIdentity(body.identity);

/**
 * Documento do cadastro, antes de criar a conta: dígito errado não passa, sem a chave do cofre só quem mora
 * fora se cadastra, e documento repetido é recusado aqui, sem deixar conta, sessão nem e-mail para trás. A
 * mensagem é neutra: não diz que o documento existe.
 */
async function reserveSignUpDocument(body: SignUpBody, headers: Headers | undefined) {
  const identity = signUpIdentity(body);
  if (!identity.ok) throw new APIError("BAD_REQUEST", { message: "DOCUMENT_INVALID" });
  if (!identity.value.inBrazil) return;
  const key = `ip:${headers ? clientIp(headers) : null}`;
  if (refusalsBlocked(key)) {
    throw new APIError("TOO_MANY_REQUESTS", { message: "TOO_MANY_ATTEMPTS" });
  }
  const reserved = await reserveDocument(identity.value);
  if (reserved === "refused") {
    noteRefusal(key);
    throw new APIError("BAD_REQUEST", { message: "DOCUMENT_REFUSED" });
  }
  if (reserved === "unavailable") {
    throw new APIError("SERVICE_UNAVAILABLE", { message: "DOCUMENT_UNAVAILABLE" });
  }
}

/**
 * Grava o documento reservado. A recusa aqui é o caso raro de a mesma pessoa informar o documento em
 * `/app/completar` no mesmo instante: a conta recém-criada sai, e a mensagem é a mesma.
 */
async function saveSignUpIdentity(userId: string, body: SignUpBody) {
  const identity = signUpIdentity(body);
  if (!identity.ok) throw new APIError("BAD_REQUEST", { message: "DOCUMENT_INVALID" });
  const result = await storeIdentity(userId, identity.value);
  await releaseDocument(identity.value);
  if (result === "ok") return;
  await authDb().delete(user).where(eq(user.id, userId));
  const message = result === "refused" ? "DOCUMENT_REFUSED" : "DOCUMENT_UNAVAILABLE";
  throw new APIError("BAD_REQUEST", { message });
}

/**
 * Confirmação do cadastro: a última coisa do gancho, para recusa nenhuma deixar e-mail para trás. Soma no
 * mesmo limite do reenvio (ADR-0011). Limite cheio não muda a resposta: a conta nasce igual, só sem o e-mail,
 * e quem pediu pode reenviar depois. A Brevo não segura o cadastro, e falhar aqui não barra ninguém.
 */
async function sendSignUpConfirmation(
  account: { id: string; name: string; email: string },
  ctx: GenericEndpointContext,
) {
  const slot = await reserveConfirmationEmail(account.email).catch(() => null);
  if (!slot || !("id" in slot)) return;
  const message = async () => {
    const [token, locale] = await Promise.all([
      createEmailVerificationToken(
        ctx.context.secret,
        account.email,
        undefined,
        VERIFY_LINK_HOURS * 60 * 60,
      ),
      emailLocale(account.id, ctx.request),
    ]);
    return { to: account.email, ...verifyEmail({ name: account.name, token, locale }) };
  };
  await sendEmailInBackground(message(), () => releaseConfirmationEmail(slot.id));
}

/** Rotas que escrevem e ficam fechadas na manutenção. Entrar, sair e abrir a família continuam. */
const writesInMaintenance = (path: string) =>
  path === "/sign-up/email" ||
  path === "/delete-user" ||
  path === "/update-user" ||
  (path.startsWith("/organization/") &&
    !["/organization/set-active", "/organization/list"].includes(path));

/**
 * Volta do link de confirmação. O Better Auth trata link repetido como sucesso, cai em JSON sem `token` e, em
 * conta bloqueada, confirma e só então falha ao abrir a sessão. Por isso a decisão vem antes dele: o endereço de
 * volta é sempre o nosso, o que vier na URL é ignorado, e o estado sai do token já conferido, nunca do pedido.
 */
async function verifyEmailLanding(ctx: GenericEndpointContext) {
  if ((await readPlatformFlags()).maintenance) {
    throw ctx.redirect(`${CONFIRM_EMAIL_PATH}?error=MAINTENANCE`);
  }
  const token: unknown = ctx.query?.token;
  if (typeof token !== "string") throw ctx.redirect(`${CONFIRM_EMAIL_PATH}?error=INVALID_TOKEN`);
  const payload = await verifyJWT<{ email?: string }>(token, ctx.context.secret);
  const found = payload?.email
    ? await ctx.context.internalAdapter.findUserByEmail(payload.email)
    : null;
  if (found && (await userIsBlocked(found.user.id))) throw ctx.redirect("/conta-bloqueada");
  const state = found?.user.emailVerified ? "ja-confirmado" : "confirmado";
  const callbackURL = found ? `${CONFIRM_EMAIL_PATH}?estado=${state}` : CONFIRM_EMAIL_PATH;
  return { context: { query: { ...ctx.query, callbackURL } } };
}

function createAuth() {
  const auth = betterAuth({
    appName: "OrganizeUp",
    database: drizzleAdapter(authDb(), { provider: "pg", schema: betterAuthSchema }),
    emailAndPassword: {
      enabled: true,
      // Sem tamanho mínimo, por decisão do fundador: vale a regra de lib/password.ts.
      minPasswordLength: 1,
      maxPasswordLength: 128,
      // A confirmação sai no fim do cadastro e pode ser pedida de novo, mas não impede de entrar.
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
      // Quem envia é `sendSignUpConfirmation`: daqui o e-mail sairia antes de o documento ser gravado.
      sendOnSignUp: false,
      // O link só confirma: quem tem o e-mail encaminhado não entra na conta sem a senha.
      autoSignInAfterVerification: false,
      expiresIn: VERIFY_LINK_HOURS * 60 * 60,
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
            await reserveSignUpDocument(ctx.body ?? {}, ctx.headers);
          },
          // Roda depois de a transação fechar e de o Better Auth marcar o cookie da sessão: recusa aqui
          // apaga a conta, e o gancho `after` da requisição tira o cookie da resposta de erro.
          after: async (user, ctx) => {
            const signUp = ctx?.path === "/sign-up/email" ? ctx : null;
            if (signUp) await saveSignUpIdentity(user.id, signUp.body ?? {});
            await authDb()
              .insert(legalAcceptance)
              .values({ userId: user.id, version: LEGAL_VERSION });
            // O idioma escolhido antes de ter conta passa para a conta. Falhar aqui não barra ninguém.
            const chosen = ctx?.getCookie(LOCALE_COOKIE);
            if (isLocale(chosen)) await saveUserLocale(user.id, chosen).catch(() => false);
            if (signUp) await sendSignUpConfirmation(user, signUp);
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
        if (ctx.path === "/verify-email") return verifyEmailLanding(ctx);
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
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        if (ctx.context.returned instanceof APIError) {
          ctx.context.responseHeaders?.delete("set-cookie");
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
      // Chega aqui só o IP confiável: ver `withClientIp`.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    telemetry: { enabled: false },
    // Só a rota pública. A tela e a action usam `auth.api`, que não passa por aqui. Fechadas porque
    // devolvem o id dos convites a qualquer membro, e o id é o segredo do link.
    disabledPaths: [
      "/organization/list-invitations",
      "/organization/get-full-organization",
      "/organization/accept-invitation",
      // Aceita qualquer e-mail, sem sessão e fora do limite por conta. O reenvio é por server action.
      "/send-verification-email",
    ],
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: true,
        organizationLimit: 5,
        organizationHooks: {
          beforeDeleteOrganization: ({ organization }) => stopBilling([organization.id]),
        },
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
  // O limite de pedidos lê o IP antes de qualquer plugin: a troca precisa ser aqui, na entrada.
  return { ...auth, handler: (request: Request) => auth.handler(withClientIp(request)) };
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** Instância preguiçosa: o build do Next não precisa de DATABASE_URL. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
