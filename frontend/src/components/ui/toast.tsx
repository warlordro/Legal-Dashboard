import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

// v2.42.0 (6.3): sistem de toast-uri in-house, fara dependenta, pe pattern-ul
// ConfirmProvider. Variante success/error/info; auto-dismiss 4s (7s la error);
// cap 4 vizibile cu evictie FIFO; container aria-live="polite" bottom-right.
//
// Capcane inchise din review:
//   - TOATE timerele se curata la unmount (cleanup pe Map-ul de timere);
//   - la evictie prin cap, clearTimeout pe toast-urile scoase;
//   - dismiss-ul manual curata timerul propriu.

export type ToastVariant = "success" | "error" | "info";

export interface ToastOptions {
  variant?: ToastVariant;
  // Suprascrie durata de auto-dismiss (ms). Default: 4000 / 7000 la error.
  durationMs?: number;
}

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

type ToastFn = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const fn = useContext(ToastContext);
  if (fn === null) {
    throw new Error("useToast trebuie apelat sub <ToastProvider>");
  }
  return fn;
}

const MAX_VISIBLE = 4;
const DURATION_MS = 4000;
const DURATION_ERROR_MS = 7000;

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/60 dark:text-green-300",
  error: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300",
  info: "border-border bg-card text-foreground",
};

const VARIANT_ICONS: Record<ToastVariant, typeof Info> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer]
  );

  const toast = useCallback<ToastFn>(
    (message, options = {}) => {
      const variant = options.variant ?? "info";
      const id = nextId.current++;
      setToasts((prev) => {
        const next = [...prev, { id, message, variant }];
        // Evictie prin cap: cele mai vechi ies — cu timerul curatat.
        const evicted = next.slice(0, Math.max(0, next.length - MAX_VISIBLE));
        for (const t of evicted) clearTimer(t.id);
        return next.slice(-MAX_VISIBLE);
      });
      const duration = options.durationMs ?? (variant === "error" ? DURATION_ERROR_MS : DURATION_MS);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration)
      );
    },
    [clearTimer, dismiss]
  );

  // Unmount: curata TOATE timerele — fara el, un setTimeout orfan face
  // setState pe provider demontat.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[110] flex flex-col gap-2">
        {toasts.map((t) => {
          const Icon = VARIANT_ICONS[t.variant];
          return (
            <output
              key={t.id}
              className={cn(
                "pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg",
                VARIANT_STYLES[t.variant]
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1 whitespace-pre-line">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Inchide notificarea"
                className="rounded p-0.5 opacity-70 hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </output>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
