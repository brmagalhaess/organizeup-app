"use server";
import { adminSetFlag, FLAG_KEYS } from "@organizeup/db";
import { revalidatePath } from "next/cache";
import { stripeKeyMode, stripeUsable } from "@/lib/billing/stripe-key";
import { requireAdmin } from "@/lib/session";
import { runAdminAction } from "../painel";
import { done, failed, type AdminResult } from "../painel-result";
import { BILLING_CONFIRM } from "./estado";

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
  if (!stripeUsable()) {
    return failed(
      stripeKeyMode() === "producao"
        ? "Chave de produção sem STRIPE_ALLOW_LIVE=true. Nada mudou."
        : "Falta uma chave da Stripe válida. Nada mudou.",
    );
  }
  return runAdminAction("admin_billing_on_failed", async () => {
    await adminSetFlag(
      { adminUserId: session.user.id },
      { key: FLAG_KEYS.billing, enabled: true, action: "cobranca:ligar" },
    );
    refresh();
    return done("Cobrança ligada.");
  });
}

/** Desligar não cancela nada na Stripe: só volta todo mundo ao acesso livre. */
export async function disableBilling(_form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  return runAdminAction("admin_billing_off_failed", async () => {
    await adminSetFlag(
      { adminUserId: session.user.id },
      { key: FLAG_KEYS.billing, enabled: false, action: "cobranca:desligar" },
    );
    refresh();
    return done("Cobrança desligada. Todas as famílias voltam ao acesso livre.");
  });
}
