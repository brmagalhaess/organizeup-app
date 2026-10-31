import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Esqueci minha senha" };

export default function ForgotPasswordPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Esqueceu sua senha?</h1>
        <p className="text-sm text-muted">
          Informe seu e-mail e enviaremos um link para criar uma nova senha.
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="text-sm text-muted">
        Lembrou?{" "}
        <Link href="/entrar" className="font-semibold text-brand-700 underline">
          Voltar para entrar
        </Link>
      </p>
    </>
  );
}
