"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function TwoFactorForm({ invite }: { invite: string | null }) {
  const t = useTranslations("auth.twoFactor");
  const router = useRouter();
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    const { error: failure } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    if (failure) {
      setPending(false);
      setError(
        failure.status === 429 || failure.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"
          ? t("tooMany")
          : failure.code === "INVALID_TWO_FACTOR_COOKIE"
            ? t("expired")
            : t("invalid"),
      );
      return;
    }
    router.replace(invite ? `/convite/${invite}` : "/app/escolher");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field
        label={backup ? t("backupLabel") : t("codeLabel")}
        hint={backup ? t("backupHint") : t("codeHint")}
      >
        <Input
          key={backup ? "backup" : "totp"}
          name="code"
          inputMode={backup ? "text" : "numeric"}
          autoComplete="one-time-code"
          required
          autoFocus
        />
      </Field>
      <FormMessage message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? t("pending") : t("submit")}
      </Button>
      <button
        type="button"
        className="text-sm font-semibold text-brand-700 underline"
        onClick={() => {
          setBackup((value) => !value);
          setError(null);
        }}
      >
        {backup ? t("useApp") : t("useBackup")}
      </button>
    </form>
  );
}
