"use client";
import { Button } from "@/components/ui";
import { useReportScreenError } from "@/lib/use-report-screen-error";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useReportScreenError(error);
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 py-10 text-center">
      <h1 className="text-2xl font-bold">Algo não saiu como esperado</h1>
      <p className="text-sm text-muted">
        Não conseguimos carregar esta tela. Seus dados continuam guardados. Tente de novo em
        instantes.
      </p>
      <Button onClick={reset}>Tentar de novo</Button>
    </div>
  );
}
