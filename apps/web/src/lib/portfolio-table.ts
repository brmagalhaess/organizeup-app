// Tabela completa da carteira: o que cada coluna mostra para um ativo, a partir do que a família informou
// (VPA, preço alvo, carteira ideal) e do que o sistema já calcula (posição, valor, proventos).
import { money, toDbAmount, type MoneyValue } from "@organizeup/domain";

export interface TableInput {
  value: string;
  currentPrice: string | null;
  bookValuePerShare: string | null;
  targetPrice: string | null;
  targetPercent: string | null;
  dividends12: string | null;
  position: { quantity: string; averagePrice: string; cost: string };
}

export interface TableCells {
  /** Preço atual ÷ VPA, com duas casas. Null sem preço ou sem VPA. */
  priceToBook: number | null;
  /** Quanto falta para o preço alvo, em % do preço atual (negativo quando já passou). Null sem os dois. */
  upside: number | null;
  /** Proventos dos últimos 12 meses divididos por 12. */
  dividendMonthly: string;
  /** Fatia ideal informada, em %. Null sem meta. */
  idealPercent: number | null;
  /** Quanto comprar para o ativo chegar à fatia ideal, sobre a carteira de hoje; nunca negativo. Null sem meta. */
  contribution: string | null;
  /** Fatia atual sobre a carteira, em %, com uma casa. */
  sharePercent: number;
}

const pct = (part: MoneyValue, whole: MoneyValue) =>
  whole.isZero() ? 0 : part.dividedBy(whole).times(100).toDecimalPlaces(1).toNumber();

export function tableCells(row: TableInput, total: string): TableCells {
  const price = row.currentPrice ? money(row.currentPrice) : null;
  const priceToBook =
    price && row.bookValuePerShare && money(row.bookValuePerShare).gt(0) && price.gt(0)
      ? price.dividedBy(row.bookValuePerShare).toDecimalPlaces(2).toNumber()
      : null;
  const upside =
    price && price.gt(0) && row.targetPrice
      ? money(row.targetPrice).dividedBy(price).minus(1).times(100).toDecimalPlaces(1).toNumber()
      : null;
  const idealPercent = row.targetPercent === null ? null : money(row.targetPercent).toNumber();
  const contribution =
    idealPercent === null
      ? null
      : toDbAmount(
          MoneyMax(money(total).times(idealPercent).dividedBy(100).minus(row.value), money(0)),
        );
  return {
    priceToBook,
    upside,
    dividendMonthly: toDbAmount(money(row.dividends12 ?? 0).dividedBy(12)),
    idealPercent,
    contribution,
    sharePercent: pct(money(row.value), money(total)),
  };
}

const MoneyMax = (a: MoneyValue, b: MoneyValue) => (a.gt(b) ? a : b);

export interface TableTotals {
  value: string;
  cost: string;
  gain: string;
  dividendMonthly: string;
  /** Soma das fatias ideais informadas, em %. */
  idealPercent: number;
  contribution: string;
}

export function tableTotals(
  rows: Array<TableInput & { gain: string }>,
  cells: TableCells[],
): TableTotals {
  const sum = (values: Array<string | null>) =>
    toDbAmount(values.reduce((acc, value) => acc.plus(value ?? 0), money(0)));
  return {
    value: sum(rows.map((row) => row.value)),
    cost: sum(rows.map((row) => row.position.cost)),
    gain: sum(rows.map((row) => row.gain)),
    dividendMonthly: sum(cells.map((cell) => cell.dividendMonthly)),
    idealPercent: cells
      .reduce((acc, cell) => acc.plus(cell.idealPercent ?? 0), money(0))
      .toDecimalPlaces(1)
      .toNumber(),
    contribution: sum(cells.map((cell) => cell.contribution)),
  };
}
