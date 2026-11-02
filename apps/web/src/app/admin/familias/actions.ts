"use server";
import {
  adminCheckDeleteHousehold,
  adminDeleteHousehold,
  adminHouseholdOwner,
  adminSetHouseholdSuspended,
} from "@organizeup/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { cancelBeforeDelete } from "@/lib/billing/close-family";
import { requireAdmin } from "@/lib/session";
import {
  ADMIN_DB_MISSING,
  hasAdminDatabase,
  logAdminFailure,
  noteAdminAccess,
  runAdminAction,
  targetId,
} from "../painel";
import { done, failed, type AdminResult } from "../painel-result";
import { loadFamilies, type FamiliesState } from "./data";

const browseSchema = z.object({
  q: z.string().trim().max(200),
  page: z.coerce.number().int().min(0).max(100_000),
  status: z.enum(["todas", "ativas", "suspensas"]),
  onboarding: z.enum(["todos", "completo", "pendente"]),
  activity: z.enum(["todas", "recentes", "paradas"]),
});

/**
 * Busca e paginação vão por POST de propósito: com o e-mail de um membro em `?q=`, ele ficaria no
 * log do proxy e no histórico do navegador. O registro de acesso guarda só o tipo da ação.
 */
export async function browseFamilies(
  previous: FamiliesState,
  form: FormData,
): Promise<FamiliesState> {
  const session = await requireAdmin();
  const parsed = browseSchema.safeParse({
    q: form.get("q") ?? "",
    page: form.get("page") ?? "0",
    status: form.get("status") ?? "todas",
    onboarding: form.get("onboarding") ?? "todos",
    activity: form.get("activity") ?? "todas",
  });
  if (!parsed.success) return { ...previous, message: "Busca inválida." };
  const { q, page, ...filters } = parsed.data;
  await noteAdminAccess(session.user.id, q ? "familias:busca" : "familias:lista");
  if (!hasAdminDatabase()) return { ...previous, message: ADMIN_DB_MISSING };
  try {
    return await loadFamilies(q, page, filters);
  } catch (error) {
    logAdminFailure("admin_families_failed", error);
    return { ...previous, message: "Não foi possível buscar agora. Tente de novo." };
  }
}

export interface OwnerContactState {
  name: string | null;
  email: string | null;
  message: string | null;
}

/** Ação explícita: adminHouseholdOwner registra quem pediu e qual família. */
export async function revealOwner(
  _previous: OwnerContactState,
  form: FormData,
): Promise<OwnerContactState> {
  const session = await requireAdmin();
  const empty = { name: null, email: null };
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return { ...empty, message: "Família inválida." };
  if (!hasAdminDatabase()) return { ...empty, message: ADMIN_DB_MISSING };
  try {
    const owner = await adminHouseholdOwner(id.data, { adminUserId: session.user.id });
    return owner ? { ...owner, message: null } : { ...empty, message: "Família sem responsável." };
  } catch (error) {
    logAdminFailure("admin_owner_contact_failed", error);
    return { ...empty, message: "Não foi possível consultar agora. Tente de novo." };
  }
}

const OWN_FAMILY = "Você participa desta família. Use outra conta de administrador para isso.";

const setSuspended = async (
  adminUserId: string,
  form: FormData,
  suspended: boolean,
): Promise<AdminResult> => {
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return failed("Família inválida.");
  return runAdminAction("admin_family_suspension_failed", async () => {
    const result = await adminSetHouseholdSuspended({ adminUserId }, id.data, suspended);
    if (result === "not_found") return failed("Família não encontrada.");
    if (result === "own_family") return failed(OWN_FAMILY);
    revalidatePath("/admin", "layout");
    return done(
      suspended
        ? "Família suspensa. Os membros perderam o acesso agora."
        : "Família reativada. Os membros já podem entrar.",
    );
  });
};

export async function suspendFamily(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  return setSuspended(session.user.id, form, true);
}

export async function reactivateFamily(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  return setSuspended(session.user.id, form, false);
}

const CANCEL_FAILED =
  "Não foi possível cancelar a assinatura na Stripe. Nada foi apagado. Tente de novo.";

/** O nome digitado é conferido de novo aqui, contra o banco, na mesma transação da exclusão. */
export async function deleteFamily(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return failed("Família inválida.");
  const typed = String(form.get("confirm") ?? "");
  const outcome = await runAdminAction("admin_family_delete_failed", async () => {
    const admin = { adminUserId: session.user.id };
    const refusal = (result: Awaited<ReturnType<typeof adminDeleteHousehold>>) => {
      if (result === "not_found") return failed("Família não encontrada.");
      if (result === "name_mismatch") return failed("O nome digitado não confere.");
      if (result === "own_family") return failed(OWN_FAMILY);
      return null;
    };
    // Confere antes: cancelar a assinatura e depois recusar deixaria a família sem plano à toa.
    const checked = refusal(await adminCheckDeleteHousehold(admin, id.data, typed));
    if (checked) return checked;
    try {
      await cancelBeforeDelete([id.data]);
    } catch {
      return failed(CANCEL_FAILED);
    }
    const deleted = refusal(await adminDeleteHousehold(admin, id.data, typed));
    if (deleted) return deleted;
    revalidatePath("/admin", "layout");
    return done("Família excluída.");
  });
  // Fora do try de runAdminAction: o redirect do Next é lançado como exceção.
  if (outcome.ok) redirect("/admin/familias");
  return outcome;
}
