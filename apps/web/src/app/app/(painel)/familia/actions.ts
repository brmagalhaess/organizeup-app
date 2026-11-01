"use server";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { withHousehold } from "@organizeup/db";
import type { ActionState } from "@/app/app/actions";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
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
