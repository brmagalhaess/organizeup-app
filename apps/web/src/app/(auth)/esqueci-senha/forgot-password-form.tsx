"use client";
import { useState, type FormEvent } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const { error: requestError } = await authClient.requestPasswordReset({
      email: String(form.get("email") ?? "").trim(),
    });
    setPending(false);
    if (requestError) {
      setError(
        requestError.status === 429
          ? "Muitas tentativas. Aguarde um minuto e tente de novo."
          : "Não foi possível enviar agora. Tente novamente.",
      );
      return;
    }
    setSent(true);
  }

  // Mesma mensagem com ou sem conta: a tela não pode revelar quem tem cadastro.
  if (sent) {
    return (
      <FormMessage
        tone="ok"
        message="Se este e-mail tiver conta, enviamos um link para criar uma nova senha. Ele vale 1 hora. Veja também a caixa de spam."
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="E-mail">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <FormMessage message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Enviando…" : "Enviar link"}
      </Button>
    </form>
  );
}
