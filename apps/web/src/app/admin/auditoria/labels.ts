// Nome em português de cada registro de ops.admin_access, e os grupos do filtro da auditoria.

const LABELS: Record<string, string> = {
  "painel:visao_geral": "Abriu a visão geral",
  "familias:lista": "Abriu a lista de famílias",
  "familias:busca": "Buscou famílias",
  "familia:detalhe": "Abriu uma família",
  "familia:email_responsavel": "Viu o contato do responsável",
  "familia:suspender": "Suspendeu uma família",
  "familia:reativar": "Reativou uma família",
  "familia:excluir": "Excluiu uma família",
  "usuarios:lista": "Abriu a lista de usuários",
  "usuarios:busca": "Buscou usuários",
  "usuario:detalhe": "Abriu um usuário",
  "usuario:revelar": "Viu nome e e-mail de um usuário",
  "usuario:encerrar_sessoes": "Encerrou as sessões de um usuário",
  "usuario:bloquear": "Bloqueou um usuário",
  "usuario:desbloquear": "Desbloqueou um usuário",
  "usuario:redefinir_senha": "Pediu redefinição de senha",
  "usuario:excluir": "Excluiu um usuário",
  "agentes:ver": "Abriu os agentes",
  "agentes:rodar": "Pediu para rodar os agentes",
  "agentes:contagens": "Pediu para recalcular as contagens",
  "sistema:ver": "Abriu o sistema",
  "controles:ver": "Abriu os controles",
  "controle:manutencao_ligar": "Ligou o modo manutenção",
  "controle:manutencao_desligar": "Desligou o modo manutenção",
  "controle:cadastro_fechar": "Fechou o cadastro",
  "controle:cadastro_abrir": "Abriu o cadastro",
  "controle:aviso_criar": "Publicou um aviso",
  "controle:aviso_remover": "Removeu um aviso",
  "auditoria:ver": "Abriu a auditoria",
  "auditoria:busca": "Filtrou a auditoria",
};

const AGENT_PREFIX = /^agente:(ligar|desligar):(.+)$/;

export function actionLabel(action: string) {
  const agent = AGENT_PREFIX.exec(action);
  if (agent) return `${agent[1] === "ligar" ? "Ligou" : "Desligou"} o agente ${agent[2]}`;
  return LABELS[action] ?? action;
}

/** Só visitas e buscas: nada mudou. */
export const AUDIT_VISITS = [
  "painel:visao_geral",
  "familias:lista",
  "familias:busca",
  "familia:detalhe",
  "usuarios:lista",
  "usuarios:busca",
  "usuario:detalhe",
  "agentes:ver",
  "sistema:ver",
  "controles:ver",
  "auditoria:ver",
  "auditoria:busca",
];

/** Dados pessoais revelados por ação explícita. */
export const AUDIT_REVEALS = ["familia:email_responsavel", "usuario:revelar"];
