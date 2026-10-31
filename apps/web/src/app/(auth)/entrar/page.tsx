import type { Metadata } from "next";
import Link from "next/link";
import { inviteId } from "@/lib/invites";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ convite?: string }>;
}) {
  const invite = inviteId((await searchParams).convite);
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Bem-vindo de volta</h1>
        <p className="text-sm text-muted">Entre para acessar o plano da sua família.</p>
      </div>
      <SignInForm invite={invite} />
      <p className="text-sm">
        <Link href="/esqueci-senha" className="font-semibold text-brand-700 underline">
          Esqueci minha senha
        </Link>
      </p>
      <p className="text-sm text-muted">
        Ainda não tem conta?{" "}
        <Link
          href={invite ? `/cadastro?convite=${invite}` : "/cadastro"}
          className="font-semibold text-brand-700 underline"
        >
          Criar conta
        </Link>
      </p>
    </>
  );
}
