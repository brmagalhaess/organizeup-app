// Foto mensal do patrimônio de cada família. Cada família roda na própria transação, com RLS.
import {
  householdTimezone,
  listHouseholdIds,
  netWorthInputs,
  recordNetWorth,
  withWorkerHousehold,
} from "@organizeup/db";
import { money, summarizeNetWorth, todayIn, yearMonthOf } from "@organizeup/domain";

interface Log {
  error: (data: object, message: string) => void;
  info: (data: object, message: string) => void;
}

export async function snapshotNetWorth(log: Log): Promise<void> {
  const ids = await listHouseholdIds();
  let recorded = 0;
  let failed = 0;
  for (const householdId of ids) {
    try {
      const saved = await withWorkerHousehold(householdId, async (tx) => {
        const summary = summarizeNetWorth(await netWorthInputs(tx));
        // Família sem nenhum valor ainda: um zero só atrapalharia o gráfico.
        if (money(summary.owned).isZero() && money(summary.owed).isZero()) return false;
        const month = yearMonthOf(todayIn(await householdTimezone(tx, householdId)));
        await recordNetWorth(tx, householdId, month, summary);
        return true;
      });
      if (saved) recorded += 1;
    } catch (err) {
      // Sem a mensagem do erro: ela pode trazer valores da família.
      failed += 1;
      log.error(
        { householdId, code: (err as { code?: string }).code },
        "foto do patrimônio falhou",
      );
    }
  }
  log.info({ households: ids.length, recorded, failed }, "fotos do patrimônio concluídas");
}
