import { readdir, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { MonitoringAlertRow } from "../db/monitoringAlertsRepository.ts";
import { buildAlertsPdf } from "./alertsExportPdf.ts";
import type { AlertExportDecoratedRow } from "./alertsExportXlsx.ts";

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

function makeRow(): AlertExportDecoratedRow {
  return {
    alert: makeAlert(),
    numarDosar: "123/3/2026",
    dosarLink: "https://portal.just.ro/SitePages/cautare.aspx?k=123%2F3%2F2026",
    kindLabel: "Termen nou",
    severityLabel: "Atentie",
    nameMonitored: "ACME SRL",
  };
}

afterEach(async () => {
  const files = generatedFiles.splice(0);
  await Promise.all(files.map((file) => unlink(file).catch(() => {})));
});

describe("buildAlertsPdf", () => {
  it("produce PDF valid", async () => {
    const result = await buildAlertsPdf([makeRow()], "Selectie (1)");
    generatedFiles.push(result.filepath);

    expect(result.mime).toBe("application/pdf");
    expect(result.byteLength).toBeGreaterThan(1000);
    const bytes = await readFile(result.filepath);
    expect(bytes.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(result.filename).toMatch(/^alerte_1_.+\.pdf$/);
  });

  it("leaves no orphan tmp PDF when drawing throws (BUG-01)", async () => {
    const before = (await readdir(tmpdir())).filter((f) => f.startsWith("alerts-pdf-"));
    const poisoned = [
      new Proxy(
        {},
        {
          get() {
            throw new Error("boom");
          },
        }
      ),
    ] as never;
    await expect(buildAlertsPdf(poisoned)).rejects.toThrow();
    const after = (await readdir(tmpdir())).filter((f) => f.startsWith("alerts-pdf-"));
    expect(after.length).toBeLessThanOrEqual(before.length);
  });
});
