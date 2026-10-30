import type { Metadata } from "next";
import Link from "next/link";
import { canWrite, eq, householdSettings, withHousehold } from "@organizeup/db";
import { buttonClass } from "@/components/styles";
import { Card, PageHeader } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/invites";
import { requireTenant } from "@/lib/session";
import { DeleteAccount } from "./delete-account";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const { session, ctx } = await requireTenant();
  const [settings] = await withHousehold(ctx, (tx) =>
    tx.select().from(householdSettings).where(eq(householdSettings.householdId, ctx.householdId)),
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Configurações" description="Dados usados em todo o sistema." />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card title="Onde vocês moram" description="Base para viagens e custo de vida.">
          <SettingsForm
            disabled={!canWrite(ctx)}
            initial={{
              city: settings?.city ?? "",
              state: settings?.state ?? "",
              timezone: settings?.timezone ?? "America/Sao_Paulo",
            }}
          />
        </Card>
        <Card title="Sua conta">
          <dl className="m-0 grid gap-3 text-sm">
            <div>
              <dt className="text-muted">Nome</dt>
              <dd className="m-0 font-medium">{session.user.name}</dd>
            </div>
            <div>
              <dt className="text-muted">E-mail</dt>
              <dd className="m-0 font-medium">{session.user.email}</dd>
            </div>
            <div>
              <dt className="text-muted">Seu papel na família</dt>
              <dd className="m-0 font-medium">{ROLE_LABEL[ctx.role] ?? ctx.role}</dd>
            </div>
          </dl>
        </Card>
        <Card title="Seus dados" description="Eles são seus: leve ou apague quando quiser.">
          <div className="flex flex-wrap gap-2">
            {ctx.role === "owner" ? (
              <a href="/app/exportar" download className={buttonClass("secondary", true)}>
                Baixar dados da família
              </a>
            ) : null}
            <DeleteAccount />
          </div>
          <p className="mt-4 text-sm text-muted">
            Veja os{" "}
            <Link href="/termos" className="font-semibold text-brand-700 underline">
              Termos de Uso
            </Link>{" "}
            e a{" "}
            <Link href="/privacidade" className="font-semibold text-brand-700 underline">
              Política de Privacidade
            </Link>
            .
          </p>
        </Card>
      </div>
    </div>
  );
}
