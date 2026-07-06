import { useEffect, useState } from "react";
import { KeyRound, RefreshCw, Save, Trash2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTenantKeys } from "@/hooks/useTenantKeys";
import type { TenantCaptchaMode, TenantCaptchaProvider, TenantKeyField } from "@/lib/api";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { cn } from "@/lib/utils";

const KEY_FIELDS: Array<{ field: TenantKeyField; label: string; placeholder: string }> = [
  { field: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { field: "openai", label: "OpenAI", placeholder: "sk-..." },
  { field: "google", label: "Google", placeholder: "AIza..." },
  { field: "openrouter", label: "OpenRouter", placeholder: "sk-or-..." },
  { field: "twocaptcha", label: "2Captcha", placeholder: "Cheie 2Captcha" },
  { field: "capsolver", label: "CapSolver", placeholder: "Cheie CapSolver" },
];

const PROVIDERS: Array<{ value: TenantCaptchaProvider; label: string }> = [
  { value: "2captcha", label: "2Captcha" },
  { value: "capsolver", label: "CapSolver" },
];

const MODES: Array<{ value: TenantCaptchaMode; label: string }> = [
  { value: "sequential", label: "Sequential" },
  { value: "race", label: "Race" },
];

export default function AdminKeys({ embedded = false }: { embedded?: boolean } = {}) {
  const { data, loading, error, savingField, refresh, saveKey, saveCaptchaSettings } = useTenantKeys();
  const [inputs, setInputs] = useState<Record<TenantKeyField, string>>({
    anthropic: "",
    openai: "",
    google: "",
    openrouter: "",
    twocaptcha: "",
    capsolver: "",
  });
  const [provider, setProvider] = useState<TenantCaptchaProvider>("2captcha");
  const [mode, setMode] = useState<TenantCaptchaMode>("sequential");

  const currentProvider = data?.captcha.provider ?? provider;
  const currentMode = data?.captcha.mode ?? mode;

  useEffect(() => {
    if (!data) return;
    setProvider(data.captcha.provider);
    setMode(data.captcha.mode);
  }, [data]);

  const onSaveKey = async (field: TenantKeyField) => {
    await saveKey(field, inputs[field]);
    setInputs((prev) => ({ ...prev, [field]: "" }));
  };

  const onClearKey = async (field: TenantKeyField) => {
    await saveKey(field, "");
  };

  const onSaveCaptcha = async () => {
    await saveCaptchaSettings(provider, mode);
  };

  return (
    <div className={cn(!embedded && "min-h-full bg-background p-6")}>
      <div className={cn("space-y-5", !embedded && "mx-auto max-w-5xl")}>
        <div className={cn("flex flex-wrap items-start gap-3", embedded ? "justify-end" : "justify-between")}>
          {!embedded && (
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <KeyRound className="h-6 w-6 text-primary" />
                Chei API
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Chei tenant pentru AI si captcha. Valorile salvate nu se afiseaza inapoi in browser.
              </p>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => refresh()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Provider keys</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {KEY_FIELDS.map(({ field, label, placeholder }) => {
              const status = data?.keys[field];
              const busy = savingField === field;
              return (
                <div
                  key={field}
                  className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[160px_1fr_auto]"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    <Badge variant={status?.set ? "success" : "outline"}>
                      {status?.set ? `set *${status.last4}` : "unset"}
                    </Badge>
                  </div>
                  <input
                    type="password"
                    value={inputs[field]}
                    onChange={(e) => setInputs((prev) => ({ ...prev, [field]: e.target.value }))}
                    placeholder={placeholder}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => onSaveKey(field)} disabled={busy || !inputs[field].trim()}>
                      <Save className="h-4 w-4" />
                      Salveaza
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onClearKey(field)}
                      disabled={busy || !status?.set}
                    >
                      <Trash2 className="h-4 w-4" />
                      Sterge
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Captcha</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm font-medium">Provider</span>
              <div className="flex rounded-md border border-border p-1">
                {PROVIDERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setProvider(item.value)}
                    className={cn(
                      "rounded px-3 py-1.5 text-sm transition-colors",
                      provider === item.value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <Badge variant="outline">{currentProvider}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm font-medium">Mode</span>
              <div className="flex rounded-md border border-border p-1">
                {MODES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setMode(item.value)}
                    className={cn(
                      "rounded px-3 py-1.5 text-sm transition-colors",
                      mode === item.value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <Badge variant="outline">{currentMode}</Badge>
            </div>
            <Button onClick={onSaveCaptcha} disabled={savingField === "captcha"}>
              <Save className="h-4 w-4" />
              Salveaza captcha
            </Button>
          </CardContent>
        </Card>

        {data && (
          <p className="text-xs text-muted-foreground">
            Ultima actualizare: {formatIsoDateTime(data.updatedAt)} {data.updatedBy ? `de ${data.updatedBy}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
