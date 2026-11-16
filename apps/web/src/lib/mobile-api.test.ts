import type { MonthEntry } from "@organizeup/domain";
import { describe, expect, it, vi } from "vitest";
import { moneyTextFor } from "@/i18n/format";

// A sessão depende de cabeçalhos do Next; aqui só interessam as funções puras.
vi.mock("server-only", () => ({}));
vi.mock("./session", () => ({ getSession: vi.fn(), platformFlags: vi.fn() }));

const { mobileEntry, mobileError, mobileJson } = await import("./mobile-api");

const entry: MonthEntry = {
  key: "t:1",
  source: "lancamento",
  id: "1",
  kind: "despesa",
  description: "Mercado",
  amount: "123.45",
  date: "2026-11-05",
  status: "realizado",
  categoryId: "c1",
  accountId: "a1",
  recurring: false,
};
const names = {
  categories: new Map([["c1", "Alimentação"]]),
  accounts: new Map([["a1", "Conta principal"]]),
};

describe("API do app", () => {
  it("o lançamento sai com o valor escrito na moeda e a data no idioma", () => {
    const out = mobileEntry(entry, moneyTextFor("pt-BR", "BRL"), "pt-BR", names);
    expect(out.amountText.replace(/\s/g, " ")).toBe("R$ 123,45");
    expect(out.dateText).toBe("05/11");
    expect(out.category).toBe("Alimentação");
    expect(out.account).toBe("Conta principal");
    // O número cru não vai para o app: ele não faz conta com dinheiro.
    expect(out).not.toHaveProperty("amount");
  });

  it("em inglês, a data inverte e o valor segue a moeda da família", () => {
    const out = mobileEntry(entry, moneyTextFor("en", "USD"), "en", names);
    expect(out.dateText).toBe("11/05");
    expect(out.amountText).toContain("123.45");
  });

  it("categoria ou conta que sumiu vira null, sem derrubar a lista", () => {
    const out = mobileEntry({ ...entry, categoryId: "x", accountId: "y" }, String, "pt-BR", names);
    expect(out.category).toBeNull();
    expect(out.account).toBeNull();
  });

  it("erro tem código, e nenhuma resposta fica em cache", async () => {
    const response = mobileError("no_family", 409);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "no_family" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mobileJson({ ok: true }).headers.get("cache-control")).toBe("no-store");
  });
});
