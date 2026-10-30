import type { Metadata } from "next";
import { canWrite, eq, householdSettings, withHousehold } from "@organizeup/db";
import { Card, PageHeader } from "@/components/ui";
import { requireTenant } from "@/lib/session";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Configurações" };

const ROLE_LABEL: Record<string, string> = {
  owner: "Responsável",
  adult: "Adulto",
  child: "Criança",
  viewer: "Só leitura",
};

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
      </div>
    </div>
  );
}
