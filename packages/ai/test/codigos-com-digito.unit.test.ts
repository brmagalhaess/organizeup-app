// Código com dígito na raiz é ativo como qualquer outro: a dica é barrada, e a resposta leva o aviso da CVM.
import { describe, expect, it } from "vitest";
import { rejectionOf } from "../src/insights/verify";
import { mentionsInvestment } from "../src/verify";

const privacy = { scrub: (text: string) => text } as Parameters<typeof rejectionOf>[2];

describe("códigos com dígito", () => {
  it.each(["PETR4", "B3SA3", "M1TA34"])("%s não sai em dica", (ticker) => {
    expect(rejectionOf(`Olhe ${ticker} com calma.`, [], privacy)).toBe("ativo");
  });

  it.each(["PETR4", "B3SA3", "M1TA34"])("%s leva o aviso da CVM", (ticker) => {
    expect(mentionsInvestment(`${ticker} subiu.`)).toBe(true);
  });

  it("texto comum continua livre", () => {
    expect(mentionsInvestment("Você gastou no mercado em 2026")).toBe(false);
    expect(rejectionOf("Você gastou menos neste mês.", [], privacy)).toBeNull();
  });
});
