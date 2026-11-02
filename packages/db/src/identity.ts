// Documento da conta (ADR-0022). Este pacote só guarda o que recebe: cifrar, abrir e calcular o hash é
// da web, a única que tem a chave. A linha é da pessoa, e a RLS exige `app.user_id`, sem o qual a conexão
// não vê nada. Erro de banco daqui pode citar o hash na mensagem: nunca o registre, só o código.
import { eq, isNull, sql } from "drizzle-orm";
import { tolerateSchemaLag } from "./access";
import { appPool } from "./client";
import { userIdentity } from "./schema";
import type { TenantTx } from "./tenant";

export type UserIdentityRow = typeof userIdentity.$inferSelect;

export type IdentityColumns = Pick<
  UserIdentityRow,
  | "inBrazil"
  | "personType"
  | "cpfEncrypted"
  | "cpfHash"
  | "cnpjEncrypted"
  | "cnpjHash"
  | "companyNameEncrypted"
>;

function withUser<T>(userId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return appPool().db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

function isUniqueViolation(error: unknown): boolean {
  for (
    let current: unknown = error;
    typeof current === "object" && current !== null;
    current = (current as { cause?: unknown }).cause
  ) {
    if ((current as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/** A linha da própria conta. Sem linha, ou sem a tabela ainda, devolve null. */
export async function readUserIdentity(userId: string): Promise<UserIdentityRow | null> {
  return tolerateSchemaLag(
    () =>
      withUser(userId, async (tx) => {
        const [row] = await tx.select().from(userIdentity).where(eq(userIdentity.userId, userId));
        return row ?? null;
      }),
    null,
  );
}

/**
 * Grava o que a pessoa informou. `taken`: CPF de pessoa física ou CNPJ já em outra conta. O CPF de
 * responsável por empresa pode repetir. `locked`: esta conta já tem documento, e ele não muda por aqui.
 */
export async function saveUserIdentity(
  userId: string,
  columns: IdentityColumns,
): Promise<"ok" | "taken" | "locked"> {
  try {
    return await withUser(userId, async (tx) => {
      const saved = await tx
        .insert(userIdentity)
        .values({ userId, ...columns })
        .onConflictDoUpdate({
          target: userIdentity.userId,
          set: { ...columns, updatedAt: new Date() },
          where: isNull(userIdentity.personType),
        })
        .returning({ userId: userIdentity.userId });
      return saved.length > 0 ? "ok" : "locked";
    });
  } catch (error) {
    if (isUniqueViolation(error)) return "taken";
    throw error;
  }
}

/** "Agora não": o pedido não volta sozinho. Dá para informar depois, em Configurações. */
export async function dismissIdentityPrompt(userId: string): Promise<void> {
  const now = new Date();
  await tolerateSchemaLag(
    () =>
      withUser(userId, async (tx) => {
        await tx
          .insert(userIdentity)
          .values({ userId, dismissedAt: now })
          .onConflictDoUpdate({
            target: userIdentity.userId,
            set: { dismissedAt: now, updatedAt: now },
          });
      }),
    undefined,
  );
}
