import { useEffect, useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { useTenantKeyStatus } from "@/hooks/useTenantKeyStatus";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { admin, type TenantKeysResult } from "@/lib/api";
import { Button } from "@/components/ui/button";

// v2.41.0 (P3/P4): starea cheilor tenant in web mode, pe roluri.
//   - admin: inventar per provider (Configurata *ultimele4 / Neconfigurata) +
//     buton catre administrarea cheilor (/admin/keys);
//   - non-admin: NIMIC daca totul e configurat; altfel UN SINGUR banner amber
//     ("contacteaza administratorul"). Non-adminul nu vede inventarul.
// Continutul se randeaza doar cand SERVERUL e in web mode (tenantMode), nu doar
// pe runtime-ul de browser: in dev-combo (browser + backend desktop-auth)
// flag-urile vin toate false si inventarul ar minti.

const PROVIDER_LABELS: { key: "anthropic" | "openai" | "google" | "openrouter" | "captcha"; label: string }[] = [
  { key: "anthropic", label: "Anthropic (Claude)" },
  { key: "openai", label: "OpenAI (GPT)" },
  { key: "google", label: "Google (Gemini)" },
  { key: "openrouter", label: "OpenRouter" },
  { key: "captcha", label: "Captcha RNPM" },
];

// `onManageKeys`: cand e dat (pagina /setari), butonul comuta pe tabul de chei
// in loc sa navigheze la /admin/keys — adminul ramane in Setari.
export function TenantKeyStatusPanel({ onManageKeys }: { onManageKeys?: () => void } = {}) {
  const tenant = useTenantKeyStatus();
  const { user } = useCurrentUser();
  const isAdmin = user?.role === "admin";

  // Detaliul "*ultimele4" e admin-only si vine din GET /admin/keys (endpoint-ul
  // de status intoarce doar flag-uri boolean). Fail-soft: daca apelul pica,
  // inventarul ramane pe badge-uri simple, fara sufix.
  const [adminKeys, setAdminKeys] = useState<TenantKeysResult | null>(null);
  const wantAdminKeys = isAdmin && tenant.tenantMode;
  useEffect(() => {
    if (!wantAdminKeys) {
      setAdminKeys(null);
      return;
    }
    const ac = new AbortController();
    admin
      .getTenantKeys(ac.signal)
      .then((res) => {
        if (!ac.signal.aborted) setAdminKeys(res);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [wantAdminKeys]);

  if (tenant.state.state === "loading" || tenant.state.state === "error") {
    return (
      <div className="mb-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {tenant.state.state === "loading"
              ? "Se verifica cheile API configurate..."
              : "Nu am putut verifica cheile API."}
          </span>
          {tenant.state.state === "error" && (
            <Button variant="outline" size="sm" onClick={tenant.refresh}>
              <RefreshCw className="h-4 w-4" /> Reincearca
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Gate pe modul SERVERULUI: ready + desktop-auth (dev-combo) => nimic de
  // afisat; inventarul cu toate flag-urile false ar fi fals.
  if (tenant.state.state !== "ready" || tenant.state.serverAuthMode !== "web") return null;
  const configured = tenant.state.configured;

  const last4For = (key: (typeof PROVIDER_LABELS)[number]["key"]): string | null => {
    if (!adminKeys) return null;
    if (key === "captcha") {
      const field = adminKeys.captcha.provider === "capsolver" ? "capsolver" : "twocaptcha";
      return adminKeys.keys[field]?.last4 ?? null;
    }
    return adminKeys.keys[key]?.last4 ?? null;
  };

  // Non-admin: fara inventar. Totul configurat -> nimic; altfel un singur banner.
  if (!isAdmin) {
    const missingAi = tenant.tenantAiKeysMissing;
    const missingCaptcha = tenant.tenantCaptchaMissing;
    if (!missingAi && !missingCaptcha) return null;
    const what =
      missingAi && missingCaptcha ? "analizele AI si cautarile RNPM" : missingAi ? "analizele AI" : "cautarile RNPM";
    return (
      <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
        Cheile API nu sunt configurate — {what} sunt indisponibile momentan. Contacteaza administratorul.
      </div>
    );
  }

  // Admin: inventar per provider + acces la administrarea cheilor.
  return (
    <div className="mb-3 rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <KeyRound className="h-4 w-4 text-violet-600" />
          Chei API tenant
        </span>
        {onManageKeys ? (
          <Button variant="outline" size="sm" onClick={onManageKeys}>
            Gestioneaza cheile
          </Button>
        ) : (
          <a href="/admin/keys">
            <Button variant="outline" size="sm">
              Gestioneaza cheile
            </Button>
          </a>
        )}
      </div>
      <ul className="space-y-1">
        {PROVIDER_LABELS.map(({ key, label }) => (
          <li key={key} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{label}</span>
            {configured[key] ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Configurata{last4For(key) ? ` *${last4For(key)}` : ""}
              </span>
            ) : (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                Neconfigurata
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
