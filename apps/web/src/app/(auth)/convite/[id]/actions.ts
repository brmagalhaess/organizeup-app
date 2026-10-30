"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { inviteId } from "@/lib/invites";
import { requireSession } from "@/lib/session";

export async function acceptInvite(formData: FormData): Promise<void> {
  await requireSession();
  const id = inviteId(formData.get("id"));
  if (!id) redirect("/app/escolher");
  try {
    await getAuth().api.acceptInvitation({
      headers: await headers(),
      body: { invitationId: id },
    });
  } catch {
    redirect(`/convite/${id}?erro=1`);
  }
  redirect("/app");
}
