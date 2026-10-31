import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { inviteId } from "@/lib/invites";
import { platformFlags } from "@/lib/session";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Criar conta" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string }>;
}) {
  const invite = inviteId((await searchParams).convite);
  const { signupClosed } = await platformFlags();
  if (signupClosed && !invite) {
    return (
      <>
        <h1 className="text-2xl font-bold">Crie sua conta</h1>
        <EmptyState
          title="Os cadastros estão fechados no momento"
          text="Se você recebeu um convite de uma família, use o link do convite para entrar."
          action={
            <Link href="/entrar" className="font-semibold text-brand-700 underline">
              Já tenho conta
            </Link>
          }
        />
      </>
    );
  }
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Crie sua conta</h1>
        <p className="text-sm text-muted">
          {invite
            ? "Use o e-mail que recebeu o convite. Depois você entra na família."
            : "Em seguida você cria o espaço da sua família. Cada família tem seus dados isolados."}
        </p>
      </div>
      <SignUpForm invite={invite} />
      <p className="text-sm text-muted">
        Já tem conta?{" "}
        <Link
          href={invite ? `/entrar?convite=${invite}` : "/entrar"}
          className="font-semibold text-brand-700 underline"
        >
          Entrar
        </Link>
      </p>
    </>
  );
}
