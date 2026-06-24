import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

let masterKeyCache: Buffer | null = null;

export function getMasterKey(): Buffer {
  if (masterKeyCache) return masterKeyCache;
  const raw = process.env.TENANT_KEY_ENCRYPTION_SECRET;
  if (!raw) throw new Error("TENANT_KEY_ENCRYPTION_SECRET missing");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw.trim())) {
    throw new Error("TENANT_KEY_ENCRYPTION_SECRET must decode to 32 bytes (strict base64)");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("TENANT_KEY_ENCRYPTION_SECRET must decode to 32 bytes");
  masterKeyCache = buf;
  return buf;
}

export function encryptKey(plaintext: string): { cipher: string; iv: string; tag: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    cipher: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptKey(parts: { cipher: string; iv: string; tag: string }): string {
  const decipher = createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(parts.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parts.tag, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(parts.cipher, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}

export function resetMasterKeyCacheForTests(): void {
  masterKeyCache = null;
}
