import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ hasAgentRunToday: vi.fn(), readPlatformFlags: vi.fn() }));
const fila = vi.hoisted(() => ({
  DICAS_AGENT: "dicas",
  MERCADO_AGENT: "mercado",
  queueAgent: vi.fn(),
}));
// Bancos roda na própria web, depois da resposta: aqui só interessa que a rodada foi pedida.
const banks = vi.hoisted(() => ({ syncAllBanks: vi.fn(), tasks: [] as Array<() => unknown> }));
vi.mock("@organizeup/db", () => db);
// Lembretes também rodam na web, depois de Bancos ou sozinhos.
const reminders = vi.hoisted(() => ({ sendAllReminders: vi.fn() }));
vi.mock("@/lib/bank-auto", () => ({ syncAllBanks: banks.syncAllBanks }));
vi.mock("@/lib/reminders", () => reminders);
vi.mock("@/lib/diagnostics", () => ({ reportActionFailure: vi.fn() }));
vi.mock("next/server", () => ({ after: (task: () => unknown) => banks.tasks.push(task) }));
vi.mock("@/app/admin/fila", () => fila);

const { POST } = await import("./route");

const TOKEN = "t".repeat(40);
const url = "https://site.example.com/api/ops/agents";
const post = (payload: unknown, token = TOKEN) =>
  POST(
    new Request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }),
  );

beforeEach(() => {
  process.env.OPS_TOKEN_HASHES = createHash("sha256").update(TOKEN).digest("hex");
  vi.clearAllMocks();
  db.readPlatformFlags.mockResolvedValue({ maintenance: false, disabledAgents: [] });
  db.hasAgentRunToday.mockResolvedValue(false);
  fila.queueAgent.mockResolvedValue("job");
  reminders.sendAllReminders.mockResolvedValue({ ok: 0 });
});

describe("POST /api/ops/agents", () => {
  it("recusa sem token", async () => {
    expect((await post({ agent: "metas" }, "x".repeat(40))).status).toBe(401);
    expect(fila.queueAgent).not.toHaveBeenCalled();
  });

  it("recusa agente que não existe", async () => {
    expect((await post({ agent: "outro" })).status).toBe(400);
  });

  it("acorda um agente", async () => {
    const response = await post({ agent: "metas" });
    expect(await response.json()).toMatchObject({ queued: true, agent: "metas" });
    expect(fila.queueAgent).toHaveBeenCalledWith("metas");
  });

  it("o nome antigo do agente de IA continua aceito", async () => {
    const response = await post({ agent: "categorias_ia" });
    expect(await response.json()).toMatchObject({ queued: true, agent: "categorias-ia" });
    expect(fila.queueAgent).toHaveBeenCalledWith("categorias-ia");
  });

  it("respeita a manutenção e o interruptor do painel", async () => {
    db.readPlatformFlags.mockResolvedValue({ maintenance: true, disabledAgents: [] });
    expect(await (await post({ agent: "metas" })).json()).toMatchObject({ reason: "manutencao" });
    db.readPlatformFlags.mockResolvedValue({ maintenance: false, disabledAgents: ["metas"] });
    expect(await (await post({ agent: "metas" })).json()).toMatchObject({ reason: "desligado" });
    expect(fila.queueAgent).not.toHaveBeenCalled();
  });

  it("bancos roda na web, depois da resposta, e não vai para a fila do worker", async () => {
    banks.tasks.length = 0;
    banks.syncAllBanks.mockResolvedValue({ households: 1 });
    const response = await post({ agent: "bancos" });
    expect(await response.json()).toMatchObject({ queued: true, agent: "bancos", reason: null });
    expect(fila.queueAgent).not.toHaveBeenCalled();
    expect(banks.syncAllBanks).not.toHaveBeenCalled();
    expect(reminders.sendAllReminders).not.toHaveBeenCalled();
    await banks.tasks[0]!();
    expect(banks.syncAllBanks).toHaveBeenCalledTimes(1);
    // O lembrete sai depois de Bancos, para o gasto que acabou de chegar entrar no aviso.
    expect(reminders.sendAllReminders).toHaveBeenCalledTimes(1);
  });

  it("falha de bancos não impede os lembretes, e lembretes desligados não saem junto", async () => {
    banks.tasks.length = 0;
    banks.syncAllBanks.mockRejectedValue(new Error("fora do ar"));
    await post({ agent: "bancos" });
    await banks.tasks[0]!();
    expect(reminders.sendAllReminders).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    banks.tasks.length = 0;
    banks.syncAllBanks.mockResolvedValue({ households: 1 });
    db.readPlatformFlags.mockResolvedValue({ maintenance: false, disabledAgents: ["lembretes"] });
    await post({ agent: "bancos" });
    await banks.tasks[0]!();
    expect(banks.syncAllBanks).toHaveBeenCalledTimes(1);
    expect(reminders.sendAllReminders).not.toHaveBeenCalled();
    expect(await (await post({ agent: "lembretes" })).json()).toMatchObject({
      reason: "desligado",
    });
  });

  it("lembretes também podem ser acordados sozinhos, sem passar pela fila do worker", async () => {
    banks.tasks.length = 0;
    const response = await post({ agent: "lembretes" });
    expect(await response.json()).toMatchObject({ queued: true, agent: "lembretes", reason: null });
    expect(fila.queueAgent).not.toHaveBeenCalled();
    await banks.tasks[0]!();
    expect(reminders.sendAllReminders).toHaveBeenCalledTimes(1);
    expect(banks.syncAllBanks).not.toHaveBeenCalled();
  });

  it("bancos também respeita o interruptor do painel", async () => {
    banks.tasks.length = 0;
    db.readPlatformFlags.mockResolvedValue({ maintenance: false, disabledAgents: ["bancos"] });
    expect(await (await post({ agent: "bancos" })).json()).toMatchObject({ reason: "desligado" });
    expect(banks.tasks).toHaveLength(0);
  });

  it("não gasta cota de mercado de novo no mesmo dia", async () => {
    db.hasAgentRunToday.mockResolvedValue(true);
    const response = await post({ agent: "mercado" });
    expect(await response.json()).toMatchObject({ queued: false, reason: "ja_rodou" });
    expect(fila.queueAgent).not.toHaveBeenCalled();
  });
});
