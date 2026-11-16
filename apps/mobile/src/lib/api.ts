// Cliente da API do app (`/api/mobile/v1`, ADR-0045). Dinheiro chega pronto para mostrar: o app não
// faz conta com valores.
import { authClient } from "./auth";
import { API_URL } from "./config";

export type ApiErrorCode =
  | "unauthenticated"
  | "blocked"
  | "no_family"
  | "suspended"
  | "invalid"
  | "forbidden"
  | "network"
  | "server";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message?: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message ?? code);
  }
}

async function request<T>(path: string, init?: { method: "POST"; body: unknown }): Promise<T> {
  let response: Response;
  const cookie = await authClient.getCookie();
  try {
    response = await fetch(`${API_URL}/api/mobile/v1${path}`, {
      method: init?.method ?? "GET",
      // O cookie vai à mão, do cofre: o pote de cookies do sistema fica de fora.
      credentials: "omit",
      headers: {
        Accept: "application/json",
        Cookie: cookie,
        ...(init ? { "Content-Type": "application/json" } : {}),
      },
      body: init ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError("network", 0);
  }
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: ApiErrorCode; message?: string; fieldErrors?: Record<string, string> }) | null;
  if (response.ok && payload) return payload;
  throw new ApiError(
    payload?.error ?? "server",
    response.status,
    payload?.message ?? undefined,
    payload?.fieldErrors,
  );
}

export const apiGet = <T>(path: string) => request<T>(path);
export const apiPost = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body });

export interface Family {
  id: string;
  name: string;
  role: string;
  canWrite: boolean;
  currency: string;
}

export interface Me {
  user: { name: string; email: string };
  locale: string;
  family: Family | null;
  families: { id: string; name: string; role: string; suspended: boolean }[];
}

export interface Entry {
  key: string;
  source: string;
  kind: "receita" | "despesa";
  description: string;
  amountText: string;
  date: string;
  dateText: string;
  status: "previsto" | "realizado";
  category: string | null;
  account: string | null;
}

export interface Overview {
  month: string;
  monthLabel: string;
  previous: string | null;
  next: string | null;
  phase: "passado" | "atual" | "futuro";
  fresh: boolean;
  unread: number;
  balance: { text: string; negative: boolean; projectedText: string };
  summary: {
    receivedText: string;
    spentText: string;
    resultText: string;
    resultNegative: boolean;
    contributedText: string;
    plannedIncomeText: string;
    plannedExpenseText: string;
  };
  pending: Entry[];
  recent: Entry[];
  accounts: { id: string; name: string; type: string; balanceText: string; negative: boolean }[];
  cards: {
    id: string;
    name: string;
    statementText: string;
    status: "aberta" | "fechada" | "atrasada" | "paga" | null;
    aheadText: string;
  }[];
}

export interface MonthEntries {
  month: string;
  monthLabel: string;
  today: string;
  canWrite: boolean;
  summary: {
    receivedText: string;
    spentText: string;
    resultText: string;
    resultNegative: boolean;
  };
  entries: Entry[];
  accounts: { id: string; name: string; currency: string }[];
  categories: { id: string; name: string; kind: "receita" | "despesa" }[];
}

export interface Notifications {
  items: { id: string; title: string; body: string; createdAt: string; read: boolean }[];
}
