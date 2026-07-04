import { CheckCircle2, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TenantKeys } from "@/hooks/useTenantKeyStatus";

// v2.42.0: statusul read-only al cheilor tenant, extras din ApiKeyDialog ca sa
// fie reutilizat de pagina /setari (tab General) si de dialog (desktop nu-l
// vede niciodata — cheile lui sunt BYOK locale).
export function TenantKeyStatusPanel({
  tenantKeys,
  isAdmin,
  onManageKeys,
}: {
  tenantKeys: TenantKeys;
  isAdmin: boolean;
  onManageKeys?: () => void;
}) {
  // Userul normal nu administreaza chei — inventarul per provider e zgomot
  // (feedback testare). El vede DOAR un avertisment cand o capabilitate e
  // indisponibila; cand totul e configurat, nu vede nimic.
  if (!isAdmin) {
    if (tenantKeys.status.state !== "ready") return null; // loading/error: fail-open, fara zgomot
    const cfg = tenantKeys.status.configured;
    const missing: string[] = [];
    if (!(cfg.anthropic || cfg.openai || cfg.google || cfg.openrouter)) missing.push("analizele AI");
    if (!cfg.captcha) missing.push("cautarile RNPM");
    if (missing.length === 0) return null;
    return (
      <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
        Cheile API nu sunt configurate — {missing.join(" si ")} sunt indisponibile momentan. Contacteaza
        administratorul.
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Chei API — nivel tenant</span>
        {isAdmin && onManageKeys && (
          <Button variant="outline" size="sm" onClick={onManageKeys}>
            Gestioneaza cheile
          </Button>
        )}
      </div>
      {tenantKeys.status.state === "ready" ? (
        <ul className="space-y-1.5">
          {(
            [
              ["Anthropic", tenantKeys.status.configured.anthropic],
              ["OpenAI", tenantKeys.status.configured.openai],
              ["Google", tenantKeys.status.configured.google],
              ["OpenRouter", tenantKeys.status.configured.openrouter],
              ["Captcha RNPM (provider activ)", tenantKeys.status.configured.captcha],
            ] as const
          ).map(([label, configured]) => (
            <li key={label} className="flex items-center gap-2 text-sm">
              {configured ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
              ) : (
                <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span>{label}</span>
              <span className={configured ? "text-[11px] text-green-600" : "text-[11px] text-muted-foreground"}>
                {configured ? "Configurata" : "Neconfigurata"}
              </span>
            </li>
          ))}
        </ul>
      ) : tenantKeys.status.state === "error" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Starea cheilor nu a putut fi incarcata.
          <Button variant="outline" size="sm" onClick={tenantKeys.refresh}>
            Reincearca
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Se verifica starea cheilor...</p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Cheile sunt gestionate de administratorul tenantului si nu parasesc serverul.
      </p>
    </div>
  );
}
