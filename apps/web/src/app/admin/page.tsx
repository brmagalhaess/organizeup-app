import {
  adminOverviewCounts,
  databaseStatus,
  listActiveHouseholdIds,
  listAgentRuns,
  listWorkerHeartbeats,
} from "@organizeup/db";
import type { Metadata } from "next";
import { Badge, Card, FormMessage, StatTile } from "@/components/ui";
import { ONBOARDING_VERSION } from "@/lib/onboarding";
import { requireAdmin } from "@/lib/session";
import { formatAge, formatCount, formatDay, minutesSince } from "./format";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "./painel";

export const metadata: Metadata = { title: "Painel do serviço" };

/** O heartbeat roda a cada 5 minutos: acima disso por três ciclos, o worker parou. */
const WORKER_STALE_MINUTES = 15;

const shortCommit = (commit: string) => commit.slice(0, 7);

const headerCell = "whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted";
const numberCell = "px-3 py-2 text-right tabular-nums";

export default async function AdminPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "painel:visao_geral");

  const [counts, active, runs, database, workers] = await Promise.all([
    hasAdminDatabase() ? adminOverviewCounts({ onboardingVersion: ONBOARDING_VERSION }) : null,
    listActiveHouseholdIds(30),
    listAgentRuns(7),
    databaseStatus(),
    listWorkerHeartbeats(),
  ]);

  return (
    <>
      <section aria-labelledby="numeros" className="flex flex-col gap-3">
        <h2 id="numeros" className="text-base font-semibold">
          Números do serviço
        </h2>
        {counts ? null : <FormMessage message={ADMIN_DB_MISSING} />}
        <dl className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {counts ? (
            <>
              <StatTile label="Famílias" value={formatCount(counts.households)} />
              <StatTile label="Usuários" value={formatCount(counts.users)} />
              <StatTile label="Novas em 7 dias" value={formatCount(counts.newHouseholds7d)} />
              <StatTile label="Novas em 30 dias" value={formatCount(counts.newHouseholds30d)} />
            </>
          ) : null}
          <StatTile label="Ativas em 30 dias" value={formatCount(active.length)} />
          {counts ? (
            <StatTile label="Cadastros pendentes" value={formatCount(counts.onboardingPending)} />
          ) : null}
        </dl>
      </section>

      <Card title="Agentes diários" description="Últimos 7 dias com rodada.">
        {runs.length === 0 ? (
          <p role="status" className="text-sm text-muted">
            Nenhuma rodada registrada ainda.
          </p>
        ) : (
          <div
            role="region"
            aria-label="Rodadas dos agentes diários"
            tabIndex={0}
            className="-mx-5 overflow-x-auto sm:-mx-6"
          >
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Rodadas dos agentes diários por dia</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={`${headerCell} pl-5 text-left sm:pl-6`}>
                    Dia
                  </th>
                  <th scope="col" className={`${headerCell} text-left`}>
                    Agente
                  </th>
                  <th scope="col" className={`${headerCell} text-right`}>
                    Famílias
                  </th>
                  <th scope="col" className={`${headerCell} text-right`}>
                    Ok
                  </th>
                  <th scope="col" className={`${headerCell} text-right`}>
                    Falhas
                  </th>
                  <th scope="col" className={`${headerCell} text-right`}>
                    Sugestões
                  </th>
                  <th scope="col" className={`${headerCell} pr-5 text-right sm:pr-6`}>
                    Aplicadas
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={`${run.day}:${run.agent}`}
                    className="border-b border-line last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-2 pl-5 tabular-nums sm:pl-6">
                      {formatDay(run.day)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{run.agent}</td>
                    <td className={numberCell}>{formatCount(run.households)}</td>
                    <td className={numberCell}>{formatCount(run.ok)}</td>
                    <td className={numberCell}>
                      {run.failed > 0 ? (
                        <Badge tone="danger">{formatCount(run.failed)}</Badge>
                      ) : (
                        formatCount(run.failed)
                      )}
                    </td>
                    <td className={numberCell}>{formatCount(run.suggestions)}</td>
                    <td className={`${numberCell} pr-5 sm:pr-6`}>{formatCount(run.applied)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Saúde">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Commit da web</dt>
            <dd className="m-0 mt-1 font-mono">{shortCommit(process.env.APP_COMMIT ?? "dev")}</dd>
          </div>
          <div>
            <dt className="text-muted">Versão do schema</dt>
            <dd className="m-0 mt-1 font-mono break-all">
              {database.schemaVersion ?? "Nenhuma migração"}
            </dd>
          </div>
        </dl>
        <h3 className="mt-5 text-sm font-semibold">Workers</h3>
        {workers.length === 0 ? (
          <p role="status" className="mt-2 text-sm text-muted">
            Nenhum worker enviou sinal ainda.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {workers.map((worker) => {
              const minutes = minutesSince(worker.lastSeenAt);
              return (
                <li key={worker.workerId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 font-mono break-all">{worker.workerId}</span>
                  <span className="font-mono text-muted">{shortCommit(worker.commit)}</span>
                  <span className="text-muted">Último sinal {formatAge(minutes)}</span>
                  {minutes > WORKER_STALE_MINUTES ? <Badge tone="warning">Sem sinal</Badge> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
