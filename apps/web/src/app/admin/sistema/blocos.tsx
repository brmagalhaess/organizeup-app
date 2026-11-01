// Blocos da tela Sistema sobre o que entrou no produto: IA, dicas, mercado e base de conhecimento.
// Só somas e dados da plataforma: nada aqui lê valor ou texto de família.
import type { KnowledgeStatus, MarketStatus } from "@organizeup/db";
import { Badge, Card, EmptyState } from "@/components/ui";
import { catalogStale, knowledgeExpired } from "../alertas";
import { DayBars } from "../charts";
import {
  formatCount,
  formatDateTime,
  formatDay,
  formatDayShort,
  formatUsd,
  formatUsdFine,
} from "../format";
import { AdminTable, Fact, Facts, type Column } from "../kit";
import {
  aiByDay,
  aiByRoute,
  cacheShare,
  routeLabel,
  type AiStatRow,
  type insightsByDay,
} from "./resumo";
import { TestAssistant } from "./test-assistant";

const routeColumns: Column[] = [
  { key: "route", label: "Rota", primary: true },
  { key: "calls", label: "Chamadas", align: "right" },
  { key: "cost", label: "Gasto", align: "right" },
  { key: "cache", label: "Cache lido", align: "right" },
];

const dayColumns: Column[] = [
  { key: "day", label: "Dia", primary: true },
  { key: "calls", label: "Chamadas", align: "right" },
  { key: "cost", label: "Gasto", align: "right" },
  { key: "cache", label: "Cache lido", align: "right" },
  { key: "routes", label: "Rotas" },
];

const insightColumns: Column[] = [
  { key: "day", label: "Dia", primary: true },
  { key: "families", label: "Famílias atendidas", align: "right" },
  { key: "created", label: "Criadas", align: "right" },
  { key: "discarded", label: "Descartadas", align: "right" },
  { key: "failed", label: "Falhas", align: "right" },
];

const SUMMARY_CLASS = "flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm font-medium";

interface Spend {
  spentUsd: number;
  budgetUsd: number;
  calls: number;
  reached: boolean;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function SpendMeter({ spent, budget }: { spent: number; budget: number }) {
  const share = budget > 0 ? Math.min(Math.round((spent / budget) * 100), 100) : 0;
  return (
    <div aria-hidden="true" className="mt-4 h-2 overflow-hidden rounded-full bg-brand-50">
      <div className="h-full rounded-full bg-series-a" style={{ width: `${share}%` }} />
    </div>
  );
}

export function AiCard({
  model,
  spend,
  rows,
  days,
  aiEnabled,
  workerHasKey,
  lastTest,
}: {
  model: string;
  spend: Spend;
  /** Linhas de `ops.ai_stats` do período. */
  rows: AiStatRow[];
  days: string[];
  aiEnabled: boolean;
  /** Null: sem sinal do worker. */
  workerHasKey: boolean | null;
  lastTest: { ok: boolean; at: Date } | null;
}) {
  const routes = aiByRoute(rows);
  const byDay = aiByDay(rows, days);
  const usedDays = byDay.filter((day) => day.calls > 0).reverse();
  return (
    <Card
      title="Inteligência artificial"
      description="Uso somado do serviço. Nenhum texto de família passa por aqui."
      actions={
        <div className="flex flex-wrap gap-2">
          {!aiEnabled ? <Badge tone="warning">Desligada no painel</Badge> : null}
          {spend.reached ? <Badge tone="danger">Teto atingido</Badge> : null}
          {workerHasKey === false ? <Badge tone="warning">Worker sem a chave</Badge> : null}
        </div>
      }
    >
      <Facts>
        <Fact label="Modelo em uso">
          <span className="font-mono">{model}</span>
        </Fact>
        <Fact label="Teto do mês">{formatUsd(spend.budgetUsd)}</Fact>
        <Fact label="Gasto no mês">{formatUsdFine(spend.spentUsd)}</Fact>
        <Fact label="Chamadas no mês">{formatCount(spend.calls)}</Fact>
        <Fact label="Cache lido no mês">{cacheShare(spend)}</Fact>
      </Facts>
      <SpendMeter spent={spend.spentUsd} budget={spend.budgetUsd} />
      <TestAssistant />
      <p className="mt-2 text-sm text-muted">
        {lastTest
          ? `Último teste em ${formatDateTime(lastTest.at)}: ${lastTest.ok ? "funcionou" : "falhou"}.`
          : "Ainda sem teste registrado."}
      </p>

      <div className="mt-6 border-t border-line pt-4">
        <h3 className="mb-3 text-sm font-semibold">Gasto por dia, últimos {days.length} dias</h3>
        <DayBars
          caption="Gasto de IA por dia"
          format={formatUsdFine}
          empty={{
            title: "Sem uso de IA nestes dias",
            text: "O gráfico aparece com a primeira chamada ao modelo.",
          }}
          points={byDay.map((day) => ({
            label: formatDayShort(day.day),
            value: day.costUsd,
            text: `${formatDay(day.day)}: ${formatUsdFine(day.costUsd)} em ${formatCount(day.calls)} chamadas`,
            details: [
              { label: "Gasto", value: formatUsdFine(day.costUsd) },
              { label: "Chamadas", value: formatCount(day.calls) },
              { label: "Cache lido", value: cacheShare(day) },
            ],
          }))}
        />
      </div>

      {routes.length > 0 ? (
        <div className="mt-6 border-t border-line pt-4">
          <h3 className="mb-3 text-sm font-semibold">Por rota, últimos {days.length} dias</h3>
          <AdminTable
            caption="Uso de IA por rota"
            columns={routeColumns}
            rows={routes.map((route) => ({
              id: route.route,
              cells: {
                route: routeLabel(route.route),
                calls: formatCount(route.calls),
                cost: formatUsdFine(route.costUsd),
                cache: cacheShare(route),
              },
            }))}
          />
          <details className="mt-4 rounded-xl border border-line bg-card-soft">
            <summary className={SUMMARY_CLASS}>Ver dia a dia</summary>
            <div className="border-t border-line p-3">
              <AdminTable
                caption="Uso de IA por dia"
                columns={dayColumns}
                rows={usedDays.map((day) => ({
                  id: day.day,
                  cells: {
                    day: formatDay(day.day),
                    calls: formatCount(day.calls),
                    cost: formatUsdFine(day.costUsd),
                    cache: cacheShare(day),
                    routes: day.routes
                      .map((route) => `${routeLabel(route.route)}: ${formatCount(route.calls)}`)
                      .join(" · "),
                  },
                }))}
              />
            </div>
          </details>
        </div>
      ) : null}
    </Card>
  );
}

export function InsightsCard({
  days,
  windowDays,
}: {
  days: ReturnType<typeof insightsByDay>;
  windowDays: number;
}) {
  const sum = (key: "created" | "discarded") => days.reduce((total, day) => total + day[key], 0);
  return (
    <Card
      title="Dicas da madrugada"
      description={`Últimos ${windowDays} dias. Descartada é a dica que o verificador reprovou antes de chegar à família.`}
    >
      {days.length === 0 ? (
        <EmptyState
          title="Nenhuma rodada de dicas ainda"
          text="Elas rodam às 05:45 para as famílias que autorizaram."
        />
      ) : (
        <>
          <Facts>
            <Fact label="Criadas">{formatCount(sum("created"))}</Fact>
            <Fact label="Descartadas">{formatCount(sum("discarded"))}</Fact>
            <Fact label="Famílias atendidas na última rodada">
              {formatCount(days[0]!.families)}
            </Fact>
          </Facts>
          <details className="mt-4 rounded-xl border border-line bg-card-soft">
            <summary className={SUMMARY_CLASS}>Ver dia a dia</summary>
            <div className="border-t border-line p-3">
              <AdminTable
                caption="Dicas por dia"
                columns={insightColumns}
                rows={days.map((day) => ({
                  id: day.day,
                  cells: {
                    day: formatDay(day.day),
                    families: formatCount(day.families),
                    created: formatCount(day.created),
                    discarded: formatCount(day.discarded),
                    failed:
                      day.failed > 0 ? <Badge tone="danger">{formatCount(day.failed)}</Badge> : "0",
                  },
                }))}
              />
            </div>
          </details>
        </>
      )}
    </Card>
  );
}

export function MarketCard({
  status,
  maxCalls,
  now,
}: {
  status: MarketStatus;
  maxCalls: number;
  now: Date;
}) {
  const stale = status.assetsUpdatedAt ? catalogStale(status.assetsUpdatedAt, now) : false;
  return (
    <Card
      title="Dados de mercado"
      description="Tabelas da bolsa, iguais para todas as famílias."
      actions={stale ? <Badge tone="warning">Catálogo velho</Badge> : null}
    >
      {status.assets === 0 && status.tickers === 0 ? (
        <EmptyState
          title="Nenhum dado de mercado ainda"
          text="O agente Mercado grava tudo na primeira rodada."
        />
      ) : (
        <Facts>
          <Fact label="Ativos no catálogo">{formatCount(status.assets)}</Fact>
          <Fact label="Última atualização">
            {status.assetsUpdatedAt ? formatDateTime(status.assetsUpdatedAt) : "Nunca"}
          </Fact>
          <Fact label="Ativos acompanhados">{formatCount(status.tickers)}</Fact>
          <Fact label="Chamadas da brapi hoje">
            {formatCount(status.callsToday)} de {formatCount(maxCalls)}
          </Fact>
          <Fact label="Eventos em ações">{formatCount(status.stockEvents)}</Fact>
          <Fact label="Cotações de dólar e euro">
            {status.fxLatest
              ? `${formatCount(status.fxRates)}, até ${status.fxLatest.split("-").reverse().join("/")}`
              : "Nenhuma ainda"}
          </Fact>
        </Facts>
      )}
    </Card>
  );
}

export function KnowledgeCard({ status, today }: { status: KnowledgeStatus; today: string }) {
  const expired = status.oldestReview ? knowledgeExpired(status.oldestReview, today) : false;
  return (
    <Card
      title="Base de conhecimento"
      description="Regras públicas que o assistente consulta, cada uma com fonte."
      actions={expired ? <Badge tone="warning">Revisão vencida</Badge> : null}
    >
      {status.chunks === 0 ? (
        <EmptyState
          title="Base ainda vazia"
          text="O worker carrega os trechos ao aplicar as migrações."
        />
      ) : (
        <>
          <Facts>
            <Fact label="Trechos">{formatCount(status.chunks)}</Fact>
            <Fact label="Revisão mais antiga">{formatDay(status.oldestReview ?? "")}</Fact>
          </Facts>
          {expired ? (
            <p className="mt-3 text-sm text-muted">
              Passou de 12 meses. Peça à equipe para conferir os trechos nas fontes citadas.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
