import { describe, expect, it } from "vitest";
import {
  buildReminder,
  REMINDER_DEFAULTS,
  REMINDER_LIST_LIMIT,
  reminderIsEmpty,
  type ReminderEntry,
  type ReminderInput,
} from "../src/reminders";

const TODAY = "2026-11-11";
const bill = (date: string, amount = "100.00", description = "Luz"): ReminderEntry => ({
  kind: "despesa",
  source: "previsao",
  description,
  amount,
  date,
});
const pay = (date: string, amount = "5000.00"): ReminderEntry => ({
  kind: "receita",
  source: "renda",
  description: "Salário",
  amount,
  date,
});
const input = (over: Partial<ReminderInput> = {}): ReminderInput => ({
  today: TODAY,
  settings: REMINDER_DEFAULTS,
  entries: [],
  dividends: [],
  fresh: [],
  dailyDone: false,
  ...over,
});
const spent = (date: string, amount = "42.00") => ({
  description: "Padaria",
  amount,
  date,
  origin: "conta" as const,
  place: "Banco",
});

describe("lembretes por e-mail", () => {
  it("sem nada por perto, não há e-mail", () => {
    expect(buildReminder(input())).toBeNull();
    // Conta para daqui a dois dias já foi avisada quando entrou na janela: hoje não chama.
    expect(buildReminder(input({ entries: [bill("2026-11-13")] }))).toBeNull();
    // Fora da janela de antecedência.
    expect(buildReminder(input({ entries: [bill("2026-11-20")] }))).toBeNull();
  });

  it("avisa no dia, na véspera da janela e no dia seguinte ao vencimento", () => {
    for (const date of ["2026-11-11", "2026-11-14", "2026-11-10"]) {
      const digest = buildReminder(input({ entries: [bill(date)] }));
      expect(digest?.daily, date).toBe(true);
      expect(digest?.toPay.count, date).toBe(1);
    }
    expect(buildReminder(input({ entries: [bill("2026-11-10")] }))!.toPay.items[0]!.when).toBe(
      "atrasada",
    );
    expect(buildReminder(input({ entries: [bill("2026-11-11")] }))!.toPay.items[0]!.when).toBe(
      "hoje",
    );
    expect(buildReminder(input({ entries: [bill("2026-11-14")] }))!.toPay.items[0]!.when).toBe(
      "adiante",
    );
  });

  it("quando o resumo sai, traz a janela inteira, em ordem de data", () => {
    const digest = buildReminder(
      input({
        entries: [
          bill("2026-11-13", "80.00", "Internet"),
          bill("2026-11-11", "120.00", "Luz"),
          bill("2026-11-05", "60.00", "Água"),
          // Vencida há mais de dez dias e depois da janela: ficam de fora.
          bill("2026-10-20", "999.00", "Antiga"),
          bill("2026-11-25", "999.00", "Longe"),
          pay("2026-11-12"),
        ],
      }),
    )!;
    expect(digest.toPay.items.map((item) => item.description)).toEqual(["Água", "Luz", "Internet"]);
    expect(digest.toPay.total).toBe("260.00");
    expect(digest.toReceive.items.map((item) => item.date)).toEqual(["2026-11-12"]);
  });

  it("renda e provento chamam só no dia em que entram", () => {
    expect(buildReminder(input({ entries: [pay("2026-11-12")] }))).toBeNull();
    expect(buildReminder(input({ entries: [pay("2026-11-11")] }))!.toReceive.count).toBe(1);
    const event = { ticker: "MXRF11", kind: "rendimento" as const, amount: "12.30" };
    expect(buildReminder(input({ dividends: [{ ...event, payDate: "2026-11-13" }] }))).toBeNull();
    const digest = buildReminder(
      input({
        dividends: [
          { ...event, payDate: "2026-11-13" },
          { ...event, ticker: "ITSA4", payDate: "2026-11-11" },
        ],
      }),
    )!;
    expect(digest.dividends.items.map((item) => [item.ticker, item.when])).toEqual([
      ["ITSA4", "hoje"],
      ["MXRF11", "adiante"],
    ]);
    expect(digest.dividends.total).toBe("24.60");
  });

  it("gasto novo gera e-mail mesmo com o resumo do dia já enviado", () => {
    const digest = buildReminder(
      input({
        entries: [bill(TODAY)],
        fresh: [spent("2026-11-10"), spent(TODAY)],
        dailyDone: true,
      }),
    )!;
    expect(digest.daily).toBe(false);
    expect(digest.toPay.count).toBe(0);
    expect(digest.fresh.items.map((item) => item.date)).toEqual([TODAY, "2026-11-10"]);
    expect(digest.fresh.total).toBe("84.00");
    expect(buildReminder(input({ entries: [bill(TODAY)], dailyDone: true }))).toBeNull();
  });

  it("cada interruptor tira o seu bloco, e o geral tira tudo", () => {
    const all = {
      entries: [bill(TODAY), pay(TODAY)],
      dividends: [{ ticker: "ITSA4", kind: "jcp" as const, payDate: TODAY, amount: "9.00" }],
      fresh: [spent(TODAY)],
    };
    const off = (key: "bills" | "income" | "dividends" | "expenses") =>
      buildReminder(input({ ...all, settings: { ...REMINDER_DEFAULTS, [key]: false } }))!;
    expect(off("bills").toPay.count).toBe(0);
    expect(off("income").toReceive.count).toBe(0);
    expect(off("dividends").dividends.count).toBe(0);
    expect(off("expenses").fresh.count).toBe(0);
    expect(
      buildReminder(input({ ...all, settings: { ...REMINDER_DEFAULTS, enabled: false } })),
    ).toBeNull();
  });

  it("a antecedência escolhida muda a janela, e fica entre zero e sete dias", () => {
    const settings = (daysAhead: number) => ({ ...REMINDER_DEFAULTS, daysAhead });
    expect(
      buildReminder(input({ entries: [bill("2026-11-12")], settings: settings(0) })),
    ).toBeNull();
    expect(
      buildReminder(input({ entries: [bill("2026-11-12")], settings: settings(1) }))?.toPay.count,
    ).toBe(1);
    expect(
      buildReminder(input({ entries: [bill("2026-11-18")], settings: settings(30) }))?.toPay.count,
    ).toBe(1);
    expect(
      buildReminder(input({ entries: [bill("2026-11-19")], settings: settings(30) })),
    ).toBeNull();
  });

  it("lista longa mostra as primeiras e conta o resto", () => {
    const fresh = Array.from({ length: REMINDER_LIST_LIMIT + 3 }, () => spent(TODAY, "10.00"));
    const digest = buildReminder(input({ fresh }))!;
    expect(digest.fresh.items).toHaveLength(REMINDER_LIST_LIMIT);
    expect(digest.fresh.more).toBe(3);
    expect(digest.fresh.count).toBe(REMINDER_LIST_LIMIT + 3);
    expect(digest.fresh.total).toBe("110.00");
  });

  it("o envio pedido na tela mostra a janela mesmo sem nada para hoje, e mesmo desligado", () => {
    const empty = buildReminder(input({ force: true, dailyDone: true }))!;
    expect(reminderIsEmpty(empty)).toBe(true);
    const digest = buildReminder(
      input({
        force: true,
        dailyDone: true,
        entries: [bill("2026-11-13")],
        settings: { ...REMINDER_DEFAULTS, enabled: false },
      }),
    )!;
    expect(digest.toPay.count).toBe(1);
    expect(reminderIsEmpty(digest)).toBe(false);
  });
});
