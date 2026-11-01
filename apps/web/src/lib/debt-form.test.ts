import { describe, expect, it, vi } from "vitest";

vi.mock("@organizeup/db", () => ({ DEBT_SYSTEMS: ["price", "sac", "manual"] }));

const { parseDebtTerms } = await import("./debt-form");

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const base = {
  system: "price",
  balance: "12.500,00",
  monthlyRate: "2,15",
  installments: "24",
  firstDueDate: "2027-01-10",
};

describe("valores da dívida", () => {
  it("converte o que a pessoa digitou", () => {
    expect(parseDebtTerms(form(base))).toEqual({
      ok: true,
      terms: {
        system: "price",
        balance: "12500.00",
        monthlyRate: "2.1500",
        installments: 24,
        firstDueDate: "2027-01-10",
      },
    });
  });

  it("parcela informada não usa saldo, nem um saldo que sobrou no formulário", () => {
    const result = parseDebtTerms(
      form({ ...base, system: "manual", balance: "lixo", installmentAmount: "450,00" }),
    );
    expect(result).toMatchObject({
      ok: true,
      terms: { system: "manual", balance: "0", installmentAmount: "450.00" },
    });
  });

  it("aponta o campo errado", () => {
    expect(parseDebtTerms(form({ ...base, balance: "", installments: "0" }))).toMatchObject({
      ok: false,
      fieldErrors: {
        balance: "Informe o saldo devedor, como 12.500,00.",
        installments: "Informe quantas parcelas faltam.",
      },
    });
  });
});
