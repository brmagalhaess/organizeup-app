// Como o painel escreve o que é de cobrança: nomes de item, situação e VIP. Só texto, sem regra de acesso:
// quem decide é `resolveAccess`.
import type { AdminSubscription, VipGrant } from "@organizeup/db";
import {
  formatBRL,
  monthlyAmount,
  selectionOfSubscribed,
  type AccessMode,
  type BillingCycle,
  type BillingModule,
  type VipReason,
} from "@organizeup/domain";

export const MODULE_LABELS: Record<BillingModule, string> = {
  investimentos: "Investimentos",
  aposentadoria: "Aposentadoria",
  dividas: "Dívidas",
  metas: "Metas e viagens",
  assistente: "Assistente com IA",
};

export const CYCLE_LABELS: Record<BillingCycle, string> = { mes: "Mensal", ano: "Anual" };

/** Nome de uma linha do catálogo. Item que o código não conhece aparece como veio. */
export function itemLabel(item: string): string {
  const [kind = "", value = ""] = item.split(":");
  if (kind === "base") {
    return value === "ilimitado" ? "Base, sem limite" : `Base, até ${value} lançamentos`;
  }
  if (kind === "modulo") return MODULE_LABELS[value as BillingModule] ?? item;
  if (kind === "assistente") return `Assistente, ${value} mensagens`;
  if (kind === "moeda") return `Moeda adicional ${value}`;
  if (kind === "familia") return "Família completa";
  if (kind === "familia_mensagens") return `Família completa, ${value} mensagens`;
  if (kind === "contas_conectadas") return "Contas conectadas, por conta";
  return item;
}

export const MODE_BADGES: Record<
  AccessMode,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" }
> = {
  livre: { label: "Livre", tone: "neutral" },
  cortesia: { label: "Cortesia", tone: "neutral" },
  teste: { label: "Em teste", tone: "warning" },
  assinatura: { label: "Assinante", tone: "success" },
  leitura: { label: "Só leitura", tone: "danger" },
  vip: { label: "VIP", tone: "success" },
};

const STRIPE_STATUS: Record<string, string> = {
  active: "Ativa",
  trialing: "Em teste na Stripe",
  past_due: "Em atraso",
  unpaid: "Não paga",
  paused: "Pausada",
  canceled: "Cancelada",
  incomplete: "Esperando pagamento",
  incomplete_expired: "Pagamento expirou",
};
export const stripeStatusLabel = (status: string | null) =>
  status ? (STRIPE_STATUS[status] ?? status) : "Sem assinatura";

export const VIP_REASON_LABELS: Record<VipReason, string> = {
  parceria: "Parceria",
  imprensa: "Imprensa",
  equipe: "Equipe",
  primeiros_clientes: "Primeiros clientes",
  atendimento: "Atendimento",
  teste_interno: "Teste interno",
  outro: "Outro",
};
export const vipReasonLabel = (reason: string) => VIP_REASON_LABELS[reason as VipReason] ?? reason;

const limitText = (limit: number | null, unit: string) =>
  limit === null ? `${unit} sem limite` : `${limit} ${unit}`;

/** O que a concessão dá, numa frase. */
export function vipGiftText(grant: VipGrant): string {
  if (grant.fullAccess) return "Tudo liberado";
  const parts = [
    grant.modules.map((module) => MODULE_LABELS[module]).join(", ") || "Só a Base",
    limitText(grant.entryLimit, "lançamentos"),
    limitText(grant.modules.includes("assistente") ? grant.messageLimit : 0, "mensagens"),
    ...grant.currencies,
  ];
  return parts.join(", ");
}

export const vipCostText = (grant: Pick<VipGrant, "cost" | "discountPercent">) =>
  grant.cost === "sem_custo" ? "Sem custo" : `Desconto de ${grant.discountPercent}%`;

export const brl = (amount: Parameters<typeof formatBRL>[0]) => formatBRL(amount);

/** O que a família paga por mês, com o anual em doze avos e o desconto já fora. */
export function monthlyText(sub: AdminSubscription) {
  return brl(monthlyAmount(sub.items, sub.cycle, sub.discountPercent));
}

/** Plano, em palavras. Sem itens: não assina. */
export function planText(sub: AdminSubscription | null): string {
  if (!sub || sub.items.length === 0) return "Sem plano";
  const selection = selectionOfSubscribed(sub.items, sub.cycle ?? "mes");
  if (selection.family) return "Família completa";
  return itemLabel(`base:${selection.entries}`);
}

export interface PlanFacts {
  modules: string;
  entries: string;
  messages: string;
  currencies: string;
}

/** Módulos e degraus de quem assina. */
export function planFacts(sub: AdminSubscription): PlanFacts {
  const selection = selectionOfSubscribed(sub.items, sub.cycle ?? "mes");
  return {
    modules: selection.modules.map((module) => MODULE_LABELS[module]).join(", ") || "Nenhum",
    entries: selection.entries === "ilimitado" ? "Sem limite" : `Até ${selection.entries}`,
    messages: selection.messages === 0 ? "Sem assistente" : `${selection.messages} por mês`,
    currencies: selection.currencies.join(", ") || "Só a principal",
  };
}

export const EVENT_LABELS: Record<string, string> = {
  "checkout.session.completed": "Pagamento concluído",
  "customer.subscription.created": "Assinatura criada",
  "customer.subscription.updated": "Assinatura alterada",
  "customer.subscription.deleted": "Assinatura encerrada",
  "subscription_schedule.created": "Troca marcada",
  "subscription_schedule.updated": "Troca marcada alterada",
  "subscription_schedule.released": "Troca marcada solta",
  "subscription_schedule.canceled": "Troca marcada cancelada",
  "subscription_schedule.completed": "Troca marcada concluída",
  "invoice.paid": "Fatura paga",
  "invoice.payment_failed": "Cobrança falhou",
  "charge.refunded": "Devolução",
};

export const ERROR_LABELS: Record<string, string> = {
  assinatura_duplicada: "Segunda assinatura paga: a Stripe cobra duas vezes",
  preco_desconhecido: "Preço que o catálogo não conhece",
  sem_familia: "Evento sem família",
  familia_apagada: "Família já apagada",
  id_de_outra_familia: "Id de outra família",
  formato_invalido: "Evento em formato inválido",
  falha: "Falha ao aplicar",
};

/** Fim do dia escolhido, no horário de Brasília: a validade vale o dia inteiro. */
export const endOfDay = (day: string) => new Date(`${day}T23:59:59-03:00`);
