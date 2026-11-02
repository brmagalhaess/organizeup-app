// Envio do importador: o corpo é lido contando, e nada acima do limite chega à memória (ADR-0030).
import { beforeEach, describe, expect, it, vi } from "vitest";

const ctx = { householdId: "h1", userId: "u1", role: "owner" as "owner" | "viewer" };
const agents = vi.hoisted(() => ({ createSmartImport: vi.fn(), saveSmartFile: vi.fn() }));
const db = vi.hoisted(() => ({
  canWrite: vi.fn(() => true),
  tolerateSchemaLag: vi.fn((load: () => unknown) => load()),
  withHousehold: vi.fn((_ctx: unknown, fn: (tx: unknown) => unknown) => fn({})),
}));
vi.mock("@organizeup/agents", () => agents);
vi.mock("@organizeup/db", () => db);
vi.mock("@/lib/session", () => ({ requireTenant: async () => ({ ctx }) }));
vi.mock("@/lib/same-site", () => ({ sameSite: () => true }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messagesFor } = await import("@/i18n/messages");
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: "pt-BR", messages: messagesFor("pt-BR"), namespace } as never),
  };
});

const { POST } = await import("./route");
const { GET } = await import("./arquivos/[id]/route");

const url = "https://site.example.com/api/importador";
const MB = 1024 * 1024;

function streamed(chunks: number, size: number) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(new Uint8Array(size));
    },
  });
  return { body, sent: () => sent };
}

const request = (body: ReadableStream<Uint8Array>, headers: Record<string, string>) =>
  new Request(url, { method: "POST", body, duplex: "half", headers } as RequestInit);

beforeEach(() => {
  vi.clearAllMocks();
  agents.createSmartImport.mockResolvedValue("lote");
  agents.saveSmartFile.mockResolvedValue({ ok: true, id: "f", duplicate: false });
});

describe("POST /api/importador", () => {
  it("recusa pedido sem tamanho", async () => {
    const { body } = streamed(1, 10);
    const response = await POST(request(body, {}));
    expect(response.status).toBe(411);
  });

  it("recusa pelo cabeçalho, antes de ler", async () => {
    const { body, sent } = streamed(100, MB);
    const response = await POST(request(body, { "content-length": String(50 * MB) }));
    expect(response.status).toBe(413);
    expect(sent()).toBeLessThan(3);
  });

  it("quem mente no tamanho para no contador, sem ler o resto", async () => {
    const { body, sent } = streamed(10_000, MB);
    const response = await POST(request(body, { "content-length": "100" }));
    expect(response.status).toBe(413);
    expect(sent()).toBeLessThan(20);
    expect(agents.saveSmartFile).not.toHaveBeenCalled();
  });

  it("arquivo normal entra", async () => {
    const form = new FormData();
    form.set("file", new File(["OFXHEADER:100\n<OFX></OFX>"], "extrato.ofx"));
    const response = await POST(new Request(url, { method: "POST", body: form }));
    const prepared = new Request(url, { method: "POST", body: form });
    const bytes = await prepared.arrayBuffer();
    const retry = await POST(
      new Request(url, {
        method: "POST",
        body: bytes,
        headers: {
          "content-type": prepared.headers.get("content-type") ?? "",
          "content-length": String(bytes.byteLength),
        },
      }),
    );
    expect(response.status).toBe(411);
    expect(retry.status).toBe(200);
    expect(agents.saveSmartFile).toHaveBeenCalledOnce();
  });
});

describe("GET /api/importador/arquivos/[id]", () => {
  it("sem a migração ainda, é 404", async () => {
    db.tolerateSchemaLag.mockResolvedValueOnce(null);
    const response = await GET(new Request(url), { params: Promise.resolve({ id: "x" }) });
    expect(response.status).toBe(404);
  });
});
