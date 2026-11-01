"use client";
import type { AssistantState } from "@organizeup/ai";
import {
  ArrowLeft,
  CircleStop,
  History,
  MessageCircle,
  Plus,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button, EmptyState, FormMessage, IconButton } from "@/components/ui";
import { Activation } from "./activation";
import { Answer } from "./answer";
import { INVESTMENT_NOTICE, STATE_TEXT, UNCHECKED_NOTICE } from "./copy";
import {
  fetchThreads,
  removeThread,
  useChat,
  type ChatMessage,
  type ThreadSummary,
} from "./use-chat";

const SUGGESTIONS = [
  "Como foi este mês?",
  "O que vence nos próximos dias?",
  "E se eu guardar mais R$ 500 por mês?",
];

const MAX_LENGTH = 2000;

function MessageView({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <li className="ml-8 self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-100 px-4 py-2 text-sm">
        <span className="sr-only">Você disse: </span>
        {message.text}
      </li>
    );
  }
  const waiting = message.live && !message.text;
  return (
    <li className="mr-4 flex flex-col gap-2 text-sm">
      {message.tools.length > 0 ? (
        <ul
          aria-label="O que o assistente olhou"
          className="m-0 flex list-none flex-wrap gap-1 p-0"
        >
          {message.tools.map((tool, index) => (
            <li
              key={`${tool}-${index}`}
              className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs text-muted"
            >
              {tool}
            </li>
          ))}
        </ul>
      ) : null}
      {waiting ? (
        <p role="status" className="m-0 text-muted">
          Pensando…
        </p>
      ) : null}
      {message.text ? <Answer text={message.text} /> : null}
      {message.status === "parada" ? (
        <p className="m-0 text-xs text-muted">Você parou aqui.</p>
      ) : null}
      {message.uncheckedNumbers ? (
        <p className="m-0 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          {UNCHECKED_NOTICE}
        </p>
      ) : null}
      {message.investment ? (
        <p className="m-0 rounded-lg bg-card-soft px-3 py-2 text-xs text-muted">
          {INVESTMENT_NOTICE}
        </p>
      ) : null}
    </li>
  );
}

function Conversation({ chat }: { chat: ReturnType<typeof useChat> }) {
  const { messages, busy, error, send, stop } = chat;
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    void send(message);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(draft);
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm text-muted">
              Pergunte sobre seus gastos, metas, dívidas ou aposentadoria. Eu olho seus números
              antes de responder.
            </p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <Button
                    type="button"
                    variant="secondary"
                    small
                    className="h-auto w-full justify-start py-2 text-left"
                    onClick={() => submit(suggestion)}
                  >
                    {suggestion}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div role="log" aria-live="polite" aria-label="Conversa">
            <ol className="m-0 flex list-none flex-col gap-4 p-0">
              {messages.map((message) => (
                <MessageView key={message.id} message={message} />
              ))}
            </ol>
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-2 border-t border-line bg-card px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <FormMessage message={error} />
        <label htmlFor={inputId} className="text-sm font-medium">
          Sua pergunta
        </label>
        <div className="flex items-end gap-2">
          <textarea
            ref={input}
            id={inputId}
            value={draft}
            maxLength={MAX_LENGTH}
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className="min-h-11 w-full min-w-0 resize-none rounded-xl border border-line bg-card px-3 py-2 text-base text-ink placeholder:text-muted focus:border-brand-500 sm:text-sm"
          />
          {busy ? (
            <Button type="button" variant="secondary" onClick={stop}>
              <CircleStop className="size-4.5" aria-hidden="true" />
              Parar
            </Button>
          ) : (
            <Button type="submit" disabled={!draft.trim()}>
              <SendHorizontal className="size-4.5" aria-hidden="true" />
              Enviar
            </Button>
          )}
        </div>
      </form>
    </>
  );
}

function Threads({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const [threads, setThreads] = useState<ThreadSummary[] | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void fetchThreads().then((rows) => {
      if (active) setThreads(rows);
    });
    return () => {
      active = false;
    };
  }, []);

  const remove = async (id: string) => {
    if (await removeThread(id)) {
      setThreads((rows) => rows?.filter((row) => row.id !== id));
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <Button type="button" variant="ghost" small onClick={onBack} className="mb-3">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Voltar
      </Button>
      {threads === undefined ? (
        <p role="status" className="m-0 text-sm text-muted">
          Carregando…
        </p>
      ) : threads === null ? (
        <FormMessage message="Não foi possível abrir suas conversas." />
      ) : threads.length === 0 ? (
        <EmptyState
          title="Nenhuma conversa ainda"
          text="O que você perguntar fica guardado aqui."
        />
      ) : (
        <ul aria-label="Suas conversas" className="m-0 flex list-none flex-col gap-2 p-0">
          {threads.map((thread) => (
            <li
              key={thread.id}
              className="flex items-center gap-1 rounded-xl border border-line bg-card-soft"
            >
              <button
                type="button"
                onClick={() => onOpen(thread.id)}
                className="min-h-11 min-w-0 flex-1 truncate rounded-xl px-3 text-left text-sm font-medium"
              >
                {thread.title}
              </button>
              <IconButton
                label={`Apagar a conversa: ${thread.title}`}
                onClick={() => remove(thread.id)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Botão em todas as telas do painel: painel lateral no computador, tela cheia no celular. */
export function AssistantPanel({ state: initialState }: { state: AssistantState }) {
  const t = useTranslations("settings.assistant");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "threads">("chat");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const activationId = useId();
  const chat = useChat(initialState);
  const { state } = chat;
  const unavailable = STATE_TEXT[state];

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const canChat = state === "pronto";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-20 inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-900 px-4 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 lg:bottom-6 lg:right-6"
      >
        <MessageCircle className="size-4.5" aria-hidden="true" />
        {t("title")}
      </button>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false);
        }}
        className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-none border-0 bg-card p-0 text-ink shadow-2xl sm:max-w-lg"
      >
        {open ? (
          <div className="flex h-full flex-col">
            <header className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
              <h2 id={titleId} className="m-0 font-display text-xl font-medium">
                {t("title")}
              </h2>
              <div className="flex items-center gap-1">
                {canChat ? (
                  <>
                    <IconButton
                      label="Nova conversa"
                      onClick={() => {
                        chat.reset();
                        setView("chat");
                      }}
                    >
                      <Plus className="size-5" aria-hidden="true" />
                    </IconButton>
                    <IconButton label="Conversas anteriores" onClick={() => setView("threads")}>
                      <History className="size-5" aria-hidden="true" />
                    </IconButton>
                  </>
                ) : null}
                <IconButton label="Fechar" onClick={() => setOpen(false)}>
                  <X className="size-5" aria-hidden="true" />
                </IconButton>
              </div>
            </header>
            {state === "precisa_ativar" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <Activation headingId={activationId} />
              </div>
            ) : unavailable ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <EmptyState title={unavailable.title} text={unavailable.text} />
              </div>
            ) : view === "threads" ? (
              <Threads
                onBack={() => setView("chat")}
                onOpen={(id) => {
                  void chat.open(id).then(() => setView("chat"));
                }}
              />
            ) : (
              <Conversation chat={chat} />
            )}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
