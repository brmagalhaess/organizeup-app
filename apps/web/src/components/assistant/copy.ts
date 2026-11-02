// Códigos do assistente; os textos estão no catálogo, em `assistente`.
import type { AssistantState } from "@organizeup/ai";

/** Estados em que não dá para conversar agora. Sempre com calma: o resto do sistema segue igual. */
export const UNAVAILABLE_STATES = [
  "sem_chave",
  "desligado",
  "manutencao",
  "teto_mensal",
  "teto_diario",
  "sem_permissao",
  "somente_leitura",
  "sem_modulo",
  "limite_mensagens",
] as const satisfies readonly AssistantState[];

export type UnavailableState = (typeof UNAVAILABLE_STATES)[number];

export const isUnavailable = (state: AssistantState): state is UnavailableState =>
  UNAVAILABLE_STATES.some((item) => item === state);

export const AUTONOMY_LEVELS = ["sugerir", "organizar", "completo"] as const;
