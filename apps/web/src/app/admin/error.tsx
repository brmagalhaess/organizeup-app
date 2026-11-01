"use client";
import { Button } from "@/components/ui";
import { useReportScreenError } from "@/lib/use-report-screen-error";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useReportScreenError(error);
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 py-10 text-center">
      <h2 className="text-2xl font-bold">Não foi possível abrir o painel</h2>
      <p className="text-sm text-muted">
        Algo falhou ao ler os dados do serviço. Tente de novo em instantes.
      </p>
      <Button onClick={reset}>Tentar de novo</Button>
    </div>
  );
}
