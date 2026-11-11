// Chave do importador inteligente, ao lado da cobrança: as duas decidem o que a família vê.
import { Badge, Card } from "@/components/ui";
import { Switch } from "../admin-actions";
import { toggleBankFeed, toggleSmartImport } from "./actions";

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
