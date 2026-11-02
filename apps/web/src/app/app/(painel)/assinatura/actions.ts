"use server";
// Montar, trocar e cancelar o plano (ADR-0023). Tudo lê, fecha a transação e só então chama a Stripe. O
// estado local muda pelo webhook: aqui nada grava em `household_subscriptions`.
import {
  claimBillingCheckout,
  householdCurrency,
  readBillingCatalog,
  readFamilyAccess,
  releaseBillingCheckout,
  saveBillingCheckout,
  withHousehold,
  type HouseholdSubscription,
} from "@organizeup/db";
import {
  BILLING_CYCLES,
  CURRENCIES,
  ENTRY_TIERS,
  itemsOf,
  MAX_CONNECTED_ACCOUNTS,
  MESSAGE_TIERS,
  normalizeSelection,
  PAID_MODULES,
  planChange,
  quotePlan,
  refundWindowOpen,
  selectionOfSubscribed,
  type PlanSelection,
} from "@organizeup/domain";
import { getLocale } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { billingActor, type BillingRefusal } from "@/lib/billing/actor";
import { billingGateway } from "@/lib/billing/gateway";
import { reportActionFailure } from "@/lib/diagnostics";
import { appUrl } from "@/lib/email-templates";

const SCREEN = "/app/assinatura";

/** Só códigos: a tela traduz. Mensagem de erro da Stripe nunca chega à família. */
export type PlanFailure =
  | BillingRefusal
  | "falhou"
  | "catalogo"
  | "sem_assinatura"
  | "invalido"
  /** Já há pagamento abrindo, ou pago e esperando o webhook. */
  | "em_andamento"
  /** VIP sem custo: abrir assinatura faria a família pagar pelo que ganhou (ADR-0025). */
  | "vip";
export type PlanRefused = { ok: false; code: PlanFailure };
export type PlanReply<T = object> = ({ ok: true } & T) | PlanRefused;

const refuse = (code: PlanFailure): PlanRefused => ({ ok: false, code });

const selectionSchema = z.strictObject({
  family: z.boolean(),
  entries: z.enum(ENTRY_TIERS),
  modules: z.array(z.enum(PAID_MODULES)).max(PAID_MODULES.length),
  messages: z.literal(MESSAGE_TIERS),
  currencies: z.array(z.enum(CURRENCIES)).max(CURRENCIES.length),
  connectedAccounts: z.number().int().min(0).max(MAX_CONNECTED_ACCOUNTS),
  cycle: z.enum(BILLING_CYCLES),
});

/** A moeda principal é grátis: nunca vira item, mesmo que a tela mande. */
async function chosen(raw: unknown, ctx: Parameters<typeof withHousehold>[0]) {
  const parsed = selectionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const main = await withHousehold(ctx, householdCurrency);
  return normalizeSelection({
    ...parsed.data,
    currencies: parsed.data.currencies.filter((code) => code !== main),
  });
}

const kept = (row: HouseholdSubscription, selection: PlanSelection) =>
  row.cycle === selection.cycle ? row.items : [];

/** Preços da Stripe da escolha. Null: falta preço criado no catálogo. */
async function pricesOf(selection: PlanSelection, row: HouseholdSubscription | null) {
  const quote = quotePlan(selection, await readBillingCatalog(), row ? kept(row, selection) : []);
  const prices = quote.lines.flatMap((line) =>
    line.stripePriceId ? [{ price: line.stripePriceId, quantity: line.quantity }] : [],
  );
  const complete = quote.missing.length === 0 && prices.length === quote.lines.length;
  return complete ? { prices, total: quote.total } : null;
}

const hasSubscription = (
  row: HouseholdSubscription | null,
): row is HouseholdSubscription & {
  stripeSubscriptionId: string;
  cycle: NonNullable<HouseholdSubscription["cycle"]>;
} =>
  Boolean(row?.stripeSubscriptionId && row.cycle) &&
  ["active", "trialing", "past_due"].includes(row?.status ?? "");

async function guarded<R>(name: string, run: () => Promise<R>): Promise<R | PlanRefused> {
  try {
    return await run();
  } catch (error) {
    // Sem a mensagem: a da Stripe pode trazer dados do pagador.
    const { name: type, code } = error as { name?: string; code?: string };
    console.error(JSON.stringify({ level: "error", msg: name, name: type, code }));
    reportActionFailure(name, error);
    return refuse("falhou");
  }
}

/** Abre o pagamento da Stripe. Depois dele, o webhook liga a assinatura. */
export async function subscribe(raw: unknown): Promise<PlanReply<{ url: string }>> {
  return guarded("plan_checkout_failed", async () => {
    const actor = await billingActor();
    if (!actor.ok) return actor;
    const { ctx, subscription } = actor;
    if (hasSubscription(subscription)) return refuse("invalido");
    const access = await readFamilyAccess(ctx);
    if (access.mode === "vip") return refuse("vip");
    const selection = await chosen(raw, ctx);
    if (!selection) return refuse("invalido");
    const priced = await pricesOf(selection, null);
    if (!priced) return refuse("catalogo");
    const { householdId } = ctx;
    // A Stripe é chamada fora de transação: a trava é uma linha, e dois cliques não abrem dois pagamentos.
    const claim = await claimBillingCheckout(householdId);
    if (!claim) return refuse("em_andamento");
    try {
      const gateway = billingGateway();
      const customerId =
        subscription?.stripeCustomerId ??
        claim.customerId ??
        (await gateway.createCustomer(householdId));
      if (customerId !== claim.customerId) await saveBillingCheckout(householdId, { customerId });
      if (await gateway.hasLiveSubscription(customerId)) return refuse("em_andamento");
      if (claim.sessionId && (await gateway.expireCheckout(claim.sessionId))) {
        return refuse("em_andamento");
      }
      const session = await gateway.createCheckout({
        householdId,
        customerId,
        prices: priced.prices,
        cycle: selection.cycle,
        locale: await getLocale(),
        successUrl: appUrl(`${SCREEN}?assinou=1`),
        cancelUrl: appUrl(SCREEN),
        ...(access.vip?.discountPercent ? { discountPercent: access.vip.discountPercent } : {}),
      });
      await saveBillingCheckout(householdId, { sessionId: session.id });
      return { ok: true, url: session.url };
    } finally {
      await releaseBillingCheckout(householdId);
    }
  });
}

export interface PlanPreview {
  /** Cobrado na hora. Null: nada muda agora. */
  dueNow: string | null;
  prorationDate: number | null;
  /** Total do ciclo depois de tudo. */
  nextTotal: string;
  /** Quando a redução entra. Null: não há redução. */
  laterAt: string | null;
  /** Itens que saem, para a tela dizer o que muda. */
  removed: string[];
  added: string[];
  /** A próxima cobrança depois da troca. Mensal para anual abre o ciclo hoje. */
  nextChargeAt: string | null;
}

const nextYear = () => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date;
};

/** O que a troca faz, antes de confirmar. */
export async function previewPlan(raw: unknown): Promise<PlanReply<{ preview: PlanPreview }>> {
  return guarded("plan_preview_failed", async () => {
    const actor = await billingActor();
    if (!actor.ok) return actor;
    const { ctx, subscription } = actor;
    if (!hasSubscription(subscription)) return refuse("sem_assinatura");
    const selection = await chosen(raw, ctx);
    if (!selection) return refuse("invalido");
    const current = selectionOfSubscribed(subscription.items, subscription.cycle);
    const { now, later } = planChange(current, selection);
    const final = await pricesOf(selection, subscription);
    if (!final) return refuse("catalogo");
    const before = itemsOf(current);
    const after = itemsOf(selection);
    const base = {
      nextTotal: final.total,
      laterAt: later ? (subscription.currentPeriodEnd?.toISOString() ?? null) : null,
      removed: before.filter((item) => !after.includes(item)),
      added: after.filter((item) => !before.includes(item)),
      nextChargeAt:
        subscription.cycle === "mes" && selection.cycle === "ano"
          ? nextYear().toISOString()
          : (subscription.currentPeriodEnd?.toISOString() ?? null),
    };
    if (!now) return { ok: true, preview: { ...base, dueNow: null, prorationDate: null } };
    const step = await pricesOf(now, subscription);
    if (!step) return refuse("catalogo");
    const { dueNow, prorationDate } = await billingGateway().previewChange(
      subscription.stripeSubscriptionId,
      step.prices,
    );
    return { ok: true, preview: { ...base, dueNow, prorationDate } };
  });
}

/** A prévia vale por 10 minutos. Depois disso a conta da Stripe é feita com a hora certa. */
const PREVIEW_SECONDS = 600;

/** Sobe na hora, desce no fim do ciclo. Devolve antes de o webhook chegar. */
export async function changePlan(raw: unknown, prorationDate: number | null): Promise<PlanReply> {
  return guarded("plan_change_failed", async () => {
    const actor = await billingActor();
    if (!actor.ok) return actor;
    const { ctx, subscription } = actor;
    if (!hasSubscription(subscription)) return refuse("sem_assinatura");
    const selection = await chosen(raw, ctx);
    if (!selection) return refuse("invalido");
    const current = selectionOfSubscribed(subscription.items, subscription.cycle);
    const { now, later } = planChange(current, selection);
    const [nowPrices, laterPrices] = await Promise.all([
      now ? pricesOf(now, subscription) : null,
      later ? pricesOf(later, subscription) : null,
    ]);
    if ((now && !nowPrices) || (later && !laterPrices)) return refuse("catalogo");
    const age = prorationDate === null ? Infinity : Date.now() / 1000 - prorationDate;
    await billingGateway().applyChange({
      householdId: ctx.householdId,
      subscriptionId: subscription.stripeSubscriptionId,
      scheduleId: subscription.stripeScheduleId,
      now: nowPrices?.prices ?? null,
      later: laterPrices?.prices ?? null,
      prorationDate: age >= 0 && age <= PREVIEW_SECONDS ? prorationDate : null,
    });
    revalidatePath(SCREEN);
    return { ok: true };
  });
}

/** Um clique, sem retenção: vale até o fim do período pago. */
export async function cancelPlan(): Promise<PlanReply> {
  return setCancel(true);
}

export async function resumePlan(): Promise<PlanReply> {
  return setCancel(false);
}

function setCancel(cancel: boolean): Promise<PlanReply> {
  return guarded("plan_cancel_failed", async () => {
    const actor = await billingActor();
    if (!actor.ok) return actor;
    const { subscription } = actor;
    if (!hasSubscription(subscription)) return refuse("sem_assinatura");
    await billingGateway().setCancelAtPeriodEnd({
      householdId: actor.ctx.householdId,
      subscriptionId: subscription.stripeSubscriptionId,
      scheduleId: subscription.stripeScheduleId,
      cancel,
    });
    revalidatePath(SCREEN);
    return { ok: true };
  });
}

/**
 * Arrependimento: 7 dias da primeira cobrança (CDC, art. 49). Devolve tudo e encerra na hora. Boleto a
 * Stripe não devolve: a tela manda falar com o suporte, e nada é encerrado.
 */
export async function refundPlan(): Promise<PlanReply<{ outcome: string }>> {
  return guarded("plan_refund_failed", async () => {
    const actor = await billingActor();
    if (!actor.ok) return actor;
    const { subscription } = actor;
    // Sem exigir assinatura ativa: se a devolução caiu no meio, ela já foi encerrada, e repetir conclui.
    if (
      !subscription?.stripeSubscriptionId ||
      !subscription.stripeCustomerId ||
      !subscription.firstPaidAt ||
      !refundWindowOpen({ ...subscription, now: new Date() })
    ) {
      return refuse("sem_assinatura");
    }
    const outcome = await billingGateway().refundAndCancel({
      subscriptionId: subscription.stripeSubscriptionId,
      customerId: subscription.stripeCustomerId,
      since: subscription.firstPaidAt,
    });
    revalidatePath(SCREEN);
    return { ok: true, outcome };
  });
}

/** Portal da Stripe só para cartão e faturas: a troca de plano é por esta tela. */
export async function openPortal(): Promise<PlanReply<{ url: string }>> {
  return guarded("plan_portal_failed", async () => {
    const actor = await billingActor();
    if (!actor.ok) return actor;
    const customer = actor.subscription?.stripeCustomerId;
    if (!customer) return refuse("sem_assinatura");
    return { ok: true, url: await billingGateway().portalUrl(customer, appUrl(SCREEN)) };
  });
}
