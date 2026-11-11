// Fila dos avisos em toast (ADR-0037). Sem React: a tela só desenha o que está aqui.

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
  title?: string;
}

/** Quantos avisos ficam na tela ao mesmo tempo; o mais antigo sai quando chega outro. */
export const MAX_TOASTS = 3;

/** Tempo na tela, em ms. Erro fica mais, porque a pessoa precisa ler o que deu errado. */
export const TOAST_DURATION: Record<ToastTone, number> = {
  success: 5000,
  info: 6000,
  warning: 8000,
  error: 10000,
};

/** Mesmo texto e tom já na tela: não duplica, só renova o tempo (StrictMode roda efeitos duas vezes). */
export function pushToast(list: ToastItem[], item: ToastItem): ToastItem[] {
  const repeated = list.findIndex((t) => t.tone === item.tone && t.text === item.text);
  if (repeated >= 0) return list.map((t, index) => (index === repeated ? item : t));
  const next = [...list, item];
  return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
}

export function removeToast(list: ToastItem[], id: number): ToastItem[] {
  return list.filter((t) => t.id !== id);
}
