import { describe, expect, it } from "vitest";
import { expandWipeScopes, isWipeScope, WIPE_REQUIRES, WIPE_SCOPES } from "../src/wipe";

describe("limpeza de dados por módulo", () => {
  it("módulo sozinho fica sozinho, na ordem canônica", () => {
    expect(expandWipeScopes(["viagens", "lancamentos"])).toEqual(["lancamentos", "viagens"]);
    expect(expandWipeScopes([])).toEqual([]);
  });

  it("contas puxa quem aponta para contas e categorias", () => {
    expect(expandWipeScopes(["contas"])).toEqual([
      "lancamentos",
      "cartoes",
      "renda",
      "dividas",
      "metas",
      "patrimonio",
      "contas",
    ]);
  });

  it("a conexão com bancos é um módulo e ninguém a leva junto", () => {
    expect(WIPE_SCOPES).toContain("conexao");
    expect(expandWipeScopes(["conexao"])).toEqual(["conexao"]);
    // Quem limpa contas e categorias não perde a chave do banco sem pedir.
    expect(expandWipeScopes(["contas"])).not.toContain("conexao");
  });

  it("repetição não muda nada e todo requisito é um módulo conhecido", () => {
    expect(expandWipeScopes(["metas", "metas", "contas"])).toEqual(expandWipeScopes(["contas"]));
    for (const list of Object.values(WIPE_REQUIRES)) {
      for (const scope of list) expect(WIPE_SCOPES).toContain(scope);
    }
    expect(isWipeScope("renda")).toBe(true);
    expect(isWipeScope("tudo")).toBe(false);
    expect(isWipeScope(3)).toBe(false);
  });
});
