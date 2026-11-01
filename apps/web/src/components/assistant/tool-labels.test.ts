import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ptBR from "../../../messages/pt-BR.json";
import { toolLabel } from "./tool-labels";

const toolsDir = path.resolve(import.meta.dirname, "../../../../../packages/ai/src/tools");
const sources = readdirSync(toolsDir)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => readFileSync(path.join(toolsDir, file), "utf8"))
  .join("\n");

describe("rótulos das ferramentas do assistente", () => {
  it("toda frase fixa de packages/ai tem chave, e o catálogo diz o mesmo", () => {
    const phrases = [...sources.matchAll(/label: \(\) => "([^"]+)"/g)].map((match) => match[1]!);
    expect(phrases.length).toBeGreaterThan(10);
    for (const phrase of phrases) {
      const label = toolLabel(phrase);
      expect(label, phrase).not.toBeNull();
      expect(ptBR.assistente.tools[label!.key]).toBe(phrase);
    }
  });

  it("frase com mês vira chave e mês", () => {
    const phrases = [
      ...sources.matchAll(/label: \(\{ mes \}\) => `([^$]+)\$\{monthWord\(mes\)\}`/g),
    ];
    expect(phrases.length).toBe(3);
    for (const [, phrase] of phrases) {
      expect(toolLabel(`${phrase} do mês`)?.key).toMatch(/Current$/);
      expect(toolLabel(`${phrase} de março de 2026`)).toMatchObject({ month: "2026-03" });
    }
  });

  it("o catálogo em português repete a frase com mês", () => {
    expect(ptBR.assistente.tools.summaryCurrent).toBe("olhei o resumo do mês");
    expect(ptBR.assistente.tools.summaryMonth).toBe("olhei o resumo de {month}");
  });

  it("frase desconhecida fica como veio", () => {
    expect(toolLabel("fiz outra coisa")).toBeNull();
    expect(toolLabel("olhei o resumo de abc de 2026")).toBeNull();
    expect(toolLabel("constructor")).toBeNull();
  });
});
