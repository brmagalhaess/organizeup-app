// `canUse` no servidor (ADR-0023). A tela esconder botão não é proteção: toda tela, action e rota de
// módulo passa por aqui, e `plan-guard.test.ts` reprova quem esquecer.
import { readFamilyAccess, readOnlyContext } from "@organizeup/db";
import { canUse, canView, type BillingModule, type FamilyAccess } from "@organizeup/domain";
import { requireTenant } from "@/lib/session";

export type ModuleTenant = Awaited<ReturnType<typeof requireTenant>> & {
  access: FamilyAccess;
  /** A família pode ver isto. Falso: rota responde 403, e a tela vira convite. */
  allowed: boolean;
};

/**
 * Sessão para uma action ou rota de módulo. Com o módulo desligado, o contexto volta só leitura: o
 * `canWrite` de cada action responde não, e a RLS recusa o que escapar. Rota que devolve dado confere
 * `allowed`, porque ler a RLS deixa.
 */
export async function requireModule(module: BillingModule): Promise<ModuleTenant> {
  const tenant = await requireTenant();
  const access = await readFamilyAccess(tenant.ctx);
  return {
    ...tenant,
    ctx: canUse(access, module) ? tenant.ctx : readOnlyContext(tenant.ctx),
    access,
    allowed: canView(access, module),
  };
}
