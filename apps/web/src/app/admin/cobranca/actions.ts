"use server";
import { adminBillingFamilies, adminFamilyAccess, adminSetFlag, FLAG_KEYS } from "@organizeup/db";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { runAdminAction } from "../painel";
import { done, failed, type AdminResult } from "../painel-result";
import { liveSubscriptions } from "./atencao";
import { BILLING_CONFIRM, BILLING_OFF_CONFIRM, enableRefusal } from "./estado";

const refresh = () => {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
};

/** Liga a cobrança. A tela pede a digitação, e o servidor confere de novo. */
export async function enableBilling(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  if (String(form.get("confirm") ?? "").trim() !== BILLING_CONFIRM) {
    return failed("O texto digitado não confere. Nada mudou.");
  }
  const refusal = enableRefusal();
  if (refusal) return failed(`${refusal} Nada mudou.`);
  return runAdminAction("admin_billing_on_failed", async () => {
    await adminSetFlag(
      { adminUserId: session.user.id },
      { key: FLAG_KEYS.billing, enabled: true, action: "cobranca:ligar" },
    );
    refresh();
    return done("Cobrança ligada.");
  });
}

/**
 * Desligar não cancela nada na Stripe: quem assinou segue pagando, e só volta todo mundo ao acesso livre. Com
 * assinatura de pé, o servidor pede a digitação, para isso não acontecer num clique.
 */
export async function disableBilling(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const typed = String(form.get("confirm") ?? "").trim();
  return runAdminAction("admin_billing_off_failed", async () => {
    const now = new Date();
    const families = await adminBillingFamilies();
    const live = liveSubscriptions(
      families.map((family) => ({ family, access: adminFamilyAccess(family, now) })),
    );
    if (live > 0 && typed !== BILLING_OFF_CONFIRM) {
      return failed(`Há ${live} assinaturas seguindo na Stripe. Digite o texto para confirmar.`);
    }
    await adminSetFlag(
      { adminUserId: session.user.id },
      { key: FLAG_KEYS.billing, enabled: false, action: "cobranca:desligar" },
    );
    refresh();
    return done("Cobrança desligada. Todas as famílias voltam ao acesso livre.");
  });
}

/** Liberação do importador inteligente. Fica na auditoria, como toda chave do painel. */
export async function toggleSmartImport(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const on = form.get("enabled") === "true";
  return runAdminAction("admin_smart_import_failed", async () => {
    await adminSetFlag(
      { adminUserId: session.user.id },
      {
        key: FLAG_KEYS.smartImport,
        enabled: on,
        action: on ? "importador:ligar" : "importador:desligar",
      },
    );
    refresh();
    return done(on ? "Importador ligado para todas as famílias." : "Importador só para o admin.");
  });
}
