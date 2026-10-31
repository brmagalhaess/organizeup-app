import { formatBRL, formatBRLCompact, money, percentOf, toDbAmount } from "@organizeup/domain";
import { cx } from "@/components/styles";

interface Point {
  year: number;
  value: string;
  income: string;
}

/**
 * Carteira por ano, com a linha de quanto precisa ter investido. A renda é proporcional à carteira:
 * aparece ao passar o mouse e na tabela, sem um segundo eixo.
 */
export function DividendChart({
  points,
  targetYear,
  required,
}: {
  points: Point[];
  targetYear: number;
  required: string;
}) {
  const top = points.reduce(
    (acc, point) => (money(point.value).gt(acc) ? money(point.value) : acc),
    money(required),
  );
  const max = toDbAmount(top);
  const every = Math.ceil(points.length / 6);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const summary =
    `Carteira projetada de ${formatBRL(first.value)} em ${first.year} para ` +
    `${formatBRL(last.value)} em ${last.year}, pagando ${formatBRL(last.income)} por mês. ` +
    `Quanto precisa ter investido: ${formatBRL(required)}.`;
  return (
    <div>
      <div role="img" aria-label={summary} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
        <div className="flex h-40 flex-col justify-between text-right text-xs tabular-nums text-muted">
          <span>{formatBRLCompact(max)}</span>
          <span>R$ 0</span>
        </div>
        <div>
          <div className="relative flex h-40 items-end border-b border-line">
            <span
              className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-ink/60"
              style={{ bottom: `${percentOf(required, max)}%` }}
            />
            {points.map((point, index) => (
              <div
                key={point.year}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t hover:bg-brand-50/60"
              >
                <span
                  className={cx(
                    "w-full rounded-t-sm",
                    point.year < targetYear ? "bg-brand-500" : "bg-brand-500/50",
                  )}
                  style={{ height: `${percentOf(point.value, max)}%`, marginInline: "1px" }}
                />
                <span
                  className={cx(
                    "pointer-events-none absolute top-0 z-10 hidden w-40 rounded-xl border border-line bg-card p-3 text-left text-xs shadow-card group-hover:block",
                    index < points.length / 2 ? "left-full" : "right-full",
                  )}
                >
                  <span className="mb-1 block font-semibold">{point.year}</span>
                  <span className="block font-medium tabular-nums text-ink">
                    {formatBRL(point.value)}
                  </span>
                  <span className="block tabular-nums text-muted">
                    {formatBRL(point.income)} por mês
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex text-center text-xs text-muted">
            {points.map((point, index) => (
              <span key={point.year} className="min-w-0 flex-1">
                {index % every === 0 ? point.year : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        Carteira no começo de cada ano. A linha tracejada é quanto precisa ter investido; a parte
        clara é a partir de {targetYear}.
      </p>

      <table className="sr-only">
        <caption>Carteira projetada e renda mensal por ano</caption>
        <thead>
          <tr>
            <th scope="col">Ano</th>
            <th scope="col">Carteira</th>
            <th scope="col">Renda por mês</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.year}>
              <th scope="row">{point.year}</th>
              <td>{formatBRL(point.value)}</td>
              <td>{formatBRL(point.income)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
