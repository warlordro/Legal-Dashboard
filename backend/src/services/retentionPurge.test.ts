// EXT-M-09: retentia audit_log + ai_usage independenta de scheduler-ul de
// monitoring. Pattern de DB temporar preluat din auditRepository.test.ts /
// aiUsageRepository.test.ts.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runRetentionPurge } from "./retentionPurge.ts";
import * as aiUsageRepository from "../db/aiUsageRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";

let tmpRoot: string;
let dbPath: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-retention-"));
  dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
});

afterEach(async () => {
  vi.restoreAllMocks();
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function insertAiUsageRowAgedDays(days: number): void {
  const ts = new Date(Date.now() - days * 86_400_000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO ai_usage (owner_id, ts, provider, model, feature, input_tokens, output_tokens, cost_usd_milli)
       VALUES ('local', ?, 'anthropic', 'claude-sonnet-5', 'dosar_summary', 0, 0, 0)`
    )
    .run(ts);
}

function insertAuditRowAgedDays(days: number): void {
  const ts = new Date(Date.now() - days * 86_400_000).toISOString();
  getDb()
    .prepare(`INSERT INTO audit_log (owner_id, action, ts, detail_json) VALUES ('local', 'test.event', ?, '{}')`)
    .run(ts);
}

describe("runRetentionPurge (EXT-M-09)", () => {
  it("purjeaza randurile mai vechi de 90 zile din ai_usage si audit_log", () => {
    insertAiUsageRowAgedDays(95);
    insertAuditRowAgedDays(95);
    const res = runRetentionPurge();
    expect(res.aiUsageDeleted).toBe(1);
    expect(res.auditDeleted).toBe(1);
    expect(res.errors).toEqual([]);
  });

  it("eroarea pe purge-ul AI NU sare purge-ul de audit (try/catch separat)", () => {
    insertAuditRowAgedDays(95);
    vi.spyOn(aiUsageRepository, "purgeOldAiUsage").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const res = runRetentionPurge();
    expect(res.auditDeleted).toBe(1);
    expect(res.errors).toHaveLength(1);
  });
});
