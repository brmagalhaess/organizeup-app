// Gráficos do painel: HTML e SVG, sem biblioteca. Um eixo só, marcas finas, legenda a partir de duas
// séries, detalhe ao passar o mouse ou focar, e uma tabela para leitores de tela. Cores de série em
// --color-series-a e --color-series-b, validadas para daltonismo nos dois temas.
import type { ReactNode } from "react";
import { cx } from "@/components/styles";
import { EmptyState } from "@/components/ui";
import { formatCount } from "./format";

function Tip({ children, flip }: { children: ReactNode; flip: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "pointer-events-none absolute top-0 z-10 hidden w-40 rounded-xl border border-line bg-card p-3 text-left text-xs shadow-card group-hover:block group-focus-visible:block",
        flip ? "right-full" : "left-full",
      )}
    >
      {children}
    </span>
  );
}

function TipRow({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <span className="flex items-center justify-between gap-2 text-muted">
      <span className="flex items-center gap-1.5">
        {swatch ? (
          <span aria-hidden="true" className={cx("h-0.5 w-3 rounded-full", swatch)} />
        ) : null}
        {label}
      </span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </span>
  );
}

function XAxis({ labels }: { labels: string[] }) {
  // Três marcas bastam: início, meio e fim. Doze rótulos não cabem no celular.
  const shown = new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1]);
  return (
    <div className="mt-1.5 flex text-xs text-muted">
      {labels.map((label, index) => (
        <span key={label} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
          {shown.has(index) ? label : null}
        </span>
      ))}
    </div>
  );
}

function YAxis({ top, label }: { top: number; label?: string }) {
  return (
    <div
      className={cx(
        "flex h-48 shrink-0 flex-col justify-between text-right text-xs tabular-nums text-muted",
        label ? "w-14" : "w-8",
      )}
    >
      <span>{label ?? formatCount(top)}</span>
      <span>0</span>
    </div>
  );
}

export interface GrowthPoint {
  label: string;
  households: number;
  users: number;
}

const growthSeries = [
  { key: "households", label: "Famílias", text: "text-series-a", bg: "bg-series-a" },
  { key: "users", label: "Usuários", text: "text-series-b", bg: "bg-series-b" },
] as const;

/** Totais acumulados de famílias e usuários, semana a semana. */
export function GrowthChart({ points }: { points: GrowthPoint[] }) {
  if (points.at(-1)?.users === 0) {
    return (
      <EmptyState title="Ainda sem cadastros" text="A linha aparece com a primeira conta criada." />
    );
  }
  const top = Math.max(1, ...points.map((point) => Math.max(point.households, point.users)));
  const xOf = (index: number) => ((index + 0.5) / points.length) * 100;
  const yOf = (value: number) => 96 - (value / top) * 90;
  const last = points.at(-1)!;
  return (
    <div>
      <ul
        aria-hidden="true"
        className="m-0 mb-3 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-sm"
      >
        {growthSeries.map((series) => (
          <li key={series.key} className="flex items-center gap-2 text-muted">
            <span className={cx("h-0.5 w-4 rounded-full", series.bg)} />
            {series.label}
            <span className="font-semibold tabular-nums text-ink">
              {formatCount(last[series.key])}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <YAxis top={top} />
        <div className="min-w-0 flex-1">
          <div className="relative h-48 border-b border-line">
            {growthSeries.map((series) => (
              <svg
                key={series.key}
                aria-hidden="true"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className={cx("absolute inset-0 size-full", series.text)}
              >
                <polyline
                  points={points
                    .map((point, index) => `${xOf(index)},${yOf(point[series.key])}`)
                    .join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ))}
            <div className="absolute inset-0 flex">
              {points.map((point, index) => (
                <button
                  key={point.label}
                  type="button"
                  aria-label={`${point.label}: ${point.households} famílias e ${point.users} usuários`}
                  className="group relative min-w-0 flex-1 rounded-t-lg hover:bg-brand-50/60"
                >
                  {growthSeries.map((series) => (
                    <span
                      key={series.key}
                      aria-hidden="true"
                      className={cx(
                        "absolute left-1/2 hidden size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card group-hover:block group-focus-visible:block",
                        series.bg,
                      )}
                      style={{ top: `${yOf(point[series.key])}%` }}
                    />
                  ))}
                  <Tip flip={index >= points.length / 2}>
                    <span className="mb-1 block font-semibold text-ink">{point.label}</span>
                    {growthSeries.map((series) => (
                      <TipRow
                        key={series.key}
                        label={series.label}
                        value={formatCount(point[series.key])}
                        swatch={series.bg}
                      />
                    ))}
                  </Tip>
                </button>
              ))}
            </div>
          </div>
          <XAxis labels={points.map((point) => point.label)} />
        </div>
      </div>
      <table className="sr-only">
        <caption>Total de famílias e usuários por semana</caption>
        <thead>
          <tr>
            <th scope="col">Semana</th>
            <th scope="col">Famílias</th>
            <th scope="col">Usuários</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{point.households}</td>
              <td>{point.users}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface ActivityPoint {
  label: string;
  active: number;
}

/** Famílias ativas em cada fechamento de semana. Uma série: o título do cartão diz o que é. */
export function ActivityChart({ points }: { points: ActivityPoint[] }) {
  if (points.length === 0) {
    return (
      <EmptyState
        title="Aguardando a primeira contagem"
        text="O worker conta as famílias ativas todo dia. As barras aparecem depois da primeira."
      />
    );
  }
  const top = Math.max(1, ...points.map((point) => point.active));
  return (
    <div>
      <div className="flex gap-2">
        <YAxis top={top} />
        <div className="min-w-0 flex-1">
          <div className="flex h-48 items-end border-b border-line">
            {points.map((point, index) => (
              <button
                key={point.label}
                type="button"
                aria-label={`${point.label}: ${point.active} famílias ativas`}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-lg hover:bg-brand-50/60"
              >
                <span
                  aria-hidden="true"
                  className="block w-full max-w-6 rounded-t bg-series-a mx-px"
                  style={{
                    height: `${Math.max((point.active / top) * 100, point.active ? 2 : 0)}%`,
                  }}
                />
                <Tip flip={index >= Math.max(points.length / 2, 1) && points.length > 1}>
                  <span className="mb-1 block font-semibold text-ink">{point.label}</span>
                  <TipRow label="Ativas em 7 dias" value={formatCount(point.active)} />
                </Tip>
              </button>
            ))}
          </div>
          <XAxis labels={points.map((point) => point.label)} />
        </div>
      </div>
      <table className="sr-only">
        <caption>Famílias ativas por semana</caption>
        <thead>
          <tr>
            <th scope="col">Semana</th>
            <th scope="col">Ativas em 7 dias</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{point.active}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface DayBar {
  label: string;
  value: number;
  /** Texto da barra para o leitor de tela. */
  text: string;
  details: Array<{ label: string; value: string }>;
}

/** Uma barra por dia, mais o detalhe ao passar o mouse ou focar. `caption` diz o que é a série. */
export function DayBars({
  points,
  caption,
  empty,
  format,
}: {
  points: DayBar[];
  caption: string;
  empty: { title: string; text: string };
  format: (value: number) => string;
}) {
  if (points.every((point) => point.value === 0)) return <EmptyState {...empty} />;
  const top = Math.max(...points.map((point) => point.value));
  return (
    <div>
      <div className="flex gap-2">
        <YAxis top={top} label={format(top)} />
        <div className="min-w-0 flex-1">
          <div className="flex h-48 items-end border-b border-line">
            {points.map((point, index) => (
              <button
                key={point.label}
                type="button"
                aria-label={point.text}
                className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-lg hover:bg-brand-50/60"
              >
                <span
                  aria-hidden="true"
                  className="mx-px block w-full max-w-6 rounded-t bg-series-a"
                  style={{ height: `${Math.max((point.value / top) * 100, point.value ? 2 : 0)}%` }}
                />
                <Tip flip={index >= points.length / 2}>
                  <span className="mb-1 block font-semibold text-ink">{point.label}</span>
                  {point.details.map((detail) => (
                    <TipRow key={detail.label} label={detail.label} value={detail.value} />
                  ))}
                </Tip>
              </button>
            ))}
          </div>
          <XAxis labels={points.map((point) => point.label)} />
        </div>
      </div>
      {/* A caixa recorta: tabela não encolhe abaixo do texto e abriria rolagem lateral no celular. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                <td>{point.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface AdoptionItem {
  label: string;
  families: number;
}

/** Quantas famílias usam cada módulo, do mais usado para o menos usado. */
export function AdoptionBars({
  items,
  total,
  label = "Adoção por módulo",
}: {
  items: AdoptionItem[];
  total: number;
  label?: string;
}) {
  const sorted = [...items].sort((a, b) => b.families - a.families);
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-3.5 p-0">
      {sorted.map((item) => {
        const share = total > 0 ? Math.round((item.families / total) * 100) : 0;
        return (
          <li key={item.label} className="text-sm">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="font-medium">{item.label}</span>
              <span className="tabular-nums text-muted">
                {formatCount(item.families)} {item.families === 1 ? "família" : "famílias"} ·{" "}
                {share}%
              </span>
            </div>
            <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-brand-50">
              <div className="h-full rounded-full bg-series-a" style={{ width: `${share}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export type DayStatus = "ok" | "falha" | "sem";

const dayCell: Record<DayStatus, string> = {
  ok: "bg-brand-500",
  falha: "bg-danger text-white dark:text-night",
  sem: "bg-brand-50",
};

/** Últimos dias de um agente, do mais antigo ao mais recente. A falha leva um sinal, não só cor. */
export function DayStrip({
  days,
  label,
}: {
  days: Array<{ day: string; title: string; status: DayStatus }>;
  label: string;
}) {
  return (
    <ol aria-label={label} className="m-0 flex list-none gap-1 p-0">
      {days.map((item) => (
        <li
          key={item.day}
          title={item.title}
          className={cx(
            "flex h-6 min-w-0 flex-1 items-center justify-center rounded text-[11px] font-bold leading-none",
            dayCell[item.status],
          )}
        >
          <span className="sr-only">{item.title}</span>
          <span aria-hidden="true">{item.status === "falha" ? "!" : ""}</span>
        </li>
      ))}
    </ol>
  );
}
