"use client";
import type { AssistantEvent, AssistantState, MessageStatus, ThreadMessage } from "@organizeup/ai";
import { useCallback, useRef, useState } from "react";
import { ERROR_TEXT } from "./copy";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: string[];
  status?: MessageStatus | undefined;
  investment?: boolean | undefined;
  uncheckedNumbers?: boolean | undefined;
  /** Ainda chegando. */
  live?: boolean;
}

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

const fromStored = (message: ThreadMessage): ChatMessage => ({
  ...message,
  tools: message.tools ?? [],
});

const newId = () => crypto.randomUUID();

/** A resposta chega como um JSON por linha; uma linha pode vir partida em dois pedaços. */
async function readEvents(response: Response, onEvent: (event: AssistantEvent) => void) {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += value;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as AssistantEvent);
  }
}

const isStream = (response: Response) =>
  response.ok && (response.headers.get("content-type") ?? "").includes("ndjson");

/** Estado da conversa. O painel pode fechar no meio da resposta: ela continua chegando aqui. */
export function useChat(initialState: AssistantState) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<AssistantState | null>(null);
  const controller = useRef<AbortController | null>(null);

  const patchLast = useCallback((patch: (message: ChatMessage) => ChatMessage) => {
    setMessages((current) => {
      const last = current.at(-1);
      return last?.role === "assistant" ? [...current.slice(0, -1), patch(last)] : current;
    });
  }, []);

  const apply = useCallback(
    (event: AssistantEvent) => {
      switch (event.type) {
        case "thread":
          setThreadId(event.id);
          break;
        case "text":
          patchLast((message) => ({ ...message, text: message.text + event.delta }));
          break;
        case "discard":
          patchLast((message) => ({ ...message, text: "" }));
          break;
        case "tool":
          patchLast((message) => ({ ...message, tools: [...message.tools, event.label] }));
          break;
        case "done":
          patchLast((message) => ({
            ...message,
            text: event.text,
            status: event.status,
            investment: event.investment,
            uncheckedNumbers: event.uncheckedNumbers,
            live: false,
          }));
          break;
        case "blocked":
          setMessages((current) => current.slice(0, -1));
          setBlocked(event.state);
          break;
        case "error":
          setMessages((current) => (current.at(-1)?.text === "" ? current.slice(0, -1) : current));
          setError(ERROR_TEXT[event.code]);
          break;
      }
    },
    [patchLast],
  );

  const send = useCallback(
    async (text: string) => {
      const abort = new AbortController();
      controller.current = abort;
      setBusy(true);
      setError(null);
      setMessages((current) => [
        ...current,
        { id: newId(), role: "user", text, tools: [] },
        { id: newId(), role: "assistant", text: "", tools: [], live: true },
      ]);
      try {
        const response = await fetch("/api/assistente", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, threadId }),
          signal: abort.signal,
        });
        if (!isStream(response)) {
          setMessages((current) => current.slice(0, -1));
          setError(ERROR_TEXT.sessao);
          return;
        }
        await readEvents(response, apply);
      } catch {
        if (abort.signal.aborted) {
          patchLast((message) => ({ ...message, status: "parada", live: false }));
        } else {
          setMessages((current) => (current.at(-1)?.text === "" ? current.slice(0, -1) : current));
          setError(ERROR_TEXT.indisponivel);
        }
      } finally {
        patchLast((message) => ({ ...message, live: false }));
        controller.current = null;
        setBusy(false);
      }
    },
    [apply, patchLast, threadId],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    setMessages([]);
    setThreadId(null);
    setError(null);
  }, []);

  const open = useCallback(async (id: string) => {
    setError(null);
    const response = await fetch(`/api/assistente/conversas/${id}`).catch(() => null);
    if (!response?.ok) {
      setError(ERROR_TEXT.sem_conversa);
      return false;
    }
    const data = (await response.json()) as { messages: ThreadMessage[] };
    setMessages(data.messages.map(fromStored));
    setThreadId(id);
    return true;
  }, []);

  return {
    messages,
    threadId,
    busy,
    error,
    state: blocked ?? initialState,
    send,
    stop,
    reset,
    open,
  };
}

export async function fetchThreads(): Promise<ThreadSummary[] | null> {
  const response = await fetch("/api/assistente/conversas").catch(() => null);
  if (!response?.ok) return null;
  return ((await response.json()) as { threads: ThreadSummary[] }).threads;
}

export const removeThread = async (id: string) =>
  (await fetch(`/api/assistente/conversas/${id}`, { method: "DELETE" }).catch(() => null))?.ok ===
  true;
