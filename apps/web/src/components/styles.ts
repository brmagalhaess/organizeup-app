// Classes compartilhadas. Sem "use client": telas do servidor e do navegador usam as mesmas.
export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-brand-900 text-white hover:bg-brand-700",
  accent: "bg-peach text-night hover:bg-white",
  secondary: "border border-line bg-card text-ink hover:bg-brand-50",
  ghost: "text-ink hover:bg-brand-50",
  danger: "bg-danger text-white hover:opacity-90 dark:text-night",
};

export const buttonClass = (variant: ButtonVariant = "primary", small = false) =>
  cx(
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:opacity-60",
    small ? "min-h-9 px-3 text-sm" : "min-h-11 px-4 text-sm",
    buttonVariants[variant],
  );
