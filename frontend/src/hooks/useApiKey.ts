import { useState } from "react";

export type CaptchaProvider = "2captcha" | "capsolver";
export type CaptchaMode = "sequential" | "race";

export interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
  twocaptcha: string;
  capsolver: string;
}

const STORAGE_KEY = "portaljust-api-keys";
const PROVIDER_KEY = "portaljust-captcha-provider";
const MODE_KEY = "portaljust-captcha-mode";

// SECURITY: Simple obfuscation to prevent casual plaintext reading of API keys in localStorage.
// This is NOT encryption — it deters casual browsing but not determined attackers.
function obfuscate(text: string): string {
  if (!text) return "";
  try {
    return btoa(text.split("").reverse().join(""));
  } catch {
    return text;
  }
}

function deobfuscate(text: string): string {
  if (!text) return "";
  try {
    return atob(text).split("").reverse().join("");
  } catch {
    return text;
  }
}

function loadKeys(): ApiKeys {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
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
  } catch {}
  try {
    const oldKey = localStorage.getItem("portaljust-anthropic-key");
    if (oldKey) {
      const keys = { anthropic: oldKey, openai: "", google: "", twocaptcha: "", capsolver: "" };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        anthropic: obfuscate(oldKey),
        openai: "",
        google: "",
        twocaptcha: "",
        capsolver: "",
      }));
      localStorage.removeItem("portaljust-anthropic-key");
      return keys;
    }
  } catch {}
  return { anthropic: "", openai: "", google: "", twocaptcha: "", capsolver: "" };
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
  const [keys, setKeysState] = useState<ApiKeys>(loadKeys);
  const [captchaProvider, setCaptchaProviderState] = useState<CaptchaProvider>(loadProvider);
  const [captchaMode, setCaptchaModeState] = useState<CaptchaMode>(loadMode);

  const setKeys = (newKeys: ApiKeys) => {
    setKeysState(newKeys);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      anthropic: obfuscate(newKeys.anthropic),
      openai: obfuscate(newKeys.openai),
      google: obfuscate(newKeys.google),
      twocaptcha: obfuscate(newKeys.twocaptcha),
      capsolver: obfuscate(newKeys.capsolver),
    }));
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
