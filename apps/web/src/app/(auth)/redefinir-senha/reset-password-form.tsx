"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { isValidPassword, PASSWORD_ERROR, PASSWORD_HINT } from "@/lib/password";

function Notice({
  title,
  text,
  href,
  linkLabel,
}: {
  title: string;
  text: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted">{text}</p>
      </div>
      <p className="text-sm">
        <Link href={href} className="font-semibold text-brand-700 underline">
          {linkLabel}
        </Link>
      </p>
    </>
  );
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(token === null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password") ?? "");
    if (newPassword !== String(form.get("confirm") ?? "")) {
      setError("As senhas não conferem.");
      return;
    }
    if (!isValidPassword(newPassword)) {
      setError(PASSWORD_ERROR);
      return;
    }
    setPending(true);
    const { error: resetError } = await authClient.resetPassword({
      newPassword,
      token: token ?? "",
    });
    setPending(false);
    if (!resetError) {
      setDone(true);
    } else if (resetError.code === "INVALID_TOKEN") {
      setExpired(true);
    } else {
      setError(
        resetError.message === "WEAK_PASSWORD"
          ? PASSWORD_ERROR
          : "Não foi possível trocar a senha. Tente novamente.",
      );
    }
  }

  if (expired) {
    return (
      <Notice
        title="Este link não vale mais"
        text="O link está incompleto, venceu ou já foi usado. Peça um novo para criar sua senha."
        href="/esqueci-senha"
        linkLabel="Pedir novo link"
      />
    );
  }

  if (done) {
    return (
      <Notice
        title="Senha alterada"
        text="Sua nova senha já vale. Use-a para entrar."
        href="/entrar"
        linkLabel="Entrar"
      />
    );
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Crie uma nova senha</h1>
        <p className="text-sm text-muted">Depois disso, a senha antiga deixa de valer.</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Nova senha" hint={PASSWORD_HINT}>
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            required
          />
        </Field>
        <Field label="Confirmar nova senha">
          <Input
            name="confirm"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            required
          />
        </Field>
        <FormMessage message={error} />
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar nova senha"}
        </Button>
      </form>
    </>
  );
}
