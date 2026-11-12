import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LANDING_LOCALE_HEADER, LOCALE_COOKIE } from "@/i18n/locales";
import { proxy } from "./proxy";

const request = (path: string) =>
  new NextRequest(new URL(path, "https://organizeup.crowntech.com.br"));

describe("CSP e locale da landing (proxy.ts)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("em produção, script-src usa nonce e strict-dynamic, sem unsafe-inline", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(request("/"));
    const csp = response.headers.get("Content-Security-Policy")!;
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("fora de produção, script-src mantém unsafe-inline e unsafe-eval", () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = proxy(request("/"));
    const csp = response.headers.get("Content-Security-Policy")!;
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'unsafe-eval'");
  });

  it("gera um nonce diferente por requisição", () => {
    vi.stubEnv("NODE_ENV", "production");
    const a = proxy(request("/")).headers.get("Content-Security-Policy")!;
    const b = proxy(request("/")).headers.get("Content-Security-Policy")!;
    expect(a).not.toBe(b);
  });

  it("propaga o nonce também no cabeçalho da requisição, para o Next aplicar nos próprios scripts", () => {
    // NextResponse.next({ request: { headers } }) leva isso por "x-middleware-request-*" (ver
    // response.js do Next): é assim que o servidor remonta os cabeçalhos da requisição depois do proxy.
    const response = proxy(request("/"));
    const nonce = response.headers.get("Content-Security-Policy")!.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(response.headers.get("x-middleware-override-headers")).toContain("x-nonce");
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toContain(
      `'nonce-${nonce}'`,
    );
  });

  it("marca a landing em /en e /es com o cabeçalho de idioma, sem cookie (não veio de ?lang=)", () => {
    const en = proxy(request("/en"));
    expect(en.headers.get(`x-middleware-request-${LANDING_LOCALE_HEADER}`)).toBe("en");
    expect(en.cookies.get(LOCALE_COOKIE)).toBeUndefined();
  });

  it("rota comum não leva o cabeçalho de idioma", () => {
    const response = proxy(request("/app/lancamentos"));
    expect(response.headers.get("x-middleware-override-headers")).not.toContain(
      LANDING_LOCALE_HEADER,
    );
  });

  it("marca o cabeçalho de idioma e grava o cookie quando o link traz ?lang=", () => {
    const response = proxy(request("/entrar?lang=en"));
    expect(response.cookies.get(LOCALE_COOKIE)?.value).toBe("en");
  });

  it("idioma inválido não grava cookie nem quebra a CSP", () => {
    const response = proxy(request("/entrar?lang=fr"));
    expect(response.cookies.get(LOCALE_COOKIE)).toBeUndefined();
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src");
  });
});
