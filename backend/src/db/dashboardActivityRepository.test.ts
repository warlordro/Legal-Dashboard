// Regresie 2026-07-30 (review adversarial pe fixul de ora locala).
//
// Timeline-ul si raportul de pe Dashboard citesc din trei surse cu DOUA formate de
// timp: `audit_log.ts` e naiv ("YYYY-MM-DD HH:MM:SS", scris de `datetime('now')`),
// iar alertele/rularile sunt ISO cu Z (`strftime`). Rutele calculeaza fereastra in
// ISO, deci comparatia lexicografica pe coloana naiva (' ' < 'T') excludea
// evenimentele de audit chiar de la limita ferestrei — subraportare silentioasa in
// raportul de 7d/30d. Aici pinuim exact acea limita, pe formatul real al coloanei.

import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "./schema.ts";
import { listCuratedAuditBefore, listCuratedAuditInRange } from "./dashboardActivityRepository.ts";

let tmpRoot: string;

function seedAudit(ts: string, action = "monitoring.job.deleted"): void {
  getDb()
    .prepare("INSERT INTO audit_log (owner_id, actor_id, action, outcome, ts, detail_json) VALUES (?,?,?,?,?,'{}')")
    .run("alice", "alice", action, "ok", ts);
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-dash-activity-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  new Database(process.env.LEGAL_DASHBOARD_DB_PATH).close();
  getDb();
});

afterEach(async () => {
  closeDb();
  // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("listCuratedAuditInRange — fereastra ISO pe coloana naiva", () => {
  it("include randul exact de la limita inferioara a ferestrei", () => {
    seedAudit("2026-07-24 00:00:00", "monitoring.job.bulk_deleted");
    seedAudit("2026-07-24 09:00:00");
    seedAudit("2026-07-23 23:59:59", "backup.restore"); // inaintea ferestrei

    const rows = listCuratedAuditInRange({
      ownerId: "alice",
      since: "2026-07-24T00:00:00.000Z",
      until: "2026-07-30T23:59:59.999Z",
      limit: 50,
    });

    expect(rows.map((r) => r.ts).sort()).toEqual(["2026-07-24 00:00:00", "2026-07-24 09:00:00"]);
  });
});

describe("listCuratedAuditBefore — cursor ISO pe coloana naiva", () => {
  it("intoarce randurile mai vechi decat un cursor exprimat in ISO", () => {
    seedAudit("2026-07-29 22:00:00");
    seedAudit("2026-07-29 20:00:00", "monitoring.job.bulk_deleted");

    const rows = listCuratedAuditBefore({
      ownerId: "alice",
      before: "2026-07-29T21:00:00.000Z",
      limit: 50,
    });

    expect(rows.map((r) => r.ts)).toEqual(["2026-07-29 20:00:00"]);
  });
});
