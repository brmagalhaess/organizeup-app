import {
  adminAccessList,
  adminBillingFamily,
  adminBillingHistory,
  adminFamilyAccess,
  MAX_TRIAL_DAYS,
} from "@organizeup/db";
import { fromCents, refundWindowOpen, willChargeAgain } from "@organizeup/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, FormMessage, Input } from "@/components/ui";
import { platformFlags, requireAdmin } from "@/lib/session";
import { ConfirmAction } from "../../admin-actions";
import { actionLabel } from "../../auditoria/labels";
import { stripeActions, stripeExitActions } from "../../cobranca/estado";
import { formatDate, formatDateTime } from "../../format";
import { AdminPage, AdminTable, Fact, Facts, type Column } from "../../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../../painel";
import {
  brl,
  CYCLE_LABELS,
  ERROR_LABELS,
  EVENT_LABELS,
  itemLabel,
  MODE_BADGES,
  monthlyText,
  planFacts,
  planText,
  stripeStatusLabel,
  vipCostText,
  vipGiftText,
} from "../../planos";
import {
  applyDiscount,
  cancelSubscription,
  endCourtesy,
  giveCourtesy,
  giveTrialDays,
  refundSubscription,
  removeDiscount,
  retryCharge,
} from "../actions";

export const metadata: Metadata = { title: "Assinatura" };

const historyColumns: Column[] = [
  { key: "at", label: "Quando", primary: true },
  { key: "what", label: "O que houve" },
  { key: "status", label: "Situação" },
  { key: "items", label: "Itens" },
  { key: "paid", label: "Valor", align: "right" },
];

const auditColumns: Column[] = [
  { key: "at", label: "Quando", primary: true },
  { key: "what", label: "O que foi feito" },
];

/** Botão fora do ar, com o motivo logo abaixo. */
function Unavailable({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="secondary" small disabled>
        {label}
      </Button>
      <p className="m-0 text-xs text-muted">{reason}</p>
    </div>
  );
}

export default async function AdminSubscriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  if (!hasAdminDatabase()) {
    return (
      <AdminPage title="Assinatura">
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      </AdminPage>
    );
  }
  const family = await adminBillingFamily(id);
  if (!family) notFound();
  await noteAdminAccess(session.user.id, "assinatura:detalhe", { householdId: id });

  const now = new Date();
  const [flags, history, actions] = await Promise.all([
    platformFlags(),
    adminBillingHistory(id),
    adminAccessList({ target: id, limit: 20 }),
  ]);
  const access = adminFamilyAccess(family, now);
  const sub = family.subscription;
  const vip = family.vip?.grant ?? null;
  const badge = MODE_BADGES[access.mode];
  const stripe = stripeActions(flags.billingEnabled);
  const exit = stripeExitActions();
  const charging = sub !== null && willChargeAgain(sub);
  const canRefund = sub !== null && sub.hasSubscription && refundWindowOpen({ ...sub, now });
  const hidden = { id };
  const discountDue = access.vip?.discountPercent ?? null;
  const facts = sub && sub.items.length > 0 ? planFacts(sub) : null;
  const logged = actions.filter(
    (row) => !row.action.endsWith(":detalhe") && !row.action.endsWith(":ver"),
  );

  return (
    <AdminPage
      title={family.name}
      description={
        <Link href="/admin/assinaturas" className="underline underline-offset-2">
          Voltar para Assinaturas
        </Link>
      }
      actions={<Badge tone={badge.tone}>{badge.label}</Badge>}
    >
      {flags.billingEnabled ? null : (
        <p className="m-0 rounded-2xl bg-card-soft p-4 text-sm">
          A cobrança está desligada: esta família tem acesso livre agora. A situação mostrada é a
          que vale quando ela for ligada.
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Card title="Plano" description="Só o que a família paga ao serviço.">
            <Facts>
              <Fact label="Plano">{planText(sub)}</Fact>
              <Fact label="Módulos">{facts?.modules ?? "Nenhum"}</Fact>
              <Fact label="Lançamentos">{facts?.entries ?? "—"}</Fact>
              <Fact label="Mensagens">{facts?.messages ?? "—"}</Fact>
              <Fact label="Moedas adicionais">{facts?.currencies ?? "—"}</Fact>
              <Fact label="Ciclo">{sub?.cycle ? CYCLE_LABELS[sub.cycle] : "—"}</Fact>
              <Fact label="Valor por mês">
                {sub && sub.items.length > 0 ? monthlyText(sub) : "—"}
              </Fact>
              <Fact label="Próxima cobrança">
                {sub?.currentPeriodEnd && !sub.cancelAtPeriodEnd
                  ? formatDate(sub.currentPeriodEnd)
                  : "—"}
              </Fact>
              <Fact label="Situação na Stripe">{stripeStatusLabel(sub?.status ?? null)}</Fact>
              {sub?.cancelAtPeriodEnd && sub.currentPeriodEnd ? (
                <Fact label="Cancelada, vale até">{formatDate(sub.currentPeriodEnd)}</Fact>
              ) : null}
              {sub?.scheduledAt ? (
                <Fact label="Troca marcada para">{formatDate(sub.scheduledAt)}</Fact>
              ) : null}
              {sub?.discountPercent ? (
                <Fact label="Desconto na Stripe">{sub.discountPercent}%</Fact>
              ) : null}
              {sub?.trialEndsAt ? (
                <Fact label="Teste até">{formatDate(sub.trialEndsAt)}</Fact>
              ) : null}
              {sub?.courtesy ? (
                <Fact label="Cortesia até">
                  {sub.courtesyUntil ? formatDate(sub.courtesyUntil) : "Sem data"}
                </Fact>
              ) : null}
              {sub?.paymentFailedAt ? (
                <Fact label="Cobrança falhou em">{formatDateTime(sub.paymentFailedAt)}</Fact>
              ) : null}
              {sub?.firstPaidAt ? (
                <Fact label="Primeira cobrança">{formatDate(sub.firstPaidAt)}</Fact>
              ) : null}
              {sub?.refundedAt ? (
                <Fact label="Devolvida em">{formatDate(sub.refundedAt)}</Fact>
              ) : null}
            </Facts>
          </Card>

          {vip ? (
            <Card
              title="VIP"
              actions={
                <Link
                  href="/admin/vip"
                  className="text-sm font-semibold text-brand-700 underline underline-offset-2"
                >
                  Ver lista
                </Link>
              }
            >
              <Facts>
                <Fact label="Recebe">{vipGiftText(vip)}</Fact>
                <Fact label="Custo">{vipCostText(vip)}</Fact>
                <Fact label="Válido até">{vip.endsAt ? formatDate(vip.endsAt) : "Sem data"}</Fact>
              </Facts>
            </Card>
          ) : null}

          <Card
            title="Histórico de trocas"
            description="Eventos da Stripe, sem dado de quem pagou."
          >
            {history.length === 0 ? (
              <EmptyState
                title="Nenhuma troca"
                text="Quando a família assinar, as mudanças aparecem aqui."
              />
            ) : (
              <AdminTable
                caption="Histórico de trocas"
                columns={historyColumns}
                rows={history.map((event) => ({
                  id: event.key,
                  cells: {
                    at: formatDateTime(event.at),
                    what: (
                      <>
                        {EVENT_LABELS[event.type] ?? event.type}
                        {event.errorCode ? (
                          <span className="ml-2 text-danger">
                            {ERROR_LABELS[event.errorCode] ?? event.errorCode}
                          </span>
                        ) : null}
                      </>
                    ),
                    status: event.status ? stripeStatusLabel(event.status) : "—",
                    items: event.items.map(itemLabel).join(", ") || "—",
                    paid:
                      event.amountPaidCents === null ? "—" : brl(fromCents(event.amountPaidCents)),
                  },
                }))}
              />
            )}
          </Card>

          <Card title="Ações do painel" description="O que o painel fez nesta família.">
            {logged.length === 0 ? (
              <EmptyState title="Nenhuma ação ainda" />
            ) : (
              <AdminTable
                caption="Ações do painel nesta família"
                columns={auditColumns}
                rows={logged.map((row) => ({
                  id: String(row.id),
                  cells: { at: formatDateTime(row.at), what: actionLabel(row.action) },
                }))}
              />
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Sem Stripe" description="Valem na hora. Tudo fica na auditoria.">
            <div className="flex flex-col gap-3">
              <ConfirmAction
                label="Conceder dias de teste"
                action={giveTrialDays}
                hidden={hidden}
                title="Conceder dias de teste"
                text={`Soma dias ao teste de ${family.name}, com tudo liberado. Ninguém é cobrado quando o teste acaba.`}
                confirmLabel="Conceder"
                fields={
                  <Field label="Dias" hint={`De 1 a ${MAX_TRIAL_DAYS}.`}>
                    <Input
                      name="days"
                      type="number"
                      min={1}
                      max={MAX_TRIAL_DAYS}
                      defaultValue={7}
                      required
                    />
                  </Field>
                }
              />
              {sub?.courtesy ? (
                <ConfirmAction
                  label="Encerrar cortesia"
                  action={endCourtesy}
                  hidden={hidden}
                  title="Encerrar cortesia"
                  text={`${family.name} perde a cortesia agora. Sem teste nem assinatura, fica só leitura, com tudo guardado. Ninguém é cobrado.`}
                  confirmLabel="Encerrar"
                />
              ) : charging ? (
                <Unavailable
                  label="Dar cortesia"
                  reason="A Stripe segue cobrando esta família. Cancele antes para ela não pagar pelo que ganhou."
                />
              ) : (
                <ConfirmAction
                  label="Dar cortesia"
                  action={giveCourtesy}
                  hidden={hidden}
                  title="Dar cortesia"
                  text={`${family.name} fica com tudo liberado, sem Stripe. Ao acabar, volta ao que era, sem nenhuma cobrança.`}
                  confirmLabel="Dar cortesia"
                  fields={
                    <Field label="Até (opcional)" hint="Vazio: até alguém encerrar.">
                      <Input name="until" type="date" />
                    </Field>
                  }
                />
              )}
              <Link
                href={`/admin/vip/novo?familia=${id}`}
                className="text-sm font-semibold text-brand-700 underline underline-offset-2"
              >
                Marcar como VIP
              </Link>
            </div>
          </Card>

          <Card title="Na Stripe" description="Pedem confirmação e ficam na auditoria.">
            {!sub?.hasSubscription ? (
              <p className="m-0 text-sm text-muted">Esta família não tem assinatura na Stripe.</p>
            ) : !exit.available ? (
              <div className="flex flex-col gap-3">
                <p className="m-0 text-sm text-muted">{exit.reason}</p>
                {["Cancelar assinatura", "Devolver", "Reenviar cobrança"].map((label) => (
                  <Button key={label} type="button" variant="secondary" small disabled>
                    {label}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {charging ? (
                  <ConfirmAction
                    label="Cancelar assinatura"
                    action={cancelSubscription}
                    hidden={hidden}
                    title="Cancelar assinatura"
                    text="Vale até o fim do período pago. Depois disso a família fica só leitura, se não tiver outro acesso."
                    confirmLabel="Cancelar assinatura"
                  />
                ) : null}
                {canRefund ? (
                  <ConfirmAction
                    label="Devolver"
                    variant="danger"
                    action={refundSubscription}
                    hidden={hidden}
                    title="Devolver e encerrar"
                    text="Dentro dos 7 dias da primeira cobrança. Encerra na hora e devolve tudo o que foi cobrado. Boleto a Stripe não devolve: nada muda, e o suporte faz por transferência."
                    confirmLabel="Devolver"
                    typeToConfirm={{ label: "Digite DEVOLVER para confirmar", value: "DEVOLVER" }}
                  />
                ) : (
                  <Unavailable
                    label="Devolver"
                    reason="Só nos 7 dias da primeira cobrança, uma vez."
                  />
                )}
                {!stripe.available ? (
                  <Unavailable label="Reenviar cobrança" reason={stripe.reason ?? ""} />
                ) : sub.status === "past_due" ? (
                  <ConfirmAction
                    label="Reenviar cobrança"
                    action={retryCharge}
                    hidden={hidden}
                    title="Reenviar cobrança"
                    text="Tenta de novo a fatura em aberto, no cartão da família."
                    confirmLabel="Reenviar"
                  />
                ) : (
                  <Unavailable label="Reenviar cobrança" reason="Só com a assinatura em atraso." />
                )}
                {stripe.available && discountDue && discountDue !== sub.discountPercent ? (
                  <ConfirmAction
                    label={`Aplicar desconto de ${discountDue}%`}
                    action={applyDiscount}
                    hidden={hidden}
                    title="Aplicar desconto"
                    text="Vale a partir da próxima cobrança, sem cobrança proporcional."
                    confirmLabel="Aplicar"
                  />
                ) : null}
                {stripe.available && sub.discountPercent ? (
                  <ConfirmAction
                    label="Tirar desconto"
                    action={removeDiscount}
                    hidden={hidden}
                    title="Tirar desconto"
                    text="A próxima cobrança volta ao preço cheio. Avise a família antes: o preço só sobe por esta ação."
                    confirmLabel="Tirar desconto"
                  />
                ) : null}
              </div>
            )}
          </Card>
        </div>
      </div>
    </AdminPage>
  );
}
