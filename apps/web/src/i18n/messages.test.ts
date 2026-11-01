import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import ptBR from "../../messages/pt-BR.json";
import { LOCALES } from "./locales";
import { LAST_RESORT, messagesFor, withFallback } from "./messages";

type Tree = { [key: string]: string | Tree };

const catalogs: Record<string, Tree> = { en, es };

/** Todas as folhas, como "shell.nav.panel". */
function leaves(tree: Tree, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]): Array<[string, string]> => {
    const name = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[name, value]] : leaves(value, name);
  });
}

/** Variáveis, plurais e marcas de um texto: o que o código precisa passar. */
function placeholders(elements: MessageFormatElement[]): string[] {
  return elements.flatMap((element) => {
    switch (element.type) {
      case TYPE.argument:
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        return [element.value];
      case TYPE.plural:
      case TYPE.select:
        return [
          element.value,
          ...Object.values(element.options).flatMap((option) => placeholders(option.value)),
        ];
      case TYPE.tag:
        return [`<${element.value}>`, ...placeholders(element.children)];
      default:
        return [];
    }
  });
}

const variables = (text: string) => [...new Set(placeholders(parse(text)))].sort();

describe("catálogos", () => {
  it("existe um arquivo por idioma, e nenhum a mais", () => {
    const files = readdirSync(path.resolve(import.meta.dirname, "../../messages"));
    expect(files.sort()).toEqual(LOCALES.map((locale) => `${locale}.json`).sort());
  });

  const base = new Map(leaves(ptBR));

  it("português não tem texto vazio e todo texto é ICU válido", () => {
    for (const [key, text] of base) {
      expect(text.trim(), key).not.toBe("");
      expect(() => parse(text), key).not.toThrow();
    }
  });

  describe.each(Object.keys(catalogs))("%s", (locale) => {
    const own = new Map(leaves(catalogs[locale]!));

    it("tem exatamente as mesmas chaves do português", () => {
      expect([...own.keys()].sort()).toEqual([...base.keys()].sort());
    });

    it("não tem texto vazio", () => {
      for (const [key, text] of own) expect(text.trim(), key).not.toBe("");
    });

    it("tem as mesmas variáveis e marcas ICU em cada texto", () => {
      for (const [key, text] of own) {
        expect(variables(text), key).toEqual(variables(base.get(key) ?? ""));
      }
    });
  });
});

describe("fallback para o português", () => {
  const base = { a: { b: "Olá", c: "Tchau {name}" }, d: "Fim" };

  it("completa o que falta, inclusive grupo inteiro", () => {
    expect(withFallback(base, { a: { b: "Hi" } })).toEqual({
      a: { b: "Hi", c: "Tchau {name}" },
      d: "Fim",
    });
    expect(withFallback(base, {})).toEqual(base);
  });

  it("texto vazio conta como faltando", () => {
    expect(withFallback(base, { d: "" }).d).toBe("Fim");
    expect(withFallback(base, { d: "   " }).d).toBe("Fim");
  });

  it("ignora chave que não existe em português", () => {
    expect(withFallback(base, { sobra: "x" })).toEqual(base);
  });

  it("nada em inglês e espanhol sai como chave crua", () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale) as Tree;
      expect([...new Map(leaves(messages)).keys()].sort()).toEqual(
        leaves(ptBR)
          .map(([key]) => key)
          .sort(),
      );
    }
  });

  it("um texto que falta aparece em português na tela", () => {
    const t = createTranslator({
      locale: "en",
      messages: withFallback({ shell: { add: "Lançar" } }, {}),
      namespace: "shell",
    } as never) as unknown as (key: string) => string;
    expect(t("add")).toBe("Lançar");
  });

  it("nem o último recurso é chave crua ou vazio", () => {
    expect(LAST_RESORT).not.toBe("");
    const t = createTranslator({
      locale: "en",
      messages: {},
      onError: () => {},
      getMessageFallback: () => LAST_RESORT,
    } as never) as unknown as (key: string) => string;
    expect(t("shell.nav.semTraducao")).toBe(LAST_RESORT);
  });
});

describe("textos em português de sempre", () => {
  it("guarda alguns textos que os e2e e a família conhecem", () => {
    expect(ptBR.shell.nav.panel).toBe("Painel");
    expect(ptBR.auth.signIn.title).toBe("Bem-vindo de volta");
    expect(ptBR.auth.signUp.terms).toContain("Li e aceito os");
    expect(ptBR.settings.title).toBe("Configurações");
    expect(ptBR.common.close).toBe("Fechar");
  });
});

// Nada de texto solto no código das telas traduzidas: o catálogo é o único lugar.
describe("telas traduzidas", () => {
  const read = (file: string) =>
    readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

  it.each([
    "components/shell/app-shell.tsx",
    "app/app/(painel)/page.tsx",
    "app/app/(painel)/cashflow-chart.tsx",
    "app/(auth)/entrar/page.tsx",
    "app/app/(painel)/configuracoes/page.tsx",
  ])("%s não tem pt-BR escrito no código", (file) => {
    expect(read(file)).not.toContain('"pt-BR"');
  });

  const sourceFiles = (dir: string): string[] =>
    readdirSync(path.resolve(import.meta.dirname, "..", dir)).flatMap((name) => {
      const file = `${dir}/${name}`;
      if (statSync(path.resolve(import.meta.dirname, "..", file)).isDirectory()) {
        return sourceFiles(file);
      }
      return /\.tsx?$/.test(name) && !name.includes(".test.") ? [file] : [];
    });

  it.each(
    [
      "app/app/(painel)/plano",
      "app/app/(painel)/reserva",
      "app/app/(painel)/patrimonio",
      "app/app/(painel)/investimentos",
      "app/app/(painel)/proventos",
      "app/app/(painel)/metas",
      "app/app/(painel)/aposentadoria",
      "app/app/(painel)/viagens",
      "app/app/(painel)/familia",
    ].flatMap(sourceFiles),
  )("%s usa o idioma da pessoa", (file) => {
    const source = read(file);
    expect(source).not.toContain('"pt-BR"');
    expect(source).not.toMatch(/\b(parseBRL|formatBRL|formatBRLCompact|formatBRLShort)\b/);
  });
});
