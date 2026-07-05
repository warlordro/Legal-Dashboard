import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

// v2.42.0 (Nivel 2 UX): strat de notificari trecatoare — pana acum succesul
// mutatiilor era implicit (refetch), iar unele erori fire-and-forget erau
// complet tacute (doar console.error). Provider propriu pe pattern-ul
// ConfirmProvider: fara dependenta externa, tematizat, aria-live.

export type ToastVariant = "success" | "error" | "info";

export interface ToastOptions {
  variant?: ToastVariant;
  /** ms pana la auto-inchidere; erorile stau implicit mai mult */
  durationMs?: number;
}

type ToastFn = (message: string, opts?: ToastOptions) => void;

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 7000;
const MAX_VISIBLE = 4;

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/60 dark:text-green-300",
  error: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300",
  info: "border-border bg-card text-foreground",
};

function VariantIcon({ variant }: { variant: ToastVariant }) {
  if (variant === "success") return <CheckCircle2 className="h-4 w-4 shrink-0" />;
  if (variant === "error") return <AlertTriangle className="h-4 w-4 shrink-0" />;
  return <Info className="h-4 w-4 shrink-0" />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (message, opts) => {
      const variant = opts?.variant ?? "info";
      const id = nextId.current++;
      // Cap defensiv: pastram doar ultimele MAX_VISIBLE (cele vechi dispar).
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, message, variant }]);
      const duration = opts?.durationMs ?? (variant === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration)
      );
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="pointer-events-none fixed bottom-4 right-4 z-[110] flex w-full max-w-sm flex-col gap-2"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={cn(
                "pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg",
                VARIANT_STYLES[t.variant]
              )}
            >
              <VariantIcon variant={t.variant} />
              <span className="flex-1 whitespace-pre-line">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Inchide notificarea"
                className="rounded p-0.5 opacity-60 hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
