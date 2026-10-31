import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { fromSession, listMemberships, suspendedHouseholdIds } from "@organizeup/db";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Escolher família" };

const ROLE_LABEL: Record<string, string> = {
  owner: "Responsável",
  adult: "Adulto",
  child: "Criança",
  viewer: "Leitura",
};

export default async function ChooseHouseholdPage() {
  const session = await requireSession();
  if (await fromSession(session)) redirect("/app");
  const memberships = await listMemberships(session.user.id);
  if (memberships.length === 0) redirect("/app/novo-household");
  if (memberships.length === 1) {
    redirect(`/app/escolher/abrir?id=${encodeURIComponent(memberships[0]!.householdId)}`);
  }
  const suspended = await suspendedHouseholdIds(memberships.map((m) => m.householdId));
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">Qual família você quer abrir?</h1>
      <ul className="flex flex-col gap-2">
        {memberships.map((m) => (
          <li key={m.householdId}>
            <Link
              href={`/app/escolher/abrir?id=${encodeURIComponent(m.householdId)}`}
              prefetch={false}
              className="flex min-h-11 items-center justify-between rounded-lg border border-line bg-card px-4 text-sm font-semibold hover:bg-brand-50"
            >
              <span>{m.name}</span>
              <span className="text-xs text-muted">
                {suspended.has(m.householdId) ? "Suspensa" : (ROLE_LABEL[m.role] ?? m.role)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/app/novo-household" className="text-sm font-semibold text-brand-700 underline">
        Criar outra família
      </Link>
    </div>
  );
}
