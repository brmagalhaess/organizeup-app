// Plano montado pela família (ADR-0023, docs/specs/planos-e-assinatura.md). Tudo aqui é puro: o que a
// tela soma ao vivo, o que vai para a Stripe e o que libera cada item saem das mesmas funções, para o
// total na tela ser o total cobrado. Valores de catálogo vêm do banco como string, em BRL.
import { CURRENCIES, money, toDbAmount, type Currency } from "./money";

export const PAID_MODULES = ["investimentos", "aposentadoria", "dividas", "metas"] as const;
export type PaidModule = (typeof PAID_MODULES)[number];

/** O que `canUse` responde. O assistente tem campo próprio, mas liga e desliga como módulo. */
export const BILLING_MODULES = [...PAID_MODULES, "assistente"] as const;
export type BillingModule = (typeof BILLING_MODULES)[number];

export const BILLING_CYCLES = ["mes", "ano"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const ENTRY_TIERS = ["50", "200", "ilimitado"] as const;
export type EntryTier = (typeof ENTRY_TIERS)[number];

/** `0`: sem assistente. */
export const MESSAGE_TIERS = [0, 30, 100, 300] as const;
export type MessageTier = (typeof MESSAGE_TIERS)[number];

/** Item por quantidade: uma linha da Stripe, com `quantity`. Fora de venda até a conexão com bancos existir. */
export const CONNECTED_ITEM = "contas_conectadas";
export const MAX_CONNECTED_ACCOUNTS = 20;

/** Mensagens que a Família completa traz sem custo a mais. */
export const FAMILY_MESSAGES = 100;
/** Aviso em 80% do limite (spec, seção 1). */
export const USAGE_WARNING_RATIO = "0.8";
export const TRIAL_DAYS = 7;
/** Arrependimento: 7 dias da primeira cobrança (CDC, art. 49). */
export const REFUND_DAYS = 7;
export const ANNUAL_RENEWAL_NOTICE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlanSelection {
  family: boolean;
  entries: EntryTier;
  modules: PaidModule[];
  messages: MessageTier;
  /** Moedas além da principal. */
  currencies: Currency[];
  /** Contas conectadas: quantidade, por cima de qualquer plano. */
  connectedAccounts: number;
  cycle: BillingCycle;
}

export const FAMILY_SELECTION: PlanSelection = {
  family: true,
  entries: "ilimitado",
  modules: [...PAID_MODULES],
  messages: 100,
  currencies: [],
  connectedAccounts: 0,
  cycle: "mes",
};

export interface CatalogPrice {
  id: string;
  item: string;
  cycle: BillingCycle;
  amount: string;
  stripePriceId: string | null;
}

/** Item que a família assina, com o preço com que assinou. */
export interface SubscribedItem {
  price: string;
  item: string;
  amount: string;
  quantity: number;
}

const unique = <T>(list: readonly T[]) => [...new Set(list)];

/** Só o que faz sentido: a Família completa traz tudo, e a tela pode mandar qualquer combinação. */
export function normalizeSelection(selection: PlanSelection): PlanSelection {
  const currencies = CURRENCIES.filter((code) => selection.currencies.includes(code));
  const connectedAccounts = Math.min(
    Math.max(Math.trunc(selection.connectedAccounts), 0),
    MAX_CONNECTED_ACCOUNTS,
  );
  if (!selection.family) {
    return {
      ...selection,
      modules: PAID_MODULES.filter((module) => selection.modules.includes(module)),
      currencies,
      connectedAccounts,
    };
  }
  return {
    ...FAMILY_SELECTION,
    messages: selection.messages === 300 ? 300 : 100,
    currencies,
    connectedAccounts,
    cycle: selection.cycle,
  };
}

/** Itens do catálogo que formam a escolha. */
export function itemsOf(input: PlanSelection): string[] {
  const selection = normalizeSelection(input);
  const coins = selection.currencies.map((code) => `moeda:${code}`);
  const connected = selection.connectedAccounts > 0 ? [CONNECTED_ITEM] : [];
  if (selection.family) {
    return [
      "familia",
      ...(selection.messages === 300 ? ["familia_mensagens:300"] : []),
      ...coins,
      ...connected,
    ];
  }
  return [
    `base:${selection.entries}`,
    ...selection.modules.map((module) => `modulo:${module}`),
    ...(selection.messages > 0 ? [`assistente:${selection.messages}`] : []),
    ...coins,
    ...connected,
  ];
}

const isEntryTier = (value: string): value is EntryTier =>
  (ENTRY_TIERS as readonly string[]).includes(value);
const isPaidModule = (value: string): value is PaidModule =>
  (PAID_MODULES as readonly string[]).includes(value);
const isCurrency = (value: string): value is Currency =>
  (CURRENCIES as readonly string[]).includes(value);
const isMessageTier = (value: number): value is MessageTier =>
  (MESSAGE_TIERS as readonly number[]).includes(value);

/** O caminho de volta: a tela abre mostrando o plano de quem já assina. */
export function selectionOfItems(items: readonly string[], cycle: BillingCycle): PlanSelection {
  const selection: PlanSelection = {
    family: false,
    entries: "50",
    modules: [],
    messages: 0,
    currencies: [],
    connectedAccounts: 0,
    cycle,
  };
  for (const item of items) {
    const [kind, value = ""] = item.split(":");
    if (kind === "familia") {
      selection.family = true;
      selection.entries = "ilimitado";
      selection.modules = [...PAID_MODULES];
      selection.messages = selection.messages === 300 ? 300 : 100;
    } else if (kind === "familia_mensagens") {
      selection.messages = 300;
    } else if (kind === "base" && isEntryTier(value)) {
      selection.entries = value;
    } else if (kind === "modulo" && isPaidModule(value)) {
      if (!selection.family) selection.modules.push(value);
    } else if (kind === "assistente" && isMessageTier(Number(value))) {
      selection.messages = Number(value) as MessageTier;
    } else if (kind === "moeda" && isCurrency(value)) {
      selection.currencies.push(value);
    }
  }
  return normalizeSelection(selection);
}

/** Quantas contas conectadas a assinatura paga. */
export const connectedAccountsOf = (items: readonly SubscribedItem[]) =>
  items.find((row) => row.item === CONNECTED_ITEM)?.quantity ?? 0;

/** Como `selectionOfItems`, com a quantidade: é assim que a tela abre o plano de quem assina. */
export const selectionOfSubscribed = (items: readonly SubscribedItem[], cycle: BillingCycle) => ({
  ...selectionOfItems(
    items.map((row) => row.item),
    cycle,
  ),
  connectedAccounts: connectedAccountsOf(items),
});

export interface QuoteLine {
  item: string;
  /** Preço de uma unidade. */
  amount: string;
  quantity: number;
  /** Preço da Stripe. Null: o item ainda não tem preço criado lá, e a assinatura não fecha. */
  stripePriceId: string | null;
}

export interface PlanQuote {
  lines: QuoteLine[];
  /** Total do ciclo escolhido. É o que a Stripe cobra. */
  total: string;
  /** Item sem preço no catálogo. Com algum, a tela não deixa assinar. */
  missing: string[];
  /** Quanto a Família completa economizaria sobre esta escolha, no mesmo ciclo. Null: nada. */
  familySaves: string | null;
}

/** Valor da Stripe, sempre em centavos, para o formato do banco. */
export const fromCents = (cents: number) => toDbAmount(money(cents).dividedBy(100));

/** O contrário, para criar o preço: a Stripe pede inteiro em centavos, e valor fora disso é erro. */
export function stripeUnitAmount(amount: string): number {
  const cents = money(amount).times(100);
  if (!cents.isInteger() || cents.lte(0)) throw new RangeError("Preço inválido.");
  return cents.toNumber();
}

/** Soma das linhas, sem arredondar no meio. */
const sum = (lines: readonly QuoteLine[]) =>
  toDbAmount(
    lines.reduce((acc, line) => acc.plus(money(line.amount).times(line.quantity)), money(0)),
  );

function linesFor(
  selection: PlanSelection,
  catalog: readonly CatalogPrice[],
  kept: readonly SubscribedItem[],
) {
  const lines: QuoteLine[] = [];
  const missing: string[] = [];
  for (const item of itemsOf(selection)) {
    const quantity = item === CONNECTED_ITEM ? selection.connectedAccounts : 1;
    // Preço novo não muda quem já assina: item que continua fica no preço com que entrou.
    const own = kept.find((row) => row.item === item);
    if (own) {
      lines.push({ item, amount: own.amount, quantity, stripePriceId: own.price });
      continue;
    }
    const price = catalog.find((row) => row.item === item && row.cycle === selection.cycle);
    if (price) {
      lines.push({ item, amount: price.amount, quantity, stripePriceId: price.stripePriceId });
    } else {
      missing.push(item);
    }
  }
  return { lines, missing };
}

/**
 * Preço da escolha. `kept` são os itens que a família já assina **no mesmo ciclo**: chega vazio a quem
 * ainda não assina ou está trocando de ciclo.
 */
export function quotePlan(
  input: PlanSelection,
  catalog: readonly CatalogPrice[],
  kept: readonly SubscribedItem[] = [],
): PlanQuote {
  const selection = normalizeSelection(input);
  const { lines, missing } = linesFor(selection, catalog, kept);
  const total = sum(lines);
  if (selection.family) return { lines, total, missing, familySaves: null };

  const family = normalizeSelection({
    ...FAMILY_SELECTION,
    messages: selection.messages,
    currencies: selection.currencies,
    connectedAccounts: selection.connectedAccounts,
    cycle: selection.cycle,
  });
  const packed = linesFor(family, catalog, kept);
  const difference = money(total).minus(sum(packed.lines));
  const saves = packed.missing.length === 0 && difference.gt(0);
  return { lines, total, missing, familySaves: saves ? toDbAmount(difference) : null };
}

export interface Entitlements {
  modules: BillingModule[];
  /** Null: sem limite. */
  entryLimit: number | null;
  messageLimit: number;
  currencies: Currency[];
}

/** O que os itens liberam. Item desconhecido não libera nada. */
export function entitlementsOf(items: readonly string[]): Entitlements {
  const selection = selectionOfItems(items, "mes");
  const hasBase = items.some((item) => item === "familia" || item.startsWith("base:"));
  const entries = selection.entries;
  return {
    modules: selection.messages > 0 ? [...selection.modules, "assistente"] : selection.modules,
    entryLimit: !hasBase ? 0 : entries === "ilimitado" ? null : Number(entries),
    messageLimit: selection.messages,
    currencies: selection.currencies,
  };
}

/**
 * `livre`: chave desligada, todos como hoje. `leitura`: teste acabou, ou a assinatura acabou: vê e
 * exporta, sem gravar, sem agentes e sem IA. `vip`: concessão sem custo do painel (ADR-0025).
 */
export type AccessMode = "livre" | "cortesia" | "teste" | "assinatura" | "leitura" | "vip";

export interface FamilyAccess {
  mode: AccessMode;
  modules: readonly BillingModule[];
  /** Null: sem limite. */
  entryLimit: number | null;
  messageLimit: number | null;
  /** Moedas além da principal. Null: todas. */
  currencies: readonly Currency[] | null;
  /** Cobrança falhou: o acesso segue enquanto a Stripe tenta de novo. */
  pastDue: boolean;
  trialEndsAt: Date | null;
  /** Concessão VIP valendo agora, de qualquer tipo. Null: nenhuma. */
  vip: VipSummary | null;
}

export interface SubscriptionState {
  courtesy: boolean;
  courtesyUntil: Date | null;
  trialEndsAt: Date | null;
  status: string | null;
  items: readonly SubscribedItem[];
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
}

export const VIP_COSTS = ["sem_custo", "desconto"] as const;
export type VipCost = (typeof VIP_COSTS)[number];

export const VIP_SCOPES = ["familia", "pessoa"] as const;
export type VipScope = (typeof VIP_SCOPES)[number];

/** Lista fechada, e não texto livre: motivo escrito à mão vira nome de pessoa no painel (regra 5). */
export const VIP_REASONS = [
  "parceria",
  "imprensa",
  "equipe",
  "primeiros_clientes",
  "atendimento",
  "teste_interno",
  "outro",
] as const;
export type VipReason = (typeof VIP_REASONS)[number];

/** Quantos dias antes do fim o painel avisa. */
export const VIP_NOTICE_DAYS = 14;
export const MIN_VIP_DISCOUNT = 1;
export const MAX_VIP_DISCOUNT = 99;

export interface VipState {
  cost: VipCost;
  discountPercent: number | null;
  /** Tudo liberado. Falso: só `modules`, com os limites e as moedas abaixo. */
  full: boolean;
  modules: readonly BillingModule[];
  /** Null: sem limite. */
  entryLimit: number | null;
  messageLimit: number | null;
  currencies: readonly Currency[];
  endsAt: Date | null;
  revokedAt: Date | null;
  /** Falso: VIP de pessoa, e ela deixou de ser responsável pela família. */
  holderActive: boolean;
}

export type VipSummary = Pick<VipState, "cost" | "discountPercent" | "endsAt">;

/** Vale agora? Vencer não apaga nada: é só deixar de responder sim. */
export const vipActive = (vip: VipState, now: Date) =>
  vip.revokedAt === null && vip.holderActive && (vip.endsAt === null || vip.endsAt > now);

/** Termina nos próximos `VIP_NOTICE_DAYS` dias. */
export const vipEndingSoon = (vip: Pick<VipState, "endsAt">, now: Date) =>
  vip.endsAt !== null &&
  vip.endsAt > now &&
  vip.endsAt.getTime() - now.getTime() <= VIP_NOTICE_DAYS * DAY_MS;

/** Concessão sem custo que acaba em breve: a família precisa saber antes de cair em só leitura. */
export const vipNoticeDue = (vip: VipState, now: Date) =>
  vip.cost === "sem_custo" && vipActive(vip, now) && vipEndingSoon(vip, now);

/** Situações da Stripe em que o serviço segue. `incomplete` espera o boleto ou o primeiro pagamento. */
const PAYING = new Set(["active", "trialing", "past_due"]);
/** Evento de cancelamento atrasado não dá acesso de graça depois do fim do período pago. */
const CANCEL_GRACE_DAYS = 3;
/** Situações da Stripe das quais a assinatura não volta: não cobra mais nada. */
const STRIPE_ENDED = new Set(["canceled", "incomplete_expired"]);

/** A assinatura segue existindo na Stripe, mesmo esperando pagamento ou sem conseguir cobrar. */
export const stripeAlive = (status: string | null) => status !== null && !STRIPE_ENDED.has(status);

/** Situação que mantém o serviço: é o que `resolveAccess` e a receita chamam de assinatura de pé. */
export function stripeServing(
  subscription: Pick<SubscriptionState, "status" | "cancelAtPeriodEnd" | "currentPeriodEnd">,
  now: Date,
) {
  const { status, cancelAtPeriodEnd, currentPeriodEnd } = subscription;
  const ended =
    cancelAtPeriodEnd &&
    currentPeriodEnd !== null &&
    now.getTime() > currentPeriodEnd.getTime() + CANCEL_GRACE_DAYS * DAY_MS;
  return status !== null && PAYING.has(status) && !ended;
}

const FULL = {
  modules: BILLING_MODULES,
  entryLimit: null,
  messageLimit: null,
  currencies: null,
  pastDue: false,
  trialEndsAt: null,
  vip: null,
} as const;

/** O que a família tem sem contar o VIP. */
function planAccess(subscription: SubscriptionState | null, now: Date): FamilyAccess {
  if (!subscription) return { ...FULL, mode: "cortesia" };
  const { courtesy, courtesyUntil, trialEndsAt, status, items } = subscription;
  if (courtesy && (!courtesyUntil || courtesyUntil > now)) return { ...FULL, mode: "cortesia" };

  if (stripeServing(subscription, now)) {
    const granted = entitlementsOf(items.map((row) => row.item));
    return {
      mode: "assinatura",
      modules: granted.modules,
      entryLimit: granted.entryLimit,
      messageLimit: granted.messageLimit,
      currencies: granted.currencies,
      pastDue: status === "past_due",
      trialEndsAt: null,
      vip: null,
    };
  }
  if (trialEndsAt && trialEndsAt > now) return { ...FULL, mode: "teste", trialEndsAt };
  return {
    mode: "leitura",
    modules: [],
    entryLimit: 0,
    messageLimit: 0,
    currencies: [],
    pastDue: false,
    trialEndsAt,
    vip: null,
  };
}

/** O maior dos dois limites. Null: sem limite. */
const widest = (a: number | null, b: number | null) =>
  a === null || b === null ? null : Math.max(a, b);

/** O que a concessão libera. Sem mensagens, o assistente não entra, mesmo que venha na lista. */
function vipEntitlements(vip: VipState) {
  if (vip.full) return FULL;
  const talks = vip.messageLimit === null || vip.messageLimit > 0;
  return {
    modules: vip.modules.filter((module) => module !== "assistente" || talks),
    entryLimit: vip.entryLimit,
    messageLimit: vip.messageLimit,
    currencies: vip.currencies,
  };
}

/** Plano e concessão somam: VIP nunca tira nada do que a família já tinha. */
function addVip(plan: FamilyAccess, vip: VipState): FamilyAccess {
  const grant = vipEntitlements(vip);
  return {
    ...plan,
    modules: BILLING_MODULES.filter(
      (module) => plan.modules.includes(module) || grant.modules.includes(module),
    ),
    entryLimit: widest(plan.entryLimit, grant.entryLimit),
    messageLimit: widest(plan.messageLimit, grant.messageLimit),
    currencies:
      plan.currencies === null || grant.currencies === null
        ? null
        : unique([...plan.currencies, ...grant.currencies]),
  };
}

/**
 * Uma regra só para web, worker e assistente. Sem linha da família, o que não deveria acontecer porque
 * o gatilho da migração cria uma, a família fica com tudo: erro nosso não vira cobrança nem bloqueio.
 *
 * O VIP é uma camada por cima do plano e não muda a assinatura. Por isso vencer devolve exatamente o que
 * havia antes, sem apagar nada, e ninguém é cobrado: acabar a concessão não abre cobrança nenhuma. Com
 * desconto, ela só soma enquanto a assinatura paga: desconto não é acesso de graça.
 */
export function resolveAccess(input: {
  billingEnabled: boolean;
  subscription: SubscriptionState | null;
  now: Date;
  vip?: VipState | null;
}): FamilyAccess {
  const { billingEnabled, subscription, now, vip = null } = input;
  if (!billingEnabled) return { ...FULL, mode: "livre" };
  const plan = planAccess(subscription, now);
  if (!vip || !vipActive(vip, now)) return plan;
  const summary: VipSummary = {
    cost: vip.cost,
    discountPercent: vip.discountPercent,
    endsAt: vip.endsAt,
  };
  if (vip.cost === "desconto") {
    return plan.mode === "assinatura"
      ? { ...addVip(plan, vip), vip: summary }
      : { ...plan, vip: summary };
  }
  return { ...addVip(plan, vip), mode: "vip", trialEndsAt: null, vip: summary };
}

/**
 * A Stripe ainda pode cobrar? Inclui quem espera boleto (`incomplete`) e fatura sem pagar (`unpaid`): dar de
 * graça a quem ainda vai pagar faria a família pagar pelo que ganhou. O painel recusa até a assinatura estar
 * marcada para acabar.
 */
export const willChargeAgain = (
  subscription: Pick<SubscriptionState, "status" | "cancelAtPeriodEnd">,
) => stripeAlive(subscription.status) && !subscription.cancelAtPeriodEnd;

/** Pode agir: gravar, rodar agente, chamar a IA. */
export const canUse = (access: FamilyAccess, module: BillingModule) =>
  access.modules.includes(module);

/**
 * Pode abrir a tela. Em só leitura a família continua vendo tudo o que é dela, e VIP nunca tira visão: com
 * módulos escolhidos, o que ficou de fora abre só para consulta.
 */
export const canView = (access: FamilyAccess, module: BillingModule) =>
  access.mode === "leitura" || access.mode === "vip" || canUse(access, module);

/** VIP com módulos escolhidos: parte das telas é só consulta, e a família precisa saber por quê. */
export const vipPartial = (access: FamilyAccess) =>
  access.mode === "vip" && access.modules.length < BILLING_MODULES.length;

/** VIP sem custo e sem data não tem o que assinar: nada acaba. Com data, dá para assinar antes. */
export const canSubscribe = (access: FamilyAccess) =>
  access.mode !== "vip" || access.vip?.endsAt != null;

/** A Stripe exige pelo menos dois dias de prazo até a primeira cobrança. Uma hora a mais é a folga. */
const MIN_FIRST_CHARGE_HOURS = 49;

/**
 * Primeira cobrança de quem assina durante o VIP: quando ele acaba, para não pagar por dias que já ganhou.
 * Faltando menos que o prazo da Stripe, vale o prazo: a família ganha umas horas, e não paga em dobro.
 */
export function firstChargeAfterVip(endsAt: Date, now: Date): Date {
  const earliest = now.getTime() + MIN_FIRST_CHARGE_HOURS * 60 * 60 * 1000;
  return new Date(Math.max(endsAt.getTime(), earliest));
}

/** O que a família paga depois do desconto da Stripe. Null: sem desconto. */
export const discountedAmount = (amount: string, percent: number | null) =>
  percent
    ? toDbAmount(money(amount).times(money(100).minus(percent)).dividedBy(100))
    : toDbAmount(amount);

/** Moeda principal é grátis. Moeda adicional cancelada: a conta fica, só leitura. */
export const canUseCurrency = (access: FamilyAccess, currency: Currency, main: Currency) =>
  currency === main || access.currencies === null || access.currencies.includes(currency);

export type UsageLevel = "normal" | "aviso" | "limite";

export function usageLevel(used: number, limit: number | null): UsageLevel {
  if (limit === null) return "normal";
  if (used >= limit) return "limite";
  return money(used).gte(money(limit).times(USAGE_WARNING_RATIO)) ? "aviso" : "normal";
}

/** Vagas que sobram. Quem passou do limite não fica com número negativo. */
export const quotaLeft = (used: number, limit: number) => Math.max(limit - used, 0);

export type ChangeStep = PlanSelection | null;

export interface PlanChange {
  /** Vale na hora, com cobrança proporcional. Null: nada muda agora. */
  now: ChangeStep;
  /** Vale no fim do ciclo pago. Null: nada fica marcado. */
  later: ChangeStep;
}

const tierRank = (tier: EntryTier) => ENTRY_TIERS.indexOf(tier);

const sameItems = (a: PlanSelection, b: PlanSelection) => {
  const left = itemsOf(a).toSorted();
  const right = itemsOf(b).toSorted();
  return left.length === right.length && left.every((item, index) => item === right[index]);
};

const sameSelection = (a: PlanSelection, b: PlanSelection) =>
  a.cycle === b.cycle && a.connectedAccounts === b.connectedAccounts && sameItems(a, b);

/** O melhor dos dois em cada campo: é o que a família tem enquanto a redução não chega. */
function strongest(a: PlanSelection, b: PlanSelection, cycle: BillingCycle): PlanSelection {
  const currencies = unique([...a.currencies, ...b.currencies]);
  const messages = Math.max(a.messages, b.messages) as MessageTier;
  const connectedAccounts = Math.max(a.connectedAccounts, b.connectedAccounts);
  if (a.family || b.family) {
    return normalizeSelection({
      ...FAMILY_SELECTION,
      messages,
      currencies,
      connectedAccounts,
      cycle,
    });
  }
  return normalizeSelection({
    family: false,
    entries: tierRank(a.entries) >= tierRank(b.entries) ? a.entries : b.entries,
    modules: unique([...a.modules, ...b.modules]),
    messages,
    currencies,
    connectedAccounts,
    cycle,
  });
}

/**
 * Separa o que sobe, que vale na hora, do que desce, que espera o fim do ciclo. Quem soma um módulo e
 * tira outro recebe o novo agora e perde o antigo só depois do que já pagou. Mensal para anual vale
 * inteiro na hora; anual para mensal espera o ano acabar.
 */
export function planChange(currentInput: PlanSelection, targetInput: PlanSelection): PlanChange {
  const current = normalizeSelection(currentInput);
  const target = normalizeSelection(targetInput);
  if (sameSelection(current, target)) return { now: null, later: null };
  // Mensal para anual abre um ciclo novo na hora: cobra só o que a pessoa pediu, e o resto do mês vira
  // crédito na Stripe. Nada fica para depois, porque o "depois" seria daqui a um ano.
  if (current.cycle === "mes" && target.cycle === "ano") return { now: target, later: null };
  const cycle: BillingCycle = current.cycle === "ano" || target.cycle === "ano" ? "ano" : "mes";
  const reached = strongest(current, target, cycle);
  const now = sameSelection(reached, current) ? null : reached;
  const later = sameSelection(reached, target) ? null : target;
  return { now, later };
}

/** Dentro dos 7 dias da primeira cobrança, e uma vez só. */
export function refundWindowOpen(input: {
  firstPaidAt: Date | null;
  refundedAt: Date | null;
  now: Date;
}): boolean {
  const { firstPaidAt, refundedAt, now } = input;
  if (!firstPaidAt || refundedAt) return false;
  return now.getTime() <= firstPaidAt.getTime() + REFUND_DAYS * DAY_MS;
}

/** Assinatura anual que renova nos próximos 30 dias e ainda vai renovar. */
export function annualRenewalDue(input: {
  cycle: BillingCycle | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  now: Date;
}): boolean {
  const { cycle, status, cancelAtPeriodEnd, currentPeriodEnd, now } = input;
  if (cycle !== "ano" || cancelAtPeriodEnd || !currentPeriodEnd) return false;
  if (status !== "active") return false;
  const left = currentPeriodEnd.getTime() - now.getTime();
  return left > 0 && left <= ANNUAL_RENEWAL_NOTICE_DAYS * DAY_MS;
}
