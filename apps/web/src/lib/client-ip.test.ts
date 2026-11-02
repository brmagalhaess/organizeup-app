import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, withClientIp } from "./client-ip";

const headers = (value?: string) =>
  new Headers(value === undefined ? {} : { "x-forwarded-for": value });

describe("IP de quem chamou", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("usa o que o nosso proxy acrescentou, não o valor mais à esquerda", () => {
    expect(clientIp(headers("1.1.1.1, 2.2.2.2, 198.51.100.7"))).toBe("198.51.100.7");
    expect(clientIp(headers("198.51.100.7"))).toBe("198.51.100.7");
  });

  it("forjar a esquerda não muda o IP", () => {
    const seen = new Set(
      [...Array(5).keys()].map((n) => clientIp(headers(`203.0.113.${n}, 198.51.100.7`))),
    );
    expect([...seen]).toEqual(["198.51.100.7"]);
  });

  it("com dois proxies nossos, conta dois da direita", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientIp(headers("9.9.9.9, 198.51.100.7, 172.16.0.1"))).toBe("198.51.100.7");
  });

  it.each(["0", "-1", "abc", "1.5", ""])("valor inválido (%j) vale como um proxy", (value) => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", value);
    expect(clientIp(headers("9.9.9.9, 198.51.100.7"))).toBe("198.51.100.7");
  });

  it("corrente menor que os saltos, ou vazia, não quebra", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "3");
    expect(clientIp(headers("198.51.100.7"))).toBe("198.51.100.7");
    expect(clientIp(headers())).toBeNull();
    expect(clientIp(headers(" , "))).toBeNull();
  });

  it("reescreve o cabeçalho e mantém o corpo do pedido", async () => {
    const request = new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "x-forwarded-for": "1.1.1.1, 198.51.100.7" },
      body: "corpo",
    });
    const rewritten = withClientIp(request);
    expect(rewritten.headers.get("x-forwarded-for")).toBe("198.51.100.7");
    expect(await rewritten.text()).toBe("corpo");
  });
});
