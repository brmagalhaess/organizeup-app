// Gráficos simples do relatório, só com CSS: as cores de receita e despesa do sistema, um eixo só, e a
// tabela logo abaixo responde a quem não vê o gráfico.
import {
  axisCeiling,
  money,
  percentOf,
  type StatementCell,
  type StatementSection,
} from "@organizeup/domain";
import { cx } from "@/components/styles";
import { formatMonthAbbr } from "@/i18n/format";
import type { StatementWriter } from "@/lib/statement-text";

const valueOf = (row: StatementCell[], column: number) => {
  const cell = row[column] ?? null;
  return cell && "money" in cell ? cell.money : "0.00";
};

const COLORS = ["bg-income", "bg-expense"];

/** Uma série usa a cor da marca: não é receita nem despesa. */
const colorOf = (series: number[], order: number) =>
  series.length === 1 ? "bg-brand-500" : COLORS[order]!;

export function ColumnsChart({
  section,
  series,
  writer,
}: {
  section: StatementSection;
  series: number[];
  writer: StatementWriter;
}) {
  const values = section.rows.flatMap((row) => series.map((column) => valueOf(row, column)));
  const up = values.filter((value) => money(value).gt(0));
  const down = values.filter((value) => money(value).lt(0));
  const top = axisCeiling(up.length > 0 ? up : ["0"]);
  const bottom = axisCeiling(down.length > 0 ? down : ["0"]);
  const span = money(top).plus(bottom).toFixed(2);
  if (money(span).isZero()) return null;
  const zero = percentOf(top, span);
  const captionOf = (cell: StatementCell | undefined) => {
    if (cell && "month" in cell) return formatMonthAbbr(cell.month, writer.locale);
    return cell ? writer.cell(cell) : "";
  };
  const rowName = (row: StatementCell[]) =>
    `${writer.cell(row[0] ?? null)}: ${series
      .map(
        (column) =>
          `${writer.column(section.columns[column]!)} ${writer.amount(valueOf(row, column))}`,
      )
      .join(", ")}`;

  return (
    <div className="mb-4">
      {series.length > 1 ? (
        <ul className="m-0 mb-3 flex list-none flex-wrap gap-4 p-0 text-xs text-muted">
          {series.map((column, order) => (
            <li key={column} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cx("size-2.5 rounded-sm", colorOf(series, order))}
              />
              {writer.column(section.columns[column]!)}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        role="img"
        aria-label={section.rows.map(rowName).join("; ")}
        className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-2"
      >
        <div className="relative h-44 whitespace-nowrap text-right text-xs tabular-nums text-muted">
          <span className="absolute right-0 top-0">{writer.compact(top)}</span>
          {money(bottom).isZero() ? (
            <span className="absolute bottom-0 right-0">{writer.compact("0")}</span>
          ) : (
            <>
              <span className="absolute right-0 -translate-y-1/2" style={{ top: `${zero}%` }}>
                {writer.compact("0")}
              </span>
              <span className="absolute bottom-0 right-0">
                {writer.compact(money(bottom).neg().toFixed(2))}
              </span>
            </>
          )}
        </div>
        <div className="min-w-0">
          <div className="relative flex h-44 items-stretch">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-line"
              style={{ top: `${zero}%` }}
            />
            {section.rows.map((row, index) => (
              <div
                key={index}
                title={rowName(row)}
                className="relative flex min-w-0 flex-1 justify-center gap-0.5 rounded-lg hover:bg-brand-50"
              >
                {series.map((column, order) => {
                  const value = valueOf(row, column);
                  const size = percentOf(money(value).abs().toFixed(2), span);
                  const negative = money(value).lt(0);
                  return (
                    <span key={column} className="relative h-full w-1.5 sm:w-3">
                      <span
                        className={cx(
                          "absolute inset-x-0",
                          negative ? "rounded-b" : "rounded-t",
                          colorOf(series, order),
                        )}
                        style={
                          negative
                            ? { top: `${zero}%`, height: `${size}%` }
                            : { bottom: `${100 - zero}%`, height: `${size}%` }
                        }
                      />
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex text-center text-[0.6875rem] text-muted">
            {section.rows.map((row, index) => (
              <span key={index} className="min-w-0 flex-1 overflow-hidden">
                <span className={cx(index % 2 === 1 && "hidden sm:inline")}>
                  {captionOf(row[0] ?? undefined)}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Barras horizontais: quem é maior, com o valor ao lado. */
export function BarsChart({
  section,
  column,
  writer,
}: {
  section: StatementSection;
  column: number;
  writer: StatementWriter;
}) {
  const largest = section.rows.reduce((acc, row) => {
    const value = money(valueOf(row, column)).abs();
    return value.gt(acc) ? value : acc;
  }, money(0));
  if (largest.isZero()) return null;
  return (
    <ul className="m-0 mb-4 grid list-none gap-3 p-0">
      {section.rows.map((row, index) => {
        const value = valueOf(row, column);
        return (
          <li key={index}>
            <div className="flex justify-between gap-3 text-sm">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {writer.cell(row[0] ?? null)}
              </span>
              <span className="whitespace-nowrap tabular-nums text-muted">
                {writer.amount(value)}
              </span>
            </div>
            <div aria-hidden="true" className="mt-1 h-2 rounded-full bg-brand-50">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{
                  width: `${percentOf(money(value).abs().toFixed(2), largest.toFixed(2))}%`,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
