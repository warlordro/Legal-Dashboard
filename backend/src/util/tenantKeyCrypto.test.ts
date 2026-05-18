import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptKey, encryptKey, getMasterKey, resetMasterKeyCacheForTests } from "./tenantKeyCrypto.ts";

const originalSecret = process.env.TENANT_KEY_ENCRYPTION_SECRET;

function setSecret(bytes = 32): string {
  const secret = randomBytes(bytes).toString("base64");
  process.env.TENANT_KEY_ENCRYPTION_SECRET = secret;
  resetMasterKeyCacheForTests();
  return secret;
}

beforeEach(() => {
  setSecret();
});

afterEach(() => {
  resetMasterKeyCacheForTests();
  if (originalSecret === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real intre teste.
    delete process.env.TENANT_KEY_ENCRYPTION_SECRET;
  } else {
    process.env.TENANT_KEY_ENCRYPTION_SECRET = originalSecret;
  }
});

describe("tenantKeyCrypto", () => {
  it("encrypts and decrypts a key without storing plaintext in ciphertext", () => {
    const encrypted = encryptKey("sk-live-secret");

    expect(encrypted.cipher).not.toContain("sk-live-secret");
    expect(encrypted.iv).toMatch(/.+/);
    expect(encrypted.tag).toMatch(/.+/);
    expect(decryptKey(encrypted)).toBe("sk-live-secret");
  });

  it("throws when the master key is missing", () => {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real pentru test.
    delete process.env.TENANT_KEY_ENCRYPTION_SECRET;
    resetMasterKeyCacheForTests();

    expect(() => getMasterKey()).toThrow("TENANT_KEY_ENCRYPTION_SECRET missing");
  });

  it("throws when the master key does not decode to 32 bytes", () => {
    setSecret(16);

    expect(() => getMasterKey()).toThrow("TENANT_KEY_ENCRYPTION_SECRET must decode to 32 bytes");
  });
});
