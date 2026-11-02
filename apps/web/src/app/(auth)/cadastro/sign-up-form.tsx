"use client";
import { parseIdentity } from "@organizeup/domain";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { IdentityFields, type IdentityErrors } from "@/components/identity-fields";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { identityFromForm } from "@/lib/identity-form";
import { isValidPassword } from "@/lib/password";

export function SignUpForm({ invite }: { invite: string | null }) {
  const t = useTranslations("auth");
  const tIdentity = useTranslations("identity");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [identityErrors, setIdentityErrors] = useState<IdentityErrors>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIdentityErrors({});
    const form = new FormData(event.currentTarget);
    const identity = identityFromForm(form);
    const parsed = parseIdentity(identity);
    if (!parsed.ok) {
      const fields = parsed.fields.map((field) => [field, tIdentity(`errors.${field}`)]);
      setIdentityErrors(Object.fromEntries(fields) as IdentityErrors);
      return;
    }
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError(t("errors.passwordsDiffer"));
      return;
    }
    if (!isValidPassword(password)) {
      setError(t("errors.passwordRule"));
      return;
    }
    setPending(true);
    // termsAccepted e identity são conferidos no hook de cadastro; o cliente tipado não os conhece.
    const input = {
      name: String(form.get("name") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      password,
      termsAccepted: form.get("terms") === "on",
      identity: parsed.value,
    };
    const { error: signUpError } = await authClient.signUp.email(input);
    if (signUpError) {
      setPending(false);
      setError(
        signUpError.code?.startsWith("USER_ALREADY_EXISTS") || signUpError.status === 422
          ? t("errors.emailTaken")
          : signUpError.status === 429
            ? t("errors.tooManyAttempts")
            : signUpError.message === "WEAK_PASSWORD"
              ? t("errors.passwordRule")
              : signUpError.message === "SIGNUP_CLOSED"
                ? t("errors.signupClosed")
                : signUpError.message === "MAINTENANCE"
                  ? t("errors.maintenance")
                  : signUpError.message === "DOCUMENT_REFUSED"
                    ? tIdentity("errors.refusedSignUp")
                    : signUpError.message === "DOCUMENT_UNAVAILABLE"
                      ? tIdentity("errors.unavailable")
                      : t("errors.signupFailed"),
      );
      return;
    }
    router.replace(invite ? `/convite/${invite}` : "/app/novo-household");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label={t("fields.name")}>
        <Input name="name" autoComplete="name" required maxLength={120} />
      </Field>
      <Field label={t("fields.email")}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <IdentityFields errors={identityErrors} personOnly={invite !== null} />
      <Field label={t("fields.password")} hint={t("fields.passwordHint")}>
        <Input name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label={t("fields.confirmPassword")}>
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input name="terms" type="checkbox" required className="mt-0.5 size-5 shrink-0" />
        <span>
          {t.rich("signUp.terms", {
            terms: (text) => (
              <a href="/termos" target="_blank" className="font-semibold text-brand-700 underline">
                {text}
              </a>
            ),
            privacy: (text) => (
              <a
                href="/privacidade"
                target="_blank"
                className="font-semibold text-brand-700 underline"
              >
                {text}
              </a>
            ),
          })}
        </span>
      </label>
      <FormMessage message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? t("signUp.pending") : t("signUp.submit")}
      </Button>
    </form>
  );
}
