import { decryptKey, encryptKey } from "../util/tenantKeyCrypto.ts";
import { getDb } from "./schema.ts";

export const TENANT_KEY_FIELDS = ["anthropic", "openai", "google", "openrouter", "twocaptcha", "capsolver"] as const;
export type TenantKeyField = (typeof TENANT_KEY_FIELDS)[number];
export type CaptchaProvider = "2captcha" | "capsolver";
export type CaptchaMode = "sequential" | "race";

export interface TenantKeys {
  anthropic: string;
  openai: string;
  google: string;
  openrouter: string;
  twocaptcha: string;
  capsolver: string;
  captchaProvider: CaptchaProvider;
  captchaMode: CaptchaMode;
  updatedAt: string;
  updatedBy: string | null;
}

interface TenantKeysRow {
  scope: "tenant";
  anthropic_cipher: string | null;
  anthropic_iv: string | null;
  anthropic_tag: string | null;
  openai_cipher: string | null;
  openai_iv: string | null;
  openai_tag: string | null;
  google_cipher: string | null;
  google_iv: string | null;
  google_tag: string | null;
  openrouter_cipher: string | null;
  openrouter_iv: string | null;
  openrouter_tag: string | null;
  twocaptcha_cipher: string | null;
  twocaptcha_iv: string | null;
  twocaptcha_tag: string | null;
  capsolver_cipher: string | null;
  capsolver_iv: string | null;
  capsolver_tag: string | null;
  captcha_provider: CaptchaProvider;
  captcha_mode: CaptchaMode;
  updated_at: string;
  updated_by: string | null;
}

let cached: TenantKeys | null = null;
let cachedAt = 0;

// v2.34.0 P1-1: in-process cache cu TTL 60s. Invalidarea explicita ramane
// principalul path (toate setterele de mai jos cheama invalidateCache()), dar
// TTL-ul protejeaza scenariile out-of-band: migration manual, seed script,
// sau un viitor sidecar care updateaza `tenant_api_keys` ocolind repo-ul.
// 60s = compromis intre throughput (decryptField e ieftin dar nu free) si
// freshness operationala.
const TENANT_KEYS_TTL_MS = 60_000;

export function invalidateCache(): void {
  cached = null;
  cachedAt = 0;
}

export function isTenantKeyField(field: string): field is TenantKeyField {
  return (TENANT_KEY_FIELDS as readonly string[]).includes(field);
}

export function getTenantKeys(): TenantKeys {
  if (cached !== null && Date.now() - cachedAt < TENANT_KEYS_TTL_MS) {
    return cached;
  }
  const row = ensureTenantRow();
  cached = {
    anthropic: decryptField(row, "anthropic"),
    openai: decryptField(row, "openai"),
    google: decryptField(row, "google"),
    openrouter: decryptField(row, "openrouter"),
    twocaptcha: decryptField(row, "twocaptcha"),
    capsolver: decryptField(row, "capsolver"),
    captchaProvider: row.captcha_provider,
    captchaMode: row.captcha_mode,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
  cachedAt = Date.now();
  return cached;
}

export function getDecryptedKey(field: TenantKeyField): string {
  return getTenantKeys()[field];
}

export function setTenantKey(field: TenantKeyField, value: string, updatedBy: string): void {
  // Defense in depth: the column-name interpolation below trusts `field` to
  // come from a typed call site. A runtime guard means a future TS-bypassed
  // call (any-cast / dynamic dispatch / parser regression) cannot become a
  // SQL injection vector through the `${field}_cipher` template literal.
  if (!isTenantKeyField(field)) {
    throw new Error(`Invalid tenant key field: ${String(field)}`);
  }
  const db = getDb();
  ensureTenantRow();
  if (value === "") {
    db.prepare(
      `UPDATE tenant_api_keys
       SET ${field}_cipher = NULL,
           ${field}_iv = NULL,
           ${field}_tag = NULL,
           updated_at = datetime('now'),
           updated_by = ?
       WHERE scope = 'tenant'`
    ).run(updatedBy);
  } else {
    const encrypted = encryptKey(value);
    db.prepare(
      `UPDATE tenant_api_keys
       SET ${field}_cipher = ?,
           ${field}_iv = ?,
           ${field}_tag = ?,
           updated_at = datetime('now'),
           updated_by = ?
       WHERE scope = 'tenant'`
    ).run(encrypted.cipher, encrypted.iv, encrypted.tag, updatedBy);
  }
  invalidateCache();
}

export function setCaptchaSettings(input: { provider: CaptchaProvider; mode: CaptchaMode; updatedBy: string }): void {
  ensureTenantRow();
  getDb()
    .prepare(
      `UPDATE tenant_api_keys
       SET captcha_provider = ?,
           captcha_mode = ?,
           updated_at = datetime('now'),
           updated_by = ?
       WHERE scope = 'tenant'`
    )
    .run(input.provider, input.mode, input.updatedBy);
  invalidateCache();
}

function ensureTenantRow(): TenantKeysRow {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO tenant_api_keys (scope) VALUES ('tenant')").run();
  return db.prepare("SELECT * FROM tenant_api_keys WHERE scope = 'tenant'").get() as TenantKeysRow;
}

function decryptField(row: TenantKeysRow, field: TenantKeyField): string {
  const cipher = row[`${field}_cipher` as keyof TenantKeysRow];
  const iv = row[`${field}_iv` as keyof TenantKeysRow];
  const tag = row[`${field}_tag` as keyof TenantKeysRow];
  if (typeof cipher !== "string" || typeof iv !== "string" || typeof tag !== "string") return "";
  try {
    return decryptKey({ cipher, iv, tag });
  } catch (err) {
    // GCM auth failure = either the master key rotated without re-encryption,
    // the row was tampered with, or the IV/tag column got truncated. Either
    // way we surface it as a structured log (no plaintext, no ciphertext) so
    // an operator can investigate. Returning "" keeps the rest of the tenant
    // record usable and lets the caller treat the field as "not configured"
    // — admins will see a stale `last4`/empty key in /admin/keys and re-set.
    console.error(
      JSON.stringify({
        level: "error",
        event: "tenant_key.decrypt_failed",
        field,
        reason: err instanceof Error ? err.message : "unknown",
        ts: new Date().toISOString(),
      })
    );
    return "";
  }
}
