import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ptBR from "../../messages/pt-BR.json";
import { knownText } from "./known-text";

const src = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(src, "../../..");
const read = (file: string) => readFileSync(path.resolve(src, file), "utf8");
const readRepo = (file: string) => readFileSync(path.resolve(repo, file), "utf8");

/** Todos os arquivos de tela de uma pasta, sem os testes. */
function screenFiles(folder: string): string[] {
  return readdirSync(path.resolve(src, folder)).flatMap((name) => {
    const file = `${folder}/${name}`;
    if (statSync(path.resolve(src, file)).isDirectory()) return screenFiles(file);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [file] : [];
  });
}

const translated = [
  ...[
    "lancamentos",
    "contas",
    "cartoes",
    "dividas",
    "categorias",
    "importar",
    "renda",
    "calendario",
    "sugestoes",
  ].flatMap((folder) => screenFiles(`app/app/(painel)/${folder}`)),
  ...screenFiles("app/app/(inicio)"),
  "components/shell/entry-form.tsx",
  "components/shell/entry-context.tsx",
  "components/fx-note.tsx",
  "components/confirm-entry-button.tsx",
];

describe("telas do dia a dia", () => {
  it.each(translated)("%s segue o idioma da pessoa", (file) => {
    const code = read(file);
    expect(code).not.toContain('"pt-BR"');
    expect(code).not.toMatch(/\b(formatBRL|formatBRLShort|parseBRL|formatYearMonth)\(/);
  });
});

describe("texto pronto em português", () => {
  it("vira o do idioma da pessoa pela chave", () => {
    const base = { a: "Olá", b: "Tchau" };
    expect(knownText("Tchau", base, { a: "Hi", b: "Bye" })).toBe("Bye");
  });

  it("desconhecido ou sem tradução segue em português", () => {
    expect(knownText("Outra coisa", { a: "Olá" }, { a: "Hi" })).toBe("Outra coisa");
    expect(knownText("Olá", { a: "Olá" }, {})).toBe("Olá");
  });

  // Se a frase mudar no agente, a troca para de achar e a tela volta ao português sem avisar.
  const contains = (group: Record<string, string>, code: string, except: string[] = []) => {
    for (const [key, text] of Object.entries(group)) {
      if (!except.includes(key)) expect(code, key).toContain(text);
    }
  };

  it("as frases do catálogo são as que os agentes devolvem", () => {
    contains(ptBR.sugestoes.agent, readRepo("packages/agents/src/apply.ts"));
    const upload = [
      readRepo("packages/agents/src/debt-documents.ts"),
      readRepo("packages/domain/src/debt-file.ts"),
    ].join("\n");
    contains(ptBR.dividas.upload, upload, ["tooMany", "noFile"]);
  });

  it("as frases do catálogo são as dos esquemas de validação", () => {
    const code = [
      read("lib/onboarding.ts"),
      read("app/app/(inicio)/completar/actions.ts"),
      read("app/app/actions.ts"),
    ].join("\n");
    contains(ptBR.familiaOnboarding.errors, code);
  });

  it("texto em inglês não sobrou em português nas telas novas", () => {
    expect(en.lancamentos.form.save).toBe("Save transaction");
    expect(en.calendario.day.closes).toBe("{name} closes");
  });
});
