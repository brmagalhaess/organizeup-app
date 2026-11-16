import "server-only";
// API do app de celular (ADR-0045). Mesma sessão e mesmas regras das telas; a diferença é responder
// JSON com um código em vez de redirecionar, porque o app não segue redirecionamento de tela.
import {
  fromSession,
  householdIsSuspended,
  readFamilyAccess,
  readOnlyContext,
  userIsBlocked,
  type TenantContext,
  type TenantRole,
} from "@organizeup/db";
import type { MonthEntry } from "@organizeup/domain";
import { formatDayMonth } from "@/i18n/format";
import type { MoneyText } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import { getSession, platformFlags } from "./session";

export type MobileErrorCode =
  "unauthenticated" | "blocked" | "no_family" | "suspended" | "invalid" | "forbidden";

const NO_STORE = { "Cache-Control": "no-store" };

export const mobileJson = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: NO_STORE });

export const mobileError = (code: MobileErrorCode, status: number, message?: string) =>
  mobileJson({ error: code, ...(message ? { message } : {}) }, status);

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** Pessoa autenticada e não bloqueada, ou a resposta de erro pronta. */
export async function mobileSession(): Promise<Session | Response> {
  const session = await getSession();
  if (!session) return mobileError("unauthenticated", 401);
  if (await userIsBlocked(session.user.id)) return mobileError("blocked", 403);
  return session;
}

/**
 * O `requireTenant` do app: família ativa, filiação válida, não suspensa, e contexto só leitura na
 * manutenção ou com o plano vencido (ADR-0023). Quem chama confere `instanceof Response` primeiro.
 */
export async function mobileTenant(): Promise<
  { session: Session; ctx: TenantContext; role: TenantRole } | Response
> {
  const session = await mobileSession();
  if (session instanceof Response) return session;
  const ctx = await fromSession(session);
  if (!ctx) return mobileError("no_family", 409);
  if (await householdIsSuspended(ctx.householdId)) return mobileError("suspended", 403);
  const flags = await platformFlags();
  if (flags.maintenance) {
    const paused = readOnlyContext(ctx);
    return { session, ctx: paused, role: paused.role };
  }
  const expired = (await readFamilyAccess(ctx, flags)).mode === "leitura";
  return { session, ctx: expired ? readOnlyContext(ctx) : ctx, role: ctx.role };
}

/** Uma linha de lançamento como o app mostra: o valor já vem escrito na moeda e no idioma da pessoa. */
export function mobileEntry(
  entry: MonthEntry,
  money: MoneyText,
  locale: Locale,
  names: { categories: Map<string, string>; accounts: Map<string, string> },
) {
  return {
    key: entry.key,
    source: entry.source,
    kind: entry.kind,
    description: entry.description,
    amountText: money(entry.amount),
    date: entry.date,
    dateText: formatDayMonth(entry.date, locale),
    status: entry.status,
    category: names.categories.get(entry.categoryId) ?? null,
    account: names.accounts.get(entry.accountId) ?? null,
  };
}
