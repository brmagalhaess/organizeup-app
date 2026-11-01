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
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button, EmptyState, FormMessage, IconButton } from "@/components/ui";
import { Activation } from "./activation";
import { Answer } from "./answer";
import { formatMonthYear } from "@/i18n/format";
import { isUnavailable } from "./copy";
import { toolLabel } from "./tool-labels";
import {
  fetchThreads,
  removeThread,
  useChat,
  type ChatMessage,
  type ThreadSummary,
} from "./use-chat";

const SUGGESTIONS = ["month", "upcoming", "saveMore"] as const;

const MAX_LENGTH = 2000;

/** O que veio de `packages/ai`, no idioma da pessoa. Frase desconhecida fica como veio. */
function ToolName({ text }: { text: string }) {
  const t = useTranslations("assistente.tools");
  const locale = useLocale();
  const label = toolLabel(text);
  if (!label) return text;
  return "month" in label
    ? t(label.key, { month: formatMonthYear(label.month, locale) })
    : t(label.key);
}

function MessageView({ message }: { message: ChatMessage }) {
  const t = useTranslations("assistente");
  if (message.role === "user") {
    return (
      <li className="ml-8 self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-100 px-4 py-2 text-sm">
        <span className="sr-only">{t("chat.youSaid")}</span>
        {message.text}
      </li>
    );
  }
  const waiting = message.live && !message.text;
  return (
    <li className="mr-4 flex flex-col gap-2 text-sm">
      {message.tools.length > 0 ? (
        <ul aria-label={t("chat.toolsLabel")} className="m-0 flex list-none flex-wrap gap-1 p-0">
          {message.tools.map((tool, index) => (
            <li
              key={`${tool}-${index}`}
              className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs text-muted"
            >
              <ToolName text={tool} />
            </li>
          ))}
        </ul>
      ) : null}
      {waiting ? (
        <p role="status" className="m-0 text-muted">
          {t("chat.thinking")}
        </p>
      ) : null}
      {message.text ? <Answer text={message.text} /> : null}
      {message.status === "parada" ? (
        <p className="m-0 text-xs text-muted">{t("chat.stopped")}</p>
      ) : null}
      {message.uncheckedNumbers ? (
        <p className="m-0 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          {t("notices.unchecked")}
        </p>
      ) : null}
      {message.investment ? (
        <p className="m-0 rounded-lg bg-card-soft px-3 py-2 text-xs text-muted">
          {t("notices.investment")}
        </p>
      ) : null}
    </li>
  );
}

function Conversation({ chat }: { chat: ReturnType<typeof useChat> }) {
  const t = useTranslations("assistente");
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
            <p className="m-0 text-sm text-muted">{t("chat.intro")}</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <Button
                    type="button"
                    variant="secondary"
                    small
                    className="h-auto w-full justify-start py-2 text-left"
                    onClick={() => submit(t(`chat.suggestions.${suggestion}`))}
                  >
                    {t(`chat.suggestions.${suggestion}`)}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div role="log" aria-live="polite" aria-label={t("chat.conversation")}>
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
        <FormMessage message={error ? t(`errors.${error}`) : null} />
        <label htmlFor={inputId} className="text-sm font-medium">
          {t("chat.question")}
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
              {t("chat.stop")}
            </Button>
          ) : (
            <Button type="submit" disabled={!draft.trim()}>
              <SendHorizontal className="size-4.5" aria-hidden="true" />
              {t("chat.send")}
            </Button>
          )}
        </div>
      </form>
    </>
  );
}

function Threads({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const t = useTranslations("assistente.threads");
  const tCommon = useTranslations("common");
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
        {t("back")}
      </Button>
      {threads === undefined ? (
        <p role="status" className="m-0 text-sm text-muted">
          {tCommon("loadingEllipsis")}
        </p>
      ) : threads === null ? (
        <FormMessage message={t("failed")} />
      ) : threads.length === 0 ? (
        <EmptyState title={t("emptyTitle")} text={t("emptyText")} />
      ) : (
        <ul aria-label={t("listLabel")} className="m-0 flex list-none flex-col gap-2 p-0">
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
                label={t("delete", { title: thread.title })}
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
  const tAssistant = useTranslations("assistente");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "threads">("chat");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const activationId = useId();
  const chat = useChat(initialState);
  const { state } = chat;

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
                      label={tAssistant("threads.new")}
                      onClick={() => {
                        chat.reset();
                        setView("chat");
                      }}
                    >
                      <Plus className="size-5" aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={tAssistant("threads.previous")}
                      onClick={() => setView("threads")}
                    >
                      <History className="size-5" aria-hidden="true" />
                    </IconButton>
                  </>
                ) : null}
                <IconButton label={tCommon("close")} onClick={() => setOpen(false)}>
                  <X className="size-5" aria-hidden="true" />
                </IconButton>
              </div>
            </header>
            {state === "precisa_ativar" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <Activation headingId={activationId} />
              </div>
            ) : isUnavailable(state) ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <EmptyState
                  title={tAssistant(`states.${state}.title`)}
                  text={tAssistant(`states.${state}.text`)}
                />
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
