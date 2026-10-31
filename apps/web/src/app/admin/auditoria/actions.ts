"use server";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { ADMIN_DB_MISSING, hasAdminDatabase, logAdminFailure, noteAdminAccess } from "../painel";
import { loadAudit, type AuditState } from "./data";

const browseSchema = z.object({
  group: z.enum(["acoes", "dados", "visitas", "tudo"]),
  days: z.coerce.number().int().min(0).max(3650),
  target: z.string().trim().max(64),
  page: z.coerce.number().int().min(0).max(100_000),
});

export async function browseAudit(previous: AuditState, form: FormData): Promise<AuditState> {
  const session = await requireAdmin();
  const parsed = browseSchema.safeParse({
    group: form.get("group") ?? "acoes",
    days: form.get("days") ?? "30",
    target: form.get("target") ?? "",
    page: form.get("page") ?? "0",
  });
  if (!parsed.success) return { ...previous, message: "Filtro inválido." };
  const { page, ...filters } = parsed.data;
  await noteAdminAccess(session.user.id, "auditoria:busca");
  if (!hasAdminDatabase()) return { ...previous, message: ADMIN_DB_MISSING };
  try {
    return await loadAudit(filters, page, session.user.id);
  } catch (error) {
    logAdminFailure("admin_audit_failed", error);
    return { ...previous, message: "Não foi possível buscar agora. Tente de novo." };
  }
}
