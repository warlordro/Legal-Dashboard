/// <reference lib="webworker" />
import { buildRnpmXlsx, buildRnpmPdf, type RnpmExportPayload } from "./rnpmExport";

// Web Worker care preia generarea XLSX/PDF de pe main thread. Pe volume mari de
// avize (sute, mii) build-ul + stilizarea blocheaza main thread-ul cateva secunde
// daca ruleaza in pagina; in worker, UI-ul ramane responsiv si spinner-ul React
// poate randa fluid pana cand fisierul e gata.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<RnpmExportPayload>) => {
  try {
    const result = e.data.format === "xlsx" ? await buildRnpmXlsx(e.data) : await buildRnpmPdf(e.data);
    ctx.postMessage({ ok: true, buffer: result.buffer, filename: result.filename, mime: result.mime }, [result.buffer]);
  } catch (err) {
    ctx.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
