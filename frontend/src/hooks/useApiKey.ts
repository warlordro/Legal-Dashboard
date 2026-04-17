import { useEffect, useRef, useState } from "react";

export type CaptchaProvider = "2captcha" | "capsolver";
export type CaptchaMode = "sequential" | "race";

export interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
  twocaptcha: string;
  capsolver: string;
}

const LEGACY_KEY = "portaljust-api-keys";
const ENC_KEY = "portaljust-api-keys-enc";
const PROVIDER_KEY = "portaljust-captcha-provider";
const MODE_KEY = "portaljust-captcha-mode";

const EMPTY: ApiKeys = { anthropic: "", openai: "", google: "", twocaptcha: "", capsolver: "" };

// SECURITY: weak obfuscation — used only on web where no OS keystore is available.
// Desktop builds go through Electron safeStorage (DPAPI / Keychain / libsecret).
function obfuscate(text: string): string {
  if (!text) return "";
  try { return btoa(text.split("").reverse().join("")); } catch { return text; }
}
function deobfuscate(text: string): string {
  if (!text) return "";
  try { return atob(text).split("").reverse().join(""); } catch { return text; }
}

function loadLegacy(): ApiKeys {
  try {
    const saved = localStorage.getItem(LEGACY_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        anthropic: deobfuscate(parsed.anthropic || ""),
        openai: deobfuscate(parsed.openai || ""),
        google: deobfuscate(parsed.google || ""),
        twocaptcha: deobfuscate(parsed.twocaptcha || ""),
        capsolver: deobfuscate(parsed.capsolver || ""),
      };
    }
    const oldSingle = localStorage.getItem("portaljust-anthropic-key");
    if (oldSingle) return { ...EMPTY, anthropic: oldSingle };
  } catch {}
  return EMPTY;
}

function saveLegacy(keys: ApiKeys) {
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({
      anthropic: obfuscate(keys.anthropic),
      openai: obfuscate(keys.openai),
      google: obfuscate(keys.google),
      twocaptcha: obfuscate(keys.twocaptcha),
      capsolver: obfuscate(keys.capsolver),
    }));
  } catch {}
}

function loadProvider(): CaptchaProvider {
  try {
    const v = localStorage.getItem(PROVIDER_KEY);
    if (v === "capsolver" || v === "2captcha") return v;
  } catch {}
  return "2captcha";
}

function loadMode(): CaptchaMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "race" || v === "sequential") return v;
  } catch {}
  return "sequential";
}

export function useApiKey() {
  // Boot with empty state; async load runs once on mount. One-frame flash is acceptable
  // because sensitive screens (Setari AI) read keys on user navigation, not on boot.
  const [keys, setKeysState] = useState<ApiKeys>(EMPTY);
  const [captchaProvider, setCaptchaProviderState] = useState<CaptchaProvider>(loadProvider);
  const [captchaMode, setCaptchaModeState] = useState<CaptchaMode>(loadMode);
  const safeStorageReady = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const api = window.desktopApi;
      const available = api ? await api.isEncryptionAvailable().catch(() => false) : false;
      safeStorageReady.current = available;

      if (available && api) {
        // Desktop path: prefer encrypted blob; fall back to legacy (migrating it on the fly).
        let loaded: ApiKeys | null = null;
        try {
          const enc = localStorage.getItem(ENC_KEY);
          if (enc) {
            const plain = await api.decryptKeys(enc);
            if (plain) loaded = JSON.parse(plain) as ApiKeys;
          }
        } catch {}

        if (!loaded) {
          const legacy = loadLegacy();
          if (legacy.anthropic || legacy.openai || legacy.google || legacy.twocaptcha || legacy.capsolver) {
            loaded = legacy;
            try {
              const cipher = await api.encryptKeys(JSON.stringify(legacy));
              if (cipher) {
                localStorage.setItem(ENC_KEY, cipher);
                localStorage.removeItem(LEGACY_KEY);
                localStorage.removeItem("portaljust-anthropic-key");
              }
            } catch {}
          }
        }

        if (!cancelled && loaded) setKeysState(loaded);
      } else {
        // Web fallback: legacy obfuscation only.
        const legacy = loadLegacy();
        if (!cancelled) setKeysState(legacy);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const persist = (newKeys: ApiKeys) => {
    const api = window.desktopApi;
    if (safeStorageReady.current && api) {
      api.encryptKeys(JSON.stringify(newKeys)).then((cipher) => {
        if (cipher) {
          try { localStorage.setItem(ENC_KEY, cipher); } catch {}
        } else {
          saveLegacy(newKeys);
        }
      }).catch(() => saveLegacy(newKeys));
    } else {
      saveLegacy(newKeys);
    }
  };

  const setKeys = (newKeys: ApiKeys) => {
    setKeysState(newKeys);
    persist(newKeys);
  };

  const setKey = (provider: keyof ApiKeys, value: string) => {
    const updated = { ...keys, [provider]: value.trim() };
    setKeys(updated);
  };

  const clearKey = (provider: keyof ApiKeys) => {
    setKey(provider, "");
  };

  const setCaptchaProvider = (p: CaptchaProvider) => {
    setCaptchaProviderState(p);
    try { localStorage.setItem(PROVIDER_KEY, p); } catch {}
  };

  const setCaptchaMode = (m: CaptchaMode) => {
    setCaptchaModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch {}
  };

  const apiKey = keys.anthropic;
  const hasKey = keys.anthropic.length > 0 || keys.openai.length > 0 || keys.google.length > 0;
  const activeCaptchaKey = captchaProvider === "capsolver" ? keys.capsolver : keys.twocaptcha;

  return {
    keys,
    setKeys,
    setKey,
    clearKey,
    apiKey,
    hasKey,
    hasAnthropic: keys.anthropic.length > 0,
    hasOpenai: keys.openai.length > 0,
    hasGoogle: keys.google.length > 0,
    hasTwoCaptcha: keys.twocaptcha.length > 0,
    hasCapSolver: keys.capsolver.length > 0,
    captchaProvider,
    setCaptchaProvider,
    captchaMode,
    setCaptchaMode,
    activeCaptchaKey,
    setApiKey: (key: string) => setKey("anthropic", key),
  };
}
