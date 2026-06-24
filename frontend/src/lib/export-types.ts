import type { Dosar, Termen } from "@/types";
import type { MonitoringJob } from "./api";
import type { DashboardReportPayload } from "./dashboardApi";
import type { AnalysisPdfArgs } from "./export-analysis";
import type { ExportResult } from "./pdf-helpers";

export type { AnalysisPdfArgs, ExportResult };

export type ExportJob =
  | { kind: "dosarePdf"; data: Dosar[] }
  | { kind: "termenePdf"; data: Termen[] }
  | { kind: "monitoringXlsx"; data: MonitoringJob[] }
  | { kind: "monitoringPdf"; data: MonitoringJob[] }
  | { kind: "analysisPdf"; data: AnalysisPdfArgs }
  | { kind: "manualPdf"; data: null }
  | { kind: "reportXlsx"; data: DashboardReportPayload }
  | { kind: "reportPdf"; data: DashboardReportPayload };
