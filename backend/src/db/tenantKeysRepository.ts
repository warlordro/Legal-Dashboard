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

export function invalidateCache(): void {
  cached = null;
}

export function isTenantKeyField(field: string): field is TenantKeyField {
  return (TENANT_KEY_FIELDS as readonly string[]).includes(field);
}

export function getTenantKeys(): TenantKeys {
  if (cached) return cached;
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
  return cached;
}

export function getDecryptedKey(field: TenantKeyField): string {
  return getTenantKeys()[field];
}

export function setTenantKey(field: TenantKeyField, value: string, updatedBy: string): void {
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
  return decryptKey({ cipher, iv, tag });
}
