// Liberação em etapas do importador (ADR-0030). Nunca rodou em Linux nem com IA real, então nasce desligado:
// só o admin do serviço enxerga. Família comum não vê botão nem rota. `canUse` continua valendo, item a item.
import "server-only";
import { notFound } from "next/navigation";
import { isServiceAdmin, platformFlags, requireTenant } from "@/lib/session";

/** Esta pessoa pode ver o importador? Desligado, só quem administra o serviço. */
export async function smartImportOpen(user: { id: string; email: string }): Promise<boolean> {
  return (await platformFlags()).smartImportEnabled || isServiceAdmin(user);
}

/** Sessão para tela, action e rota do importador. Quem não pode recebe 404: nem sabe que existe. */
export async function requireSmartImport() {
  const tenant = await requireTenant();
  if (!(await smartImportOpen(tenant.session.user))) notFound();
  return tenant;
}
