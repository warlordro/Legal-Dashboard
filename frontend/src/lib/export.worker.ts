/// <reference lib="webworker" />
import { buildAnalysisPdf } from "./export-analysis";
import { buildDosarePdf } from "./export-dosare";
import { buildManualPdf } from "./export-manual";
import { buildMonitoringPdf, buildMonitoringXlsx } from "./export-monitoring";
import { buildReportPdf, buildReportXlsx } from "./export-report";
import { buildTermenePdf } from "./export-termene";
import type { ExportJob, ExportResult } from "./export-types";

// Web Worker care preia generarea XLSX/PDF de pe main thread pentru dosare,
// termene, monitorizari, analize AI si manualul de utilizare. Pe rezultate
// mari (sute/mii de inregistrari, sau manualul cu 12 capitole) build-ul
// blocheaza main thread-ul cateva secunde daca ruleaza in pagina; in worker,
// UI-ul ramane responsiv si spinner-ul React poate randa fluid pana la
// salvare.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<ExportJob>) => {
  try {
    let result: ExportResult;
    switch (e.data.kind) {
      case "dosarePdf":
        result = await buildDosarePdf(e.data.data);
        break;
      case "termenePdf":
        result = await buildTermenePdf(e.data.data);
        break;
      case "monitoringXlsx":
        result = await buildMonitoringXlsx(e.data.data);
        break;
      case "monitoringPdf":
        result = await buildMonitoringPdf(e.data.data);
        break;
      case "analysisPdf":
        result = await buildAnalysisPdf(e.data.data);
        break;
      case "manualPdf":
        result = await buildManualPdf();
        break;
      case "reportXlsx":
        result = await buildReportXlsx(e.data.data);
        break;
      case "reportPdf":
        result = await buildReportPdf(e.data.data);
        break;
    }
    ctx.postMessage({ ok: true, buffer: result.buffer, filename: result.filename, mime: result.mime }, [result.buffer]);
  } catch (err) {
    ctx.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
