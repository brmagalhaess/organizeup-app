// Apoio às telas do painel do serviço: registro de acesso e conexão administrativa opcional.
import "server-only";
import { recordAdminAccess } from "@organizeup/db";
import { z } from "zod";
import { failed, type AdminResult } from "./painel-result";

export const ADMIN_DB_MISSING = "Falta configurar o acesso administrativo do painel.";

/** A leitura entre famílias e as ações precisam de ADMIN_DATABASE_URL; sem ela, as telas avisam. */
export const hasAdminDatabase = () => Boolean(process.env.ADMIN_DATABASE_URL);

/** Código do erro para o log: nunca a mensagem, que pode trazer dados do banco. */
export function logAdminFailure(msg: string, error: unknown) {
  const { name, cause } = error as { name?: string; cause?: { code?: string } };
  console.error(JSON.stringify({ level: "error", msg, name, code: cause?.code }));
}

/** Registra a visita. `action` é curta e fixa: nunca leva o texto da busca. */
export async function noteAdminAccess(
  adminUserId: string,
  action: string,
  target?: { householdId?: string; userId?: string },
) {
  await recordAdminAccess({
    adminUserId,
    action,
    targetHouseholdId: target?.householdId,
    targetUserId: target?.userId,
  }).catch((error: unknown) => {
    logAdminFailure("admin_access_log_failed", error);
  });
}

/** Ids de família e de conta chegam do formulário; só o formato é conferido aqui. */
export const targetId = z.string().min(1).max(64);

/** Roda a ação e troca qualquer falha por uma mensagem curta, com o código só no log. */
export async function runAdminAction(
  logName: string,
  action: () => Promise<AdminResult>,
): Promise<AdminResult> {
  if (!hasAdminDatabase()) return failed(ADMIN_DB_MISSING);
  try {
    return await action();
  } catch (error) {
    logAdminFailure(logName, error);
    return failed("Não foi possível concluir agora. Tente de novo.");
  }
}
