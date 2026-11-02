"use server";
import {
  adminDeleteUser,
  adminEndUserSessions,
  adminPasswordResetTarget,
  adminRevealIdentity,
  adminRevealUser,
  adminSetUserBlocked,
} from "@organizeup/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { openedIdentity } from "@/lib/identity";
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
import { loadUsers, type UsersState } from "./data";

const browseSchema = z.object({
  q: z.string().trim().max(200),
  page: z.coerce.number().int().min(0).max(100_000),
  status: z.enum(["todos", "bloqueados", "nao_verificados", "sem_familia"]),
});

/** POST de propósito: o e-mail buscado não pode ir para a URL. */
export async function browseUsers(previous: UsersState, form: FormData): Promise<UsersState> {
  const session = await requireAdmin();
  const parsed = browseSchema.safeParse({
    q: form.get("q") ?? "",
    page: form.get("page") ?? "0",
    status: form.get("status") ?? "todos",
  });
  if (!parsed.success) return { ...previous, message: "Busca inválida." };
  const { q, page, status } = parsed.data;
  await noteAdminAccess(session.user.id, q ? "usuarios:busca" : "usuarios:lista");
  if (!hasAdminDatabase()) return { ...previous, message: ADMIN_DB_MISSING };
  try {
    return await loadUsers(q, page, status);
  } catch (error) {
    logAdminFailure("admin_users_failed", error);
    return { ...previous, message: "Não foi possível buscar agora. Tente de novo." };
  }
}

export interface UserContactState {
  name: string | null;
  email: string | null;
  message: string | null;
}

export async function revealUser(
  _previous: UserContactState,
  form: FormData,
): Promise<UserContactState> {
  const session = await requireAdmin();
  const empty = { name: null, email: null };
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return { ...empty, message: "Conta inválida." };
  if (!hasAdminDatabase()) return { ...empty, message: ADMIN_DB_MISSING };
  try {
    const result = await adminRevealUser({ adminUserId: session.user.id }, id.data);
    if (result === "not_found") return { ...empty, message: "Conta não encontrada." };
    if (result === "not_allowed") {
      return { ...empty, message: "Disponível só para responsável de família." };
    }
    return { ...result, message: null };
  } catch (error) {
    logAdminFailure("admin_user_reveal_failed", error);
    return { ...empty, message: "Não foi possível consultar agora. Tente de novo." };
  }
}

export interface UserDocumentState {
  cpf: string | null;
  cnpj: string | null;
  companyName: string | null;
  message: string | null;
}

/** Documento completo: só por ação, registrada na mesma transação em que o cifrado é lido. */
export async function revealUserDocument(
  _previous: UserDocumentState,
  form: FormData,
): Promise<UserDocumentState> {
  const session = await requireAdmin();
  const empty = { cpf: null, cnpj: null, companyName: null };
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return { ...empty, message: "Conta inválida." };
  if (!hasAdminDatabase()) return { ...empty, message: ADMIN_DB_MISSING };
  try {
    const result = await adminRevealIdentity({ adminUserId: session.user.id }, id.data);
    if (result === "not_found") return { ...empty, message: "Conta sem documento." };
    if (result === "not_allowed") {
      return { ...empty, message: "Disponível só para responsável de família." };
    }
    const shown = openedIdentity(id.data, result);
    if (!shown) return { ...empty, message: "Falta a chave dos documentos neste serviço." };
    return { ...shown, message: null };
  } catch (error) {
    logAdminFailure("admin_user_document_failed", error);
    return { ...empty, message: "Não foi possível consultar agora. Tente de novo." };
  }
}

const SELF = "Essa ação não vale para a sua própria conta.";

export async function endUserSessions(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return failed("Conta inválida.");
  return runAdminAction("admin_user_sessions_failed", async () => {
    const result = await adminEndUserSessions({ adminUserId: session.user.id }, id.data);
    if (result === "not_found") return failed("Conta não encontrada.");
    if (result === "self") return failed(SELF);
    revalidatePath("/admin", "layout");
    return done("Sessões encerradas. A pessoa precisa entrar de novo.");
  });
}

const setBlocked = async (
  adminUserId: string,
  form: FormData,
  blocked: boolean,
): Promise<AdminResult> => {
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return failed("Conta inválida.");
  return runAdminAction("admin_user_block_failed", async () => {
    const result = await adminSetUserBlocked({ adminUserId }, id.data, blocked);
    if (result === "not_found") return failed("Conta não encontrada.");
    if (result === "self") return failed(SELF);
    revalidatePath("/admin", "layout");
    return done(blocked ? "Conta bloqueada e sessões encerradas." : "Conta desbloqueada.");
  });
};

export async function blockUser(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  return setBlocked(session.user.id, form, true);
}

export async function unblockUser(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  return setBlocked(session.user.id, form, false);
}

/** Tela de nova senha, a mesma do "esqueci minha senha". */
const RESET_PATH = "/redefinir-senha";

/**
 * Usa a mesma API do Better Auth do "esqueci minha senha". Sem envio de e-mail configurado ainda, o
 * pedido fica registrado e a tela diz isso; nada quebra.
 */
export async function sendPasswordReset(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return failed("Conta inválida.");
  return runAdminAction("admin_password_reset_failed", async () => {
    const email = await adminPasswordResetTarget({ adminUserId: session.user.id }, id.data);
    if (!email) return failed("Conta não encontrada.");
    try {
      await getAuth().api.requestPasswordReset({ body: { email, redirectTo: RESET_PATH } });
    } catch (error) {
      if ((error as { body?: { code?: string } }).body?.code === "RESET_PASSWORD_DISABLED") {
        return failed("Pedido registrado, mas o envio de e-mail ainda não está configurado.");
      }
      throw error;
    }
    return done("Pedido enviado. A pessoa recebe o link por e-mail.");
  });
}

export async function deleteUser(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return failed("Conta inválida.");
  if (String(form.get("confirm") ?? "").trim() !== "EXCLUIR") {
    return failed("Digite EXCLUIR para confirmar.");
  }
  const outcome = await runAdminAction("admin_user_delete_failed", async () => {
    const result = await adminDeleteUser({ adminUserId: session.user.id }, id.data);
    if (result === "not_found") return failed("Conta não encontrada.");
    if (result === "self") return failed(SELF);
    if (result === "family_has_members") {
      return failed("Esta conta é responsável por uma família com mais pessoas.");
    }
    revalidatePath("/admin", "layout");
    return done("Conta excluída.");
  });
  if (outcome.ok) redirect("/admin/usuarios");
  return outcome;
}
