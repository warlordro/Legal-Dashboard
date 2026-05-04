import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AlertExportRow } from "./alertsApi";
import { buildAlertsXlsx } from "./export-alerts";

function row(overrides: Partial<AlertExportRow> = {}): AlertExportRow {
  return {
    alert: {
      id: 1,
      owner_id: "local",
      job_id: 7,
      run_id: 9,
      kind: "dosar_new",
      severity: "info",
      title: "Alerta titlu",
      detail_json: "{}",
      dedup_key: "k",
      is_new: 1,
      created_at: "2026-05-03T08:30:00.000Z",
      read_at: null,
      dismissed_at: null,
    },
    numarDosar: "1234/3/2024",
    dosarLink: "https://portal.just.ro/SitePages/cautare.aspx?k=1234%2F3%2F2024",
    kindLabel: "Dosar nou",
    severityLabel: "Info",
    nameMonitored: null,
    ...overrides,
  };
}

describe("buildAlertsXlsx", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T10:00:00Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("returns an ArrayBuffer with the XLSX mime type", async () => {
    const out = await buildAlertsXlsx({ rows: [row()] });
    expect(out.buffer).toBeInstanceOf(ArrayBuffer);
    expect(out.buffer.byteLength).toBeGreaterThan(500);
    expect(out.mime).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("encodes the count and date in the filename", async () => {
    const out = await buildAlertsXlsx({
      rows: [row({ alert: { ...row().alert, id: 1 } }), row({ alert: { ...row().alert, id: 2 } })],
    });
    expect(out.filename).toBe("alerte_2_04-05-2026.xlsx");
  });

  it("renders a workbook even with zero rows (header-only sheet)", async () => {
    const out = await buildAlertsXlsx({ rows: [] });
    expect(out.buffer.byteLength).toBeGreaterThan(0);
    expect(out.filename).toBe("alerte_0_04-05-2026.xlsx");
  });
});
