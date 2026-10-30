"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui";
import { EntryForm, type EditableEntry, type EntryOptions } from "./entry-form";

interface EntryDialog {
  openNew: (kind?: "receita" | "despesa", cardId?: string) => void;
  openEdit: (entry: EditableEntry) => void;
  writable: boolean;
}

const EntryDialogContext = createContext<EntryDialog | null>(null);

export function useEntryDialog() {
  const context = useContext(EntryDialogContext);
  if (!context) throw new Error("useEntryDialog fora do painel.");
  return context;
}

interface DialogState {
  open: boolean;
  nonce: number;
  kind: "receita" | "despesa";
  cardId: string | null;
  entry: EditableEntry | null;
}

/** O formulário de lançamento fica disponível em qualquer tela do painel. */
export function EntryDialogProvider({
  children,
  writable,
  today,
  options,
}: {
  children: ReactNode;
  writable: boolean;
  today: string;
  options: EntryOptions;
}) {
  const [state, setState] = useState<DialogState>({
    open: false,
    nonce: 0,
    kind: "despesa",
    cardId: null,
    entry: null,
  });

  const openNew = useCallback(
    (kind: "receita" | "despesa" = "despesa", cardId?: string) =>
      setState((s) => ({
        open: true,
        nonce: s.nonce + 1,
        kind,
        cardId: cardId ?? null,
        entry: null,
      })),
    [],
  );
  const openEdit = useCallback(
    (entry: EditableEntry) =>
      setState((s) => ({ open: true, nonce: s.nonce + 1, kind: entry.kind, cardId: null, entry })),
    [],
  );
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  const value = useMemo(() => ({ openNew, openEdit, writable }), [openNew, openEdit, writable]);

  return (
    <EntryDialogContext.Provider value={value}>
      {children}
      <Sheet
        open={state.open}
        onClose={close}
        title={state.entry ? "Editar lançamento" : "Novo lançamento"}
      >
        <EntryForm
          key={state.nonce}
          today={today}
          options={options}
          initialKind={state.kind}
          initialCard={state.cardId}
          entry={state.entry}
          onDone={close}
        />
      </Sheet>
    </EntryDialogContext.Provider>
  );
}
