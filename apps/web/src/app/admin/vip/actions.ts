"use server";
// VIP no painel (ADR-0025). Toda concessão e remoção vai para a auditoria, na mesma transação. VIP sem custo não
// passa pela Stripe. Desconto na Stripe é ação à parte, em Assinaturas: remover aqui nunca aumenta o preço de ninguém.
import { adminExtendVip, adminGrantVip, adminRevokeVip } from "@organizeup/db";
import {
  BILLING_MODULES,
  CURRENCIES,
  MAX_VIP_DISCOUNT,
  MIN_VIP_DISCOUNT,
  VIP_COSTS,
  VIP_REASONS,
  VIP_SCOPES,
} from "@organizeup/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { runAdminAction, targetId } from "../painel";
import { done, failed, type AdminResult } from "../painel-result";
import { endOfDay } from "../planos";

const limit = z
  .string()
  .trim()
  .regex(/^\d{0,6}$/, "Use só números nos limites.")
  .transform((value) => (value === "" ? null : Number(value)));

const day = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Data inválida.");

const grantSchema = z
  .object({
    householdId: targetId,
    scope: z.enum(VIP_SCOPES),
    userId: z.string().max(64),
    access: z.enum(["tudo", "escolhido"]),
    modules: z.array(z.enum(BILLING_MODULES)),
    entryLimit: limit,
    messageLimit: limit,
    currencies: z.array(z.enum(CURRENCIES)),
    cost: z.enum(VIP_COSTS),
    discountPercent: limit,
    reason: z.enum(VIP_REASONS),
    endsOn: day,
  })
  .refine(
    ({ cost, discountPercent }) =>
      cost !== "desconto" ||
      (discountPercent !== null &&
        discountPercent >= MIN_VIP_DISCOUNT &&
        discountPercent <= MAX_VIP_DISCOUNT),
    { message: `O desconto vai de ${MIN_VIP_DISCOUNT}% a ${MAX_VIP_DISCOUNT}%.` },
  );

const REFUSALS = {
  not_found: "Família não encontrada.",
  own_family: "Você participa desta família. Use outra conta de administrador para isso.",
  ja_vip: "Esta família já tem VIP aberto. Remova ou mude a validade na lista.",
  nao_responsavel: "VIP de pessoa só vale na família de que ela é responsável.",
  assinatura_viva:
    "A Stripe segue cobrando esta família. Cancele a assinatura antes, ou conceda com desconto.",
} as const;

export interface VipFormState {
  message: string | null;
}

export async function grantVip(_previous: VipFormState, form: FormData): Promise<VipFormState> {
  const session = await requireAdmin();
  const parsed = grantSchema.safeParse({
    householdId: form.get("householdId") ?? "",
    scope: form.get("scope") ?? "",
    userId: form.get("userId") ?? "",
    access: form.get("access") ?? "",
    modules: form.getAll("modules"),
    entryLimit: form.get("entryLimit") ?? "",
    messageLimit: form.get("messageLimit") ?? "",
    currencies: form.getAll("currencies"),
    cost: form.get("cost") ?? "",
    discountPercent: form.get("discountPercent") ?? "",
    reason: form.get("reason") ?? "",
    endsOn: form.get("endsOn") ?? "",
  });
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Confira os campos." };
  const data = parsed.data;
  const endsAt = data.endsOn ? endOfDay(data.endsOn) : null;
  if (endsAt && endsAt <= new Date()) return { message: "A validade precisa ser no futuro." };
  const outcome = await runAdminAction("admin_vip_grant_failed", async () => {
    const result = await adminGrantVip(
      { adminUserId: session.user.id },
      {
        householdId: data.householdId,
        scope: data.scope,
        userId: data.scope === "pessoa" ? data.userId : null,
        full: data.access === "tudo",
        modules: data.modules,
        entryLimit: data.entryLimit,
        // Sem o assistente marcado, nenhuma mensagem: a tela não pode dar o limite sem o módulo.
        messageLimit: data.modules.includes("assistente") ? data.messageLimit : 0,
        currencies: data.currencies,
        cost: data.cost,
        discountPercent: data.cost === "desconto" ? data.discountPercent : null,
        reason: data.reason,
        endsAt,
      },
    );
    if (result !== "ok") return failed(REFUSALS[result]);
    revalidatePath("/admin", "layout");
    return done("VIP concedido.");
  });
  // Fora do try de runAdminAction: o redirect do Next é lançado como exceção.
  if (outcome.ok) redirect("/admin/vip");
  return { message: outcome.message };
}

export async function revokeVip(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const id = targetId.safeParse(form.get("id"));
  if (!id.success) return failed("VIP não encontrado.");
  return runAdminAction("admin_vip_revoke_failed", async () => {
    const result = await adminRevokeVip({ adminUserId: session.user.id }, id.data);
    if (result === "not_found") return failed("Este VIP já foi removido.");
    revalidatePath("/admin", "layout");
    return done("VIP removido. A família volta ao que tinha antes.");
  });
}

export async function changeVipValidity(form: FormData): Promise<AdminResult> {
  const session = await requireAdmin();
  const id = targetId.safeParse(form.get("id"));
  const ends = day.safeParse(form.get("endsOn") ?? "");
  if (!id.success) return failed("VIP não encontrado.");
  if (!ends.success) return failed("Data inválida.");
  const endsAt = ends.data ? endOfDay(ends.data) : null;
  if (endsAt && endsAt <= new Date()) return failed("A validade precisa ser no futuro.");
  return runAdminAction("admin_vip_validity_failed", async () => {
    const result = await adminExtendVip({ adminUserId: session.user.id }, id.data, endsAt);
    if (result === "not_found") return failed("Este VIP já foi removido.");
    if (result === "own_family") return failed(REFUSALS.own_family);
    revalidatePath("/admin", "layout");
    return done("Validade alterada.");
  });
}
