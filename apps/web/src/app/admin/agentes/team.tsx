// Equipe no Paperclip: catálogo em código e a última atividade registrada por aqui. Nada de estado ao vivo.
import { ExternalLink } from "lucide-react";
import { buttonClass } from "@/components/styles";
import { Card } from "@/components/ui";
import { formatDateTime } from "../format";
import { AdminTable, type Column } from "../kit";
import { PAPERCLIP_URL } from "./info";
import {
  lastActivity,
  PAPERCLIP_TEAM,
  paperclipAgentUrl,
  SOURCE_LABELS,
  type ActivityRecord,
} from "./paperclip";

const columns: Column[] = [
  { key: "agent", label: "Agente", primary: true },
  { key: "wake", label: "Quando acorda" },
  { key: "activity", label: "Última atividade" },
  { key: "link", label: "No Paperclip" },
];

export function TeamSection({ records }: { records: ActivityRecord[] }) {
  return (
    <Card
      title="Equipe no Paperclip"
      description="O estado ao vivo de cada agente fica no Paperclip. Aqui entra só o que eles deixaram registrado: relatórios, memórias e rodadas. Os dados das famílias não saem daqui."
      actions={
        <a
          href={PAPERCLIP_URL}
          target="_blank"
          rel="noreferrer"
          className={buttonClass("secondary", true)}
        >
          Abrir o Paperclip
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      }
    >
      <AdminTable
        caption="Equipe de agentes no Paperclip"
        columns={columns}
        rows={PAPERCLIP_TEAM.map((agent) => {
          const activity = lastActivity(agent, records);
          return {
            id: agent.id,
            cells: {
              agent: (
                <>
                  {agent.name}
                  <span className="block text-xs font-normal text-muted">{agent.role}</span>
                </>
              ),
              wake: agent.wake,
              activity: activity ? (
                <>
                  {formatDateTime(activity.at)}
                  <span className="block text-xs text-muted">{SOURCE_LABELS[activity.source]}</span>
                </>
              ) : (
                <span className="text-muted">Sem registro ainda</span>
              ),
              link: (
                <a
                  href={paperclipAgentUrl(agent)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Ver ${agent.name} no Paperclip`}
                  className="font-semibold text-brand-700 underline underline-offset-2"
                >
                  Ver
                </a>
              ),
            },
          };
        })}
      />
    </Card>
  );
}
