// Códigos da B3 com dígito na raiz (ADR-0029). Dependem da migração 0041 nas tabelas de mercado.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  guessAssetClass,
  isB3Ticker,
  normalizeTicker,
  parseBrokerageNotes,
  parseDividendFile,
} from "../src";

const csv = (text: string) => parseDividendFile({ format: "csv", text });

describe("6. códigos com dígito", () => {
  it("aceita B3SA3, BDR e ETF, com e sem fracionário", () => {
    for (const code of ["B3SA3", "M1TA34", "C2OL34", "A1AP34", "5GTK11", "B5P211", "IB5M11"]) {
      expect(normalizeTicker(code), code).toBe(code);
      expect(normalizeTicker(`${code}F`), code).toBe(code);
      expect(normalizeTicker(code.toLowerCase()), code).toBe(code);
      expect(isB3Ticker(code), code).toBe(true);
    }
  });

  it("segue recusando o que não é código", () => {
    for (const text of [
      "",
      "12345",
      "123456",
      "202611",
      "ABCD",
      "ABC123",
      "CPF123",
      "ANA12",
      "RUA10",
      "E2E123",
      "1A2B3",
      "A1B2C3",
      "AB12",
      "ABCD123",
      "B3SA",
      "João",
      "000.000.000-00",
    ]) {
      expect(normalizeTicker(text), text).toBeNull();
    }
    expect(isB3Ticker("abcd3")).toBe(false);
    expect(isB3Ticker("ABCD3F")).toBe(false);
  });

  it("nada mais muda: todo código só com letras dá o mesmo de antes", () => {
    const before = /^([A-Z]{4}[0-9]{1,2})F?$/;
    const letter = fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    const digit = fc.constantFrom(..."0123456789");
    const char = fc.oneof(letter, digit);
    fc.assert(
      fc.property(
        fc.array(letter, { minLength: 4, maxLength: 4 }),
        fc.array(digit, { minLength: 1, maxLength: 2 }),
        fc.boolean(),
        (root, end, fraction) => {
          const code = `${root.join("")}${end.join("")}`;
          expect(normalizeTicker(`${code}${fraction ? "F" : ""}`)).toBe(code);
        },
      ),
    );
    // O que a regra antiga aceitava continua aceito, e o que ela recusava só muda com dígito na raiz.
    fc.assert(
      fc.property(fc.array(char, { minLength: 1, maxLength: 7 }), (chars) => {
        const text = chars.join("");
        const old = before.exec(text)?.[1] ?? null;
        const now = normalizeTicker(text);
        if (old) expect(now).toBe(old);
        else if (now) expect(/\d/.test(now.slice(0, 4))).toBe(true);
      }),
    );
  });

  it("o tipo pelo final do código olha depois da raiz", () => {
    expect(guessAssetClass("B3SA3")).toBe("acao");
    expect(guessAssetClass("M1TA34")).toBe("etf_bdr");
    expect(guessAssetClass("5GTK11")).toBeNull();
  });

  it("a nota acha o código no título", () => {
    const parsed = parseBrokerageNotes([
      "NOTA DE NEGOCIACAO",
      "Nr. nota Folha Data pregao",
      "12345 1 05/03/2026",
      "CORRETORA EXEMPLO S.A. CNPJ 00.000.000/0001-00",
      "Negocios realizados",
      "Q Negociacao C/V Tipo mercado Prazo Especificacao do titulo Obs. Quantidade Preco Valor D/C",
      "1-BOVESPA C VISTA B3SA3 ON NM 100 10,00 1.000,00 D",
      "Resumo dos Negocios Resumo Financeiro",
      "Compras a vista 1.000,00 Taxa de liquidacao 0,25 D",
      "Emolumentos 0,05 D",
      "Taxa Operacional 0,00 D",
      "Impostos 0,00",
      "I.R.R.F. s/ operacoes, base R$0,00 0,00",
      "Outros 0,00 C",
      "Liquido para 09/03/2026 1.000,30 D",
    ]);
    expect(parsed.trades[0]).toMatchObject({ ticker: "B3SA3" });
  });

  it("a importação de proventos lê os dois", () => {
    const parsed = csv(
      "Data;Ativo;Tipo;Valor\n15/03/2026;B3SA3;Dividendo;10,00\n15/03/2026;M1TA34;Dividendo;1,00\n",
    );
    expect(parsed.rows.map((item) => item.ticker)).toEqual(["B3SA3", "M1TA34"]);
  });
});
