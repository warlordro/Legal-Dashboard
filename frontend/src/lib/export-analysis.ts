// AI analysis PDF builder. Extracted from lib/export.ts (Stage 7) so the heavy
// jsPDF rendering code lives next to the AnalysisPdfArgs type that drives it,
// and so export.ts no longer hosts ~220 LOC of feature-specific layout.
//
// Loaded by export.worker.ts on demand (`analysisPdf` job kind). The
// orchestrator `exportAnalysisPDF` stays in export.ts because all DOM-bound
// orchestrators share `runExportInWorker` there.

import { MIME_PDF, stripDiacritics, type ExportResult } from "./pdf-helpers";

export interface AnalysisPdfArgs {
  dosarNumar: string;
  dosarInstitutie: string;
  dosarObiect: string;
  analysisText: string;
  type?: "simple" | "advanced";
  judgeModel?: string;
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
  const primary: [number, number, number] = [55, 65, 81]; // warm dark gray
  const primaryLight: [number, number, number] = [243, 244, 246]; // light warm gray
  const primaryDark: [number, number, number] = [31, 41, 55]; // charcoal
  const accent: [number, number, number] = [120, 113, 108]; // warm stone
  const textDark: [number, number, number] = [41, 37, 36]; // warm black
  const textMuted: [number, number, number] = [120, 113, 108]; // stone-500
  const borderColor: [number, number, number] = [214, 211, 209]; // stone-300
  const bgLight: [number, number, number] = [250, 250, 249]; // stone-50
  void primary; // declared for palette parity; unused below — keep to avoid silent diff

  // --- Helper: check page break ---
  const checkPageBreak = (needed: number) => {
    if (y + needed > pageHeight - 20) {
      doc.addPage();
      y = 18;
    }
  };

  // --- Helper: add text with word wrap ---
  const addText = (
    text: string,
    fontSize: number,
    style = "normal",
    color: [number, number, number] = textDark,
    xOffset = 0,
    maxW?: number
  ) => {
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", style);
    doc.setTextColor(...color);
    const w = maxW || contentWidth - xOffset;
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
