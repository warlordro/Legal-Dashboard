import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "./schema.ts";
import {
  getDecryptedKey,
  getTenantKeys,
  invalidateCache,
  setCaptchaSettings,
  setTenantKey,
} from "./tenantKeysRepository.ts";
import { resetMasterKeyCacheForTests } from "../util/tenantKeyCrypto.ts";

let tmpRoot: string;
const originalDbPath = process.env.LEGAL_DASHBOARD_DB_PATH;
const originalSecret = process.env.TENANT_KEY_ENCRYPTION_SECRET;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-tenant-keys-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  process.env.TENANT_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
  resetMasterKeyCacheForTests();
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
  invalidateCache();
});

afterEach(async () => {
  closeDb();
  invalidateCache();
  resetMasterKeyCacheForTests();
  if (originalDbPath === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real intre teste.
    delete process.env.LEGAL_DASHBOARD_DB_PATH;
  } else {
    process.env.LEGAL_DASHBOARD_DB_PATH = originalDbPath;
  }
  if (originalSecret === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real intre teste.
    delete process.env.TENANT_KEY_ENCRYPTION_SECRET;
  } else {
    process.env.TENANT_KEY_ENCRYPTION_SECRET = originalSecret;
  }
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("tenantKeysRepository", () => {
  it("bootstraps the singleton row with empty keys", () => {
    const keys = getTenantKeys();

    expect(keys.anthropic).toBe("");
    expect(keys.captchaProvider).toBe("2captcha");
    expect(keys.captchaMode).toBe("sequential");
  });

  it("upserts and decrypts a key", () => {
    setTenantKey("openai", "sk-openai-secret", "admin-1");

    expect(getDecryptedKey("openai")).toBe("sk-openai-secret");
    const row = getDb()
      .prepare("SELECT openai_cipher, openai_iv, openai_tag, updated_by FROM tenant_api_keys WHERE scope = 'tenant'")
      .get() as { openai_cipher: string; openai_iv: string; openai_tag: string; updated_by: string };
    expect(row.openai_cipher).not.toContain("sk-openai-secret");
    expect(row.openai_iv).toMatch(/.+/);
    expect(row.openai_tag).toMatch(/.+/);
    expect(row.updated_by).toBe("admin-1");
  });

  it("clears cipher, iv, and tag atomically when value is empty", () => {
    setTenantKey("google", "AIza-secret", "admin-1");
    setTenantKey("google", "", "admin-2");

    expect(getDecryptedKey("google")).toBe("");
    const row = getDb()
      .prepare("SELECT google_cipher, google_iv, google_tag, updated_by FROM tenant_api_keys WHERE scope = 'tenant'")
      .get() as {
      google_cipher: string | null;
      google_iv: string | null;
      google_tag: string | null;
      updated_by: string;
    };
    expect(row).toMatchObject({
      google_cipher: null,
      google_iv: null,
      google_tag: null,
      updated_by: "admin-2",
    });
  });

  it("invalidates cache after writes", () => {
    setTenantKey("anthropic", "sk-ant-old", "admin-1");
    expect(getTenantKeys().anthropic).toBe("sk-ant-old");

    setTenantKey("anthropic", "sk-ant-new", "admin-1");

    expect(getTenantKeys().anthropic).toBe("sk-ant-new");
  });

  it("updates captcha settings and invalidates cache", () => {
    expect(getTenantKeys().captchaProvider).toBe("2captcha");

    setCaptchaSettings({ provider: "capsolver", mode: "race", updatedBy: "admin-1" });

    expect(getTenantKeys()).toMatchObject({
      captchaProvider: "capsolver",
      captchaMode: "race",
      updatedBy: "admin-1",
    });
  });
});
