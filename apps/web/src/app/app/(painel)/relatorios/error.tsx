"use client";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "@/components/ui";
import { screenRecovery } from "@/lib/screen-error";
import { useReportScreenError } from "@/lib/use-report-screen-error";

/** Erro só desta tela: o menu continua, e dá para tentar de novo. */
export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("relatorios.erro");
  const geral = useTranslations("errors");
  useReportScreenError(error);
  // Build velho: `reset()` tentaria com o mesmo JavaScript e falharia igual.
  const stale = screenRecovery(error) === "recarregar";
  return (
    <EmptyState
      title={stale ? geral("staleTitle") : t("titulo")}
      text={stale ? geral("staleText") : t("texto")}
      action={
        <Button
          type="button"
          variant="secondary"
          onClick={stale ? () => window.location.reload() : reset}
        >
          {stale ? geral("reload") : t("tentar")}
        </Button>
      }
    />
  );
}
