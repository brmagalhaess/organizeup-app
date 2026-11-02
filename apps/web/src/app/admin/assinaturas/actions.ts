"use server";
// Ações por família (ADR-0025). As da Stripe leem, fecham a conexão e só então chamam o gateway: o estado local
// muda pelo webhook, como em todo o resto. Toda validação vem antes: a auditoria registra tentativa de verdade,
// e a falha, depois.
import {
  adminBillingFamily,
  adminEndCourtesy,
  adminFamilyAccess,
  adminGrantTrialDays,
  adminRecordBillingAction,
  adminSetCourtesy,
  adminStripeTarget,
  MAX_TRIAL_DAYS,
} from "@organizeup/db";
import { refundWindowOpen, willChargeAgain } from "@organizeup/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { billingGateway } from "@/lib/billing/gateway";
import { platformFlags, requireAdmin } from "@/lib/session";
import { stripeActions, stripeExitActions, type StripeActions } from "../cobranca/estado";
import { runAdminAction, targetId } from "../painel";
import { done, failed, type AdminResult } from "../painel-result";
import { endOfDay } from "../planos";

const OWN_FAMILY = "Você participa desta família. Use outra conta de administrador para isso.";
const NOT_FOUND = "Família não encontrada.";
const STILL_CHARGED =
  "A Stripe segue cobrando esta família. Cancele a assinatura antes, para ela não pagar pelo que ganhou.";

const refresh = (id: string) => {
  revalidatePath(`/admin/assinaturas/${id}`);
  revalidatePath("/admin/assinaturas");
  revalidatePath("/admin/receita");
};

export async function giveTrialDays(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const id = targetId.safeParse(form.get("id"));
  const days = z.coerce.number().int().min(1).max(MAX_TRIAL_DAYS).safeParse(form.get("days"));
  if (!id.success) return failed(NOT_FOUND);
  if (!days.success) return failed(`Escolha de 1 a ${MAX_TRIAL_DAYS} dias.`);
  return runAdminAction("admin_trial_days_failed", async () => {
    const admin = { adminUserId: session.user.id };
    const result = await adminGrantTrialDays(admin, id.data, days.data);
    if (result === "not_found") return failed(NOT_FOUND);
    if (result === "own_family") return failed(OWN_FAMILY);
    refresh(id.data);
    return done(`${days.data} dias de teste concedidos.`);
  });
}

export async function giveCourtesy(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return failed(NOT_FOUND);
  const day = String(form.get("until") ?? "");
  const end = day ? endOfDay(day) : null;
  if (day && !end) return failed("Data inválida.");
  if (end && end <= new Date()) return failed("A data precisa ser no futuro.");
  return runAdminAction("admin_courtesy_failed", async () => {
    const admin = { adminUserId: session.user.id };
    const result = await adminSetCourtesy(admin, id.data, end);
    if (result === "not_found") return failed(NOT_FOUND);
    if (result === "own_family") return failed(OWN_FAMILY);
    if (result === "assinatura_viva") return failed(STILL_CHARGED);
    refresh(id.data);
    return done("Cortesia concedida.");
  });
}

export async function endCourtesy(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return failed(NOT_FOUND);
  return runAdminAction("admin_courtesy_end_failed", async () => {
    const result = await adminEndCourtesy({ adminUserId: session.user.id }, id.data);
    if (result === "not_found") return failed(NOT_FOUND);
    if (result === "own_family") return failed(OWN_FAMILY);
    refresh(id.data);
    return done("Cortesia encerrada.");
  });
}

type Target = Exclude<Awaited<ReturnType<typeof adminStripeTarget>>, "own_family" | null> & {
  subscriptionId: string;
};

interface StripeStep {
  action: string;
  state: StripeActions;
  /** Motivo de recusa, antes de qualquer registro. Null: pode seguir. */
  check?: (target: Target, householdId: string) => Promise<string | null> | string | null;
  run: (target: Target, householdId: string) => Promise<AdminResult>;
}

/**
 * O caminho de toda ação na Stripe. Só o que passou por todas as conferências vira tentativa na auditoria, antes
 * de chamar, e fica o registro de falha se a Stripe recusar. Nada aqui entra em transação da família.
 */
async function onStripe(
  adminUserId: string,
  form: FormData,
  { action, state, check, run }: StripeStep,
): Promise<AdminResult> {
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return failed(NOT_FOUND);
  if (!state.available) return failed(state.reason ?? "Indisponível agora.");
  return runAdminAction("admin_stripe_action_failed", async () => {
    const admin = { adminUserId };
    const found = await adminStripeTarget(admin, id.data);
    if (found === "own_family") return failed(OWN_FAMILY);
    if (!found?.subscriptionId) return failed("Esta família não tem assinatura na Stripe.");
    const target = { ...found, subscriptionId: found.subscriptionId };
    const refusal = await check?.(target, id.data);
    if (refusal) return failed(refusal);
    await adminRecordBillingAction(admin, action, id.data);
    try {
      const outcome = await run(target, id.data);
      refresh(id.data);
      return outcome;
    } catch (error) {
      await adminRecordBillingAction(admin, `${action}_falhou`, id.data);
      throw error;
    }
  });
}

/** Cancelar e devolver não dependem de `billing_enabled`: quem já paga sempre consegue sair. */
export async function cancelSubscription(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  return onStripe(session.user.id, form, {
    action: "assinatura:cancelar",
    state: stripeExitActions(),
    check: ({ status, cancelAtPeriodEnd }) =>
      willChargeAgain({ status, cancelAtPeriodEnd })
        ? null
        : "Esta assinatura não vai cobrar de novo.",
    run: async (target, householdId) => {
      await billingGateway().setCancelAtPeriodEnd({
        householdId,
        subscriptionId: target.subscriptionId,
        scheduleId: target.scheduleId,
        cancel: true,
      });
      return done("Pedido enviado. A situação muda quando a Stripe confirmar.");
    },
  });
}

export async function refundSubscription(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  if (String(form.get("confirm") ?? "").trim() !== "DEVOLVER") {
    return failed("O texto digitado não confere. Nada mudou.");
  }
  return onStripe(session.user.id, form, {
    action: "assinatura:devolver",
    state: stripeExitActions(),
    check: ({ customerId, firstPaidAt, refundedAt }) =>
      customerId && firstPaidAt && refundWindowOpen({ firstPaidAt, refundedAt, now: new Date() })
        ? null
        : "A devolução só vale nos 7 dias da primeira cobrança, uma vez.",
    run: async (target) => {
      const outcome = await billingGateway().refundAndCancel({
        subscriptionId: target.subscriptionId,
        customerId: target.customerId!,
        since: target.firstPaidAt!,
      });
      if (outcome === "boleto") {
        return failed(
          "Boleto a Stripe não devolve. Nada mudou: o suporte devolve por transferência.",
        );
      }
      return done(
        outcome === "devolvido" ? "Devolvido e encerrado." : "Encerrado: nada a devolver.",
      );
    },
  });
}

export async function retryCharge(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const { billingEnabled } = await platformFlags();
  return onStripe(session.user.id, form, {
    action: "assinatura:reenviar",
    state: stripeActions(billingEnabled),
    check: ({ status }) =>
      status === "past_due" ? null : "Só dá para reenviar com a assinatura em atraso.",
    run: async (target) => {
      const outcome = await billingGateway().retryInvoice(target.subscriptionId);
      return outcome === "cobrada"
        ? done("Cobrança reenviada.")
        : failed("Não há fatura em aberto.");
    },
  });
}

/** Percentual do VIP com desconto que vale agora. */
async function grantedDiscount(householdId: string) {
  const family = await adminBillingFamily(householdId);
  return family ? (adminFamilyAccess(family, new Date()).vip?.discountPercent ?? null) : null;
}

export async function applyDiscount(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const { billingEnabled } = await platformFlags();
  return onStripe(session.user.id, form, {
    action: "assinatura:desconto",
    state: stripeActions(billingEnabled),
    check: async (_target, householdId) =>
      (await grantedDiscount(householdId))
        ? null
        : "Esta família não tem VIP com desconto valendo.",
    run: async (target, householdId) => {
      const percent = await grantedDiscount(householdId);
      await billingGateway().setDiscount({ subscriptionId: target.subscriptionId, percent });
      return done("Desconto enviado. Aparece aqui quando a Stripe confirmar.");
    },
  });
}

export async function removeDiscount(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const { billingEnabled } = await platformFlags();
  return onStripe(session.user.id, form, {
    action: "assinatura:desconto_fim",
    state: stripeActions(billingEnabled),
    check: ({ discountPercent }) =>
      discountPercent ? null : "Esta assinatura não tem desconto na Stripe.",
    run: async (target) => {
      await billingGateway().setDiscount({ subscriptionId: target.subscriptionId, percent: null });
      return done("Desconto retirado. A próxima cobrança volta ao preço cheio.");
    },
  });
}
