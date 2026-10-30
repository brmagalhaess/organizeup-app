// Carteira de investimentos e proventos. Puro: o preço médio segue a regra usual da B3 e da Receita
// (compra soma custo e taxas; venda baixa pelo preço médio, sem mudá-lo). Só organiza, não indica ativo.
import Decimal from "decimal.js";
import { recentMonths, yearMonthOf } from "./cashflow";
import { money, toDbAmount, type MoneyValue } from "./money";

/** Classes que valem quantidade × preço. As demais valem o total informado. */
export function isUnitPriced(assetClass: string): boolean {
  return assetClass === "acao" || assetClass === "fii" || assetClass === "etf_bdr";
}

export interface TradeInput {
  side: "compra" | "venda";
  occurredOn: string;
  quantity: string;
  unitPrice: string;
  fees: string;
}

export interface Position {
  quantity: string;
  averagePrice: string;
  cost: string;
  /** Resultado das vendas, já sem taxas. */
  realized: string;
  /** Alguma venda passou do que havia na data. */
  oversold: boolean;
}

export function positionOf(trades: TradeInput[]): Position {
  const ordered = [...trades].sort(
    (a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.side.localeCompare(b.side),
  );
  let held = money(0);
  let cost = money(0);
  let realized = money(0);
  let oversold = false;
  for (const trade of ordered) {
    const quantity = money(trade.quantity);
    if (trade.side === "compra") {
      held = held.plus(quantity);
      cost = cost.plus(quantity.times(trade.unitPrice)).plus(trade.fees);
      continue;
    }
    if (quantity.gt(held)) oversold = true;
    const sold = quantity.gt(held) ? held : quantity;
    const average = held.isZero() ? money(0) : cost.dividedBy(held);
    realized = realized
      .plus(sold.times(trade.unitPrice))
      .minus(trade.fees)
      .minus(sold.times(average));
    held = held.minus(sold);
    cost = held.isZero() ? money(0) : cost.minus(sold.times(average));
  }
  return {
    quantity: held.toString(),
    averagePrice: held.isZero() ? "0" : cost.dividedBy(held).toDecimalPlaces(8).toString(),
    cost: toDbAmount(cost),
    realized: toDbAmount(realized),
    oversold,
  };
}

export interface Redemption {
  quantity: string;
  unitPrice: string;
  /** Valor atual depois do resgate. */
  remaining: string;
}

/**
 * Resgate em classe sem preço unitário. O valor atual inclui rendimento, então o resgate baixa do
 * aplicado na proporção do que saiu. Quem resgata tudo zera a posição, mesmo com centavos a mais.
 */
export function redemptionOf(held: string, currentValue: string, amount: string): Redemption {
  const quantity = money(held);
  const value = money(currentValue);
  const out = money(amount);
  if (out.gte(value) || value.isZero()) {
    return {
      quantity: quantity.toString(),
      unitPrice: out.dividedBy(quantity).toDecimalPlaces(8).toString(),
      remaining: "0.00",
    };
  }
  return {
    quantity: out
      .times(quantity)
      .dividedBy(value)
      .toDecimalPlaces(8, Decimal.ROUND_DOWN)
      .toString(),
    unitPrice: value.dividedBy(quantity).toDecimalPlaces(8).toString(),
    remaining: toDbAmount(value.minus(out)),
  };
}

export interface InvestmentInput {
  id: string;
  assetClass: string;
  currentPrice: string | null;
  currentValue: string | null;
  trades: TradeInput[];
}

export interface PortfolioRow {
  id: string;
  position: Position;
  value: string;
  gain: string;
  /** Null sem custo. */
  gainPercent: number | null;
  /** Sem preço ou valor informado: o valor mostrado é o custo. */
  estimated: boolean;
}

function rowOf(input: InvestmentInput): PortfolioRow {
  const position = positionOf(input.trades);
  const held = money(position.quantity);
  const unit = isUnitPriced(input.assetClass);
  const informed = unit ? input.currentPrice : input.currentValue;
  const estimated = informed === null && held.gt(0);
  const value = held.isZero()
    ? money(0)
    : informed === null
      ? money(position.cost)
      : unit
        ? held.times(informed)
        : money(informed);
  const gain = value.minus(position.cost);
  return {
    id: input.id,
    position,
    value: toDbAmount(value),
    gain: toDbAmount(gain),
    gainPercent: money(position.cost).isZero()
      ? null
      : gain.dividedBy(position.cost).times(100).toDecimalPlaces(1).toNumber(),
    estimated,
  };
}

export interface ClassShare {
  assetClass: string;
  value: string;
  /** 0 a 100, com uma casa. */
  percent: number;
  target: number | null;
  /** Quanto falta para a meta; negativo quando passou. Null sem meta. */
  toTarget: string | null;
}

export interface TargetInput {
  assetClass: string;
  percent: string;
}

export interface PortfolioSummary {
  rows: PortfolioRow[];
  total: string;
  cost: string;
  gain: string;
  gainPercent: number | null;
  realized: string;
  classes: ClassShare[];
}

const sumOf = (values: string[]): MoneyValue =>
  values.reduce((acc, value) => acc.plus(value), money(0));

export function summarizePortfolio(
  list: InvestmentInput[],
  targets: TargetInput[] = [],
): PortfolioSummary {
  const rows = list.map(rowOf);
  const total = sumOf(rows.map((row) => row.value));
  const cost = sumOf(rows.map((row) => row.position.cost));
  const gain = total.minus(cost);

  const classes = [
    ...new Set([...list.map((i) => i.assetClass), ...targets.map((t) => t.assetClass)]),
  ]
    .map((assetClass) => {
      const value = sumOf(
        rows.filter((_, index) => list[index]!.assetClass === assetClass).map((row) => row.value),
      );
      const target = targets.find((t) => t.assetClass === assetClass);
      return {
        assetClass,
        value: toDbAmount(value),
        percent: total.isZero()
          ? 0
          : value.dividedBy(total).times(100).toDecimalPlaces(1).toNumber(),
        target: target ? money(target.percent).toNumber() : null,
        toTarget: target
          ? toDbAmount(total.times(target.percent).dividedBy(100).minus(value))
          : null,
      };
    })
    .filter((share) => share.target !== null || money(share.value).gt(0))
    .sort((a, b) => money(b.value).comparedTo(a.value));

  return {
    rows,
    total: toDbAmount(total),
    cost: toDbAmount(cost),
    gain: toDbAmount(gain),
    gainPercent: cost.isZero()
      ? null
      : gain.dividedBy(cost).times(100).toDecimalPlaces(1).toNumber(),
    realized: toDbAmount(sumOf(rows.map((row) => row.position.realized))),
    classes,
  };
}

export interface DividendInput {
  investmentId: string;
  kind: "dividendo" | "jcp" | "rendimento";
  paidOn: string;
  gross: string;
  withheld: string;
}

export const netDividend = (row: Pick<DividendInput, "gross" | "withheld">): string =>
  toDbAmount(money(row.gross).minus(row.withheld));

export interface DividendSummary {
  /** Últimos 12 meses, do mais antigo ao atual, em valor líquido. */
  months: Array<{ month: string; net: string }>;
  last12: string;
  monthlyAverage: string;
  thisYear: string;
  withheld12: string;
  byInvestment: Array<{ investmentId: string; net: string }>;
  /** 0 a 100 da média mensal sobre a meta. Null sem meta. */
  goalPercent: number | null;
}

export function summarizeDividends(
  rows: DividendInput[],
  currentMonth: string,
  monthlyGoal: string | null,
): DividendSummary {
  const months = recentMonths(currentMonth, 12);
  const recent = rows.filter((row) => months.includes(yearMonthOf(row.paidOn)));
  const last12 = sumOf(recent.map(netDividend));
  const average = last12.dividedBy(12);
  const ids = [...new Set(recent.map((row) => row.investmentId))];
  return {
    months: months.map((month) => ({
      month,
      net: toDbAmount(
        sumOf(recent.filter((row) => yearMonthOf(row.paidOn) === month).map(netDividend)),
      ),
    })),
    last12: toDbAmount(last12),
    monthlyAverage: toDbAmount(average),
    thisYear: toDbAmount(
      sumOf(
        rows.filter((row) => row.paidOn.slice(0, 4) === currentMonth.slice(0, 4)).map(netDividend),
      ),
    ),
    withheld12: toDbAmount(sumOf(recent.map((row) => row.withheld))),
    byInvestment: ids
      .map((investmentId) => ({
        investmentId,
        net: toDbAmount(
          sumOf(recent.filter((row) => row.investmentId === investmentId).map(netDividend)),
        ),
      }))
      .sort((a, b) => money(b.net).comparedTo(a.net)),
    goalPercent:
      monthlyGoal === null
        ? null
        : Math.min(100, average.dividedBy(monthlyGoal).times(100).toDecimalPlaces(0).toNumber()),
  };
}
