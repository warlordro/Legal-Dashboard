import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Mail, RefreshCw, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { me, MonitoringApiError, type EmailSettings } from "@/lib/api";
import { cn } from "@/lib/utils";

type LoadState = "idle" | "loading" | "ready" | "error";
type ActionState = "idle" | "saving" | "testing";

interface EmailSettingsDraft {
  enabled: boolean;
  toAddress: string;
}

const DEFAULT_DRAFT: EmailSettingsDraft = {
  enabled: false,
  toAddress: "",
};

function toDraft(settings: EmailSettings): EmailSettingsDraft {
  return {
    enabled: settings.enabled,
    toAddress: settings.toAddress ?? "",
  };
}

export function canSaveEmailSettings(
  draft: EmailSettingsDraft,
  original: EmailSettingsDraft | null,
): boolean {
  if (draft.enabled && draft.toAddress.trim().length === 0) return false;
  if (draft.toAddress.trim().length > 320) return false;
  if (!original) return true;
  return (
    draft.enabled !== original.enabled
    || draft.toAddress.trim() !== original.toAddress.trim()
  );
}

function messageFromError(err: unknown): string {
  if (err instanceof MonitoringApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Operatiunea nu a reusit.";
}

function reasonLabel(reason: string | undefined): string {
  if (reason === "mailer_disabled") return "SMTP nu este configurat.";
  if (reason === "send_failed") return "Email-ul nu a putut fi trimis.";
  if (reason === "no_recipient") return "Lipseste adresa destinatarului.";
  return "Email-ul nu a putut fi trimis.";
}

export function EmailSettingsPanel() {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [draft, setDraft] = useState<EmailSettingsDraft>(DEFAULT_DRAFT);
  const [state, setState] = useState<LoadState>("idle");
  const [action, setAction] = useState<ActionState>("idle");
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);

  const originalDraft = useMemo(() => (settings ? toDraft(settings) : null), [settings]);
  const canSave = canSaveEmailSettings(draft, originalDraft);
  const canTest = Boolean(settings?.mailerConfigured && settings.toAddress && action === "idle");

  const load = useCallback(async () => {
    const controller = new AbortController();
    setState("loading");
    setMessage(null);
    try {
      const next = await me.emailSettings.get(controller.signal);
      setSettings(next);
      setDraft(toDraft(next));
      setState("ready");
    } catch (err) {
      setState("error");
      setMessage({ tone: "error", text: messageFromError(err) });
    }
    return () => controller.abort();
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setAction("saving");
    setMessage(null);
    try {
      const next = await me.emailSettings.put({
        enabled: draft.enabled,
        toAddress: draft.toAddress.trim() || null,
      });
      setSettings(next);
      setDraft(toDraft(next));
      setMessage({ tone: "ok", text: "Setarile email au fost salvate." });
    } catch (err) {
      setMessage({ tone: "error", text: messageFromError(err) });
    } finally {
      setAction("idle");
    }
  }, [draft]);

  const sendTest = useCallback(async () => {
    setAction("testing");
    setMessage(null);
    try {
      const result = await me.emailSettings.test();
      if (result.ok) {
        setMessage({ tone: "ok", text: "Email-ul de test a fost trimis." });
      } else {
        setMessage({ tone: "error", text: reasonLabel(result.reason) });
      }
    } catch (err) {
      setMessage({ tone: "error", text: messageFromError(err) });
    } finally {
      setAction("idle");
    }
  }, []);

  const smtpText = settings?.mailerConfigured ? "SMTP configurat" : "SMTP neconfigurat";

  return (
    <section className="mb-3 rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-sky-600" />
            Notificari email
          </h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Toate alertele noi de monitorizare pot fi trimise si pe email.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { void load(); }}
          disabled={state === "loading" || action !== "idle"}
          className="h-8"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", state === "loading" && "animate-spin")} />
          Verifica
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
            className="h-4 w-4"
          />
          Activeaza notificarile pe email
        </label>

        <div className="rounded-md border border-border bg-background px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            {settings?.mailerConfigured ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-600" />
            )}
            <span className="font-medium">{smtpText}</span>
          </div>
          <p className="mt-1 text-muted-foreground">
            Configurarea SMTP se face in fisierul `.env` al backend-ului.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        <label className="text-xs font-medium">
          Adresa email
          <input
            type="email"
            value={draft.toAddress}
            onChange={(e) => setDraft((prev) => ({ ...prev, toAddress: e.target.value }))}
            placeholder="alerts@firma.ro"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
        </label>
      </div>

      {message && (
        <div
          className={cn(
            "mt-3 rounded-md border px-3 py-2 text-xs",
            message.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
              : message.tone === "error"
                ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300",
          )}
        >
          {message.text}
        </div>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={sendTest}
          disabled={!canTest}
          title={!settings?.mailerConfigured ? "SMTP nu este configurat" : undefined}
          className="h-8"
        >
          {action === "testing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Trimite test
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={!canSave || action !== "idle"}
          className="h-8"
        >
          {action === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salveaza
        </Button>
      </div>
    </section>
  );
}
