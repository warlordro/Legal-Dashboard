import type { ExportJob, ExportResult } from "./export-types";

export async function runExportInWorker(job: ExportJob): Promise<ExportResult> {
  const ExportWorker = (await import("./export.worker.ts?worker")).default;
  return new Promise<ExportResult>((resolve, reject) => {
    const worker = new ExportWorker();
    worker.onmessage = (
      e: MessageEvent<{ ok: true; buffer: ArrayBuffer; filename: string; mime: string } | { ok: false; error: string }>
    ) => {
      worker.terminate();
      if (!e.data.ok) {
        reject(new Error(e.data.error));
        return;
      }
      resolve({ buffer: e.data.buffer, filename: e.data.filename, mime: e.data.mime });
    };
    worker.onerror = (err: ErrorEvent) => {
      worker.terminate();
      reject(err.error ?? new Error(err.message || "Worker export error"));
    };
    worker.postMessage(job);
  });
}
