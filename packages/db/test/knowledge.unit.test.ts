// A base do assistente: só entra trecho com fonte, endereço e data (ADR-0018).
import { describe, expect, it } from "vitest";
import { KNOWLEDGE_SEED } from "../src/knowledge-seed";

describe("base de conhecimento", () => {
  it("tem entre 10 e 15 trechos, com slug único", () => {
    expect(KNOWLEDGE_SEED.length).toBeGreaterThanOrEqual(10);
    expect(KNOWLEDGE_SEED.length).toBeLessThanOrEqual(15);
    const slugs = KNOWLEDGE_SEED.map((chunk) => chunk.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(KNOWLEDGE_SEED.map((chunk) => [chunk.slug, chunk] as const))(
    "%s tem fonte, endereço https e data",
    (_slug, chunk) => {
      expect(chunk.slug).toMatch(/^[a-z0-9-]{3,80}$/);
      expect(chunk.title.length).toBeLessThanOrEqual(160);
      expect(chunk.content.trim().length).toBeGreaterThan(0);
      expect(chunk.content.length).toBeLessThanOrEqual(1200);
      expect(chunk.sourceName.trim().length).toBeGreaterThan(0);
      expect(new URL(chunk.sourceUrl).protocol).toBe("https:");
      expect(chunk.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(chunk.reviewedOn))).toBe(false);
    },
  );

  it("só cita domínio de fonte oficial", () => {
    for (const { sourceUrl } of KNOWLEDGE_SEED) {
      expect(new URL(sourceUrl).hostname).toMatch(/(\.gov\.br|\.fgc\.org\.br)$/);
    }
  });

  it("valor anual leva o ano e nenhum trecho recomenda ativo", () => {
    for (const { slug, title, content } of KNOWLEDGE_SEED) {
      if (slug.endsWith("-2026")) expect(`${title} ${content}`).toContain("2026");
      expect(content).not.toMatch(/\b[A-Z]{4}\d{1,2}\b/);
      expect(content).not.toMatch(/\b(compre|venda agora|invista em)\b/i);
    }
  });
});
