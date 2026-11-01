// Textos do assistente. Sem "use client": a tela de Configurações usa os mesmos.
import type { AssistantErrorCode, AssistantState } from "@organizeup/ai";

/** Estados em que não dá para conversar agora. Sempre com calma: o resto do sistema segue igual. */
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

export const ERROR_TEXT: Record<AssistantErrorCode | "sessao", string> = {
  sem_conversa: "Não achei essa conversa. Comece uma nova.",
  limite_de_uso: "Muita gente usando ao mesmo tempo. Tente de novo em alguns instantes.",
  indisponivel: "O assistente não respondeu agora. Tente de novo em alguns instantes.",
  muito_longa:
    "Não consegui processar esse pedido. Tente uma pergunta mais curta ou uma nova conversa.",
  chave_invalida: "O assistente está indisponível no momento. Tente de novo mais tarde.",
  falha: "Algo deu errado aqui. Sua pergunta ficou guardada; tente de novo.",
  sessao: "Sua sessão expirou. Recarregue a página e entre de novo.",
};

export const AUTONOMY_OPTIONS = [
  {
    value: "sugerir",
    label: "Sugerir",
    text: "Só dá dicas e sugestões. Você decide tudo.",
  },
  {
    value: "organizar",
    label: "Organizar",
    text: "Também categoriza, ajusta o plano das metas e cria lembretes, sempre com Desfazer.",
  },
  {
    value: "completo",
    label: "Completo",
    text: "Também cria metas e viagens em rascunho. Valor que você informou continua sendo sugestão.",
  },
] as const;

export const INVESTMENT_NOTICE =
  "Conteúdo educativo, não é recomendação de investimento. A decisão é sua, e um profissional autorizado pode ajudar.";

export const UNCHECKED_NOTICE =
  "Alguns valores desta resposta não vieram direto dos seus dados. Confira antes de decidir.";
