"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { isValidPassword } from "@/lib/password";

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
  const t = useTranslations("auth");
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
      setError(t("errors.passwordsDiffer"));
      return;
    }
    if (!isValidPassword(newPassword)) {
      setError(t("errors.passwordRule"));
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
        resetError.message === "WEAK_PASSWORD" ? t("errors.passwordRule") : t("errors.resetFailed"),
      );
    }
  }

  if (expired) {
    return (
      <Notice
        title={t("reset.expiredTitle")}
        text={t("reset.expiredText")}
        href="/esqueci-senha"
        linkLabel={t("reset.expiredLink")}
      />
    );
  }

  if (done) {
    return (
      <Notice
        title={t("reset.doneTitle")}
        text={t("reset.doneText")}
        href="/entrar"
        linkLabel={t("reset.doneLink")}
      />
    );
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{t("reset.title")}</h1>
        <p className="text-sm text-muted">{t("reset.subtitle")}</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label={t("fields.newPassword")} hint={t("fields.passwordHint")}>
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            required
          />
        </Field>
        <Field label={t("fields.confirmNewPassword")}>
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
          {pending ? t("reset.pending") : t("reset.submit")}
        </Button>
      </form>
    </>
  );
}
