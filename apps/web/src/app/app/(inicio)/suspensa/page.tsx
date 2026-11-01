import { fromSession, listMemberships, suspendedHouseholdIds } from "@organizeup/db";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("familiaOnboarding.suspended");
  return { title: t("metaTitle") };
}

export default async function SuspendedHouseholdPage() {
  const session = await requireSession();
  const ctx = await fromSession(session);
  if (!ctx) redirect("/app/escolher");
  const memberships = await listMemberships(session.user.id);
  const suspended = await suspendedHouseholdIds(memberships.map((m) => m.householdId));
  if (!suspended.has(ctx.householdId)) redirect("/app");
  const others = memberships.filter((m) => !suspended.has(m.householdId));
  const t = await getTranslations("familiaOnboarding.suspended");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-sm text-muted">{t("text")}</p>
      {others.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {others.map((m) => (
            <li key={m.householdId}>
              <Link
                href={`/app/escolher/abrir?id=${encodeURIComponent(m.householdId)}`}
                prefetch={false}
                className="flex min-h-11 items-center rounded-lg border border-line bg-card px-4 text-sm font-semibold hover:bg-brand-50"
              >
                {t("open", { name: m.name })}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <SignOutButton />
    </div>
  );
}
