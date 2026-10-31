"use server";
import { adminRemoveNotice, adminSetFlag, FLAG_KEYS } from "@organizeup/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { runAdminAction } from "../painel";
import { done, failed, type AdminResult } from "../painel-result";

const refresh = () => {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
};

export async function setMaintenance(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const on = form.get("enabled") === "true";
  const message = z
    .string()
    .trim()
    .max(200)
    .safeParse(form.get("message") ?? "");
  if (!message.success) return failed("A mensagem pode ter até 200 caracteres.");
  return runAdminAction("admin_maintenance_failed", async () => {
    await adminSetFlag(
      { adminUserId: session.user.id },
      {
        key: FLAG_KEYS.maintenance,
        enabled: on,
        value: on && message.data ? { message: message.data } : {},
        action: on ? "controle:manutencao_ligar" : "controle:manutencao_desligar",
      },
    );
    refresh();
    return done(on ? "Modo manutenção ligado." : "Modo manutenção desligado.");
  });
}

export async function setSignup(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const open = form.get("enabled") === "true";
  return runAdminAction("admin_signup_failed", async () => {
    await adminSetFlag(
      { adminUserId: session.user.id },
      {
        key: FLAG_KEYS.signupClosed,
        enabled: !open,
        action: open ? "controle:cadastro_abrir" : "controle:cadastro_fechar",
      },
    );
    refresh();
    return done(open ? "Cadastro aberto." : "Cadastro fechado.");
  });
}

/** Sem fuso no campo: o horário digitado é o de Brasília. */
const brasilia = (value: string) => new Date(`${value}:00-03:00`);

const noticeSchema = z
  .object({
    text: z.string().trim().min(3, "Escreva o aviso.").max(300, "Use até 300 caracteres."),
    startsAt: z.string().regex(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/, "Início inválido."),
    endsAt: z.string().regex(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/, "Fim inválido."),
  })
  .refine(({ startsAt, endsAt }) => !startsAt || !endsAt || brasilia(startsAt) < brasilia(endsAt), {
    message: "O fim precisa vir depois do início.",
  });

export async function createNotice(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const parsed = noticeSchema.safeParse({
    text: form.get("text") ?? "",
    startsAt: form.get("startsAt") ?? "",
    endsAt: form.get("endsAt") ?? "",
  });
  if (!parsed.success) return failed(parsed.error.issues[0]?.message ?? "Aviso inválido.");
  const { text, startsAt, endsAt } = parsed.data;
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  return runAdminAction("admin_notice_failed", async () => {
    await adminSetFlag(
      { adminUserId: session.user.id },
      {
        key: FLAG_KEYS.notice(id),
        enabled: true,
        value: {
          text,
          startsAt: startsAt ? brasilia(startsAt).toISOString() : new Date().toISOString(),
          endsAt: endsAt ? brasilia(endsAt).toISOString() : null,
        },
        action: "controle:aviso_criar",
      },
    );
    refresh();
    return done("Aviso publicado.");
  });
}

export async function removeNotice(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const id = z
    .string()
    .regex(/^[0-9a-f]{12}$/)
    .safeParse(form.get("id"));
  if (!id.success) return failed("Aviso inválido.");
  return runAdminAction("admin_notice_remove_failed", async () => {
    await adminRemoveNotice({ adminUserId: session.user.id }, id.data);
    refresh();
    return done("Aviso removido.");
  });
}
