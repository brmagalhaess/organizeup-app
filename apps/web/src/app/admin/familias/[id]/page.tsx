import {
  adminHouseholdAssistant,
  adminHouseholdDetail,
  householdAccountType,
} from "@organizeup/db";
import { todayIn } from "@organizeup/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, FormMessage } from "@/components/ui";
import { ONBOARDING_VERSION } from "@/lib/onboarding";
import { requireAdmin } from "@/lib/session";
import { ConfirmAction } from "../../admin-actions";
import { formatCount, formatDate, formatDateTime, roleLabel, shortId } from "../../format";
import { AdminPage, AdminTable, Fact, Facts, type Column } from "../../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../../painel";
import { deleteFamily, reactivateFamily, suspendFamily } from "../actions";
import { FamilyProduct } from "./family-product";
import { OwnerContact } from "./owner-contact";

export const metadata: Metadata = { title: "Família" };

const AUTONOMY: Record<string, string> = {
  sugerir: "Sugerir",
  organizar: "Organizar",
  completo: "Completo",
};

const memberColumns: Column[] = [
  { key: "account", label: "Conta", primary: true },
  { key: "role", label: "Papel" },
  { key: "joinedAt", label: "Entrou em" },
  { key: "lastAccess", label: "Último acesso" },
  { key: "status", label: "Situação" },
];

export default async function AdminFamilyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  const { id } = await params;
  if (!hasAdminDatabase()) {
    return (
      <AdminPage title="Família">
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      </AdminPage>
    );
  }
  const family = await adminHouseholdDetail(id);
  if (!family) notFound();
  await noteAdminAccess(session.user.id, "familia:detalhe", { householdId: id });
  const [assistant, accountType] = await Promise.all([
    adminHouseholdAssistant(id, todayIn()),
    householdAccountType(id),
  ]);

  const suspended = family.suspendedAt !== null;
  const hidden = { id: family.id };
  const onboardingDone = family.onboardingVersion >= ONBOARDING_VERSION;

  return (
    <AdminPage
      title={family.name}
      description={
        <Link href="/admin/familias" className="underline underline-offset-2">
          Voltar para Famílias
        </Link>
      }
      actions={
        suspended ? <Badge tone="danger">Suspensa</Badge> : <Badge tone="success">Em uso</Badge>
      }
    >
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Card title="Resumo">
            <Facts>
              <Fact label="Tipo de conta">
                {accountType === "pj" ? "Empresa, PJ" : "Família, PF"}
              </Fact>
              <Fact label="Criada em">{formatDate(family.createdAt)}</Fact>
              <Fact label="Última atividade">
                {family.lastActivityAt ? formatDateTime(family.lastActivityAt) : "Nunca"}
              </Fact>
              <Fact label="Convites pendentes">{family.pendingInvites}</Fact>
              <Fact label="Cadastro complementar">
                <Badge tone={onboardingDone ? "success" : "warning"}>
                  {onboardingDone ? "Completo" : "Pendente"}
                </Badge>
              </Fact>
              {family.onboardingCompletedAt ? (
                <Fact label="Completou em">{formatDate(family.onboardingCompletedAt)}</Fact>
              ) : null}
              {family.suspendedAt ? (
                <Fact label="Suspensa em">{formatDateTime(family.suspendedAt)}</Fact>
              ) : null}
            </Facts>
          </Card>

          <Card
            title="Membros"
            description="Papel e datas. Nome e e-mail só do responsável, quando você pedir."
          >
            <AdminTable
              caption="Membros da família"
              columns={memberColumns}
              rows={family.members.map((member) => ({
                id: member.userId,
                cells: {
                  account: (
                    <Link
                      href={`/admin/usuarios/${member.userId}`}
                      className="font-mono text-brand-700 underline-offset-2 hover:underline"
                    >
                      {shortId(member.userId)}
                    </Link>
                  ),
                  role: roleLabel(member.role),
                  joinedAt: formatDate(member.joinedAt),
                  lastAccess: member.lastAccessAt ? formatDateTime(member.lastAccessAt) : "Nunca",
                  status: member.blockedAt ? (
                    <Badge tone="danger">Bloqueada</Badge>
                  ) : (
                    <Badge tone="success">Liberada</Badge>
                  ),
                },
              }))}
            />
            <div className="mt-4">
              <OwnerContact id={family.id} family={family.name} />
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Assistente com IA" description="Só datas e contagens, sem nenhum texto.">
            {assistant ? (
              <dl className="m-0 flex flex-col gap-3 text-sm">
                <Fact label="Assistente">
                  <Badge tone={assistant.consentAt ? "success" : "neutral"}>
                    {assistant.consentAt ? "Ligado" : "Desligado"}
                  </Badge>
                </Fact>
                {assistant.consentAt ? (
                  <>
                    <Fact label="Aceitou em">{formatDate(assistant.consentAt)}</Fact>
                    <Fact label="Nível de autonomia">
                      {AUTONOMY[assistant.autonomy] ?? assistant.autonomy}
                    </Fact>
                  </>
                ) : null}
                <Fact label="Dicas ativas">{formatCount(assistant.activeInsights)}</Fact>
                <Fact label="Memórias">{formatCount(assistant.memories)}</Fact>
                <Fact label="Uso de IA no mês">{formatCount(assistant.monthTokens)} tokens</Fact>
              </dl>
            ) : (
              <p className="m-0 text-sm text-muted">Disponível depois da próxima atualização.</p>
            )}
          </Card>

          <FamilyProduct id={family.id} />

          <Card title="Ações" description="Tudo fica na auditoria.">
            <div className="flex flex-col gap-3">
              <Link
                href={`/admin/vip/novo?familia=${family.id}`}
                className="text-sm font-semibold text-brand-700 underline underline-offset-2"
              >
                Marcar como VIP
              </Link>
              {suspended ? (
                <ConfirmAction
                  label="Reativar família"
                  action={reactivateFamily}
                  hidden={hidden}
                  title="Reativar família"
                  text={`Os membros de ${family.name} voltam a entrar normalmente.`}
                  confirmLabel="Reativar"
                />
              ) : (
                <ConfirmAction
                  label="Suspender família"
                  action={suspendFamily}
                  hidden={hidden}
                  title="Suspender família"
                  text={`Os membros de ${family.name} saem agora e, ao entrar, verão que o acesso está suspenso. Os dados continuam guardados e dá para reativar depois.`}
                  confirmLabel="Suspender"
                />
              )}
              <ConfirmAction
                label="Excluir família"
                variant="danger"
                action={deleteFamily}
                hidden={hidden}
                title="Excluir família"
                text={`Apaga para sempre ${family.name} e tudo o que ela guarda. Não dá para desfazer. As contas dos membros continuam existindo.`}
                confirmLabel="Excluir para sempre"
                typeToConfirm={{
                  label: `Digite ${family.name} para confirmar`,
                  value: family.name,
                }}
              />
            </div>
          </Card>
        </div>
      </div>
    </AdminPage>
  );
}
