import { describe, expect, it } from "vitest";
import type { MonitoringAlertRow } from "../../db/monitoringAlertsRepository.ts";
import { deriveAlertDigestRow, getPortalJustUrl, renderDailyReport } from "./dailyReportTemplate.ts";

function alert(overrides: Partial<MonitoringAlertRow> = {}): MonitoringAlertRow {
  return {
    id: 1,
    owner_id: "local",
    job_id: 7,
    run_id: 9,
    kind: "termen_new",
    severity: "warning",
    title: "Termen nou",
    detail_json: "{}",
    dedup_key: "k",
    is_new: 1,
    created_at: "2026-05-03T10:00:00.000Z",
    read_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

describe("getPortalJustUrl", () => {
  it("encodes slashes and special chars", () => {
    expect(getPortalJustUrl("1234/3/2024")).toBe("https://portal.just.ro/SitePages/cautare.aspx?k=1234%2F3%2F2024");
  });

  it("encodes diacritics + spaces", () => {
    expect(getPortalJustUrl("Stefan Popescu")).toBe("https://portal.just.ro/SitePages/cautare.aspx?k=Stefan%20Popescu");
  });

  it("strips /aN sub-register suffix to find the parent on SharePoint indexer", () => {
    expect(getPortalJustUrl("2753/89/2025/a2")).toBe(
      "https://portal.just.ro/SitePages/cautare.aspx?k=2753%2F89%2F2025"
    );
    expect(getPortalJustUrl("2753/89/2025/a")).toBe("https://portal.just.ro/SitePages/cautare.aspx?k=2753%2F89%2F2025");
    expect(getPortalJustUrl("2753/89/2025/A2")).toBe(
      "https://portal.just.ro/SitePages/cautare.aspx?k=2753%2F89%2F2025"
    );
    expect(getPortalJustUrl("2753/89/2025")).toBe("https://portal.just.ro/SitePages/cautare.aspx?k=2753%2F89%2F2025");
  });
});

describe("deriveAlertDigestRow", () => {
  it("extracts numar_dosar from detail JSON", () => {
    const row = deriveAlertDigestRow(alert({ detail_json: JSON.stringify({ numar_dosar: "1234/3/2024" }) }));
    expect(row.numarDosar).toBe("1234/3/2024");
    expect(row.dosarLink).toBe("https://portal.just.ro/SitePages/cautare.aspx?k=1234%2F3%2F2024");
  });

  it("falls back to job_target_json numar_dosar when detail lacks it", () => {
    const row = deriveAlertDigestRow(
      alert({
        detail_json: "{}",
        job_target_json: JSON.stringify({ numar_dosar: "5555/2/2025" }),
      })
    );
    expect(row.numarDosar).toBe("5555/2/2025");
    expect(row.dosarLink).toContain("5555%2F2%2F2025");
  });

  it("returns null dosar when neither detail nor target carries it", () => {
    const row = deriveAlertDigestRow(alert({ detail_json: "{}" }));
    expect(row.numarDosar).toBeNull();
    expect(row.dosarLink).toBeNull();
  });

  it("recovers gracefully from invalid JSON in detail", () => {
    const row = deriveAlertDigestRow(alert({ detail_json: "{not-valid" }));
    expect(row.numarDosar).toBeNull();
    expect(row.title).toBe("Termen nou");
  });

  it("extracts name_normalized from detail or target", () => {
    const fromDetail = deriveAlertDigestRow(alert({ detail_json: JSON.stringify({ name_normalized: "ACME SRL" }) }));
    expect(fromDetail.nameMonitored).toBe("ACME SRL");

    const fromTarget = deriveAlertDigestRow(
      alert({
        detail_json: "{}",
        job_target_json: JSON.stringify({ name_normalized: "POPESCU ION" }),
      })
    );
    expect(fromTarget.nameMonitored).toBe("POPESCU ION");
  });

  it("maps severity + kind to RO labels", () => {
    const row = deriveAlertDigestRow(alert({ severity: "critical", kind: "solutie_aparuta" }));
    expect(row.severityLabel).toBe("Critic");
    expect(row.kindLabel).toBe("Solutie aparuta");
  });

  it("falls back to raw kind when label table doesn't know it", () => {
    const row = deriveAlertDigestRow(alert({ kind: "future_kind_xyz" as MonitoringAlertRow["kind"] }));
    expect(row.kindLabel).toBe("future_kind_xyz");
  });
});

describe("renderDailyReport", () => {
  it("returns rowCount = 0 and Romanian-formatted subject for empty input", () => {
    const out = renderDailyReport({ reportDateLocal: "2026-05-03", alerts: [] });
    expect(out.rowCount).toBe(0);
    expect(out.subject).toBe("[Legal Dashboard] Raport zilnic 03.05.2026 — 0 alerte");
    expect(out.html).toContain("Raport zilnic — 03.05.2026");
    expect(out.text).toContain("Raport zilnic — 03.05.2026");
  });

  it("uses singular noun in subject for exactly one alert", () => {
    const out = renderDailyReport({
      reportDateLocal: "2026-05-03",
      alerts: [alert()],
    });
    expect(out.subject).toBe("[Legal Dashboard] Raport zilnic 03.05.2026 — 1 alerta");
  });

  it("escapes HTML in alert titles to prevent template injection", () => {
    const out = renderDailyReport({
      reportDateLocal: "2026-05-03",
      alerts: [
        alert({
          title: "<script>alert(1)</script>",
          detail_json: "{}",
        }),
      ],
    });
    expect(out.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out.html).not.toContain("<script>alert(1)</script>");
  });

  it("groups alerts by severity with critical first", () => {
    const out = renderDailyReport({
      reportDateLocal: "2026-05-03",
      alerts: [
        alert({ id: 1, severity: "info", title: "A info" }),
        alert({ id: 2, severity: "critical", title: "A critic" }),
        alert({ id: 3, severity: "warning", title: "A warning" }),
      ],
    });
    const criticIdx = out.html.indexOf("A critic");
    const warnIdx = out.html.indexOf("A warning");
    const infoIdx = out.html.indexOf("A info");
    expect(criticIdx).toBeGreaterThan(-1);
    expect(warnIdx).toBeGreaterThan(criticIdx);
    expect(infoIdx).toBeGreaterThan(warnIdx);
  });

  it("renders dosar number as a portal.just.ro hyperlink", () => {
    const out = renderDailyReport({
      reportDateLocal: "2026-05-03",
      alerts: [
        alert({
          detail_json: JSON.stringify({ numar_dosar: "1234/3/2024" }),
        }),
      ],
    });
    expect(out.html).toContain('href="https://portal.just.ro/SitePages/cautare.aspx?k=1234%2F3%2F2024"');
    expect(out.text).toContain("1234/3/2024 (https://portal.just.ro/SitePages/cautare.aspx?k=1234%2F3%2F2024)");
  });

  it("renders an em-dash placeholder when there is no numar_dosar", () => {
    const out = renderDailyReport({
      reportDateLocal: "2026-05-03",
      alerts: [alert({ detail_json: "{}" })],
    });
    expect(out.html).toContain("—");
    expect(out.text).toContain("Dosar: —");
  });

  it("matches rowCount to the input length", () => {
    const out = renderDailyReport({
      reportDateLocal: "2026-05-03",
      alerts: [alert({ id: 1 }), alert({ id: 2 }), alert({ id: 3 })],
    });
    expect(out.rowCount).toBe(3);
    expect(out.subject).toContain("3 alerte");
  });

  it("includes the unsubscribe hint at the bottom of HTML and text", () => {
    const out = renderDailyReport({ reportDateLocal: "2026-05-03", alerts: [] });
    expect(out.html).toContain("Setari → Notificari email");
    expect(out.text).toContain("Setari → Notificari email");
  });
});
