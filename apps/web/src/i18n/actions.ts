"use server";
import { saveUserLocale } from "@organizeup/db";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSession } from "@/lib/session";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./locales";

/**
 * Troca o idioma: sempre no cookie, e na conta de quem entrou. O idioma é da pessoa, não da família,
 * então vale também na manutenção e para quem só pode ver. Devolve false se a conta não gravou.
 */
export async function changeLocale(locale: string): Promise<boolean> {
  if (!isLocale(locale)) return false;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
  });
  let saved = true;
  try {
    const session = await getSession();
    // Sem a tabela ainda (false), o cookie resolve: a conta não tem valor antigo para vencer.
    if (session) await saveUserLocale(session.user.id, locale);
  } catch {
    saved = false;
  }
  revalidatePath("/", "layout");
  return saved;
}
