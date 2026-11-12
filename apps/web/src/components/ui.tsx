"use client";
// Kit de componentes (ADR-0003). Toda tela usa estes blocos para manter o sistema consistente.
import { Ellipsis, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormStatus } from "react-dom";
import {
  cloneElement,
  isValidElement,
  startTransition,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { amountClass, buttonClass, cx, type ButtonVariant } from "./styles";
import { useToast } from "./toast";

/**
 * Envia o formulário sem o reset automático do React: com erro de validação, os campos continuam
 * preenchidos. Use no lugar de action={action}.
 */
export function submitKeeping(action: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => action(form));
  };
}

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
          <div className="min-w-0 flex-1 basis-60">
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
  tone,
  icon,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  tone?: "receita" | "despesa";
  /** Ícone decorativo, no canto: ajuda a achar o número de relance. */
  icon?: ReactNode;
}) {
  return (
    <div className="relative min-w-0 rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5">
      {icon ? (
        <span
          aria-hidden="true"
          className="absolute right-4 top-4 hidden size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700 sm:flex"
        >
          {icon}
        </span>
      ) : null}
      <dt className={cx("text-sm text-muted", icon ? "sm:pr-11" : null)}>{label}</dt>
      <dd className="m-0 mt-2">
        <span
          className={cx(
            "block whitespace-nowrap text-lg font-semibold tabular-nums tracking-tight sm:text-2xl",
            tone && amountClass(tone),
          )}
        >
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

/**
 * Resultado de um formulário. Erro fica no lugar, perto do botão (role=alert). Sucesso vira toast
 * (ADR-0037) quando há provedor; `inline` segura o texto na tela quando ele precisa ficar visível.
 */
export function FormMessage({
  message,
  tone = "error",
  inline = false,
}: {
  message?: string | null | undefined;
  tone?: "error" | "ok";
  inline?: boolean;
}) {
  const toast = useToast();
  const { pending } = useFormStatus();
  const asToast = toast !== null && tone === "ok" && !inline;
  const wasPending = useRef(false);
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    // Mesmo texto duas vezes seguidas (dois "Salvo.") avisa de novo: o envio terminou outra vez.
    const settled = wasPending.current && !pending;
    wasPending.current = pending;
    if (!asToast || !message) return;
    if (settled || message !== lastShown.current) {
      lastShown.current = message;
      toast.show({ tone: "success", text: message });
    }
  }, [asToast, message, pending, toast]);
  if (!message || asToast) return null;
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
  const t = useTranslations("common");
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
            <IconButton label={t("close")} onClick={onClose}>
              <X className="size-5" aria-hidden="true" />
            </IconButton>
          </header>
          <div className="flex-1 p-5">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}

function ConfirmButton({ label, blocked }: { label: string; blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" className="flex-1" disabled={pending || blocked}>
      {label}
    </Button>
  );
}

/**
 * Pede confirmação antes de uma ação que não pode ser desfeita. Com `typeToConfirm`, o botão só
 * libera depois de digitar o texto pedido; o valor vai no campo `confirm` do formulário, e o servidor
 * deve conferir de novo. `children` são campos extras do formulário.
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  text,
  confirmLabel,
  action,
  hidden,
  typeToConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  text: string;
  confirmLabel: string;
  action: (form: FormData) => void | Promise<void>;
  hidden: Record<string, string>;
  typeToConfirm?: { label: string; value: string } | undefined;
  children?: ReactNode;
}) {
  const t = useTranslations("common");
  const [typed, setTyped] = useState("");
  const close = () => {
    setTyped("");
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title={title}>
      <p className="text-sm text-muted">{text}</p>
      <form
        action={async (form) => {
          await action(form);
          close();
        }}
        className="mt-6 flex flex-col gap-4"
      >
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {children}
        {typeToConfirm ? (
          <Field label={typeToConfirm.label}>
            <Input
              name="confirm"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </Field>
        ) : null}
        <div className="flex gap-2">
          <ConfirmButton
            label={confirmLabel}
            blocked={Boolean(typeToConfirm) && typed.trim() !== typeToConfirm?.value}
          />
          <Button type="button" variant="secondary" onClick={close}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  tone?: "danger";
}

/**
 * Menu de ações secundárias atrás de um botão "⋯": a linha fica limpa e as ações continuam a um clique.
 * Usa popover nativo (camada de topo, fecha com Esc ou clique fora) e se posiciona sob o botão.
 */
export function ActionMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const place = () => {
    const anchor = button.current?.getBoundingClientRect();
    const panel = menu.current;
    if (!anchor || !panel) return;
    const width = panel.offsetWidth;
    const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
    panel.style.top = `${anchor.bottom + 4}px`;
    panel.style.left = `${left}px`;
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-brand-50 hover:text-ink"
      >
        <Ellipsis className="size-4" aria-hidden="true" />
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="menu"
        aria-label={label}
        onToggle={(event) => {
          if (event.newState === "open") place();
        }}
        className="m-0 w-52 rounded-xl border border-line bg-card p-1 text-ink shadow-card"
      >
        {items.map((item) => {
          const classes = cx(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50",
            item.tone === "danger" ? "text-danger" : "text-ink",
          );
          const close = () => menu.current?.hidePopover();
          return item.href ? (
            <a
              key={item.label}
              role="menuitem"
              href={item.href}
              className={classes}
              onClick={close}
            >
              {item.icon}
              {item.label}
            </a>
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={classes}
              onClick={() => {
                close();
                item.onClick?.();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
