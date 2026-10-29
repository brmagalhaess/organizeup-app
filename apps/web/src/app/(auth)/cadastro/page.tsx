import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignUpPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Crie sua conta</h1>
        <p className="text-sm text-muted">
          Em seguida você cria o espaço da sua família. Cada família tem seus dados isolados.
        </p>
      </div>
      <SignUpForm />
      <p className="text-sm text-muted">
        Já tem conta?{" "}
        <Link href="/entrar" className="font-semibold text-brand-700 underline">
          Entrar
        </Link>
      </p>
    </>
  );
}
