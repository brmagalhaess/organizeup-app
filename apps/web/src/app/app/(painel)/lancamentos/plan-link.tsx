import Link from "next/link";
import { Badge } from "@/components/ui";

const goalName = (description: string) =>
  description.replace(/^Meta: /, "").replace(/ \(\d+\/\d+\)$/, "");

/** A parcela de meta é calculada: quem quiser mudar vai para a tela de Metas. */
export function PlanLink({ description }: { description: string }) {
  return (
    <Link
      href="/app/metas"
      aria-label={`Abrir meta ${goalName(description)}`}
      title="Valor calculado pelo assistente; abra Metas para ajustar"
      className="inline-flex items-center"
    >
      <Badge>Plano</Badge>
    </Link>
  );
}
