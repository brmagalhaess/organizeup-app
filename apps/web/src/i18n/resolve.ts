import "server-only";
import { readUserLocale } from "@organizeup/db";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getSession } from "@/lib/session";
import {
  isLocale,
  LANDING_LOCALE_HEADER,
  LOCALE_COOKIE,
  negotiateLocale,
  type Locale,
} from "./locales";

/** Escolha guardada na conta. Sem banco ou sem a tabela, segue sem ela: idioma não derruba tela. */
async function accountLocale(): Promise<Locale | null> {
  try {
    const session = await getSession();
    if (!session) return null;
    const saved = await readUserLocale(session.user.id);
    return isLocale(saved) ? saved : null;
  } catch {
    return null;
  }
}

/**
 * Idioma da requisição: conta, depois cookie, depois o navegador. O padrão é pt-BR. Em `/en` e `/es`
 * vale o endereço, com o cabeçalho de `proxy.ts`: ali a busca precisa achar sempre o mesmo idioma.
 */
export const resolveLocale = cache(async (): Promise<Locale> => {
  // Lidos antes do try: é aqui que o Next descobre que a rota é dinâmica.
  const store = await cookies();
  const requestHeaders = await headers();
  const landing = requestHeaders.get(LANDING_LOCALE_HEADER);
  if (isLocale(landing)) return landing;
  const acceptLanguage = requestHeaders.get("accept-language");
  const chosen = store.get(LOCALE_COOKIE)?.value;
  return (await accountLocale()) ?? (isLocale(chosen) ? chosen : negotiateLocale(acceptLanguage));
});
