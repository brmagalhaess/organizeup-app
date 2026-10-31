// Blocos das telas do painel, sobre o kit do app. Sem estado: servem a páginas e a quadros do cliente.
import { AlertTriangle, CircleAlert, Info, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/styles";
import { PageHeader } from "@/components/ui";
import type { AdminAlert } from "./alertas";

export function AdminPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Painel do serviço"
        title={title}
        description={description}
        actions={actions}
      />
      {children}
    </>
  );
}

/** Número de destaque com ícone e, se houver, a tendência das últimas semanas. */
export function Tile({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  alarm = false,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  icon: LucideIcon;
  trend?: number[];
  /** Destaca o número como problema. */
  alarm?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5">
      <dt className="flex items-center gap-2 text-sm text-muted">
        <span
          className={cx(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            alarm ? "bg-danger-soft text-danger" : "bg-brand-50 text-brand-700",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">{label}</span>
      </dt>
      <dd className="m-0 flex items-end justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-2xl font-semibold tracking-tight sm:text-3xl">{value}</span>
          {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
        </span>
        {trend && trend.length > 1 ? <Sparkline values={trend} /> : null}
      </dd>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const top = Math.max(...values);
  const bottom = Math.min(...values);
  const span = top - bottom || 1;
  const x = (index: number) => (index / (values.length - 1)) * 100;
  const y = (value: number) => 28 - ((value - bottom) / span) * 24;
  const line = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className="hidden h-8 w-20 shrink-0 text-brand-500 sm:block"
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
  );
}

const alertStyles: Record<AdminAlert["tone"], { box: string; icon: LucideIcon }> = {
  danger: { box: "border-danger/30 bg-danger-soft", icon: CircleAlert },
  warning: { box: "border-warning/30 bg-warning-soft", icon: AlertTriangle },
  info: { box: "border-line bg-card-soft", icon: Info },
};

export function AlertList({ alerts }: { alerts: AdminAlert[] }) {
  return (
    <ul aria-label="Alertas" className="m-0 grid list-none gap-2 p-0 xl:grid-cols-2">
      {alerts.map((alert) => {
        const { box, icon: Icon } = alertStyles[alert.tone];
        return (
          <li key={alert.key} className={cx("flex gap-3 rounded-2xl border p-4", box)}>
            <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">{alert.title}</p>
              <p className="text-ink/80">{alert.text}</p>
            </div>
            <Link
              href={alert.href}
              className="shrink-0 self-center text-sm font-semibold underline underline-offset-2"
            >
              Ver
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export interface Column {
  key: string;
  label: string;
  align?: "right";
  /** Coluna principal: no celular vira o título do cartão, sem rótulo. */
  primary?: boolean;
}

/**
 * Lista em forma de tabela no computador e de cartões no celular. Sem rolagem lateral: no celular
 * cada célula ganha o próprio rótulo.
 */
export function AdminTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: Column[];
  rows: Array<{ id: string; cells: Record<string, ReactNode> }>;
}) {
  return (
    <table className="block w-full border-collapse text-sm md:table">
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only md:not-sr-only md:table-header-group">
        <tr className="md:border-b md:border-line">
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={cx(
                "whitespace-nowrap px-3 py-2 text-xs font-semibold text-muted",
                column.align === "right" ? "text-right" : "text-left",
              )}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="flex flex-col gap-2 md:table-row-group">
        {rows.map((row) => (
          <tr
            key={row.id}
            className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-xl border border-line bg-card-soft p-3 md:table-row md:rounded-none md:border-0 md:border-b md:bg-transparent md:p-0 md:last:border-0"
          >
            {columns.map((column) => (
              <td
                key={column.key}
                className={cx(
                  "flex min-w-0 flex-col items-start gap-0.5 md:table-cell md:px-3 md:py-3",
                  column.align === "right" && "md:text-right md:tabular-nums",
                  column.primary && "col-span-2 font-medium",
                )}
              >
                {column.primary ? null : (
                  <span className="text-xs text-muted md:hidden">{column.label}</span>
                )}
                <span className="min-w-0 break-words">{row.cells[column.key]}</span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Inicial num círculo, para a linha ter um ponto de apoio além do texto. */
export function Monogram({ name, children }: { name: string; children: ReactNode }) {
  const letter = name
    .replace(/^Família\s+/i, "")
    .charAt(0)
    .toUpperCase();
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sand-100 text-sm font-semibold text-night"
      >
        {letter || "?"}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3">{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 mt-0.5 break-words font-medium">{children}</dd>
    </div>
  );
}
