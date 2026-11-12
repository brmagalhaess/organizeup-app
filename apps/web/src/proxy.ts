import { NextResponse, type NextRequest } from "next/server";
import {
  isLocale,
  LANDING_LOCALE_HEADER,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
} from "@/i18n/locales";

const isDev = () => process.env.NODE_ENV !== "production";

/**
 * CSP sem domínios externos (ao adicionar R2/Sentry nas Fases 1–3, liste-os aqui). `script-src` usa um
 * nonce por requisição em vez de `'unsafe-inline'` em produção: sem isso, um ponto de injeção futuro
 * poderia rodar `<script>` inline sem a CSP bloquear. O nonce precisa chegar também no cabeçalho da
 * *requisição* (não só na resposta) para o Next aplicá-lo sozinho aos scripts que ele injeta no HTML.
 */
function buildCsp(nonce: string): string {
  const scriptSrc = isDev()
    ? `script-src 'self' 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Roda em toda rota (exceto assets estáticos do Next): aplica a CSP com nonce acima e, só na landing em
 * outro idioma, avisa `resolveLocale` pelo cabeçalho `LANDING_LOCALE_HEADER`. O layout raiz não conhece o
 * endereço, e sem isso `<html lang>` seguiria a conta ou o cookie (ADR-0020). Os links de entrar e de
 * criar conta de `/en` e `/es` levam `?lang=`: vale como escolha, e o cookie deixa o idioma na conta nova
 * e nas telas seguintes.
 */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const locale =
    pathname === "/en" || pathname === "/es" ? pathname.slice(1) : searchParams.get("lang");

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  if (isLocale(locale)) headers.set(LANDING_LOCALE_HEADER, locale);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);

  if (isLocale(locale) && searchParams.has("lang")) {
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

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
