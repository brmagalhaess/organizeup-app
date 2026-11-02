// Do evento da Stripe ao que fica guardado (ADR-0023). O evento traz e-mail, nome e endereço do pagador:
// nada disso passa daqui. Só sai a lista fechada de `billingEventData`, com ids, datas e situações.
import type { BillingEventData } from "@organizeup/agents";
import type { BillingEventInput } from "@organizeup/db";
import Stripe from "stripe";

export const HOUSEHOLD_METADATA = "household_id";

/** Eventos que o endpoint precisa assinar na Stripe. A lista está também no runbook. */
export const STRIPE_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "subscription_schedule.created",
  "subscription_schedule.updated",
  "subscription_schedule.released",
  "subscription_schedule.canceled",
  "subscription_schedule.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
] as const;

/** Confere a assinatura e a idade do evento. Lança se qualquer uma falhar. Não precisa da chave secreta. */
export function verifyEvent(payload: string, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(payload, signature, secret);
}

const iso = (seconds: number | null | undefined) =>
  seconds ? new Date(seconds * 1000).toISOString() : null;

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

const lines = (items: Array<{ price: string | { id: string }; quantity?: number | undefined }>) =>
  items.map((item) => ({ price: idOf(item.price) ?? "", quantity: item.quantity ?? 1 }));

function subscriptionData(subscription: Stripe.Subscription): BillingEventData {
  const items = subscription.items.data;
  const first = items[0];
  return {
    kind: "subscription",
    subscriptionId: subscription.id,
    status: subscription.status,
    items: items.map((item) => ({ price: item.price.id, quantity: item.quantity ?? 1 })),
    periodStart: iso(first?.current_period_start),
    periodEnd: iso(first?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: iso(subscription.canceled_at),
    scheduleId: idOf(subscription.schedule),
  };
}

function scheduleData(schedule: Stripe.SubscriptionSchedule): BillingEventData {
  const open = schedule.status === "active" || schedule.status === "not_started";
  const end = schedule.current_phase?.end_date;
  const phase = open && end ? schedule.phases.find((item) => item.start_date >= end) : undefined;
  return {
    kind: "schedule",
    scheduleId: schedule.id,
    next: phase ? { items: lines(phase.items), at: iso(phase.start_date) ?? "" } : null,
    ended: !open,
  };
}

const invoiceLink = (invoice: Stripe.Invoice) => {
  const details = invoice.parent?.subscription_details ?? null;
  return {
    subscriptionId: idOf(details?.subscription),
    household: details?.metadata?.[HOUSEHOLD_METADATA] ?? null,
  };
};

interface Normalized {
  householdId: string | null;
  customerId: string | null;
  data: BillingEventData;
}

function normalize(event: Stripe.Event): Normalized | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      return {
        householdId: session.client_reference_id,
        customerId: idOf(session.customer),
        data: { kind: "checkout", subscriptionId: idOf(session.subscription) },
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      return {
        householdId: subscription.metadata[HOUSEHOLD_METADATA] ?? null,
        customerId: idOf(subscription.customer),
        data: subscriptionData(subscription),
      };
    }
    case "subscription_schedule.created":
    case "subscription_schedule.updated":
    case "subscription_schedule.released":
    case "subscription_schedule.canceled":
    case "subscription_schedule.completed": {
      const schedule = event.data.object;
      return {
        householdId: schedule.metadata?.[HOUSEHOLD_METADATA] ?? null,
        customerId: idOf(schedule.customer),
        data: scheduleData(schedule),
      };
    }
    case "invoice.paid": {
      const invoice = event.data.object;
      const link = invoiceLink(invoice);
      return {
        householdId: link.household,
        customerId: idOf(invoice.customer),
        data: {
          kind: "invoice_paid",
          subscriptionId: link.subscriptionId,
          paidAt: iso(invoice.status_transitions.paid_at ?? event.created) ?? "",
          amountPaid: invoice.amount_paid,
        },
      };
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const link = invoiceLink(invoice);
      return {
        householdId: link.household,
        customerId: idOf(invoice.customer),
        data: { kind: "invoice_failed", subscriptionId: link.subscriptionId },
      };
    }
    case "charge.refunded": {
      const charge = event.data.object;
      return {
        householdId: null,
        customerId: idOf(charge.customer),
        data: { kind: "refund", fully: charge.refunded },
      };
    }
    default:
      return null;
  }
}

/** Null: evento que não interessa. Fica fora da tabela, e a resposta para a Stripe é a mesma. */
export function normalizeEvent(event: Stripe.Event): BillingEventInput | null {
  const normalized = normalize(event);
  if (!normalized) return null;
  return {
    id: event.id,
    type: event.type,
    stripeAt: new Date(event.created * 1000),
    livemode: event.livemode,
    householdId: normalized.householdId,
    customerId: normalized.customerId,
    data: normalized.data,
  };
}
