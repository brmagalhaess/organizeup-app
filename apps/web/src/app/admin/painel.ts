// Apoio às telas do painel do serviço: registro de acesso e leitura administrativa opcional.
import "server-only";
import { recordAdminAccess } from "@organizeup/db";

export const ADMIN_DB_MISSING = "Falta configurar o acesso de leitura do painel.";

/** A leitura entre famílias precisa de ADMIN_DATABASE_URL; sem ela, as telas avisam. */
export const hasAdminDatabase = () => Boolean(process.env.ADMIN_DATABASE_URL);

/** Código do erro para o log: nunca a mensagem, que pode trazer dados do banco. */
export function logAdminFailure(msg: string, error: unknown) {
  const { name, cause } = error as { name?: string; cause?: { code?: string } };
  console.error(JSON.stringify({ level: "error", msg, name, code: cause?.code }));
}

/** Registra a visita. `action` é curta e fixa: nunca leva o texto da busca. */
export async function noteAdminAccess(adminUserId: string, action: string) {
  await recordAdminAccess({ adminUserId, action }).catch((error: unknown) => {
    logAdminFailure("admin_access_log_failed", error);
  });
}
