import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { inviteId } from "@/lib/invites";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signIn");
  return { title: t("metaTitle") };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string }>;
}) {
  const invite = inviteId((await searchParams).convite);
  const t = await getTranslations("auth.signIn");
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted">{t("subtitle")}</p>
      </div>
      <SignInForm invite={invite} />
      <p className="text-sm">
        <Link href="/esqueci-senha" className="font-semibold text-brand-700 underline">
          {t("forgot")}
        </Link>
      </p>
      <p className="text-sm text-muted">
        {t("noAccount")}{" "}
        <Link
          href={invite ? `/cadastro?convite=${invite}` : "/cadastro"}
          className="font-semibold text-brand-700 underline"
        >
          {t("createAccount")}
        </Link>
      </p>
    </>
  );
}
