// Cartão de um agente do produto: o que faz, quem acorda, a última rodada e os últimos 14 dias.
import type { listAgentRuns } from "@organizeup/db";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui";
import { RunAction, Switch } from "../admin-actions";
import { DayStrip, type DayStatus } from "../charts";
import { formatCount, formatDateTime, formatDay } from "../format";
import { runAgentNow, toggleAgent } from "./actions";
import { runMetrics, type ProductAgent } from "./catalogo";

export type Run = Awaited<ReturnType<typeof listAgentRuns>>[number];

function statusOf(run: Run | undefined): DayStatus {
  if (!run) return "sem";
  return run.failed > 0 ? "falha" : "ok";
}

function dayTitle(day: string, run: Run | undefined, discarded: number) {
  if (!run) return `${formatDay(day)}: não rodou`;
  const numbers = runMetrics(run.agent, run, discarded)
    .map(({ label, value }) => `${label.toLowerCase()}: ${formatCount(value)}`)
    .join(", ");
  return `${formatDay(day)}: ${numbers}`;
}

export function Metrics({ agent, run, discarded }: { agent: string; run: Run; discarded: number }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
      {runMetrics(agent, run, discarded).map(({ label, value }) => (
        <div key={label} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <dt className="text-muted">{label}</dt>
          <dd className="m-0 font-semibold tabular-nums">{formatCount(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AgentCard({
  agent,
  runs,
  days,
  discards,
  off,
  canRun,
  notes,
}: {
  agent: ProductAgent;
  /** Rodadas deste agente, da mais nova à mais antiga. */
  runs: Run[];
  days: string[];
  /** Descartes por dia. */
  discards: Map<string, number>;
  off: boolean;
  canRun: boolean;
  /** Situações próprias do agente, como a chave que falta. */
  notes: string[];
}) {
  const last = runs[0];
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold">
            {agent.name}
            {off ? <Badge>Desligado</Badge> : null}
            {!off && last && last.failed > 0 ? <Badge tone="danger">Com falhas</Badge> : null}
            {notes.map((note) => (
              <Badge key={note} tone="warning">
                {note}
              </Badge>
            ))}
          </h3>
          <p className="mt-0.5 text-sm text-muted">{agent.text}</p>
        </div>
        {agent.controls ? (
          <Switch
            label={`Agente ${agent.name}`}
            checked={!off}
            action={toggleAgent}
            hidden={{ agent: agent.id }}
          />
        ) : null}
      </div>
      <p className="m-0 flex items-start gap-2 text-sm text-muted">
        <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{agent.wake}</span>
      </p>
      {last ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-sm">
            <span className="text-muted">Última rodada: </span>
            <span className="font-medium">{formatDateTime(last.finishedAt)}</span>
          </p>
          <Metrics agent={agent.id} run={last} discarded={discards.get(last.day) ?? 0} />
        </div>
      ) : (
        <p className="m-0 text-sm text-muted">Ainda não rodou.</p>
      )}
      <DayStrip
        label={`Últimos ${days.length} dias de ${agent.name}`}
        days={days.map((day) => {
          const run = runs.find((item) => item.day === day);
          return { day, title: dayTitle(day, run, discards.get(day) ?? 0), status: statusOf(run) };
        })}
      />
      {agent.controls && canRun ? (
        <div className="self-start">
          <RunAction
            label="Rodar agora"
            ariaLabel={`Rodar agora: ${agent.name}`}
            pendingLabel="Pedindo…"
            action={runAgentNow}
            hidden={{ agent: agent.id }}
          />
        </div>
      ) : null}
    </li>
  );
}
