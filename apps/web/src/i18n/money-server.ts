import "server-only";
// Moeda principal da família no servidor (ADR-0020, Fase 6). No navegador, `money.tsx`.
import { fromSession, householdCurrency, withHousehold } from "@organizeup/db";
import { brazilRulesApply, type Currency } from "@organizeup/domain";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import { moneyTextFor, type MoneyText } from "./format";

/** Sem sessão, sem família ou sem a coluna: real. Moeda não derruba tela. */
async function readCurrency(): Promise<Currency> {
  try {
    const session = await getSession();
    const ctx = session ? await fromSession(session) : null;
    return ctx ? await withHousehold(ctx, householdCurrency) : "BRL";
  } catch {
    return "BRL";
  }
}

// Pelo mesmo motivo de `resolveLocale`: o `cache` do React não vale dentro de server action.
const resolved = new WeakMap<object, Promise<Currency>>();

/** Moeda principal da família ativa nesta requisição, lida uma vez só. */
export async function familyCurrency(): Promise<Currency> {
  const requestHeaders = await headers();
  const known = resolved.get(requestHeaders);
  if (known) return known;
  const currency = readCurrency();
  resolved.set(requestHeaders, currency);
  return currency;
}

/** A action que muda a moeda desfaz a leitura, para a resposta dela já sair na moeda nova. */
export async function forgetFamilyCurrency(): Promise<void> {
  resolved.delete(await headers());
}

/** Formata no idioma da pessoa e, sem outra moeda pedida, na moeda principal da família. */
export async function getMoney(): Promise<MoneyText> {
  const [locale, currency] = await Promise.all([getLocale(), familyCurrency()]);
  return moneyTextFor(locale, currency);
}

/** As regras brasileiras valem para esta família? */
export const getBrazilRules = async () => brazilRulesApply(await familyCurrency());
