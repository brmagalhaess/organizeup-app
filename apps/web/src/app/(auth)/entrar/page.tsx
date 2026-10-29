import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

export default function SignInPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Bem-vindo de volta</h1>
        <p className="text-sm text-muted">Entre para acessar o plano da sua família.</p>
      </div>
      <SignInForm />
      <p className="text-sm text-muted">
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="font-semibold text-brand-700 underline">
          Criar conta
        </Link>
      </p>
    </>
  );
}
