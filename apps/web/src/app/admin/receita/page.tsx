import {
  adminAiCostByFamily,
  adminBillingFamilies,
  adminFamilyAccess,
  adminMonthUsage,
  adminUsdRate,
} from "@organizeup/db";
import {
  revenueSummary,
  todayIn,
  usageLevel,
  type RevenueFamily,
  type RevenueTier,
  type UsageLevel,
} from "@organizeup/domain";
import { AlertTriangle, Banknote, Hourglass, Receipt, UserMinus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, FormMessage } from "@/components/ui";
import { platformFlags, requireAdmin } from "@/lib/session";
import { AdoptionBars } from "../charts";
import { keyNotice } from "../cobranca/estado";
import { formatCount, formatDay } from "../format";
import { AdminPage, AdminTable, Tile, type Column } from "../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../painel";
import { brl, MODULE_LABELS } from "../planos";

export const metadata: Metadata = { title: "Receita e uso" };

const TIER_LABELS: Record<RevenueTier, string> = {
  sem_assistente: "Sem assistente",
  "30": "30 mensagens",
  "100": "100 mensagens",
  "300": "300 mensagens",
  sem_receita: "Sem receita: cortesia, VIP, teste",
};

const tierColumns: Column[] = [
  { key: "tier", label: "Degrau", primary: true },
  { key: "families", label: "Famílias", align: "right" },
  { key: "revenue", label: "Receita por mês", align: "right" },
  { key: "cost", label: "Custo de IA no mês", align: "right" },
  { key: "share", label: "Custo sobre receita", align: "right" },
];

const usageColumns: Column[] = [
  { key: "family", label: "Família", primary: true },
  { key: "entries", label: "Lançamentos", align: "right" },
  { key: "messages", label: "Mensagens", align: "right" },
];

const USAGE_ROWS = 50;

const usageText = (used: number, limit: number | null) =>
  limit === null
    ? `${formatCount(used)}, sem limite`
    : `${formatCount(used)} de ${formatCount(limit)}`;

const LEVEL_RANK: Record<UsageLevel, number> = { normal: 0, aviso: 1, limite: 2 };

export default async function AdminRevenuePage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "receita:ver");
  if (!hasAdminDatabase()) {
    return (
      <AdminPage title="Receita e uso">
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      </AdminPage>
    );
  }

  const today = todayIn();
  const now = new Date();
  const [flags, families, usage, aiCost, usd] = await Promise.all([
    platformFlags(),
    adminBillingFamilies(),
    adminMonthUsage(),
    adminAiCostByFamily(`${today.slice(0, 7)}-01`),
    adminUsdRate(),
  ]);
  const key = keyNotice();
  const states = families.map((family) => ({ family, access: adminFamilyAccess(family, now) }));
  const counts = {
    cortesia: states.filter(({ access }) => access.mode === "cortesia").length,
    vip: states.filter(({ access }) => access.mode === "vip").length,
    leitura: states.filter(({ access }) => access.mode === "leitura").length,
  };

  const rows: RevenueFamily[] = states.map(({ family, access }) => ({
    mode: access.mode,
    subscription: family.subscription,
    aiCostUsd: aiCost.get(family.householdId) ?? "0",
  }));
  const summary = revenueSummary(rows, now, usd?.rate ?? null);

  const usageByFamily = new Map(usage.map((row) => [row.householdId, row]));
  const near = states.flatMap(({ family, access }) => {
    const used = usageByFamily.get(family.householdId);
    if (!used) return [];
    const entries = usageLevel(used.entries, access.entryLimit);
    const messages = usageLevel(used.messages, access.messageLimit);
    return entries === "normal" && messages === "normal"
      ? []
      : [{ family, access, used, entries, messages }];
  });
  near.sort(
    (a, b) =>
      Math.max(LEVEL_RANK[b.entries], LEVEL_RANK[b.messages]) -
      Math.max(LEVEL_RANK[a.entries], LEVEL_RANK[a.messages]),
  );
  const level = (kind: "entries" | "messages", value: UsageLevel) =>
    near.filter((row) => row[kind] === value).length;

  return (
    <AdminPage
      title="Receita e uso"
      description="Só o que as famílias pagam ao serviço e contagens. Nenhum dado financeiro delas."
    >
      {flags.billingEnabled ? (
        <>
          {key.mode === "teste" ? (
            <p className="m-0 rounded-2xl bg-warning-soft p-4 text-sm">
              Chave de teste: os valores abaixo vêm de assinaturas de teste, e não são receita.
            </p>
          ) : null}
          <section aria-labelledby="numeros-receita">
            <h2 id="numeros-receita" className="sr-only">
              Números da receita
            </h2>
            <dl className="m-0 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
              <Tile
                label="Receita mensal recorrente"
                value={brl(summary.mrr)}
                icon={Banknote}
                hint="Anual em doze avos, sem quem está em atraso."
              />
              <Tile label="Assinantes ativos" value={formatCount(summary.active)} icon={Users} />
              <Tile
                label="Ticket médio"
                value={summary.averageTicket ? brl(summary.averageTicket) : "Sem dado"}
                icon={Receipt}
              />
              <Tile label="Em teste" value={formatCount(summary.trial)} icon={Hourglass} />
              <Tile
                label="Em atraso"
                value={formatCount(summary.pastDue)}
                icon={AlertTriangle}
                alarm={summary.pastDue > 0}
                hint={summary.pastDue > 0 ? `${brl(summary.pastDueAmount)} em risco` : undefined}
              />
              <Tile
                label="Cancelamentos em 30 dias"
                value={formatCount(summary.canceled30d)}
                icon={UserMinus}
                hint={
                  summary.cancelling > 0
                    ? `${formatCount(summary.cancelling)} não renovam`
                    : undefined
                }
              />
            </dl>
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card
              title="Conversão do teste"
              description="De quem terminou o teste, quantos pagaram."
            >
              {summary.trialConversion ? (
                <p className="m-0 text-sm">
                  <span className="block text-3xl font-semibold tracking-tight">
                    {summary.trialConversion.percent.replace(".", ",")}%
                  </span>
                  {formatCount(summary.trialConversion.converted)} de{" "}
                  {formatCount(summary.trialConversion.started)} famílias.
                </p>
              ) : (
                <EmptyState title="Sem dado ainda" text="Nenhum teste terminou até agora." />
              )}
            </Card>
            <Card title="Módulos mais assinados" description="Contando a Família completa.">
              {summary.active > 0 ? (
                <AdoptionBars
                  label="Módulos mais assinados"
                  total={summary.active}
                  items={summary.modules.map((row) => ({
                    label: MODULE_LABELS[row.module],
                    families: row.families,
                  }))}
                />
              ) : (
                <EmptyState title="Nenhum assinante ainda" />
              )}
            </Card>
          </div>

          <Card
            title="Custo de IA contra receita"
            description={
              usd
                ? `Custo do mês até hoje, em dólar de ${formatDay(usd.date)}: R$ ${usd.rate.slice(0, 6).replace(".", ",")}.`
                : "Sem cotação do dólar: o custo fica em dólar, e a conta contra a receita não é feita."
            }
          >
            <AdminTable
              caption="Custo de IA contra receita por degrau"
              columns={tierColumns}
              rows={summary.tiers.map((tier) => ({
                id: tier.tier,
                cells: {
                  tier: TIER_LABELS[tier.tier],
                  families: formatCount(tier.families),
                  revenue: brl(tier.revenue),
                  cost: tier.costBrl ? brl(tier.costBrl) : `US$ ${tier.costUsd.replace(".", ",")}`,
                  share: tier.costShare ? `${tier.costShare.replace(".", ",")}%` : "—",
                },
              }))}
            />
          </Card>
        </>
      ) : (
        <Card
          title="Receita"
          description="A cobrança está desligada: ninguém paga nada, e não há receita para mostrar."
        >
          <EmptyState
            title="Sem receita enquanto a cobrança estiver desligada"
            text="Nenhum número aqui é estimado. Os valores aparecem quando a cobrança for ligada e a primeira assinatura entrar."
          />
          <p className="mt-4 text-sm">
            <Link href="/admin/cobranca" className="font-semibold underline underline-offset-2">
              Ver a chave da cobrança
            </Link>
          </p>
        </Card>
      )}

      <Card
        title="Quem está como"
        description="O que vale para cada família com a cobrança ligada. Só contagens."
      >
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          <li>
            <Badge>Cortesia: {formatCount(counts.cortesia)}</Badge>
          </li>
          <li>
            <Badge>VIP: {formatCount(counts.vip)}</Badge>
          </li>
          <li>
            <Badge>Só leitura: {formatCount(counts.leitura)}</Badge>
          </li>
        </ul>
      </Card>

      <Card
        title="Perto do limite"
        description="Aviso a partir de 80% do limite, no mês de cada família."
      >
        {!flags.billingEnabled ? (
          <EmptyState
            title="Sem limite enquanto a cobrança estiver desligada"
            text="Com ela desligada, nenhuma família tem limite de lançamentos ou mensagens."
          />
        ) : near.length === 0 ? (
          <EmptyState title="Ninguém perto do limite" />
        ) : (
          <>
            <ul className="m-0 mb-4 flex list-none flex-wrap gap-2 p-0">
              <li>
                <Badge tone="warning">
                  Lançamentos perto: {formatCount(level("entries", "aviso"))}
                </Badge>
              </li>
              <li>
                <Badge tone="danger">
                  Lançamentos no limite: {formatCount(level("entries", "limite"))}
                </Badge>
              </li>
              <li>
                <Badge tone="warning">
                  Mensagens perto: {formatCount(level("messages", "aviso"))}
                </Badge>
              </li>
              <li>
                <Badge tone="danger">
                  Mensagens no limite: {formatCount(level("messages", "limite"))}
                </Badge>
              </li>
            </ul>
            <AdminTable
              caption="Famílias perto do limite"
              columns={usageColumns}
              rows={near.slice(0, USAGE_ROWS).map(({ family, access, used }) => ({
                id: family.householdId,
                cells: {
                  family: (
                    <Link
                      href={`/admin/assinaturas/${family.householdId}`}
                      className="text-brand-700 underline-offset-2 hover:underline"
                    >
                      {family.name}
                    </Link>
                  ),
                  entries: usageText(used.entries, access.entryLimit),
                  messages: usageText(used.messages, access.messageLimit),
                },
              }))}
            />
          </>
        )}
      </Card>
    </AdminPage>
  );
}
