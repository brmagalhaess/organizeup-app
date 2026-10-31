"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function SignUpForm({ invite }: { invite: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError("As senhas não conferem.");
      return;
    }
    setPending(true);
    // termsAccepted é conferido no hook de cadastro; o cliente tipado não o conhece.
    const input = {
      name: String(form.get("name") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      password,
      termsAccepted: form.get("terms") === "on",
    };
    const { error: signUpError } = await authClient.signUp.email(input);
    if (signUpError) {
      setPending(false);
      setError(
        signUpError.code?.startsWith("USER_ALREADY_EXISTS") || signUpError.status === 422
          ? "Já existe uma conta com este e-mail."
          : signUpError.code === "PASSWORD_TOO_SHORT"
            ? "A senha precisa ter pelo menos 10 caracteres."
            : signUpError.message === "SIGNUP_CLOSED"
              ? "Os cadastros estão fechados no momento."
              : signUpError.message === "MAINTENANCE"
                ? "O sistema está em manutenção. Tente de novo mais tarde."
                : "Não foi possível criar a conta. Tente novamente.",
      );
      return;
    }
    router.replace(invite ? `/convite/${invite}` : "/app/novo-household");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Seu nome">
        <Input name="name" autoComplete="name" required maxLength={120} />
      </Field>
      <Field label="E-mail">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Senha" hint="Mínimo de 10 caracteres.">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </Field>
      <Field label="Confirmar senha">
        <Input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input name="terms" type="checkbox" required className="mt-0.5 size-5 shrink-0" />
        <span>
          Li e aceito os{" "}
          <a href="/termos" target="_blank" className="font-semibold text-brand-700 underline">
            Termos de Uso
          </a>{" "}
          e a{" "}
          <a href="/privacidade" target="_blank" className="font-semibold text-brand-700 underline">
            Política de Privacidade
          </a>
          .
        </span>
      </label>
      <FormMessage message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Criando…" : "Criar conta"}
      </Button>
    </form>
  );
}
