import { listAgentRuns, listWorkerHeartbeats } from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { buttonClass } from "@/components/styles";
import { Badge, Card, EmptyState, FormMessage } from "@/components/ui";
import { platformFlags, requireAdmin } from "@/lib/session";
import { RunAction, Switch } from "../admin-actions";
import { DayStrip, type DayStatus } from "../charts";
import { formatCount, formatDay } from "../format";
import { AdminPage } from "../kit";
import { noteAdminAccess } from "../painel";
import { recountPlatform, runAgentsNow, toggleAgent } from "./actions";
import { DAILY_AGENTS_INFO, PAPERCLIP_URL } from "./info";

export const metadata: Metadata = { title: "Agentes" };

const STRIP_DAYS = 14;

type Run = Awaited<ReturnType<typeof listAgentRuns>>[number];

/** Os últimos dias do calendário, do mais antigo ao de hoje. */
function lastDays(today: string, total: number) {
  const base = new Date(`${today}T12:00:00Z`).getTime();
  return Array.from({ length: total }, (_, index) =>
    new Date(base - (total - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
}

function statusOf(run: Run | undefined): DayStatus {
  if (!run) return "sem";
  return run.failed > 0 ? "falha" : "ok";
}

function dayTitle(day: string, run: Run | undefined) {
  if (!run) return `${formatDay(day)}: não rodou`;
  return `${formatDay(day)}: ${run.ok} ok, ${run.failed} falhas, ${run.suggestions} sugestões, ${run.applied} aplicadas`;
}

function Totals({ runs }: { runs: Run[] }) {
  const sum = (key: "households" | "ok" | "failed" | "suggestions" | "applied") =>
    runs.reduce((total, run) => total + run[key], 0);
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
      {[
        ["Famílias", sum("households")],
        ["Falhas", sum("failed")],
        ["Sugestões", sum("suggestions")],
        ["Aplicadas", sum("applied")],
      ].map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <dt className="text-muted">{label}</dt>
          <dd className="m-0 font-semibold tabular-nums">{formatCount(Number(value))}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AdminAgentsPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "agentes:ver");

  const [runs, flags, workers] = await Promise.all([
    listAgentRuns(STRIP_DAYS),
    platformFlags(),
    listWorkerHeartbeats(),
  ]);
  const today = todayIn();
  const days = lastDays(today, STRIP_DAYS);
  const byDay = new Map<string, Run[]>();
  for (const run of runs) byDay.set(run.day, [...(byDay.get(run.day) ?? []), run]);
  const envOff = workers.length > 0 && workers.every((w) => w.info.dailyAgents === false);

  return (
    <AdminPage
      title="Agentes"
      description="Os cinco assistentes rodam toda madrugada, às 04:00, para cada família ativa."
      actions={
        <>
          <RunAction
            label="Rodar agora"
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

      <section aria-labelledby="cinco-agentes" className="flex flex-col gap-3">
        <h2 id="cinco-agentes" className="text-base font-semibold">
          Os cinco agentes
        </h2>
        <ul className="m-0 grid list-none gap-4 p-0 xl:grid-cols-2">
          {DAILY_AGENTS_INFO.map((agent) => {
            const off = flags.disabledAgents.includes(agent.id);
            const agentRuns = runs.filter((run) => run.agent === agent.id);
            const failed = agentRuns.reduce((total, run) => total + run.failed, 0);
            return (
              <li
                key={agent.id}
                className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="flex flex-wrap items-center gap-2 font-semibold">
                      {agent.name}
                      {off ? <Badge>Desligado</Badge> : null}
                      {!off && failed > 0 ? <Badge tone="danger">Com falhas</Badge> : null}
                    </h3>
                    <p className="mt-0.5 text-sm text-muted">{agent.text}</p>
                  </div>
                  <Switch
                    label={`Agente ${agent.name}`}
                    checked={!off}
                    action={toggleAgent}
                    hidden={{ agent: agent.id }}
                  />
                </div>
                <DayStrip
                  label={`Últimos ${STRIP_DAYS} dias de ${agent.name}`}
                  days={days.map((day) => {
                    const run = byDay.get(day)?.find((item) => item.agent === agent.id);
                    return { day, title: dayTitle(day, run), status: statusOf(run) };
                  })}
                />
                <Totals runs={agentRuns} />
              </li>
            );
          })}
          <li className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line p-4 sm:p-5">
            <div>
              <h3 className="font-semibold">Equipe de manutenção</h3>
              <p className="mt-0.5 text-sm text-muted">
                Os agentes que cuidam do código do sistema ficam no Paperclip, separados destes
                cinco.
              </p>
            </div>
            <a
              href={PAPERCLIP_URL}
              target="_blank"
              rel="noreferrer"
              className={buttonClass("secondary", true)}
            >
              Abrir o Paperclip
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </li>
        </ul>
        <p className="text-xs text-muted">
          Cada quadrado é um dia, do mais antigo ao de hoje. Verde: rodou. Com exclamação: houve
          falha. Apagado: não rodou.
        </p>
      </section>

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
                          <span className="w-32 shrink-0 text-sm font-medium first-letter:uppercase">
                            {run.agent}
                          </span>
                          <div className="min-w-0 flex-1">
                            <Totals runs={[run]} />
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
