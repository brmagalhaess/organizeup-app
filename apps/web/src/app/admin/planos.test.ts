import type { VipGrant } from "@organizeup/db";
import { describe, expect, it } from "vitest";
import {
  endOfDay,
  itemLabel,
  nearLimit,
  stripeStatusLabel,
  vipCostText,
  vipGiftText,
} from "./planos";

describe("perto do limite", () => {
  it("avisa em 80% e no limite, como a família vê", () => {
    expect(nearLimit(39, 50)).toBe("normal");
    expect(nearLimit(40, 50)).toBe("aviso");
    expect(nearLimit(50, 50)).toBe("limite");
  });

  it("sem limite, ou sem o recurso, não entra na lista", () => {
    expect(nearLimit(9_999, null)).toBe("normal");
    expect(nearLimit(0, 0)).toBe("normal");
  });
});

describe("textos", () => {
  const grant = (over: Partial<VipGrant>) =>
    ({
      fullAccess: false,
      modules: [],
      entryLimit: null,
      messageLimit: null,
      currencies: [],
      cost: "sem_custo",
      discountPercent: null,
      ...over,
    }) as VipGrant;

  it("nome de item conhecido, e o código quando não conhece", () => {
    expect(itemLabel("base:ilimitado")).toBe("Base, sem limite");
    expect(itemLabel("base:50")).toBe("Base, até 50 lançamentos");
    expect(itemLabel("modulo:dividas")).toBe("Dívidas");
    expect(itemLabel("moeda:USD")).toBe("Moeda adicional USD");
    expect(itemLabel("coisa:nova")).toBe("coisa:nova");
  });

  it("diz o que a concessão dá, sem prometer mensagem a quem não tem assistente", () => {
    expect(vipGiftText(grant({ fullAccess: true }))).toBe("Tudo liberado");
    expect(vipGiftText(grant({ modules: ["metas"], entryLimit: 200, messageLimit: 300 }))).toBe(
      "Metas e viagens, 200 lançamentos, 0 mensagens",
    );
    expect(vipCostText(grant({ cost: "desconto", discountPercent: 30 }))).toBe("Desconto de 30%");
  });

  it("situação da Stripe em português, e o código quando for nova", () => {
    expect(stripeStatusLabel("past_due")).toBe("Em atraso");
    expect(stripeStatusLabel(null)).toBe("Sem assinatura");
    expect(stripeStatusLabel("outra")).toBe("outra");
  });

  it("a validade vale até o fim do dia em Brasília", () => {
    expect(endOfDay("2026-11-02").toISOString()).toBe("2026-11-03T02:59:59.000Z");
  });
});
