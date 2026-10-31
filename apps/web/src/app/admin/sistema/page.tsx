import {
  adminMigrations,
  databaseStatus,
  findAgentMemories,
  listDeployments,
  listQueueCounts,
  listReports,
  listWorkerHeartbeats,
} from "@organizeup/db";
import { Boxes, Database, Globe, Server } from "lucide-react";
import type { Metadata } from "next";
import { Badge, Card, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { WORKER_STALE_MINUTES } from "../alertas";
import { formatAge, formatCount, formatDateTime, minutesSince } from "../format";
import { AdminPage, AdminTable, Tile, type Column } from "../kit";
import { hasAdminDatabase, noteAdminAccess } from "../painel";

export const metadata: Metadata = { title: "Sistema" };

const shortCommit = (commit: string) => commit.slice(0, 7);

const queueColumns: Column[] = [
  { key: "name", label: "Fila", primary: true },
  { key: "waiting", label: "Na fila", align: "right" },
  { key: "active", label: "Rodando", align: "right" },
  { key: "completed", label: "Concluídas", align: "right" },
  { key: "failed", label: "Com falha", align: "right" },
  { key: "last", label: "Última conclusão" },
];

const REPORT_KINDS: Record<string, string> = {
  saude: "Saúde",
  semanal: "Semanal",
  incidente: "Incidente",
  custos: "Custos",
  produto: "Produto",
};

const MEMORY_KINDS: Record<string, string> = {
  fato: "Fato",
  decisao: "Decisão",
  licao: "Lição",
  preferencia: "Preferência",
};

export default async function AdminSystemPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "sistema:ver");

  const [database, workers, queues, deployments, reports, memories, migrations] = await Promise.all(
    [
      databaseStatus(),
      listWorkerHeartbeats(),
      listQueueCounts(),
      listDeployments(12),
      listReports({ limit: 10 }),
      findAgentMemories({ limit: 12 }),
      hasAdminDatabase() ? adminMigrations() : [],
    ],
  );
  const webCommit = process.env.APP_COMMIT ?? "dev";
  const freshest = workers[0] ? minutesSince(workers[0].lastSeenAt) : null;
  const workerOk = freshest !== null && freshest <= WORKER_STALE_MINUTES;

  return (
    <AdminPage title="Sistema" description="Como o serviço está rodando agora.">
      <section aria-labelledby="saude">
        <h2 id="saude" className="sr-only">
          Saúde
        </h2>
        <dl className="m-0 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <Tile
            label="Web"
            value="No ar"
            icon={Globe}
            hint={`Commit ${shortCommit(webCommit)}, Node ${process.versions.node}`}
          />
          <Tile
            label="Worker"
            value={workerOk ? "No ar" : "Sem sinal"}
            icon={Server}
            alarm={!workerOk}
            hint={
              freshest === null
                ? "Nenhum sinal ainda"
                : `Último sinal ${formatAge(freshest)}, commit ${shortCommit(workers[0]!.commit)}`
            }
          />
          <Tile
            label="Banco"
            value={database.schemaVersion?.slice(0, 4) ?? "—"}
            icon={Database}
            hint={database.schemaVersion ?? "Nenhuma migração"}
          />
          <Tile
            label="Migrações"
            value={formatCount(migrations.length)}
            icon={Boxes}
            hint="Aplicadas neste banco"
          />
        </dl>
      </section>

      <Card title="Filas" description="Tarefas do worker, por fila.">
        {queues.length === 0 ? (
          <EmptyState title="Nenhuma fila criada" text="O worker cria as filas ao subir." />
        ) : (
          <AdminTable
            caption="Filas do worker"
            columns={queueColumns}
            rows={queues.map((queue) => ({
              id: queue.name,
              cells: {
                name: <span className="font-mono">{queue.name}</span>,
                waiting: formatCount(queue.waiting),
                active: formatCount(queue.active),
                completed: formatCount(queue.completed),
                failed:
                  queue.failed > 0 ? <Badge tone="danger">{formatCount(queue.failed)}</Badge> : "0",
                last: queue.lastFinishedAt ? formatDateTime(queue.lastFinishedAt) : "Nunca",
              },
            }))}
          />
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Workers" description="Último sinal de cada processo.">
          {workers.length === 0 ? (
            <EmptyState title="Nenhum worker enviou sinal ainda" />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0 text-sm">
              {workers.map((worker) => {
                const minutes = minutesSince(worker.lastSeenAt);
                return (
                  <li key={worker.workerId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 break-all font-mono">{worker.workerId}</span>
                    <span className="font-mono text-muted">{shortCommit(worker.commit)}</span>
                    <span className="text-muted">{formatAge(minutes)}</span>
                    {minutes > WORKER_STALE_MINUTES ? (
                      <Badge tone="warning">Sem sinal</Badge>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Deploys recentes">
          {deployments.length === 0 ? (
            <EmptyState title="Nenhum deploy registrado" />
          ) : (
            <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
              {deployments.map((deploy) => (
                <li key={deploy.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge>{deploy.service === "web" ? "Web" : "Worker"}</Badge>
                  <span className="font-mono">{shortCommit(deploy.commit)}</span>
                  <time className="ml-auto tabular-nums text-muted">
                    {formatDateTime(deploy.startedAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Relatórios da equipe" description="O que os agentes do Paperclip registraram.">
          {reports.length === 0 ? (
            <EmptyState title="Nenhum relatório ainda" />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {reports.map((report) => (
                <li key={report.id}>
                  <details className="rounded-xl border border-line bg-card-soft">
                    <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <Badge>{REPORT_KINDS[report.kind] ?? report.kind}</Badge>
                      <span className="min-w-0 font-medium">{report.title}</span>
                      <span className="ml-auto text-muted">{report.period}</span>
                    </summary>
                    <p className="m-0 whitespace-pre-wrap break-words border-t border-line p-3 text-sm">
                      {report.body}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Memórias da equipe" description="Decisões e lições que a equipe guardou.">
          {memories.length === 0 ? (
            <EmptyState title="Nenhuma memória ainda" />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0 text-sm">
              {memories.map((memory) => (
                <li key={memory.id} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge>{MEMORY_KINDS[memory.kind] ?? memory.kind}</Badge>
                    {memory.agent}
                  </span>
                  <p className="m-0 break-words">{memory.content}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Migrações aplicadas">
        {migrations.length === 0 ? (
          <EmptyState title="Sem leitura de migrações" text="Falta o acesso administrativo." />
        ) : (
          <details className="rounded-xl border border-line bg-card-soft">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm font-medium">
              Ver as {formatCount(migrations.length)} migrações
            </summary>
            <ol className="m-0 flex list-none flex-col gap-1.5 border-t border-line p-3 text-sm">
              {migrations.map((migration) => (
                <li key={migration.version} className="flex flex-wrap gap-x-3">
                  <span className="min-w-0 break-all font-mono">{migration.version}</span>
                  <time className="ml-auto tabular-nums text-muted">
                    {formatDateTime(migration.appliedAt)}
                  </time>
                </li>
              ))}
            </ol>
          </details>
        )}
      </Card>
    </AdminPage>
  );
}
