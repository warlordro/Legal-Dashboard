import { describe, expect, it } from "vitest";

describe("F11-F3 split: public surface preserved", () => {
  it("export-dosare expune exportDosareExcel si exportDosarePDF", async () => {
    const m = await import("@/lib/export-dosare");
    expect(typeof m.exportDosareExcel).toBe("function");
    expect(typeof m.exportDosarePDF).toBe("function");
  });

  it("export-termene expune exportTermeneExcel si exportTermenePDF", async () => {
    const m = await import("@/lib/export-termene");
    expect(typeof m.exportTermeneExcel).toBe("function");
    expect(typeof m.exportTermenePDF).toBe("function");
  });

  it("export-monitoring expune builders si orchestrators", async () => {
    const m = await import("@/lib/export-monitoring");
    expect(typeof m.buildMonitoringXlsx).toBe("function");
    expect(typeof m.buildMonitoringPdf).toBe("function");
    expect(typeof m.exportMonitoringExcel).toBe("function");
    expect(typeof m.exportMonitoringPDF).toBe("function");
  });

  it("export-analysis expune buildAnalysisPdf si exportAnalysisPDF", async () => {
    const m = await import("@/lib/export-analysis");
    expect(typeof m.buildAnalysisPdf).toBe("function");
    expect(typeof m.exportAnalysisPDF).toBe("function");
  });

  it("export-manual expune buildManualPdf si exportManualPDF", async () => {
    const m = await import("@/lib/export-manual");
    expect(typeof m.buildManualPdf).toBe("function");
    expect(typeof m.exportManualPDF).toBe("function");
  });

  it("export-report expune exportReportXlsx si exportReportPdf", async () => {
    const m = await import("@/lib/export-report");
    expect(typeof m.exportReportXlsx).toBe("function");
    expect(typeof m.exportReportPdf).toBe("function");
  });
});
