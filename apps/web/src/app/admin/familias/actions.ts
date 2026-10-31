"use server";
import { adminHouseholdOwnerEmail } from "@organizeup/db";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { ADMIN_DB_MISSING, hasAdminDatabase, logAdminFailure, noteAdminAccess } from "../painel";
import { loadFamilies, type FamiliesState } from "./data";

const browseSchema = z.object({
  q: z.string().trim().max(200),
  page: z.coerce.number().int().min(0).max(100_000),
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
  const parsed = browseSchema.safeParse({ q: form.get("q") ?? "", page: form.get("page") ?? "0" });
  if (!parsed.success) return { ...previous, message: "Busca inválida." };
  const { q, page } = parsed.data;
  await noteAdminAccess(session.user.id, q ? "familias:busca" : "familias:lista");
  if (!hasAdminDatabase()) return { ...previous, message: ADMIN_DB_MISSING };
  try {
    return await loadFamilies(q, page);
  } catch (error) {
    logAdminFailure("admin_families_failed", error);
    return { ...previous, message: "Não foi possível buscar agora. Tente de novo." };
  }
}

export interface OwnerEmailState {
  email: string | null;
  message: string | null;
}

/** Ação explícita, linha a linha: adminHouseholdOwnerEmail registra quem pediu e qual família. */
export async function revealOwnerEmail(
  _previous: OwnerEmailState,
  form: FormData,
): Promise<OwnerEmailState> {
  const session = await requireAdmin();
  const id = z.string().min(1).max(64).safeParse(form.get("id"));
  if (!id.success) return { email: null, message: "Família inválida." };
  if (!hasAdminDatabase()) return { email: null, message: ADMIN_DB_MISSING };
  try {
    const email = await adminHouseholdOwnerEmail(id.data, { adminUserId: session.user.id });
    return email ? { email, message: null } : { email: null, message: "Família sem responsável." };
  } catch (error) {
    logAdminFailure("admin_owner_email_failed", error);
    return { email: null, message: "Não foi possível consultar agora. Tente de novo." };
  }
}
