import { INSIGHTS_CONSENT_VERSION, monthSpend } from "@organizeup/ai";
import {
  adminAccessList,
  adminAssistantCounts,
  adminGrowth,
  adminOverviewCounts,
  knowledgeStatus,
  listAgentRuns,
  listDeployments,
  listDiagnostics,
  listPlatformStats,
  listQueueCounts,
  listWorkerHeartbeats,
  marketStatus,
} from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import { Activity, CircleCheck, Clock, Sparkles, UserPlus, UserRound, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, FormMessage } from "@/components/ui";
import { ONBOARDING_VERSION } from "@/lib/onboarding";
import { refusalCeilingReached } from "@/lib/document-refusals";
import { vaultReady } from "@/lib/document-vault";
import { documentKeyChanged } from "@/lib/identity";
import { platformFlags, requireAdmin } from "@/lib/session";
import { buildAlerts } from "./alertas";
import { actionLabel, AI_TEST_FAILED, AI_TEST_OK, AUDIT_VISITS } from "./auditoria/labels";
import { ActivityChart, AdoptionBars, GrowthChart } from "./charts";
import { formatCount, formatDateTime, formatDay, formatDayShort } from "./format";
import { agentName, DAILY_AGENT_IDS, DICAS_AGENT, MERCADO_AGENT } from "./agentes/catalogo";
import { AdminPage, AlertList, Tile } from "./kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "./painel";

export const metadata: Metadata = { title: "Painel do serviço" };

const brasiliaHour = () =>
  Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );

const suspendedHint = (total: number) =>
  total === 0 ? undefined : total === 1 ? "1 suspensa" : `${formatCount(total)} suspensas`;
const blockedHint = (total: number) =>
  total === 0 ? undefined : total === 1 ? "1 bloqueado" : `${formatCount(total)} bloqueados`;

/** O que o worker avisou da chave da IA. Null sem sinal dele, ou de versão que ainda não avisava. */
function workerAiKey(info: Record<string, unknown> | undefined) {
  return typeof info?.ai === "boolean" ? info.ai : null;
}

/** Última contagem de cada semana (a semana corrente fecha hoje), das 12 mais recentes. */
function weeklyActivity(stats: Array<{ day: string; active7d: number }>) {
  const weeks = new Map<string, { day: string; active: number }>();
  for (const row of stats) {
    const date = new Date(`${row.day}T12:00:00Z`);
    const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000);
    const week = monday.toISOString().slice(0, 10);
    // `stats` vem do dia mais novo para o mais antigo: a primeira linha da semana é a que vale.
    if (!weeks.has(week)) weeks.set(week, { day: row.day, active: row.active7d });
  }
  return [...weeks.values()]
    .slice(0, 12)
    .reverse()
    .map((week) => ({ label: formatDayShort(week.day), active: week.active }));
}

export default async function AdminOverviewPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "painel:visao_geral");

  if (!hasAdminDatabase()) {
    return (
      <AdminPage title="Visão geral">
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      </AdminPage>
    );
  }

  const today = todayIn();
  const [
    counts,
    growth,
    stats,
    runs,
    workers,
    deployments,
    queues,
    flags,
    recent,
    aiSpend,
    diagnostics,
    assistant,
    market,
    knowledge,
    aiTests,
  ] = await Promise.all([
    adminOverviewCounts({ onboardingVersion: ONBOARDING_VERSION }),
    adminGrowth(12),
    listPlatformStats(84),
    listAgentRuns(1),
    listWorkerHeartbeats(),
    listDeployments(10),
    listQueueCounts(),
    platformFlags(),
    adminAccessList({ limit: 6, excludeActions: AUDIT_VISITS }),
    monthSpend(),
    listDiagnostics({ limit: 100 }),
    adminAssistantCounts({ insightsConsentVersion: INSIGHTS_CONSENT_VERSION }),
    marketStatus(today),
    knowledgeStatus(),
    adminAccessList({ actions: [AI_TEST_OK, AI_TEST_FAILED], limit: 1 }),
  ]);

  const latest = stats[0] ?? null;
  const disabled = flags.disabledAgents;
  const workerHasAiKey = workerAiKey(workers[0]?.info);
  const lastTest = aiTests[0];
  const alerts = buildAlerts({
    now: new Date(),
    today,
    hour: brasiliaHour(),
    runs,
    workers,
    deployments,
    queues,
    diagnostics,
    statsDay: latest?.day ?? null,
    maintenance: flags.maintenance,
    signupClosed: flags.signupClosed,
    documentKeyMissing: !vaultReady(),
    documentKeyChanged: await documentKeyChanged(),
    documentRefusalsHigh: refusalCeilingReached(),
    allAgentsOff: DAILY_AGENT_IDS.every((id) => disabled.includes(id)),
    aiSpend,
    expectedAgents: DAILY_AGENT_IDS.filter((id) => !disabled.includes(id)).map((id) => ({
      id,
      name: agentName(id),
    })),
    insightsExpected:
      !flags.maintenance &&
      flags.aiEnabled &&
      !disabled.includes(DICAS_AGENT) &&
      workerHasAiKey !== false,
    aiTest: lastTest ? { ok: lastTest.action === AI_TEST_OK, at: lastTest.at } : null,
    ...(disabled.includes(MERCADO_AGENT) ? {} : { catalogUpdatedAt: market.assetsUpdatedAt }),
    knowledgeOldest: knowledge.oldestReview,
    workerHasAiKey: flags.aiEnabled ? workerHasAiKey : null,
  });
  const growthPoints = growth.map((week) => ({
    label: formatDayShort(week.week),
    households: week.households,
    users: week.users,
  }));

  return (
    <AdminPage
      title="Visão geral"
      description={
        alerts.length === 0
          ? "Tudo certo por aqui: nenhum alerta agora."
          : alerts.length === 1
            ? "1 ponto pede sua atenção."
            : `${alerts.length} pontos pedem sua atenção.`
      }
    >
      {alerts.length > 0 ? (
        <AlertList alerts={alerts} />
      ) : (
        <p className="m-0 flex items-center gap-2 rounded-2xl bg-success-soft px-4 py-3 text-sm font-medium text-success">
          <CircleCheck className="size-5 shrink-0" aria-hidden="true" />
          Agentes, worker, deploy e erros sem nada pendente.
        </p>
      )}

      <section aria-labelledby="numeros">
        <h2 id="numeros" className="sr-only">
          Números do serviço
        </h2>
        <dl className="m-0 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-6">
          <Tile
            label="Famílias"
            value={formatCount(counts.households)}
            icon={Users}
            trend={growth.map((week) => week.households)}
            hint={suspendedHint(counts.suspended)}
          />
          <Tile
            label="Usuários"
            value={formatCount(counts.users)}
            icon={UserRound}
            trend={growth.map((week) => week.users)}
            hint={blockedHint(counts.blocked)}
          />
          <Tile
            label="Novas em 7 dias"
            value={formatCount(counts.newHouseholds7d)}
            icon={UserPlus}
          />
          <Tile
            label="Novas em 30 dias"
            value={formatCount(counts.newHouseholds30d)}
            icon={UserPlus}
          />
          <Tile label="Ativas em 30 dias" value={formatCount(counts.active30d)} icon={Activity} />
          <Tile
            label="Cadastros pendentes"
            value={formatCount(counts.onboardingPending)}
            icon={Clock}
          />
        </dl>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Crescimento" description="Total acumulado nas últimas 12 semanas.">
          <GrowthChart points={growthPoints} />
        </Card>
        <Card title="Atividade" description="Famílias ativas em 7 dias, semana a semana.">
          <ActivityChart points={weeklyActivity(stats)} />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Adoção por módulo"
          description={
            latest
              ? `Contagem do worker em ${formatDay(latest.day)}. Só números, sem dado de família.`
              : "Contagem diária do worker. Só números, sem dado de família."
          }
        >
          {latest ? (
            <AdoptionBars
              total={latest.households}
              items={[
                { label: "Lançamentos", families: latest.useEntries },
                { label: "Investimentos", families: latest.useInvestments },
                { label: "Metas", families: latest.useGoals },
                { label: "Viagens", families: latest.useTrips },
                { label: "Aposentadoria", families: latest.useRetirement },
              ]}
            />
          ) : (
            <EmptyState
              title="Aguardando a primeira contagem"
              text="O worker conta os módulos às 03:15 e sempre que sobe."
            />
          )}
        </Card>
        <Card
          title="Assistente com IA"
          description="Quantas famílias ligaram cada parte. Só contagens."
        >
          <AdoptionBars
            label="Adoção do assistente"
            total={counts.households}
            items={[
              { label: "Assistente ligado", families: assistant.assistantOn },
              { label: "Dicas ligadas", families: assistant.insightsOn },
              { label: "Com memórias", families: assistant.withMemories },
            ]}
          />
        </Card>
      </div>

      <div>
        <Card
          title="Últimas ações"
          description="O que foi feito no painel."
          actions={
            <Link
              href="/admin/auditoria"
              className="text-sm font-semibold text-brand-700 underline underline-offset-2"
            >
              Ver auditoria
            </Link>
          }
        >
          {recent.length === 0 ? (
            <EmptyState
              title="Nenhuma ação ainda"
              text="Suspensões, bloqueios e controles aparecem aqui."
            />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0 text-sm">
              {recent.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-500" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{actionLabel(entry.action)}</span>
                  <time className="shrink-0 tabular-nums text-muted">
                    {formatDateTime(entry.at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AdminPage>
  );
}
