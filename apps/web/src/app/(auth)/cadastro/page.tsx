import type { Metadata } from "next";
import { inviteAccountType } from "@organizeup/db";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { textsForAccount } from "@/i18n/account-server";
import { inviteId } from "@/lib/invites";
import { platformFlags } from "@/lib/session";
import { SignUpForm } from "./sign-up-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signUp");
  return { title: t("metaTitle") };
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string }>;
}) {
  const invite = inviteId((await searchParams).convite);
  const { signupClosed } = await platformFlags();
  const t = await textsForAccount(invite ? await inviteAccountType(invite) : "pf", "auth.signUp");
  if (signupClosed && !invite) {
    return (
      <>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <EmptyState
          title={t("closedTitle")}
          text={t("closedText")}
          action={
            <Link href="/entrar" className="font-semibold text-brand-700 underline">
              {t("closedLink")}
            </Link>
          }
        />
      </>
    );
  }
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted">{invite ? t("subtitleInvite") : t("subtitle")}</p>
      </div>
      <SignUpForm invite={invite} />
      <p className="text-sm text-muted">
        {t("hasAccount")}{" "}
        <Link
          href={invite ? `/entrar?convite=${invite}` : "/entrar"}
          className="font-semibold text-brand-700 underline"
        >
          {t("signIn")}
        </Link>
      </p>
    </>
  );
}
