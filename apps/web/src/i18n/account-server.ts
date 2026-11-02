import "server-only";
// Tipo da conta no servidor (ADR-0022). No navegador, `account.tsx`. Pessoa física tem família; pessoa
// jurídica tem sócios. O texto muda sozinho pelo catálogo, em `messagesFor`; a tela só pergunta o que existe.
import { householdAccountType, readUserIdentity } from "@organizeup/db";
import { accountFeatures, type AccountType } from "@organizeup/domain";
import { createTranslator } from "next-intl";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import type { Locale } from "./locales";
import { messagesFor } from "./messages";

/** Sem família ativa, vale o que a pessoa informou. Sem sessão ou sem banco: família. Nunca derruba tela. */
async function readAccountType(): Promise<AccountType> {
  try {
    const session = await getSession();
    if (!session) return "pf";
    const householdId = session.session.activeOrganizationId;
    if (householdId) return await householdAccountType(householdId);
    return (await readUserIdentity(session.user.id))?.personType === "pj" ? "pj" : "pf";
  } catch {
    return "pf";
  }
}

// Pelo mesmo motivo de `familyCurrency`: o `cache` do React não vale dentro de server action.
const resolved = new WeakMap<object, Promise<AccountType>>();

/** Tipo da conta ativa nesta requisição, lido uma vez só. Fora de requisição: família. */
export async function familyAccountType(): Promise<AccountType> {
  let requestHeaders: object;
  try {
    requestHeaders = await headers();
  } catch {
    return "pf";
  }
  const known = resolved.get(requestHeaders);
  if (known) return known;
  const type = readAccountType();
  resolved.set(requestHeaders, type);
  return type;
}

/** O que existe nesta conta: parentesco, casamento, dependentes, participação. */
export const getAccountFeatures = async () => accountFeatures(await familyAccountType());

/**
 * Textos de um tipo escolhido, para quem ainda não está na conta: convite e cadastro por convite. A
 * chave é a mesma: só o catálogo muda.
 */
export async function textsForAccount(type: AccountType, namespace: string) {
  const locale = (await getLocale()) as Locale;
  return createTranslator({
    locale,
    messages: messagesFor(locale, "BRL", type),
    namespace: namespace as never,
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;
}
