// Aprovação do importador (ADR-0030), pela rotina de verdade, com a conexão da web (`ou_app`) e RLS. O lote é
// lido pelo agente, com o modelo falso quando precisa. Dados fictícios.
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { TenantContext } from "@organizeup/db";
import type { ModelClient, ModelMessage, ModelStream } from "@organizeup/ai";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;
process.env.ANTHROPIC_API_KEY = "chave-de-teste";

let sessionCtx: TenantContext;
vi.mock("@/lib/diagnostics", () => ({ reportActionFailure: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/importador/queue", () => ({ queueSmartImportJob: async () => true }));
const gate = vi.hoisted(() => ({ on: true, admin: false }));
vi.mock("@/lib/session", () => ({
  requireTenant: async () => ({
    ctx: sessionCtx,
    session: { user: { id: sessionCtx.userId, email: "ana.apr@example.com" } },
  }),
  platformFlags: async () => ({ smartImportEnabled: gate.on }),
  isServiceAdmin: () => gate.admin,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messagesFor } = await import("@/i18n/messages");
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "pt-BR", messages: messagesFor("pt-BR"), namespace } as never),
  };
});

const db = await import("@organizeup/db");
const domain = await import("@organizeup/domain");
const agents = await import("@organizeup/agents");
const ai = { ...(await import("@organizeup/ai")), ...(await import("@organizeup/ai/importador")) };
const { approveSmartImport, failItems } = await import("./commit");
const { clearAll, confirmAll, markSeen, saveItem, setFileTarget } =
  await import("@/app/app/(painel)/importar/arquivos/actions");

const { accounts, auditLog, cardPurchases, categories, creditCards, debts, debtInstallments } = db;
const { eq, featureFlags, goals, household, householdMember, householdSettings } = db;
const { householdSubscriptions, incomeSources, investments, investmentTrades } = db;
const { cashflowPlans, smartImportFiles, smartImportItems, smartImports, transactions, user } = db;
const { smartImportFileMeta, dividends, debtDocuments } = db;

const A = { household: "hh-apr-a", owner: "user-apr-a", viewer: "user-apr-v", child: "user-apr-c" };
const B = { household: "hh-apr-b", owner: "user-apr-b" };
const limits = { monthlyBudgetUsd: 1000, familyDailyTokens: 1_000_000 };
const day = domain.todayIn();

let owner: TenantContext;
let viewer: TenantContext;
let child: TenantContext;
let other: TenantContext;
let bank = "";
let card = "";

const session = async (userId: string, householdId: string) => {
  const found = await db.fromSession({
    user: { id: userId },
    session: { activeOrganizationId: householdId },
  });
  if (!found) throw new Error("sem contexto");
  return found;
};

const encode = (text: string) => new TextEncoder().encode(text);

/** O catálogo da bolsa só o worker grava. O pool é escolhido na hora da chamada. */
async function asWorker<T>(fn: () => Promise<T>): Promise<T> {
  process.env.DATABASE_URL = urls.worker;
  try {
    return await fn();
  } finally {
    process.env.DATABASE_URL = urls.app;
  }
}

const OFX = (lines: Array<[id: string, amount: string, memo: string]>) => `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
${lines
  .map(
    ([id, amount, memo]) =>
      `<STMTTRN><DTPOSTED>20261001<TRNAMT>${amount}<FITID>${id}<MEMO>${memo}</STMTTRN>`,
  )
  .join("\n")}
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const CARD = (lines: Array<[id: string, amount: string, memo: string]>) =>
  OFX(lines).replace("<BANKMSGSRSV1>", "<CREDITCARDMSGSRSV1>");

async function lotOf(ctx: TenantContext, files: Array<[string, Uint8Array]>) {
  return db.withHousehold(ctx, async (tx) => {
    const importId = (await agents.createSmartImport(tx, ctx))!;
    for (const [name, bytes] of files) {
      const checked = domain.checkSmartFile(bytes, name);
      if (!checked.ok) throw new Error(checked.code);
      await agents.saveSmartFile(tx, ctx, {
        importId,
        fileName: checked.fileName,
        mediaType: checked.mediaType,
        bytes,
      });
    }
    await agents.queueSmartImport(tx, ctx, importId, true);
    return importId;
  });
}

const blankItem = {
  destino: "documento",
  confianca: "alta",
  descricao: "",
  data: "",
  valor: "",
  sentido: "",
  parcelas: "",
  valor_parcela: "",
  taxa_mensal: "",
  sistema: "",
  dia: "",
  mes_inicial: "",
  mes_final: "",
  codigo_ativo: "",
  quantidade: "",
  preco_unitario: "",
  taxas: "",
  operacao: "",
  subtipo: "",
  retido: "",
  bruto: "",
  trecho: "",
};

/** Cliente falso: devolve o JSON pronto. */
const modelSays = (answer: unknown): ModelClient => ({
  stream: () =>
    ({
      finalMessage: async () =>
        ({
          id: "msg",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          stop_reason: "end_turn",
          stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(answer) }],
          usage: {
            input_tokens: 10,
            output_tokens: 10,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            iterations: null,
          },
        }) as unknown as ModelMessage,
    }) as unknown as ModelStream,
});

const answerOf = (tipo: string, itens: Array<Record<string, string>>) => ({
  tipo,
  emissor: "Empresa Exemplo",
  confianca: "alta",
  total_documento: "",
  campos: [{ rotulo: "Número", valor: "10" }],
  itens: itens.map((item) => ({ ...blankItem, ...item })),
  nao_entendi: [],
});

/** Lê e deixa como a tela deixa: tudo o que apareceu fica visto. */
async function read(importId: string, client: ModelClient | null = null) {
  const items = await readOnly(importId, client);
  await db.withHousehold(owner, (tx) =>
    tx.update(smartImportItems).set({ seen: true }).where(eq(smartImportItems.importId, importId)),
  );
  return items;
}

async function readOnly(importId: string, client: ModelClient | null = null) {
  await ai.runSmartImport({ ctx: owner, client, importId, limits, day });
  return db.withHousehold(owner, (tx) => agents.listSmartItems(tx, importId));
}

const formOf = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
};

const setFileAccount = (importId: string, values: { accountId?: string; cardId?: string }) =>
  db.withHousehold(owner, (tx) =>
    tx.update(smartImportFiles).set(values).where(eq(smartImportFiles.importId, importId)),
  );

const countOf = async (table: typeof transactions | typeof cardPurchases | typeof debts) =>
  (await db.withHousehold(owner, (tx) => tx.select().from(table as typeof transactions))).length;

const setBilling = (enabled: boolean) =>
  db.withAdmin("chave do teste", (admin) =>
    admin.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, db.FLAG_KEYS.billing)),
  );

/** Família só com a Base: nada de Investimentos, Dívidas, Metas nem Assistente. */
const onlyBase = (entries = "ilimitado") =>
  db.withAdmin("assinatura do teste", async (admin) => {
    await admin
      .insert(householdSubscriptions)
      .values({
        householdId: A.household,
        status: "active",
        items: [{ price: "price_base", item: `base:${entries}`, amount: "9.90", quantity: 1 }],
      })
      .onConflictDoUpdate({
        target: householdSubscriptions.householdId,
        set: {
          status: "active",
          courtesy: false,
          trialEndsAt: null,
          items: [{ price: "price_base", item: `base:${entries}`, amount: "9.90", quantity: 1 }],
        },
      });
  });

beforeAll(async () => {
  await db.withAdmin("seed do importador", async (admin) => {
    await admin.insert(user).values([
      { id: A.owner, name: "Ana Fictícia", email: "ana.apr@example.com" },
      { id: A.viewer, name: "Vera Fictícia", email: "vera.apr@example.com" },
      { id: A.child, name: "Caio Fictício", email: "caio.apr@example.com" },
      { id: B.owner, name: "Beto", email: "beto.apr@example.com" },
    ]);
    await admin.insert(household).values([
      { id: A.household, name: "Família A", slug: "familia-apr-a" },
      { id: B.household, name: "Família B", slug: "familia-apr-b" },
    ]);
    await admin.insert(householdMember).values([
      { id: "m-apr-a", organizationId: A.household, userId: A.owner, role: "owner" },
      { id: "m-apr-v", organizationId: A.household, userId: A.viewer, role: "viewer" },
      { id: "m-apr-c", organizationId: A.household, userId: A.child, role: "child" },
      { id: "m-apr-b", organizationId: B.household, userId: B.owner, role: "owner" },
    ]);
  });
  owner = await session(A.owner, A.household);
  viewer = await session(A.viewer, A.household);
  child = await session(A.child, A.household);
  other = await session(B.owner, B.household);
  await db.withHousehold(owner, async (tx) => {
    await tx.insert(householdSettings).values({ householdId: A.household });
    await db.ensureFinanceDefaults(tx, A.household);
    const [row] = await tx
      .insert(accounts)
      .values({ householdId: A.household, name: "Banco Exemplo" })
      .returning({ id: accounts.id });
    bank = row!.id;
    const [plastic] = await tx
      .insert(creditCards)
      .values({
        householdId: A.household,
        name: "Cartão Exemplo",
        closingDay: 25,
        dueDay: 5,
        payingAccountId: bank,
      })
      .returning({ id: creditCards.id });
    card = plastic!.id;
  });
  await ai.activateAssistant(owner, { autonomy: "organizar", version: "2026-11-02.1" });
  await ai.acceptImporterFiles(owner, ai.IMPORTER_CONSENT_VERSION);
});

beforeEach(async () => {
  await setBilling(false);
  await db.withHousehold(owner, async (tx) => {
    await tx.delete(smartImports);
    await tx.delete(cardPurchases);
    await tx.delete(transactions);
    await tx.delete(debtDocuments);
    await tx.delete(debts);
    await tx.delete(investments);
    await tx.delete(goals);
    await tx.delete(incomeSources);
    await tx.delete(cashflowPlans);
  });
  await db.withAdmin("limpa o uso", (admin) => admin.delete(db.aiUsage));
});

afterAll(async () => {
  await setBilling(false);
  await db.closeAllPools();
});

describe("aprovar", () => {
  it("nada é gravado antes da aprovação", async () => {
    const importId = await lotOf(owner, [
      ["extrato.ofx", encode(OFX([["a1", "-150.00", "MERCADO EXEMPLO"]]))],
    ]);
    const items = await read(importId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: "proposto", selected: true });
    expect(await countOf(transactions)).toBe(0);
  });

  it("aprovação parcial: grava o marcado, deixa o resto, e repetir não duplica", async () => {
    const importId = await lotOf(owner, [
      [
        "extrato.ofx",
        encode(
          OFX([
            ["p1", "-10.00", "PADARIA EXEMPLO"],
            ["p2", "-20.00", "FARMACIA EXEMPLO"],
            ["p3", "5000.00", "SALARIO EMPRESA EXEMPLO"],
          ]),
        ),
      ],
    ]);
    const items = await read(importId);
    await setFileAccount(importId, { accountId: bank });
    await db.withHousehold(owner, (tx) =>
      tx
        .update(smartImportItems)
        .set({ selected: false })
        .where(eq(smartImportItems.id, items[2]!.id)),
    );
    expect(await approveSmartImport(owner, importId)).toEqual({
      ok: true,
      saved: 2,
      existed: 0,
      failed: 0,
    });
    expect(await countOf(transactions)).toBe(2);

    // Clicar de novo: nada a fazer.
    expect(await approveSmartImport(owner, importId)).toEqual({ ok: false, code: "nada" });
    expect(await countOf(transactions)).toBe(2);

    // Dois cliques ao mesmo tempo também não duplicam.
    await db.withHousehold(owner, (tx) =>
      tx
        .update(smartImportItems)
        .set({ selected: true })
        .where(eq(smartImportItems.id, items[2]!.id)),
    );
    const results = await Promise.all([
      approveSmartImport(owner, importId),
      approveSmartImport(owner, importId),
    ]);
    expect(results.filter((result) => result.ok).length).toBeGreaterThan(0);
    expect(await countOf(transactions)).toBe(3);

    const rows = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.importId, importId)),
    );
    expect(rows.every((row) => row.status === "gravado")).toBe(true);
    expect(rows[0]).toMatchObject({ resultTable: "transactions", approvedBy: A.owner });
    const [lot] = await db.withHousehold(owner, (tx) => tx.select().from(smartImports));
    expect(lot!.status).toBe("concluido");
  });

  it("cada item fica ligado ao arquivo, e o mesmo arquivo sem conta vem como possível", async () => {
    const bytes = encode(OFX([["r1", "-30.00", "MERCADO EXEMPLO"]]));
    const first = await lotOf(owner, [["extrato.ofx", bytes]]);
    await read(first);
    await setFileAccount(first, { accountId: bank });
    await approveSmartImport(owner, first);

    const second = await lotOf(owner, [["extrato.ofx", bytes]]);
    const items = await read(second);
    expect(items[0]).toMatchObject({
      duplicate: "possivel",
      duplicateReason: "outra_conta",
      selected: false,
    });
    // Marcar à força também não duplica: a impressão digital segura.
    await setFileAccount(second, { accountId: bank });
    await db.withHousehold(owner, (tx) =>
      tx
        .update(smartImportItems)
        .set({ selected: true })
        .where(eq(smartImportItems.importId, second)),
    );
    expect(await approveSmartImport(owner, second)).toMatchObject({ saved: 0, failed: 1 });
    expect(await countOf(transactions)).toBe(1);
  });

  it("falha em um item não para os outros, e sem conta o item diz o que falta", async () => {
    const importId = await lotOf(owner, [
      ["extrato.ofx", encode(OFX([["f1", "-10.00", "PADARIA EXEMPLO"]]))],
      ["fatura.ofx", encode(CARD([["f2", "-99.00", "LOJA EXEMPLO"]]))],
    ]);
    await read(importId);
    // Só o extrato ganha conta; a fatura fica sem cartão.
    await db.withHousehold(owner, async (tx) => {
      await tx
        .update(smartImportFiles)
        .set({ accountId: bank })
        .where(eq(smartImportFiles.position, 0));
      await tx
        .update(smartImportFiles)
        .set({ cardId: null })
        .where(eq(smartImportFiles.position, 1));
    });
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 1, failed: 1 });
    const rows = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.importId, importId)),
    );
    expect(rows.find((row) => row.destination === "compra_cartao")).toMatchObject({
      status: "falhou",
      failure: "falta_dado",
    });

    // Corrigiu e tentou de novo: só o que faltava.
    await db.withHousehold(owner, (tx) =>
      tx.update(smartImportFiles).set({ cardId: card }).where(eq(smartImportFiles.position, 1)),
    );
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 1, failed: 0 });
    expect(await countOf(cardPurchases)).toBe(1);
    expect(await countOf(transactions)).toBe(1);
  });

  it("categoria de aporte identifica o aporte (savings.ts)", async () => {
    const importId = await lotOf(owner, [
      ["extrato.ofx", encode(OFX([["s1", "-500.00", "APLICACAO CDB"]]))],
    ]);
    await read(importId);
    await setFileAccount(importId, { accountId: bank });
    await approveSmartImport(owner, importId);
    const [row] = await db.withHousehold(owner, (tx) =>
      tx
        .select({ name: categories.name, position: categories.position, kind: categories.kind })
        .from(transactions)
        .innerJoin(categories, eq(categories.id, transactions.categoryId)),
    );
    expect(domain.savingsCategory(row!)).toBe("investimento");
  });

  it("contrato, consórcio, renda, previsão, meta e documento, cada um no seu lugar", async () => {
    const client = modelSays(
      answerOf("contrato_emprestimo", [
        {
          destino: "divida",
          descricao: "Financeira Exemplo",
          valor: "12000.00",
          taxa_mensal: "2.10",
          parcelas: "24",
          valor_parcela: "640.00",
          sistema: "price",
          data: "2027-01-10",
        },
        {
          destino: "consorcio",
          descricao: "Administradora Exemplo",
          valor: "60000.00",
          parcelas: "60",
          valor_parcela: "1200.00",
          data: "2027-01-15",
        },
        {
          destino: "renda",
          descricao: "Empresa Exemplo",
          subtipo: "clt",
          valor: "5000.00",
          dia: "5",
        },
        {
          destino: "previsao",
          descricao: "Seguro do carro",
          valor: "90.00",
          sentido: "despesa",
          dia: "10",
        },
        { destino: "meta", descricao: "Carro novo", valor: "90000.00" },
      ]),
    );
    const importId = await lotOf(owner, [
      ["contrato.csv", encode("campo;valor;obs\ncontrato;teste;x")],
    ]);
    const items = await read(importId, client);
    expect(items.map((item) => item.destination)).toEqual([
      "divida",
      "consorcio",
      "renda",
      "previsao",
      "meta",
      "documento",
    ]);
    await setFileAccount(importId, { accountId: bank });
    await db.withHousehold(owner, async (tx) => {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.kind, "receita"))
        .limit(1);
      const [item] = await tx
        .select()
        .from(smartImportItems)
        .where(eq(smartImportItems.destination, "renda"));
      await tx
        .update(smartImportItems)
        .set({ payload: { ...item!.payload, categoryId: category!.id } as never })
        .where(eq(smartImportItems.id, item!.id));
    });
    expect(await approveSmartImport(owner, importId)).toEqual({
      ok: true,
      saved: 6,
      existed: 0,
      failed: 0,
    });
    const debtRows = await db.withHousehold(owner, (tx) => tx.select().from(debts));
    const consortium = debtRows.find((row) => row.name === "Consórcio Administradora Exemplo")!;
    expect(consortium).toMatchObject({ system: "manual", monthlyRate: "0.0000" });
    expect(debtRows.find((row) => row.name === "Financeira Exemplo")).toMatchObject({
      system: "price",
    });
    const installments = await db.withHousehold(owner, (tx) =>
      tx.select().from(debtInstallments).where(eq(debtInstallments.debtId, consortium.id)),
    );
    expect(installments).toHaveLength(60);
    expect(installments[0]!.amount).toBe("1200.00");
    const inPlace = await db.withHousehold(owner, async (tx) => ({
      income: await tx.select().from(incomeSources),
      plan: await tx.select().from(cashflowPlans),
      goal: await tx.select().from(goals),
      file: await tx.select(smartImportFileMeta).from(smartImportFiles),
      documents: await tx
        .select({ id: debtDocuments.id, debtId: debtDocuments.debtId })
        .from(debtDocuments),
    }));
    expect(inPlace.income[0]).toMatchObject({ name: "Empresa Exemplo", amount: "5000.00" });
    expect(inPlace.plan[0]).toMatchObject({ description: "Seguro do carro", dayOfMonth: 10 });
    expect(inPlace.goal[0]).toMatchObject({ name: "Carro novo", targetAmount: "90000.00" });
    expect(inPlace.file[0]!.attachedAt).not.toBeNull();
    expect(inPlace.documents).toHaveLength(1);
    expect(await db.withHousehold(owner, (tx) => tx.select().from(db.people))).toHaveLength(0);
  });

  it("operações: nota e Negociação da mesma compra gravam uma vez só", async () => {
    const trade = {
      destino: "operacao",
      codigo_ativo: "ABCD3",
      operacao: "compra",
      data: "2026-03-05",
      quantidade: "100",
      preco_unitario: "10.00",
    };
    const first = await lotOf(owner, [["nota.txt", encode("primeira")]]);
    await read(first, modelSays(answerOf("nota_corretagem", [trade])));
    expect(await approveSmartImport(owner, first)).toMatchObject({ saved: 2, failed: 0 });

    const second = await lotOf(owner, [["negociacao.txt", encode("segunda")]]);
    const items = await read(second, modelSays(answerOf("negociacao_b3", [trade])));
    const again = items.find((item) => item.destination === "operacao")!;
    expect(again).toMatchObject({ duplicate: "ja_lancado", selected: false });
    await db.withHousehold(owner, (tx) =>
      tx.update(smartImportItems).set({ selected: true }).where(eq(smartImportItems.id, again.id)),
    );
    expect(await approveSmartImport(owner, second)).toMatchObject({ saved: 1, existed: 1 });
    const trades = await db.withHousehold(owner, (tx) => tx.select().from(investmentTrades));
    expect(trades).toHaveLength(1);
  });

  it("provento só entra em ativo da carteira", async () => {
    const item = {
      destino: "provento",
      codigo_ativo: "ABCD3",
      subtipo: "dividendo",
      data: "2026-10-01",
      bruto: "12.00",
    };
    const importId = await lotOf(owner, [["proventos.txt", encode("proventos")]]);
    await read(importId, modelSays(answerOf("proventos", [item])));
    await db.withHousehold(owner, async (tx) => {
      await tx
        .update(smartImportItems)
        .set({ selected: false })
        .where(eq(smartImportItems.destination, "documento"));
      await tx
        .update(smartImportItems)
        .set({ selected: true })
        .where(eq(smartImportItems.destination, "provento"));
    });
    expect(await approveSmartImport(owner, importId)).toMatchObject({ failed: 1 });
    const [refused] = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.destination, "provento")),
    );
    expect(refused!.failure).toBe("sem_ativo");
    await db.withHousehold(owner, (tx) =>
      tx.insert(investments).values({
        householdId: A.household,
        name: "ABCD",
        ticker: "ABCD3",
        assetClass: "acao",
      }),
    );
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 1, failed: 0 });
    expect(await approveSmartImport(owner, importId)).toEqual({ ok: false, code: "nada" });
    const rows = await db.withHousehold(owner, (tx) => tx.select().from(dividends));
    expect(rows[0]).toMatchObject({ gross: "12.00", source: "familia" });
  });
});

describe("revisão de segurança", () => {
  it("operações do modelo gravam as três certas, cada uma com o seu ativo", async () => {
    const trade = (ticker: string, quantidade: string, preco: string) => ({
      destino: "operacao",
      codigo_ativo: ticker,
      operacao: "compra",
      data: "2026-03-05",
      quantidade,
      preco_unitario: preco,
    });
    const client = modelSays(
      answerOf("nota_corretagem", [
        trade("PETR4", "10", "30.00"),
        trade("VALE3", "20", "60.00"),
        trade("ITUB4", "30", "25.00"),
      ]),
    );
    await db.withHousehold(owner, (tx) =>
      tx.insert(investments).values(
        ["PETR4", "VALE3", "ITUB4"].map((ticker) => ({
          householdId: A.household,
          name: ticker,
          ticker,
          assetClass: "acao" as const,
        })),
      ),
    );
    const importId = await lotOf(owner, [["nota.txt", encode("nota")]]);
    await read(importId, client);
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 4, failed: 0 });
    const rows = await db.withHousehold(owner, (tx) =>
      tx
        .select({
          ticker: investments.ticker,
          quantity: investmentTrades.quantity,
          price: investmentTrades.unitPrice,
        })
        .from(investmentTrades)
        .innerJoin(investments, eq(investments.id, investmentTrades.investmentId)),
    );
    expect(
      rows.map((row) => [row.ticker, Number(row.quantity), Number(row.price)]).toSorted(),
    ).toEqual([
      ["ITUB4", 30, 25],
      ["PETR4", 10, 30],
      ["VALE3", 20, 60],
    ]);
  });

  it("linha repetida é recusada, sem gravar operação trocada", async () => {
    const importId = await lotOf(owner, [["nota.txt", encode("linhas")]]);
    const client = modelSays(
      answerOf("nota_corretagem", [
        {
          destino: "operacao",
          codigo_ativo: "ABCD3",
          operacao: "compra",
          data: "2026-03-05",
          quantidade: "1",
          preco_unitario: "1.00",
        },
        {
          destino: "operacao",
          codigo_ativo: "WXYZ3",
          operacao: "compra",
          data: "2026-03-05",
          quantidade: "2",
          preco_unitario: "2.00",
        },
      ]),
    );
    const items = await read(importId, client);
    await db.withHousehold(owner, async (tx) => {
      for (const item of items.filter((row) => row.destination === "operacao")) {
        await tx
          .update(smartImportItems)
          .set({ payload: { ...item.payload, line: 1 } as never })
          .where(eq(smartImportItems.id, item.id));
      }
    });
    await approveSmartImport(owner, importId);
    const rows = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.destination, "operacao")),
    );
    expect(rows.every((row) => row.failure === "linha_repetida")).toBe(true);
    expect(await db.withHousehold(owner, (tx) => tx.select().from(investmentTrades))).toEqual([]);
  });

  it("nota sem código: o nome do papel vira código pelo catálogo, e a operação grava", async () => {
    await asWorker(() =>
      db.saveMarketAssets([
        {
          ticker: "NOTA3",
          name: "NOTA EXEMPLO ON NM",
          assetClass: "acao",
          sector: null,
          close: null,
        },
        { ticker: "NOTA4", name: "NOTA EXEMPLO PN", assetClass: "acao", sector: null, close: null },
      ]),
    );
    const byName = (descricao: string) => ({
      destino: "operacao",
      descricao,
      operacao: "compra",
      data: "2026-03-05",
      quantidade: "100",
      preco_unitario: "10.00",
    });
    const importId = await lotOf(owner, [["nota.txt", encode("nota por nome")]]);
    const items = await read(
      importId,
      modelSays(answerOf("nota_corretagem", [byName("NOTA EXEMPLO ON"), byName("OUTRA PN")])),
    );
    const trades = items.filter((item) => item.destination === "operacao");
    const found = trades.find(
      (item) => item.payload.destination === "operacao" && item.payload.ticker,
    );
    const unknown = trades.find((item) => item !== found)!;
    // Achou pelo nome: o código entra na proposta, a linha nasce nova e marcada.
    expect(found).toMatchObject({
      duplicate: "novo",
      selected: true,
      payload: { ticker: "NOTA3", title: "NOTA EXEMPLO ON" },
    });
    // Não achou: a dúvida diz que falta o código, em vez de "possível duplicado", e não nasce marcada.
    expect(unknown).toMatchObject({
      duplicate: "possivel",
      duplicateReason: "sem_codigo",
      selected: false,
      payload: { ticker: null },
    });
    await db.withHousehold(owner, (tx) =>
      tx
        .update(smartImportItems)
        .set({ selected: true })
        .where(eq(smartImportItems.id, unknown.id)),
    );
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 2, failed: 1 });
    const rows = await db.withHousehold(owner, (tx) =>
      tx
        .select({ ticker: investments.ticker, quantity: investmentTrades.quantity })
        .from(investmentTrades)
        .innerJoin(investments, eq(investments.id, investmentTrades.investmentId)),
    );
    expect(rows.map((row) => [row.ticker, Number(row.quantity)])).toEqual([["NOTA3", 100]]);
    const [refused] = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.id, unknown.id)),
    );
    // Falhou pelo motivo certo: a pessoa sabe que é o código que falta, e pode digitar na revisão.
    expect(refused!.failure).toBe("sem_codigo");
  });

  it("papel que a carteira não conhece deixa de fora só a própria linha", async () => {
    const trade = (ticker: string) => ({
      destino: "operacao",
      codigo_ativo: ticker,
      operacao: "compra",
      data: "2026-03-05",
      quantidade: "10",
      preco_unitario: "20.00",
    });
    await db.withHousehold(owner, (tx) =>
      tx.insert(investments).values({
        householdId: A.household,
        name: "ABCD",
        ticker: "ABCD3",
        assetClass: "acao",
      }),
    );
    const importId = await lotOf(owner, [["nota.txt", encode("nota com fii")]]);
    await read(
      importId,
      // Final 11 fora do catálogo: FII, ETF ou unit, ninguém sabe. Antes, a nota inteira falhava junto.
      modelSays(answerOf("nota_corretagem", [trade("ABCD3"), trade("ZZZZ11"), trade("WXYZ3")])),
    );
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 3, failed: 1 });
    const rows = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.destination, "operacao")),
    );
    const byTicker = new Map(
      rows.map((row) => [(row.payload as { ticker: string }).ticker, row] as const),
    );
    expect(byTicker.get("ZZZZ11")).toMatchObject({ status: "falhou", failure: "ativo_sem_tipo" });
    expect(byTicker.get("ABCD3")).toMatchObject({ status: "gravado" });
    expect(byTicker.get("WXYZ3")).toMatchObject({ status: "gravado" });
    const saved = await db.withHousehold(owner, (tx) =>
      tx.select({ ticker: investments.ticker }).from(investments),
    );
    expect(saved.map((row) => row.ticker).toSorted()).toEqual(["ABCD3", "WXYZ3"]);
  });

  it("pagamento de fatura: as compras e a baixa, sem contar duas vezes", async () => {
    const importId = await lotOf(owner, [
      ["extrato.ofx", encode(OFX([["pg", "-300.00", "PAGAMENTO FATURA CARTAO"]]))],
      [
        "fatura.ofx",
        encode(
          CARD([
            ["c1", "-100.00", "LOJA UM"],
            ["c2", "-200.00", "LOJA DOIS"],
          ]),
        ),
      ],
    ]);
    const items = await read(importId);
    const payment = items.find((item) => item.destination === "lancamento")!;
    expect(payment).toMatchObject({
      duplicate: "possivel",
      duplicateReason: "pagamento_fatura",
      selected: false,
    });
    await db.withHousehold(owner, async (tx) => {
      await tx
        .update(smartImportFiles)
        .set({ accountId: bank, cardId: card })
        .where(eq(smartImportFiles.importId, importId));
      await tx
        .update(smartImportItems)
        .set({ selected: true })
        .where(eq(smartImportItems.id, payment.id));
    });
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 3, failed: 0 });

    const seen = await db.withHousehold(owner, async (tx) => ({
      entries: await tx
        .select({
          amount: transactions.amount,
          name: categories.name,
          description: transactions.description,
        })
        .from(transactions)
        .innerJoin(categories, eq(categories.id, transactions.categoryId)),
      purchases: await tx.select().from(cardPurchases),
      paid: await tx.select().from(db.cardStatementPayments),
    }));
    expect(seen.purchases).toHaveLength(2);
    expect(seen.paid).toHaveLength(1);
    // A fatura é movimento de cartão, fora das despesas. Sobram 300 das compras, não 600.
    const plain = seen.entries.filter((row) => row.name !== domain.CARD_CATEGORY);
    expect(plain).toEqual([]);
    const spent = seen.purchases.reduce((acc, row) => acc.plus(row.amount), domain.money(0));
    expect(spent.toFixed(2)).toBe("300.00");
    expect(seen.entries.map((row) => row.amount)).toEqual(["300.00"]);
  });

  it("dá baixa na previsão também sem impressão digital", async () => {
    const categoryId = await db.withHousehold(owner, async (tx) => {
      const [row] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.kind, "despesa"))
        .limit(1);
      await tx.insert(cashflowPlans).values({
        householdId: A.household,
        accountId: bank,
        categoryId: row!.id,
        kind: "despesa",
        description: "Conta de luz",
        amount: "90.00",
        dayOfMonth: 10,
        startMonth: "2026-10",
      });
      return row!.id;
    });
    const importId = await lotOf(owner, [
      [
        "nota.xml",
        encode(
          `<infNFe><ide><dhEmi>2026-10-11T10:00:00-03:00</dhEmi></ide><emit><xNome>Luz Exemplo</xNome></emit><total><ICMSTot><vNF>90.00</vNF></ICMSTot></total></infNFe>`,
        ),
      ],
    ]);
    const items = await read(importId);
    await setFileAccount(importId, { accountId: bank });
    const item = items.find((row) => row.destination === "lancamento")!;
    await db.withHousehold(owner, (tx) =>
      tx
        .update(smartImportItems)
        .set({ payload: { ...item.payload, fingerprint: null, categoryId } as never })
        .where(eq(smartImportItems.id, item.id)),
    );
    await approveSmartImport(owner, importId);
    const rows = await db.withHousehold(owner, (tx) => tx.select().from(transactions));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ description: "Conta de luz", planMonth: "2026-10" });
  });

  it("dois lotes aprovados juntos não gravam a mesma compra duas vezes", async () => {
    const lot = async (id: string) => {
      const importId = await lotOf(owner, [
        [`${id}.ofx`, encode(CARD([[id, "-77.00", "LOJA CORRIDA"]]))],
      ]);
      await read(importId);
      await setFileAccount(importId, { cardId: card });
      await db.withHousehold(owner, (tx) =>
        tx
          .update(smartImportItems)
          .set({ selected: true, duplicate: "novo" })
          .where(eq(smartImportItems.importId, importId)),
      );
      return importId;
    };
    const [first, second] = [await lot("corrida-1"), await lot("corrida-2")];
    const results = await Promise.all([
      approveSmartImport(owner, first),
      approveSmartImport(owner, second),
    ]);
    expect(await countOf(cardPurchases)).toBe(1);
    const failed = results.reduce((acc, row) => acc + (row.ok ? row.failed : 0), 0);
    expect(failed).toBe(1);
    const rows = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.failure, "duplicado_agora")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ selected: false, duplicate: "possivel" });
  });

  it("duas compras iguais no mesmo arquivo gravam as duas, em pedaços diferentes", async () => {
    const lines = Array.from(
      { length: 205 },
      (_, index) => [`ig${index}`, "-10.00", "PADARIA EXEMPLO"] as [string, string, string],
    );
    const importId = await lotOf(owner, [["fatura.ofx", encode(CARD(lines))]]);
    await read(importId);
    await setFileAccount(importId, { cardId: card });
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 205, failed: 0 });
    expect(await countOf(cardPurchases)).toBe(205);
  });

  it("não aprova lote ainda em leitura", async () => {
    const importId = await lotOf(owner, [
      ["extrato.ofx", encode(OFX([["lendo", "-10.00", "PADARIA"]]))],
    ]);
    expect(await approveSmartImport(owner, importId)).toEqual({ ok: false, code: "lendo" });
  });

  it("desmarcar todos desmarca todos, mesmo com mais de 2.500 itens", async () => {
    const importId = await lotOf(owner, [["a.ofx", encode(OFX([["tudo", "-10.00", "PADARIA"]]))]]);
    await read(importId);
    const [file] = await db.withHousehold(owner, (tx) =>
      tx.select(smartImportFileMeta).from(smartImportFiles),
    );
    await db.withHousehold(owner, async (tx) => {
      const rows = Array.from({ length: 3_000 }, (_, index) => ({
        householdId: A.household,
        importId,
        fileId: file!.id,
        position: index + 1,
        destination: "lancamento" as const,
        confidence: "alta" as const,
        selected: true,
        payload: { destination: "documento", title: null } as never,
      }));
      for (let at = 0; at < rows.length; at += 500) {
        await tx.insert(smartImportItems).values(rows.slice(at, at + 500));
      }
    });
    sessionCtx = owner;
    expect(await clearAll(importId)).toEqual({ ok: true });
    const rows = await db.withHousehold(owner, (tx) =>
      tx.select({ selected: smartImportItems.selected }).from(smartImportItems),
    );
    expect(rows).toHaveLength(3_001);
    expect(rows.filter((row) => row.selected)).toEqual([]);
  });

  it("marcar todos pula o que é de módulo desligado", async () => {
    const client = modelSays(
      answerOf("contrato_emprestimo", [
        { destino: "divida", descricao: "Financeira Exemplo", valor: "100.00" },
      ]),
    );
    const importId = await lotOf(owner, [["c.txt", encode("módulo")]]);
    await read(importId, client);
    await setBilling(true);
    await onlyBase();
    sessionCtx = owner;
    await clearAll(importId);
    const blocked = domain.SMART_DESTINATIONS.filter((destination) => {
      const owner_ = domain.SMART_DESTINATION_MODULE[destination];
      return owner_ === "dividas";
    });
    const summary = await db.withHousehold(owner, (tx) =>
      agents.summarizeSmartItems(tx, importId, blocked),
    );
    await confirmAll(formOf({ importId, count: String(summary.markable) }));
    const rows = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.importId, importId)),
    );
    expect(rows.find((row) => row.destination === "divida")?.selected).toBe(false);
    expect(rows.find((row) => row.destination === "documento")?.selected).toBe(true);
  });

  it("editar pela tela mantém quantidade miúda", async () => {
    const client = modelSays(
      answerOf("nota_corretagem", [
        {
          destino: "operacao",
          codigo_ativo: "ABCD3",
          operacao: "compra",
          data: "2026-03-05",
          quantidade: "0.125",
          preco_unitario: "10.00",
        },
      ]),
    );
    const importId = await lotOf(owner, [["n.txt", encode("miúda")]]);
    const items = await read(importId, client);
    sessionCtx = owner;
    const item = items.find((row) => row.destination === "operacao")!;
    expect(await saveItem({ id: item.id, fields: { fees: "1.50" }, categoryId: null })).toEqual({
      ok: true,
    });
    const [row] = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.id, item.id)),
    );
    expect(row!.payload).toMatchObject({ quantity: "0.125", fees: "1.50", line: 1 });
  });
});

describe("segunda revisão", () => {
  /** N3: desmarcar e aprovar juntos passam pela mesma trava, em vez de se esperarem em ordens diferentes. */
  it("desmarcar tudo durante a aprovação não dá deadlock", async () => {
    const lines = Array.from(
      { length: 450 },
      (_, index) => [`dl${index}`, "-10.00", `LOJA ${index}`] as [string, string, string],
    );
    const importId = await lotOf(owner, [["fatura.ofx", encode(CARD(lines))]]);
    await read(importId);
    await setFileAccount(importId, { cardId: card });
    sessionCtx = owner;
    const results = await Promise.allSettled([
      approveSmartImport(owner, importId),
      clearAll(importId),
      clearAll(importId),
      approveSmartImport(owner, importId),
    ]);
    const refused = results.filter((row) => row.status === "rejected");
    expect(refused).toEqual([]);
    const rows = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.importId, importId)),
    );
    expect(rows.filter((row) => /40P01|deadlock/.test(row.failure ?? ""))).toEqual([]);
    expect(rows.filter((row) => row.status === "gravado").length).toBe(
      await countOf(cardPurchases),
    );
  });

  it("item gravado não vira falho se a aprovação repetir o pedaço", async () => {
    const importId = await lotOf(owner, [
      ["a.ofx", encode(OFX([["fx", "-10.00", "PADARIA EXEMPLO"]]))],
    ]);
    const [item] = await read(importId);
    await setFileAccount(importId, { accountId: bank });
    await approveSmartImport(owner, importId);
    await db.withHousehold(owner, (tx) => failItems(tx, [item!.id], "erro"));
    const [row] = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.id, item!.id)),
    );
    expect(row).toMatchObject({ status: "gravado", failure: null });
  });

  /** N4: marcado, mas fora da tela, não grava. */
  it("aprova só o que a pessoa pôde ver", async () => {
    const lines = Array.from(
      { length: domain.SMART_REVIEW_PAGE_SIZE + 5 },
      (_, index) => [`vi${index}`, "-10.00", `LOJA ${index}`] as [string, string, string],
    );
    const importId = await lotOf(owner, [["fatura.ofx", encode(CARD(lines))]]);
    await readOnly(importId);
    await setFileAccount(importId, { cardId: card });
    sessionCtx = owner;
    const page = await db.withHousehold(owner, (tx) => agents.listSmartItemsPage(tx, importId, 1));
    expect(page).toHaveLength(domain.SMART_REVIEW_PAGE_SIZE);
    await markSeen(
      importId,
      page.map((row) => row.id),
    );
    const before = await db.withHousehold(owner, (tx) =>
      agents.summarizeSmartItems(tx, importId, []),
    );
    expect(before).toMatchObject({ ready: 100, unseen: 5, markable: 105, markableUnseen: 5 });
    expect(domain.money(before.markableOut).toFixed(2)).toBe("1050.00");
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 100, failed: 0 });
    expect(await countOf(cardPurchases)).toBe(100);
    const left = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.status, "proposto")),
    );
    expect(left).toHaveLength(5);
    expect(left.every((row) => row.selected && !row.seen)).toBe(true);
  });

  it("Marcar todos vale só para a conta que a tela mostrou", async () => {
    const lines = Array.from(
      { length: 3 },
      (_, index) => [`mt${index}`, "-10.00", `LOJA ${index}`] as [string, string, string],
    );
    const importId = await lotOf(owner, [["fatura.ofx", encode(CARD(lines))]]);
    await readOnly(importId);
    await setFileAccount(importId, { cardId: card });
    sessionCtx = owner;
    await confirmAll(formOf({ importId, count: "2" }));
    expect(await approveSmartImport(owner, importId)).toEqual({ ok: false, code: "nada" });
    await confirmAll(formOf({ importId, count: "3" }));
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 3 });
  });

  it("item de baixa confiança nunca vem marcado", async () => {
    const client = modelSays(
      answerOf("outro", [
        {
          destino: "lancamento",
          confianca: "baixa",
          descricao: "Mercado Exemplo",
          data: "2026-10-01",
          valor: "10.00",
          sentido: "saida",
        },
      ]),
    );
    const importId = await lotOf(owner, [["baixa.txt", encode("baixa")]]);
    const items = await read(importId, client);
    expect(items.find((row) => row.destination === "lancamento")?.selected).toBe(false);
  });

  /** N5: a mesma linha em outra conta só é igual se a conta for a mesma. */
  it("sem conta definida, igualdade vira possível, e escolher a conta refaz o veredito", async () => {
    const earlier = await lotOf(owner, [
      ["antes.ofx", encode(OFX([["ac", "-55.00", "ACADEMIA EXEMPLO"]]))],
    ]);
    await read(earlier);
    await setFileAccount(earlier, { accountId: bank });
    await approveSmartImport(owner, earlier);
    const importId = await lotOf(owner, [
      ["extrato.ofx", encode(`${OFX([["ac", "-55.00", "ACADEMIA EXEMPLO"]])}\n`)],
    ]);
    const [first] = await read(importId);
    expect(first).toMatchObject({ duplicate: "possivel", duplicateReason: "outra_conta" });
    expect(first!.selected).toBe(false);

    const [file] = await db.withHousehold(owner, (tx) =>
      tx
        .select({ id: smartImportFiles.id })
        .from(smartImportFiles)
        .where(eq(smartImportFiles.importId, importId)),
    );
    sessionCtx = owner;
    expect(await setFileTarget({ fileId: file!.id, accountId: bank, cardId: "" })).toEqual({
      ok: true,
    });
    const items = await readOnly(importId);
    expect(items[0]).toMatchObject({ duplicate: "ja_lancado", selected: false });
  });

  /** N6: quem manda o extrato hoje e a fatura amanhã não conta a despesa duas vezes. */
  it("extrato num lote e fatura em outro: sugere a baixa e não dobra a despesa", async () => {
    const statement = await lotOf(owner, [
      ["extrato.ofx", encode(OFX([["pg2", "-300.00", "PAGAMENTO FATURA CARTAO"]]))],
    ]);
    await read(statement);
    await setFileAccount(statement, { accountId: bank });
    await approveSmartImport(owner, statement);
    expect(await countOf(transactions)).toBe(1);

    const invoice = await lotOf(owner, [
      [
        "fatura.ofx",
        encode(
          CARD([
            ["k1", "-100.00", "LOJA UM"],
            ["k2", "-200.00", "LOJA DOIS"],
          ]),
        ),
      ],
    ]);
    const items = await read(invoice);
    const payment = items.find((row) => row.destination === "lancamento")!;
    expect(payment).toMatchObject({
      duplicate: "possivel",
      duplicateReason: "pagamento_gravado",
      selected: false,
    });
    await setFileAccount(invoice, { cardId: card });
    await db.withHousehold(owner, (tx) =>
      tx
        .update(smartImportItems)
        .set({ selected: true })
        .where(eq(smartImportItems.id, payment.id)),
    );
    expect(await approveSmartImport(owner, invoice)).toMatchObject({ saved: 3, failed: 0 });

    const seen = await db.withHousehold(owner, async (tx) => ({
      entries: await tx
        .select({ amount: transactions.amount, name: categories.name })
        .from(transactions)
        .innerJoin(categories, eq(categories.id, transactions.categoryId)),
      paid: await tx.select().from(db.cardStatementPayments),
      item: await tx.select().from(smartImportItems).where(eq(smartImportItems.id, payment.id)),
    }));
    expect(seen.entries).toEqual([{ amount: "300.00", name: domain.CARD_CATEGORY }]);
    expect(seen.paid).toHaveLength(1);
    expect(seen.item[0]!.resultId).toBe(seen.paid[0]!.transactionId);
  });

  /** N7: a baixa cria o lançamento, e o item aponta para ele. */
  it("a baixa guarda o id do lançamento em result_id", async () => {
    await db.withHousehold(owner, async (tx) => {
      const [row] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.kind, "despesa"))
        .limit(1);
      await tx.insert(cashflowPlans).values({
        householdId: A.household,
        accountId: bank,
        categoryId: row!.id,
        kind: "despesa",
        description: "Conta de luz",
        amount: "90.00",
        dayOfMonth: 10,
        startMonth: "2026-10",
      });
    });
    const importId = await lotOf(owner, [
      [
        "nota.xml",
        encode(
          `<infNFe><ide><dhEmi>2026-10-11T10:00:00-03:00</dhEmi></ide><emit><xNome>Luz Exemplo</xNome></emit><total><ICMSTot><vNF>90.00</vNF></ICMSTot></total></infNFe>`,
        ),
      ],
    ]);
    const items = await read(importId);
    await setFileAccount(importId, { accountId: bank });
    const item = items.find((row) => row.destination === "lancamento")!;
    await approveSmartImport(owner, importId);
    const [row] = await db.withHousehold(owner, (tx) => tx.select().from(transactions));
    const [saved] = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.id, item.id)),
    );
    expect(saved).toMatchObject({
      status: "gravado",
      resultTable: "transactions",
      resultId: row!.id,
    });
  });

  /** N8: quem manda de novo e de novo sem aprovar para no teto, com recado. */
  it("teto de itens em aberto: recusa o envio e a leitura, com código próprio", async () => {
    const full = await lotOf(owner, [["a.ofx", encode(OFX([["te1", "-10.00", "PADARIA"]]))]]);
    await read(full);
    const next = await lotOf(owner, [["b.ofx", encode(OFX([["te2", "-10.00", "PADARIA"]]))]]);
    await ai.runSmartImport({
      ctx: owner,
      client: null,
      importId: next,
      limits,
      day,
      maxOpenItems: 1,
    });
    const files = await db.withHousehold(owner, (tx) => agents.listSmartFiles(tx, next));
    expect(files[0]).toMatchObject({ status: "falhou", failure: "teto_itens" });
    const open = await db.withHousehold(owner, (tx) => agents.countOpenSmartItems(tx));
    expect(open).toBe(1);
  });

  /** B2: arquivo em lote abandonado diz qual é, e descartar libera o reenvio. */
  it("arquivo em outro lote aberto aponta o lote, e descartar libera", async () => {
    const bytes = encode(OFX([["ab", "-10.00", "PADARIA ABANDONADA"]]));
    const first = await lotOf(owner, [["a.ofx", bytes]]);
    const checked = domain.checkSmartFile(bytes, "a.ofx");
    if (!checked.ok) throw new Error(checked.code);
    const attempt = await db.withHousehold(owner, async (tx) => {
      const other = (await agents.createSmartImport(tx, owner))!;
      const saved = await agents.saveSmartFile(tx, owner, {
        importId: other,
        fileName: "a.ofx",
        mediaType: checked.mediaType,
        bytes,
      });
      return { other, saved };
    });
    expect(attempt.saved).toMatchObject({ ok: false, code: "em_outro_lote", otherImportId: first });
    await db.withHousehold(owner, (tx) => agents.deleteSmartImport(tx, owner, first));
    const again = await db.withHousehold(owner, (tx) =>
      agents.saveSmartFile(tx, owner, {
        importId: attempt.other,
        fileName: "a.ofx",
        mediaType: checked.mediaType,
        bytes,
      }),
    );
    expect(again).toMatchObject({ ok: true });
  });
});

describe("liberação em etapas", () => {
  it("chave desligada: família comum recebe 404 nas actions", async () => {
    const importId = await lotOf(owner, [["a.ofx", encode(OFX([["fl", "-10.00", "PADARIA"]]))]]);
    await read(importId);
    sessionCtx = owner;
    gate.on = false;
    gate.admin = false;
    await expect(clearAll(importId)).rejects.toThrow("NEXT_NOT_FOUND");
    gate.admin = true;
    await expect(clearAll(importId)).resolves.toEqual({ ok: true });
    gate.on = true;
    gate.admin = false;
    await expect(clearAll(importId)).resolves.toEqual({ ok: true });
  });
});

describe("quem aprova", () => {
  it("visualizador e criança leem, mas não aprovam, nem pela RLS", async () => {
    const importId = await lotOf(owner, [
      ["extrato.ofx", encode(OFX([["v1", "-10.00", "PADARIA EXEMPLO"]]))],
    ]);
    await read(importId);
    await setFileAccount(importId, { accountId: bank });
    for (const ctx of [viewer, child]) {
      expect(await approveSmartImport(ctx, importId)).toEqual({
        ok: false,
        code: "somente_leitura",
      });
      await db.withHousehold(ctx, async (tx) => {
        expect(await agents.listSmartItems(tx, importId)).toHaveLength(1);
      });
      await expect(
        db.withHousehold(ctx, (tx) =>
          tx.update(smartImportItems).set({ selected: false }).returning(),
        ),
      ).resolves.toEqual([]);
    }
    expect(await countOf(transactions)).toBe(0);
  });

  it("outra família não aprova o lote dos outros", async () => {
    const importId = await lotOf(owner, [
      ["extrato.ofx", encode(OFX([["o1", "-10.00", "PADARIA EXEMPLO"]]))],
    ]);
    await read(importId);
    expect(await approveSmartImport(other, importId)).toEqual({ ok: false, code: "nada" });
    expect(await countOf(transactions)).toBe(0);
  });
});

describe("plano", () => {
  it("módulo desligado: o item aparece, não nasce marcado e não grava", async () => {
    const client = modelSays(
      answerOf("contrato_emprestimo", [
        {
          destino: "divida",
          descricao: "Financeira Exemplo",
          valor: "12000.00",
          taxa_mensal: "2.10",
          parcelas: "24",
          sistema: "price",
          data: "2027-01-10",
        },
      ]),
    );
    const importId = await lotOf(owner, [["contrato.txt", encode("contrato")]]);
    await read(importId, client);
    await setFileAccount(importId, { accountId: bank });
    await setBilling(true);
    await onlyBase();
    await db.withHousehold(owner, (tx) =>
      tx
        .update(smartImportItems)
        .set({ selected: true })
        .where(eq(smartImportItems.importId, importId)),
    );
    expect(await approveSmartImport(owner, importId)).toMatchObject({ saved: 1, failed: 1 });
    const rows = await db.withHousehold(owner, (tx) =>
      tx.select().from(smartImportItems).where(eq(smartImportItems.importId, importId)),
    );
    expect(rows.find((row) => row.destination === "divida")).toMatchObject({
      status: "falhou",
      failure: "modulo_desligado",
    });
    expect(await countOf(debts)).toBe(0);
    // O documento é Base: entra.
    expect(rows.find((row) => row.destination === "documento")?.status).toBe("gravado");
  });

  it("sem o módulo Assistente, o portão fecha, e as regras seguem", async () => {
    await setBilling(true);
    await onlyBase();
    expect(await ai.importerGate({ ctx: owner, limits, day })).toBe("sem_modulo");
  });

  it("passou do limite de lançamentos: diz quantos cabem e nada grava", async () => {
    await setBilling(true);
    await onlyBase("50");
    const lines = Array.from(
      { length: 51 },
      (_, index) =>
        [`q${index}`, `-${index + 1}.00`, `PADARIA ${index}`] as [string, string, string],
    );
    const importId = await lotOf(owner, [["extrato.ofx", encode(OFX(lines))]]);
    await read(importId);
    await setFileAccount(importId, { accountId: bank });
    expect(await approveSmartImport(owner, importId)).toEqual({
      ok: false,
      code: "cota",
      left: 50,
    });
    expect(await countOf(transactions)).toBe(0);
  });
});

describe("arquivo", () => {
  it("apagar o lote leva arquivos e propostas, e deixa o que foi aprovado", async () => {
    const importId = await lotOf(owner, [
      ["extrato.ofx", encode(OFX([["z1", "-10.00", "PADARIA EXEMPLO"]]))],
    ]);
    await read(importId);
    await setFileAccount(importId, { accountId: bank });
    await approveSmartImport(owner, importId);
    await db.withHousehold(owner, (tx) => agents.deleteSmartImport(tx, owner, importId));
    expect(await db.withHousehold(owner, (tx) => tx.select().from(smartImportItems))).toEqual([]);
    expect(await countOf(transactions)).toBe(1);
  });

  it("exportar traz os metadados, sem o conteúdo", async () => {
    const importId = await lotOf(owner, [
      ["extrato.ofx", encode(OFX([["e1", "-10.00", "PADARIA EXEMPLO"]]))],
    ]);
    await read(importId);
    const out = await db.withHousehold(owner, (tx) => db.exportHousehold(tx));
    expect(out.smart_imports).toHaveLength(1);
    expect(out.smart_import_items).toHaveLength(1);
    expect(out.smart_import_files![0]).toMatchObject({ content: db.SMART_FILE_EXPORT_NOTE });
  });

  it("lote vencido sem aprovação some; com aprovação, fica", async () => {
    const stale = await lotOf(owner, [["a.ofx", encode(OFX([["t1", "-1.00", "PADARIA"]]))]]);
    const kept = await lotOf(owner, [["b.ofx", encode(OFX([["t2", "-2.00", "PADARIA"]]))]]);
    await read(stale);
    await read(kept);
    await setFileAccount(kept, { accountId: bank });
    await approveSmartImport(owner, kept);
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(await db.withHousehold(owner, (tx) => agents.purgeSmartImports(tx, later))).toBe(1);
    const rows = await db.withHousehold(owner, (tx) => tx.select().from(smartImports));
    expect(rows.map((row) => row.id)).toEqual([kept]);
  });

  it("lote aprovado e lido de novo continua aprovado, e não entra na limpeza", async () => {
    const importId = await lotOf(owner, [
      ["um.ofx", encode(OFX([["k1", "-1.00", "PADARIA"]]))],
      ["dois.pdf", encode("%PDF-1.7 corrompido")],
    ]);
    await read(importId);
    await setFileAccount(importId, { accountId: bank });
    await approveSmartImport(owner, importId);
    const broken = await db.withHousehold(owner, (tx) =>
      tx.select(smartImportFileMeta).from(smartImportFiles).where(eq(smartImportFiles.position, 1)),
    );
    await db.withHousehold(owner, (tx) => agents.requeueSmartFile(tx, owner, broken[0]!.id));
    await read(importId);
    const [lot] = await db.withHousehold(owner, (tx) => tx.select().from(smartImports));
    expect(lot!.status).toBe("concluido");
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(await db.withHousehold(owner, (tx) => agents.purgeSmartImports(tx, later))).toBe(0);
  });

  it("auditoria registra quem aprovou, sem dado", async () => {
    const importId = await lotOf(owner, [
      ["extrato.ofx", encode(OFX([["au", "-10.00", "PADARIA EXEMPLO"]]))],
    ]);
    await read(importId);
    await setFileAccount(importId, { accountId: bank });
    await approveSmartImport(owner, importId);
    const rows = await db.withHousehold(owner, (tx) => tx.select().from(auditLog));
    expect(rows.some((row) => row.action === "approve" && row.entity === "smart_imports")).toBe(
      true,
    );
  });
});
