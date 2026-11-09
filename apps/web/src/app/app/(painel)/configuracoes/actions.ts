"use server";
import { deleteAllMemories, deleteMemory } from "@organizeup/ai";
import { canWrite, wipeHouseholdData, withHousehold } from "@organizeup/db";
import { expandWipeScopes, isWipeScope, type WipeScope } from "@organizeup/domain";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import type { ActionState } from "@/app/app/actions";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { requireOwnData, requireSession, requireTenant } from "@/lib/session";
import { verifySecondFactor, type TwoFactorCheck } from "@/lib/two-factor";

async function deleteError(error: unknown) {
  const t = await getTranslations("settings.deleteAccount");
  if (!(error instanceof APIError)) return t("failed");
  if (error.body?.message === "FAMILY_HAS_MEMBERS") return t("familyHasMembers");
  if (error.body?.message === "BILLING_CANCEL_FAILED") return t("billingFailed");
  return error.body?.code === "INVALID_PASSWORD" ? t("wrongPassword") : t("failed");
}

/** Mensagem do segundo fator recusado, no campo `code`. Null quando passou. */
async function secondFactorError(check: TwoFactorCheck): Promise<ActionState | null> {
  if (check === "ok") return null;
  const t = await getTranslations("settings.twoFactor");
  if (check === "nao_ativado") return { ok: false, message: t("requiredToContinue") };
  return {
    ok: false,
    message: null,
    fieldErrors: { code: t(check === "codigo_vazio" ? "codeRequired" : "codeInvalid") },
  };
}

/** Apagar a conta exige a senha (Better Auth) e o segundo fator (ADR-0034). */
export async function deleteAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const password = String(formData.get("password") ?? "");
  if (!password) {
    const t = await getTranslations("settings.deleteAccount");
    return { ok: false, message: null, fieldErrors: { password: t("passwordRequired") } };
  }
  const refused = await secondFactorError(
    await verifySecondFactor({ user: session.user, code: String(formData.get("code") ?? "") }),
  );
  if (refused) return refused;
  try {
    await getAuth().api.deleteUser({ headers: await headers(), body: { password } });
  } catch (error) {
    return { ok: false, message: await deleteError(error) };
  }
  redirect("/");
}

/**
 * Limpa os módulos escolhidos (ADR-0034). Só quem responde pela família, com o segundo fator; a lista
 * fecha no servidor (`expandWipeScopes`), então o que a tela mostrou como "vai junto" é o que vai.
 */
export async function wipeData(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { session, ctx, role } = await requireTenant();
  const t = await getTranslations("settings.wipe");
  if (role !== "owner" || !canWrite(ctx)) return { ok: false, message: t("notAllowed") };
  const chosen = formData.getAll("scope").map(String).filter(isWipeScope);
  if (chosen.length === 0) return { ok: false, message: t("nothingChosen") };
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "APAGAR") {
    return { ok: false, message: null, fieldErrors: { confirm: t("confirmMismatch") } };
  }
  const refused = await secondFactorError(
    await verifySecondFactor({ user: session.user, code: String(formData.get("code") ?? "") }),
  );
  if (refused) return refused;

  const scopes: WipeScope[] = expandWipeScopes(chosen);
  try {
    await withHousehold(ctx, async (tx) => {
      const report = await wipeHouseholdData(tx, { householdId: ctx.householdId, scopes });
      await audit(tx, ctx, "wipe", "household_data", report.scopes.join(","));
    });
  } catch {
    return { ok: false, message: t("failed") };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: t("done", { count: scopes.length }) };
}

const memoryError = async () => (await getTranslations("settings.memories"))("failed");
const memoryId = z.uuid();

/** Apaga de verdade, com as versões antigas da anotação. Só quem pode escrever. */
export async function removeMemory(id: string): Promise<ActionState> {
  const { ctx } = await requireOwnData();
  const parsed = memoryId.safeParse(id);
  if (!parsed.success || !canWrite(ctx)) return { ok: false, message: await memoryError() };
  try {
    await withHousehold(ctx, async (tx) => {
      await deleteMemory(tx, parsed.data);
      await audit(tx, ctx, "delete", "household_memories", parsed.data);
    });
  } catch {
    return { ok: false, message: await memoryError() };
  }
  revalidatePath("/app/configuracoes");
  return { ok: true, message: null };
}

export async function removeAllMemories(): Promise<ActionState> {
  const { ctx } = await requireOwnData();
  if (!canWrite(ctx)) return { ok: false, message: await memoryError() };
  try {
    await withHousehold(ctx, async (tx) => {
      await deleteAllMemories(tx);
      await audit(tx, ctx, "delete_all", "household_memories");
    });
  } catch {
    return { ok: false, message: await memoryError() };
  }
  revalidatePath("/app/configuracoes");
  return { ok: true, message: null };
}
