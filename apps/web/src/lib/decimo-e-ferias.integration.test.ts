// Cadastro de 13º e férias pelas server actions de verdade, contra um Postgres real com RLS (ADR-0028).
// A data fica presa em 02/11/2026, o caso real do pedido. Dados fictícios.
import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

interface OwnerSql {
  (strings: TemplateStringsArray): Promise<unknown>;
  end(): Promise<void>;
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;

let ctx: TenantContext;
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => ({
  requireTenant: async () => ({ ctx, session: { user: { id: ctx.userId, name: "Dona" } } }),
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messagesFor } = await import("@/i18n/messages");
  return {
    getLocale: async () => "pt-BR",
    getMessages: async () => messagesFor("pt-BR"),
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "pt-BR", messages: messagesFor("pt-BR"), namespace } as never),
  };
});

const db = await import("@organizeup/db");
const agents = await import("@organizeup/agents");
const { saveIncome, stopIncome } = await import("@/app/app/(painel)/renda/actions");
const { loadIncome } = await import("@/lib/income-data");
const { confirmCommitment } = await import("@/lib/confirm-entry");

const { accounts, categories, eq, household, householdMember, householdSettings } = db;
const { incomeReceipts, incomeSources, incomeVacationReceipts, incomeYearPlans } = db;
const { transactions, user } = db;

const initial = { ok: false, message: null };
const family = "hh-decimo-web";

const inFamily = <T>(fn: Parameters<typeof db.withWorkerHousehold<T>>[1]) =>
  db.withWorkerHousehold(family, fn);

let accountId = "";
let categoryId = "";

type Value = string | string[];
const form = (values: Record<string, Value>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values))
    for (const item of [value].flat()) data.append(key, item);
  return data;
};

const base = (over: Record<string, Value> = {}) =>
  form({
    id: "",
    name: "Empresa Exemplo",
    kind: "clt",
    amount: "6.000,00",
    payDay: "5",
    accountId,
    categoryId,
    personId: "",
    thirteenthMode: "parcelas",
    firstMonth: "11",
    secondMonth: "12",
    periodMonth: "0",
    periodDay: "",
    periodDays: "30",
    periodReceived: "",
    ...over,
  });

const plans = () => inFamily((tx) => tx.select().from(incomeYearPlans));
const sources = () => inFamily((tx) => tx.select().from(incomeSources));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T12:00:00-03:00"));
  const owner = "user-decimo-web";
  await db.withAdmin("seed de 13º e férias", async (admin) => {
    await admin.insert(user).values({ id: owner, name: "Dona", email: `${owner}@example.com` });
    await admin.insert(household).values({ id: family, name: "Exemplo", slug: family });
    await admin
      .insert(householdMember)
      .values({ id: `m-${family}`, organizationId: family, userId: owner, role: "owner" });
  });
  const session = await db.fromSession({
    user: { id: owner },
    session: { activeOrganizationId: family },
  });
  if (!session) throw new Error("sem contexto");
  ctx = session;
  await inFamily(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: family });
    await db.ensureFinanceDefaults(tx, family);
    const [account] = await tx.select().from(accounts);
    accountId = account!.id;
    const [category] = await tx.select().from(categories).where(eq(categories.name, "Salário"));
    categoryId = category!.id;
  });
});

beforeEach(async () => {
  await inFamily(async (tx) => {
    await tx.delete(incomeReceipts);
    await tx.delete(incomeVacationReceipts);
    await tx.delete(transactions);
    await tx.delete(incomeSources);
  });
});

afterAll(async () => {
  vi.useRealTimers();
  await db.closeAllPools();
});

describe("salvar", () => {
  it("sem escolher nada não nasce linha, e a previsão fica a de sempre", async () => {
    expect((await saveIncome(initial, base())).ok).toBe(true);
    expect(await plans()).toEqual([]);
    const [source] = await sources();
    const edited = await saveIncome(initial, base({ id: source!.id, name: "Outro nome" }));
    expect(edited.ok).toBe(true);
    expect(await plans()).toEqual([]);
  });

  it("férias de antes, com só o mês, salvas sem mudar nada, não criam linha", async () => {
    expect((await saveIncome(initial, base({ periodMonth: "7" }))).ok).toBe(true);
    const [source] = await sources();
    expect(source!.vacationMonth).toBe(7);
    expect(await plans()).toEqual([]);
    expect((await saveIncome(initial, base({ id: source!.id, periodMonth: "7" }))).ok).toBe(true);
    expect(await plans()).toEqual([]);
  });

  it("caso real: 1ª em julho, recebida, sem lançamento", async () => {
    const saved = await saveIncome(
      initial,
      base({ firstMonth: "7", firstReceived: "on", firstAmount: "2.800,00" }),
    );
    expect(saved.ok).toBe(true);
    const [plan] = await plans();
    expect(plan).toMatchObject({
      year: 2026,
      thirteenthFirstMonth: 7,
      thirteenthFirstReceived: true,
      thirteenthFirstAmount: "2800.00",
    });
    expect(await inFamily((tx) => tx.select().from(transactions))).toEqual([]);
    const entries = await inFamily((tx) => agents.scheduledIncome(tx, "2026-11", "2026-12"));
    expect(entries.filter((entry) => entry.key.endsWith(":13-1"))).toEqual([]);
    expect(entries.find((entry) => entry.key.endsWith(":13-2"))?.amount).toBe("2173.39");
    const view = await loadIncome(ctx);
    expect(view.sources[0]?.yearView?.thirteenth?.first).toMatchObject({
      received: true,
      amount: "2800.00",
    });
  });

  it("com registrar: cria o lançamento e a baixa, mesmo de antes da renda entrar aqui", async () => {
    const saved = await saveIncome(
      initial,
      base({
        firstMonth: "7",
        firstReceived: "on",
        firstAmount: "2.800,00",
        registerFirst: "on",
      }),
    );
    expect(saved).toMatchObject({ ok: true });
    const [source] = await sources();
    expect(source!.startMonth).toBe("2026-11");
    const [entry] = await inFamily((tx) => tx.select().from(transactions));
    expect(entry).toMatchObject({
      amount: "2800.00",
      kind: "receita",
      status: "realizado",
      description: "13º, 1ª parcela · Empresa Exemplo",
    });
    const [plan] = await plans();
    expect(plan?.thirteenthFirstReceived).toBe(false);
    const view = await loadIncome(ctx);
    expect(view.sources[0]?.receivedParts).toEqual(["13-1"]);
    expect(view.sources[0]?.hasReceipts).toBe(true);

    // Apagar o lançamento devolve a previsão, como sempre (ADR-0009): na lista de julho, a renda já
    // começou depois, e a 2ª continua descontando o valor informado.
    await inFamily((tx) => tx.delete(transactions).where(eq(transactions.id, entry!.id)));
    expect((await loadIncome(ctx)).sources[0]?.receivedParts).toEqual([]);
  });

  it("recusa o que a lei não permite, com a mensagem no campo certo", async () => {
    const tooShort = await saveIncome(
      initial,
      base({
        periodMonth: ["1", "6"],
        periodDay: ["5", "5"],
        periodDays: ["10", "10"],
        periodReceived: ["", ""],
      }),
    );
    expect(tooShort.fieldErrors?.vacation).toBe("Um dos períodos precisa de pelo menos 14 dias.");
    const sold = await saveIncome(
      initial,
      base({ periodMonth: "1", periodDays: "20", sell: "on", soldDays: "11" }),
    );
    expect(sold.fieldErrors?.soldDays).toBe("Dá para vender até 10 dias, um terço das férias.");
    const order = await saveIncome(initial, base({ firstMonth: "11", secondMonth: "10" }));
    expect(order.fieldErrors?.thirteenth).toBe("A 1ª parcela precisa vir antes da 2ª.");
    const amount = await saveIncome(initial, base({ firstReceived: "on", firstAmount: "abc" }));
    expect(amount.fieldErrors?.firstAmount).toBeTruthy();
    expect(await sources()).toEqual([]);
  });

  it("outro tipo de renda ignora as escolhas", async () => {
    const saved = await saveIncome(
      initial,
      base({ kind: "aluguel", amount: "1.500,00", periodMonth: "7", thirteenthMode: "integral" }),
    );
    expect(saved.ok).toBe(true);
    expect(await plans()).toEqual([]);
    const [source] = await sources();
    expect(source).toMatchObject({ vacationMonth: null, isGross: false });
  });

  it("escolha de 2027 convive com a de 2026", async () => {
    expect((await saveIncome(initial, base({ firstMonth: "7" }))).ok).toBe(true);
    const [source] = await sources();
    vi.setSystemTime(new Date("2027-02-01T12:00:00-03:00"));
    const again = await saveIncome(initial, base({ id: source!.id, firstMonth: "5" }));
    vi.setSystemTime(new Date("2026-11-02T12:00:00-03:00"));
    expect(again.ok).toBe(true);
    const rows = await plans();
    expect(rows.map((row) => [row.year, row.thirteenthFirstMonth]).sort()).toEqual([
      [2026, 7],
      [2027, 5],
    ]);
  });
});

describe("baixa", () => {
  it("Receber no 2º período grava na tabela nova e impede receber duas vezes", async () => {
    await saveIncome(
      initial,
      base({
        periodMonth: ["12", "12"],
        periodDay: ["5", "22"],
        periodDays: ["14", "5"],
        periodReceived: ["", ""],
      }),
    );
    const [source] = await sources();
    const key = `r:${source!.id}:2026-12:ferias-2`;
    const first = await inFamily((tx) => confirmCommitment(tx, ctx, key, "2026-12"));
    expect(first).toEqual({ done: true });
    const second = await inFamily((tx) => confirmCommitment(tx, ctx, key, "2026-12"));
    expect(second).toEqual({ done: false });
    expect(await inFamily((tx) => tx.select().from(incomeVacationReceipts))).toHaveLength(1);
    expect(await inFamily((tx) => tx.select().from(incomeReceipts))).toHaveLength(0);
    const entries = await inFamily((tx) => agents.scheduledIncome(tx, "2026-12", "2026-12"));
    expect(entries.map((entry) => entry.key)).not.toContain(key);
  });

  it("com baixa só do 2º período, a renda é encerrada, não apagada", async () => {
    await saveIncome(
      initial,
      base({
        periodMonth: ["12", "12"],
        periodDay: ["5", "22"],
        periodDays: ["14", "5"],
        periodReceived: ["", ""],
      }),
    );
    const [source] = await sources();
    await inFamily((tx) =>
      confirmCommitment(tx, ctx, `r:${source!.id}:2026-12:ferias-2`, "2026-12"),
    );
    await stopIncome(form({ id: source!.id }));
    const [after] = await sources();
    expect(after?.endMonth).toBe("2026-10");
  });

  it("sem baixa, apagar a renda leva as escolhas junto", async () => {
    await saveIncome(initial, base({ firstMonth: "7" }));
    const [source] = await sources();
    await stopIncome(form({ id: source!.id }));
    expect(await sources()).toEqual([]);
    expect(await plans()).toEqual([]);
  });
});

// Achados da revisão independente. Cada caso falhava antes da correção.
describe("revisão", () => {
  const at = (date: string) => vi.setSystemTime(new Date(`${date}T12:00:00-03:00`));
  const schedule = (from: string, to: string) =>
    inFamily((tx) => agents.scheduledIncome(tx, from, to));
  const keysIn = async (from: string, to: string) =>
    (await schedule(from, to)).map((entry) => entry.key.split(":").slice(2).join(":"));
  const lancamentos = () => inFamily((tx) => tx.select().from(transactions));
  const confirm = (key: string, month: string) =>
    inFamily((tx) => confirmCommitment(tx, ctx, key, month));

  beforeEach(() => at("2026-11-02"));

  it("D1: dias vendidos vazios ou quebrados voltam como erro do campo", async () => {
    for (const soldDays of ["", "2.5"]) {
      const saved = await saveIncome(
        initial,
        base({ periodMonth: "7", periodDays: "20", sell: "on", soldDays }),
      );
      expect(saved.fieldErrors?.soldDays).toBe("Informe quantos dias, de 1 a 10.");
    }
    expect(await sources()).toEqual([]);
  });

  it("D2: período recebido movido para o futuro continua previsto", async () => {
    await saveIncome(
      initial,
      base({ periodMonth: "7", periodDay: "6", periodDays: "20", periodReceived: "1" }),
    );
    const [source] = await sources();
    expect((await plans())[0]?.vacationPeriods).toMatchObject([{ received: true }]);
    await saveIncome(
      initial,
      base({
        id: source!.id,
        periodMonth: "12",
        periodDay: "6",
        periodDays: "20",
        periodReceived: "1",
      }),
    );
    expect((await plans())[0]?.vacationPeriods).toMatchObject([{ received: false }]);
    expect(await keysIn("2026-12", "2026-12")).toContain("2026-12:ferias");
  });

  it("D3: tirar o período recebido não dá baixa no outro", async () => {
    at("2026-01-02");
    await saveIncome(
      initial,
      base({
        periodMonth: ["10", "11"],
        periodDay: ["", ""],
        periodDays: ["15", "15"],
        periodReceived: ["", ""],
      }),
    );
    const [source] = await sources();
    at("2026-10-10");
    await confirm(`r:${source!.id}:2026-10:ferias`, "2026-10");
    await saveIncome(
      initial,
      base({ id: source!.id, periodMonth: "11", periodDay: "", periodDays: "15" }),
    );
    expect(await keysIn("2026-11", "2026-11")).toContain("2026-11:ferias");
    expect((await loadIncome(ctx)).sources[0]?.receivedParts).toEqual([]);
  });

  it("D4: mudar só o mês depois de receber não recebe duas vezes", async () => {
    at("2026-01-02");
    await saveIncome(initial, base({ periodMonth: "10" }));
    const [source] = await sources();
    at("2026-10-10");
    await confirm(`r:${source!.id}:2026-10:ferias`, "2026-10");
    await saveIncome(initial, base({ id: source!.id, periodMonth: "12" }));
    expect((await keysIn("2026-10", "2026-12")).filter((key) => key.includes("ferias"))).toEqual(
      [],
    );
    expect(await confirm(`r:${source!.id}:2026-12:ferias`, "2026-12")).toEqual({ done: false });
    expect(await confirm(`r:${source!.id}:2026-10:ferias`, "2026-10")).toEqual({ done: false });
    expect(await lancamentos()).toHaveLength(1);
    expect((await loadIncome(ctx)).sources[0]?.receivedParts).toEqual(["ferias"]);
  });

  it("D5: reajuste com a 1ª confirmada por Receber usa o valor do lançamento", async () => {
    await saveIncome(initial, base());
    const [source] = await sources();
    await confirm(`r:${source!.id}:2026-11:13-1`, "2026-11");
    await saveIncome(initial, base({ id: source!.id, amount: "6.600,00" }));
    const december = await schedule("2026-12", "2026-12");
    expect(december.find((entry) => entry.key.endsWith(":13-2"))?.amount).toBe("2267.60");
    const view = await loadIncome(ctx);
    expect(view.sources[0]?.yearView?.thirteenth?.first?.amount).toBe("3000.00");
  });

  it("D6: férias no dia 1 do primeiro mês da renda aparecem e dão baixa", async () => {
    at("2026-11-20");
    // Renda nova começa no mês do cadastro (PR #12): startMonth fica em novembro, não em dezembro.
    await saveIncome(initial, base({ periodMonth: "12", periodDay: "1", periodDays: "30" }));
    const [source] = await sources();
    expect(source!.startMonth).toBe("2026-11");
    // A lei manda pagar as férias até 2 dias antes do início: começando no dia 1, a chave é de
    // dezembro (mês do período), mas o pagamento aparece na janela de novembro.
    expect(await keysIn("2026-11", "2026-11")).toContain("2026-12:ferias");
    expect(await confirm(`r:${source!.id}:2026-12:ferias`, "2026-11")).toEqual({ done: true });
    expect(await keysIn("2026-11", "2026-11")).not.toContain("2026-12:ferias");
  });

  it("D7: tudo de uma vez depois de receber a 1ª desconta o recebido", async () => {
    await saveIncome(initial, base());
    const [source] = await sources();
    await confirm(`r:${source!.id}:2026-11:13-1`, "2026-11");
    await saveIncome(
      initial,
      base({ id: source!.id, thirteenthMode: "integral", singleMonth: "12" }),
    );
    const december = await schedule("2026-12", "2026-12");
    expect(december.find((entry) => entry.key.endsWith(":13-2"))?.amount).toBe("1973.39");
  });

  it("D7: a marca sem lançamento não se perde ao trocar para tudo de uma vez", async () => {
    await saveIncome(
      initial,
      base({ firstMonth: "7", firstReceived: "on", firstAmount: "2.800,00" }),
    );
    const [source] = await sources();
    await saveIncome(
      initial,
      base({
        id: source!.id,
        thirteenthMode: "integral",
        singleMonth: "12",
        firstMonth: "7",
        firstReceived: "on",
        firstAmount: "2.800,00",
      }),
    );
    expect((await plans())[0]).toMatchObject({
      thirteenthFirstReceived: true,
      thirteenthFirstAmount: "2800.00",
    });
    const december = await schedule("2026-12", "2026-12");
    expect(december.find((entry) => entry.key.endsWith(":13-2"))?.amount).toBe("2173.39");
  });

  it("decisão: tudo de uma vez em mês passado aceita Já recebi e lançamento", async () => {
    await saveIncome(
      initial,
      base({ thirteenthMode: "integral", singleMonth: "7", singleReceived: "on" }),
    );
    expect((await plans())[0]?.thirteenthSingleReceived).toBe(true);
    const [source] = await sources();
    expect(await keysIn("2026-07", "2026-07")).not.toContain("2026-07:13-2");
    await saveIncome(
      initial,
      base({
        id: source!.id,
        thirteenthMode: "integral",
        singleMonth: "7",
        singleReceived: "on",
        registerFirst: "on",
      }),
    );
    expect(await lancamentos()).toMatchObject([
      { amount: "4973.39", description: "13º salário · Empresa Exemplo" },
    ]);
    expect((await plans())[0]?.thirteenthSingleReceived).toBe(false);
  });

  it("D8: escolher em 2027 não mexe em 2026", async () => {
    at("2026-01-02");
    await saveIncome(initial, base({ periodMonth: "7" }));
    const [source] = await sources();
    at("2026-07-10");
    await confirm(`r:${source!.id}:2026-07:ferias`, "2026-07");
    const before = [await keysIn("2026-03", "2026-03"), await keysIn("2026-07", "2026-07")];
    at("2027-02-10");
    await saveIncome(
      initial,
      base({ id: source!.id, periodMonth: "3", periodDay: "10", periodDays: "30" }),
    );
    expect([await keysIn("2026-03", "2026-03"), await keysIn("2026-07", "2026-07")]).toEqual(
      before,
    );
    const [after] = await sources();
    expect(after?.vacationMonth).toBe(7);
  });

  it("decisão: o seletor grava o ano escolhido, e nenhum ano muda o outro", async () => {
    at("2026-01-02");
    await saveIncome(initial, base({ firstMonth: "10" }));
    const [source] = await sources();
    await saveIncome(initial, base({ id: source!.id, planYear: "2027", firstMonth: "5" }));
    expect(await keysIn("2027-05", "2027-05")).toContain("2027-05:13-1");
    await saveIncome(initial, base({ id: source!.id, firstMonth: "9" }));
    expect(await keysIn("2027-05", "2027-05")).toContain("2027-05:13-1");
    expect(await keysIn("2026-09", "2026-09")).toContain("2026-09:13-1");
    const invalid = await saveIncome(initial, base({ id: source!.id, planYear: "2031" }));
    expect(invalid.message).toBe("Confira os dados e tente de novo.");
  });

  it("julho em 2026 prevê julho em 2027 sem marca recebida", async () => {
    at("2026-01-02");
    await saveIncome(initial, base({ firstMonth: "7" }));
    const [source] = await sources();
    at("2026-11-02");
    await saveIncome(
      initial,
      base({ id: source!.id, firstMonth: "7", firstReceived: "on", firstAmount: "2.800,00" }),
    );
    const july = await schedule("2027-07", "2027-07");
    expect(july.find((entry) => entry.key.endsWith(":13-1"))?.amount).toBe("3000.00");
    const view = (await loadIncome(ctx)).sources[0]!;
    expect(view.nextYearView).toMatchObject({
      inheritedFrom: 2026,
      thirteenth: { first: { received: false, amount: "3000.00" } },
    });
    expect(await plans()).toHaveLength(1);
  });

  it("escolher 2027 não altera nada em 2026", async () => {
    at("2026-01-02");
    await saveIncome(initial, base({ firstMonth: "7", periodMonth: "3" }));
    const [source] = await sources();
    const before = await schedule("2026-01", "2026-12");
    await saveIncome(
      initial,
      base({ id: source!.id, planYear: "2027", firstMonth: "5", periodMonth: "9" }),
    );
    expect(await schedule("2026-01", "2026-12")).toEqual(before);
  });

  it("escolher 2028 deixa 2026 e 2027 como estão", async () => {
    at("2026-01-02");
    await saveIncome(initial, base({ firstMonth: "7" }));
    const [source] = await sources();
    const before = await schedule("2026-01", "2027-12");
    at("2027-03-01");
    await saveIncome(initial, base({ id: source!.id, planYear: "2028", firstMonth: "5" }));
    expect(await schedule("2026-01", "2027-12")).toEqual(before);
    expect(await keysIn("2028-05", "2028-05")).toContain("2028-05:13-1");
    expect(await keysIn("2029-05", "2029-05")).toContain("2029-05:13-1");
  });

  it("alterar 2026 depois de existir 2027 muda só 2026", async () => {
    at("2026-01-02");
    await saveIncome(initial, base({ firstMonth: "7" }));
    const [source] = await sources();
    await saveIncome(initial, base({ id: source!.id, planYear: "2027", firstMonth: "5" }));
    const next = await schedule("2027-01", "2027-12");
    await saveIncome(initial, base({ id: source!.id, firstMonth: "9" }));
    expect(await schedule("2027-01", "2027-12")).toEqual(next);
    expect(await keysIn("2026-09", "2026-09")).toContain("2026-09:13-1");
    expect(await keysIn("2026-07", "2026-07")).not.toContain("2026-07:13-1");
  });

  it("salvar 2027 herdado sem mudar nada não cria linha", async () => {
    await saveIncome(initial, base({ firstMonth: "7", firstReceived: "on" }));
    const [source] = await sources();
    await saveIncome(initial, base({ id: source!.id, planYear: "2027", firstMonth: "7" }));
    expect((await plans()).map((row) => row.year)).toEqual([2026]);
  });

  it("D8: mês das férias de uma renda nova é o menor, em ordem numérica", async () => {
    await saveIncome(
      initial,
      base({
        periodMonth: ["10", "9"],
        periodDay: ["1", "1"],
        periodDays: ["15", "15"],
        periodReceived: ["", ""],
      }),
    );
    expect((await sources())[0]?.vacationMonth).toBe(9);
  });

  it("D9: falha ao registrar em renda nova volta com o id e não duplica", async () => {
    const [usd] = await inFamily((tx) =>
      tx
        .insert(accounts)
        .values({ householdId: family, name: "Dólar", currency: "USD" })
        .returning(),
    );
    const values = {
      accountId: usd!.id,
      firstMonth: "7",
      firstReceived: "on",
      registerFirst: "on",
    };
    const first = await saveIncome(initial, base(values));
    expect(first.ok).toBe(false);
    expect(first.message).toContain("não deu para criar o lançamento");
    expect(first.savedId).toBeTruthy();
    const again = await saveIncome(initial, base({ ...values, id: first.savedId! }));
    expect(again.savedId).toBe(first.savedId);
    expect(await sources()).toHaveLength(1);
    await inFamily(async (tx) => {
      await tx.delete(incomeSources);
      await tx.delete(accounts).where(eq(accounts.id, usd!.id));
    });
  });

  it("D10: servidor recusa 13-1 já baixado no ano", async () => {
    await saveIncome(initial, base());
    const [source] = await sources();
    await confirm(`r:${source!.id}:2026-11:13-1`, "2026-11");
    await saveIncome(
      initial,
      base({ id: source!.id, firstMonth: "7", firstReceived: "on", registerFirst: "on" }),
    );
    expect(await lancamentos()).toHaveLength(1);
    expect(await inFamily((tx) => tx.select().from(incomeReceipts))).toHaveLength(1);
    expect((await plans())[0]?.thirteenthFirstReceived).toBe(false);
    expect(await confirm(`r:${source!.id}:2026-07:13-1`, "2026-07")).toEqual({ done: false });
  });

  it("D11: mês fora de faixa e id inexistente não viram erro 500", async () => {
    const invalid = "Confira os dados e tente de novo.";
    const forged: Array<Record<string, Value>> = [
      { firstMonth: "13", secondMonth: "14" },
      { thirteenthMode: "integral", singleMonth: "13" },
      { periodMonth: "13" },
      { id: "nao-existe", firstMonth: "7" },
    ];
    for (const fields of forged)
      expect((await saveIncome(initial, base(fields))).message).toBe(invalid);
    expect(await sources()).toEqual([]);
  });

  it("D12: janeiro não é mês da 1ª parcela", async () => {
    const saved = await saveIncome(initial, base({ firstMonth: "1" }));
    expect(saved.message).toBe("Confira os dados e tente de novo.");
  });
});

// Achados da reconferência. Cada caso falhava antes da correção.
describe("reconferência", () => {
  const at = (date: string) => vi.setSystemTime(new Date(`${date}T12:00:00-03:00`));
  const keysIn = async (from: string, to: string) =>
    (await inFamily((tx) => agents.scheduledIncome(tx, from, to))).map((entry) =>
      entry.key.split(":").slice(2).join(":"),
    );
  const lancamentos = () => inFamily((tx) => tx.select().from(transactions));
  const confirm = (key: string, month: string) =>
    inFamily((tx) => confirmCommitment(tx, ctx, key, month));

  beforeEach(() => at("2026-01-02"));

  it("N1: renda cadastrada sem mês ganha o mês escolhido", async () => {
    await saveIncome(initial, base());
    const [source] = await sources();
    at("2026-05-10");
    const saved = await saveIncome(initial, base({ id: source!.id, periodMonth: "7" }));
    expect(saved.ok).toBe(true);
    expect(await plans()).toHaveLength(1);
    expect(await keysIn("2026-07", "2026-07")).toContain("2026-07:ferias");
    const view = (await loadIncome(ctx)).sources[0]!;
    expect(view.yearView?.vacations).toHaveLength(1);
    expect(view.vacationMonth).toBeNull();
  });

  it("N1: renda que passou de PJ para CLT ganha o mês escolhido", async () => {
    await saveIncome(initial, base({ kind: "pj_autonomo", periodMonth: "0" }));
    const [source] = await sources();
    expect(source).toMatchObject({ vacationMonth: null, isGross: false });
    at("2026-05-10");
    await saveIncome(initial, base({ id: source!.id, periodMonth: "7" }));
    expect((await sources())[0]?.isGross).toBe(true);
    expect(await keysIn("2026-07", "2026-07")).toContain("2026-07:ferias");
  });

  it("N2: 13º recebido de uma vez não conta em dobro em duas parcelas", async () => {
    await saveIncome(initial, base({ thirteenthMode: "integral", singleMonth: "6" }));
    const [source] = await sources();
    at("2026-11-02");
    await confirm(`r:${source!.id}:2026-06:13-2`, "2026-06");
    await saveIncome(
      initial,
      base({ id: source!.id, firstMonth: "11", secondMonth: "12", singleMonth: "6" }),
    );
    expect((await keysIn("2026-11", "2026-12")).filter((key) => key.includes("13-"))).toEqual([]);
    expect(await confirm(`r:${source!.id}:2026-11:13-1`, "2026-11")).toEqual({ done: false });
    expect(await lancamentos()).toHaveLength(1);
    const again = await saveIncome(
      initial,
      base({
        id: source!.id,
        firstMonth: "7",
        firstReceived: "on",
        registerFirst: "on",
        singleMonth: "6",
      }),
    );
    expect(again.ok).toBe(true);
    expect(await lancamentos()).toHaveLength(1);
  });

  it("N2: a marca sem lançamento fica na troca para duas parcelas", async () => {
    await saveIncome(initial, base({ thirteenthMode: "integral", singleMonth: "6" }));
    const [source] = await sources();
    at("2026-11-02");
    await saveIncome(
      initial,
      base({
        id: source!.id,
        thirteenthMode: "integral",
        singleMonth: "6",
        singleReceived: "on",
      }),
    );
    await saveIncome(
      initial,
      base({ id: source!.id, firstMonth: "11", secondMonth: "12", singleMonth: "6" }),
    );
    expect((await plans())[0]).toMatchObject({
      thirteenthMode: "parcelas",
      thirteenthSingleReceived: true,
    });
    expect((await keysIn("2026-06", "2026-12")).filter((key) => key.includes("13-"))).toEqual([]);
  });

  it("N5: data de início forjada vira erro geral", async () => {
    const saved = await saveIncome(initial, base({ jobStartedOn: "2026-13-45" }));
    expect(saved.message).toBe("Confira os dados e tente de novo.");
    expect(await sources()).toEqual([]);
  });

  it("N5: registrar forjado no ano seguinte não cria lançamento", async () => {
    await saveIncome(initial, base());
    const [source] = await sources();
    at("2026-11-02");
    await saveIncome(
      initial,
      base({
        id: source!.id,
        planYear: "2027",
        firstMonth: "7",
        firstReceived: "on",
        registerFirst: "on",
      }),
    );
    expect(await lancamentos()).toEqual([]);
    expect((await plans())[0]?.thirteenthFirstReceived).toBe(false);
  });

  it("decisão: tirar período com baixa deixa a baixa sem período, e o cartão avisa", async () => {
    await saveIncome(
      initial,
      base({
        periodMonth: ["10", "11"],
        periodDay: ["", ""],
        periodDays: ["15", "15"],
        periodReceived: ["", ""],
      }),
    );
    const [source] = await sources();
    at("2026-10-10");
    await confirm(`r:${source!.id}:2026-10:ferias`, "2026-10");
    await saveIncome(
      initial,
      base({ id: source!.id, periodMonth: "11", periodDay: "", periodDays: "15" }),
    );
    expect((await loadIncome(ctx)).sources[0]?.orphanMonths).toEqual(["2026-10"]);
    expect(await lancamentos()).toHaveLength(1);
  });
});

describe("banco atrasado", () => {
  it("sem as tabelas da 0040, a renda segue de pé", async () => {
    vi.setSystemTime(new Date("2026-11-02T12:00:00-03:00"));
    await saveIncome(initial, base({ periodMonth: "7" }));
    const [source] = await sources();
    // Só o dono renomeia tabela, e a web não depende do driver: ele vem do pacote de banco.
    const postgres = createRequire(
      new URL("../../../../packages/db/package.json", import.meta.url),
    )("postgres") as (url: string, options: { max: number }) => OwnerSql;
    const sql = postgres(urls.owner, { max: 1 });
    await sql`ALTER TABLE income_year_plans RENAME TO income_year_plans_x`;
    await sql`ALTER TABLE income_vacation_receipts RENAME TO income_vacation_receipts_x`;
    try {
      expect((await loadIncome(ctx)).sources).toHaveLength(1);
      const entries = await inFamily((tx) => agents.scheduledIncome(tx, "2026-11", "2026-12"));
      expect(entries.map((entry) => entry.key)).toContain(`r:${source!.id}:2026-11:13-1`);
      // Escolha nova não grava nada pela metade, em renda velha nem nova.
      const later = "Ainda não deu para guardar esta escolha. Tente de novo em alguns minutos.";
      const edited = await saveIncome(initial, base({ id: source!.id, firstMonth: "8" }));
      expect(edited.message).toBe(later);
      const created = await saveIncome(initial, base({ name: "Nova", firstMonth: "8" }));
      expect(created.message).toBe(later);
      expect(await sources()).toHaveLength(1);
      // Sem escolha nova, salvar e receber seguem.
      const renamed = await saveIncome(
        initial,
        base({ id: source!.id, name: "Mudou", periodMonth: "7" }),
      );
      expect(renamed.ok).toBe(true);
      expect(
        await inFamily((tx) =>
          confirmCommitment(tx, ctx, `r:${source!.id}:2026-11:13-1`, "2026-11"),
        ),
      ).toEqual({ done: true });
      const exported = await inFamily((tx) => db.exportHousehold(tx));
      expect(exported.income_year_plans).toEqual([]);
      expect(exported.income_vacation_receipts).toEqual([]);
    } finally {
      await sql`ALTER TABLE income_year_plans_x RENAME TO income_year_plans`;
      await sql`ALTER TABLE income_vacation_receipts_x RENAME TO income_vacation_receipts`;
      await sql.end();
    }
  });
});
