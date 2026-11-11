"use client";
// Avisos em toast (ADR-0037): um lugar só, no canto da tela, para o que acabou de acontecer.
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  pushToast,
  removeToast,
  TOAST_DURATION,
  type ToastItem,
  type ToastTone,
} from "@/lib/toast-queue";
import { cx } from "./styles";

export interface ToastInput {
  text: string;
  tone?: ToastTone;
  title?: string;
}

export interface ToastApi {
  show: (toast: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Sem provedor (testes, telas fora do layout) devolve null: quem chama mostra o texto no lugar. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((toast: ToastInput) => {
    const item: ToastItem = {
      id: nextId.current++,
      tone: toast.tone ?? "info",
      text: toast.text,
      ...(toast.title ? { title: toast.title } : {}),
    };
    setToasts((list) => pushToast(list, item));
  }, []);
  const dismiss = useCallback((id: number) => setToasts((list) => removeToast(list, id)), []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const tones: Record<
  ToastTone,
  {
    icon: LucideIcon;
    stripe: string;
    chip: string;
    bar: string;
    label: "success" | "error" | "warning" | "info";
  }
> = {
  success: {
    icon: CircleCheck,
    stripe: "border-l-success",
    chip: "bg-success-soft text-success",
    bar: "bg-success",
    label: "success",
  },
  error: {
    icon: CircleAlert,
    stripe: "border-l-danger",
    chip: "bg-danger-soft text-danger",
    bar: "bg-danger",
    label: "error",
  },
  warning: {
    icon: TriangleAlert,
    stripe: "border-l-warning",
    chip: "bg-warning-soft text-warning",
    bar: "bg-warning",
    label: "warning",
  },
  info: {
    icon: Info,
    stripe: "border-l-brand-500",
    chip: "bg-brand-50 text-brand-700",
    bar: "bg-brand-500",
    label: "info",
  },
};

/**
 * A pilha vive na camada de topo (popover manual): fica por cima de painéis e diálogos abertos.
 * Com um diálogo modal aberto, o toast aparece, mas só volta a ser clicável quando ele fecha.
 */
function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const t = useTranslations("toast");
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef(0);

  useEffect(() => {
    const region = ref.current;
    if (!region || typeof region.showPopover !== "function") return;
    const latest = toasts[toasts.length - 1]?.id ?? 0;
    try {
      if (toasts.length === 0) {
        if (region.matches(":popover-open")) region.hidePopover();
      } else if (latest !== shown.current) {
        // Reabre para subir acima do que foi aberto depois dela.
        if (region.matches(":popover-open")) region.hidePopover();
        region.showPopover();
      }
    } catch {
      // Navegador sem popover: a pilha fica visível como elemento comum.
    }
    shown.current = latest;
  }, [toasts]);

  return (
    <div
      ref={ref}
      popover="manual"
      aria-label={t("region")}
      className="pointer-events-none fixed inset-auto top-3 right-3 left-3 m-0 flex h-auto w-auto flex-col gap-2 overflow-visible border-0 bg-transparent p-0 text-ink sm:top-4 sm:right-4 sm:left-auto sm:w-88"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const t = useTranslations("toast");
  const tone = tones[toast.tone];
  const Icon = tone.icon;
  const duration = TOAST_DURATION[toast.tone];
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);
  const startedAt = useRef(0);

  // O relógio para com o mouse ou o foco em cima e recomeça de onde parou.
  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, onDismiss]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cx(
        "toast-card pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-2xl border border-line border-l-4 bg-card py-3 pr-2 pl-3 shadow-card",
        tone.stripe,
      )}
    >
      <span
        className={cx(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          tone.chip,
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 py-1 text-sm">
        <p className="m-0 font-semibold">{toast.title ?? t(tone.label)}</p>
        <p className="m-0 mt-0.5 break-words text-muted">{toast.text}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("close")}
        className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-brand-50 hover:text-ink"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <span
        aria-hidden="true"
        style={{ animationDuration: `${duration}ms` }}
        className={cx(
          "toast-timer absolute inset-x-0 bottom-0 h-0.5 origin-left opacity-60",
          tone.bar,
          paused && "[animation-play-state:paused]",
        )}
      />
    </div>
  );
}
