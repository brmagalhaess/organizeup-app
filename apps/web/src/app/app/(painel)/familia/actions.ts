"use server";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { and, eq, householdMember, user, withHousehold } from "@organizeup/db";
import type { ActionState } from "@/app/app/actions";
import type { Locale } from "@/i18n/locales";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { sendConfirmation } from "@/lib/email-confirmation";
import { VERIFY_LINK_HOURS } from "@/lib/email-templates";
import { saveMemberReminders } from "@/lib/reminders";
import { requireTenant } from "@/lib/session";

type ErrorTexts = Awaited<ReturnType<typeof getTranslations<"pessoas.errors">>>;

const inviteSchema = (t: ErrorTexts) =>
  z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email(t("email"))),
    role: z.enum(["adult", "viewer"], { message: t("role") }),
  });

function inviteError(error: unknown, t: ErrorTexts) {
  const code = error instanceof APIError ? error.body?.code : null;
  return code === "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION"
    ? t("alreadyMember")
    : t("inviteFailed");
}

export async function inviteMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireTenant();
  const t = await getTranslations("pessoas.errors");
  if (ctx.role !== "owner") return { ok: false, message: t("ownerOnly") };
  const parsed = inviteSchema(t).safeParse({
    email: formData.get("email") ?? "",
    role: formData.get("role") ?? "",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: null, fieldErrors };
  }
  try {
    const invitation = await getAuth().api.createInvitation({
      headers: await headers(),
      body: { ...parsed.data, organizationId: ctx.householdId },
    });
    await withHousehold(ctx, (tx) =>
      audit(tx, ctx, "invite", "household_invitation", invitation.id),
    );
  } catch (error) {
    return { ok: false, message: inviteError(error, t) };
  }
  revalidatePath("/app/familia");
  return { ok: true, message: null };
}

export async function cancelInvite(formData: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (ctx.role !== "owner") return;
  const invitationId = String(formData.get("id") ?? "");
  await getAuth().api.cancelInvitation({ headers: await headers(), body: { invitationId } });
  await withHousehold(ctx, (tx) => audit(tx, ctx, "cancel", "household_invitation", invitationId));
  revalidatePath("/app/familia");
}

export async function removeMember(formData: FormData): Promise<void> {
  const { ctx } = await requireTenant();
  if (ctx.role !== "owner") return;
  const memberId = String(formData.get("id") ?? "");
  await getAuth().api.removeMember({
    headers: await headers(),
    body: { memberIdOrEmail: memberId, organizationId: ctx.householdId },
  });
  await withHousehold(ctx, (tx) => audit(tx, ctx, "remove", "household_member", memberId));
  revalidatePath("/app/familia");
}

/** O responsável não sai por aqui: a família ficaria sem dono. */
export async function leaveFamily(): Promise<void> {
  const { ctx } = await requireTenant();
  if (ctx.role === "owner") return;
  await getAuth().api.leaveOrganization({
    headers: await headers(),
    body: { organizationId: ctx.householdId },
  });
  redirect("/app/escolher");
}

/** Outro login desta família, pelo id do vínculo. Nunca o próprio responsável: os avisos dele ficam em Notificações. */
async function otherMember(memberId: string) {
  const { ctx } = await requireTenant();
  if (ctx.role !== "owner" || !memberId) return null;
  const [row] = await withHousehold(ctx, (tx) =>
    tx
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
      })
      .from(householdMember)
      .innerJoin(user, eq(user.id, householdMember.userId))
      .where(
        and(eq(householdMember.organizationId, ctx.householdId), eq(householdMember.id, memberId)),
      ),
  );
  if (!row || row.id === ctx.userId) return null;
  return { ctx, account: row };
}

/** O responsável liga ou desliga os avisos por e-mail de quem acessa a família. */
export async function setMemberEmails(formData: FormData): Promise<ActionState> {
  const t = await getTranslations("pessoas.members.emails");
  const found = await otherMember(String(formData.get("id") ?? ""));
  if (!found) return { ok: false, message: t("failed") };
  const enabled = formData.get("enabled") === "1";
  if (!(await saveMemberReminders(found.ctx, found.account.id, enabled))) {
    return { ok: false, message: t("failed") };
  }
  await withHousehold(found.ctx, (tx) =>
    audit(tx, found.ctx, enabled ? "enable" : "disable", "email_reminders", found.account.id),
  );
  revalidatePath("/app/familia");
  return { ok: true, message: enabled ? t("on") : t("off") };
}

/** Manda a confirmação para o e-mail da conta do convidado. O endereço vem da conta, nunca da tela. */
export async function sendMemberConfirmation(formData: FormData): Promise<ActionState> {
  const t = await getTranslations("pessoas.members.emails");
  const found = await otherMember(String(formData.get("id") ?? ""));
  if (!found) return { ok: false, message: t("failed") };
  const outcome = await sendConfirmation(found.account, (await getLocale()) as Locale).catch(
    () => ({ status: "falhou" as const }),
  );
  if (outcome.status === "enviado") {
    await withHousehold(found.ctx, (tx) =>
      audit(tx, found.ctx, "send_confirmation", "user", found.account.id),
    );
    return { ok: true, message: t("sent", { hours: VERIFY_LINK_HOURS }) };
  }
  if (outcome.status === "confirmado") {
    revalidatePath("/app/familia");
    return { ok: true, message: t("alreadyConfirmed") };
  }
  if (outcome.status === "aguarde") {
    return { ok: false, message: t("wait", { minutes: Math.ceil(outcome.seconds / 60) }) };
  }
  if (outcome.status === "desligado") return { ok: false, message: t("emailOff") };
  return { ok: false, message: t("failed") };
}
