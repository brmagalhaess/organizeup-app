import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import { APIError } from "better-auth/api";
import { inviteAccountType } from "@organizeup/db";
import { accountFeatures } from "@organizeup/domain";
import { IdentityFields } from "@/components/identity-fields";
import { Button, FormMessage } from "@/components/ui";
import { buttonClass } from "@/components/styles";
import { textsForAccount } from "@/i18n/account-server";
import { getAuth } from "@/lib/auth";
import { identityView } from "@/lib/identity";
import { inviteId } from "@/lib/invites";
import { getSession } from "@/lib/session";
import { acceptInvite } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.invite");
  return { title: t("metaTitle"), robots: { index: false } };
}

function Blocked({ title, text }: { title: string; text: string }) {
  const t = useTranslations("auth.invite");
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted">{text}</p>
      </div>
      <Link href="/app/escolher" className={buttonClass("secondary")}>
        {t("goToApp")}
      </Link>
    </>
  );
}

function SignInLinks({ id }: { id: string }) {
  const t = useTranslations("auth.invite");
  return (
    <div className="flex flex-col gap-2">
      <Link href={`/cadastro?convite=${id}`} className={buttonClass("primary")}>
        {t("createAccount")}
      </Link>
      <Link href={`/entrar?convite=${id}`} className={buttonClass("secondary")}>
        {t("hasAccount")}
      </Link>
    </div>
  );
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const id = inviteId((await params).id);
  const { erro } = await searchParams;
  const accountType = id ? await inviteAccountType(id) : "pf";
  const t = await textsForAccount(accountType, "auth.invite");
  const unavailable = { title: t("unavailableTitle"), text: t("unavailableText") };
  if (!id) return <Blocked {...unavailable} />;

  const session = await getSession();
  if (!session) {
    return (
      <>
        <div>
          <h1 className="text-2xl font-bold">{t("receivedTitle")}</h1>
          <p className="text-sm text-muted">{t("receivedText")}</p>
        </div>
        <SignInLinks id={id} />
      </>
    );
  }

  const invitation = await getAuth()
    .api.getInvitation({ headers: await headers(), query: { id } })
    .catch((error: unknown) => {
      if (error instanceof APIError && error.statusCode === 403) return "other-email" as const;
      return null;
    });
  if (invitation === null) return <Blocked {...unavailable} />;
  if (invitation === "other-email") {
    return (
      <>
        <div>
          <h1 className="text-2xl font-bold">{t("otherEmailTitle")}</h1>
          <p className="text-sm text-muted">{t("otherEmailText", { email: session.user.email })}</p>
        </div>
        <SignInLinks id={id} />
      </>
    );
  }

  const role =
    invitation.role === "adult"
      ? t("roleAdult")
      : invitation.role === "viewer"
        ? t("roleViewer")
        : t("roleOther");
  const [tIdentity, tErrors] = await Promise.all([
    getTranslations("identity"),
    getTranslations("auth.errors"),
  ]);
  const identity = await identityView(session.user.id);
  const asksDocument =
    accountFeatures(accountType).inviteAsksCpf && identity.canFill && !identity.abroad;

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">
          {t("joinTitle", { family: invitation.organizationName })}
        </h1>
        <p className="text-sm text-muted">{t("joinText", { role })}</p>
      </div>
      <FormMessage
        message={
          erro === "manutencao"
            ? tErrors("maintenance")
            : erro === "documento"
              ? tIdentity("invite.failed")
              : erro
                ? t("acceptFailed")
                : null
        }
      />
      <form action={acceptInvite} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={id} />
        {asksDocument ? (
          <>
            <div>
              <h2 className="text-base font-semibold">{tIdentity("invite.title")}</h2>
              <p className="text-sm text-muted">{tIdentity("invite.text")}</p>
            </div>
            <IdentityFields personOnly />
          </>
        ) : null}
        <Button type="submit" className="w-full">
          {t("accept")}
        </Button>
      </form>
    </>
  );
}
