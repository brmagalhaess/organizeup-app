"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { screenRecovery } from "@/lib/screen-error";
import { useReportScreenError } from "@/lib/use-report-screen-error";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  useReportScreenError(error);
  // Build velho: `reset()` tentaria com o mesmo JavaScript e falharia igual.
  const stale = screenRecovery(error) === "recarregar";
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 py-10 text-center">
      <h1 className="text-2xl font-bold">{t(stale ? "staleTitle" : "screenTitle")}</h1>
      <p className="text-sm text-muted">{t(stale ? "staleText" : "screenText")}</p>
      <Button onClick={stale ? () => window.location.reload() : reset}>
        {t(stale ? "reload" : "retry")}
      </Button>
    </div>
  );
}
