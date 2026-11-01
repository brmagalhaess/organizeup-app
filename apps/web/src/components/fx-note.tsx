import { fxNoteText, type FxTotalNote } from "@organizeup/domain";

/** "Convertido pela cotação de <data>", nas telas que somam contas de moedas diferentes. */
export function FxNote({ fx, className }: { fx: FxTotalNote | null; className?: string }) {
  const text = fxNoteText(fx);
  if (!text) return null;
  return (
    <p lang="pt-BR" className={className ?? "m-0 text-xs text-muted"}>
      {text}
    </p>
  );
}
