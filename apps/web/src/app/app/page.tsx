import type { Metadata } from "next";
import Link from "next/link";
import {
  asc,
  canWrite,
  eq,
  household,
  householdSettings,
  people,
  withHousehold,
} from "@organizeup/db";
import { ageFromBirth, formatBRL, formatYearMonth, todayIn } from "@organizeup/domain";
import { Card } from "@/components/ui";
import { loadMonth } from "@/lib/month";
import { requireTenant } from "@/lib/session";
import { AddPersonForm } from "./add-person-form";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Início" };

const RELATION_LABEL: Record<string, string> = {
  titular: "Titular",
  conjuge: "Cônjuge",
  filho: "Filho(a)",
  pai_mae: "Pai/Mãe",
  outro: "Outro",
};

export default async function AppHome() {
  const { ctx } = await requireTenant();
  const data = await withHousehold(ctx, async (tx) => {
    const [settings] = await tx
      .select()
      .from(householdSettings)
      .where(eq(householdSettings.householdId, ctx.householdId));
    const members = await tx.select().from(people).orderBy(asc(people.createdAt));
    return { settings, members };
  });
  // Nome do household (tabela de auth; o contexto já validou a filiação).
  const [hh] = await withHousehold(ctx, (tx) =>
    tx.select({ name: household.name }).from(household).where(eq(household.id, ctx.householdId)),
  );

  const timezone = data.settings?.timezone ?? "America/Sao_Paulo";
  const today = todayIn(timezone);
  const [year, month] = today.split("-").map(Number) as [number, number];
  const writable = canWrite(ctx);
  const current = await loadMonth(ctx);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-500">
          Sua família
        </p>
        <h1 className="text-2xl font-bold">{hh?.name ?? "Família"}</h1>
        <p className="text-sm text-muted">
          Hoje é {new Date(`${today}T12:00:00`).toLocaleDateString("pt-BR", { dateStyle: "long" })}
          {data.settings?.city
            ? ` · ${data.settings.city}${data.settings.state ? `/${data.settings.state}` : ""}`
            : ""}
        </p>
      </div>

      <Card
        title={`Resumo de ${formatYearMonth(current.month)}`}
        actions={
          <Link href="/app/mes" className="text-sm font-semibold text-brand-700 underline">
            Abrir o mês
          </Link>
        }
      >
        <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            ["Entrou", current.summary.received],
            ["Saiu", current.summary.spent],
            ["Previsão para o fim do mês", current.summary.projectedBalance],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="m-0 mt-1 text-lg font-semibold tabular-nums">{formatBRL(value!)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title="Pessoas da família">
          {data.members.length === 0 ? (
            <p className="text-sm text-muted">Ninguém cadastrado ainda.</p>
          ) : (
            <ul className="divide-y divide-line" aria-label="Pessoas da família">
              {data.members.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted">{RELATION_LABEL[p.relation] ?? p.relation}</p>
                  </div>
                  {p.birthYear && p.birthMonth ? (
                    <span className="text-sm text-muted">
                      {ageFromBirth(p.birthYear, p.birthMonth, { year, month })} anos
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {writable ? (
            <div className="mt-5 border-t border-line pt-5">
              <AddPersonForm />
            </div>
          ) : null}
        </Card>

        <Card title="Configurações">
          <SettingsForm
            disabled={!writable}
            initial={{
              city: data.settings?.city ?? "",
              state: data.settings?.state ?? "",
              timezone,
            }}
          />
        </Card>
      </div>

      <Card title="Próximos módulos">
        <p className="text-sm text-muted">
          Dívidas, reserva, investimentos, aposentadoria e viagens chegam nas próximas etapas, todos
          usando estas pessoas e configurações.
        </p>
      </Card>
    </div>
  );
}
