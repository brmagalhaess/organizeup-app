// Única porta para a API da Stripe (ADR-0023). Nunca chamada dentro de `withHousehold`: as actions leem,
// fecham a transação e só então chegam aqui. Só leva à Stripe o id da família, em metadata. O estado local
// muda pelo webhook, nunca pela resposta destas chamadas.
import "server-only";
import { fromCents, type BillingCycle } from "@organizeup/domain";
import Stripe from "stripe";
import { HOUSEHOLD_METADATA } from "./events";
import { stripeKeyMode, stripeUsable, StripeKeyRefused } from "./stripe-key";

export interface PriceLine {
  price: string;
  quantity: number;
}

export interface CheckoutInput {
  householdId: string;
  customerId: string;
  prices: PriceLine[];
  cycle: BillingCycle;
  locale: string;
  successUrl: string;
  cancelUrl: string;
}

export interface ChangeInput {
  householdId: string;
  subscriptionId: string;
  scheduleId: string | null;
  /** Preços que valem na hora. Null: nada muda agora. */
  now: PriceLine[] | null;
  /** Preços do próximo ciclo. Null: nada fica marcado. */
  later: PriceLine[] | null;
  /** A mesma data da prévia, para a Stripe cobrar o valor que a tela mostrou. */
  prorationDate: number | null;
}

export interface ChangePreview {
  /** O que sai na hora, em reais. */
  dueNow: string;
  prorationDate: number;
}

export type RefundOutcome = "devolvido" | "boleto" | "nada_a_devolver";

export interface BillingGateway {
  /** Cliente antes do pagamento: é o que amarra as tentativas da família a um cliente só. */
  createCustomer(householdId: string): Promise<string>;
  /** O cliente já tem assinatura viva, mesmo que o webhook ainda não tenha chegado? */
  hasLiveSubscription(customerId: string): Promise<boolean>;
  /** Fecha o pagamento anterior. True: ele já foi pago, e não dá para abrir outro. */
  expireCheckout(sessionId: string): Promise<boolean>;
  createCheckout(input: CheckoutInput): Promise<{ id: string; url: string }>;
  previewChange(subscriptionId: string, prices: PriceLine[]): Promise<ChangePreview>;
  applyChange(input: ChangeInput): Promise<void>;
  setCancelAtPeriodEnd(input: {
    householdId: string;
    subscriptionId: string;
    scheduleId: string | null;
    cancel: boolean;
  }): Promise<void>;
  /** Encerra na hora. Assinatura que já acabou não é erro. */
  cancelNow(subscriptionId: string): Promise<void>;
  /** Encerra e devolve tudo o que foi cobrado desde a primeira cobrança. Repetir conclui o que faltou. */
  refundAndCancel(input: {
    subscriptionId: string;
    customerId: string;
    since: Date;
  }): Promise<RefundOutcome>;
  portalUrl(customerId: string, returnUrl: string): Promise<string>;
}

const LOCALES: Record<string, Stripe.Checkout.SessionCreateParams.Locale> = {
  "pt-BR": "pt-BR",
  en: "en",
  es: "es",
};

/** Só o que entra, sai e muda de quantidade. Item igual não é tocado: é assim que mantém o preço antigo. */
export function itemDiff(
  current: Array<PriceLine & { id: string }>,
  target: PriceLine[],
): Stripe.SubscriptionUpdateParams.Item[] {
  const staying = new Map(target.map((line) => [line.price, line.quantity]));
  const present = new Set(current.map((item) => item.price));
  return [
    ...current
      .filter((item) => !staying.has(item.price))
      .map((item) => ({ id: item.id, deleted: true })),
    ...current.flatMap((item) => {
      const quantity = staying.get(item.price);
      return quantity !== undefined && quantity !== item.quantity
        ? [{ id: item.id, quantity }]
        : [];
    }),
    ...target.filter((line) => !present.has(line.price)),
  ];
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Situações em que a assinatura não cobra mais. */
const ENDED: readonly string[] = ["canceled", "incomplete_expired"];

class StripeGateway implements BillingGateway {
  constructor(private readonly stripe: Stripe) {}

  async createCustomer(householdId: string): Promise<string> {
    const customer = await this.stripe.customers.create(
      { metadata: { [HOUSEHOLD_METADATA]: householdId } },
      { idempotencyKey: `cliente:${householdId}` },
    );
    return customer.id;
  }

  async hasLiveSubscription(customerId: string): Promise<boolean> {
    const list = await this.stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    return list.data.some((row) => !ENDED.includes(row.status));
  }

  async expireCheckout(sessionId: string): Promise<boolean> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "open") await this.stripe.checkout.sessions.expire(sessionId);
    return session.status === "complete";
  }

  async createCheckout(input: CheckoutInput): Promise<{ id: string; url: string }> {
    const metadata = { [HOUSEHOLD_METADATA]: input.householdId };
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: input.householdId,
      line_items: input.prices,
      // Boleto só no anual: custa 12% de R$ 29,90 e não aceita reembolso pela Stripe.
      allowed_payment_method_types: input.cycle === "ano" ? ["card", "boleto"] : ["card"],
      metadata,
      subscription_data: { metadata },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer: input.customerId,
      ...(LOCALES[input.locale] ? { locale: LOCALES[input.locale] } : {}),
    });
    if (!session.url) throw new Error("checkout_sem_url");
    return { id: session.id, url: session.url };
  }

  private async items(subscriptionId: string) {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    return subscription.items.data.map((item) => ({
      id: item.id,
      price: item.price.id,
      quantity: item.quantity ?? 1,
    }));
  }

  async previewChange(subscriptionId: string, prices: PriceLine[]): Promise<ChangePreview> {
    const prorationDate = seconds(new Date());
    const invoice = await this.stripe.invoices.createPreview({
      subscription: subscriptionId,
      subscription_details: {
        items: itemDiff(await this.items(subscriptionId), prices),
        proration_behavior: "always_invoice",
        proration_date: prorationDate,
      },
    });
    return { dueNow: fromCents(invoice.amount_due), prorationDate };
  }

  async applyChange(input: ChangeInput): Promise<void> {
    const { householdId, subscriptionId, scheduleId, now, later, prorationDate } = input;
    await this.keepingSchedule(householdId, subscriptionId, scheduleId, async () => {
      if (now) {
        await this.stripe.subscriptions.update(subscriptionId, {
          items: itemDiff(await this.items(subscriptionId), now),
          proration_behavior: "always_invoice",
          // Cartão recusado não dá o upgrade: a Stripe responde com erro e nada muda.
          payment_behavior: "error_if_incomplete",
          ...(prorationDate ? { proration_date: prorationDate } : {}),
        });
      }
      if (later) await this.scheduleForPeriodEnd(householdId, subscriptionId, later);
    });
  }

  /** Preços da fase seguinte do schedule. */
  private async scheduledPrices(scheduleId: string): Promise<PriceLine[] | null> {
    const schedule = await this.stripe.subscriptionSchedules.retrieve(scheduleId);
    const end = schedule.current_phase?.end_date;
    const phase = end ? schedule.phases.find((item) => item.start_date >= end) : undefined;
    return phase
      ? phase.items.map((item) => ({
          price: typeof item.price === "string" ? item.price : item.price.id,
          quantity: item.quantity ?? 1,
        }))
      : null;
  }

  /**
   * Com schedule ativo, a próxima fase desfaria o que mudar agora: solta antes. Se a mudança falhar, como
   * num cartão recusado, marca de novo a redução que estava lá: a recusa não pode apagar o que a pessoa pediu.
   */
  private async keepingSchedule(
    householdId: string,
    subscriptionId: string,
    scheduleId: string | null,
    change: () => Promise<void>,
  ): Promise<void> {
    if (!scheduleId) return change();
    const previous = await this.scheduledPrices(scheduleId);
    await this.stripe.subscriptionSchedules.release(scheduleId);
    try {
      await change();
    } catch (error) {
      if (previous) await this.scheduleForPeriodEnd(householdId, subscriptionId, previous);
      throw error;
    }
  }

  private async scheduleForPeriodEnd(
    householdId: string,
    subscriptionId: string,
    prices: PriceLine[],
  ): Promise<void> {
    const schedule = await this.stripe.subscriptionSchedules.create({
      from_subscription: subscriptionId,
    });
    const phase = schedule.phases[0];
    if (!phase) throw new Error("schedule_sem_fase");
    await this.stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      metadata: { [HOUSEHOLD_METADATA]: householdId },
      phases: [
        {
          start_date: phase.start_date,
          end_date: phase.end_date,
          items: phase.items.map((item) => ({
            price: typeof item.price === "string" ? item.price : item.price.id,
            quantity: item.quantity ?? 1,
          })),
        },
        {
          start_date: phase.end_date,
          items: prices,
          proration_behavior: "none",
        },
      ],
    });
  }

  async setCancelAtPeriodEnd(input: {
    householdId: string;
    subscriptionId: string;
    scheduleId: string | null;
    cancel: boolean;
  }): Promise<void> {
    const { householdId, subscriptionId, scheduleId, cancel } = input;
    await this.keepingSchedule(householdId, subscriptionId, scheduleId, async () => {
      await this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
    });
  }

  async cancelNow(subscriptionId: string): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    if (ENDED.includes(subscription.status)) return;
    await this.stripe.subscriptions.cancel(subscriptionId);
  }

  async refundAndCancel(input: {
    subscriptionId: string;
    customerId: string;
    since: Date;
  }): Promise<RefundOutcome> {
    const list = await this.stripe.charges.list({
      customer: input.customerId,
      created: { gte: seconds(input.since) - 60 },
      limit: 100,
    });
    const open = list.data.filter((charge) => charge.status === "succeeded" && !charge.refunded);
    // A Stripe não devolve boleto. Antes de encerrar: sem devolução, a pessoa não pode perder o plano.
    if (open.some((charge) => charge.payment_method_details?.type === "boleto")) return "boleto";
    // Encerra antes de devolver, e encerra também sem nada a devolver: se cair no meio, repetir conclui,
    // e nunca sobra assinatura ativa de quem já recebeu o dinheiro de volta.
    await this.cancelNow(input.subscriptionId);
    for (const charge of open) {
      await this.stripe.refunds.create(
        { charge: charge.id },
        { idempotencyKey: `devolucao:${charge.id}` },
      );
    }
    return open.length > 0 ? "devolvido" : "nada_a_devolver";
  }

  async portalUrl(customerId: string, returnUrl: string): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }
}

/**
 * Recusa chave de produção sem `STRIPE_ALLOW_LIVE=true`, e chave que não é da Stripe. Quem chega aqui já
 * passou por `billingActor`; esta é a segunda porta, para ninguém esquecer a primeira.
 */
export function billingGateway(
  env: Record<string, string | undefined> = process.env,
): BillingGateway {
  if (!stripeUsable(env)) throw new StripeKeyRefused(stripeKeyMode(env));
  return new StripeGateway(new Stripe(env.STRIPE_SECRET_KEY!.trim()));
}
