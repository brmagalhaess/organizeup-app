import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("Markdown das respostas", () => {
  it("entende negrito, itálico e código", () => {
    expect(parseInline("Gastou **R$ 10,00** em *mercado* e `x`.")).toEqual([
      { type: "text", text: "Gastou " },
      { type: "strong", text: "R$ 10,00" },
      { type: "text", text: " em " },
      { type: "em", text: "mercado" },
      { type: "text", text: " e " },
      { type: "code", text: "x" },
      { type: "text", text: "." },
    ]);
  });

  it("não interpreta o asterisco de uma conta", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([{ type: "text", text: "2 * 3 * 4" }]);
  });

  it("link vira só o texto, sem endereço", () => {
    const parsed = parseInline("veja [aqui](https://example.com/roubo) agora");
    expect(parsed).toEqual([
      { type: "text", text: "veja " },
      { type: "text", text: "aqui" },
      { type: "text", text: " agora" },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("example.com");
  });

  it("HTML continua sendo texto", () => {
    expect(parseMarkdown('<img src=x onerror="alert(1)">')).toEqual([
      { type: "paragraph", content: [{ type: "text", text: '<img src=x onerror="alert(1)">' }] },
    ]);
  });

  it("separa parágrafos, títulos e listas", () => {
    expect(parseMarkdown("# Título\n\num\ndois\n\n- a\n- b\n\n1. x\n2) y")).toEqual([
      { type: "heading", content: [{ type: "text", text: "Título" }] },
      { type: "paragraph", content: [{ type: "text", text: "um dois" }] },
      {
        type: "list",
        ordered: false,
        items: [[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]],
      },
      {
        type: "list",
        ordered: true,
        items: [[{ type: "text", text: "x" }], [{ type: "text", text: "y" }]],
      },
    ]);
  });
});
