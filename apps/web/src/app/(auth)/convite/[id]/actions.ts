"use server";
import { fromSession, inviteAccountType, people, sql, withHousehold } from "@organizeup/db";
import { accountFeatures, parseInviteeIdentity } from "@organizeup/domain";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { identityView, storeOwnDocument } from "@/lib/identity";
import { identityFromForm } from "@/lib/identity-form";
import { inviteId } from "@/lib/invites";
import { platformFlags, requireSession } from "@/lib/session";

/**
 * O CPF é de quem aceita, digitado por ela. Quem entra por convite é pessoa, seja o que vier no formulário.
 * Devolve false se não deu para guardar.
 */
async function saveOwnDocument(userId: string, form: FormData): Promise<boolean> {
  const view = await identityView(userId);
  if (!view.canFill || view.abroad) return true;
  const parsed = parseInviteeIdentity(identityFromForm(form));
  return parsed.ok && (await storeOwnDocument(userId, parsed.value)) === "ok";
}

/** Sócio que pode alterar os dados vira pessoa da empresa. Falhar aqui não desfaz o aceite. */
async function addPartner(
  session: Awaited<ReturnType<typeof requireSession>>,
  householdId: string,
) {
  try {
    const ctx = await fromSession({
      user: session.user,
      session: { activeOrganizationId: householdId },
    });
    if (ctx?.role !== "adult") return;
    await withHousehold(ctx, (tx) =>
      tx.execute(sql`
        insert into ${people} (id, household_id, name, relation, user_id)
        select ${crypto.randomUUID()}, ${householdId}, ${session.user.name}, 'outro', ${session.user.id}
        where not exists (select 1 from ${people} where user_id = ${session.user.id})`),
    );
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    console.error(JSON.stringify({ level: "error", msg: "partner_person_failed", code }));
  }
}

export async function acceptInvite(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = inviteId(formData.get("id"));
  if (!id) redirect("/app/escolher");
  if ((await platformFlags()).maintenance) redirect(`/convite/${id}?erro=manutencao`);
  const requestHeaders = await headers();
  // Destinatário, status e validade vêm antes do documento: convite alheio ou vencido não grava nada.
  const invitation = await getAuth()
    .api.getInvitation({ headers: requestHeaders, query: { id } })
    .catch(() => null);
  if (!invitation) redirect(`/convite/${id}?erro=1`);
  const features = accountFeatures(await inviteAccountType(id));
  if (features.inviteAsksCpf && !(await saveOwnDocument(session.user.id, formData))) {
    redirect(`/convite/${id}?erro=documento`);
  }
  let householdId: string;
  try {
    const accepted = await getAuth().api.acceptInvitation({
      headers: requestHeaders,
      body: { invitationId: id },
    });
    householdId = accepted.member.organizationId;
  } catch {
    redirect(`/convite/${id}?erro=1`);
  }
  if (features.ownership) await addPartner(session, householdId);
  redirect("/app");
}
