import { afterEach, describe, expect, it, vi } from "vitest";
import { siteUrl } from "./site-url";

describe("siteUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("usa BETTER_AUTH_URL quando é um endereço válido", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://organizeup.crowntech.com.br");
    expect(siteUrl().toString()).toBe("https://organizeup.crowntech.com.br/");
  });

  it("cai no padrão local sem BETTER_AUTH_URL", () => {
    vi.stubEnv("BETTER_AUTH_URL", undefined);
    expect(siteUrl().toString()).toBe("http://localhost:3000/");
  });

  // Fingerprint 69928052 (ORG-120): `new URL("")` lança TypeError e derrubava a renderização de `/`.
  it("cai no padrão local com BETTER_AUTH_URL vazio, em vez de lançar TypeError", () => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(siteUrl().toString()).toBe("http://localhost:3000/");
  });

  it("cai no padrão local com BETTER_AUTH_URL malformado, em vez de lançar TypeError", () => {
    vi.stubEnv("BETTER_AUTH_URL", "not a url");
    expect(siteUrl().toString()).toBe("http://localhost:3000/");
  });
});
