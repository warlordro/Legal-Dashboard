import type { Dosar, Termen } from "@/types";
import { formatDate } from "./utils";
import { normalizeInstitutie } from "./institutii";
import {
  BLUE_DARK,
  BLUE_LIGHT,
  cellAddr,
  ensureCell,
  mergeRow,
  ROW_ALT,
  sanitizeFormulaCells,
  styleCell,
  styleDataCell,
  styleHeader,
  styleRow,
  styleStats,
  styleTitle,
  todayRo,
  WHITE,
} from "./excel-helpers";

// ─── Worker helpers (orchestratori) ───────────────────────────────────────────
// Builderii (build*) sunt pure si pot rula in worker; orchestratorii (export*)
// fac round-trip prin worker si declanseaza download-ul din main thread.

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_PDF = "application/pdf";

export interface ExportResult {
  buffer: ArrayBuffer;
  filename: string;
  mime: string;
}

export interface AnalysisPdfArgs {
  dosarNumar: string;
  dosarInstitutie: string;
  dosarObiect: string;
  analysisText: string;
  type?: "simple" | "advanced";
  judgeModel?: string;
}

export type ExportJob =
  | { kind: "dosareXlsx"; data: Dosar[] }
  | { kind: "dosarePdf"; data: Dosar[] }
  | { kind: "termeneXlsx"; data: Termen[] }
  | { kind: "termenePdf"; data: Termen[] }
  | { kind: "analysisPdf"; data: AnalysisPdfArgs }
  | { kind: "manualPdf"; data: null };

function triggerDownload(buffer: ArrayBuffer, filename: string, mime: string): void {
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function runExportInWorker(job: ExportJob): Promise<ExportResult> {
  const ExportWorker = (await import("./export.worker.ts?worker")).default;
  return new Promise<ExportResult>((resolve, reject) => {
    const worker = new ExportWorker();
    worker.onmessage = (e: MessageEvent<{ ok: true; buffer: ArrayBuffer; filename: string; mime: string } | { ok: false; error: string }>) => {
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

// xlsx-js-style@1.2.0 returneaza ArrayBuffer pentru type:"array" (nu Uint8Array
// ca documenteaza SheetJS upstream); `Uint8Array.set(ArrayBuffer)` se evalueaza
// silentios la no-op (ArrayBuffer nu are .length) si rezulta un fisier plin de
// zerouri. Acceptam ambele forme si producem un ArrayBuffer transferabil.
function toTransferableBuffer(out: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (out instanceof ArrayBuffer) return out;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function formatInstitutie(raw: string): string {
  if (!raw) return "-";
  return normalizeInstitutie(raw);
}

// ─── Filename helpers ─────────────────────────────────────────────────────────

function sanitizeNr(nr: string): string {
  return (nr || "").replace(/[/\\:*?"<>|]/g, "-").trim() || "dosar";
}

function dosareFilename(dosare: Dosar[], ext: "xlsx" | "pdf"): string {
  if (dosare.length === 1) return `dosar_${sanitizeNr(dosare[0].numar)}.${ext}`;
  return `dosare_${todayRo()}.${ext}`;
}

function termeneFilename(termene: Termen[], ext: "xlsx" | "pdf"): string {
  if (termene.length === 1) return `termen_${sanitizeNr(termene[0].numarDosar)}.${ext}`;
  return `termene_${todayRo()}.${ext}`;
}

const styleSectionHeader = {
  font: { bold: true, sz: 9, color: { rgb: BLUE_DARK } },
  fill: { patternType: "solid", fgColor: { rgb: BLUE_LIGHT } },
  alignment: { horizontal: "left", vertical: "center" },
};

export async function buildDosareXlsx(dosare: Dosar[]): Promise<ExportResult> {
  const XLSX = await import("xlsx-js-style");

  const totalSedinte = dosare.reduce((s, d) => s + d.sedinte.length, 0);
  const dateStr = new Date().toLocaleDateString("ro-RO");
  const hasSedinte = dosare.some((d) => d.sedinte.length > 0);

  // ── Pre-calculare pozitii rânduri pentru hyperlink-uri bidirecționale ──────
  // Dosare sheet: titlu(0), stats(1), gol(2), header(3), date de la 4
  // Sedinte sheet: titlu(0), stats(1), gol(2), header(3), apoi grupe pe dosar
  const sedinteRowMap = new Map<string, number>(); // numar → rând section header în Sedinte
  if (hasSedinte) {
    let row = 4; // după titlu+stats+gol+header
    dosare.forEach((d) => {
      if (d.sedinte.length === 0) return;
      sedinteRowMap.set(d.numar, row);
      row += 1 + d.sedinte.length; // 1 section header + N sedinte
    });
  }

  // ── Sheet 1: Dosare ────────────────────────────────────────────────────────
  const D_COLS = 9; // A–I
  const D_HEADERS = ["#", "Numar Dosar", "Data", "Institutie", "Departament", "Categorie / Stadiu", "Obiect", "Parti", "Nr. Sedinte"];
  const D_WIDTHS  = [5, 22, 14, 28, 20, 28, 32, 45, 12];

  const dosareAoA: (string | number | null)[][] = [
    ["PORTALJUST DASHBOARD — DOSARE", ...Array(D_COLS - 1).fill(null)],
    [`Generat: ${dateStr}  |  ${dosare.length} dosare  |  ${totalSedinte} sedinte`, ...Array(D_COLS - 1).fill(null)],
    Array(D_COLS).fill(null),
    D_HEADERS,
    ...dosare.map((d, i) => [
      i + 1,
      d.numar || "-",
      formatDate(d.data),
      formatInstitutie(d.institutie),
      d.departament || "-",
      [d.categorieCaz, d.stadiuProcesual].filter(Boolean).join(" / ") || "-",
      d.obiect || "-",
      d.parti.map((p) => `${p.calitateParte}: ${p.nume}`).join("\n") || "-",
      d.sedinte.length,
    ]),
  ];

  const wsDosare = XLSX.utils.aoa_to_sheet(dosareAoA) as Record<string, unknown>;
  wsDosare["!cols"] = D_WIDTHS.map((w) => ({ wch: w }));
  wsDosare["!rows"] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 6 }, { hpt: 18 }];

  mergeRow(wsDosare, 0, D_COLS);
  mergeRow(wsDosare, 1, D_COLS);
  styleRow(wsDosare, 0, D_COLS, styleTitle);
  styleRow(wsDosare, 1, D_COLS, styleStats);
  styleRow(wsDosare, 3, D_COLS, styleHeader);

  dosare.forEach((d, i) => {
    const r = 4 + i;
    const isAlt = i % 2 === 1;
    for (let c = 0; c < D_COLS; c++) {
      const isNumar = c === 1;
      const hasSedinteLnk = isNumar && hasSedinte && sedinteRowMap.has(d.numar);
      styleCell(wsDosare, r, c, hasSedinteLnk
        ? { // Hyperlink style — albastru subliniat
            font: { bold: true, sz: 9, color: { rgb: "1D4ED8" }, underline: true },
            fill: { patternType: "solid", fgColor: { rgb: isAlt ? ROW_ALT : WHITE } },
            alignment: { horizontal: "left", vertical: "top", wrapText: true },
          }
        : styleDataCell(i, isNumar));
      // Adaugă hyperlink spre secțiunea din Sedinte
      if (hasSedinteLnk) {
        const sedinteRow = sedinteRowMap.get(d.numar)!;
        (wsDosare[cellAddr(r, c)] as Record<string, unknown>).l = {
          Target: `#Sedinte!A${sedinteRow + 1}`,
          Tooltip: `Vezi sedintele dosarului ${d.numar}`,
        };
      }
    }
  });

  // ── Sheet 2: Sedinte (grupate pe dosar) ────────────────────────────────────
  let wsSedinte: Record<string, unknown> | null = null;

  if (hasSedinte) {
    const S_COLS = 10; // A–J
    const S_HEADERS = ["#", "Numar Dosar", "Data Sedinta", "Ora", "Complet", "Solutie", "Sumar Solutie", "Document", "Nr. Document", "Data Pronuntare"];
    const S_WIDTHS  = [5, 22, 14, 8, 20, 32, 32, 22, 16, 14];

    const sedinteAoA: (string | number | null)[][] = [
      ["PORTALJUST DASHBOARD — SEDINTE", ...Array(S_COLS - 1).fill(null)],
      [`Generat: ${dateStr}  |  ${totalSedinte} sedinte din ${dosare.length} dosare`, ...Array(S_COLS - 1).fill(null)],
      Array(S_COLS).fill(null),
      S_HEADERS,
    ];

    const sectionHeaderRows: { r: number; numar: string; dosarIdx: number }[] = [];
    const dataRows: { r: number; alt: number }[] = [];
    let sedintaIdx = 0;

    dosare.forEach((d, dosarIdx) => {
      if (d.sedinte.length === 0) return;
      const secRow = sedinteAoA.length;
      sedinteAoA.push([`Dosar: ${d.numar}  (${d.sedinte.length} sedinte)  ↑`, ...Array(S_COLS - 1).fill(null)]);
      sectionHeaderRows.push({ r: secRow, numar: d.numar, dosarIdx });

      d.sedinte.forEach((s) => {
        const dataRow = sedinteAoA.length;
        sedinteAoA.push([
          sedintaIdx + 1,
          d.numar,
          formatDate(s.data),
          s.ora || "-",
          s.complet || "-",
          s.solutie || "-",
          s.solutieSumar || "-",
          s.documentSedinta || "-",
          s.numarDocument || "-",
          formatDate(s.dataPronuntare),
        ]);
        dataRows.push({ r: dataRow, alt: sedintaIdx });
        sedintaIdx++;
      });
    });

    wsSedinte = XLSX.utils.aoa_to_sheet(sedinteAoA) as Record<string, unknown>;
    wsSedinte["!cols"] = S_WIDTHS.map((w) => ({ wch: w }));
    wsSedinte["!rows"] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 6 }, { hpt: 18 }];

    mergeRow(wsSedinte, 0, S_COLS);
    mergeRow(wsSedinte, 1, S_COLS);
    styleRow(wsSedinte, 0, S_COLS, styleTitle);
    styleRow(wsSedinte, 1, S_COLS, styleStats);
    styleRow(wsSedinte, 3, S_COLS, styleHeader);

    sectionHeaderRows.forEach(({ r, numar, dosarIdx }) => {
      mergeRow(wsSedinte!, r, S_COLS);
      // Stil section header cu hint că e link înapoi (↑)
      styleRow(wsSedinte!, r, S_COLS, {
        ...styleSectionHeader,
        font: { bold: true, sz: 9, color: { rgb: BLUE_DARK }, underline: true },
      });
      // Hyperlink înapoi la rândul dosarului din sheet-ul Dosare
      const dosareRow = 4 + dosarIdx; // titlu(0)+stats(1)+gol(2)+header(3) + index
      const addr = cellAddr(r, 0);
      ensureCell(wsSedinte!, addr);
      (wsSedinte![addr] as Record<string, unknown>).l = {
        Target: `#Dosare!B${dosareRow + 1}`,
        Tooltip: `Inapoi la dosarul ${numar} in tab Dosare`,
      };
    });

    dataRows.forEach(({ r, alt }) => {
      for (let c = 0; c < S_COLS; c++) {
        styleCell(wsSedinte!, r, c, styleDataCell(alt, c === 1));
      }
    });
  }

  sanitizeFormulaCells(wsDosare);
  if (wsSedinte) sanitizeFormulaCells(wsSedinte);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsDosare as import("xlsx").WorkSheet, "Dosare");
  if (wsSedinte) XLSX.utils.book_append_sheet(wb, wsSedinte as import("xlsx").WorkSheet, "Sedinte");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer | Uint8Array;
  return { buffer: toTransferableBuffer(out), filename: dosareFilename(dosare, "xlsx"), mime: MIME_XLSX };
}

export async function buildTermeneXlsx(termene: Termen[]): Promise<ExportResult> {
  const XLSX = await import("xlsx-js-style");

  const dateStr = new Date().toLocaleDateString("ro-RO");
  const T_COLS = 8; // A–H
  const T_HEADERS = ["#", "Numar Dosar", "Data", "Ora", "Institutie", "Complet", "Solutie", "Sumar Solutie"];
  const T_WIDTHS  = [5, 22, 14, 8, 30, 22, 35, 35];

  const termeneAoA: (string | number | null)[][] = [
    ["PORTALJUST DASHBOARD — TERMENE", ...Array(T_COLS - 1).fill(null)],
    [`Generat: ${dateStr}  |  ${termene.length} termene`, ...Array(T_COLS - 1).fill(null)],
    Array(T_COLS).fill(null),
    T_HEADERS,
    ...termene.map((t, i) => [
      i + 1,
      t.numarDosar || "-",
      formatDate(t.data),
      t.ora || "-",
      formatInstitutie(t.institutie),
      t.complet || "-",
      t.solutie || "-",
      t.solutieSumar || "-",
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(termeneAoA) as Record<string, unknown>;
  ws["!cols"] = T_WIDTHS.map((w) => ({ wch: w }));
  ws["!rows"] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 6 }, { hpt: 18 }];

  mergeRow(ws, 0, T_COLS);
  mergeRow(ws, 1, T_COLS);
  styleRow(ws, 0, T_COLS, styleTitle);
  styleRow(ws, 1, T_COLS, styleStats);
  styleRow(ws, 3, T_COLS, styleHeader);

  termene.forEach((_, i) => {
    const r = 4 + i;
    for (let c = 0; c < T_COLS; c++) {
      styleCell(ws, r, c, styleDataCell(i, c === 1));
    }
  });

  sanitizeFormulaCells(ws);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws as import("xlsx").WorkSheet, "Termene");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer | Uint8Array;
  return { buffer: toTransferableBuffer(out), filename: termeneFilename(termene, "xlsx"), mime: MIME_XLSX };
}

// Strip diacritics for PDF (jsPDF default font doesn't support them)
function stripDiacritics(text: string): string {
  if (!text) return "";
  return text
    .replace(/[ăâ]/g, "a").replace(/[ĂÂ]/g, "A")
    .replace(/[îì]/g, "i").replace(/[ÎÌ]/g, "I")
    .replace(/[șş]/g, "s").replace(/[ȘŞ]/g, "S")
    .replace(/[țţ]/g, "t").replace(/[ȚŢ]/g, "T")
    .replace(/&amp;/g, "&");
}

function formatPartiPDF(parti: Dosar["parti"]): string {
  if (parti.length === 0) return "-";
  return parti.map((p) => `${stripDiacritics(p.calitateParte)}: ${stripDiacritics(p.nume)}`).join("\n");
}

function formatSedintePDF(sedinte: Dosar["sedinte"]): string {
  if (sedinte.length === 0) return "-";
  return sedinte
    .map((s) => {
      const parts = [formatDate(s.data)];
      if (s.ora) parts.push(s.ora);
      if (s.solutie) parts.push("- " + stripDiacritics(s.solutie));
      if (s.solutieSumar) parts.push("(" + stripDiacritics(s.solutieSumar) + ")");
      return parts.join(" ");
    })
    .join("\n");
}

export async function buildDosarePdf(dosare: Dosar[]): Promise<ExportResult> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // Title
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Legal Dashboard - Dosare", 14, 16);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const totalSedinte = dosare.reduce((sum, d) => sum + d.sedinte.length, 0);
  doc.text(`Generat: ${new Date().toLocaleDateString("ro-RO")}  |  Total: ${dosare.length} dosare, ${totalSedinte} sedinte`, 14, 22);

  autoTable(doc, {
    startY: 28,
    head: [["#", "Numar Dosar", "Data", "Institutie", "Categorie / Stadiu", "Obiect", "Parti", "Sedinte"]],
    body: dosare.map((d, i) => [
      String(i + 1),
      d.numar || "-",
      formatDate(d.data),
      stripDiacritics(formatInstitutie(d.institutie)),
      stripDiacritics([d.categorieCaz, d.stadiuProcesual].filter(Boolean).join(" / ")),
      stripDiacritics(d.obiect || "-"),
      formatPartiPDF(d.parti),
      formatSedintePDF(d.sedinte),
    ]),
    styles: {
      fontSize: 7,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      overflow: "linebreak",
      font: "helvetica",
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: 255,
      fontSize: 7.5,
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: 24, fontStyle: "bold" },
      2: { cellWidth: 16 },
      3: { cellWidth: 28 },
      4: { cellWidth: 24 },
      5: { cellWidth: 32 },
      6: { cellWidth: 50 },
      7: { cellWidth: "auto" },
    },
    margin: { left: 10, right: 10 },
    didDrawPage: (data: { pageNumber: number }) => {
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Pagina ${data.pageNumber}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 7,
        { align: "center" }
      );
    },
  });
  return {
    buffer: doc.output("arraybuffer") as ArrayBuffer,
    filename: dosareFilename(dosare, "pdf"),
    mime: MIME_PDF,
  };
}

export async function buildTermenePdf(termene: Termen[]): Promise<ExportResult> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Legal Dashboard - Termene", 14, 16);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Generat: ${new Date().toLocaleDateString("ro-RO")}  |  Total: ${termene.length} termene`, 14, 22);

  autoTable(doc, {
    startY: 28,
    head: [["#", "Numar Dosar", "Data", "Ora", "Institutie", "Complet", "Solutie", "Sumar"]],
    body: termene.map((t, i) => [
      String(i + 1),
      t.numarDosar || "-",
      formatDate(t.data),
      t.ora || "-",
      stripDiacritics(formatInstitutie(t.institutie)),
      stripDiacritics(t.complet || "-"),
      stripDiacritics(t.solutie || "-"),
      stripDiacritics(t.solutieSumar || "-"),
    ]),
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      overflow: "linebreak",
      font: "helvetica",
    },
    headStyles: {
      fillColor: [37, 99, 235],
      textColor: 255,
      fontSize: 8,
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 28, fontStyle: "bold" },
      2: { cellWidth: 18 },
      3: { cellWidth: 12 },
      4: { cellWidth: 32 },
      5: { cellWidth: 25 },
      6: { cellWidth: 30 },
      7: { cellWidth: "auto" },
    },
    margin: { left: 14, right: 14 },
    didDrawPage: (data: { pageNumber: number }) => {
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(
        `Pagina ${data.pageNumber}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 7,
        { align: "center" }
      );
    },
  });
  return {
    buffer: doc.output("arraybuffer") as ArrayBuffer,
    filename: termeneFilename(termene, "pdf"),
    mime: MIME_PDF,
  };
}

// ─── Orchestratori (DOM-bound, ruleaza in main thread) ────────────────────────

export async function exportDosareExcel(dosare: Dosar[]): Promise<void> {
  const result = await runExportInWorker({ kind: "dosareXlsx", data: dosare });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportTermeneExcel(termene: Termen[]): Promise<void> {
  const result = await runExportInWorker({ kind: "termeneXlsx", data: termene });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportDosarePDF(dosare: Dosar[]): Promise<void> {
  const result = await runExportInWorker({ kind: "dosarePdf", data: dosare });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportTermenePDF(termene: Termen[]): Promise<void> {
  const result = await runExportInWorker({ kind: "termenePdf", data: termene });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function buildAnalysisPdf(args: AnalysisPdfArgs): Promise<ExportResult> {
  const { dosarNumar, dosarInstitutie, dosarObiect, analysisText } = args;
  const type = args.type ?? "simple";
  const judgeModel = args.judgeModel;
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentLeft = margin;
  const contentWidth = pageWidth - margin * 2;
  let y = 0;

  // Warm, eye-friendly color palette
  const primary: [number, number, number] = [55, 65, 81];       // warm dark gray
  const primaryLight: [number, number, number] = [243, 244, 246]; // light warm gray
  const primaryDark: [number, number, number] = [31, 41, 55];    // charcoal
  const accent: [number, number, number] = [120, 113, 108];      // warm stone
  const textDark: [number, number, number] = [41, 37, 36];       // warm black
  const textMuted: [number, number, number] = [120, 113, 108];   // stone-500
  const borderColor: [number, number, number] = [214, 211, 209]; // stone-300
  const bgLight: [number, number, number] = [250, 250, 249];     // stone-50

  // --- Helper: check page break ---
  const checkPageBreak = (needed: number) => {
    if (y + needed > pageHeight - 20) {
      doc.addPage();
      y = 18;
    }
  };

  // --- Helper: add text with word wrap ---
  const addText = (
    text: string, fontSize: number, style: string = "normal",
    color: [number, number, number] = textDark, xOffset = 0, maxW?: number
  ) => {
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", style);
    doc.setTextColor(...color);
    const w = maxW || (contentWidth - xOffset);
    const lines = doc.splitTextToSize(stripDiacritics(text), w);
    const lineHeight = fontSize * 0.42;
    for (const line of lines) {
      checkPageBreak(lineHeight + 2);
      doc.text(line, contentLeft + xOffset, y);
      y += lineHeight;
    }
  };

  // ========================================
  // HEADER — clean, minimal
  // ========================================
  y = 18;

  // Title
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...primaryDark);
  doc.text("Legal Dashboard", margin, y);

  // Subtitle
  y += 6;
  const subtitle = type === "advanced" ? "Analiza AI Avansata (Multi-Agent)" : "Analiza AI";
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...textMuted);
  doc.text(subtitle, margin, y);

  // Date (right aligned, same line as subtitle)
  doc.setFontSize(8);
  doc.text(`Generat: ${new Date().toLocaleDateString("ro-RO")}`, pageWidth - margin, y, { align: "right" });

  // Thin separator line
  y += 4;
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);

  y += 8;

  // ========================================
  // DOSAR INFO CARD
  // ========================================
  const cardLines = 2 + (type === "advanced" && judgeModel ? 1 : 0);
  const cardHeight = 10 + cardLines * 5.5;
  checkPageBreak(cardHeight + 4);

  // Card background with subtle border
  doc.setFillColor(...bgLight);
  doc.setDrawColor(...borderColor);
  doc.roundedRect(margin, y, contentWidth, cardHeight, 2, 2, "FD");

  // Left accent bar
  doc.setFillColor(...accent);
  doc.rect(margin, y, 2.5, cardHeight, "F");

  const cardX = margin + 8;
  y += 7;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...textDark);
  doc.text(`Dosar: ${stripDiacritics(dosarNumar)}`, cardX, y);

  y += 5.5;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...textMuted);
  doc.text(`Institutie: ${stripDiacritics(dosarInstitutie || "necunoscuta")}`, cardX, y);

  y += 4.5;
  doc.text(`Obiect: ${stripDiacritics(dosarObiect || "necunoscut")}`, cardX, y);

  if (type === "advanced" && judgeModel) {
    y += 4.5;
    doc.text(`Model reconciliere: ${judgeModel}`, cardX, y);
  }

  y += 10;

  // ========================================
  // MAIN ANALYSIS SECTION
  // ========================================
  if (type === "advanced") {
    checkPageBreak(12);
    // Section header with colored background
    doc.setFillColor(...primaryLight);
    doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, "F");
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...primaryDark);
    doc.text("Analiza Finala (Reconciliata)", margin + 4, y + 5.5);
    y += 14;
  }

  // Render markdown-like content
  const renderContent = (
    text: string,
    headingColor: [number, number, number] = primaryDark,
    bodyColor: [number, number, number] = textDark,
    bodySize = 9.5,
    headingSize = 11
  ) => {
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trimEnd();

      if (line.match(/^#{1,3}\s/) || (line.startsWith("**") && line.endsWith("**"))) {
        // Section heading — ensure title + at least a few lines fit on same page
        const headingText = line.replace(/^#{1,3}\s/, "").replace(/^\*\*|\*\*$/g, "");
        checkPageBreak(28);

        const numMatch = headingText.match(/^(\d+)\.\s*(.*)/);
        y += 5;
        if (numMatch) {
          // Number inline before heading text (no circle)
          doc.setFontSize(headingSize);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(...headingColor);
          doc.text(`${numMatch[1]}. ${stripDiacritics(numMatch[2])}`, contentLeft, y);
        } else {
          doc.setFontSize(headingSize);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(...headingColor);
          doc.text(stripDiacritics(headingText), contentLeft, y);
        }
        y += 6;

      } else if (line.match(/^\d+\.\s/)) {
        // Numbered item (not heading)
        checkPageBreak(6);
        addText(line.replace(/\*\*/g, ""), bodySize, "normal", bodyColor, 3);
        y += 1;

      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        // Bullet point
        checkPageBreak(6);
        const bulletText = line.replace(/^[-*]\s/, "").replace(/\*\*/g, "");
        addText(`- ${bulletText}`, bodySize, "normal", bodyColor, 3);
        y += 1;

      } else if (line.trim() === "" || line.trim() === "---") {
        y += 2.5;

      } else {
        // Regular paragraph
        checkPageBreak(6);
        addText(line.replace(/\*\*/g, ""), bodySize, "normal", bodyColor);
        y += 0.5;
      }
    }
  };

  renderContent(analysisText);

  // ========================================
  // INDIVIDUAL ANALYST SECTIONS (advanced only)
  // ========================================
  // FOOTER on all pages
  // ========================================
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Footer line
    doc.setDrawColor(...borderColor);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    // Footer text
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...textMuted);
    doc.text("Legal Dashboard", margin, pageHeight - 8);
    doc.text(`Pagina ${i} din ${totalPages}`, pageWidth / 2, pageHeight - 8, { align: "center" });
    doc.text(`${new Date().toLocaleDateString("ro-RO")}`, pageWidth - margin, pageHeight - 8, { align: "right" });
  }

  const safeName = stripDiacritics(dosarNumar).replace(/[/\\]/g, "-");
  return {
    buffer: doc.output("arraybuffer") as ArrayBuffer,
    filename: `analiza-${safeName}.pdf`,
    mime: MIME_PDF,
  };
}

// ========================================
// MANUAL DE UTILIZARE — PDF Export
// ========================================
export async function buildManualPdf(): Promise<ExportResult> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = 0;

  const primaryDark: [number, number, number] = [31, 41, 55];
  const textDark: [number, number, number] = [41, 37, 36];
  const textMuted: [number, number, number] = [120, 113, 108];
  const accent: [number, number, number] = [37, 99, 235];
  const borderColor: [number, number, number] = [214, 211, 209];
  const bgLight: [number, number, number] = [250, 250, 249];

  const checkPageBreak = (needed: number) => {
    if (y + needed > pageHeight - 20) {
      doc.addPage();
      y = 18;
    }
  };

  const addWrappedText = (text: string, fontSize: number, style = "normal", color: [number, number, number] = textDark, xOffset = 0, maxW?: number) => {
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", style);
    doc.setTextColor(...color);
    const w = maxW || (contentWidth - xOffset);
    const lines = doc.splitTextToSize(stripDiacritics(text), w);
    const lineHeight = fontSize * 0.42;
    for (const line of lines) {
      checkPageBreak(lineHeight + 2);
      doc.text(line, margin + xOffset, y);
      y += lineHeight;
    }
  };

  const addHeading = (text: string, level: 1 | 2 | 3 = 1) => {
    const sizes = { 1: 14, 2: 11.5, 3: 10 };
    const spacing = { 1: 8, 2: 6, 3: 4 };
    checkPageBreak(spacing[level] + 16);
    y += spacing[level];

    if (level === 1) {
      // Blue accent bar for main sections
      doc.setFillColor(...accent);
      doc.rect(margin, y - 4, 2.5, 7, "F");
    }

    doc.setFontSize(sizes[level]);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...primaryDark);
    doc.text(stripDiacritics(text), level === 1 ? margin + 6 : margin, y);
    y += level === 1 ? 7 : 5;
  };

  const addParagraph = (text: string) => {
    addWrappedText(text, 9.5, "normal", textDark);
    y += 2;
  };

  const addBullet = (text: string, indent = 4) => {
    checkPageBreak(6);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...textMuted);
    doc.text("-", margin + indent, y);
    addWrappedText(text, 9, "normal", textDark, indent + 4);
    y += 1;
  };

  // ========== COVER PAGE ==========
  y = 60;
  doc.setFillColor(...accent);
  doc.rect(margin, y - 2, contentWidth, 1.5, "F");

  y += 12;
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...primaryDark);
  doc.text("Legal Dashboard", margin, y);

  y += 12;
  doc.setFontSize(16);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...textMuted);
  doc.text("Manual de Utilizare", margin, y);

  y += 10;
  doc.setFontSize(11);
  doc.text(`v${__APP_VERSION__}`, margin, y);

  y += 20;
  doc.setFillColor(...bgLight);
  doc.setDrawColor(...borderColor);
  doc.roundedRect(margin, y, contentWidth, 32, 2, 2, "FD");
  y += 8;
  doc.setFontSize(9.5);
  doc.setTextColor(...textDark);
  doc.text(stripDiacritics("Aplicatie desktop si web pentru cautarea si analiza dosarelor"), margin + 6, y);
  y += 5;
  doc.text(stripDiacritics("si termenelor din instantele romanesti prin API-ul public"), margin + 6, y);
  y += 5;
  doc.text(stripDiacritics("al Ministerului Justitiei (portalquery.just.ro)."), margin + 6, y);
  y += 5;
  doc.text(stripDiacritics("Include asistenta AI multi-provider pentru analiza juridica."), margin + 6, y);

  y += 16;
  doc.setFontSize(8);
  doc.setTextColor(...textMuted);
  doc.text(`Generat: ${new Date().toLocaleDateString("ro-RO")}`, margin, y);

  // ========== TABLE OF CONTENTS ==========
  doc.addPage();
  y = 18;
  addHeading("Cuprins", 1);
  y += 2;
  const chapters = [
    "1. Prezentare Generala",
    "2. Pagina Dashboard",
    "3. Cautare Dosare",
    "4. Termene & Calendar",
    "5. Incarca Mai Multe (Load More)",
    "6. Export Excel si PDF",
    "7. Analiza AI",
    "8. Analiza AI Avansata (Multi-Agent)",
    "9. Configurare Chei API",
    "10. Sidebar si Navigare",
    "11. Personalizare (Tema & Font)",
    "12. Securitate si Confidentialitate",
  ];
  for (const ch of chapters) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...textDark);
    doc.text(stripDiacritics(ch), margin + 6, y);
    y += 6;
  }

  // ========== 1. PREZENTARE GENERALA ==========
  y += 4;
  addHeading("1. Prezentare Generala");
  addParagraph("Legal Dashboard este o aplicatie desktop si web pentru cautarea si analiza dosarelor si termenelor din toate instantele romanesti. Datele sunt obtinute in timp real prin API-ul SOAP public al Ministerului Justitiei (portalquery.just.ro).");

  addHeading("Ce poti face cu aceasta aplicatie:", 2);
  addBullet("Cautare dosare dupa numar, parti implicate, obiect sau institutie");
  addBullet("Cautare termene cu interval de date si filtre avansate");
  addBullet("Vizualizare calendar pentru termene si sedinte");
  addBullet("Export rezultate in Excel (.xlsx) si PDF");
  addBullet("Analiza inteligenta a dosarelor cu AI (Claude, GPT, Gemini)");
  addBullet("Analiza avansata multi-agent cu 2 analisti si un judecator AI");
  addBullet("Filtrare pe 246 instante din Romania (Curti de Apel, Tribunale, Judecatorii)");
  addBullet("Statistici si metrici interactive pentru dosarele gasite");

  addHeading("Platforme disponibile:", 2);
  addBullet("Windows — installer NSIS (nu necesita drepturi de administrator)");
  addBullet("macOS — fisier DMG (Intel si Apple Silicon)");
  addBullet("Web — versiune standalone accesibila din browser");

  addParagraph("Sursa datelor: Toate informatiile despre dosare si termene provin exclusiv din API-ul public al Ministerului Justitiei. Aplicatia nu stocheaza dosare pe server — fiecare cautare interogheaza in timp real baza de date publica.");

  // ========== 2. DASHBOARD ==========
  addHeading("2. Pagina Dashboard");
  addParagraph("Dashboard-ul este pagina principala a aplicatiei si ofera o vedere de ansamblu.");
  addHeading("Elemente afisate:", 2);
  addBullet("Carduri de navigare rapida catre Cautare Dosare si Termene & Calendar");
  addBullet("Rezumatul ultimei cautari (numar dosare, categorii, institutii, parte cautata) — vizibil doar dupa o cautare");
  addBullet("Tipuri de procese disponibile: Penal, Civil, Contencios administrativ si fiscal, Litigii de munca, Faliment, Litigii cu profesionistii, Altele");
  addBullet("Informatii API — endpoint-ul SOAP, metodele disponibile, limita de 1000 rezultate per cerere");
  addBullet("Versiunea aplicatiei cu buton \"Vezi Noutati\" (changelog) si \"Manual\" (acest document)");

  // ========== 3. CAUTARE DOSARE ==========
  addHeading("3. Cautare Dosare");

  addHeading("Campuri de cautare:", 2);
  addBullet("Numar dosar — formatul standard (ex: 27405/245/2025)");
  addBullet("Obiect dosar — text liber pentru obiectul cauzei");
  addBullet("Nume parte — numele unei parti implicate (cautare independenta de ordinea cuvintelor)");
  addBullet("Institutie — selector multi-select cu 246 instante din Romania, grupate pe categorii");
  addBullet("Data de la / Data pana la — interval de date pentru filtrarea rezultatelor");

  addHeading("Selector Institutii:", 2);
  addParagraph("Apasand pe campul \"Institutie\" se deschide un dialog modal cu toate cele 246 instante grupate pe categorii:");
  addBullet("Curti de Apel (15), Tribunale (42), Tribunale Specializate (1)");
  addBullet("Tribunale Comerciale (3), Tribunale Militare (5), Curti Militare (1), Judecatorii (179)");
  addBullet("Cautare rapida cu suport diacritice (\"brasov\" gaseste \"Brasov\")");
  addBullet("Selectie multipla — se pot alege mai multe institutii simultan");
  addBullet("Cautarea se trimite paralel catre toate institutiile selectate");

  addHeading("Filtre client-side (dupa cautare):", 2);
  addParagraph("Dupa primirea rezultatelor, poti filtra suplimentar fara a face o noua cerere:");
  addBullet("Categorii — Penal, Civil, Contencios etc. (selectie multipla)");
  addBullet("Stadii procesuale — Fond, Apel, Recurs etc. (selectie multipla)");
  addBullet("Institutii — modificarea selectiei dupa cautare aplica filtru client-side instant");

  addHeading("Tabelul de rezultate:", 2);
  addBullet("Coloane sortabile: numar dosar, data, institutie (click pe header pentru sortare)");
  addBullet("Paginare cu selector: 10, 15, 25, 50 sau 100 rezultate pe pagina");
  addBullet("Navigare directa la prima/ultima pagina");
  addBullet("Checkbox pe fiecare rand pentru selectie individuala");
  addBullet("Select All selecteaza toate dosarele de pe pagina curenta");
  addBullet("Randurile selectate sunt evidientiate vizual cu fundal violet");

  addHeading("Detalii dosar (rand expandabil):", 2);
  addParagraph("Click pe un rand din tabel deschide detaliile complete:");
  addBullet("Informatii generale: Data, Departament, Categorie, Stadiu (cu badge-uri colorate)");
  addBullet("Obiectul dosarului");
  addBullet("Lista partilor — cu badge calitate (Reclamant, Parat, etc.) si highlight pe numele cautat");
  addBullet("Istoric sedinte — timeline vertical cu data, ora, complet, solutie, document");
  addBullet("Link direct catre dosarul de pe portal.just.ro");
  addBullet("Buton Analiza AI (daca ai cel putin o cheie API configurata)");

  addHeading("Metrici interactive:", 2);
  addParagraph("Deasupra tabelului sunt afisate carduri cu statistici. Click pe un card aplica filtrul corespunzator:");
  addBullet("Total dosare (reseteaza toate filtrele)");
  addBullet("Distributie pe categorii de caz");
  addBullet("Distributie pe stadii procesuale");
  addBullet("Analiza parti — roluri si numar aparitii per parte");

  addHeading("Butonul Reseteaza:", 2);
  addParagraph("Apare in formularul de cautare cand cel putin un camp este completat. La apasare, sterge atat campurile formularului cat si toate rezultatele cautarii anterioare (tabel, metrici, filtre selectate).");

  // ========== 4. TERMENE & CALENDAR ==========
  addHeading("4. Termene & Calendar");

  addHeading("Cautare termene:", 2);
  addParagraph("Formularul de cautare este similar cu cel de la Dosare. Rezultatele sunt termenele de judecata extrase din dosarele gasite.");

  addHeading("Vizualizare duala:", 2);
  addBullet("Tabel — lista cu toate termenele, sortabila si paginata (10, 20, 50, 100 pe pagina)");
  addBullet("Calendar — vizualizare lunara cu termenele plasate pe zilele corespunzatoare");
  addBullet("Comutare intre cele doua vizualizari cu un buton toggle");

  addHeading("Metrici filtrabile:", 2);
  addBullet("Total termene (reseteaza filtrele)");
  addBullet("Termene viitoare (dupa data curenta)");
  addBullet("Termene trecute");
  addBullet("Cu solutie (termene care au o solutie inregistrata)");
  addBullet("Filtrele functioneaza in logica OR — selectia multipla include orice termen care se potriveste cel putin unui filtru");

  addHeading("Detalii termen (rand expandabil):", 2);
  addBullet("Categorie si Stadiu procesual");
  addBullet("Obiectul dosarului");
  addBullet("Solutia completa cu sumarul integral");
  addBullet("Lista de parti cu badge calitate si highlight nume");

  addHeading("Vizualizare Calendar:", 2);
  addBullet("Navigare luna cu luna (inainte/inapoi)");
  addBullet("Termenele apar pe zilele corespunzatoare cu numar dosar si institutie");
  addBullet("Numerele de dosar sunt linkuri directe catre portal.just.ro");
  addBullet("Click pe un card deschide detalii: solutie si lista parti");

  // ========== 5. LOAD MORE ==========
  addHeading("5. Incarca Mai Multe (Load More)");
  addParagraph("API-ul Ministerului Justitiei returneaza maxim 1000 de rezultate per cerere. Daca cautarea ta are mai multe rezultate, butonul \"Incarca mai multe\" iti permite sa le obtii pe toate.");

  addHeading("Cum functioneaza:", 2);
  addBullet("Dupa o cautare initiala care returneaza 1000 de rezultate, apare butonul \"Incarca mai multe\"");
  addBullet("La apasare, aplicatia scaneaza luna cu luna intregul interval de date");
  addBullet("Daca o luna are mai mult de 1000 rezultate, intervalul se subdivide automat in perioade mai mici");
  addBullet("Rezultatele noi apar in tabel in timp real (nu trebuie sa astepti sa se termine scanarea)");
  addBullet("Bara de progres arata cate dosare/termene NOI au fost gasite");

  addHeading("Deduplicare inteligenta:", 2);
  addParagraph("Aplicatia trimite catre server lista dosarelor deja existente, iar serverul returneaza doar dosarele noi. Astfel, nu se descarca de doua ori aceleasi dosare, iar contorul de progres reflecta numarul real de dosare noi gasite.");

  addHeading("Oprire si continuare:", 2);
  addBullet("Butonul STOP opreste scanarea in orice moment");
  addBullet("Toate rezultatele gasite pana la oprire sunt pastrate (nu se pierde nimic)");
  addBullet("Poti naviga intre taburile Dosare si Termene fara sa se opreasca procesul — operatia continua in fundal");
  addBullet("La revenirea pe tab, vei vedea rezultatele actualizate");

  addHeading("Limite de siguranta:", 2);
  addBullet("Maxim 120 intervale lunare per scanare (~10 ani)");
  addBullet("Timeout de 10 minute per sesiune de scanare");

  // ========== 6. EXPORT ==========
  addHeading("6. Export Excel si PDF");

  addHeading("Export Excel (.xlsx):", 2);
  addBullet("Dosare: genereaza 2 foi (sheet-uri) — \"Dosare\" cu informatiile de baza si \"Sedinte\" cu toate sedintele");
  addBullet("Termene: 1 foaie cu 7 coloane (numar dosar, data, ora, institutie, complet, solutie, sumar)");
  addBullet("Coloanele sunt auto-dimensionate pentru lizibilitate");

  addHeading("Export PDF:", 2);
  addBullet("Dosare si Termene: format Landscape A4 cu tabel, header colorat, paginare automata");
  addBullet("Analize AI: format Portrait A4 cu design profesional, formatare markdown, footer pe fiecare pagina");

  addHeading("Export selectiv:", 2);
  addParagraph("Daca ai selectat dosare/termene cu checkbox, butoanele de export arata numarul selectat (ex: \"Excel (3)\") si exporta doar elementele selectate. Daca nu selectezi nimic, se exporta toate rezultatele.");

  // ========== 7. AI ==========
  addHeading("7. Analiza AI");
  addParagraph("Aplicatia ofera analiza inteligenta a dosarelor folosind modele AI de ultima generatie. Pentru a folosi aceasta functie, trebuie sa configurezi cel putin o cheie API (vezi sectiunea 9).");

  addHeading("Cum se foloseste:", 2);
  addBullet("Deschide detaliile unui dosar (click pe rand in tabel)");
  addBullet("Selecteaza modelul AI dorit din dropdown-ul de modele");
  addBullet("Apasa butonul \"Analizeaza cu AI\"");
  addBullet("Analiza se genereaza in cateva secunde si apare sub detaliile dosarului");
  addBullet("Poti regenera analiza cu un alt model sau ascunde/arata rezultatul");

  addHeading("Modele disponibile:", 2);
  addParagraph("Anthropic (Claude): Haiku 4.5 (Rapid), Sonnet 4.6 (Echilibrat), Opus 4.6 (Premium)");
  addParagraph("OpenAI (GPT): GPT-5.4 nano (Rapid), GPT-5.4 mini (Echilibrat), GPT-5.4 (Premium)");
  addParagraph("Google (Gemini): Gemini 3.1 Lite (Rapid), Gemini 3 Flash (Echilibrat), Gemini 3.1 Pro (Premium)");

  addHeading("Structura analizei (7 sectiuni):", 2);
  addBullet("Rezumatul dosarului — descriere sintetica a cauzei");
  addBullet("Explicatia partilor — cine sunt partile si ce rol au");
  addBullet("Starea actuala a procesului — in ce faza se afla");
  addBullet("Istoricul sedintelor — ce s-a intamplat la fiecare sedinta");
  addBullet("Ce ar putea urma — posibilii pasi urmatori");
  addBullet("Temei juridic — articole de lege relevante pentru cauza");
  addBullet("Legaturi cu alte dosare — daca exista conexiuni cu alte cauze");

  addHeading("Export analiza PDF:", 2);
  addParagraph("Dupa generarea analizei, apare un buton de export PDF. Documentul generat include: header cu titlu, card cu informatiile dosarului, continutul analizei cu formatare profesionala si footer pe fiecare pagina.");

  // ========== 8. MULTI-AGENT ==========
  addHeading("8. Analiza AI Avansata (Multi-Agent)");
  addParagraph("Analiza avansata foloseste 3 modele AI simultan pentru o analiza mai completa si verificata.");

  addHeading("Cum functioneaza:", 2);
  addBullet("Selecteaza 2 modele \"Analist\" — acestea analizeaza dosarul independent si in paralel");
  addBullet("Selecteaza 1 model \"Judecator\" — acesta primeste ambele analize si le reconciliaza");
  addBullet("Nu se poate selecta acelasi model de doua ori");
  addBullet("Modelele judecator sunt restrictionate la modele premium: Claude Opus 4.6, GPT-5.4 sau Gemini 3.1 Pro");

  addHeading("Rolul judecatorului AI:", 2);
  addBullet("Primeste datele complete ale dosarului plus cele 2 analize independente");
  addBullet("Verifica afirmatiile analistilor contra datelor originale ale dosarului");
  addBullet("Corecteaza interpretarile gresite si adauga aspecte omise de ambii analisti");
  addBullet("Reconciliaza contradictiile alegand interpretarea sustinuta de datele reale");
  addBullet("Prezinta explicit in analiza finala ce reconcilieri a facut intre cele doua analize");
  addBullet("Rezultatul final este prezentat ca o analiza unitara coerenta");

  addHeading("Vizualizare rezultate:", 2);
  addBullet("Analiza finala a judecatorului este afisata principal");
  addBullet("Toggle \"Vizualizare analize individuale\" — arata cele 2 analize side-by-side");
  addBullet("Export PDF disponibil pentru analiza finala (include mentiunea modelului judecator)");

  // ========== 9. CHEI API ==========
  addHeading("9. Configurare Chei API");
  addParagraph("Pentru a folosi analiza AI, trebuie sa configurezi cel putin o cheie API de la un furnizor AI. Cheile sunt gratuite la inregistrare pentru un volum limitat de cereri.");

  addHeading("Cum se configureaza:", 2);
  addBullet("Apasa pe \"Setari API\" din sidebar (iconita Bot)");
  addBullet("Introdu cheia API pentru furnizorul dorit (Anthropic, OpenAI sau Google)");
  addBullet("Apasa \"Salveaza\" — cheia este stocata local pe calculatorul tau");
  addBullet("Indicatorul din sidebar devine verde cand cel putin o cheie este activa");
  addBullet("Poti configura cheile pentru mai multi furnizori simultan");
  addBullet("Pentru a sterge o cheie, apasa \"Sterge cheia\" sub campul respectiv");

  addHeading("Securitatea cheilor:", 2);
  addBullet("Cheile sunt stocate doar local (in browser-ul aplicatiei), nu pe niciun server extern");
  addBullet("Cheile sunt obfuscate in localStorage (nu sunt stocate ca text simplu)");
  addBullet("La fiecare cerere AI, cheia este trimisa doar catre API-ul furnizorului respectiv");
  addBullet("Cheile persista intre sesiuni — nu trebuie reintroduse la fiecare pornire a aplicatiei");

  addHeading("De unde obtii chei API:", 2);
  addBullet("Anthropic (Claude): console.anthropic.com");
  addBullet("OpenAI (GPT): platform.openai.com");
  addBullet("Google (Gemini): aistudio.google.com");

  // ========== 10. SIDEBAR ==========
  addHeading("10. Sidebar si Navigare");

  addHeading("Meniu de navigare:", 2);
  addBullet("Dashboard — pagina principala cu rezumat si navigare rapida");
  addBullet("Cautare Dosare — formularul si tabelul de dosare");
  addBullet("Termene & Calendar — formularul, tabelul si calendarul de termene");

  addHeading("Istoric cautari:", 2);
  addBullet("Se salveaza automat ultimele 15 cautari efectuate");
  addBullet("Fiecare intrare arata: tipul cautarii (dosare/termene), parametrii, numarul de rezultate, cat timp a trecut");
  addBullet("Click pe o intrare navigheaza automat la pagina corespunzatoare si re-executa cautarea");
  addBullet("Stergere individuala (buton X la hover) sau stergere totala (iconita cos de gunoi)");
  addBullet("In modul sidebar colapsat, istoricul apare intr-un popover la click pe iconita");

  addHeading("Navigare persistenta:", 2);
  addParagraph("Paginile Dosare si Termene raman active in fundal chiar daca navighezi pe alt tab. Aceasta inseamna ca:");
  addBullet("O operatie \"Incarca mai multe\" in curs NU se opreste la navigare");
  addBullet("Campurile completate in formularul de cautare se pastreaza");
  addBullet("Rezultatele cautarii sunt disponibile la revenire, fara a reface cautarea");

  addHeading("Colapsare sidebar:", 2);
  addParagraph("Butonul \"Inchide meniu\" din partea de jos reduce sidebar-ul la 64px, lasand mai mult spatiu pentru continut. In modul colapsat, navigarea si setarile sunt accesibile prin iconite cu tooltip.");

  // ========== 11. PERSONALIZARE ==========
  addHeading("11. Personalizare (Tema & Font)");

  addHeading("Tema vizuala:", 2);
  addBullet("Mod Luminos (Light) si Mod Inchis (Dark) — toggle din sidebar");
  addBullet("Detecteaza automat preferinta sistemului de operare la prima utilizare");
  addBullet("Setarea se salveaza si persista intre sesiuni");

  addHeading("Dimensiune text:", 2);
  addBullet("4 trepte disponibile: Mic (16px), Normal (18px), Mare (20px), Extra (22px)");
  addBullet("Control din sidebar cu butoane A-/A+ si indicator vizual (puncte)");
  addBullet("Afecteaza toata aplicatia (tabel, formulare, butoane, metrici)");
  addBullet("Setarea se salveaza si persista intre sesiuni");

  addHeading("Meniu contextual (click dreapta):", 2);
  addParagraph("In aplicatia desktop, click dreapta afiseaza un meniu cu optiunile:");
  addBullet("Copiaza — doar cand exista text selectat");
  addBullet("Selecteaza tot");
  addBullet("Printeaza");

  // ========== 12. SECURITATE ==========
  addHeading("12. Securitate si Confidentialitate");

  addHeading("Unde sunt datele tale:", 2);
  addBullet("Cheile API sunt stocate doar local pe calculatorul tau (in localStorage, obfuscate)");
  addBullet("Istoricul cautarilor este salvat doar local");
  addBullet("Preferintele (tema, font) sunt salvate doar local");
  addBullet("Nu exista niciun server intermediar — datele merg direct de la calculatorul tau catre API-urile oficiale");
  addBullet("Dosarele si termenele sunt date publice obtinute din API-ul Ministerului Justitiei");

  addHeading("Protectii implementate:", 2);
  addBullet("Validare completa a tuturor datelor de intrare (lungime, format, caractere speciale)");
  addBullet("Protectie XSS (Cross-Site Scripting) pe toate continuturile afisate, inclusiv raspunsurile AI");
  addBullet("Protectie impotriva Prompt Injection — datele dosarelor sunt izolate in prompt-ul AI");
  addBullet("Rate limiting — maxim 30 cereri pe minut pentru prevenirea abuzurilor");
  addBullet("Serverul backend este accesibil doar local (localhost), nu din retea");
  addBullet("Linkurile externe se deschid doar catre domenii portal.just.ro verificate");
  addBullet("Content Security Policy strict in aplicatia desktop");

  addHeading("Analiza AI si confidentialitatea:", 2);
  addParagraph("Cand soliciti o analiza AI, datele dosarului (numar, obiect, parti, sedinte) sunt trimise catre furnizorul AI selectat (Anthropic, OpenAI sau Google). Aceste date sunt publice (provin din API-ul Ministerului Justitiei), dar este important sa stii ca sunt procesate de serverele furnizorului AI conform politicilor lor de confidentialitate.");

  // ========== FOOTER ON ALL PAGES ==========
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...borderColor);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...textMuted);
    doc.text("Legal Dashboard — Manual de Utilizare v1.0.0", margin, pageHeight - 8);
    doc.text(`Pagina ${i} din ${totalPages}`, pageWidth / 2, pageHeight - 8, { align: "center" });
    doc.text(`${new Date().toLocaleDateString("ro-RO")}`, pageWidth - margin, pageHeight - 8, { align: "right" });
  }

  return {
    buffer: doc.output("arraybuffer") as ArrayBuffer,
    filename: "Legal-Dashboard-Manual-v1.0.0.pdf",
    mime: MIME_PDF,
  };
}

// ─── Orchestratori AI / Manual (route prin worker) ────────────────────────────

export async function exportAnalysisPDF(
  dosarNumar: string,
  dosarInstitutie: string,
  dosarObiect: string,
  analysisText: string,
  type: "simple" | "advanced" = "simple",
  judgeModel?: string,
): Promise<void> {
  const result = await runExportInWorker({
    kind: "analysisPdf",
    data: { dosarNumar, dosarInstitutie, dosarObiect, analysisText, type, judgeModel },
  });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportManualPDF(): Promise<void> {
  const result = await runExportInWorker({ kind: "manualPdf", data: null });
  triggerDownload(result.buffer, result.filename, result.mime);
}
