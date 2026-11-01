import { monthSpend } from "@organizeup/ai";
import type { PlatformNotice } from "@organizeup/db";
import type { Metadata } from "next";
import { Badge, Card, EmptyState, Field, FormMessage, Input } from "@/components/ui";
import { platformFlags, requireAdmin } from "@/lib/session";
import { ConfirmAction } from "../admin-actions";
import { formatDateTime, formatUsd } from "../format";
import { AdminPage } from "../kit";
import { ADMIN_DB_MISSING, hasAdminDatabase, noteAdminAccess } from "../painel";
import { removeNotice, setAssistant, setMaintenance, setSignup } from "./actions";
import { NoticeForm } from "./notice-form";

export const metadata: Metadata = { title: "Controles" };

function noticeState(notice: PlatformNotice) {
  const now = Date.now();
  if (notice.endsAt && new Date(notice.endsAt).getTime() <= now) {
    return <Badge>Encerrado</Badge>;
  }
  if (notice.startsAt && new Date(notice.startsAt).getTime() > now) {
    return <Badge tone="warning">Agendado</Badge>;
  }
  return <Badge tone="success">No ar</Badge>;
}

const moment = (iso: string | null, empty: string) => (iso ? formatDateTime(new Date(iso)) : empty);

export default async function AdminControlsPage() {
  const session = await requireAdmin();
  await noteAdminAccess(session.user.id, "controles:ver");
  const [flags, spend] = await Promise.all([platformFlags(), monthSpend()]);

  return (
    <AdminPage
      title="Controles"
      description="Valem para todas as famílias assim que você salvar. Tudo fica na auditoria."
    >
      {hasAdminDatabase() ? null : <FormMessage message={ADMIN_DB_MISSING} />}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Modo manutenção"
          description="As famílias veem um aviso e ficam só leitura. Os agentes do worker param."
          actions={
            flags.maintenance ? (
              <Badge tone="warning">Ligado</Badge>
            ) : (
              <Badge tone="success">Desligado</Badge>
            )
          }
        >
          <div className="flex">
            {flags.maintenance ? (
              <ConfirmAction
                label="Desligar manutenção"
                action={setMaintenance}
                hidden={{ enabled: "false" }}
                title="Desligar o modo manutenção"
                text="As famílias voltam a alterar os dados na próxima tela que abrirem."
                confirmLabel="Desligar"
              />
            ) : (
              <ConfirmAction
                label="Ligar manutenção"
                action={setMaintenance}
                hidden={{ enabled: "true" }}
                title="Ligar o modo manutenção"
                text="Ninguém consegue alterar nada até você desligar: nem lançamentos, nem novas famílias, nem novos cadastros."
                confirmLabel="Ligar"
                fields={
                  <Field label="Mensagem (opcional)" hint="Vazio: usa o texto padrão.">
                    <Input name="message" maxLength={200} autoComplete="off" />
                  </Field>
                }
              />
            )}
          </div>
        </Card>

        <Card
          title="Cadastro"
          description="Fechado, só entra quem recebeu convite de uma família. Quem já tem conta continua entrando."
          actions={
            flags.signupClosed ? (
              <Badge tone="warning">Fechado</Badge>
            ) : (
              <Badge tone="success">Aberto</Badge>
            )
          }
        >
          <div className="flex">
            {flags.signupClosed ? (
              <ConfirmAction
                label="Abrir cadastro"
                action={setSignup}
                hidden={{ enabled: "true" }}
                title="Abrir o cadastro"
                text="Qualquer pessoa volta a conseguir criar conta."
                confirmLabel="Abrir"
              />
            ) : (
              <ConfirmAction
                label="Fechar cadastro"
                action={setSignup}
                hidden={{ enabled: "false" }}
                title="Fechar o cadastro"
                text="A tela de cadastro passa a dizer que está fechado. Convidados ainda conseguem entrar."
                confirmLabel="Fechar"
              />
            )}
          </div>
        </Card>

        <Card
          title="Assistente com IA"
          description="Desligado, nenhuma família fala com o modelo. Ao bater o teto do mês, ele para sozinho."
          actions={
            !flags.aiEnabled ? (
              <Badge tone="warning">Desligado</Badge>
            ) : spend.reached ? (
              <Badge tone="danger">Teto atingido</Badge>
            ) : (
              <Badge tone="success">Ligado</Badge>
            )
          }
        >
          <p className="mb-3 text-sm text-muted">
            Gasto do mês: {formatUsd(spend.spentUsd)} de {formatUsd(spend.budgetUsd)}.
          </p>
          <div className="flex">
            {flags.aiEnabled ? (
              <ConfirmAction
                label="Desligar assistente"
                action={setAssistant}
                hidden={{ enabled: "false" }}
                title="Desligar o assistente"
                text="As famílias veem que ele está desligado por enquanto. O resto do sistema segue igual."
                confirmLabel="Desligar"
              />
            ) : (
              <ConfirmAction
                label="Ligar assistente"
                action={setAssistant}
                hidden={{ enabled: "true" }}
                title="Ligar o assistente"
                text="Volta para as famílias que autorizaram, enquanto o teto do mês não for atingido."
                confirmLabel="Ligar"
              />
            )}
          </div>
        </Card>
      </div>

      <Card title="Avisos" description="Faixa no topo do app para todos os usuários.">
        <div className="grid gap-6 xl:grid-cols-2">
          <NoticeForm />
          {flags.notices.length === 0 ? (
            <EmptyState title="Nenhum aviso" text="Os avisos publicados aparecem aqui." />
          ) : (
            <ul aria-label="Avisos publicados" className="m-0 flex list-none flex-col gap-2 p-0">
              {flags.notices.map((notice) => (
                <li
                  key={notice.id}
                  className="flex flex-col gap-2 rounded-xl border border-line bg-card-soft p-3 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="m-0 min-w-0 break-words">{notice.text}</p>
                    {noticeState(notice)}
                  </div>
                  <p className="m-0 text-xs text-muted">
                    De {moment(notice.startsAt, "agora")} até{" "}
                    {moment(notice.endsAt, "ser removido")}
                  </p>
                  <div className="self-start">
                    <ConfirmAction
                      label="Remover"
                      ariaLabel={`Remover o aviso: ${notice.text}`}
                      action={removeNotice}
                      hidden={{ id: notice.id }}
                      title="Remover aviso"
                      text="O aviso sai do app na próxima tela aberta."
                      confirmLabel="Remover"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </AdminPage>
  );
}
