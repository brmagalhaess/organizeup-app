import {
  listAgentDiscards,
  listAgentRuns,
  listTeamActivity,
  listWorkerHeartbeats,
} from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import type { Metadata } from "next";
import { Badge, Card, EmptyState, FormMessage } from "@/components/ui";
import { platformFlags, requireAdmin } from "@/lib/session";
import { RunAction } from "../admin-actions";
import { formatCount, formatDay, lastDays } from "../format";
import { AdminPage } from "../kit";
import { noteAdminAccess } from "../painel";
import { recountPlatform, runAgentsNow } from "./actions";
import { AgentCard, Metrics, type Run } from "./agent-card";
import { agentName, agentsInView, DICAS_AGENT, onlyAgents } from "./catalogo";
import { TeamSection } from "./team";

export const metadata: Metadata = { title: "Agentes" };

const STRIP_DAYS = 14;

export default async function AdminAgentsPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "agentes:ver");

  const today = todayIn();
  const days = lastDays(today, STRIP_DAYS);
  const [allRuns, flags, workers, discards, activity] = await Promise.all([
    listAgentRuns(STRIP_DAYS),
    platformFlags(),
    listWorkerHeartbeats(),
    listAgentDiscards(days[0]!),
    listTeamActivity(),
  ]);
  const runs = onlyAgents(allRuns);
  const byDay = new Map<string, Run[]>();
  for (const run of runs) byDay.set(run.day, [...(byDay.get(run.day) ?? []), run]);
  const discardsOf = (agent: string) =>
    new Map(
      discards.filter((row) => row.agent === agent).map((row) => [row.day, row.discarded] as const),
    );
  const workerInfo = workers[0]?.info;
  const envOff = workers.length > 0 && workers.every((w) => w.info.dailyAgents === false);
  const notesOf = (agent: string) => {
    if (agent === DICAS_AGENT) {
      return [
        ...(flags.aiEnabled ? [] : ["Assistente desligado"]),
        ...(workerInfo?.ai === false ? ["Worker sem a chave"] : []),
      ];
    }
    return [];
  };
  const records = [
    ...activity,
    ...runs.map((run) => ({ agent: run.agent, at: run.finishedAt, source: "rodada" as const })),
  ];

  return (
    <AdminPage
      title="Agentes"
      description="O Paperclip acorda cada agente de madrugada, e às 05:30 o worker roda quem faltou. Cada um percorre as famílias ativas."
      actions={
        <>
          <RunAction
            label="Rodar os diários"
            pendingLabel="Pedindo…"
            action={runAgentsNow}
            variant="primary"
          />
          <RunAction
            label="Recalcular contagens"
            pendingLabel="Pedindo…"
            action={recountPlatform}
          />
        </>
      }
    >
      {flags.maintenance ? (
        <FormMessage message="Com o modo manutenção ligado, os agentes não rodam." />
      ) : null}
      {envOff ? (
        <FormMessage message="O worker subiu com DAILY_AGENTS_ENABLED=false: nenhum agente roda até mudar essa variável." />
      ) : null}

      <section aria-labelledby="agentes-produto" className="flex flex-col gap-3">
        <div>
          <h2 id="agentes-produto" className="text-base font-semibold">
            Agentes do produto
          </h2>
          <p className="text-sm text-muted">
            Rodam no worker. Cada quadrado é um dia, do mais antigo ao de hoje. Verde: rodou. Com
            exclamação: houve falha. Apagado: não rodou.
          </p>
        </div>
        <ul className="m-0 grid list-none gap-4 p-0 xl:grid-cols-2">
          {agentsInView(runs.map((run) => run.agent)).map((agent) => {
            const off = flags.disabledAgents.includes(agent.id);
            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                runs={runs.filter((run) => run.agent === agent.id)}
                days={days}
                discards={discardsOf(agent.id)}
                off={off}
                canRun={!off && !flags.maintenance}
                notes={notesOf(agent.id)}
              />
            );
          })}
        </ul>
      </section>

      <TeamSection records={records} />

      <Card title="Histórico por dia" description={`Últimos ${STRIP_DAYS} dias com rodada.`}>
        {byDay.size === 0 ? (
          <EmptyState
            title="Nenhuma rodada registrada ainda"
            text="Use Rodar agora, ou espere a rodada da madrugada."
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {[...byDay.entries()].map(([day, dayRuns]) => {
              const failed = dayRuns.reduce((total, run) => total + run.failed, 0);
              return (
                <li key={day}>
                  <details className="group rounded-xl border border-line bg-card-soft">
                    <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                      <span className="font-semibold tabular-nums">{formatDay(day)}</span>
                      {failed > 0 ? (
                        <Badge tone="danger">
                          {failed === 1 ? "1 falha" : `${formatCount(failed)} falhas`}
                        </Badge>
                      ) : (
                        <Badge tone="success">Sem falhas</Badge>
                      )}
                      <span className="ml-auto text-muted">
                        {dayRuns.length === 1 ? "1 agente" : `${dayRuns.length} agentes`}
                      </span>
                    </summary>
                    <ul className="m-0 flex list-none flex-col gap-2 border-t border-line p-3">
                      {dayRuns.map((run) => (
                        <li key={run.agent} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                          <span className="w-32 shrink-0 text-sm font-medium">
                            {agentName(run.agent)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <Metrics
                              agent={run.agent}
                              run={run}
                              discarded={discardsOf(run.agent).get(day) ?? 0}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </AdminPage>
  );
}
