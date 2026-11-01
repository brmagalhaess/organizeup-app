// Agente de dívidas e arquivos contra um Postgres real com RLS (ADR-0019). Dados fictícios. Roda com a
// conexão do worker, como em produção.
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import type { DebtExtraction, ReportDividasData } from "./dividas-types";
import type { TenantContext, TenantTx } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.worker;
process.env.ADMIN_DATABASE_URL = urls.admin;

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const agents = await import("../src/index");

const {
  accounts,
  and,
  debtDocuments,
  debtInstallments,
  debtPlanReports,
  debts,
  eq,
  household,
  householdMember,
  householdSettings,
  householdSuggestions,
  incomeSources,
  categories,
  people,
  transactions,
  user,
} = db;

const A = { household: "hh-dividas-a", owner: "user-dividas-a", viewer: "user-dividas-v" };
const B = { household: "hh-dividas-b", owner: "user-dividas-b" };
const today = domain.todayIn();
const month = domain.yearMonthOf(today);
const nextMonth = domain.addMonths(month, 1);

type Tx = TenantTx;
const inA = <T>(fn: (tx: Tx) => Promise<T>) => db.withWorkerHousehold(A.household, fn);

const ctxOf = async (userId: string, householdId: string): Promise<TenantContext> => {
  const ctx = await db.fromSession({
    user: { id: userId },
    session: { activeOrganizationId: householdId },
  });
  if (!ctx) throw new Error("sem contexto");
  return ctx;
};

let owner: TenantContext;
let accountId = "";

const terms = (over: Partial<import("@organizeup/domain").DebtTerms> = {}) => ({
  system: "price" as const,
  balance: "2000.00",
  monthlyRate: "4.0000",
  installments: 10,
  firstDueDate: `${nextMonth}-05`,
  ...over,
});

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.7 ${text}`);

const saveFile = (text: string, debtId?: string) =>
  db.withHousehold(owner, (tx) =>
    agents.saveDebtDocument(tx, owner, {
      fileName: "contrato.pdf",
      mediaType: "application/pdf",
      bytes: pdf(text),
      debtId: debtId ?? null,
    }),
  );

const extraction: DebtExtraction = {
  creditor: { value: "Financeira Exemplo", confidence: "alta" },
  balance: { value: "99999.00", confidence: "alta" },
  monthlyRate: { value: "9.0000", confidence: "alta" },
  installments: { value: 48, confidence: "alta" },
  installmentAmount: { value: "5000.00", confidence: "alta" },
  nextDueDate: { value: `${nextMonth}-10`, confidence: "alta" },
  system: { value: "price", confidence: "alta" },
  cetAnnual: { value: null, confidence: "baixa" },
  moreThanOne: false,
};

beforeAll(async () => {
  await db.withAdmin("seed do teste de dívidas", async (admin) => {
    await admin.insert(user).values([
      { id: A.owner, name: "Ana", email: "ana.dividas@example.com" },
      { id: A.viewer, name: "Vi", email: "vi.dividas@example.com" },
      { id: B.owner, name: "Beto", email: "beto.dividas@example.com" },
    ]);
    await admin.insert(household).values([
      { id: A.household, name: "Família Dívidas A", slug: "familia-dividas-a" },
      { id: B.household, name: "Família Dívidas B", slug: "familia-dividas-b" },
    ]);
    await admin.insert(householdMember).values([
      { id: "mdv-1", organizationId: A.household, userId: A.owner, role: "owner" },
      { id: "mdv-2", organizationId: A.household, userId: A.viewer, role: "viewer" },
      { id: "mdv-3", organizationId: B.household, userId: B.owner, role: "owner" },
    ]);
  });
  for (const [hh, ownerId] of [
    [A.household, A.owner],
    [B.household, B.owner],
  ] as const) {
    await db.withWorkerHousehold(hh, async (tx) => {
      await tx.insert(householdSettings).values({ householdId: hh });
      await tx
        .insert(people)
        .values({ householdId: hh, name: "Titular", relation: "titular", userId: ownerId });
      await db.ensureFinanceDefaults(tx, hh);
    });
  }
  owner = await ctxOf(A.owner, A.household);
  accountId = await inA(async (tx) => {
    const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
    const [income] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.kind, "receita"))
      .limit(1);
    const [person] = await tx.select({ id: people.id }).from(people).limit(1);
    await tx.insert(incomeSources).values({
      householdId: A.household,
      personId: person!.id,
      accountId: account!.id,
      categoryId: income!.id,
      name: "Aluguel fictício",
      kind: "aluguel",
      amount: "3000.00",
      payDay: 28,
      startMonth: domain.addMonths(month, -2),
    });
    return account!.id;
  });
});

afterAll(async () => {
  await db.closeAllPools();
});

beforeEach(async () => {
  await inA(async (tx) => {
    await tx.delete(householdSuggestions);
    await tx.delete(debtDocuments);
    await tx.delete(debts);
  });
  // A aplicação não apaga relatório: a limpeza do teste passa pelo admin.
  await db.withAdmin("limpeza do teste de dívidas", (admin) =>
    admin.delete(debtPlanReports).where(eq(debtPlanReports.householdId, A.household)),
  );
});

const seedDebts = () =>
  db.withHousehold(owner, async (tx) => ({
    costly: await agents.createDebtWithSchedule(tx, owner, {
      name: "Cartão parcelado",
      accountId,
      terms: terms(),
    }),
    cheap: await agents.createDebtWithSchedule(tx, owner, {
      name: "Loja",
      accountId,
      terms: terms({ balance: "500.00", monthlyRate: "0.5000", installments: 5 }),
    }),
  }));

const input = { today, householdId: A.household };

describe("agente de dívidas", () => {
  it("sem dívida, grava que não há nada e não sugere", async () => {
    const result = await inA((tx) => agents.runDividasAgent(tx, input));
    expect(result.suggestions).toBe(0);
    expect(result.report.summary).toContain("Nenhuma dívida");
    expect(await inA((tx) => tx.select().from(debtPlanReports))).toHaveLength(1);
  });

  it("grava o plano e sugere atacar a dívida mais cara, com o extra da divisão", async () => {
    const { costly } = await seedDebts();
    const result = await inA((tx) => agents.runDividasAgent(tx, input));
    const [report] = await inA((tx) => tx.select().from(debtPlanReports));
    const { plan } = report!.data as unknown as ReportDividasData;
    expect(plan!.recommended).toBe("avalanche");
    expect(plan!.avalanche.focus?.id).toBe(costly);
    expect(domain.money(plan!.extra).gt(0)).toBe(true);
    expect(report!.summary).toContain("Quite tudo em");

    const pending = await inA((tx) => tx.select().from(householdSuggestions));
    expect(pending.length).toBe(result.suggestions);
    const main = pending.find((row) => row.dedupeKey === agents.DEDUPE.aporteDivida(costly, month));
    expect(main).toMatchObject({ agent: "dividas", kind: "aporte_divida", status: "pendente" });
    expect(agents.parsePayload("aporte_divida", main!.payload).debtId).toBe(costly);
    expect(plan!.avalanche.thisMonth[0]!.id).toBe(costly);
    expect(JSON.stringify(pending)).not.toMatch(/itaú|bradesco|nubank|santander/i);
  });

  it("é idempotente: rodar duas vezes dá o mesmo resultado", async () => {
    await seedDebts();
    const first = await inA((tx) => agents.runDividasAgent(tx, input));
    const reportsBefore = await inA((tx) => tx.select().from(debtPlanReports));
    const suggestionsBefore = await inA((tx) => tx.select().from(householdSuggestions));
    const second = await inA((tx) => agents.runDividasAgent(tx, input));
    expect(second.report).toEqual(first.report);
    const reports = await inA((tx) => tx.select().from(debtPlanReports));
    expect(reports).toHaveLength(1);
    expect(reports[0]!.data).toEqual(reportsBefore[0]!.data);
    const suggestions = await inA((tx) => tx.select().from(householdSuggestions));
    expect(suggestions.map((row) => [row.dedupeKey, row.title, row.payload])).toEqual(
      suggestionsBefore.map((row) => [row.dedupeKey, row.title, row.payload]),
    );
  });

  it("nunca muda dívida informada", async () => {
    await seedDebts();
    const before = await inA(async (tx) => ({
      debts: await tx.select().from(debts),
      installments: await tx.select().from(debtInstallments),
    }));
    await inA((tx) => agents.runDividasAgent(tx, input));
    const after = await inA(async (tx) => ({
      debts: await tx.select().from(debts),
      installments: await tx.select().from(debtInstallments),
    }));
    expect(after).toEqual(before);
  });

  it("número lido de arquivo não entra no cálculo sem conferência", async () => {
    await seedDebts();
    const before = await inA((tx) => agents.currentDebtPlan(tx, today));
    const saved = await saveFile("sem conferir");
    expect(saved.ok).toBe(true);
    await inA((tx) =>
      tx
        .update(debtDocuments)
        .set({
          status: "lido",
          extracted: extraction as unknown as Record<string, unknown>,
        })
        .where(eq(debtDocuments.householdId, A.household)),
    );
    expect(await inA((tx) => agents.currentDebtPlan(tx, today))).toEqual(before);
    expect(await inA((tx) => tx.select().from(debts))).toHaveLength(2);
  });

  it("sugestão ignorada não volta, e a aceita não volta no mesmo mês", async () => {
    await seedDebts();
    await inA((tx) => agents.runDividasAgent(tx, input));
    for (const row of await inA((tx) => tx.select().from(householdSuggestions))) {
      await db.withHousehold(owner, (tx) => agents.dismissSuggestion(tx, owner, row.id));
    }
    const again = await inA((tx) => agents.runDividasAgent(tx, input));
    expect(again.suggestions).toBe(0);

    await inA((tx) => tx.delete(householdSuggestions));
    await inA((tx) => agents.runDividasAgent(tx, input));
    for (const row of await inA((tx) => tx.select().from(householdSuggestions))) {
      const applied = await db.withHousehold(owner, (tx) =>
        agents.applySuggestion(tx, owner, row.id),
      );
      expect(applied.ok).toBe(true);
    }
    const third = await inA((tx) => agents.runDividasAgent(tx, input));
    expect(third.suggestions).toBe(0);
  });

  it("aposentadoria não repete a sugestão no dia em que o agente de dívidas rodou", async () => {
    await seedDebts();
    await inA((tx) => agents.runDividasAgent(tx, input));
    await inA((tx) => agents.runAposentadoriaAgent(tx, input));
    const rows = await inA((tx) =>
      tx.select().from(householdSuggestions).where(eq(householdSuggestions.kind, "aporte_divida")),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.agent === "dividas")).toBe(true);
  });

  it("sem o agente de dívidas, a aposentadoria continua sugerindo", async () => {
    await seedDebts();
    await inA((tx) => agents.runAposentadoriaAgent(tx, input));
    const rows = await inA((tx) =>
      tx.select().from(householdSuggestions).where(eq(householdSuggestions.kind, "aporte_divida")),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.agent === "aposentadoria")).toBe(true);
  });

  it("o relatório diz o que mudou desde ontem", async () => {
    await seedDebts();
    const { plan } = await inA((tx) => agents.currentDebtPlan(tx, today));
    const earlier = structuredClone(plan!);
    earlier.avalanche.payoffMonth = "2040-01";
    await inA((tx) =>
      tx.insert(debtPlanReports).values({
        householdId: A.household,
        day: agents.shiftDays(today, -1),
        title: "Ontem",
        summary: "Resumo de ontem",
        data: { plan: earlier },
      }),
    );
    const result = await inA((tx) => agents.runDividasAgent(tx, input));
    expect(result.report.summary).toContain("A quitação mudou de janeiro de 2040");
  });
});

describe("arquivos da dívida", () => {
  it("mesmo arquivo não duplica e a listagem nunca traz o conteúdo", async () => {
    const first = await saveFile("igual");
    const second = await saveFile("igual");
    expect(first).toMatchObject({ ok: true, duplicate: false, status: "guardado" });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    const rows = await db.withHousehold(owner, agents.listDebtDocuments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("content");
    expect(rows[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("anexar de novo pela dívida liga o arquivo que estava solto", async () => {
    const { costly } = await seedDebts();
    await saveFile("solto");
    await saveFile("solto", costly);
    const [row] = await db.withHousehold(owner, agents.listDebtDocuments);
    expect(row!.debtId).toBe(costly);
  });

  it("recusa dívida que não é da família", async () => {
    const result = await saveFile("sem dívida", "nao-existe");
    expect(result).toMatchObject({ ok: false, code: "divida" });
  });

  it("recusa passar de 50 MB na família", async () => {
    const save = (index: number) =>
      db.withHousehold(owner, (tx) => {
        const bytes = new Uint8Array(domain.DEBT_FILE_MAX_BYTES);
        bytes.set(pdf(`grande ${index}`));
        return agents.saveDebtDocument(tx, owner, {
          fileName: `contrato-${index}.pdf`,
          mediaType: "application/pdf",
          bytes,
        });
      });
    for (const index of [1, 2, 3, 4, 5]) expect((await save(index)).ok).toBe(true);
    expect(await save(6)).toMatchObject({ ok: false, code: "cota" });
    const small = await saveFile("cabe mais?");
    expect(small).toMatchObject({ ok: false, code: "cota" });
  }, 60_000);

  it("quem só vê não anexa e não apaga", async () => {
    const saved = await saveFile("do responsável");
    const viewer = await ctxOf(A.viewer, A.household);
    const attempt = await db.withHousehold(viewer, (tx) =>
      agents.saveDebtDocument(tx, viewer, {
        fileName: "x.pdf",
        mediaType: "application/pdf",
        bytes: pdf("do visitante"),
      }),
    );
    expect(attempt).toMatchObject({ ok: false, code: "somente_leitura" });
    const id = saved.ok ? saved.id : "";
    expect(await db.withHousehold(viewer, (tx) => agents.deleteDebtDocument(tx, viewer, id))).toBe(
      false,
    );
    expect(await db.withHousehold(owner, (tx) => agents.deleteDebtDocument(tx, owner, id))).toBe(
      true,
    );
    expect(await db.withHousehold(owner, (tx) => agents.loadDebtDocumentFile(tx, id))).toBeNull();
  });

  it("outra família não acha o arquivo para baixar", async () => {
    const saved = await saveFile("privado");
    const other = await ctxOf(B.owner, B.household);
    const id = saved.ok ? saved.id : "";
    expect(await db.withHousehold(other, (tx) => agents.loadDebtDocumentFile(tx, id))).toBeNull();
    expect(await db.withHousehold(other, (tx) => agents.deleteDebtDocument(tx, other, id))).toBe(
      false,
    );
    const mine = await db.withHousehold(owner, (tx) => agents.loadDebtDocumentFile(tx, id));
    expect(Buffer.from(mine!.content).toString()).toContain("privado");
  });
});

describe("conferência", () => {
  const confirm = (documentId: string, over: Record<string, unknown> = {}) =>
    db.withHousehold(owner, (tx) =>
      agents.confirmDebtDocument(tx, owner, {
        documentId,
        name: "Financeira Exemplo",
        accountId,
        terms: terms(),
        updateDebtId: null,
        ...over,
      }),
    );

  it("não grava nada sem confirmar; confirmado, cria igual ao cadastro manual", async () => {
    const saved = await saveFile("para conferir");
    const id = saved.ok ? saved.id : "";
    await inA((tx) =>
      tx
        .update(debtDocuments)
        .set({ status: "lido", extracted: extraction as unknown as Record<string, unknown> })
        .where(eq(debtDocuments.id, id)),
    );
    expect(await inA((tx) => tx.select().from(debts))).toHaveLength(0);
    expect(await inA((tx) => tx.select().from(debtInstallments))).toHaveLength(0);

    const result = await confirm(id);
    expect(result.ok).toBe(true);
    const created = await inA((tx) => tx.select().from(debts));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Financeira Exemplo", monthlyRate: "4.0000" });

    const manual = await db.withHousehold(owner, (tx) =>
      agents.createDebtWithSchedule(tx, owner, { name: "Igual", accountId, terms: terms() }),
    );
    const schedule = await inA((tx) => tx.select().from(debtInstallments));
    const of = (debtId: string) =>
      schedule
        .filter((row) => row.debtId === debtId)
        .map(({ number, dueDate, amount, principal, interest }) => ({
          number,
          dueDate,
          amount,
          principal,
          interest,
        }))
        .sort((a, b) => a.number - b.number);
    expect(of(created[0]!.id)).toEqual(of(manual));

    const [document] = await db.withHousehold(owner, agents.listDebtDocuments);
    expect(document).toMatchObject({ status: "confirmado", debtId: created[0]!.id });
  });

  it("usa o que a pessoa conferiu, não o que a leitura achou", async () => {
    const saved = await saveFile("corrigido");
    const id = saved.ok ? saved.id : "";
    await confirm(id, { terms: terms({ balance: "1500.00", installments: 6 }) });
    const rows = await inA((tx) => tx.select().from(debtInstallments));
    expect(rows).toHaveLength(6);
  });

  it("confirmar duas vezes não cria duas dívidas", async () => {
    const saved = await saveFile("duplo clique");
    const id = saved.ok ? saved.id : "";
    expect((await confirm(id)).ok).toBe(true);
    expect(await confirm(id)).toMatchObject({ ok: false });
    expect(await inA((tx) => tx.select().from(debts))).toHaveLength(1);
  });

  it("recusa arquivo em leitura e conta de fora", async () => {
    const saved = await saveFile("em leitura");
    const id = saved.ok ? saved.id : "";
    expect(await confirm(id, { accountId: "conta-de-fora" })).toMatchObject({ ok: false });
    await inA((tx) =>
      tx.update(debtDocuments).set({ status: "lendo" }).where(eq(debtDocuments.id, id)),
    );
    expect(await confirm(id)).toMatchObject({ ok: false });
    expect(await inA((tx) => tx.select().from(debts))).toHaveLength(0);
  });

  it("atualizar troca as parcelas em aberto e mantém o que foi pago", async () => {
    const { costly } = await seedDebts();
    await db.withHousehold(owner, async (tx) => {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.kind, "despesa"))
        .limit(1);
      const [payment] = await tx
        .insert(transactions)
        .values({
          householdId: A.household,
          accountId,
          categoryId: category!.id,
          kind: "despesa",
          description: "Parcela paga",
          amount: "246.58",
          occurredOn: today,
        })
        .returning({ id: transactions.id });
      await tx
        .update(debtInstallments)
        .set({ transactionId: payment!.id })
        .where(and(eq(debtInstallments.debtId, costly), eq(debtInstallments.number, 1)));
    });
    const saved = await saveFile("renegociação", costly);
    const id = saved.ok ? saved.id : "";
    const result = await confirm(id, {
      updateDebtId: costly,
      name: "Cartão renegociado",
      terms: terms({ balance: "1000.00", monthlyRate: "2.0000", installments: 4 }),
    });
    expect(result).toEqual({ ok: true, debtId: costly });
    const rows = await inA((tx) =>
      tx.select().from(debtInstallments).where(eq(debtInstallments.debtId, costly)),
    );
    expect(rows.map((row) => row.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.filter((row) => row.transactionId !== null)).toHaveLength(1);
    const [debt] = await inA((tx) => tx.select().from(debts).where(eq(debts.id, costly)));
    expect(debt).toMatchObject({ name: "Cartão renegociado", monthlyRate: "2.0000" });
    expect(await inA((tx) => tx.select().from(debts))).toHaveLength(2);
  });

  it("quem só vê não confirma", async () => {
    const saved = await saveFile("visitante");
    const viewer = await ctxOf(A.viewer, A.household);
    const id = saved.ok ? saved.id : "";
    const result = await db.withHousehold(viewer, (tx) =>
      agents.confirmDebtDocument(tx, viewer, {
        documentId: id,
        name: "Não pode",
        accountId,
        terms: terms(),
        updateDebtId: null,
      }),
    );
    expect(result).toMatchObject({ ok: false });
  });
});
