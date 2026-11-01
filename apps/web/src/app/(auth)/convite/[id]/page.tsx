import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";
import { APIError } from "better-auth/api";
import { Button, FormMessage } from "@/components/ui";
import { buttonClass } from "@/components/styles";
import { getAuth } from "@/lib/auth";
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
  const t = await getTranslations("auth.invite");
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

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">
          {t("joinTitle", { family: invitation.organizationName })}
        </h1>
        <p className="text-sm text-muted">{t("joinText", { role })}</p>
      </div>
      <FormMessage message={erro ? t("acceptFailed") : null} />
      <form action={acceptInvite}>
        <input type="hidden" name="id" value={id} />
        <Button type="submit" className="w-full">
          {t("accept")}
        </Button>
      </form>
    </>
  );
}
