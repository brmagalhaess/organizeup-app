// Ativos com saldo zero: vendidos ou resgatados por inteiro. Ficam fora da lista da carteira por padrão.
import { money } from "@organizeup/domain";

interface Holding {
  value: string;
  position: { quantity: string };
}

/** Nem quantidade nem valor: nada a mostrar na carteira de hoje. */
export const isZeroed = (row: Holding) =>
  money(row.position.quantity).isZero() && money(row.value).isZero();

/** Separa os ativos que aparecem dos que estão zerados, mantendo a ordem. */
export function splitZeroed<T extends Holding>(rows: T[]): { visible: T[]; zeroed: T[] } {
  return {
    visible: rows.filter((row) => !isZeroed(row)),
    zeroed: rows.filter(isZeroed),
  };
}
