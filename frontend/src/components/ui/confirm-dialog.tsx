import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

type State = ConfirmOptions & { resolve: (v: boolean) => void };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    const normalized: ConfirmOptions = typeof opts === "string" ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => {
      setState({ ...normalized, resolve });
    });
  }, []);

  const close = (value: boolean) => {
    setState((prev) => {
      prev?.resolve(value);
      return null;
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: close este callback local pentru dialogul curent; includerea lui rebindeaza handlerul la fiecare render.
  useEffect(() => {
    if (!state) return;
    confirmBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => close(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 px-5 pt-5">
              {state.destructive && (
                <div className="shrink-0 rounded-full bg-red-500/10 p-2">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
              )}
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {state.title ?? (state.destructive ? "Confirmare stergere" : "Confirmare")}
                </h3>
                <p className={cn("mt-1 whitespace-pre-line text-sm text-muted-foreground")}>{state.message}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => close(false)}>
                {state.cancelLabel ?? "Anuleaza"}
              </Button>
              <Button
                ref={confirmBtnRef}
                variant={state.destructive ? "destructive" : "default"}
                size="sm"
                onClick={() => close(true)}
              >
                {state.confirmLabel ?? "Continua"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
