import type { Metadata } from "next";
import { debtFileGate } from "@organizeup/ai";
import { canWrite } from "@organizeup/db";
import {
  isDoubtful,
  matchKnownDebt,
  type DebtExtraction,
  type KnownDebt,
} from "@organizeup/domain";
import { Card, PageHeader } from "@/components/ui";
import { loadDebtFiles, loadDebts } from "@/lib/commitments";
import { requireTenant } from "@/lib/session";
import { DebtImport, type ReviewItem } from "./debt-import";

export const metadata: Metadata = { title: "Importar dívidas" };

/** Rascunho da leitura. Coluna jsonb: só o que tem a forma esperada vira conferência. */
const extractionOf = (value: unknown): DebtExtraction | null =>
  value && typeof value === "object" && "creditor" in value ? (value as DebtExtraction) : null;

export default async function DebtImportPage({
  searchParams,
}: {
  searchParams: Promise<{ arquivo?: string | string[] }>;
}) {
  const { ctx } = await requireTenant();
  const { arquivo } = await searchParams;
  const [data, files, gate] = await Promise.all([
    loadDebts(ctx),
    loadDebtFiles(ctx),
    debtFileGate({ ctx }),
  ]);

  const openDebts = data.debts.filter((debt) => !debt.archived && debt.next);
  const known: KnownDebt[] = openDebts.map((debt) => ({
    id: debt.id,
    name: debt.name,
    nextAmount: debt.next?.amount ?? null,
    openInstallments: debt.installments.filter((row) => !row.paid).length,
  }));
  // Arquivo solto espera conferência. O anexado a uma dívida só entra quando foi lido ou pedido.
  const waiting = files.filter(
    (file) =>
      file.status !== "confirmado" &&
      (file.debtId === null || file.status === "lido" || file.id === arquivo),
  );
  const items: ReviewItem[] = waiting.map((file) => {
    const found = extractionOf(file.extracted);
    const match = file.debtId
      ? (known.find((debt) => debt.id === file.debtId) ?? null)
      : found
        ? matchKnownDebt(found, known)
        : null;
    return {
      id: file.id,
      fileName: file.fileName,
      status: file.status,
      found,
      doubtful: found
        ? {
            name: isDoubtful(found.creditor),
            system: isDoubtful(found.system),
            balance: isDoubtful(found.balance),
            installmentAmount: isDoubtful(found.installmentAmount),
            monthlyRate: isDoubtful(found.monthlyRate),
            installments: isDoubtful(found.installments),
            firstDueDate: isDoubtful(found.nextDueDate),
          }
        : null,
      matchId: match?.id ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Dívidas"
        title="Importar arquivo de dívidas"
        description="Envie contrato, renegociação, extrato ou planilha. Você confere tudo antes de gravar."
      />
      {canWrite(ctx) ? (
        <DebtImport
          gate={gate}
          items={items}
          today={data.today}
          accounts={data.accounts
            .filter((account) => !account.archived)
            .map(({ id, name }) => ({ id, name }))}
          debts={known.map(({ id, name }) => ({ id, name }))}
        />
      ) : (
        <Card>
          <p className="text-sm text-muted">Seu papel nesta família não permite importar.</p>
        </Card>
      )}
    </div>
  );
}
