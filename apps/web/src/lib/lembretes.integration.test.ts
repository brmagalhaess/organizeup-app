// Lembretes por e-mail (ADR-0039), contra um Postgres real com RLS. Os e-mails caem num arquivo de captura,
// como no e2e. Tudo fictício.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { TenantContext } from "@organizeup/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string; worker: string; admin: string };
  }
}

const urls = inject("dbUrls");
process.env.DATABASE_URL = urls.app;
process.env.ADMIN_DATABASE_URL = urls.admin;
process.env.BETTER_AUTH_URL = "https://app.example.test";
const folder = mkdtempSync(join(tmpdir(), "lembretes-"));
const capture = join(folder, "emails.jsonl");
process.env.EMAIL_CAPTURE_FILE = capture;

vi.mock("server-only", () => ({}));
// Quem administra o serviço vem do ambiente; aqui o teste escolhe.
const admins = new Set<string>();
vi.mock("@/lib/session", () => ({
  isServiceAdmin: (person: { id: string }) => admins.has(person.id),
}));

const db = await import("@organizeup/db");
const reminders = await import("@/lib/reminders");

const { accounts, cashflowPlans, categories, emailReminders, transactions } = db;
const { household, householdMember, householdSettings, retirementPlan, user } = db;

const H = "hh-lembretes";
const OWNER = "user-lembretes-dona";
const VIEWER = "user-lembretes-leitor";
const UNVERIFIED = "user-lembretes-sem-email";
const OTHER_H = "hh-lembretes-2";
const OTHER = "user-lembretes-outra";

// Quarta, 11 de novembro de 2026, de manhã e no fim da tarde em Brasília.
const MORNING = new Date("2026-11-11T09:00:00Z");
const EVENING = new Date("2026-11-11T21:00:00Z");
const NEXT_MORNING = new Date("2026-11-12T09:00:00Z");

let owner: TenantContext;
let viewer: TenantContext;
let bank = "";
let expense = "";

// A conexão é a da web de verdade (`ou_app`): o teste falha se o lembrete precisar de mais do que ela tem.
const inH = <T>(fn: Parameters<typeof db.withHousehold<T>>[1]) => db.withHousehold(owner, fn);
interface Captured {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
}
const sent = (): Captured[] => {
  try {
    return (
      readFileSync(capture, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Captured)
        // O formato de moeda usa espaço que não quebra: aqui vira espaço comum, para comparar.
        .map((email) => ({ ...email, text: email.text.replaceAll("\u00a0", " ") }))
    );
  } catch {
    return [];
  }
};
const clear = () => rmSync(capture, { force: true });
const session = async (id: string, householdId = H) => {
  const made = await db.fromSession({
    user: { id },
    session: { activeOrganizationId: householdId },
  });
  if (!made) throw new Error("sem contexto");
  return made;
};
const spend = (description: string, createdBy: string | null, createdAt: Date, mark?: string) =>
  inH((tx) =>
    tx.insert(transactions).values({
      householdId: H,
      accountId: bank,
      categoryId: expense,
      kind: "despesa",
      description,
      amount: "42.00",
      occurredOn: "2026-11-11",
      status: "realizado",
      createdBy,
      createdAt,
      importFingerprint: mark ?? null,
    }),
  );

beforeAll(async () => {
  await db.withAdmin("seed do teste de lembretes", async (admin) => {
    await admin.insert(user).values([
      { id: OWNER, name: "Dona Silva", email: "dona-lembretes@example.com", emailVerified: true },
      { id: VIEWER, name: "Leitor", email: "leitor-lembretes@example.com", emailVerified: true },
      { id: UNVERIFIED, name: "Sem", email: "sem-lembretes@example.com", emailVerified: false },
      { id: OTHER, name: "Outra", email: "outra-lembretes@example.com", emailVerified: true },
    ]);
    await admin.insert(household).values([
      { id: H, name: "Casa dos Lembretes", slug: "hh-lembretes" },
      { id: OTHER_H, name: "Outra Casa", slug: "hh-lembretes-2" },
    ]);
    await admin.insert(householdMember).values([
      { id: "m-lemb-1", organizationId: H, userId: OWNER, role: "owner" },
      { id: "m-lemb-2", organizationId: H, userId: VIEWER, role: "viewer" },
      { id: "m-lemb-3", organizationId: H, userId: UNVERIFIED, role: "adult" },
      { id: "m-lemb-4", organizationId: OTHER_H, userId: OTHER, role: "owner" },
    ]);
  });
  owner = await session(OWNER);
  viewer = await session(VIEWER);
  await inH(async (tx) => {
    await tx.insert(householdSettings).values({ householdId: H });
    const [account] = await tx
      .insert(accounts)
      .values({ householdId: H, name: "Banco" })
      .returning({ id: accounts.id });
    bank = account!.id;
    const [category] = await tx
      .insert(categories)
      .values({ householdId: H, name: "Moradia", kind: "despesa" })
      .returning({ id: categories.id });
    expense = category!.id;
    // Luz vence no dia 11 (hoje) e a internet no dia 14, que é o último dia da antecedência padrão.
    await tx.insert(cashflowPlans).values([
      {
        householdId: H,
        accountId: bank,
        categoryId: expense,
        kind: "despesa",
        description: "Luz",
        amount: "210.00",
        dayOfMonth: 11,
        startMonth: "2026-11",
      },
      {
        householdId: H,
        accountId: bank,
        categoryId: expense,
        kind: "despesa",
        description: "Internet",
        amount: "120.00",
        dayOfMonth: 14,
        startMonth: "2026-11",
      },
    ]);
  });
  await db.withHousehold(await session(OTHER, OTHER_H), (tx) =>
    tx.insert(householdSettings).values({ householdId: OTHER_H }),
  );
});

beforeEach(clear);

afterAll(async () => {
  rmSync(folder, { recursive: true, force: true });
  await db.closeAllPools();
});

describe("lembretes por e-mail", () => {
  it("sem escolha guardada vale o padrão, e cada login guarda e vê só a sua linha", async () => {
    expect(await reminders.loadReminderPrefs(owner)).toMatchObject({
      enabled: true,
      bills: true,
      income: true,
      dividends: true,
      expenses: true,
      retirement: true,
      daysAhead: 3,
      dailySentOn: null,
    });
    // Quem só lê a família também escolhe o que recebe.
    await reminders.saveReminderPrefs(viewer, {
      enabled: true,
      bills: true,
      income: false,
      dividends: false,
      expenses: true,
      retirement: true,
      daysAhead: 99,
    });
    expect(await reminders.loadReminderPrefs(viewer)).toMatchObject({
      income: false,
      daysAhead: 7,
    });
    expect(await reminders.loadReminderPrefs(owner)).toMatchObject({ income: true, daysAhead: 3 });
    const mine = await db.withHousehold(owner, (tx) => tx.select().from(emailReminders));
    expect(mine).toEqual([]);
    // A linha de outra pessoa não se altera nem com o filtro aberto.
    const changed = await db.withHousehold(owner, (tx) =>
      tx.update(emailReminders).set({ enabled: false }).returning({ id: emailReminders.id }),
    );
    expect(changed).toEqual([]);
    await reminders.saveReminderPrefs(viewer, {
      enabled: true,
      bills: true,
      income: true,
      dividends: true,
      expenses: true,
      retirement: true,
      daysAhead: 3,
    });
  });

  it("com a chave desligada, só quem administra o serviço recebe", async () => {
    // Dia 8: a luz do dia 11 acabou de entrar na janela de três dias.
    const early = new Date("2026-11-08T09:00:00Z");
    expect(await reminders.sendAllReminders(early)).toMatchObject({ ok: 0, failed: 0 });
    expect(sent()).toEqual([]);
    admins.add(OWNER);
    expect(await reminders.sendAllReminders(early)).toMatchObject({ ok: 1, households: 1 });
    const emails = sent();
    expect(emails.map((email) => email.to)).toEqual(["dona-lembretes@example.com"]);
    expect(emails[0]!.subject).toBe("Hoje no OrganizeUp: 1 conta a pagar");
    expect(emails[0]!.text).toContain("Luz: R$ 210,00 (Conta fixa · vence em 11/11)");
    admins.clear();
    // Daqui em diante, ligada para todos, como o painel faz.
    await db.withAdmin("teste: liga os lembretes", (admin) =>
      admin
        .update(db.featureFlags)
        .set({ enabled: true })
        .where(db.eq(db.featureFlags.key, db.FLAG_KEYS.emailReminders)),
    );
    expect((await db.readPlatformFlags()).emailRemindersEnabled).toBe(true);
  });

  it("a rodada manda o resumo do dia para quem tem e-mail confirmado, uma vez só", async () => {
    // Gasto digitado pelo leitor: é novidade para a dona, e não para ele.
    await spend("Padaria do bairro", VIEWER, new Date("2026-11-11T08:00:00Z"));
    const counts = await reminders.sendAllReminders(MORNING);
    expect(counts).toMatchObject({ ok: 2, failed: 0, applied: 2 });
    const emails = sent();
    expect(emails.map((email) => email.to).sort()).toEqual([
      "dona-lembretes@example.com",
      "leitor-lembretes@example.com",
    ]);
    const toOwner = emails.find((email) => email.to.startsWith("dona"))!;
    expect(toOwner.template).toBe("lembrete");
    expect(toOwner.subject).toBe("Hoje no OrganizeUp: 2 contas a pagar e 1 gasto novo");
    expect(toOwner.text).toContain("Olá, Dona!");
    expect(toOwner.text).toContain("Casa dos Lembretes");
    expect(toOwner.text).toContain("Luz: R$ 210,00 (Conta fixa · vence hoje)");
    expect(toOwner.text).toContain("Internet: R$ 120,00 (Conta fixa · vence em 14/11)");
    expect(toOwner.text).toContain("Padaria do bairro");
    expect(toOwner.text).toContain("https://app.example.test/app/notificacoes");
    const toViewer = emails.find((email) => email.to.startsWith("leitor"))!;
    expect(toViewer.subject).toBe("Hoje no OrganizeUp: 2 contas a pagar");
    expect(toViewer.text).not.toContain("Padaria");

    // De novo no mesmo dia, sem nada novo: ninguém recebe outro.
    clear();
    expect(await reminders.sendAllReminders(MORNING)).toMatchObject({ ok: 0, failed: 0 });
    expect(sent()).toEqual([]);
    expect(await reminders.loadReminderPrefs(owner)).toMatchObject({ dailySentOn: "2026-11-11" });
  });

  it("gasto que chega pelo banco depois vira um e-mail só de gastos novos", async () => {
    // Trazido pela conexão da dona: tem a marca do banco, então ela também é avisada.
    await spend("UBER VIAGEM", OWNER, new Date("2026-11-11T18:00:00Z"), "ofx:id:pluggy:l1#0");
    expect(await reminders.sendAllReminders(EVENING)).toMatchObject({ ok: 2 });
    const emails = sent();
    expect(emails).toHaveLength(2);
    for (const email of emails) {
      expect(email.subject).toBe("Gastos novos no OrganizeUp: 1 gasto novo");
      expect(email.text).toContain("UBER VIAGEM");
      expect(email.text).not.toContain("Luz");
    }
    clear();
    expect(await reminders.sendAllReminders(EVENING)).toMatchObject({ ok: 0 });
  });

  it("quem desligou não recebe, e conta vencida ontem ainda em aberto volta no resumo", async () => {
    await reminders.saveReminderPrefs(owner, {
      enabled: false,
      bills: true,
      income: true,
      dividends: true,
      expenses: true,
      retirement: true,
      daysAhead: 3,
    });
    expect(await reminders.sendAllReminders(NEXT_MORNING)).toMatchObject({ ok: 1 });
    const emails = sent();
    expect(emails.map((email) => email.to)).toEqual(["leitor-lembretes@example.com"]);
    expect(emails[0]!.text).toContain("Luz: R$ 210,00 (Conta fixa · venceu em 11/11)");
    expect(emails[0]!.html).toContain("Atrasada");
  });

  it("o resumo da aposentadoria sai uma vez por mês, para quem tem plano com dados", async () => {
    const recipient = {
      email: "leitor-lembretes@example.com",
      name: "Leitor",
      locale: "pt-BR" as const,
    };
    // Sem plano preenchido não há o que resumir, nem pelo botão.
    expect(
      await reminders.sendRetirementSummary(viewer, recipient, { force: true, now: NEXT_MORNING }),
    ).toBe("nada");
    await inH(async (tx) => {
      await tx.update(householdSettings).set({ retirementYear: 2045 });
      await tx.insert(retirementPlan).values({
        householdId: H,
        targetIncome: "8000.00",
        expectedYield: "8.00",
        monthlyContribution: "1500.00",
      });
    });
    // A dona desligou tudo: só o leitor recebe. O resumo do dia dele já saiu hoje.
    expect(await reminders.sendAllReminders(NEXT_MORNING)).toMatchObject({ ok: 1, failed: 0 });
    const [first] = sent();
    expect(first!.to).toBe("leitor-lembretes@example.com");
    expect(first!.subject).toBe("Seu plano de aposentadoria: resumo de novembro");
    expect(first!.text).toContain("Renda desejada: R$ 8.000,00 (por mês)");
    expect(first!.text).toContain("- Ano da meta: 2045");
    expect(first!.text).toContain("- Aporte de hoje: R$ 1.500,00 por mês");
    clear();
    expect(await reminders.sendAllReminders(NEXT_MORNING)).toMatchObject({ ok: 0 });
    // No mês seguinte sai de novo.
    expect(await reminders.sendAllReminders(new Date("2026-12-01T09:00:00Z"))).toMatchObject({
      ok: 1,
    });
    expect(sent().map((email) => email.subject)).toEqual([
      "Seu plano de aposentadoria: resumo de dezembro",
    ]);
    // Desligando só este aviso, o botão ainda envia, e a rodada não.
    await reminders.saveReminderPrefs(viewer, {
      enabled: true,
      bills: true,
      income: true,
      dividends: true,
      expenses: true,
      retirement: false,
      daysAhead: 3,
    });
    clear();
    expect(await reminders.sendAllReminders(new Date("2027-01-02T09:00:00Z"))).toMatchObject({
      ok: 0,
    });
    expect(
      await reminders.sendRetirementSummary(viewer, recipient, {
        force: true,
        now: new Date("2027-01-02T09:00:00Z"),
      }),
    ).toBe("enviado");
  });

  it("o botão da tela envia mesmo desligado e não mexe nas marcas do aviso", async () => {
    const before = await reminders.loadReminderPrefs(owner);
    const outcome = await reminders.sendReminder(
      owner,
      { email: "dona-lembretes@example.com", name: "Dona Silva", locale: "en" },
      { force: true, now: NEXT_MORNING },
    );
    expect(outcome).toBe("enviado");
    const [email] = sent();
    expect(email!.subject).toMatch(/^Today on OrganizeUp/);
    expect(await reminders.loadReminderPrefs(owner)).toEqual(before);
    // Sem o botão, desligado é desligado.
    expect(
      await reminders.sendReminder(
        owner,
        { email: "dona-lembretes@example.com", name: "Dona Silva", locale: "pt-BR" },
        { now: NEXT_MORNING },
      ),
    ).toBe("desligado");
  });

  it("uma família não aparece no e-mail de outra, e sem nada por perto não sai e-mail", async () => {
    const other = await session(OTHER, OTHER_H);
    expect(
      await reminders.sendReminder(
        other,
        { email: "outra-lembretes@example.com", name: "Outra", locale: "pt-BR" },
        { now: MORNING },
      ),
    ).toBe("nada");
    const outcome = await reminders.sendReminder(
      other,
      { email: "outra-lembretes@example.com", name: "Outra", locale: "pt-BR" },
      { force: true, now: MORNING },
    );
    expect(outcome).toBe("enviado");
    const [email] = sent();
    expect(email!.text).toContain("Nada vence nem entra nos próximos dias");
    expect(email!.text).not.toContain("Luz");
    expect(email!.text).not.toContain("Casa dos Lembretes");
  });

  it("sem serviço de e-mail, a rodada não envia e ainda registra a contagem", async () => {
    delete process.env.EMAIL_CAPTURE_FILE;
    try {
      expect(await reminders.sendAllReminders(MORNING)).toMatchObject({ ok: 0, failed: 0 });
      expect(
        await reminders.sendReminder(
          owner,
          { email: "dona-lembretes@example.com", name: "Dona", locale: "pt-BR" },
          { force: true },
        ),
      ).toBe("sem_email");
    } finally {
      process.env.EMAIL_CAPTURE_FILE = capture;
    }
  });
});
