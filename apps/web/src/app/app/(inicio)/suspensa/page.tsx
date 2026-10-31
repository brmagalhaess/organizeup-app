import { fromSession, listMemberships, suspendedHouseholdIds } from "@organizeup/db";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = { title: "Acesso suspenso" };

export default async function SuspendedHouseholdPage() {
  const session = await requireSession();
  const ctx = await fromSession(session);
  if (!ctx) redirect("/app/escolher");
  const memberships = await listMemberships(session.user.id);
  const suspended = await suspendedHouseholdIds(memberships.map((m) => m.householdId));
  if (!suspended.has(ctx.householdId)) redirect("/app");
  const others = memberships.filter((m) => !suspended.has(m.householdId));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">O acesso a esta família está suspenso</h1>
      <p className="text-sm text-muted">
        A administração do OrganizeUp suspendeu o acesso. Os dados da família continuam guardados.
        Para saber mais, fale com o suporte.
      </p>
      {others.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {others.map((m) => (
            <li key={m.householdId}>
              <Link
                href={`/app/escolher/abrir?id=${encodeURIComponent(m.householdId)}`}
                prefetch={false}
                className="flex min-h-11 items-center rounded-lg border border-line bg-card px-4 text-sm font-semibold hover:bg-brand-50"
              >
                Abrir {m.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <SignOutButton />
    </div>
  );
}
