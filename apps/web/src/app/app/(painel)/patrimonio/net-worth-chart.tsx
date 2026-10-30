"use client";
import {
  formatBRL,
  formatBRLCompact,
  formatMonthShort,
  formatYearMonth,
  money,
  percentOf,
  toDbAmount,
} from "@organizeup/domain";
import { cx } from "@/components/styles";
import { EmptyState } from "@/components/ui";

interface Point {
  month: string;
  owned: string;
  owed: string;
  net: string;
}

/** Linha do patrimônio líquido. Um eixo só; a tabela atende leitores de tela. */
export function NetWorthChart({ points }: { points: Point[] }) {
  if (points.length < 2)
    return (
      <EmptyState
        title="O gráfico começa com dois meses"
        text="Guardamos uma foto do seu patrimônio todo mês. A linha aparece a partir do próximo."
      />
    );

  const values = points.map((point) => money(point.net));
  const top = values.reduce((acc, value) => (value.gt(acc) ? value : acc));
  const bottom = values.reduce((acc, value) => (value.lt(acc) ? value : acc));
  const span = toDbAmount(top.minus(bottom));
  // Altura em % a partir de cima, com folga para a linha não encostar nas bordas.
  const heightOf = (net: string) =>
    money(span).isZero()
      ? 50
      : 90 - (percentOf(toDbAmount(money(net).minus(bottom)), span) * 80) / 100;
  const xOf = (index: number) => ((index + 0.5) / points.length) * 100;
  const line = points.map((point, index) => `${xOf(index)},${heightOf(point.net)}`).join(" ");

  return (
    <div>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
        <div className="flex h-52 flex-col justify-between py-3 text-right text-xs tabular-nums text-muted">
          <span>{formatBRLCompact(toDbAmount(top))}</span>
          <span>{formatBRLCompact(toDbAmount(bottom))}</span>
        </div>
        <div>
          <div className="relative h-52 border-b border-line">
            <svg
              aria-hidden="true"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 size-full text-brand-500"
            >
              <polyline
                points={line}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="absolute inset-0 flex">
              {points.map((point, index) => (
                <button
                  key={point.month}
                  type="button"
                  aria-label={`${formatYearMonth(point.month)}: patrimônio de ${formatBRL(point.net)}`}
                  className="group relative min-w-0 flex-1 rounded-t-lg hover:bg-brand-50/60"
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-brand-500"
                    style={{ top: `${heightOf(point.net)}%` }}
                  />
                  <span
                    aria-hidden="true"
                    className={cx(
                      "pointer-events-none absolute top-0 z-10 hidden w-44 rounded-xl border border-line bg-card p-3 text-left text-xs shadow-card group-hover:block group-focus-visible:block",
                      index < points.length / 2 ? "left-full" : "right-full",
                    )}
                  >
                    <span className="mb-1 block font-semibold first-letter:uppercase">
                      {formatYearMonth(point.month)}
                    </span>
                    <span className="flex justify-between gap-2 text-muted">
                      Tem
                      <span className="font-medium tabular-nums text-ink">
                        {formatBRL(point.owned)}
                      </span>
                    </span>
                    <span className="flex justify-between gap-2 text-muted">
                      Deve
                      <span className="font-medium tabular-nums text-ink">
                        {formatBRL(point.owed)}
                      </span>
                    </span>
                    <span className="mt-1 flex justify-between gap-2 border-t border-line pt-1 text-muted">
                      Líquido
                      <span className="font-medium tabular-nums text-ink">
                        {formatBRL(point.net)}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex text-center text-xs text-muted">
            {points.map((point) => (
              <span key={point.month} className="flex-1">
                {formatMonthShort(point.month)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>Evolução do patrimônio líquido</caption>
        <thead>
          <tr>
            <th scope="col">Mês</th>
            <th scope="col">Patrimônio líquido</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.month}>
              <th scope="row">{formatYearMonth(point.month)}</th>
              <td>{formatBRL(point.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
