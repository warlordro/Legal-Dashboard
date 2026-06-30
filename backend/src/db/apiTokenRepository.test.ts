import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./schema.ts";
import {
  createApiToken,
  findActiveTokenByHash,
  getTokenCaptchaCap,
  hashToken,
  listTokensByOwner,
  revokeAllTokens,
  revokeToken,
  tokenExistsForOwner,
  touchLastUsed,
} from "./apiTokenRepository.ts";
import { countTokenCaptchaUsageInWindow, recordCaptchaUsage } from "./captchaUsageRepository.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-apitok-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
});
afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: env trebuie unset real
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("apiTokenRepository", () => {
  it("creates a token (ld_pat_ secret + short prefix), finds it by hash, loses it after revoke", () => {
    const { row, secret } = createApiToken({
      ownerId: "alice",
      name: "t1",
      scopes: ["dosare", "iccj"],
      captchaDailyCap: null,
      expiresAt: null,
    });
    expect(secret.startsWith("ld_pat_")).toBe(true);
    expect(row.token_prefix.startsWith("ld_pat_")).toBe(true);
    expect(row.token_prefix.length).toBeLessThan(secret.length);
    expect(findActiveTokenByHash(hashToken(secret))?.id).toBe(row.id);
    expect(revokeToken("alice", row.id)).toBe(true);
    expect(findActiveTokenByHash(hashToken(secret))).toBeNull();
  });

  it("does not return an expired token", () => {
    const { secret } = createApiToken({
      ownerId: "bob",
      name: "old",
      scopes: ["dosare"],
      captchaDailyCap: null,
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    expect(findActiveTokenByHash(hashToken(secret))).toBeNull();
  });

  it("returns a token whose expiry is in the future", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const { row, secret } = createApiToken({
      ownerId: "bob",
      name: "fresh",
      scopes: ["rnpm"],
      captchaDailyCap: 5,
      expiresAt: future,
    });
    expect(findActiveTokenByHash(hashToken(secret))?.id).toBe(row.id);
    expect(getTokenCaptchaCap(row.id)).toBe(5);
  });

  it("lists tokens owner-scoped and revoke is owner-scoped (IDOR guard)", () => {
    const a = createApiToken({
      ownerId: "alice",
      name: "a",
      scopes: ["dosare"],
      captchaDailyCap: null,
      expiresAt: null,
    });
    createApiToken({ ownerId: "bob", name: "b", scopes: ["dosare"], captchaDailyCap: null, expiresAt: null });
    expect(listTokensByOwner("alice").map((r) => r.id)).toEqual([a.row.id]);
    // bob cannot revoke alice's token
    expect(revokeToken("bob", a.row.id)).toBe(false);
    expect(findActiveTokenByHash(hashToken(a.secret))?.id).toBe(a.row.id);
  });

  it("revokeAllTokens counts only the owner's active tokens", () => {
    createApiToken({ ownerId: "carol", name: "1", scopes: ["dosare"], captchaDailyCap: null, expiresAt: null });
    const second = createApiToken({
      ownerId: "carol",
      name: "2",
      scopes: ["iccj"],
      captchaDailyCap: null,
      expiresAt: null,
    });
    createApiToken({ ownerId: "dave", name: "x", scopes: ["rnpm"], captchaDailyCap: null, expiresAt: null });
    revokeToken("carol", second.row.id); // already revoked → not counted again
    expect(revokeAllTokens("carol")).toBe(1);
    expect(revokeAllTokens("carol")).toBe(0); // idempotent
  });

  it("tokenExistsForOwner distinguishes missing vs revoked", () => {
    const { row } = createApiToken({
      ownerId: "erin",
      name: "t",
      scopes: ["dosare"],
      captchaDailyCap: null,
      expiresAt: null,
    });
    expect(tokenExistsForOwner("erin", row.id)).toBe(true);
    expect(tokenExistsForOwner("erin", "nonexistent")).toBe(false);
    revokeToken("erin", row.id);
    expect(tokenExistsForOwner("erin", row.id)).toBe(true); // still exists, just revoked
  });

  it("touchLastUsed records ip/ua", () => {
    const { row } = createApiToken({
      ownerId: "frank",
      name: "t",
      scopes: ["dosare"],
      captchaDailyCap: null,
      expiresAt: null,
    });
    touchLastUsed(row.id, "203.0.113.7", "curl/8");
    const after = getDb()
      .prepare("SELECT last_used_ip, last_used_ua, last_used_at FROM api_tokens WHERE id = ?")
      .get(row.id) as {
      last_used_ip: string | null;
      last_used_ua: string | null;
      last_used_at: string | null;
    };
    expect(after.last_used_ip).toBe("203.0.113.7");
    expect(after.last_used_ua).toBe("curl/8");
    expect(after.last_used_at).not.toBeNull();
  });

  it("counts token-scoped captcha usage in the window (token_id) separately from JWT rows", () => {
    recordCaptchaUsage({ ownerId: "grace", provider: "2captcha", source: "tenant", tokenId: "tokX" });
    recordCaptchaUsage({ ownerId: "grace", provider: "2captcha", source: "tenant", tokenId: "tokX" });
    recordCaptchaUsage({ ownerId: "grace", provider: "2captcha", source: "tenant", tokenId: null }); // JWT/desktop
    expect(countTokenCaptchaUsageInWindow("tokX", 86_400)).toBe(2);
    expect(countTokenCaptchaUsageInWindow("tokOther", 86_400)).toBe(0);
  });
});
