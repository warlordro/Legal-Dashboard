import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import type { Context } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../db/schema.ts";
import { createApiToken, revokeToken } from "../db/apiTokenRepository.ts";
import { insertUser, updateUserStatus } from "../db/userRepository.ts";
import { resolvePatContext } from "./patProvider.ts";
import { AuthenticationError } from "./authProvider.ts";

let tmpRoot: string;
const fakeCtx = {} as unknown as Context;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-pat-"));
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

describe("resolvePatContext", () => {
  it("resolves a valid PAT to the owner context with parsed scopes", () => {
    insertUser({ id: "alice", email: "alice@example.com", displayName: "Alice", status: "active" });
    const { secret } = createApiToken({
      ownerId: "alice",
      name: "mcp",
      scopes: ["dosare", "rnpm"],
      captchaDailyCap: null,
      expiresAt: null,
    });
    const ctx = resolvePatContext(fakeCtx, secret);
    expect(ctx.ownerId).toBe("alice");
    expect(ctx.actorId).toBe("alice");
    expect(ctx.tokenScopes).toEqual(["dosare", "rnpm"]);
    expect(ctx.tokenId).toBeDefined();
    expect(ctx.user?.id).toBe("alice");
  });

  it("rejects an unknown token with 401 invalid_token", () => {
    try {
      resolvePatContext(fakeCtx, "ld_pat_does_not_exist");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthenticationError);
      expect((err as AuthenticationError).status).toBe(401);
      expect((err as AuthenticationError).code).toBe("invalid_token");
    }
  });

  it("rejects a revoked token with 401 invalid_token", () => {
    insertUser({ id: "bob", email: "bob@example.com", displayName: "Bob", status: "active" });
    const { row, secret } = createApiToken({
      ownerId: "bob",
      name: "t",
      scopes: ["dosare"],
      captchaDailyCap: null,
      expiresAt: null,
    });
    revokeToken("bob", row.id);
    expect(() => resolvePatContext(fakeCtx, secret)).toThrow(AuthenticationError);
    try {
      resolvePatContext(fakeCtx, secret);
    } catch (err) {
      expect((err as AuthenticationError).code).toBe("invalid_token");
    }
  });

  it("rejects a valid token whose user is inactive (suspended) — 401 invalid_token", () => {
    insertUser({ id: "carol", email: "carol@example.com", displayName: "Carol", status: "active" });
    const { secret } = createApiToken({
      ownerId: "carol",
      name: "t",
      scopes: ["iccj"],
      captchaDailyCap: null,
      expiresAt: null,
    });
    updateUserStatus("carol", "suspended");
    expect(() => resolvePatContext(fakeCtx, secret)).toThrow(AuthenticationError);
    try {
      resolvePatContext(fakeCtx, secret);
    } catch (err) {
      expect((err as AuthenticationError).code).toBe("invalid_token");
    }
  });

  it("emits the SAME 401 code for unknown token and inactive user (no observable branch leak)", () => {
    insertUser({ id: "dave", email: "dave@example.com", displayName: "Dave", status: "suspended" });
    const { secret } = createApiToken({
      ownerId: "dave",
      name: "t",
      scopes: ["dosare"],
      captchaDailyCap: null,
      expiresAt: null,
    });
    const codeFor = (token: string): string => {
      try {
        resolvePatContext(fakeCtx, token);
        return "NO_THROW";
      } catch (err) {
        return (err as AuthenticationError).code;
      }
    };
    expect(codeFor("ld_pat_unknown")).toBe("invalid_token");
    expect(codeFor(secret)).toBe("invalid_token"); // inactive user → same generic code
  });
});
