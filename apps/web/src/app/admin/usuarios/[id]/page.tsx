import { adminUserDetail } from "@organizeup/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, FormMessage } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { ConfirmAction } from "../../admin-actions";
import { formatDate, formatDateTime, roleLabel, shortId } from "../../format";
import { AdminPage, Fact, Facts } from "../../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../../painel";
import { blockUser, deleteUser, endUserSessions, sendPasswordReset, unblockUser } from "../actions";
import { UserContact } from "./user-contact";

export const metadata: Metadata = { title: "Usuário" };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  const { id } = await params;
  if (!hasAdminDatabase()) {
    return (
      <AdminPage title="Usuário">
        <Card>
          <FormMessage message={ADMIN_DB_MISSING} />
        </Card>
      </AdminPage>
    );
  }
  const account = await adminUserDetail(id);
  if (!account) notFound();
  await noteAdminAccess(session.user.id, "usuario:detalhe", { userId: id });

  const blocked = account.blockedAt !== null;
  const self = account.id === session.user.id;
  const hidden = { id: account.id };

  return (
    <AdminPage
      title={`Conta ${shortId(account.id)}`}
      description={
        <Link href="/admin/usuarios" className="underline underline-offset-2">
          Voltar para Usuários
        </Link>
      }
      actions={
        blocked ? <Badge tone="danger">Bloqueada</Badge> : <Badge tone="success">Liberada</Badge>
      }
    >
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Card title="Resumo">
            <Facts>
              <Fact label="Criada em">{formatDate(account.createdAt)}</Fact>
              <Fact label="Último acesso">
                {account.lastAccessAt ? formatDateTime(account.lastAccessAt) : "Sem sessão"}
              </Fact>
              <Fact label="Sessões abertas">{account.activeSessions}</Fact>
              <Fact label="E-mail">
                <Badge tone={account.emailVerified ? "success" : "warning"}>
                  {account.emailVerified ? "Verificado" : "Não verificado"}
                </Badge>
              </Fact>
              {account.blockedAt ? (
                <Fact label="Bloqueada em">{formatDateTime(account.blockedAt)}</Fact>
              ) : null}
            </Facts>
            {account.canReveal ? (
              <div className="mt-5">
                <UserContact id={account.id} />
              </div>
            ) : null}
          </Card>

          <Card title="Famílias">
            {account.families.length === 0 ? (
              <EmptyState
                title="Sem família"
                text="Esta conta ainda não criou nem entrou em uma família."
              />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {account.families.map((family) => (
                  <li
                    key={family.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card-soft px-3 py-2.5 text-sm"
                  >
                    <Link
                      href={`/admin/familias/${family.id}`}
                      className="min-w-0 break-words font-medium text-brand-700 underline-offset-2 hover:underline"
                    >
                      {family.name}
                    </Link>
                    <span className="flex items-center gap-2 text-muted">
                      {roleLabel(family.role)}
                      {family.suspendedAt ? <Badge tone="danger">Suspensa</Badge> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Ações" description="Tudo fica na auditoria.">
          {self ? (
            <p className="text-sm text-muted">
              Esta é a sua conta. Encerrar, bloquear e excluir não valem para ela.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <ConfirmAction
                label="Enviar redefinição de senha"
                action={sendPasswordReset}
                hidden={hidden}
                title="Enviar redefinição de senha"
                text="A pessoa recebe por e-mail um link para criar uma senha nova. A senha atual continua valendo até ela trocar."
                confirmLabel="Enviar"
              />
              <ConfirmAction
                label="Encerrar sessões"
                action={endUserSessions}
                hidden={hidden}
                title="Encerrar sessões"
                text="A pessoa sai de todos os aparelhos e precisa entrar de novo."
                confirmLabel="Encerrar sessões"
              />
              {blocked ? (
                <ConfirmAction
                  label="Desbloquear conta"
                  action={unblockUser}
                  hidden={hidden}
                  title="Desbloquear conta"
                  text="A pessoa volta a conseguir entrar."
                  confirmLabel="Desbloquear"
                />
              ) : (
                <ConfirmAction
                  label="Bloquear conta"
                  action={blockUser}
                  hidden={hidden}
                  title="Bloquear conta"
                  text="A pessoa sai agora e não consegue entrar até ser desbloqueada. Os dados continuam guardados."
                  confirmLabel="Bloquear"
                />
              )}
              <ConfirmAction
                label="Excluir conta"
                variant="danger"
                action={deleteUser}
                hidden={hidden}
                title="Excluir conta"
                text="Apaga a conta para sempre e, junto, as famílias em que ela é a única pessoa. Não dá para desfazer."
                confirmLabel="Excluir para sempre"
                typeToConfirm={{ label: "Digite EXCLUIR para confirmar", value: "EXCLUIR" }}
              />
            </div>
          )}
        </Card>
      </div>
    </AdminPage>
  );
}
