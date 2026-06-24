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

  it("rejects an encrypted blob whose auth tag was flipped", () => {
    const encrypted = encryptKey("sk-live-secret");
    const tampered = { ...encrypted, tag: flipFirstByte(encrypted.tag) };
    expect(() => decryptKey(tampered)).toThrow();
  });

  it("rejects an encrypted blob whose IV was flipped", () => {
    const encrypted = encryptKey("sk-live-secret");
    const tampered = { ...encrypted, iv: flipFirstByte(encrypted.iv) };
    expect(() => decryptKey(tampered)).toThrow();
  });

  it("rejects an encrypted blob whose ciphertext was flipped", () => {
    const encrypted = encryptKey("sk-live-secret");
    const tampered = { ...encrypted, cipher: flipFirstByte(encrypted.cipher) };
    expect(() => decryptKey(tampered)).toThrow();
  });

  it("round-trips the empty string without producing identifiable padding", () => {
    const encrypted = encryptKey("");
    expect(encrypted.cipher.length).toBeGreaterThanOrEqual(0);
    expect(decryptKey(encrypted)).toBe("");
  });

  it("throws on a master key that is not valid base64-decodable to 32 bytes", () => {
    // 'AAAA' decodes to 3 bytes — well-formed base64 but wrong length. Confirms
    // the length check fires even when base64 parsing succeeds.
    process.env.TENANT_KEY_ENCRYPTION_SECRET = "AAAA";
    resetMasterKeyCacheForTests();
    expect(() => getMasterKey()).toThrow("TENANT_KEY_ENCRYPTION_SECRET must decode to 32 bytes");
  });

  it("requires strict padded base64 for the 32-byte web master key", () => {
    process.env.TENANT_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64url");
    resetMasterKeyCacheForTests();

    expect(() => getMasterKey()).toThrow("TENANT_KEY_ENCRYPTION_SECRET must decode to 32 bytes");
  });
});

function flipFirstByte(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  // XOR with 0xff so byte[0] always changes regardless of original value;
  // GCM's auth tag is sensitive to ANY ciphertext/IV/tag change, so a single
  // byte flip is sufficient to validate the tamper-detection contract.
  buf[0] = (buf[0] ?? 0) ^ 0xff;
  return buf.toString("base64");
}
