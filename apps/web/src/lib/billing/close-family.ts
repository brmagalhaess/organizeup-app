// Apagar família ou conta para a cobrança antes (ADR-0023). Sem isso, a Stripe seguiria cobrando quem já
// não tem nada aqui, e o evento da assinatura não acharia mais a família. Sempre fora de `withHousehold`.
import "server-only";
import { liveSubscriptionIds } from "@organizeup/db";
import { billingGateway } from "./gateway";

/**
 * Cancela o que ainda cobra nestas famílias. Lança se não conseguir, e quem chama recusa a exclusão: nada
 * é apagado com a cobrança de pé. Sem assinatura viva, nem olha a chave.
 */
export async function cancelBeforeDelete(householdIds: string[]): Promise<void> {
  const live = await liveSubscriptionIds(householdIds);
  if (live.length === 0) return;
  const gateway = billingGateway();
  for (const subscriptionId of live) await gateway.cancelNow(subscriptionId);
}
