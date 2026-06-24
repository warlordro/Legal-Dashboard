// Shared low-level PDF helpers + ExportResult type used by every build*Pdf()
// exporter. Kept in its own module so export.ts (dosare/termene/monitoring) and
// the extracted exporters (export-analysis.ts, export-manual.ts) can all
// import from one place without forming an import cycle through export.ts.

export const MIME_PDF = "application/pdf";

// Result envelope produced by every build*Xlsx/Pdf builder and consumed by the
// worker -> main-thread transfer in runExportInWorker(). Lives here (not in
// export.ts) so the extracted PDF builders can type their return value without
// importing back into export.ts.
export interface ExportResult {
  buffer: ArrayBuffer;
  filename: string;
  mime: string;
}

// jsPDF's default Helvetica font has no glyphs for Romanian diacritics;
// embedding a Unicode font would bloat the bundle by ~250KB. We strip
// diacritics for PDF output (Excel exports keep them — XLSX uses system fonts).
export function stripDiacritics(text: string): string {
  if (!text) return "";
  return text
    .replace(/[ăâ]/g, "a")
    .replace(/[ĂÂ]/g, "A")
    .replace(/[îì]/g, "i")
    .replace(/[ÎÌ]/g, "I")
    .replace(/[șş]/g, "s")
    .replace(/[ȘŞ]/g, "S")
    .replace(/[țţ]/g, "t")
    .replace(/[ȚŢ]/g, "T")
    .replace(/&amp;/g, "&");
}
