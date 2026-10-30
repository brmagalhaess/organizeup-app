import { describe, expect, it } from "vitest";
import { findPersonalData, memorySchema, reportSchema } from "./ops-content";

describe("barreira de dados pessoais", () => {
  it.each([
    ["contato: maria@gmail.com", "e-mail"],
    ["cliente 123.456.789-09 reclamou", "CPF"],
    ["empresa 12.345.678/0001-95", "CNPJ"],
    ["ligar para (11) 91234-5678", "telefone"],
    ["cartão 4111 1111 1111 1111", "cartão"],
  ])("recusa %s", (text, label) => {
    expect(findPersonalData(text)).toBe(label);
  });

  it.each([
    "teste com ana@example.com",
    "o deploy df631f1 subiu às 12:48",
    "2 erros em 1234 requisições, migração 0010",
    "valor de R$ 1.234,56 na fixture",
  ])("aceita %s", (text) => {
    expect(findPersonalData(text)).toBeNull();
  });
});

describe("validação", () => {
  const memory = { agent: "sre", kind: "licao", content: "Reiniciar o worker resolve a fila." };

  it("aceita memória válida", () => {
    expect(memorySchema.safeParse(memory).success).toBe(true);
  });

  it("recusa agente com nome inválido e tipo desconhecido", () => {
    expect(memorySchema.safeParse({ ...memory, agent: "SRE!" }).success).toBe(false);
    expect(memorySchema.safeParse({ ...memory, kind: "outro" }).success).toBe(false);
  });

  it("recusa memória com dado pessoal e diz o motivo", () => {
    const result = memorySchema.safeParse({ ...memory, content: "falar com joao@gmail.com" });
    expect(result.error?.issues[0]?.message).toContain("e-mail");
  });

  it("recusa relatório com dado pessoal no corpo", () => {
    const report = {
      kind: "saude",
      period: "2026-10-30",
      agent: "sre",
      title: "Tudo certo",
      body: "CPF 123.456.789-09",
    };
    expect(reportSchema.safeParse(report).success).toBe(false);
  });
});
