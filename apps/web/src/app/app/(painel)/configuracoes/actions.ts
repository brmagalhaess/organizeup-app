"use server";
import { deleteAllMemories, deleteMemory } from "@organizeup/ai";
import { canWrite, withHousehold } from "@organizeup/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import type { ActionState } from "@/app/app/actions";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { requireSession, requireTenant } from "@/lib/session";

function deleteError(error: unknown) {
  if (!(error instanceof APIError)) return "Não foi possível apagar a conta. Tente novamente.";
  if (error.body?.message === "FAMILY_HAS_MEMBERS") {
    return "Sua família tem outras pessoas. Remova o acesso delas em Família antes de apagar a conta.";
  }
  return error.body?.code === "INVALID_PASSWORD"
    ? "Senha incorreta."
    : "Não foi possível apagar a conta. Tente novamente.";
}

export async function deleteAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const password = String(formData.get("password") ?? "");
  if (!password)
    return { ok: false, message: null, fieldErrors: { password: "Informe sua senha." } };
  try {
    await getAuth().api.deleteUser({ headers: await headers(), body: { password } });
  } catch (error) {
    return { ok: false, message: deleteError(error) };
  }
  redirect("/");
}

const MEMORY_ERROR = "Não foi possível apagar agora. Tente de novo.";
const memoryId = z.uuid();

/** Apaga de verdade, com as versões antigas da anotação. Só quem pode escrever. */
export async function removeMemory(id: string): Promise<ActionState> {
  const { ctx } = await requireTenant();
  const parsed = memoryId.safeParse(id);
  if (!parsed.success || !canWrite(ctx)) return { ok: false, message: MEMORY_ERROR };
  try {
    await withHousehold(ctx, async (tx) => {
      await deleteMemory(tx, parsed.data);
      await audit(tx, ctx, "delete", "household_memories", parsed.data);
    });
  } catch {
    return { ok: false, message: MEMORY_ERROR };
  }
  revalidatePath("/app/configuracoes");
  return { ok: true, message: null };
}

export async function removeAllMemories(): Promise<ActionState> {
  const { ctx } = await requireTenant();
  if (!canWrite(ctx)) return { ok: false, message: MEMORY_ERROR };
  try {
    await withHousehold(ctx, async (tx) => {
      await deleteAllMemories(tx);
      await audit(tx, ctx, "delete_all", "household_memories");
    });
  } catch {
    return { ok: false, message: MEMORY_ERROR };
  }
  revalidatePath("/app/configuracoes");
  return { ok: true, message: null };
}
