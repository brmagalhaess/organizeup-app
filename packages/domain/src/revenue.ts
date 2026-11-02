// Números da tela Receita do painel (ADR-0025). Tudo aqui é puro e por `money`: recebe o que o banco leu e devolve
// valores em reais, como texto, no formato do banco. Só para a plataforma: nenhum dado financeiro da família entra
// aqui, só o que ela paga ao serviço. Receita é de quem a Stripe cobra de fato, seja qual for o acesso: cortesia e VIP
// não apagam uma assinatura que segue cobrando.
import { money, toDbAmount } from "./money";
import type {
  AccessMode,
  BillingCycle,
  PaidModule,
  SubscribedItem,
  SubscriptionState,
} from "./plans";
import { PAID_MODULES, selectionOfItems, stripeServing } from "./plans";

export interface RevenueFamily {
  mode: AccessMode;
  subscription:
    | (Pick<
        SubscriptionState,
        "status" | "items" | "trialEndsAt" | "cancelAtPeriodEnd" | "currentPeriodEnd"
      > & {
        cycle: BillingCycle | null;
        discountPercent: number | null;
        canceledAt: Date | null;
        firstPaidAt: Date | null;
      })
    | null;
  /** Gasto de IA da família no mês, em dólar, como veio do banco. */
  aiCostUsd: string;
}

/** Faixa de mensagens por mês. `sem_receita`: quem a Stripe não cobra agora. */
export const REVENUE_TIERS = ["sem_assistente", "30", "100", "300", "sem_receita"] as const;
export type RevenueTier = (typeof REVENUE_TIERS)[number];

export interface TierRevenue {
  tier: RevenueTier;
  families: number;
  /** Receita mensal das famílias nesta faixa, em reais. */
  revenue: string;
  costUsd: string;
  /** Custo de IA em reais. Null: sem cotação do dólar. */
  costBrl: string | null;
  /** Custo sobre receita, em %. Null: sem receita ou sem cotação. */
  costShare: string | null;
}

export interface RevenueSummary {
  /** Receita mensal recorrente: quem está em dia, com o anual dividido por 12 e o desconto tirado. */
  mrr: string;
  active: number;
  /** Em atraso ficam fora da receita, e o valor em risco aparece aqui. */
  pastDue: number;
  pastDueAmount: string;
  /** Em teste, nosso ou da Stripe: ainda não pagam. */
  trial: number;
  /** Pediram para cancelar, e seguem até o fim do período pago. */
  cancelling: number;
  /** Assinaturas que acabaram de fato nos últimos 30 dias. */
  canceled30d: number;
  /** Null: nenhum assinante. */
  averageTicket: string | null;
  /** Null: nenhum teste terminou ainda. */
  trialConversion: { started: number; converted: number; percent: string } | null;
  /** Do mais assinado para o menos, contando a Família completa. */
  modules: Array<{ module: PaidModule; families: number }>;
  tiers: TierRevenue[];
}

type Subscription = NonNullable<RevenueFamily["subscription"]>;

const DAY_MS = 24 * 60 * 60 * 1000;
const PERCENT_SCALE = 1;

/** Quanto a assinatura rende por mês: anual dividido por 12, sem arredondar no meio. */
export function monthlyAmount(
  items: readonly SubscribedItem[],
  cycle: BillingCycle | null,
  discountPercent: number | null,
) {
  const total = items.reduce(
    (acc, row) => acc.plus(money(row.amount).times(row.quantity)),
    money(0),
  );
  const monthly = cycle === "ano" ? total.dividedBy(12) : total;
  return monthly.times(money(100).minus(discountPercent ?? 0)).dividedBy(100);
}

const percent = (part: ReturnType<typeof money>, whole: ReturnType<typeof money>) =>
  part.times(100).dividedBy(whole).toFixed(PERCENT_SCALE);

/** A Stripe cobra agora? Em teste, nosso ou dela, ainda não. */
const chargedNow = (sub: Subscription | null, now: Date): sub is Subscription =>
  sub !== null && sub.status !== "trialing" && stripeServing(sub, now);

function tierOf(sub: Subscription | null, now: Date): RevenueTier {
  if (!chargedNow(sub, now)) return "sem_receita";
  const { messages } = selectionOfItems(
    sub.items.map((row) => row.item),
    sub.cycle ?? "mes",
  );
  return messages === 0 ? "sem_assistente" : (String(messages) as RevenueTier);
}

/**
 * Quando acabou de fato. A Stripe marca `canceled_at` no pedido: quem cancelou para o fim do período só acaba
 * ali, e contar pelo pedido mostraria quem ainda está pagando como perdido.
 */
function endedAt(sub: Subscription): Date | null {
  if (sub.status !== "canceled") return null;
  return sub.cancelAtPeriodEnd && sub.currentPeriodEnd ? sub.currentPeriodEnd : sub.canceledAt;
}

export function revenueSummary(
  families: readonly RevenueFamily[],
  now: Date,
  /** Reais por dólar. Null: sem cotação. */
  usdRate: string | null,
): RevenueSummary {
  let mrr = money(0);
  let pastDueAmount = money(0);
  let active = 0;
  let pastDue = 0;
  let trial = 0;
  let cancelling = 0;
  let canceled30d = 0;
  let started = 0;
  let converted = 0;
  const modules = new Map<PaidModule, number>(PAID_MODULES.map((module) => [module, 0]));
  const tiers = new Map(
    REVENUE_TIERS.map((tier) => [tier, { families: 0, revenue: money(0), costUsd: money(0) }]),
  );

  for (const family of families) {
    const sub = family.subscription;
    const tier = tiers.get(tierOf(sub, now))!;
    tier.families += 1;
    tier.costUsd = tier.costUsd.plus(family.aiCostUsd);
    if (family.mode === "teste" || sub?.status === "trialing") trial += 1;
    if (!sub) continue;
    const ended = endedAt(sub);
    if (ended && ended <= now && now.getTime() - ended.getTime() <= 30 * DAY_MS) canceled30d += 1;
    if (sub.trialEndsAt && (sub.trialEndsAt <= now || sub.firstPaidAt)) {
      started += 1;
      if (sub.firstPaidAt) converted += 1;
    }
    if (!chargedNow(sub, now)) continue;
    if (sub.cancelAtPeriodEnd) cancelling += 1;
    const value = monthlyAmount(sub.items, sub.cycle, sub.discountPercent);
    if (sub.status === "past_due") {
      pastDue += 1;
      pastDueAmount = pastDueAmount.plus(value);
      continue;
    }
    active += 1;
    mrr = mrr.plus(value);
    tier.revenue = tier.revenue.plus(value);
    const selection = selectionOfItems(
      sub.items.map((row) => row.item),
      sub.cycle ?? "mes",
    );
    for (const module of selection.modules) modules.set(module, (modules.get(module) ?? 0) + 1);
  }

  return {
    mrr: toDbAmount(mrr),
    active,
    pastDue,
    pastDueAmount: toDbAmount(pastDueAmount),
    trial,
    cancelling,
    canceled30d,
    averageTicket: active > 0 ? toDbAmount(mrr.dividedBy(active)) : null,
    trialConversion:
      started > 0
        ? { started, converted, percent: percent(money(converted), money(started)) }
        : null,
    modules: [...modules.entries()]
      .map(([module, count]) => ({ module, families: count }))
      .toSorted((a, b) => b.families - a.families),
    tiers: REVENUE_TIERS.map((tier) => {
      const row = tiers.get(tier)!;
      const cost = usdRate ? row.costUsd.times(usdRate) : null;
      return {
        tier,
        families: row.families,
        revenue: toDbAmount(row.revenue),
        costUsd: row.costUsd.toFixed(2),
        costBrl: cost ? toDbAmount(cost) : null,
        costShare: cost && row.revenue.gt(0) ? percent(cost, row.revenue) : null,
      };
    }),
  };
}
