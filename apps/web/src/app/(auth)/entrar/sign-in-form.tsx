"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function SignInForm({ invite }: { invite: string | null }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const { error: signInError } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (signInError) {
      setPending(false);
      setError(
        signInError.message === "ACCOUNT_BLOCKED"
          ? t("errors.accountBlocked")
          : t("errors.signInFailed"),
      );
      return;
    }
    router.replace(invite ? `/convite/${invite}` : "/app/escolher");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label={t("fields.email")}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label={t("fields.password")}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? t("signIn.pending") : t("signIn.submit")}
      </Button>
    </form>
  );
}
