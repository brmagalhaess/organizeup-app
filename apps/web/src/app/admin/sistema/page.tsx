import { assistantConfigured, monthSpend } from "@organizeup/ai";
import {
  adminMigrations,
  databaseStatus,
  findAgentMemories,
  listDeployments,
  listDiagnostics,
  listQueueCounts,
  listReports,
  listWorkerHeartbeats,
} from "@organizeup/db";
import { Boxes, Database, Globe, Server } from "lucide-react";
import type { Metadata } from "next";
import { Badge, Card, EmptyState } from "@/components/ui";
import { emailConfigured } from "@/lib/email";
import { requireAdmin } from "@/lib/session";
import { WORKER_STALE_MINUTES } from "../alertas";
import { formatAge, formatCount, formatDateTime, formatUsd, minutesSince } from "../format";
import { AdminPage, AdminTable, Tile, type Column } from "../kit";
import { hasAdminDatabase, noteAdminAccess } from "../painel";
import { TestAssistant } from "./test-assistant";

export const metadata: Metadata = { title: "Sistema" };

const shortCommit = (commit: string) => commit.slice(0, 7);

/** Quanto da entrada veio do cache. Perto de zero com uso alto, o cache de prompt quebrou. */
function cacheShare(usage: {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}) {
  const total = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return total === 0 ? "sem uso" : `${Math.round((usage.cacheReadTokens / total) * 100)}%`;
}

const queueColumns: Column[] = [
  { key: "name", label: "Fila", primary: true },
  { key: "waiting", label: "Na fila", align: "right" },
  { key: "active", label: "Rodando", align: "right" },
  { key: "completed", label: "Concluídas", align: "right" },
  { key: "failed", label: "Com falha", align: "right" },
  { key: "last", label: "Última conclusão" },
];

const errorColumns: Column[] = [
  { key: "type", label: "Erro", primary: true },
  { key: "route", label: "Onde" },
  { key: "service", label: "Serviço" },
  { key: "count", label: "Vezes", align: "right" },
  { key: "last", label: "Última vez" },
  { key: "commit", label: "Versão" },
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

  const [database, workers, queues, deployments, reports, memories, migrations, spend, errors] =
    await Promise.all([
      databaseStatus(),
      listWorkerHeartbeats(),
      listQueueCounts(),
      listDeployments(12),
      listReports({ limit: 10 }),
      findAgentMemories({ limit: 12 }),
      hasAdminDatabase() ? adminMigrations() : [],
      monthSpend(),
      listDiagnostics({ limit: 20 }),
    ]);
  const webCommit = process.env.APP_COMMIT ?? "dev";
  const freshest = workers[0] ? minutesSince(workers[0].lastSeenAt) : null;
  const workerOk = freshest !== null && freshest <= WORKER_STALE_MINUTES;
  const workerInfo = (workers[0]?.info ?? {}) as {
    ai?: boolean;
    brapi?: boolean;
    dailyAgents?: boolean;
  };
  const integrations = [
    { name: "E-mail (Brevo)", where: "ou3-web", on: emailConfigured(), hint: "BREVO_API_KEY" },
    {
      name: "Cotações (brapi)",
      where: "ou3-worker",
      on: workerInfo.brapi === true,
      hint: "BRAPI_TOKEN",
    },
    {
      name: "Agentes diários",
      where: "ou3-worker",
      on: workerInfo.dailyAgents !== false,
      hint: "DAILY_AGENTS_ENABLED",
    },
    {
      name: "Inteligência artificial",
      where: "ou3-web",
      on: assistantConfigured(),
      hint: "ANTHROPIC_API_KEY",
    },
    {
      name: "Dicas da madrugada",
      where: "ou3-worker",
      on: workerInfo.ai === true,
      hint: "ANTHROPIC_API_KEY e ANTHROPIC_WORKSPACE_ID",
    },
  ];

  return (
    <AdminPage title="Sistema" description="Como o serviço está rodando agora.">
      <Card
        title="Integrações"
        description="Só diz se a chave está no ar; o valor nunca aparece aqui."
      >
        <ul className="divide-y divide-line">
          {integrations.map((item) => (
            <li key={item.name} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{item.name}</p>
                <p className="text-xs text-muted">
                  {item.hint} em {item.where}
                </p>
              </div>
              <Badge tone={item.on ? "success" : "warning"}>
                {item.on ? "Ativa" : "Falta configurar"}
              </Badge>
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t border-line pt-3 text-sm">
          <p className="m-0 flex flex-wrap items-center justify-between gap-2 font-medium">
            Gasto de IA no mês
            {spend.reached ? <Badge tone="danger">Teto atingido</Badge> : null}
          </p>
          <p className="m-0 text-muted">
            {formatUsd(spend.spentUsd)} de {formatUsd(spend.budgetUsd)}, em{" "}
            {formatCount(spend.calls)} chamadas. Cache lido: {cacheShare(spend)}.
          </p>
          <TestAssistant />
        </div>
      </Card>
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

      <Card
        title="Erros"
        description="O que falhou e segue aberto. A equipe de agentes lê esta lista toda manhã."
      >
        {errors.length === 0 ? (
          <EmptyState title="Nenhum erro aberto" text="Quando algo falhar, aparece aqui." />
        ) : (
          <AdminTable
            caption="Erros abertos"
            columns={errorColumns}
            rows={errors.map((error) => ({
              id: error.fingerprint,
              cells: {
                type: (
                  <>
                    <span className="font-mono">{error.errorType}</span>
                    {error.code ? (
                      <span className="ml-2 font-mono text-muted">{error.code}</span>
                    ) : null}
                  </>
                ),
                route: <span className="break-all font-mono">{error.route}</span>,
                service: error.service === "web" ? "Web" : "Worker",
                count: formatCount(error.count),
                last: formatDateTime(error.lastSeenAt),
                commit: <span className="font-mono">{shortCommit(error.commits[0] ?? "")}</span>,
              },
            }))}
          />
        )}
      </Card>

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
