import { adminBillingFamilies, adminFamilyAccess, adminVipList } from "@organizeup/db";
import { VIP_NOTICE_DAYS } from "@organizeup/domain";
import { Clock, Crown, TimerOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormMessage,
  Input,
  Select,
} from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { ConfirmAction } from "../admin-actions";
import type { AdminAlert } from "../alertas";
import { billingAttention } from "../cobranca/atencao";
import { formatCount, formatDate, shortId } from "../format";
import { AdminPage, AdminTable, AlertList, Tile, type Column } from "../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../painel";
import { dayOf, vipCostText, vipGiftText, vipReasonLabel } from "../planos";
import { changeVipValidity, revokeVip } from "./actions";

export const metadata: Metadata = { title: "VIP" };

const STATUS = {
  abertos: "Valendo",
  vencendo: "Vencendo",
  vencido: "Vencidos",
  sem_responsavel: "Sem responsável",
  removido: "Removidos",
  todos: "Todos",
} as const;
type StatusFilter = keyof typeof STATUS;

const KINDS = { todos: "Família e pessoa", familia: "Família", pessoa: "Pessoa" } as const;
const COSTS = {
  todos: "Sem custo e desconto",
  sem_custo: "Sem custo",
  desconto: "Desconto",
} as const;

const BADGES = {
  ativo: { label: "Valendo", tone: "success" },
  vencendo: { label: "Vencendo", tone: "warning" },
  vencido: { label: "Vencido", tone: "neutral" },
  removido: { label: "Removido", tone: "neutral" },
  sem_responsavel: { label: "Sem responsável", tone: "danger" },
} as const;

const columns: Column[] = [
  { key: "family", label: "Família", primary: true },
  { key: "status", label: "Situação" },
  { key: "gift", label: "Recebe" },
  { key: "cost", label: "Custo" },
  { key: "reason", label: "Motivo" },
  { key: "ends", label: "Validade" },
  { key: "by", label: "Quem concedeu" },
  { key: "actions", label: "Ações" },
];

const pick = <T extends string>(value: string | undefined, options: Record<T, string>, base: T) =>
  value && value in options ? (value as T) : base;

export default async function AdminVipPage({
  searchParams,
}: {
  searchParams: Promise<{ situacao?: string; tipo?: string; custo?: string }>;
}) {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "vip:ver");
  if (!hasAdminDatabase()) {
    return (
      <AdminPage title="VIP">
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      </AdminPage>
    );
  }

  const { situacao, tipo, custo } = await searchParams;
  const status = pick<StatusFilter>(situacao, STATUS, "abertos");
  const kind = pick(tipo, KINDS, "todos");
  const cost = pick(custo, COSTS, "todos");
  const now = new Date();
  const [list, families] = await Promise.all([adminVipList(now), adminBillingFamilies()]);

  const open = list.filter((row) => row.status === "ativo" || row.status === "vencendo");
  const ending = list.filter((row) => row.status === "vencendo");
  const expired = list.filter((row) => row.status === "vencido");
  const shown = list.filter((row) => {
    if (kind !== "todos" && row.grant.scope !== kind) return false;
    if (cost !== "todos" && row.grant.cost !== cost) return false;
    if (status === "todos") return true;
    if (status === "abertos") return row.status === "ativo" || row.status === "vencendo";
    return row.status === status;
  });

  const attention = billingAttention(
    families.map((family) => ({ family, access: adminFamilyAccess(family, now) })),
  );
  const alerts: AdminAlert[] = [
    ...ending.map((row) => ({
      key: `vip:${row.grant.id}`,
      tone: "warning" as const,
      title: `VIP de ${row.familyName} vence em ${formatDate(row.grant.endsAt!)}`,
      text: "Ao vencer, volta ao que tinha antes, sem cobrança. Mude a validade se for continuar.",
      href: `/admin/assinaturas/${row.grant.householdId}`,
    })),
    ...attention.charged.map(({ family }) => ({
      key: `vip:cobrado:${family.householdId}`,
      tone: "danger" as const,
      title: `${family.name} não devia pagar, e a Stripe segue cobrando`,
      text: "Tem cortesia ou VIP sem custo. Cancele para a família não pagar pelo que ganhou.",
      href: `/admin/assinaturas/${family.householdId}`,
    })),
    ...attention.unapplied.map(({ family }) => ({
      key: `vip:nao_aplicado:${family.householdId}`,
      tone: "warning" as const,
      title: `Desconto de ${family.name} concedido e não aplicado`,
      text: "A Stripe ainda cobra outro valor. Aplique o desconto na assinatura.",
      href: `/admin/assinaturas/${family.householdId}`,
    })),
    ...attention.leftover.map(({ family }) => ({
      key: `vip:desconto:${family.householdId}`,
      tone: "warning" as const,
      title: `${family.name} segue com desconto na Stripe, sem VIP valendo`,
      text: "Vencer não aumenta o preço de ninguém. Tirar o desconto é uma ação sua, avisando a família.",
      href: `/admin/assinaturas/${family.householdId}`,
    })),
  ];

  return (
    <AdminPage
      title="VIP"
      description={`Quem recebe acesso sem passar pelo plano. O painel avisa ${VIP_NOTICE_DAYS} dias antes de vencer.`}
    >
      {alerts.length > 0 ? <AlertList alerts={alerts} /> : null}

      <section aria-labelledby="numeros-vip">
        <h2 id="numeros-vip" className="sr-only">
          Números do VIP
        </h2>
        <dl className="m-0 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
          <Tile label="Valendo" value={formatCount(open.length)} icon={Crown} />
          <Tile
            label={`Vencem em ${VIP_NOTICE_DAYS} dias`}
            value={formatCount(ending.length)}
            icon={Clock}
          />
          <Tile label="Vencidos" value={formatCount(expired.length)} icon={TimerOff} />
        </dl>
      </section>

      <Card
        title="Conceder"
        description="Abra uma família ou uma conta e use Marcar como VIP, ou cole o id aqui."
      >
        <form method="get" action="/admin/vip/novo" className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label="Id da família ou da conta">
              <Input name="alvo" required maxLength={64} autoComplete="off" />
            </Field>
          </div>
          <Button type="submit" variant="secondary" small>
            Continuar
          </Button>
        </form>
      </Card>

      <Card title="Concessões" description="Nada é apagado: vencidos e removidos ficam aqui.">
        <form method="get" className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <Field label="Situação">
            <Select name="situacao" defaultValue={status}>
              {Object.entries(STATUS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo">
            <Select name="tipo" defaultValue={kind}>
              {Object.entries(KINDS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Custo">
            <Select name="custo" defaultValue={cost}>
              {Object.entries(COSTS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" small>
            Filtrar
          </Button>
        </form>
        {shown.length === 0 ? (
          <EmptyState title="Nenhum VIP aqui" text="Troque o filtro, ou conceda o primeiro." />
        ) : (
          <AdminTable
            caption="Concessões VIP"
            columns={columns}
            rows={shown.map((row) => {
              const { grant } = row;
              const badge = BADGES[row.status];
              const openGrant = grant.revokedAt === null;
              return {
                id: grant.id,
                cells: {
                  family: (
                    <span className="flex flex-col gap-0.5">
                      <Link
                        href={`/admin/assinaturas/${grant.householdId}`}
                        className="text-brand-700 underline-offset-2 hover:underline"
                      >
                        {row.familyName}
                      </Link>
                      {grant.scope === "pessoa" ? (
                        <span className="text-xs font-normal text-muted">
                          Pessoa:{" "}
                          {grant.userId ? (
                            <Link
                              href={`/admin/usuarios/${grant.userId}`}
                              className="font-mono underline-offset-2 hover:underline"
                            >
                              {shortId(grant.userId)}
                            </Link>
                          ) : (
                            "conta apagada"
                          )}
                        </span>
                      ) : null}
                    </span>
                  ),
                  status: <Badge tone={badge.tone}>{badge.label}</Badge>,
                  gift: vipGiftText(grant),
                  cost: vipCostText(grant),
                  reason: vipReasonLabel(grant.reason),
                  ends: grant.endsAt ? formatDate(grant.endsAt) : "Sem data",
                  by: (
                    <span className="font-mono">
                      {shortId(grant.grantedBy)}
                      <span className="block font-sans text-xs text-muted">
                        {formatDate(grant.createdAt)}
                      </span>
                    </span>
                  ),
                  actions: openGrant ? (
                    <span className="flex flex-wrap gap-2">
                      <ConfirmAction
                        label="Validade"
                        ariaLabel={`Mudar a validade do VIP de ${row.familyName}`}
                        action={changeVipValidity}
                        hidden={{ id: grant.id }}
                        title="Mudar a validade"
                        text="Vazio: vale até alguém remover."
                        confirmLabel="Salvar"
                        fields={
                          <Field label="Válido até">
                            <Input
                              name="endsOn"
                              type="date"
                              defaultValue={grant.endsAt ? dayOf(grant.endsAt) : ""}
                            />
                          </Field>
                        }
                      />
                      <ConfirmAction
                        label="Remover"
                        ariaLabel={`Remover o VIP de ${row.familyName}`}
                        action={revokeVip}
                        hidden={{ id: grant.id }}
                        title="Remover VIP"
                        text={`${row.familyName} volta ao que tinha antes, sem cobrança. O registro fica. Desconto na Stripe não sai daqui: tire em Assinaturas.`}
                        confirmLabel="Remover"
                      />
                    </span>
                  ) : (
                    "—"
                  ),
                },
              };
            })}
          />
        )}
      </Card>
    </AdminPage>
  );
}
