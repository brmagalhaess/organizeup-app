import { adminBillingFamilies, adminFamilyAccess } from "@organizeup/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, Field, FormMessage, Select } from "@/components/ui";
import { platformFlags, requireAdmin } from "@/lib/session";
import { formatCount, formatDate } from "../format";
import { AdminPage, AdminTable, type Column } from "../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../painel";
import { MODE_BADGES, monthlyText, planText, stripeStatusLabel } from "../planos";

export const metadata: Metadata = { title: "Assinaturas" };

const PAGE_SIZE = 30;

const FILTERS = {
  todas: "Todas",
  assinatura: "Assinantes",
  atraso: "Em atraso",
  teste: "Em teste",
  cortesia: "Cortesia",
  vip: "VIP",
  leitura: "Só leitura",
} as const;
type Filter = keyof typeof FILTERS;

const columns: Column[] = [
  { key: "family", label: "Família", primary: true },
  { key: "mode", label: "Situação" },
  { key: "plan", label: "Plano" },
  { key: "value", label: "Valor por mês", align: "right" },
  { key: "next", label: "Próxima cobrança" },
  { key: "stripe", label: "Na Stripe" },
];

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ situacao?: string; pagina?: string }>;
}) {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "assinaturas:ver");
  if (!hasAdminDatabase()) {
    return (
      <AdminPage title="Assinaturas">
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      </AdminPage>
    );
  }

  const { situacao, pagina } = await searchParams;
  const filter: Filter = situacao && situacao in FILTERS ? (situacao as Filter) : "todas";
  const page = Math.max(Number.parseInt(pagina ?? "0", 10) || 0, 0);
  const now = new Date();
  const [families, flags] = await Promise.all([adminBillingFamilies(), platformFlags()]);
  const shown = families
    .map((family) => ({ family, access: adminFamilyAccess(family, now) }))
    .filter(({ access }) => {
      if (filter === "todas") return true;
      if (filter === "atraso") return access.pastDue;
      return access.mode === filter;
    });
  const slice = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const link = (next: number) => `/admin/assinaturas?situacao=${filter}&pagina=${next}`;

  return (
    <AdminPage
      title="Assinaturas"
      description="Plano e situação de cada família, sem nenhum dado financeiro dela."
    >
      {flags.billingEnabled ? null : (
        <p className="m-0 rounded-2xl bg-card-soft p-4 text-sm">
          A cobrança está desligada: hoje todas as famílias têm acesso livre. A situação abaixo é a
          que vale quando ela for ligada.
        </p>
      )}
      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Situação">
            <Select name="situacao" defaultValue={filter}>
              {Object.entries(FILTERS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" small>
            Filtrar
          </Button>
          <p className="m-0 ml-auto text-sm text-muted">{formatCount(shown.length)} famílias</p>
        </form>
        {slice.length === 0 ? (
          <EmptyState title="Nenhuma família aqui" text="Troque o filtro para ver as outras." />
        ) : (
          <AdminTable
            caption="Assinaturas por família"
            columns={columns}
            rows={slice.map(({ family, access }) => {
              const sub = family.subscription;
              const badge = MODE_BADGES[access.mode];
              const paying = access.mode === "assinatura" && sub !== null;
              return {
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
                  mode: (
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      {access.pastDue ? <Badge tone="danger">Em atraso</Badge> : null}
                    </span>
                  ),
                  plan: planText(sub),
                  value: paying ? monthlyText(sub) : "—",
                  next:
                    paying && sub.currentPeriodEnd && !sub.cancelAtPeriodEnd
                      ? formatDate(sub.currentPeriodEnd)
                      : "—",
                  stripe: stripeStatusLabel(sub?.status ?? null),
                },
              };
            })}
          />
        )}
        {shown.length > PAGE_SIZE ? (
          <nav aria-label="Páginas" className="mt-4 flex justify-between text-sm">
            {page > 0 ? (
              <Link href={link(page - 1)} className="font-semibold underline underline-offset-2">
                Anterior
              </Link>
            ) : (
              <span />
            )}
            {(page + 1) * PAGE_SIZE < shown.length ? (
              <Link href={link(page + 1)} className="font-semibold underline underline-offset-2">
                Próxima
              </Link>
            ) : null}
          </nav>
        ) : null}
      </Card>
    </AdminPage>
  );
}
