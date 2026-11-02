// Chaves do sistema: o agente de IA trocou de nome, e quem o desligou antes continua com ele desligado.
import { describe, expect, it } from "vitest";
import { FLAG_KEYS, parsePlatformFlags } from "../src/access";

const row = (key: string, enabled: boolean) => ({ key, enabled, value: {} });
const OLD = FLAG_KEYS.agentOff("categorias_ia");
const NEW = FLAG_KEYS.agentOff("categorias-ia");

describe("agente desligado pelo nome antigo", () => {
  it("segue desligado com o nome novo", () => {
    expect(parsePlatformFlags([row(OLD, true)]).disabledAgents).toEqual(["categorias-ia"]);
  });

  it("religar pelo painel grava a chave nova, e ela vence a antiga", () => {
    expect(parsePlatformFlags([row(OLD, true), row(NEW, false)]).disabledAgents).toEqual([]);
  });

  it("as duas chaves ligadas contam uma vez só", () => {
    expect(parsePlatformFlags([row(OLD, true), row(NEW, true)]).disabledAgents).toEqual([
      "categorias-ia",
    ]);
  });

  it("os outros agentes não mudam", () => {
    const off = parsePlatformFlags([row(FLAG_KEYS.agentOff("metas"), true)]);
    expect(off.disabledAgents).toEqual(["metas"]);
  });
});
