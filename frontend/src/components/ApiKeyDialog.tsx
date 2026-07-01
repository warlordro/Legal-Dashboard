import { useState } from "react";
import { Key, X } from "lucide-react";
import { AIUsagePanel } from "@/components/AIUsagePanel";
import { ApiAccessPanel } from "@/components/ApiAccessPanel";
import { EmailSettingsPanel } from "@/components/EmailSettingsPanel";
import { NotificationStatusPanel } from "@/components/NotificationStatusPanel";
import { isWebRuntime } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useDialog } from "@/hooks/useDialog";
import { useAuthMode } from "@/hooks/useAuthMode";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { useApiKey } from "@/hooks/useApiKey";
import type { useAiSettings } from "@/hooks/useAiSettings";

type UseApiKey = ReturnType<typeof useApiKey>;

// Parent gates this with `{showKeyDialog && <ApiKeyDialog ... />}` so each
// open is a fresh mount. That makes `useState(EMPTY)` initialize synchronously
// on every open — matching the original `handleOpenKeyDialog` reset and
// avoiding a one-frame flash of stale input.
interface Props {
  onClose: () => void;
  apiKey: Pick<
    UseApiKey,
    | "setKey"
    | "clearKey"
    | "hasKey"
    | "hasAnthropic"
    | "hasOpenai"
    | "hasGoogle"
    | "hasOpenrouter"
    | "hasTwoCaptcha"
    | "hasCapSolver"
    | "captchaProvider"
    | "setCaptchaProvider"
    | "captchaMode"
    | "setCaptchaMode"
  > & { aiSettings: ReturnType<typeof useAiSettings> };
}

const EMPTY = { anthropic: "", openai: "", google: "", openrouter: "", twocaptcha: "", capsolver: "" };

export function ApiKeyDialog({ onClose, apiKey }: Props) {
  const authMode = useAuthMode();
  const { user } = useCurrentUser();
  const {
    setKey,
    clearKey,
    hasKey,
    hasAnthropic,
    hasOpenai,
    hasGoogle,
    hasOpenrouter,
    hasTwoCaptcha,
    hasCapSolver,
    captchaProvider,
    setCaptchaProvider,
    captchaMode,
    setCaptchaMode,
    aiSettings,
  } = apiKey;
  const [keyInputs, setKeyInputs] = useState(EMPTY);
  const dialogRef = useDialog<HTMLDivElement>(true, onClose);

  if (authMode === "web" && user?.role !== "admin") return null;

  const handleSaveKeys = () => {
    if (keyInputs.anthropic.trim()) setKey("anthropic", keyInputs.anthropic);
    if (keyInputs.openai.trim()) setKey("openai", keyInputs.openai);
    if (keyInputs.google.trim()) setKey("google", keyInputs.google);
    if (keyInputs.openrouter.trim()) setKey("openrouter", keyInputs.openrouter);
    if (keyInputs.twocaptcha.trim()) setKey("twocaptcha", keyInputs.twocaptcha);
    if (keyInputs.capsolver.trim()) setKey("capsolver", keyInputs.capsolver);
    setKeyInputs(EMPTY);
  };

  const noInput =
    !keyInputs.anthropic.trim() &&
    !keyInputs.openai.trim() &&
    !keyInputs.google.trim() &&
    !keyInputs.openrouter.trim() &&
    !keyInputs.twocaptcha.trim() &&
    !keyInputs.capsolver.trim();

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdropul se inchide via Escape printr-un document-level handler.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation pe div pentru a impiedica click-through pe backdrop; tastatura merge prin focus trap intern. */}
      <div
        ref={dialogRef}
        // biome-ignore lint/a11y/useSemanticElements: <dialog> nativ ar necesita showModal + focus trap nativ, pattern portal cu role="dialog"+aria-modal e standard React.
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-key-dialog-title"
        tabIndex={-1}
        className="w-full max-w-5xl rounded-xl border border-border bg-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 id="api-key-dialog-title" className="flex items-center gap-2 text-lg font-semibold">
            <Key className="h-5 w-5 text-violet-600" />
            Configurare Chei API
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Inchide configurare chei"
            className="rounded-lg p-1 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Introdu cheile API pentru furnizorii AI pe care doresti sa ii folosesti. Poti configura unul sau mai multi.
        </p>

        <AIUsagePanel />
        <NotificationStatusPanel />
        <EmailSettingsPanel />
        {/* Acces API (PAT) — doar web mode; desktop pastreaza BYOK in acest modal. */}
        {isWebRuntime() && <ApiAccessPanel />}

        {/* AI config zone: routing + provider keys grouped vizual */}
        <div className="mb-3 rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Rutare AI</span>
            {aiSettings.error && <span className="text-[11px] text-red-600">{aiSettings.error}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => aiSettings.setMode("native")}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                aiSettings.mode === "native"
                  ? "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              Native
            </button>
            <button
              type="button"
              onClick={() => aiSettings.setMode("openrouter")}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                aiSettings.mode === "openrouter"
                  ? "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              OpenRouter
            </button>
          </div>
        </div>

        {/* AI providers — side-by-side */}
        {aiSettings.mode === "native" ? (
          <div className="mb-3 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
                  Anthropic
                </span>
                {hasAnthropic && <span className="text-[11px] text-green-600 font-medium">Activa</span>}
              </div>
              <input
                type="password"
                placeholder={hasAnthropic ? "Cheie noua..." : "sk-ant-api03-..."}
                value={keyInputs.anthropic}
                onChange={(e) => setKeyInputs({ ...keyInputs, anthropic: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
              {hasAnthropic && (
                <button
                  type="button"
                  className="mt-1.5 text-[11px] text-red-500 hover:underline"
                  onClick={() => {
                    clearKey("anthropic");
                  }}
                >
                  Sterge cheia
                </button>
              )}
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  OpenAI
                </span>
                {hasOpenai && <span className="text-[11px] text-green-600 font-medium">Activa</span>}
              </div>
              <input
                type="password"
                placeholder={hasOpenai ? "Cheie noua..." : "sk-proj-..."}
                value={keyInputs.openai}
                onChange={(e) => setKeyInputs({ ...keyInputs, openai: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              {hasOpenai && (
                <button
                  type="button"
                  className="mt-1.5 text-[11px] text-red-500 hover:underline"
                  onClick={() => {
                    clearKey("openai");
                  }}
                >
                  Sterge cheia
                </button>
              )}
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                  Google
                </span>
                {hasGoogle && <span className="text-[11px] text-green-600 font-medium">Activa</span>}
              </div>
              <input
                type="password"
                placeholder={hasGoogle ? "Cheie noua..." : "AIza..."}
                value={keyInputs.google}
                onChange={(e) => setKeyInputs({ ...keyInputs, google: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              {hasGoogle && (
                <button
                  type="button"
                  className="mt-1.5 text-[11px] text-red-500 hover:underline"
                  onClick={() => {
                    clearKey("google");
                  }}
                >
                  Sterge cheia
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mb-3 rounded-lg border border-border p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
                OpenRouter API Key
              </span>
              {hasOpenrouter && <span className="text-[11px] font-medium text-green-600">Activa</span>}
            </div>
            <input
              type="password"
              placeholder={hasOpenrouter ? "Cheie noua..." : "sk-or-v1-..."}
              value={keyInputs.openrouter}
              onChange={(e) => setKeyInputs({ ...keyInputs, openrouter: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
            {hasOpenrouter && (
              <button
                type="button"
                className="mt-1.5 text-[11px] text-red-500 hover:underline"
                onClick={() => {
                  clearKey("openrouter");
                }}
              >
                Sterge cheia
              </button>
            )}
          </div>
        )}

        {/* Captcha provider selector */}
        <div className="mb-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
              Captcha RNPM — provider activ
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCaptchaProvider("2captcha")}
              className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${captchaProvider === "2captcha" ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
            >
              2Captcha {hasTwoCaptcha && <span className="ml-1 text-green-600">●</span>}
            </button>
            <button
              type="button"
              onClick={() => setCaptchaProvider("capsolver")}
              className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${captchaProvider === "capsolver" ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
            >
              CapSolver {hasCapSolver && <span className="ml-1 text-green-600">●</span>}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Selecteaza providerul folosit pentru rezolvarea reCAPTCHA la cautarile RNPM.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setCaptchaMode("sequential")}
              className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${captchaMode === "sequential" ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
            >
              Secvential (fallback)
            </button>
            <button
              type="button"
              onClick={() => setCaptchaMode("race")}
              disabled={!(hasTwoCaptcha && hasCapSolver)}
              title={!(hasTwoCaptcha && hasCapSolver) ? "Necesita ambele chei setate" : undefined}
              className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${captchaMode === "race" ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border bg-background text-muted-foreground hover:bg-muted"} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Paralel (race)
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Secvential: primary cu fallback daca esueaza. Paralel: porneste ambele, castiga cel mai rapid (cost dublu).
          </p>
        </div>

        {/* 2Captcha + CapSolver side-by-side */}
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                2Captcha
              </span>
              {hasTwoCaptcha && <span className="text-[11px] text-green-600 font-medium">Activa</span>}
            </div>
            <input
              type="password"
              placeholder={hasTwoCaptcha ? "Cheie noua..." : "cheia 2captcha.com..."}
              value={keyInputs.twocaptcha}
              onChange={(e) => setKeyInputs({ ...keyInputs, twocaptcha: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
            {hasTwoCaptcha && (
              <button
                type="button"
                className="mt-1.5 text-[11px] text-red-500 hover:underline"
                onClick={() => {
                  clearKey("twocaptcha");
                }}
              >
                Sterge cheia
              </button>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">~$0.003/captcha, fallback uman.</p>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-orange-500" />
                CapSolver
              </span>
              {hasCapSolver && <span className="text-[11px] text-green-600 font-medium">Activa</span>}
            </div>
            <input
              type="password"
              placeholder={hasCapSolver ? "Cheie noua..." : "cheia capsolver.com..."}
              value={keyInputs.capsolver}
              onChange={(e) => setKeyInputs({ ...keyInputs, capsolver: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            />
            {hasCapSolver && (
              <button
                type="button"
                className="mt-1.5 text-[11px] text-red-500 hover:underline"
                onClick={() => {
                  clearKey("capsolver");
                }}
              >
                Sterge cheia
              </button>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">~$0.0008/captcha, AI-based.</p>
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>
            {hasKey ? "Inchide" : "Mai tarziu"}
          </Button>
          <Button
            size="sm"
            className="bg-violet-600 hover:bg-violet-700 text-white"
            onClick={handleSaveKeys}
            disabled={noInput}
          >
            Salveaza
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Cheile se salveaza doar local pe calculatorul tau si sunt trimise doar catre API-urile respective.
        </p>
      </div>
    </div>
  );
}
