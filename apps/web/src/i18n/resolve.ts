import "server-only";
import { readUserLocale } from "@organizeup/db";
import { cookies, headers } from "next/headers";
import { getSession } from "@/lib/session";
import { isLocale, LOCALE_COOKIE, negotiateLocale, type Locale } from "./locales";

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

// O `cache` do React não vale dentro de server action, e uma action pede o idioma várias vezes. O objeto
// de cabeçalhos é um por requisição: guardado nele, o idioma é lido uma vez só nas duas situações.
const resolved = new WeakMap<object, Promise<Locale>>();

/** Idioma da requisição: conta, depois cookie, depois o navegador. O padrão é pt-BR. */
export async function resolveLocale(): Promise<Locale> {
  // Lidos antes do try: é aqui que o Next descobre que a rota é dinâmica.
  const store = await cookies();
  const requestHeaders = await headers();
  const known = resolved.get(requestHeaders);
  if (known) return known;
  const chosen = store.get(LOCALE_COOKIE)?.value;
  const acceptLanguage = requestHeaders.get("accept-language");
  const locale = accountLocale().then(
    (saved) => saved ?? (isLocale(chosen) ? chosen : negotiateLocale(acceptLanguage)),
  );
  resolved.set(requestHeaders, locale);
  return locale;
}
