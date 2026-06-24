import ExcelJS from "exceljs";
import { unlink } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { MonitoringAlertRow } from "../db/monitoringAlertsRepository.ts";
import { buildAlertsXlsx, type AlertExportDecoratedRow } from "./alertsExportXlsx.ts";

const generatedFiles: string[] = [];

function makeAlert(overrides: Partial<MonitoringAlertRow> = {}): MonitoringAlertRow {
  return {
    id: 1,
    owner_id: "local",
    job_id: 10,
    run_id: 20,
    kind: "termen_new",
    severity: "warning",
    title: "Termen nou",
    detail_json: "{}",
    dedup_key: "dedup-1",
    is_new: 1,
    created_at: "2026-05-12T10:30:00.000Z",
    read_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function makeRow(overrides: Partial<AlertExportDecoratedRow> = {}): AlertExportDecoratedRow {
  return {
    alert: makeAlert(),
    numarDosar: "123/3/2026",
    dosarLink: "https://portal.just.ro/SitePages/cautare.aspx?k=123%2F3%2F2026",
    kindLabel: "Termen nou",
    severityLabel: "Atentie",
    nameMonitored: "ACME SRL",
    ...overrides,
  };
}

afterEach(async () => {
  const files = generatedFiles.splice(0);
  await Promise.all(files.map((file) => unlink(file).catch(() => {})));
});

describe("buildAlertsXlsx", () => {
  it("produce workbook valid cu hyperlink pe dosar", async () => {
    const result = await buildAlertsXlsx([makeRow()], "Selectie (1)");
    generatedFiles.push(result.filepath);

    expect(result.mime).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(result.byteLength).toBeGreaterThan(1000);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.filepath);
    const sheet = workbook.getWorksheet("Alerte");
    expect(sheet?.getCell("A1").text).toBe("Legal Dashboard - Alerte");
    expect(sheet?.getCell("E5").text).toBe("123/3/2026");
    expect(sheet?.getCell("E5").hyperlink).toContain("portal.just.ro");
  });

  it("sanitizeaza formule in titlu", async () => {
    const result = await buildAlertsXlsx([makeRow({ alert: makeAlert({ title: "=SUM(A1)" }) })]);
    generatedFiles.push(result.filepath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.filepath);
    expect(workbook.getWorksheet("Alerte")?.getCell("D5").value).toBe("'=SUM(A1)");
  });
});
