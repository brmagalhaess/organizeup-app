// Marca do OrganizeUp: o "O" com a seta que sai para cima, e o nome ao lado. O desenho é o mesmo de
// `app/icon.svg` (favicon); aqui muda só a cor, conforme o fundo.
import { cx } from "@/components/styles";

/** Fundo em que a marca aparece: claro (cartões, telas) ou escuro (menu, faixa verde). */
export type BrandTone = "light" | "dark";

const PALETTE: Record<BrandTone, { square: string; ring: string; arrow: string }> = {
  // Em fundo claro, o quadro é o verde da marca.
  light: { square: "#1d4235", ring: "#fbf8f1", arrow: "#f6c9a8" },
  // Em fundo verde, o quadro vira claro para não sumir.
  dark: { square: "#faf6ee", ring: "#1d4235", arrow: "#a84c2a" },
};

/** Só o símbolo. Decorativo: o nome ao lado, ou o rótulo do link, é que diz o que é. */
export function BrandMark({ tone = "light", className }: { tone?: BrandTone; className?: string }) {
  const { square, ring, arrow } = PALETTE[tone];
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={cx("size-8 shrink-0", className)}
    >
      <rect width="64" height="64" rx="15" fill={square} />
      <circle cx="28" cy="37" r="14" fill="none" stroke={ring} strokeWidth="7" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M29 36 49 16M37 15.5h12.5V28" stroke={square} strokeWidth="14" />
        <path d="M29 36 49 16M37 15.5h12.5V28" stroke={arrow} strokeWidth="7" />
      </g>
    </svg>
  );
}

const SIZE = {
  sm: { mark: "size-7", text: "text-lg" },
  md: { mark: "size-8", text: "text-xl" },
  lg: { mark: "size-10", text: "text-2xl" },
} as const;

/**
 * Símbolo e nome. O texto continua sendo "OrganizeUp", inteiro: é ele que dá nome ao link para leitor de tela
 * e para os testes. `name` troca o texto quando a tela já traz o nome traduzido.
 */
export function Brand({
  tone = "light",
  size = "md",
  name = "OrganizeUp",
  className,
}: {
  tone?: BrandTone;
  size?: keyof typeof SIZE;
  name?: string;
  className?: string;
}) {
  const split = name === "OrganizeUp";
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <BrandMark tone={tone} className={SIZE[size].mark} />
      <span
        className={cx(
          "font-display font-semibold tracking-tight",
          SIZE[size].text,
          tone === "dark" ? "text-white" : "text-brand-900 dark:text-brand-100",
        )}
      >
        {split ? (
          <>
            Organize<span className={tone === "dark" ? "text-peach" : "text-brand-500"}>Up</span>
          </>
        ) : (
          name
        )}
      </span>
    </span>
  );
}
