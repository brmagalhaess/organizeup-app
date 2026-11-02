"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CURRENCIES } from "@organizeup/domain";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { bootstrapHousehold } from "../../actions";

function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "familia"}-${crypto.randomUUID().slice(0, 8)}`;
}

export function CreateHouseholdForm() {
  const t = useTranslations("familiaOnboarding.create");
  const tCurrencies = useTranslations("contas.currencies");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const { data, error: createError } = await authClient.organization.create({
      name,
      slug: slugify(name),
    });
    if (createError || !data) {
      setPending(false);
      setError(t(createError?.message === "MAINTENANCE" ? "maintenanceError" : "failed"));
      return;
    }
    const { error: activeError } = await authClient.organization.setActive({
      organizationId: data.id,
    });
    if (activeError) {
      setPending(false);
      setError(t("openFailed"));
      return;
    }
    const result = await bootstrapHousehold({
      city: String(form.get("city") ?? ""),
      state: String(form.get("state") ?? ""),
      currency: String(form.get("currency") ?? "BRL"),
    });
    if (!result.ok) {
      setPending(false);
      setError(result.message ?? t("setupFailed"));
      return;
    }
    router.replace("/app");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label={t("name")} hint={t("nameHint")}>
        <Input name="name" required maxLength={80} />
      </Field>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label={t("city")}>
          <Input name="city" maxLength={80} autoComplete="address-level2" />
        </Field>
        <Field label={t("state")}>
          <Input name="state" maxLength={2} autoComplete="address-level1" className="uppercase" />
        </Field>
      </div>
      <Field label={t("currency")} hint={t("currencyHint")}>
        <Select name="currency" defaultValue="BRL">
          {CURRENCIES.map((value) => (
            <option key={value} value={value}>
              {tCurrencies(value)}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage message={error} />
      <Button type="submit" disabled={pending}>
        {t(pending ? "pending" : "submit")}
      </Button>
    </form>
  );
}
