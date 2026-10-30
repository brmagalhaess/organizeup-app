"use client";
// Kit de componentes (ADR-0003). Toda tela usa estes blocos para manter o sistema consistente.
import { X } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { buttonClass, cx, type ButtonVariant } from "./styles";

export function Button({
  variant = "primary",
  small = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; small?: boolean }) {
  return <button {...props} className={cx(buttonClass(variant, small), className)} />;
}

/** Botão só com ícone. O rótulo é obrigatório para leitores de tela. */
export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        "inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-brand-50 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
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
    <div className="flex min-w-0 flex-col gap-1.5 text-sm">
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
  "min-h-11 w-full min-w-0 rounded-xl border border-line bg-card px-3 text-base text-ink placeholder:text-muted focus:border-brand-500 sm:text-sm";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, props.className)} />;
}

export function Card({
  title,
  description,
  children,
  actions,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx("rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6", className)}
    >
      {title || actions ? (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-500">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 font-display text-3xl font-medium first-letter:uppercase sm:text-4xl">
          {title}
        </h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="m-0 mt-2">
        <span className="block whitespace-nowrap text-lg font-semibold tabular-nums tracking-tight sm:text-2xl">
          {value}
        </span>
        {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
      </dd>
    </div>
  );
}

const badgeTones = {
  neutral: "bg-brand-50 text-muted",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {text ? <p className="max-w-md text-sm text-muted">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
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
      className={cx("text-sm", tone === "error" ? "text-danger" : "text-success")}
    >
      {message}
    </p>
  );
}

/** Painel para formulários: lateral no computador, de baixo para cima no celular. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border-0 bg-card p-0 text-ink shadow-2xl sm:ml-auto sm:mt-0 sm:h-dvh sm:max-h-dvh sm:max-w-md sm:rounded-none"
    >
      {open ? (
        <div className="flex min-h-full flex-col">
          <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-card px-5 py-4">
            <h2 className="font-display text-xl font-medium">{title}</h2>
            <IconButton label="Fechar" onClick={onClose}>
              <X className="size-5" aria-hidden="true" />
            </IconButton>
          </header>
          <div className="flex-1 p-5">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}

/** Pede confirmação antes de uma ação que não pode ser desfeita. */
export function ConfirmSheet({
  open,
  onClose,
  title,
  text,
  confirmLabel,
  action,
  hidden,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  text: string;
  confirmLabel: string;
  action: (form: FormData) => void | Promise<void>;
  hidden: Record<string, string>;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="text-sm text-muted">{text}</p>
      <form
        action={async (form) => {
          await action(form);
          onClose();
        }}
        className="mt-6 flex gap-2"
      >
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Button type="submit" variant="danger" className="flex-1">
          {confirmLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </form>
    </Sheet>
  );
}
