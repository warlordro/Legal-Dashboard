import { KeyRound, RefreshCw } from "lucide-react";
import { useTenantKeyStatus } from "@/hooks/useTenantKeyStatus";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";

// v2.41.0 (P3/P4): starea cheilor tenant in web mode, pe roluri.
//   - admin: inventar per provider (Configurata / Neconfigurata) + buton catre
//     administrarea cheilor (/admin/keys);
//   - non-admin: NIMIC daca totul e configurat; altfel UN SINGUR banner amber
//     ("contacteaza administratorul"). Non-adminul nu vede inventarul.
// Se randeaza doar cand serverul e in web mode (tenantMode); pe desktop sau in
// dev-combo (browser + backend desktop) inventarul tenant ar minti — vezi
// gating-ul din ApiKeyDialog / Settings.

const PROVIDER_LABELS: { key: "anthropic" | "openai" | "google" | "openrouter" | "captcha"; label: string }[] = [
  { key: "anthropic", label: "Anthropic (Claude)" },
  { key: "openai", label: "OpenAI (GPT)" },
  { key: "google", label: "Google (Gemini)" },
  { key: "openrouter", label: "OpenRouter" },
  { key: "captcha", label: "Captcha RNPM" },
];

export function TenantKeyStatusPanel() {
  const tenant = useTenantKeyStatus();
  const { user } = useCurrentUser();
  const isAdmin = user?.role === "admin";

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

  if (tenant.state.state !== "ready") return null;
  const configured = tenant.state.configured;

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
        <a href="/admin/keys">
          <Button variant="outline" size="sm">
            Gestioneaza cheile
          </Button>
        </a>
      </div>
      <ul className="space-y-1">
        {PROVIDER_LABELS.map(({ key, label }) => (
          <li key={key} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{label}</span>
            {configured[key] ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Configurata
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
