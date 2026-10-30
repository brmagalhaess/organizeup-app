import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { APIError } from "better-auth/api";
import { Button, FormMessage } from "@/components/ui";
import { buttonClass } from "@/components/styles";
import { getAuth } from "@/lib/auth";
import { inviteId, ROLE_HINT } from "@/lib/invites";
import { getSession } from "@/lib/session";
import { acceptInvite } from "./actions";

export const metadata: Metadata = { title: "Convite", robots: { index: false } };

function Blocked({ title, text }: { title: string; text: string }) {
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted">{text}</p>
      </div>
      <Link href="/app/escolher" className={buttonClass("secondary")}>
        Ir para o sistema
      </Link>
    </>
  );
}

function SignInLinks({ id }: { id: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Link href={`/cadastro?convite=${id}`} className={buttonClass("primary")}>
        Criar minha conta
      </Link>
      <Link href={`/entrar?convite=${id}`} className={buttonClass("secondary")}>
        Já tenho conta
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
  const unavailable = {
    title: "Convite indisponível",
    text: "Este convite expirou ou foi cancelado. Peça um novo link a quem convidou você.",
  };
  if (!id) return <Blocked {...unavailable} />;

  const session = await getSession();
  if (!session) {
    return (
      <>
        <div>
          <h1 className="text-2xl font-bold">Você recebeu um convite</h1>
          <p className="text-sm text-muted">
            Use o mesmo e-mail que recebeu o convite. Depois de entrar, mostramos qual é a família.
          </p>
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
          <h1 className="text-2xl font-bold">Este convite é para outro e-mail</h1>
          <p className="text-sm text-muted">
            Você entrou como {session.user.email}. Entre com o e-mail que recebeu o convite.
          </p>
        </div>
        <SignInLinks id={id} />
      </>
    );
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Entrar em {invitation.organizationName}</h1>
        <p className="text-sm text-muted">
          Você {ROLE_HINT[invitation.role] ?? "terá acesso a esta família"}. Os dados que você
          lançar ficam visíveis para quem acessa esta família.
        </p>
      </div>
      <FormMessage message={erro ? "Não foi possível aceitar. Tente novamente." : null} />
      <form action={acceptInvite}>
        <input type="hidden" name="id" value={id} />
        <Button type="submit" className="w-full">
          Aceitar convite
        </Button>
      </form>
    </>
  );
}
