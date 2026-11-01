// Markdown simples para as respostas. Vira uma árvore de dados que o React desenha como texto: nada
// de HTML cru, e link vira só o texto, porque a resposta pode ter sido influenciada por dado de
// extrato e não pode levar ninguém para fora do sistema.

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "code"; text: string };

export type Block =
  | { type: "paragraph"; content: Inline[] }
  | { type: "heading"; content: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

const INLINE = /\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g;

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push({ type: "text", text: text.slice(last, match.index) });
    const [, bold, boldAlt, italic, code, linkText] = match;
    if (bold ?? boldAlt) parts.push({ type: "strong", text: (bold ?? boldAlt)! });
    else if (italic) parts.push({ type: "em", text: italic });
    else if (code) parts.push({ type: "code", text: code });
    else parts.push({ type: "text", text: linkText! });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", content: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const addItem = (ordered: boolean, text: string) => {
    flush();
    const previous = blocks.at(-1);
    if (previous?.type === "list" && previous.ordered === ordered) {
      previous.items.push(parseInline(text));
    } else {
      blocks.push({ type: "list", ordered, items: [parseInline(text)] });
    }
  };
  for (const line of source.split("\n")) {
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      blocks.push({ type: "heading", content: parseInline(heading[1]!) });
    } else if (bullet) addItem(false, bullet[1]!);
    else if (numbered) addItem(true, numbered[1]!);
    else paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
