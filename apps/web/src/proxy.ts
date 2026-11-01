import { NextResponse, type NextRequest } from "next/server";
import {
  isLocale,
  LANDING_LOCALE_HEADER,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
} from "@/i18n/locales";

/**
 * Só a landing em outro idioma: o endereço manda no idioma, e `resolveLocale` lê este cabeçalho. O
 * layout raiz não conhece o endereço, e sem isso `<html lang>` seguiria a conta ou o cookie (ADR-0020).
 * Os links de entrar e de criar conta de `/en` e `/es` levam `?lang=`: vale como escolha, e o cookie
 * deixa o idioma na conta nova e nas telas seguintes.
 */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const locale =
    pathname === "/en" || pathname === "/es" ? pathname.slice(1) : searchParams.get("lang");
  if (!isLocale(locale)) return NextResponse.next();

  const headers = new Headers(request.headers);
  headers.set(LANDING_LOCALE_HEADER, locale);
  const response = NextResponse.next({ request: { headers } });
  if (searchParams.has("lang")) {
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
    });
  }
  return response;
}

export const config = { matcher: ["/en", "/es", "/entrar", "/cadastro"] };
