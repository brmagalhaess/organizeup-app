import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ConfirmEmailButton } from "@/components/confirm-email-button";
import { buttonClass } from "@/components/styles";
import { VERIFY_LINK_HOURS } from "@/lib/email-templates";
import { getSession } from "@/lib/session";
import { viewFor } from "./view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.confirmEmail");
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; estado?: string }>;
}) {
  const { error, estado } = await searchParams;
  const session = await getSession();
  const verified = session ? session.user.emailVerified : null;
  const view = viewFor(error, estado, verified);
  const t = await getTranslations("auth.confirmEmail");
  const askAgain = view === "expired" || view === "invalid";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{t(`${view}Title`)}</h1>
        <p className="mt-2 text-sm text-muted">
          {view === "expired" ? t("expiredText", { hours: VERIFY_LINK_HOURS }) : t(`${view}Text`)}
        </p>
        {askAgain && !session ? <p className="mt-2 text-sm text-muted">{t("signInHint")}</p> : null}
      </div>
      {askAgain && session ? <ConfirmEmailButton /> : null}
      {view === "maintenance" ? null : (
        <Link
          href={session ? "/app" : "/entrar"}
          className={`${buttonClass("primary")} self-start`}
        >
          {session ? t("goToPanel") : t("signIn")}
        </Link>
      )}
    </div>
  );
}
