// Nome de lugar: a mesma comparação na busca, na hora de gravar a intenção e na conta do agente (ADR-0026).
import { describe, expect, it } from "vitest";
import { destinationNamed, normalizePlace, searchDestinations } from "../src";

// Como na tabela real: o país é o código ISO.
const catalog = [
  { id: "lisboa", name: "Lisboa", country: "PT" },
  { id: "florianopolis", name: "Florianópolis", country: "BR" },
  { id: "foz-do-iguacu", name: "Foz do Iguaçu", country: "BR" },
  { id: "toquio", name: "Tóquio", country: "JP" },
  { id: "nova-york", name: "Nova York", country: "US" },
  { id: "orlando", name: "Orlando", country: "US" },
];

const ids = (query: string, limit?: number) =>
  searchDestinations(catalog, query, limit).map((row) => row.id);

describe("normalizePlace", () => {
  it("ignora acento, caixa e espaço sobrando", () => {
    expect(normalizePlace("  FLORIANÓPOLIS ")).toBe("florianopolis");
    expect(normalizePlace("Foz  do Iguaçu")).toBe("foz do iguacu");
    expect(normalizePlace("Tóquio")).toBe("toquio");
  });

  it("caractere invisível não cria outro nome", () => {
    expect(normalizePlace("Lis​boa")).toBe("lisboa");
  });
});

describe("destinationNamed", () => {
  it("acha o destino por qualquer grafia do nome inteiro", () => {
    for (const name of ["Lisboa", "lisboa", " LISBOA ", "Lisbôa", "LÍSBOA"]) {
      expect(destinationNamed(name, catalog)?.id, name).toBe("lisboa");
    }
    expect(destinationNamed("foz do iguacu", catalog)?.id).toBe("foz-do-iguacu");
  });

  it("parte do nome não é o mesmo lugar", () => {
    expect(destinationNamed("Nova", catalog)).toBeUndefined();
    expect(destinationNamed("Lisboa e arredores", catalog)).toBeUndefined();
    expect(destinationNamed("", catalog)).toBeUndefined();
  });
});

describe("searchDestinations", () => {
  it("acha pelo nome, sem diferenciar acento", () => {
    expect(ids("florianopolis")).toEqual(["florianopolis"]);
    expect(ids("TOQUIO")).toEqual(["toquio"]);
  });

  it("acha pelo país, escrito por extenso, nos idiomas do produto", () => {
    expect(ids("Portugal")).toEqual(["lisboa"]);
    expect(ids("japao")).toEqual(["toquio"]);
    expect(ids("Japan")).toEqual(["toquio"]);
    expect(ids("Japón")).toEqual(["toquio"]);
    expect(ids("brasil")).toEqual(["florianopolis", "foz-do-iguacu"]);
    expect(ids("Brazil")).toEqual(["florianopolis", "foz-do-iguacu"]);
    expect(ids("estados unidos")).toEqual(["nova-york", "orlando"]);
    expect(ids("United States")).toEqual(["nova-york", "orlando"]);
  });

  it("acha pela sigla que as pessoas digitam", () => {
    expect(ids("EUA")).toEqual(["nova-york", "orlando"]);
    expect(ids("USA")).toEqual(["nova-york", "orlando"]);
  });

  it("o código do país não é busca: 'es' não traz tudo que tem país ES", () => {
    expect(ids("PT")).not.toContain("toquio");
    expect(ids("JP")).toEqual([]);
  });

  it("menos de duas letras não busca, e o limite vale", () => {
    expect(ids("l")).toEqual([]);
    expect(ids("  ")).toEqual([]);
    expect(ids("brasil", 1)).toEqual(["florianopolis"]);
  });
});
