import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  pluggyAccounts,
  pluggyInvestments,
  pluggyKey,
  pluggyTransactions,
  PluggyError,
} from "./pluggy";

// Respostas no formato da API pública da Pluggy, com dados fictícios.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stub(handler: (url: URL, init: RequestInit) => Response) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetcher, calls };
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: unknown) => (error instanceof PluggyError ? error.code : "outro"),
  );

describe("cliente da Pluggy", () => {
  it("troca as chaves pela chave de sessão", async () => {
    const { fetcher, calls } = stub(() => json({ apiKey: "chave-de-sessao" }));
    await expect(pluggyKey("id", "segredo", { fetcher })).resolves.toBe("chave-de-sessao");
    expect(calls[0]!.url.href).toBe("https://api.pluggy.ai/auth");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      clientId: "id",
      clientSecret: "segredo",
    });
  });

  it("chave recusada vira erro de credenciais, sem ler o corpo", async () => {
    const { fetcher } = stub(() => json({ message: "dados da pessoa" }, 401));
    await expect(code(pluggyKey("id", "errado", { fetcher }))).resolves.toBe("credenciais");
  });

  it("traduz os erros das leituras em códigos", async () => {
    const at = (status: number) => stub(() => json({}, status)).fetcher;
    const read = (status: number) => code(pluggyAccounts("k", "item", { fetcher: at(status) }));
    await expect(read(401)).resolves.toBe("credenciais");
    await expect(read(403)).resolves.toBe("sem_acesso");
    await expect(read(404)).resolves.toBe("conexao");
    await expect(read(429)).resolves.toBe("limite");
    await expect(read(503)).resolves.toBe("rede");
    const broken = stub(() => new Response("<html>", { status: 200 })).fetcher;
    await expect(code(pluggyAccounts("k", "item", { fetcher: broken }))).resolves.toBe("resposta");
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(code(pluggyAccounts("k", "item", { fetcher: offline }))).resolves.toBe("rede");
  });

  it("lê contas e cartões, só com o final do número", async () => {
    const { fetcher, calls } = stub(() =>
      json({
        results: [
          {
            id: "conta-1",
            type: "BANK",
            subtype: "CHECKING_ACCOUNT",
            name: "Conta Corrente",
            marketingName: "Conta Digital",
            number: "0001/12345-6",
            currencyCode: "BRL",
            bankData: { transferNumber: "348/0001/12345-6" },
          },
          {
            id: "conta-2",
            type: "BANK",
            subtype: "SAVINGS_ACCOUNT",
            name: "Poupança",
            number: "9",
          },
          {
            id: "cartao-1",
            type: "CREDIT",
            subtype: "CREDIT_CARD",
            name: "Cartão Gold",
            number: "4321",
            creditData: { balanceCloseDate: null, balanceDueDate: "2026-11-01" },
          },
          { type: "BANK", name: "sem identificador" },
        ],
      }),
    );
    const accounts = await pluggyAccounts("chave", "item-1", { fetcher });
    expect(calls[0]!.url.searchParams.get("itemId")).toBe("item-1");
    expect(new Headers(calls[0]!.init.headers).get("X-API-KEY")).toBe("chave");
    expect(accounts).toEqual([
      {
        id: "conta-1",
        itemId: "item-1",
        kind: "corrente",
        name: "Conta Digital · 348",
        numberTail: "3456",
        currency: "BRL",
        closingDay: null,
        dueDay: null,
      },
      {
        id: "conta-2",
        itemId: "item-1",
        kind: "poupanca",
        name: "Poupança",
        numberTail: null,
        currency: "BRL",
        closingDay: null,
        dueDay: null,
      },
      {
        id: "cartao-1",
        itemId: "item-1",
        kind: "cartao",
        name: "Cartão Gold",
        numberTail: "4321",
        currency: "BRL",
        closingDay: null,
        dueDay: 1,
      },
    ]);
  });

  it("segue o cursor dos lançamentos até o fim", async () => {
    const { fetcher, calls } = stub((url) =>
      url.searchParams.get("after") === "c2"
        ? json({
            results: [{ id: "t2", date: "2026-11-04T00:00:00.000Z", type: "CREDIT", amount: 10 }],
            next: null,
          })
        : json({
            results: [
              {
                id: "t1",
                date: "2026-11-03T00:00:00.000Z",
                description: "MERCADO",
                type: "DEBIT",
                amount: -5,
                status: "POSTED",
              },
              { date: "2026-11-03T00:00:00.000Z" },
            ],
            next: "/v2/transactions?accountId=conta-1&after=c2",
          }),
    );
    const rows = await pluggyTransactions(
      "k",
      "conta-1",
      { from: "2026-11-01", to: "2026-11-11" },
      { fetcher },
    );
    expect(rows.map((row) => row.id)).toEqual(["t1", "t2"]);
    expect(rows[0]).toMatchObject({
      description: "MERCADO",
      type: "DEBIT",
      amount: -5,
      status: "POSTED",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.pathname).toBe("/v2/transactions");
    expect(calls[0]!.url.searchParams.get("dateFrom")).toBe("2026-11-01");
    expect(calls[1]!.url.searchParams.get("dateTo")).toBe("2026-11-11");
  });

  it("lê a parcela e o dia da compra nas linhas de cartão", async () => {
    const { fetcher } = stub(() =>
      json({
        results: [
          {
            id: "p1",
            date: "2026-10-30T03:00:00.000Z",
            description: "LOJA",
            type: "DEBIT",
            amount: 100,
            status: "POSTED",
            creditCardMetadata: {
              installmentNumber: 4,
              totalInstallments: 12,
              purchaseDate: "2026-07-29T03:00:00.000Z",
              billId: "fatura",
            },
          },
          {
            id: "p2",
            date: "2026-10-31T14:35:00.000Z",
            type: "DEBIT",
            amount: 20,
            creditCardMetadata: null,
          },
        ],
        next: null,
      }),
    );
    const rows = await pluggyTransactions(
      "k",
      "cartao-1",
      { from: "2026-10-01", to: "2026-11-11" },
      { fetcher },
    );
    expect(rows[0]).toMatchObject({
      installmentNumber: 4,
      totalInstallments: 12,
      purchaseDate: "2026-07-29T03:00:00.000Z",
    });
    expect(rows[1]).toMatchObject({
      installmentNumber: null,
      totalInstallments: null,
      purchaseDate: null,
    });
  });

  it("para quando o cursor se repete", async () => {
    const { fetcher, calls } = stub(() =>
      json({ results: [], next: "/v2/transactions?after=igual" }),
    );
    await pluggyTransactions("k", "conta-1", { from: "2026-11-01", to: "2026-11-11" }, { fetcher });
    expect(calls).toHaveLength(2);
  });

  it("lê todas as páginas de investimentos", async () => {
    const { fetcher, calls } = stub((url) =>
      json({
        totalPages: 2,
        results: [
          url.searchParams.get("page") === "1"
            ? {
                id: "i1",
                code: "PETR4",
                name: "PETROBRAS PN",
                type: "EQUITY",
                quantity: 100,
                value: 38.5,
                amount: 3850,
                amountOriginal: 3000,
                status: "ACTIVE",
              }
            : {
                id: "i2",
                code: null,
                name: "CDB",
                type: "FIXED_INCOME",
                quantity: 1,
                amount: 5000,
              },
        ],
      }),
    );
    const rows = await pluggyInvestments("k", "item-1", { fetcher });
    expect(calls).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual(["i1", "i2"]);
    expect(rows[0]).toMatchObject({ code: "PETR4", quantity: 100, amountOriginal: 3000 });
    expect(rows[1]).toMatchObject({ code: null, value: null });
  });
});
