import { beforeEach, describe, expect, it, vi } from "vitest";

const ctx = { householdId: "h1", userId: "u1", role: "owner" as "owner" | "viewer" };
const agents = vi.hoisted(() => ({ saveDebtDocument: vi.fn(), loadDebtDocumentFile: vi.fn() }));
const db = vi.hoisted(() => ({
  canWrite: vi.fn(),
  withHousehold: vi.fn((_ctx: unknown, fn: (tx: unknown) => unknown) => fn({})),
}));
vi.mock("@organizeup/agents", () => agents);
vi.mock("@organizeup/db", () => db);
vi.mock("@/lib/session", () => ({ requireTenant: async () => ({ ctx }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messagesFor } = await import("@/i18n/messages");
  const messages = messagesFor("pt-BR");
  return {
    getMessages: async () => messages,
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: "pt-BR", messages, namespace } as never),
  };
});

const { POST } = await import("./route");
const { GET } = await import("./[id]/route");

const url = "https://site.example.com/api/dividas/anexos";

function post(file: File | null, init: RequestInit = {}) {
  const body = new FormData();
  if (file) body.set("file", file);
  return POST(new Request(url, { method: "POST", body, ...init }));
}

const pdf = () => new File(["%PDF-1.7 contrato"], "contrato.pdf");

beforeEach(() => {
  vi.clearAllMocks();
  db.canWrite.mockReturnValue(true);
  agents.saveDebtDocument.mockResolvedValue({
    ok: true,
    id: "d1",
    status: "guardado",
    duplicate: false,
  });
});

describe("POST /api/dividas/anexos", () => {
  it("guarda o arquivo com o tipo achado no conteúdo", async () => {
    const response = await post(pdf());
    expect(response.status).toBe(200);
    expect(agents.saveDebtDocument).toHaveBeenCalledWith(
      {},
      ctx,
      expect.objectContaining({ fileName: "contrato.pdf", mediaType: "application/pdf" }),
    );
  });

  it("recusa tipo falso sem gravar", async () => {
    const fake = new File(["MZ programa"], "contrato.pdf", { type: "application/pdf" });
    const response = await post(fake);
    expect(response.status).toBe(415);
    expect(agents.saveDebtDocument).not.toHaveBeenCalled();
  });

  it("recusa acima de 10 MB sem gravar", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode("%PDF-1.7"));
    const response = await post(new File([big], "contrato.pdf"));
    expect(response.status).toBe(413);
    expect(agents.saveDebtDocument).not.toHaveBeenCalled();
  });

  it("recusa pelo tamanho declarado antes de ler o corpo", async () => {
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-length": String(20 * 1024 * 1024) },
        body: "x",
      }),
    );
    expect(response.status).toBe(413);
  });

  it("quem não escreve não envia", async () => {
    db.canWrite.mockReturnValue(false);
    expect((await post(pdf())).status).toBe(403);
    expect(agents.saveDebtDocument).not.toHaveBeenCalled();
  });

  it("recusa pedido de outro site", async () => {
    const response = await post(pdf(), { headers: { "sec-fetch-site": "cross-site" } });
    expect(response.status).toBe(403);
  });

  it("diz quando a família passou da cota", async () => {
    agents.saveDebtDocument.mockResolvedValue({ ok: false, code: "cota", message: "Sem espaço." });
    const response = await post(pdf());
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ ok: false, message: "Sem espaço." });
  });
});

describe("GET /api/dividas/anexos/[id]", () => {
  const get = (id: string) => GET(new Request(`${url}/${id}`), { params: Promise.resolve({ id }) });

  it("baixa sempre como anexo, com nosniff e sem cache", async () => {
    agents.loadDebtDocumentFile.mockResolvedValue({
      fileName: 'contrato "março".pdf',
      mediaType: "application/pdf",
      content: new TextEncoder().encode("%PDF-1.7"),
    });
    const response = await get("d1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="/);
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("%PDF-1.7");
  });

  it("arquivo de outra família não existe", async () => {
    agents.loadDebtDocumentFile.mockResolvedValue(null);
    expect((await get("d2")).status).toBe(404);
  });
});
