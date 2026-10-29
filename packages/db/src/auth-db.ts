// Conexão usada EXCLUSIVAMENTE pelo adapter do Better Auth (apps/web/src/lib/auth.ts).
// As tabelas de auth não têm RLS de tenant (ver ADR-0002). Não importe isto em outro lugar:
// o ESLint bloqueia (`no-restricted-imports`).
import { appPool } from "./client";
import { betterAuthSchema } from "./schema/auth";

export function authDb() {
  return appPool().db;
}

export { betterAuthSchema };
