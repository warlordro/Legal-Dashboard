import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./schema.ts";
import { hasPriorTokenUseFromIp, recordAudit } from "./auditRepository.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-priorip-"));
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

function seedUse(tokenId: string, ip: string, outcome: "ok" | "denied") {
  recordAudit(null, "api_token.used", { outcome, targetKind: "api_token", targetId: tokenId, ip });
}

describe("hasPriorTokenUseFromIp", () => {
  it("returns true once a successful use from that IP exists", () => {
    expect(hasPriorTokenUseFromIp("tok1", "1.2.3.4")).toBe(false);
    seedUse("tok1", "1.2.3.4", "ok");
    expect(hasPriorTokenUseFromIp("tok1", "1.2.3.4")).toBe(true);
  });

  it("is scoped by token and by IP", () => {
    seedUse("tok1", "1.2.3.4", "ok");
    expect(hasPriorTokenUseFromIp("tok1", "9.9.9.9")).toBe(false); // different IP
    expect(hasPriorTokenUseFromIp("tok2", "1.2.3.4")).toBe(false); // different token
  });

  it("IGNORES denied-outcome rows (a 403 from a new IP must not suppress the alert)", () => {
    // A stolen token hitting a forbidden route first writes a denied row with the IP.
    seedUse("tok1", "5.5.5.5", "denied");
    // The subsequent successful request from that IP must still be treated as NEW.
    expect(hasPriorTokenUseFromIp("tok1", "5.5.5.5")).toBe(false);
  });
});
