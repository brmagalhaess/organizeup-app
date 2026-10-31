"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
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
      setError(
        createError?.message === "MAINTENANCE"
          ? "O sistema está em manutenção. Tente de novo mais tarde."
          : "Não foi possível criar a família. Tente novamente.",
      );
      return;
    }
    const { error: activeError } = await authClient.organization.setActive({
      organizationId: data.id,
    });
    if (activeError) {
      setPending(false);
      setError("Família criada, mas não foi possível abri-la. Entre novamente.");
      return;
    }
    const result = await bootstrapHousehold({
      city: String(form.get("city") ?? ""),
      state: String(form.get("state") ?? ""),
    });
    if (!result.ok) {
      setPending(false);
      setError(result.message ?? "Não foi possível concluir a configuração.");
      return;
    }
    router.replace("/app");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Nome da família" hint='Ex.: "Família Souza" ou "Casa da Ana e do Leo".'>
        <Input name="name" required maxLength={80} />
      </Field>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label="Cidade onde moram">
          <Input name="city" maxLength={80} autoComplete="address-level2" />
        </Field>
        <Field label="UF">
          <Input name="state" maxLength={2} autoComplete="address-level1" className="uppercase" />
        </Field>
      </div>
      <FormMessage message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Criando…" : "Criar família"}
      </Button>
    </form>
  );
}
