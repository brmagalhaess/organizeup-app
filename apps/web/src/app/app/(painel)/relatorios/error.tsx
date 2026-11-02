"use client";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "@/components/ui";
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
  useReportScreenError(error);
  return (
    <EmptyState
      title={t("titulo")}
      text={t("texto")}
      action={
        <Button type="button" variant="secondary" onClick={reset}>
          {t("tentar")}
        </Button>
      }
    />
  );
}
