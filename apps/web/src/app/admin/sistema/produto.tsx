// Bloco da tela Sistema sobre o que entrou no produto: moeda principal, relatórios, notificações e dívidas.
// Só contagens: nada identifica uma família.
import { adminProductCounts } from "@organizeup/db";
import type { ReportKind } from "@organizeup/domain";
import { Badge, Card } from "@/components/ui";
import { formatCount } from "../format";
import { hasAdminDatabase } from "../painel";

const STATEMENT_LABELS: Record<ReportKind, string> = {
  resumo: "Resumo",
  categorias: "Categorias",
  fluxo: "Fluxo",
  patrimonio: "Patrimônio",
  investimentos: "Investimentos",
  proventos: "Proventos",
  dividas: "Dívidas",
  metas: "Metas",
  aposentadoria: "Aposentadoria",
  anual: "Anual",
};

export async function ProductCard({ debtsAgentOff }: { debtsAgentOff: boolean }) {
  if (!hasAdminDatabase()) return null;
  const counts = await adminProductCounts();
  return (
    <Card
      title="Moeda, relatórios e notificações"
      description="Uso das telas nos últimos 30 dias. Só contagens."
    >
      <dl className="m-0 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-xs text-muted">Moeda principal</dt>
          <dd className="m-0 mt-1 flex flex-wrap gap-1.5">
            {counts.currencies.length === 0 ? "Sem famílias" : null}
            {counts.currencies.map((row) => (
              <Badge key={row.currency}>
                {row.currency}: {formatCount(row.families)}
              </Badge>
            ))}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Relatórios da família</dt>
          <dd className="m-0 mt-1 flex flex-wrap gap-1.5">
            {counts.statements.length === 0 ? "Nenhum gerado" : null}
            {counts.statements.map((row) => (
              <Badge key={row.kind}>
                {STATEMENT_LABELS[row.kind]}: {formatCount(row.total)}
              </Badge>
            ))}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Notificações</dt>
          <dd className="m-0 mt-1">
            {formatCount(counts.notifications.total)} enviadas,{" "}
            {formatCount(counts.notifications.unread)} não lidas
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Dívidas</dt>
          <dd className="m-0 mt-1">
            {formatCount(counts.debtFamilies)} famílias
            {debtsAgentOff ? ", agente desligado" : ""}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
