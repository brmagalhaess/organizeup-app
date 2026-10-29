// Acesso administrativo (ou_admin, BYPASSRLS). Somente para rotinas de plataforma
// explicitamente revisadas (CODEOWNERS). Toda chamada exige um motivo, que é logado.
import { adminPool, type Db } from "./client";

export async function withAdmin<T>(reason: string, fn: (db: Db) => Promise<T>): Promise<T> {
  if (reason.trim().length < 5) {
    throw new Error("withAdmin exige um motivo descritivo.");
  }
  console.warn(JSON.stringify({ level: "warn", msg: "admin_db_access", reason }));
  return fn(adminPool().db);
}
