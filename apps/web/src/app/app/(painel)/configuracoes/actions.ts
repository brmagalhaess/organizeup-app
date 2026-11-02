"use server";
import { deleteAllMemories, deleteMemory } from "@organizeup/ai";
import { canWrite, withHousehold } from "@organizeup/db";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import type { ActionState } from "@/app/app/actions";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { requireOwnData, requireSession } from "@/lib/session";

async function deleteError(error: unknown) {
  const t = await getTranslations("settings.deleteAccount");
  if (!(error instanceof APIError)) return t("failed");
  if (error.body?.message === "FAMILY_HAS_MEMBERS") return t("familyHasMembers");
  if (error.body?.message === "BILLING_CANCEL_FAILED") return t("billingFailed");
  return error.body?.code === "INVALID_PASSWORD" ? t("wrongPassword") : t("failed");
}

export async function deleteAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const password = String(formData.get("password") ?? "");
  if (!password) {
    const t = await getTranslations("settings.deleteAccount");
    return { ok: false, message: null, fieldErrors: { password: t("passwordRequired") } };
  }
  try {
    await getAuth().api.deleteUser({ headers: await headers(), body: { password } });
  } catch (error) {
    return { ok: false, message: await deleteError(error) };
  }
  redirect("/");
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
