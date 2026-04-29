/// <reference lib="webworker" />
import {
  buildAnalysisPdf,
  buildDosareXlsx,
  buildDosarePdf,
  buildManualPdf,
  buildTermeneXlsx,
  buildTermenePdf,
  type ExportJob,
  type ExportResult,
} from "./export";

// Web Worker care preia generarea XLSX/PDF de pe main thread pentru dosare,
// termene, analize AI si manualul de utilizare. Pe rezultate mari (sute/mii de
// inregistrari + sedinte, sau manualul cu 12 capitole) build-ul blocheaza main
// thread-ul cateva secunde daca ruleaza in pagina; in worker, UI-ul ramane
// responsiv si spinner-ul React poate randa fluid pana la salvare.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<ExportJob>) => {
  try {
    let result: ExportResult;
    switch (e.data.kind) {
      case "dosareXlsx":
        result = await buildDosareXlsx(e.data.data);
        break;
      case "dosarePdf":
        result = await buildDosarePdf(e.data.data);
        break;
      case "termeneXlsx":
        result = await buildTermeneXlsx(e.data.data);
        break;
      case "termenePdf":
        result = await buildTermenePdf(e.data.data);
        break;
      case "analysisPdf":
        result = await buildAnalysisPdf(e.data.data);
        break;
      case "manualPdf":
        result = await buildManualPdf();
        break;
    }
    ctx.postMessage(
      { ok: true, buffer: result.buffer, filename: result.filename, mime: result.mime },
      [result.buffer],
    );
  } catch (err) {
    ctx.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
