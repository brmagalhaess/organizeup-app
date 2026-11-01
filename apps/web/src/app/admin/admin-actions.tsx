"use client";
// Botões do painel que disparam ação no servidor. O resultado aparece logo abaixo do botão.
import { useState, useTransition, type ReactNode } from "react";
import { Button, ConfirmSheet, FormMessage } from "@/components/ui";
import type { ButtonVariant } from "@/components/styles";
import { cx } from "@/components/styles";
import type { AdminResult } from "./painel-result";

type ServerAction = (form: FormData) => Promise<AdminResult>;

/** Ação com confirmação: destrutiva, ou que muda o que as famílias veem. */
export function ConfirmAction({
  label,
  ariaLabel,
  variant = "secondary",
  action,
  hidden,
  title,
  text,
  confirmLabel,
  typeToConfirm,
  fields,
}: {
  label: ReactNode;
  ariaLabel?: string;
  variant?: ButtonVariant;
  action: ServerAction;
  hidden: Record<string, string>;
  title: string;
  text: string;
  confirmLabel: string;
  typeToConfirm?: { label: string; value: string };
  fields?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<AdminResult | null>(null);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        small
        aria-label={ariaLabel}
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <FormMessage message={result?.message} tone={result?.ok ? "ok" : "error"} />
      <ConfirmSheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        text={text}
        confirmLabel={confirmLabel}
        action={async (form) => {
          setResult(await action(form));
        }}
        hidden={hidden}
        typeToConfirm={typeToConfirm}
      >
        {fields}
      </ConfirmSheet>
    </div>
  );
}

/** Ação direta, sem efeito destrutivo. */
export function RunAction({
  label,
  ariaLabel,
  pendingLabel,
  variant = "secondary",
  action,
  hidden = {},
}: {
  label: ReactNode;
  ariaLabel?: string;
  pendingLabel: string;
  variant?: ButtonVariant;
  action: ServerAction;
  hidden?: Record<string, string>;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminResult | null>(null);
  return (
    <form
      className="flex min-w-0 flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        start(async () => setResult(await action(form)));
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} small disabled={pending} aria-label={ariaLabel}>
        {pending ? pendingLabel : label}
      </Button>
      <FormMessage message={result?.message} tone={result?.ok ? "ok" : "error"} />
    </form>
  );
}

/** Interruptor ligado ou desligado. */
export function Switch({
  label,
  checked,
  action,
  hidden,
}: {
  label: string;
  checked: boolean;
  action: ServerAction;
  hidden: Record<string, string>;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AdminResult | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={pending}
        onClick={() => {
          const form = new FormData();
          for (const [name, value] of Object.entries(hidden)) form.set(name, value);
          form.set("enabled", String(!checked));
          start(async () => setResult(await action(form)));
        }}
        className={cx(
          "relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-60",
          checked ? "bg-brand-500" : "bg-stone",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-5",
          )}
        />
      </button>
      {result && !result.ok ? <FormMessage message={result.message} /> : null}
    </div>
  );
}
