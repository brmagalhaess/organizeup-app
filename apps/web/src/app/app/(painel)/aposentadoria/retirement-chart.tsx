"use client";
import { formatBRL, formatBRLCompact, money, percentOf, toDbAmount } from "@organizeup/domain";
import { cx } from "@/components/styles";

interface Point {
  age: number;
  value: string;
}

/** Patrimônio por idade: sobe até parar e desce depois. Uma série; a tabela serve leitor de tela. */
export function RetirementChart({ points, targetAge }: { points: Point[]; targetAge: number }) {
  const top = points.reduce(
    (acc, point) => (money(point.value).gt(acc) ? money(point.value) : acc),
    money(0),
  );
  const max = toDbAmount(top);
  const every = Math.ceil(points.length / 6);
  return (
    <div>
      <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
        <div className="flex h-40 flex-col justify-between text-right text-xs tabular-nums text-muted">
          <span>{formatBRLCompact(max)}</span>
          <span>R$ 0</span>
        </div>
        <div>
          <div className="flex h-40 items-end border-b border-line">
            {points.map((point, index) => (
              <button
                key={point.age}
                type="button"
                aria-label={`Aos ${point.age} anos: ${formatBRL(point.value)}`}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t hover:bg-brand-50/60"
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "w-full rounded-t-sm",
                    point.age < targetAge ? "bg-brand-500" : "bg-brand-500/50",
                  )}
                  style={{
                    height: `${money(max).isZero() ? 0 : percentOf(point.value, max)}%`,
                    marginInline: "1px",
                  }}
                />
                <span
                  aria-hidden="true"
                  className={cx(
                    "pointer-events-none absolute top-0 z-10 hidden w-36 rounded-xl border border-line bg-card p-3 text-left text-xs shadow-card group-hover:block group-focus-visible:block",
                    index < points.length / 2 ? "left-full" : "right-full",
                  )}
                >
                  <span className="mb-1 block font-semibold">Aos {point.age} anos</span>
                  <span className="font-medium tabular-nums text-ink">
                    {formatBRL(point.value)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex text-center text-xs text-muted">
            {points.map((point, index) => (
              <span key={point.age} className="min-w-0 flex-1">
                {index % every === 0 ? point.age : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        Idade. A parte clara é depois de parar de trabalhar.
      </p>

      <table className="sr-only">
        <caption>Patrimônio projetado por idade</caption>
        <thead>
          <tr>
            <th scope="col">Idade</th>
            <th scope="col">Patrimônio</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.age}>
              <th scope="row">{point.age}</th>
              <td>{formatBRL(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
