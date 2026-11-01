import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge } from "@/components/ui";

const goalName = (description: string) =>
  description.replace(/^Meta: /, "").replace(/ \(\d+\/\d+\)$/, "");

/** A parcela de meta é calculada: quem quiser mudar vai para a tela de Metas. */
export function PlanLink({ description }: { description: string }) {
  const t = useTranslations("lancamentos.plan");
  return (
    <Link
      href="/app/metas"
      aria-label={t("open", { name: goalName(description) })}
      title={t("title")}
      className="inline-flex items-center"
    >
      <Badge>{t("badge")}</Badge>
    </Link>
  );
}
