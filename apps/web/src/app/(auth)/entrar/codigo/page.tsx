import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { inviteId } from "@/lib/invites";
import { TwoFactorForm } from "./two-factor-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.twoFactor");
  return { title: t("metaTitle") };
}

/** Segunda etapa do login (ADR-0034): a senha passou e a conta tem o segundo fator ativo. */
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string }>;
}) {
  const invite = inviteId((await searchParams).convite);
  const t = await getTranslations("auth.twoFactor");
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted">{t("subtitle")}</p>
      </div>
      <TwoFactorForm invite={invite} />
      <p className="text-sm">
        <Link
          href={invite ? `/entrar?convite=${invite}` : "/entrar"}
          className="font-semibold text-brand-700 underline"
        >
          {t("backToSignIn")}
        </Link>
      </p>
    </>
  );
}
