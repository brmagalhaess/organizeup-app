import { describe, expect, it } from "vitest";
import { listTotals, openSummary, orderEntries } from "./entry-order";

const TODAY = "2026-11-12";
const entry = (
  id: string,
  date: string,
  kind: "receita" | "despesa" = "despesa",
  status: "previsto" | "realizado" = "realizado",
  amount = "10.00",
) => ({ id, date, kind, status, amount });

describe("ordem da lista de lançamentos", () => {
  it("hoje fica no topo, e o que ainda vai vencer vem depois, do mais próximo", () => {
    const { recent, upcoming } = orderEntries(
      [
        entry("a", "2026-11-01"),
        entry("b", "2026-11-12"),
        entry("c", "2026-11-25", "despesa", "previsto"),
        entry("d", "2026-11-05"),
        entry("e", "2026-11-14", "receita", "previsto"),
      ],
      TODAY,
    );
    expect(recent.map((row) => row.id)).toEqual(["b", "d", "a"]);
    expect(upcoming.map((row) => row.id)).toEqual(["e", "c"]);
  });

  it("no mesmo dia, mantém a ordem em que chegaram", () => {
    const { recent } = orderEntries(
      [entry("a", "2026-11-10"), entry("b", "2026-11-11"), entry("c", "2026-11-10")],
      TODAY,
    );
    expect(recent.map((row) => row.id)).toEqual(["b", "a", "c"]);
  });

  it("mês passado só tem o que já aconteceu, e mês futuro só o que vai vencer", () => {
    const past = orderEntries([entry("a", "2026-10-02"), entry("b", "2026-10-30")], TODAY);
    expect(past.recent.map((row) => row.id)).toEqual(["b", "a"]);
    expect(past.upcoming).toEqual([]);
    const next = orderEntries([entry("a", "2026-12-20"), entry("b", "2026-12-05")], TODAY);
    expect(next.recent).toEqual([]);
    expect(next.upcoming.map((row) => row.id)).toEqual(["b", "a"]);
  });
});

describe("resumos da lista", () => {
  it("conta o que está em aberto, os atrasados e quanto falta pagar e receber", () => {
    const summary = openSummary(
      [
        entry("a", "2026-11-05", "despesa", "previsto", "100.00"),
        entry("b", "2026-11-20", "despesa", "previsto", "50.50"),
        entry("c", "2026-11-07", "receita", "previsto", "3000.00"),
        entry("d", "2026-11-08", "despesa", "realizado", "999.00"),
      ],
      TODAY,
    );
    expect(summary).toEqual({ count: 3, overdue: 2, toPay: "150.50", toReceive: "3000.00" });
    expect(openSummary([entry("d", "2026-11-08")], TODAY).count).toBe(0);
  });

  it("soma entradas e saídas do que está na lista", () => {
    expect(
      listTotals([
        entry("a", TODAY, "receita", "realizado", "200.00"),
        entry("b", TODAY, "despesa", "realizado", "30.25"),
        entry("c", TODAY, "despesa", "previsto", "10.00"),
      ]),
    ).toEqual({ incoming: "200.00", outgoing: "40.25" });
  });
});
