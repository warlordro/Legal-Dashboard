import { useEffect, useRef, useState } from "react";

// NOTE (CP-12): empty `catch {}` blocks below intentionally swallow errors from
// localStorage / safeStorage IPC. Reads fall back to EMPTY; writes are best-effort.
// Causes we accept: quota exceeded, private-mode blocked, keystore unavailable.
// A noisy failure here would break app boot for users with any of the above.

export type CaptchaProvider = "2captcha" | "capsolver";
export type CaptchaMode = "sequential" | "race";

export interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
  openrouter: string;
  twocaptcha: string;
  capsolver: string;
}

const LEGACY_KEY = "portaljust-api-keys";
const SINGLE_LEGACY_KEY = "portaljust-anthropic-key";
const ENC_KEY = "portaljust-api-keys-enc";
const PROVIDER_KEY = "portaljust-captcha-provider";
const MODE_KEY = "portaljust-captcha-mode";

const EMPTY: ApiKeys = { anthropic: "", openai: "", google: "", openrouter: "", twocaptcha: "", capsolver: "" };

// One-shot migration reader: legacy localStorage entries were XOR-obfuscated.
// Used ONLY to re-save them through safeStorage at first boot after upgrade,
// then the legacy entries are removed. No new writes ever use this path.
function deobfuscate(text: string): string {
  if (!text) return "";
  try {
    return atob(text).split("").reverse().join("");
  } catch {
    return text;
  }
}

function readLegacyForMigration(): ApiKeys | null {
  try {
    const saved = localStorage.getItem(LEGACY_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        anthropic: deobfuscate(parsed.anthropic || ""),
        openai: deobfuscate(parsed.openai || ""),
        google: deobfuscate(parsed.google || ""),
        openrouter: deobfuscate(parsed.openrouter || ""),
        twocaptcha: deobfuscate(parsed.twocaptcha || ""),
        capsolver: deobfuscate(parsed.capsolver || ""),
      };
    }
    const oldSingle = localStorage.getItem(SINGLE_LEGACY_KEY);
    if (oldSingle) return { ...EMPTY, anthropic: oldSingle };
  } catch {}
  return null;
}

function clearLegacyStorage() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
  try {
    localStorage.removeItem(SINGLE_LEGACY_KEY);
  } catch {}
}

function hasAnyKey(k: ApiKeys): boolean {
  return !!(k.anthropic || k.openai || k.google || k.openrouter || k.twocaptcha || k.capsolver);
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
  // When true, OS keystore (DPAPI/Keychain/libsecret) is unavailable. We refuse
  // to persist keys in plaintext; the UI should show a "cannot save" state.
  const [encryptionUnavailable, setEncryptionUnavailable] = useState(false);
  const safeStorageReady = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const api = window.desktopApi;
      const available = api ? await api.isEncryptionAvailable().catch(() => false) : false;
      safeStorageReady.current = available;

      if (!available || !api) {
        // No OS keystore. Wipe any obfuscated legacy entries that may linger and
        // surface the state so the UI can explain why nothing persists.
        clearLegacyStorage();
        if (!cancelled) setEncryptionUnavailable(true);
        return;
      }

      let loaded: ApiKeys | null = null;
      try {
        const enc = localStorage.getItem(ENC_KEY);
        if (enc) {
          const plain = await api.decryptKeys(enc);
          // Merge over EMPTY so payloads written before a field was added to the
          // schema (e.g. legacy ciphertext predating `openrouter`) still expose
          // every key as an empty string instead of `undefined`. Without this,
          // `keys.openrouter.length` throws on first render.
          if (plain) loaded = { ...EMPTY, ...(JSON.parse(plain) as Partial<ApiKeys>) };
        }
      } catch {}

      if (!loaded) {
        const legacy = readLegacyForMigration();
        if (legacy && hasAnyKey(legacy)) {
          try {
            const cipher = await api.encryptKeys(JSON.stringify(legacy));
            if (cipher) {
              localStorage.setItem(ENC_KEY, cipher);
              clearLegacyStorage();
              loaded = legacy;
            }
          } catch {}
        }
      }

      if (!cancelled && loaded) setKeysState(loaded);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const persist = (newKeys: ApiKeys) => {
    const api = window.desktopApi;
    if (!safeStorageReady.current || !api) {
      setEncryptionUnavailable(true);
      return;
    }
    api
      .encryptKeys(JSON.stringify(newKeys))
      .then((cipher) => {
        if (!cipher) {
          setEncryptionUnavailable(true);
          return;
        }
        try {
          localStorage.setItem(ENC_KEY, cipher);
        } catch {}
      })
      .catch(() => {
        setEncryptionUnavailable(true);
      });
  };

  const setKeys = (newKeys: ApiKeys) => {
    const trimmed = { ...newKeys };
    for (const k of Object.keys(trimmed) as (keyof ApiKeys)[]) {
      trimmed[k] = trimmed[k].trim();
    }
    setKeysState(trimmed);
    persist(trimmed);
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
    try {
      localStorage.setItem(PROVIDER_KEY, p);
    } catch {}
  };

  const setCaptchaMode = (m: CaptchaMode) => {
    setCaptchaModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  };

  const apiKey = keys.anthropic;
  const hasKey =
    keys.anthropic.length > 0 || keys.openai.length > 0 || keys.google.length > 0 || keys.openrouter.length > 0;
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
    hasOpenrouter: keys.openrouter.length > 0,
    hasTwoCaptcha: keys.twocaptcha.length > 0,
    hasCapSolver: keys.capsolver.length > 0,
    captchaProvider,
    setCaptchaProvider,
    captchaMode,
    setCaptchaMode,
    activeCaptchaKey,
    setApiKey: (key: string) => setKey("anthropic", key),
    encryptionUnavailable,
  };
}
