// v2.42.0 (5.4): escape-ul de formule + structura raportului de audit.

import Database from "better-sqlite3";
import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../db/schema.ts";
import { insertUser } from "../db/userRepository.ts";
import { recordAudit, getAuditEvents } from "../db/auditRepository.ts";
import { buildAuditXlsx, safeCell } from "./auditExport.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-audit-export-"));
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

describe("safeCell", () => {
  it("prefixeaza cu apostrof orice valoare care incepe cu = + - @ tab CR", () => {
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(safeCell("+1")).toBe("'+1");
    expect(safeCell("-1")).toBe("'-1");
    expect(safeCell("@cmd")).toBe("'@cmd");
    expect(safeCell("\tx")).toBe("'\tx");
    expect(safeCell("\rx")).toBe("'\rx");
  });

  it("lasa neatinse valorile normale", () => {
    expect(safeCell("admin.users.create")).toBe("admin.users.create");
    expect(safeCell("")).toBe("");
  });
});

describe("buildAuditXlsx", () => {
  it("scrie randuri cu etichete umane, escape pe ip si placeholder system", async () => {
    insertUser({ id: "u-1", email: "alice@firma.ro", displayName: "Alice" });
    recordAudit(null, "admin.users.create", {
      ownerId: "u-1",
      actorId: "u-1",
      // ip care incepe cu "=" — trebuie escapat in celula (10.4c).
      ip: "=1+1",
      detail: { x: 1 },
    });
    recordAudit(null, "system.boot", { detail: {} }); // owner/actor NULL

    const rows = getAuditEvents({}).reverse();
    const buf = await buildAuditXlsx(rows, { since: null, until: null });

    // xlsx = arhiva ZIP.
    expect([buf[0], buf[1]]).toEqual([0x50, 0x4b]);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet("Audit");
    expect(sheet).toBeDefined();
    const values: string[][] = [];
    sheet?.eachRow((row) => {
      values.push((row.values as unknown[]).map((v) => String(v ?? "")));
    });
    const flat = values.flat().join("|");
    expect(flat).toContain("alice@firma.ro — Alice");
    expect(flat).toContain("'=1+1"); // ip escapat
    expect(flat).toContain("system"); // placeholder pe owner NULL
    expect(flat).toContain("OK"); // outcome tradus

    const meta = wb.getWorksheet("Interval");
    expect(meta?.getCell("B1").value).toBe("inceput");
  });
});
