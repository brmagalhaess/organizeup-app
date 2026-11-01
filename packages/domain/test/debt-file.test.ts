import { describe, expect, it } from "vitest";
import {
  checkDebtFile,
  DEBT_FILE_MAX_BYTES,
  isDoubtful,
  matchKnownDebt,
  safeFileName,
  type DebtExtraction,
} from "../src/debt-file";

const text = (value: string) => new TextEncoder().encode(value);
const bytes = (...values: number[]) => new Uint8Array(values);

/** Zip mínimo, sem compressão, só com o diretório central que a conferência lê. */
function zip(names: string[], uncompressed = 10): Uint8Array {
  const encoder = new TextEncoder();
  const entries: Uint8Array[] = [];
  for (const name of names) {
    const raw = encoder.encode(name);
    const entry = new Uint8Array(46 + raw.length);
    const view = new DataView(entry.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(24, uncompressed, true);
    view.setUint16(28, raw.length, true);
    entry.set(raw, 46);
    entries.push(entry);
  }
  const directory = entries.reduce((total, entry) => total + entry.length, 0);
  const start = bytes(0x50, 0x4b, 0x03, 0x04, 0, 0);
  const out = new Uint8Array(start.length + directory + 22);
  out.set(start);
  let at = start.length;
  for (const entry of entries) {
    out.set(entry, at);
    at += entry.length;
  }
  const end = new DataView(out.buffer, at);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(10, names.length, true);
  end.setUint32(16, start.length, true);
  return out;
}

const PDF = text("%PDF-1.7\nfalso");
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0);
const XLSX = zip(["[Content_Types].xml", "xl/workbook.xml"]);

describe("tipo do arquivo pelo conteúdo", () => {
  it.each([
    ["contrato.pdf", PDF, "application/pdf"],
    ["boleto.png", PNG, "image/png"],
    ["foto.JPG", JPG, "image/jpeg"],
    ["foto.jpeg", JPG, "image/jpeg"],
    ["dividas.csv", text("credor;saldo\nLoja;10,00\n"), "text/csv"],
    ["dividas.xlsx", XLSX, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ])("aceita %s", (name, content, mediaType) => {
    expect(checkDebtFile(content, name)).toMatchObject({ ok: true, mediaType });
  });

  it("aceita CSV em Windows-1252, como os bancos exportam", () => {
    const content = bytes(0x63, 0x72, 0xe9, 0x64, 0x69, 0x74, 0x6f, 0x3b, 0x31);
    expect(checkDebtFile(content, "credito.csv").ok).toBe(true);
  });

  it.each([
    ["programa renomeado", "contrato.pdf", bytes(0x4d, 0x5a, 0x90, 0x00)],
    ["PNG com nome de PDF", "contrato.pdf", PNG],
    ["PDF com nome de CSV", "planilha.csv", PDF],
    ["HTML com nome de CSV", "planilha.csv", text("<html><script>x,y</script></html>")],
    ["binário com nome de CSV", "planilha.csv", bytes(0x31, 0x2c, 0x00, 0x32)],
    ["CSV com controle", "planilha.csv", bytes(0x31, 0x2c, 0x07, 0x32)],
    ["texto sem colunas", "planilha.csv", text("apenas uma frase qualquer")],
    ["zip comum com nome de xlsx", "planilha.xlsx", zip(["foto.png"])],
    ["zip truncado", "planilha.xlsx", bytes(0x50, 0x4b, 0x03, 0x04, 1, 2, 3)],
    ["extensão fora da lista", "contrato.exe", PDF],
    ["sem extensão", "contrato", PDF],
  ])("recusa %s", (_label, name, content) => {
    expect(checkDebtFile(content, name)).toMatchObject({ ok: false, code: "tipo" });
  });

  it("recusa planilha que descomprimida ficaria gigante", () => {
    const bomb = zip(["[Content_Types].xml", "xl/workbook.xml"], 200 * 1024 * 1024);
    expect(checkDebtFile(bomb, "planilha.xlsx")).toMatchObject({ ok: false, code: "tipo" });
  });

  it("recusa acima do limite e arquivo vazio", () => {
    const big = new Uint8Array(DEBT_FILE_MAX_BYTES + 1);
    big.set(PDF);
    expect(checkDebtFile(big, "contrato.pdf")).toMatchObject({ ok: false, code: "tamanho" });
    expect(checkDebtFile(new Uint8Array(0), "contrato.pdf")).toMatchObject({
      ok: false,
      code: "vazio",
    });
  });

  it("aceita exatamente 10 MB", () => {
    const limit = new Uint8Array(DEBT_FILE_MAX_BYTES);
    limit.set(PDF);
    expect(checkDebtFile(limit, "contrato.pdf").ok).toBe(true);
  });
});

describe("nome do arquivo", () => {
  it("tira pasta, aspas e controle", () => {
    expect(safeFileName('C:\\pasta\\..\\con"trato\n.pdf')).toBe("contrato.pdf");
    expect(safeFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
  });

  it("corta mantendo a extensão", () => {
    const name = safeFileName(`${"a".repeat(300)}.pdf`);
    expect(name).toHaveLength(200);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

const extraction = (over: Partial<DebtExtraction> = {}): DebtExtraction => ({
  creditor: { value: "Financeira Exemplo", confidence: "alta" },
  balance: { value: "1000.00", confidence: "alta" },
  monthlyRate: { value: "2.00", confidence: "alta" },
  installments: { value: 10, confidence: "alta" },
  installmentAmount: { value: "120.00", confidence: "alta" },
  nextDueDate: { value: "2026-12-05", confidence: "alta" },
  system: { value: "price", confidence: "alta" },
  cetAnnual: { value: null, confidence: "baixa" },
  moreThanOne: false,
  ...over,
});

describe("dívida que já existe", () => {
  const known = [
    { id: "1", name: "Carro", nextAmount: "900.00", openInstallments: 30 },
    { id: "2", name: "Empréstimo Exemplo", nextAmount: "500.00", openInstallments: 5 },
    { id: "3", name: "Loja", nextAmount: "120.50", openInstallments: 10 },
  ];

  it("acha pelo nome do credor", () => {
    expect(matchKnownDebt(extraction(), known)?.id).toBe("2");
  });

  it("acha pela parcela e pelo número de parcelas", () => {
    const found = extraction({ creditor: { value: "Outra Empresa", confidence: "alta" } });
    expect(matchKnownDebt(found, known)?.id).toBe("3");
  });

  it("palavra genérica não casa dívidas diferentes", () => {
    const found = extraction({
      creditor: { value: "Banco de Crédito", confidence: "alta" },
      installments: { value: 99, confidence: "alta" },
    });
    expect(matchKnownDebt(found, known)).toBeNull();
  });
});

describe("campo duvidoso", () => {
  it("vazio ou sem confiança alta pede conferência", () => {
    expect(isDoubtful({ value: "1", confidence: "alta" })).toBe(false);
    expect(isDoubtful({ value: "1", confidence: "media" })).toBe(true);
    expect(isDoubtful({ value: null, confidence: "alta" })).toBe(true);
  });
});
