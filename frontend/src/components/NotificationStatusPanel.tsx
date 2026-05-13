import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Bell, CheckCircle2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DesktopNotificationStatus } from "@/types/desktop-api";
import { cn } from "@/lib/utils";
import {
  getAlertsNotificationsEnabled,
  setAlertsNotificationsEnabled,
  subscribeAlertsNotificationsPref,
} from "@/lib/alertsNotificationPref";

type LoadState = "idle" | "loading" | "ready" | "error";

function platformLabel(platform: string): string {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform || "Desktop";
}

function statusTone(status: DesktopNotificationStatus | null): "ok" | "blocked" | "unknown" {
  if (!status) return "unknown";
  if (status.canNotify === true) return "ok";
  if (status.canNotify === false) return "blocked";
  return "unknown";
}

function statusText(status: DesktopNotificationStatus | null): string {
  if (!window.desktopApi?.getNotificationStatus) {
    return "Indisponibil in browser";
  }
  if (!status) return "Status necunoscut";
  if (!status.supported) return "Nesuportat";
  if (status.canNotify === true) return "Active";
  if (status.canNotify === false) return "Blocate";
  return "Necunoscut";
}

export function NotificationStatusPanel() {
  const [status, setStatus] = useState<DesktopNotificationStatus | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(() => getAlertsNotificationsEnabled());
  const desktopAvailable = Boolean(window.desktopApi?.getNotificationStatus);

  useEffect(() => {
    return subscribeAlertsNotificationsPref(setAlertsEnabled);
  }, []);

  const toggleAlerts = useCallback((next: boolean) => {
    setAlertsEnabled(next);
    setAlertsNotificationsEnabled(next);
  }, []);

  const load = useCallback(async () => {
    if (!window.desktopApi?.getNotificationStatus) {
      setStatus(null);
      setState("ready");
      return;
    }
    setState("loading");
    setError(null);
    try {
      const nextStatus = await window.desktopApi.getNotificationStatus();
      setStatus(nextStatus);
      setState("ready");
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Statusul notificarilor nu a putut fi citit.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sendTest = useCallback(async () => {
    if (!window.desktopApi?.showTestNotification) return;
    setTestState("sending");
    try {
      const ok = await window.desktopApi.showTestNotification();
      setTestState(ok ? "sent" : "failed");
      await load();
    } catch {
      setTestState("failed");
    }
  }, [load]);

  const tone = statusTone(status);
  const Icon = tone === "ok" ? CheckCircle2 : AlertCircle;
  const toneClass =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
      : tone === "blocked"
        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
        : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300";

  return (
    <section className="mb-3 rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="h-4 w-4 text-amber-500" />
            Notificari sistem
          </h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Alertele noi raman in aplicatie si pot fi trimise si prin sistemul nativ.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={load}
            disabled={state === "loading"}
            className="h-8"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", state === "loading" && "animate-spin")} />
            Verifica
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={sendTest}
            disabled={!desktopAvailable || testState === "sending" || status?.canNotify === false || !alertsEnabled}
            className="h-8"
            title={!alertsEnabled ? "Activeaza notificarile pentru a putea testa." : undefined}
          >
            <Send className="h-3.5 w-3.5" />
            Test
          </Button>
        </div>
      </div>

      <div className={cn("rounded-md border px-3 py-2 text-xs", toneClass)}>
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">
              {statusText(status)}
              {status?.platform ? ` - ${platformLabel(status.platform)}` : ""}
            </p>
            <p className="mt-1 break-words">
              {error || status?.reason || "Statusul exact este disponibil doar in aplicatia desktop."}
            </p>
            {testState === "sent" && (
              <p className="mt-1 text-emerald-700 dark:text-emerald-300">Notificarea de test a fost trimisa.</p>
            )}
            {testState === "failed" && (
              <p className="mt-1 text-red-700 dark:text-red-300">Notificarea de test nu a putut fi afisata.</p>
            )}
          </div>
        </div>
      </div>

      <label className="mt-3 flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={alertsEnabled}
          onChange={(e) => toggleAlerts(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span className="min-w-0">
          <span className="font-medium">Trimite notificari sistem pentru alerte noi</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Cand e oprit, popup-urile Windows/macOS sunt suprimate; bulina cu numar si pagina Alerts raman intacte. Cele
            suprimate nu se stocheaza — la reactivare nu primesti flood. Setarea se pastreaza dupa restart.
          </span>
        </span>
      </label>
    </section>
  );
}
