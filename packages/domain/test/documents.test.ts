import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  accountFeatures,
  cnpjCheckDigits,
  cpfCheckDigits,
  findDocuments,
  formatCnpj,
  formatCpf,
  isValidCnpj,
  isValidCpf,
  maskCnpj,
  maskCpf,
  maskDocuments,
  normalizeCnpj,
  normalizeCpf,
  parseIdentity,
  parseInviteeIdentity,
} from "../src/documents";

// Fictícios. CPF começando em 000 fica fora das faixas em uso; o exemplo de CNPJ é o da Receita Federal.
const CPF = "00000000191";
const CPF_B = "00000000272";
/** 12.ABC.345/01DE-35: exemplo oficial, com somas 459 e 424 nos dois dígitos. */
const CNPJ_ALFA = "12ABC34501DE35";
const CNPJ_NUM = `00000000000191`;

const digit = fc.integer({ min: 0, max: 9 }).map(String);
const alnum = fc.constantFrom(..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ");
const join = (chars: string[]) => chars.join("");
const notRepeated = (value: string) => new Set(value).size > 1;

const cpfArb = fc
  .array(digit, { minLength: 9, maxLength: 9 })
  .map(join)
  .filter(notRepeated)
  .map((base) => base + cpfCheckDigits(base));
const cnpjArb = fc
  .array(alnum, { minLength: 12, maxLength: 12 })
  .map(join)
  .map((base) => base + cnpjCheckDigits(base))
  .filter(notRepeated);

describe("CPF", () => {
  it.each([CPF, CPF_B, "000.000.001-91", " 000 000 001 91 "])("aceita %s", (input) => {
    expect(isValidCpf(input)).toBe(true);
  });

  it.each([
    ["dígito errado", "00000000192"],
    ["outro dígito errado", "00000000181"],
    ["curto", "0000000019"],
    ["longo", "000000001911"],
    ["vazio", ""],
    ["com letra", "0000000019A"],
    ["com letras", "abc.def.ghi-jk"],
    ["repetido", "111.111.111-11"],
    ["zerado", "00000000000"],
  ])("recusa %s", (_name, input) => {
    expect(isValidCpf(input)).toBe(false);
  });

  it.each([...Array(10).keys()].map((n) => String(n).repeat(11)))("recusa repetido %s", (input) => {
    expect(normalizeCpf(input)).toBeNull();
  });

  it("calculado é válido, com ou sem máscara", () => {
    fc.assert(
      fc.property(cpfArb, (cpf) => {
        expect(normalizeCpf(cpf)).toBe(cpf);
        expect(normalizeCpf(formatCpf(cpf))).toBe(cpf);
      }),
    );
  });

  // Só nos verificadores: nos 9 primeiros, o módulo 11 leva os restos 0 e 1 ao mesmo dígito, e uma troca rara
  // ainda fecha a conta. É limite da regra da Receita, que nenhum validador resolve.
  it("trocar um dígito verificador nunca passa", () => {
    fc.assert(
      fc.property(
        cpfArb,
        fc.integer({ min: 9, max: 10 }),
        fc.integer({ min: 1, max: 9 }),
        (cpf, position, shift) => {
          const changed = String((Number(cpf[position]) + shift) % 10);
          const wrong = cpf.slice(0, position) + changed + cpf.slice(position + 1);
          expect(isValidCpf(wrong)).toBe(false);
        },
      ),
    );
  });

  it.each(["00000000291", "01000000191", "00000100191", "10000000191"])(
    "recusa dígito trocado no meio: %s",
    (input) => {
      expect(isValidCpf(input)).toBe(false);
    },
  );

  it("máscara esconde o começo e o fim", () => {
    expect(formatCpf(CPF)).toBe("000.000.001-91");
    expect(maskCpf("12345678909")).toBe("***.456.789-**");
  });
});

describe("CNPJ", () => {
  it("o exemplo da Receita Federal fecha", () => {
    expect(cnpjCheckDigits("12ABC34501DE")).toBe("35");
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
  });

  it.each([CNPJ_NUM, "00.000.000/0001-91", CNPJ_ALFA, "12abc34501de35", "12.abc.345/01de-35"])(
    "aceita %s",
    (input) => {
      expect(isValidCnpj(input)).toBe(true);
    },
  );

  it("guarda em maiúsculas", () => {
    expect(normalizeCnpj("12.abc.345/01de-35")).toBe(CNPJ_ALFA);
  });

  it.each([
    ["dígito errado", "12ABC34501DE36"],
    ["letra errada", "12ABD34501DE35"],
    ["letra no dígito verificador", "12ABC34501DE3A"],
    ["numérico com dígito errado", "00000000000192"],
    ["curto", "12ABC34501DE3"],
    ["longo", "12ABC34501DE350"],
    ["acento", "12ÁBC34501DE35"],
    ["vazio", ""],
    ["repetido", "11.111.111/1111-11"],
    ["zerado", "00.000.000/0000-00"],
  ])("recusa %s", (_name, input) => {
    expect(isValidCnpj(input)).toBe(false);
  });

  it("calculado é válido, com ou sem máscara", () => {
    fc.assert(
      fc.property(cnpjArb, (cnpj) => {
        expect(normalizeCnpj(cnpj)).toBe(cnpj);
        expect(normalizeCnpj(formatCnpj(cnpj))).toBe(cnpj);
        expect(normalizeCnpj(cnpj.toLowerCase())).toBe(cnpj);
      }),
    );
  });

  it("trocar um dígito verificador nunca passa", () => {
    fc.assert(
      fc.property(
        cnpjArb,
        fc.integer({ min: 12, max: 13 }),
        fc.integer({ min: 1, max: 9 }),
        (cnpj, at, shift) => {
          const changed = String((Number(cnpj[at]) + shift) % 10);
          expect(isValidCnpj(cnpj.slice(0, at) + changed + cnpj.slice(at + 1))).toBe(false);
        },
      ),
    );
  });

  it("máscara esconde o começo e os dígitos verificadores", () => {
    expect(formatCnpj(CNPJ_ALFA)).toBe("12.ABC.345/01DE-35");
    expect(maskCnpj(CNPJ_ALFA)).toBe("**.ABC.345/01DE-**");
  });
});

describe("achar documento em texto livre", () => {
  const masked = (text: string) => maskDocuments(text, "[d]");
  // Valores só com dígito verificador certo, com ou sem o exemplo da Receita.
  const FULL_WIDTH_CPF = [..."12345678909"]
    .map((char) => String.fromCodePoint(0xff10 + Number(char)))
    .join("");
  const ARABIC_CPF = [..."12345678909"]
    .map((char) => String.fromCodePoint(0x0660 + Number(char)))
    .join("");

  it.each([
    "123.456.789-09",
    "12345678909",
    "123456789-09",
    "123 456 789 09",
    "123.456.789.09",
    "123-456-789-09",
    "123/456/789-09",
    "123,456,789-09",
    "123_456_789_09",
    "123.456.789–09",
    "123.456.789—09",
    "123.456.789‑09",
    "123​456​789​09",
    "1‍2‍3‍4‍5‍6‍7‍8‍9‍0‍9",
    FULL_WIDTH_CPF,
    ARABIC_CPF,
    "1 2 3 4 5 6 7 8 9 0 9",
    "123.456.789 - 09",
    "123 . 456 . 789 - 09",
  ])("acha CPF em %j", (cpf) => {
    expect(masked(`cpf ${cpf} fim`)).toBe("cpf [d] fim");
    expect(findDocuments(cpf)).toMatchObject([{ kind: "cpf" }]);
  });

  it.each([
    ["CPF.123.456.789-09", "CPF.[d]"],
    ["doc.12345678909", "doc.[d]"],
    ["CPF:12345678909.", "CPF:[d]."],
    ["CPF12345678909", "CPF[d]"],
    ["PIX12345678909X", "PIX[d]X"],
    ["12345678909.5", "[d].5"],
    ["123.456.789-09.5", "[d].5"],
    ["123.456.789-09.", "[d]."],
    ["(123.456.789-09)", "([d])"],
    ["x123.456.789-09", "x[d]"],
  ])("acha CPF colado: %j", (text, expected) => {
    expect(masked(text)).toBe(expected);
  });

  it.each([
    "11.222.333/0001-81",
    "11222333000181",
    "11222333/0001-81",
    "11.222.333/000181",
    "11.222.333.0001-81",
    "11 222 333 0001 81",
    "11.222.333/0001 81",
    "11-222-333/0001-81",
    "11.222.333/0001.81",
    "11.222.333/0001–81",
    "12.ABC.345/01DE-35",
    "12ABC34501DE35",
    "12abc34501de35",
    "12.abc.345/01de-35",
    "12ABC345/01DE-35",
    "12 ABC 345 01DE 35",
  ])("acha CNPJ em %j", (cnpj) => {
    expect(masked(`cnpj ${cnpj} fim`)).toBe("cnpj [d] fim");
    expect(findDocuments(cnpj)).toMatchObject([{ kind: "cnpj" }]);
  });

  it.each([
    ["CNPJ11222333000181", "CNPJ[d]"],
    ["PIX11222333000181X", "PIX[d]X"],
    ["CNPJ12ABC34501DE35", "CNPJ[d]"],
  ])("acha CNPJ colado: %j", (text, expected) => {
    expect(masked(text)).toBe(expected);
  });

  it("acha mais de um documento, cercados de valor", () => {
    expect(masked("R$ 500,00 para 123.456.789-09 e 11.222.333/0001-81 em 01/11/2026")).toBe(
      "R$ 500,00 para [d] e [d] em 01/11/2026",
    );
  });

  it.each([
    "R$ 1.234,56",
    "R$ 1.234.567,89",
    "1234,56",
    "1,234.56",
    "12345.67",
    "12345678909.00",
    "100,00 200,00 300,00 400,00",
    "1.234,56 7.890,12 3.456,78",
    "10.50 20.25 30.75 40.10 50.60",
    "US$ 1,234.56",
    "2026-10-31",
    "01/11/2026 02/11/2026 03/11/2026",
    "2026-10-31 2026-11-01",
    "6f1c2b8e-3a4d-4e5f-9a7b-1c2d3e4f5a6b",
    "E60746948202611011230s12345678901",
    "20261101000012345678",
    "123456789012",
    "1234567890123456",
    "4111 1111 1111 1111",
    "MERCADOLIVRE12 compra",
    "PAGTO CONTA LUZ 12",
    "TRANSFERENCIA PIX RECEBIDA 26",
    "12:30:45",
  ])("deixa em paz %j", (text) => {
    expect(findDocuments(text)).toEqual([]);
  });

  it("identificadores aleatórios não viram documento", () => {
    fc.assert(
      fc.property(fc.uuid(), (id) => {
        expect(findDocuments(id)).toEqual([]);
      }),
    );
    fc.assert(
      fc.property(fc.array(alnum, { minLength: 21, maxLength: 40 }).map(join), (id) => {
        const hit = findDocuments(id).some((span) => /[A-Z]/.test(id.slice(span.start, span.end)));
        expect(hit).toBe(false);
      }),
    );
  });

  it("valor em dinheiro nunca vira documento", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 99_999_999 }), { minLength: 2, maxLength: 6 }),
        (cents) => {
          const list = cents
            .map((value) => `${Math.floor(value / 100)},${String(value % 100).padStart(2, "0")}`)
            .join(" ");
          expect(findDocuments(list)).toEqual([]);
        },
      ),
    );
  });

  it("todo CPF e CNPJ gerado é achado, em qualquer pontuação", () => {
    fc.assert(
      fc.property(cpfArb, cnpjArb, fc.constantFrom(".", "-", " ", "/", "​"), (cpf, cnpj, sep) => {
        const spacedCpf = `${cpf.slice(0, 3)}${sep}${cpf.slice(3, 6)}${sep}${cpf.slice(6, 9)}${sep}${cpf.slice(9)}`;
        expect(masked(`a ${spacedCpf} b`)).toBe("a [d] b");
        expect(masked(`a ${formatCnpj(cnpj)} b`)).toBe("a [d] b");
      }),
    );
  });
});

describe("recursos por tipo de conta", () => {
  it("família tem parentesco, casamento e dependentes; empresa tem participação", () => {
    expect(accountFeatures("pf")).toEqual({
      relations: true,
      wedding: true,
      dependents: true,
      ownership: false,
      inviteAsksCpf: false,
    });
    expect(accountFeatures("pj")).toEqual({
      relations: false,
      wedding: false,
      dependents: false,
      ownership: true,
      inviteAsksCpf: true,
    });
  });
});

describe("parseIdentity", () => {
  it("fora do Brasil não pede documento e ignora o que vier junto", () => {
    expect(parseIdentity({ inBrazil: false, cpf: CPF, personType: "pj" })).toEqual({
      ok: true,
      value: { inBrazil: false, personType: null, cpf: null, cnpj: null, companyName: null },
    });
  });

  it("pessoa física precisa de CPF válido", () => {
    const raw = { inBrazil: true, personType: "pf", cnpj: CNPJ_ALFA, companyName: "Empresa" };
    expect(parseIdentity({ ...raw, cpf: "000.000.001-91" })).toEqual({
      ok: true,
      value: { inBrazil: true, personType: "pf", cpf: CPF, cnpj: null, companyName: null },
    });
    expect(parseIdentity({ ...raw, cpf: "00000000192" })).toEqual({ ok: false, fields: ["cpf"] });
    expect(parseIdentity({ ...raw, cpf: "" })).toEqual({ ok: false, fields: ["cpf"] });
  });

  it("pessoa jurídica precisa de CNPJ, razão social e CPF do responsável", () => {
    const raw = {
      inBrazil: true,
      personType: "pj",
      cpf: CPF,
      cnpj: CNPJ_ALFA,
      companyName: "  Comércio   Exemplo  Ltda ",
    };
    expect(parseIdentity(raw)).toEqual({
      ok: true,
      value: {
        inBrazil: true,
        personType: "pj",
        cpf: CPF,
        cnpj: CNPJ_ALFA,
        companyName: "Comércio Exemplo Ltda",
      },
    });
    expect(parseIdentity({ ...raw, cpf: "" })).toEqual({ ok: false, fields: ["cpf"] });
    expect(parseIdentity({ ...raw, cnpj: "12ABC34501DE36" })).toEqual({
      ok: false,
      fields: ["cnpj"],
    });
    expect(parseIdentity({ ...raw, companyName: " " })).toEqual({
      ok: false,
      fields: ["companyName"],
    });
    expect(parseIdentity({ ...raw, companyName: "x".repeat(151) })).toEqual({
      ok: false,
      fields: ["companyName"],
    });
    expect(parseIdentity({ inBrazil: true, personType: "pj" })).toEqual({
      ok: false,
      fields: ["cnpj", "companyName", "cpf"],
    });
  });

  it.each([null, undefined, "pf", {}, { inBrazil: "sim" }, { inBrazil: true }])(
    "recusa formato inesperado: %j",
    (raw) => {
      expect(parseIdentity(raw)).toEqual({ ok: false, fields: ["choice"] });
    },
  );

  it("convite é sempre de pessoa, mesmo que o formulário peça empresa", () => {
    const raw = {
      inBrazil: true,
      personType: "pj",
      cpf: CPF,
      cnpj: CNPJ_ALFA,
      companyName: "Outra",
    };
    expect(parseInviteeIdentity(raw)).toEqual({
      ok: true,
      value: { inBrazil: true, personType: "pf", cpf: CPF, cnpj: null, companyName: null },
    });
    expect(parseInviteeIdentity({ inBrazil: false, personType: "pj" })).toMatchObject({
      ok: true,
      value: { inBrazil: false, personType: null },
    });
    expect(parseInviteeIdentity({ inBrazil: true, cpf: "1" })).toEqual({
      ok: false,
      fields: ["cpf"],
    });
    expect(parseInviteeIdentity(null)).toEqual({ ok: false, fields: ["choice"] });
  });

  it("o resultado nunca repete o que foi digitado quando falha", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (typed) => {
        const result = parseIdentity({ inBrazil: true, personType: "pf", cpf: typed });
        if (!result.ok) expect(JSON.stringify(result)).not.toContain(`"${typed}"`);
      }),
    );
  });
});
