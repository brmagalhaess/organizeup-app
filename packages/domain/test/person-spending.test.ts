import { describe, expect, it } from "vitest";
import { entryPerson, spendingByPerson, type OwnerBook } from "../src/person-spending";

const owners: OwnerBook = {
  accounts: { xp: "bruno", nu: "ana" },
  cards: { visa: "ana" },
  incomes: { salario: "bruno" },
  statements: { pagamento: "visa" },
};

describe("de quem é o lançamento", () => {
  it("herda a pessoa da conta em que caiu", () => {
    expect(entryPerson({ key: "t:1", accountId: "xp" }, owners)).toBe("bruno");
    expect(entryPerson({ key: "p:9", accountId: "nu" }, owners)).toBe("ana");
    // Conta sem dono é de uso comum.
    expect(entryPerson({ key: "t:2", accountId: "casa" }, owners)).toBeNull();
  });

  it("a fatura é de quem é o cartão, mesmo saindo da conta de outra pessoa", () => {
    const entry = { key: "f:visa:2026-11", accountId: "xp" };
    expect(entryPerson(entry, owners)).toBe("ana");
    // Já paga: o lançamento do pagamento continua sendo do cartão.
    expect(entryPerson({ key: "t:pagamento", accountId: "xp" }, owners)).toBe("ana");
    // A parte de aporte separada da fatura segue a fatura.
    expect(entryPerson({ key: "f:visa:2026-11#cat:4", accountId: "xp" }, owners)).toBe("ana");
    expect(entryPerson({ key: "t:pagamento#cat:4", accountId: "xp" }, owners)).toBe("ana");
    // Cartão sem dono: vale a conta que paga.
    expect(entryPerson({ key: "f:outro:2026-11", accountId: "xp" }, owners)).toBe("bruno");
  });

  it("a renda prevista é de quem é a fonte de renda", () => {
    const entry = { key: "r:salario:2026-11:salario", accountId: "nu" };
    expect(entryPerson(entry, owners)).toBe("bruno");
    expect(entryPerson({ ...entry, key: "r:outra:2026-11:salario" }, owners)).toBe("ana");
  });
});

describe("gastos por pessoa", () => {
  const spend = (
    personId: string | null,
    amount: string,
    status: "previsto" | "realizado" = "realizado",
  ) => ({
    personId,
    flow: "despesa",
    status,
    amount,
  });

  it("soma o que cada pessoa gastou, da que mais gastou para a que menos gastou", () => {
    const rows = spendingByPerson([
      spend("bruno", "100.00"),
      spend("ana", "250.00"),
      spend("bruno", "50.00"),
      spend("ana", "80.00", "previsto"),
      spend(null, "100.00"),
    ]);
    expect(rows).toEqual([
      { personId: "ana", spent: "250.00", planned: "80.00", share: 50 },
      { personId: "bruno", spent: "150.00", planned: "0.00", share: 30 },
      // Uso comum vem por último, mesmo gastando mais que alguém.
      { personId: null, spent: "100.00", planned: "0.00", share: 20 },
    ]);
  });

  it("aporte, resgate e receita não são gasto", () => {
    const rows = spendingByPerson([
      { personId: "bruno", flow: "aporte", status: "realizado", amount: "800.00" },
      { personId: "bruno", flow: "receita", status: "realizado", amount: "7500.00" },
      { personId: "bruno", flow: "resgate", status: "realizado", amount: "200.00" },
      spend("bruno", "10.00"),
    ]);
    expect(rows).toEqual([{ personId: "bruno", spent: "10.00", planned: "0.00", share: 100 }]);
  });

  it("quem só tem despesa prevista aparece com fatia zero, e mês vazio não tem linha", () => {
    expect(spendingByPerson([spend("ana", "60.00", "previsto")])).toEqual([
      { personId: "ana", spent: "0.00", planned: "60.00", share: 0 },
    ]);
    expect(spendingByPerson([])).toEqual([]);
  });
});
