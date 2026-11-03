// Chave do importador inteligente, ao lado da cobrança: as duas decidem o que a família vê.
import { Badge, Card } from "@/components/ui";
import { Switch } from "../admin-actions";
import { toggleSmartImport } from "./actions";

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
