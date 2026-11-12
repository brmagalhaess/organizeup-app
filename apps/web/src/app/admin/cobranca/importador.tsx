// Chave do importador inteligente, ao lado da cobrança: as duas decidem o que a família vê.
import { Badge, Card } from "@/components/ui";
import { Switch } from "../admin-actions";
import { toggleBankFeed, toggleEmailReminders, toggleSmartImport } from "./actions";

export function SmartImportSwitch({ enabled }: { enabled: boolean }) {
  return (
    <Card
      title="smart_import_enabled"
      description="Desligada, o importador de arquivos aparece só para quem administra o serviço. Nunca rodou em Linux nem com IA real. Mudar fica na auditoria."
      actions={
        enabled ? <Badge tone="warning">Ligada</Badge> : <Badge tone="success">Desligada</Badge>
      }
    >
      <Switch
        label="Importador para todas as famílias"
        checked={enabled}
        action={toggleSmartImport}
        hidden={{}}
      />
    </Card>
  );
}

/** Conexão com bancos pela Pluggy, com a chave de cada pessoa (ADR-0038). */
export function BankFeedSwitch({ enabled }: { enabled: boolean }) {
  return (
    <Card
      title="bank_feed_enabled"
      description="Desligada, a conexão com bancos aparece só para quem administra o serviço. O plano pessoal da Pluggy é para uso próprio: antes de ligar para todos, confirme com a Pluggy se o uso dentro do produto é aceito e atualize a Política de Privacidade. Mudar fica na auditoria."
      actions={
        enabled ? <Badge tone="warning">Ligada</Badge> : <Badge tone="success">Desligada</Badge>
      }
    >
      <Switch
        label="Conexão com bancos para todas as famílias"
        checked={enabled}
        action={toggleBankFeed}
        hidden={{}}
      />
    </Card>
  );
}

/** Lembretes por e-mail (ADR-0039). */
export function EmailRemindersSwitch({ enabled }: { enabled: boolean }) {
  return (
    <Card
      title="email_reminders_enabled"
      description="Desligada, os lembretes por e-mail saem só para quem administra o serviço. Ligada, todo login com e-mail confirmado recebe, e cada pessoa escolhe o que quer em Notificações. O e-mail leva nomes de contas e valores: a Política de Privacidade já diz isso, e vale avisar as famílias antes de ligar. Mudar fica na auditoria."
      actions={
        enabled ? <Badge tone="warning">Ligada</Badge> : <Badge tone="success">Desligada</Badge>
      }
    >
      <Switch
        label="Lembretes por e-mail para todas as famílias"
        checked={enabled}
        action={toggleEmailReminders}
        hidden={{}}
      />
    </Card>
  );
}
