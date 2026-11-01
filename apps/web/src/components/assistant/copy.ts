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
] as const satisfies readonly AssistantState[];

export type UnavailableState = (typeof UNAVAILABLE_STATES)[number];

export const isUnavailable = (state: AssistantState): state is UnavailableState =>
  UNAVAILABLE_STATES.some((item) => item === state);

export const AUTONOMY_LEVELS = ["sugerir", "organizar", "completo"] as const;

/** Só para `dividas/importar`, que segue em português: sai quando aquela tela for traduzida. */
export const STATE_TEXT: Partial<Record<AssistantState, { title: string; text: string }>> = {
  sem_chave: {
    title: "O assistente está indisponível",
    text: "Ele ainda não está ligado neste ambiente. Todo o resto do OrganizeUp segue normal.",
  },
  desligado: {
    title: "O assistente está desligado por enquanto",
    text: "Todo o resto do OrganizeUp segue normal. Assim que ele voltar, este botão libera a conversa.",
  },
  manutencao: {
    title: "Estamos em manutenção",
    text: "O assistente volta junto com as alterações. Você pode consultar tudo normalmente.",
  },
  teto_mensal: {
    title: "O assistente fez uma pausa até o próximo mês",
    text: "O limite de uso do serviço neste mês foi atingido, então ele parou sozinho. Seus dados estão seguros e o resto do OrganizeUp segue normal.",
  },
  teto_diario: {
    title: "Sua família usou o limite de hoje",
    text: "O assistente volta amanhã, sem você precisar fazer nada. O resto do OrganizeUp segue normal.",
  },
  sem_permissao: {
    title: "O assistente é para os adultos da família",
    text: "Só quem é responsável ou adulto na família pode conversar com ele. Peça a um deles para ativar ou perguntar por você.",
  },
};
