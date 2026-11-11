import { BankFeedSwitch, SmartImportSwitch } from "./importador";
import {
  adminBillingFamilies,
  adminBillingHealth,
  adminBillingSummary,
  adminCatalog,
  adminFamilyAccess,
} from "@organizeup/db";
import { AlertTriangle, CircleCheck, CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import { Badge, Button, Card, EmptyState, FormMessage } from "@/components/ui";
import { platformFlags, requireAdmin } from "@/lib/session";
import { ConfirmAction } from "../admin-actions";
import { formatCount, formatDateTime } from "../format";
import { AdminPage, AdminTable, Fact, Facts, type Column } from "../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../painel";
import { ERROR_LABELS, EVENT_LABELS } from "../planos";
import { disableBilling, enableBilling } from "./actions";
import { liveSubscriptions } from "./atencao";
import {
  BILLING_CONFIRM,
  BILLING_OFF_CONFIRM,
  enableRefusal,
  keyNotice,
  webhookConfigured,
} from "./estado";

export const metadata: Metadata = { title: "Chave da cobrança" };

/** Seção 7 da especificação: o que precisa estar pronto antes de cobrar de verdade. */
const BEFORE_CHARGING = [
  "CNPJ, CNAE e regime definidos com o contador.",
  "Emissão de NFS-e para as faturas pagas na Stripe.",
  "Termos com cobrança, renovação, cancelamento e devolução, revisados por advogado, incluindo a pergunta sobre sugestões de investimento por IA e a CVM.",
  "Resposta por escrito da Stripe sobre parcelamento, Pix e cobrança em dólar e euro.",
];

const errorColumns: Column[] = [
  { key: "code", label: "Erro", primary: true },
  { key: "count", label: "Vezes", align: "right" },
  { key: "last", label: "Última vez" },
];

function Step({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  const Icon = ok === null ? CircleDashed : ok ? CircleCheck : AlertTriangle;
  const tone = ok === null ? "text-muted" : ok ? "text-success" : "text-danger";
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

export default async function AdminBillingKeyPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "cobranca:ver");
  if (!hasAdminDatabase()) {
    return (
      <AdminPage title="Chave da cobrança">
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      </AdminPage>
    );
  }

  const [flags, health, summary, catalog, families] = await Promise.all([
    platformFlags(),
    adminBillingHealth(),
    adminBillingSummary(),
    adminCatalog(),
    adminBillingFamilies(),
  ]);
  const now = new Date();
  const live = liveSubscriptions(
    families.map((family) => ({ family, access: adminFamilyAccess(family, now) })),
  );
  const refusal = enableRefusal();
  const key = keyNotice();
  const webhook = webhookConfigured();
  const onSale = catalog.filter((row) => row.onSale);
  const priced = onSale.filter((row) => row.hasStripePrice).length;

  const checklist = (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm font-semibold">Antes de ligar</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        <Step ok={key.mode === "teste" || key.real}>Chave da Stripe: {key.label}.</Step>
        <Step ok={webhook}>Segredo do webhook {webhook ? "configurado" : "faltando"}.</Step>
        <Step ok={priced === onSale.length}>
          {formatCount(priced)} de {formatCount(onSale.length)} preços à venda criados na Stripe.
        </Step>
        {BEFORE_CHARGING.map((item) => (
          <Step key={item} ok={null}>
            {item}
          </Step>
        ))}
      </ul>
      <p className="m-0 rounded-xl bg-warning-soft p-3 text-sm" role="note">
        A Política de Privacidade e os Termos ainda não citam a Stripe nem a cobrança. Isso precisa
        mudar, com o advogado, antes de ligar.
      </p>
      {key.real ? (
        <p className="m-0 rounded-xl bg-danger-soft p-3 text-sm font-semibold" role="note">
          {key.text}
        </p>
      ) : null}
    </div>
  );

  return (
    <AdminPage
      title="Chave da cobrança"
      description="Liga a cobrança para todas as famílias. Mudar fica na auditoria."
    >
      {key.real ? (
        <p
          role="alert"
          className="m-0 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm font-semibold"
        >
          {key.text}
        </p>
      ) : null}

      <SmartImportSwitch enabled={flags.smartImportEnabled} />
      <BankFeedSwitch enabled={flags.bankFeedEnabled} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="billing_enabled"
          description="Desligada, todos têm acesso como hoje, e nada é cobrado."
          actions={
            flags.billingEnabled ? (
              <Badge tone="warning">Ligada</Badge>
            ) : (
              <Badge tone="success">Desligada</Badge>
            )
          }
        >
          <div className="flex flex-col gap-3">
            {flags.billingEnabled ? (
              <>
                {live > 0 ? (
                  <p
                    role="alert"
                    className="m-0 rounded-xl bg-danger-soft p-3 text-sm font-semibold"
                  >
                    {live === 1
                      ? "1 assinatura segue cobrando na Stripe."
                      : `${formatCount(live)} assinaturas seguem cobrando na Stripe.`}{" "}
                    Desligar não cancela nenhuma: elas continuam pagando, e só podem cancelar ou
                    pedir a devolução.
                  </p>
                ) : null}
                <ConfirmAction
                  label="Desligar cobrança"
                  variant={live > 0 ? "danger" : "secondary"}
                  action={disableBilling}
                  hidden={{}}
                  title="Desligar a cobrança"
                  text={
                    live > 0
                      ? `Todas as famílias voltam ao acesso livre, mas ${formatCount(live)} seguem pagando na Stripe. Nada é cancelado por aqui.`
                      : "Todas as famílias voltam ao acesso livre. Nada é cancelado."
                  }
                  confirmLabel="Desligar"
                  {...(live > 0
                    ? {
                        typeToConfirm: {
                          label: `Digite ${BILLING_OFF_CONFIRM} para confirmar`,
                          value: BILLING_OFF_CONFIRM,
                        },
                      }
                    : {})}
                />
              </>
            ) : refusal ? (
              <>
                <Button type="button" variant="secondary" small disabled>
                  Ligar cobrança
                </Button>
                <p className="m-0 text-sm text-muted">{refusal}</p>
              </>
            ) : (
              <ConfirmAction
                label="Ligar cobrança"
                variant="danger"
                action={enableBilling}
                hidden={{}}
                title="Ligar a cobrança"
                text="Famílias novas passam a começar com 7 dias de teste, e quem terminar o teste sem assinar fica só leitura. Quem já tem cortesia continua com ela."
                confirmLabel="Ligar cobrança"
                typeToConfirm={{
                  label: `Digite ${BILLING_CONFIRM} para confirmar`,
                  value: BILLING_CONFIRM,
                }}
                fields={checklist}
              />
            )}
          </div>
        </Card>

        <Card
          title="Stripe"
          description="O valor da chave nunca aparece aqui."
          actions={<Badge tone={key.tone}>{key.label}</Badge>}
        >
          <Facts>
            <Fact label="Chave">{key.text}</Fact>
            <Fact label="Webhook">
              <Badge tone={webhook ? "success" : "warning"}>
                {webhook ? "Configurado" : "Falta STRIPE_WEBHOOK_SECRET"}
              </Badge>
            </Fact>
            <Fact label="Último evento">
              {health.lastReceivedAt ? formatDateTime(health.lastReceivedAt) : "Nenhum ainda"}
            </Fact>
            {health.lastType ? (
              <Fact label="Tipo do último">
                {EVENT_LABELS[health.lastType] ?? health.lastType}
                {health.lastLive === false ? " (teste)" : ""}
              </Fact>
            ) : null}
            <Fact label="Na fila">{formatCount(health.pending)}</Fact>
            <Fact label="Assinaturas duplicadas">
              <Badge tone={summary.events.duplicates > 0 ? "danger" : "success"}>
                {formatCount(summary.events.duplicates)}
              </Badge>
            </Fact>
          </Facts>
        </Card>
      </div>

      <Card
        title="Antes de cobrar de verdade"
        description="Seção 7 da especificação. O painel não confere estes itens: quem confere é você."
      >
        {checklist}
      </Card>

      <Card
        title="Erros de cobrança"
        description="Eventos que não entraram. Só o código, sem dado de quem pagou."
      >
        {health.errors.length === 0 ? (
          <EmptyState title="Nenhum erro" text="Quando um evento da Stripe falhar, aparece aqui." />
        ) : (
          <AdminTable
            caption="Erros de cobrança"
            columns={errorColumns}
            rows={health.errors.map((error) => ({
              id: error.code,
              cells: {
                code: (
                  <>
                    {ERROR_LABELS[error.code] ?? error.code}
                    <span className="ml-2 font-mono text-xs text-muted">{error.code}</span>
                  </>
                ),
                count: formatCount(error.count),
                last: error.lastAt ? formatDateTime(error.lastAt) : "—",
              },
            }))}
          />
        )}
      </Card>
    </AdminPage>
  );
}
