import { NextResponse, type NextRequest } from "next/server";
import { LANDING_LOCALE_HEADER } from "@/i18n/locales";

/**
 * Só a landing em outro idioma: o endereço manda no idioma, e `resolveLocale` lê este cabeçalho. O
 * layout raiz não conhece o endereço, e sem isso `<html lang>` seguiria a conta ou o cookie (ADR-0020).
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(LANDING_LOCALE_HEADER, request.nextUrl.pathname.slice(1));
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/en", "/es"] };
