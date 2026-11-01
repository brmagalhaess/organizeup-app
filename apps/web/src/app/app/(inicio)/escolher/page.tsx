import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { fromSession, listMemberships, suspendedHouseholdIds } from "@organizeup/db";
import { requireSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("familiaOnboarding.choose");
  return { title: t("metaTitle") };
}

const ROLES = ["owner", "adult", "child", "viewer"] as const;

export default async function ChooseHouseholdPage() {
  const session = await requireSession();
  if (await fromSession(session)) redirect("/app");
  const memberships = await listMemberships(session.user.id);
  if (memberships.length === 0) redirect("/app/novo-household");
  if (memberships.length === 1) {
    redirect(`/app/escolher/abrir?id=${encodeURIComponent(memberships[0]!.householdId)}`);
  }
  const suspended = await suspendedHouseholdIds(memberships.map((m) => m.householdId));
  const t = await getTranslations("familiaOnboarding.choose");
  const roleLabel = (role: string) => {
    const known = ROLES.find((item) => item === role);
    return known ? t(`roles.${known}`) : t("roles.other");
  };
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
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
                {suspended.has(m.householdId) ? t("suspended") : roleLabel(m.role)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/app/novo-household" className="text-sm font-semibold text-brand-700 underline">
        {t("createOther")}
      </Link>
    </div>
  );
}
