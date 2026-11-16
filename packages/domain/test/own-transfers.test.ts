import { describe, expect, it } from "vitest";
import { namesPerson, pairOwnTransfers, type TransferLine } from "../src/own-transfers";

const book = {
  accountOwner: { xp: "ana", xpInvest: "ana", nu: "beto" },
  people: [
    { id: "ana", name: "Ana Souza" },
    { id: "beto", name: "Beto Lima" },
  ],
};
let next = 0;
const line = (
  accountId: string,
  kind: "receita" | "despesa",
  amount: string,
  date: string,
  description: string,
): TransferLine => ({ id: `l${(next += 1)}`, accountId, kind, amount, date, description });

describe("o extrato cita a pessoa", () => {
  it("pede o primeiro nome e mais um, como palavras inteiras, sem ligar para acento e caixa", () => {
    expect(namesPerson("Pix enviado para ANA CLARA DE SOUZA", "Ana Souza")).toBe(true);
    expect(namesPerson("Transferência Recebida|Beto Lima da Silva", "Beto Límá")).toBe(true);
    // Só o primeiro nome, ou o nome dentro de outra palavra, não basta.
    expect(namesPerson("Pix enviado para Ana Pereira", "Ana Souza")).toBe(false);
    expect(namesPerson("Pix enviado para Mariana Souza", "Ana Souza")).toBe(false);
    expect(namesPerson("Pagamento Souza Cruz", "Ana Souza")).toBe(false);
  });

  it("nome de uma palavra só vale com quatro letras ou mais", () => {
    expect(namesPerson("Pix recebido de Serena", "Serena")).toBe(true);
    expect(namesPerson("Pix recebido de Ana", "Ana")).toBe(false);
    expect(namesPerson("Pix recebido", "")).toBe(false);
  });
});

describe("as duas pontas de uma transferência entre contas da casa", () => {
  it("entre pessoas, casa quando a saída diz para quem foi e a entrada diz de quem veio", () => {
    const out = line(
      "xp",
      "despesa",
      "1210.00",
      "2026-11-13",
      "Pix enviado para Beto Lima da Silva",
    );
    const into = line("nu", "receita", "1210.00", "2026-11-13", "Transferência Recebida|ANA SOUZA");
    expect(pairOwnTransfers([into, out], book)).toEqual([{ fromId: out.id, toId: into.id }]);
  });

  it("um Pix para fora e outro de mesmo valor vindo de fora não são transferência", () => {
    const out = line("xp", "despesa", "100.00", "2026-11-13", "Pix enviado para Beto Lima");
    const into = line("nu", "receita", "100.00", "2026-11-13", "Transferência Recebida|Carla Dias");
    expect(pairOwnTransfers([out, into], book)).toEqual([]);
    // Só um lado confirmando também não basta entre pessoas.
    const bare = line("nu", "receita", "100.00", "2026-11-13", "Transferência Recebida");
    expect(pairOwnTransfers([out, bare], book)).toEqual([]);
  });

  it("na mesma pessoa, basta a frase do banco para conta própria ou o próprio nome", () => {
    const out = line(
      "xpInvest",
      "despesa",
      "85.90",
      "2026-11-13",
      "Transferência enviada para a conta digital",
    );
    const into = line(
      "xp",
      "receita",
      "85.90",
      "2026-11-13",
      "Transferência recebida da conta investimento",
    );
    expect(pairOwnTransfers([out, into], book)).toEqual([{ fromId: out.id, toId: into.id }]);
    const self = line("xp", "despesa", "50.00", "2026-11-14", "Pix enviado para Ana Souza");
    const got = line("xpInvest", "receita", "50.00", "2026-11-14", "Crédito em conta");
    expect(pairOwnTransfers([self, got], book)).toEqual([{ fromId: self.id, toId: got.id }]);
    // Sem nome e sem frase, duas linhas da mesma pessoa não casam.
    const pay = line("xp", "despesa", "30.00", "2026-11-14", "Pix enviado para Padaria");
    const refund = line("xpInvest", "receita", "30.00", "2026-11-14", "Pix recebido de Loja");
    expect(pairOwnTransfers([pay, refund], book)).toEqual([]);
  });

  it("valor diferente, mesma conta, data longe ou conta sem dono não casam", () => {
    const out = line("xp", "despesa", "200.00", "2026-11-10", "Pix enviado para Beto Lima");
    const from = "Transferência Recebida|Ana Souza";
    expect(
      pairOwnTransfers([out, line("nu", "receita", "200.01", "2026-11-10", from)], book),
    ).toEqual([]);
    expect(
      pairOwnTransfers([out, line("xp", "receita", "200.00", "2026-11-10", from)], book),
    ).toEqual([]);
    expect(
      pairOwnTransfers([out, line("nu", "receita", "200.00", "2026-11-12", from)], book),
    ).toEqual([]);
    expect(
      pairOwnTransfers([out, line("casa", "receita", "200.00", "2026-11-10", from)], book),
    ).toEqual([]);
    // Um dia de distância ainda casa.
    const late = line("nu", "receita", "200.00", "2026-11-11", from);
    expect(pairOwnTransfers([out, late], book)).toEqual([{ fromId: out.id, toId: late.id }]);
  });

  it("cada linha entra em um par só, e o mesmo dia vem antes do vizinho", () => {
    const to = "Pix enviado para Beto Lima";
    const from = "Transferência Recebida|Ana Souza";
    const first = line("xp", "despesa", "300.00", "2026-11-09", to);
    const second = line("xp", "despesa", "300.00", "2026-11-09", to);
    const before = line("nu", "receita", "300.00", "2026-11-08", from);
    const same = line("nu", "receita", "300.00", "2026-11-09", from);
    expect(pairOwnTransfers([first, second, before, same], book)).toEqual([
      { fromId: first.id, toId: same.id },
      { fromId: second.id, toId: before.id },
    ]);
    // Sobrando uma saída, ela fica como está.
    const third = line("xp", "despesa", "300.00", "2026-11-09", to);
    expect(pairOwnTransfers([first, second, third, same], book)).toHaveLength(1);
  });
});
