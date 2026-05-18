import type { TenantKeyField } from "../db/tenantKeysRepository.ts";

export interface KeyValidationResult {
  valid: boolean;
  reason?: string;
  validationSkipped?: boolean;
}

const VALIDATION_TIMEOUT_MS = 5000;

export async function validateKey(field: TenantKeyField, value: string): Promise<KeyValidationResult> {
  if (value.trim() === "") return { valid: true };
  try {
    // 2captcha is special: getbalance returns HTTP 200 with body like
    // "ERROR_WRONG_USER_KEY" / "ERROR_KEY_DOES_NOT_EXIST" for invalid keys.
    // A bare status check would let any string through.
    if (field === "twocaptcha") return await validateTwoCaptcha(value);

    const res = await fetchValidation(field, value);
    if (res.status === 401 || res.status === 403 || res.status === 422) {
      return { valid: false, reason: "Cheia pare invalida sau neautorizata." };
    }
    // Distinguish definitive client errors (4xx without 408/429) from transient
    // upstream conditions (408 timeout, 429 rate-limit, 5xx server) — the latter
    // should NOT reject a likely-valid key.
    if (res.status === 408 || res.status === 429) {
      return {
        valid: true,
        validationSkipped: true,
        reason: `Provider indisponibil (HTTP ${res.status}). Cheia a fost salvata fara verificare online.`,
      };
    }
    if (res.status >= 400 && res.status < 500) {
      return { valid: false, reason: `Providerul a respins cheia (${res.status}).` };
    }
    if (res.status >= 500) {
      return {
        valid: true,
        validationSkipped: true,
        reason: `Provider indisponibil (HTTP ${res.status}). Cheia a fost salvata fara verificare online.`,
      };
    }
    return { valid: true };
  } catch {
    return { valid: true, validationSkipped: true, reason: "Validarea online a fost omisa (retea indisponibila)." };
  }
}

async function validateTwoCaptcha(value: string): Promise<KeyValidationResult> {
  const signal = AbortSignal.timeout(VALIDATION_TIMEOUT_MS);
  const res = await fetch(`https://2captcha.com/res.php?key=${encodeURIComponent(value)}&action=getbalance`, {
    method: "GET",
    signal,
  });
  if (res.status === 408 || res.status === 429 || res.status >= 500) {
    return {
      valid: true,
      validationSkipped: true,
      reason: `Provider indisponibil (HTTP ${res.status}). Cheia a fost salvata fara verificare online.`,
    };
  }
  if (res.status >= 400) {
    return { valid: false, reason: `Providerul a respins cheia (${res.status}).` };
  }
  const text = (await res.text()).trim();
  if (text.startsWith("ERROR_")) {
    return { valid: false, reason: `Cheie invalida: ${text}` };
  }
  return { valid: true };
}

async function fetchValidation(field: TenantKeyField, value: string): Promise<Response> {
  const signal = AbortSignal.timeout(VALIDATION_TIMEOUT_MS);
  if (field === "anthropic") {
    return fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: { "x-api-key": value, "anthropic-version": "2023-06-01" },
      signal,
    });
  }
  if (field === "openai") {
    return fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${value}` },
      signal,
    });
  }
  if (field === "google") {
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(value)}`, {
      method: "GET",
      signal,
    });
  }
  if (field === "openrouter") {
    return fetch("https://openrouter.ai/api/v1/auth/key", {
      method: "GET",
      headers: { Authorization: `Bearer ${value}` },
      signal,
    });
  }
  // capsolver
  return fetch("https://api.capsolver.com/getBalance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientKey: value }),
    signal,
  });
}
