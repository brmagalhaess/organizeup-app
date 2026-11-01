import { parseMarkdown, type Inline } from "./markdown";

function InlineText({ parts }: { parts: Inline[] }) {
  return parts.map((part, index) => {
    if (part.type === "strong") return <strong key={index}>{part.text}</strong>;
    if (part.type === "em") return <em key={index}>{part.text}</em>;
    if (part.type === "code") {
      return (
        <code key={index} className="rounded bg-brand-50 px-1 font-mono text-[0.9em]">
          {part.text}
        </code>
      );
    }
    return <span key={index}>{part.text}</span>;
  });
}

/** Resposta em Markdown. Só elementos do React: nenhum HTML do modelo chega ao navegador. */
export function Answer({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 break-words">
      {parseMarkdown(text).map((block, index) => {
        if (block.type === "heading") {
          return (
            <p key={index} className="m-0 font-semibold">
              <InlineText parts={block.content} />
            </p>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={index} className="m-0">
              <InlineText parts={block.content} />
            </p>
          );
        }
        const items = block.items.map((item, position) => (
          <li key={position}>
            <InlineText parts={item} />
          </li>
        ));
        return block.ordered ? (
          <ol key={index} className="m-0 flex list-decimal flex-col gap-1 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={index} className="m-0 flex list-disc flex-col gap-1 pl-5">
            {items}
          </ul>
        );
      })}
    </div>
  );
}
