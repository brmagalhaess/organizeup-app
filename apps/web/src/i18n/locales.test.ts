import { describe, expect, it } from "vitest";
import { isLocale, negotiateLocale } from "./locales";

describe("detecção pelo navegador", () => {
  it("pt-BR é o padrão sem cabeçalho e em idioma que não atendemos", () => {
    expect(negotiateLocale(null)).toBe("pt-BR");
    expect(negotiateLocale(undefined)).toBe("pt-BR");
    expect(negotiateLocale("")).toBe("pt-BR");
    expect(negotiateLocale("fr-FR,de;q=0.8")).toBe("pt-BR");
    expect(negotiateLocale("*")).toBe("pt-BR");
  });

  it("aceita qualquer variante do idioma", () => {
    expect(negotiateLocale("pt-PT")).toBe("pt-BR");
    expect(negotiateLocale("en-GB")).toBe("en");
    expect(negotiateLocale("es-419")).toBe("es");
    expect(negotiateLocale("EN-us")).toBe("en");
  });

  it("segue a preferência, e não a ordem do texto", () => {
    expect(negotiateLocale("en;q=0.5,es;q=0.9")).toBe("es");
    expect(negotiateLocale("fr-FR,fr;q=0.9,en;q=0.8,pt;q=0.7")).toBe("en");
    expect(negotiateLocale("es,en")).toBe("es");
  });

  it("q=0 quer dizer recusado", () => {
    expect(negotiateLocale("en;q=0,es;q=0.5")).toBe("es");
  });
});

describe("isLocale", () => {
  it("só aceita os idiomas do produto", () => {
    expect(isLocale("pt-BR")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("pt")).toBe(false);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
