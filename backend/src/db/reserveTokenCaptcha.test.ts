import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./schema.ts";
import { reserveTokenCaptcha } from "./captchaUsageRepository.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-reserve-"));
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

function reserve(cap: number) {
  return reserveTokenCaptcha({ ownerId: "alice", tokenId: "tok1", provider: "2captcha", cap, windowSeconds: 86_400 });
}

describe("reserveTokenCaptcha — fail-closed on invalid cap", () => {
  it("does not reserve for NaN / Infinity / negative / zero caps", () => {
    expect(reserve(Number.NaN)).toBe(false);
    expect(reserve(Number.POSITIVE_INFINITY)).toBe(false);
    expect(reserve(-1)).toBe(false);
    expect(reserve(0)).toBe(false);
    // niciun rand inserat pe caile fail-closed
    const n = (getDb().prepare("SELECT COUNT(*) AS n FROM captcha_usage").get() as { n: number }).n;
    expect(n).toBe(0);
  });

  it("reserves up to a valid positive cap, then blocks", () => {
    expect(reserve(2)).toBe(true);
    expect(reserve(2)).toBe(true);
    expect(reserve(2)).toBe(false); // cap atins
    const n = (getDb().prepare("SELECT COUNT(*) AS n FROM captcha_usage WHERE token_id='tok1'").get() as { n: number })
      .n;
    expect(n).toBe(2);
  });
});
