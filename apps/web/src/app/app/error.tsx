"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
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
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 py-10 text-center">
      <h1 className="text-2xl font-bold">{t("screenTitle")}</h1>
      <p className="text-sm text-muted">{t("screenText")}</p>
      <Button onClick={reset}>{t("retry")}</Button>
    </div>
  );
}
