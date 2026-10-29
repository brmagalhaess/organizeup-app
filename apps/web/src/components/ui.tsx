"use client";
// Kit mínimo de componentes (ADR-0003). Crescerá com input monetário, date picker pt-BR etc.
import {
  cloneElement,
  isValidElement,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition disabled:opacity-60",
        variant === "primary" && "bg-brand-900 text-white hover:bg-brand-700",
        variant === "secondary" && "border border-line bg-card text-ink hover:bg-brand-50",
        className,
      )}
    />
  );
}

/**
 * Rótulo + controle + dica/erro, ligados por htmlFor e aria-describedby.
 * `children` deve ser um único Input/Select.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && !error ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
      })
    : children;
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {control}
      {hint && !error ? (
        <span id={hintId} className="text-xs text-muted">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

const inputClass =
  "min-h-11 rounded-lg border border-line bg-card px-3 text-base text-ink placeholder:text-muted focus:border-brand-500";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, props.className)} />;
}

export function Card({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      {title || actions ? (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="text-base font-semibold">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function FormMessage({
  message,
  tone = "error",
}: {
  message?: string | null | undefined;
  tone?: "error" | "ok";
}) {
  if (!message) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cx("text-sm", tone === "error" ? "text-danger" : "text-brand-700")}
    >
      {message}
    </p>
  );
}
