"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import type { ActionState } from "@/app/app/actions";
import { getAuth } from "@/lib/auth";
import { requireSession } from "@/lib/session";

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
