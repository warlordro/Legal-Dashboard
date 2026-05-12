import { versions } from "@/data/changelog-entries";

// Helvetica in jsPDF uses WinAnsi (Latin-1) — any char outside that range breaks rendering
// (individual-glyph placement, visible as character-spacing artifacts). Map common Unicode
// punctuation + Romanian comma-below letters to Latin-1 equivalents, then strip diacritics.
const CHAR_MAP: Record<string, string> = {
  "\u2014": "--",
  "\u2013": "-",
  "\u2192": "->",
  "\u2190": "<-",
  "\u2191": "^",
  "\u2193": "v",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u2018": "'",
  "\u2019": "'",
  "\u2026": "...",
  "\u2022": "-",
  "\u00B7": "-",
  "\u00A0": " ",
  "\u0218": "S",
  "\u0219": "s",
  "\u021A": "T",
  "\u021B": "t",
};

function normalize(s: string): string {
  let out = "";
  for (const ch of s) out += CHAR_MAP[ch] ?? ch;
  return out.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

type RGB = [number, number, number];

// Tailwind-500 hues for version bars + accents.
const PALETTE: Record<string, { strong: RGB; soft: RGB; ink: RGB }> = {
  violet: { strong: [139, 92, 246], soft: [245, 243, 255], ink: [76, 29, 149] },
  emerald: { strong: [16, 185, 129], soft: [236, 253, 245], ink: [6, 95, 70] },
  blue: { strong: [59, 130, 246], soft: [239, 246, 255], ink: [30, 64, 175] },
  amber: { strong: [245, 158, 11], soft: [255, 251, 235], ink: [146, 64, 14] },
  rose: { strong: [244, 63, 94], soft: [255, 241, 242], ink: [159, 18, 57] },
  cyan: { strong: [6, 182, 212], soft: [236, 254, 255], ink: [14, 116, 144] },
  sky: { strong: [14, 165, 233], soft: [240, 249, 255], ink: [7, 89, 133] },
  teal: { strong: [20, 184, 166], soft: [240, 253, 250], ink: [17, 94, 89] },
  slate: { strong: [100, 116, 139], soft: [248, 250, 252], ink: [51, 65, 85] },
};

function paletteFor(v: { borderColor: string }): { strong: RGB; soft: RGB; ink: RGB } {
  const m = v.borderColor.match(/border-l-([a-z]+)-\d+/);
  return (m && PALETTE[m[1]]) || PALETTE.slate;
}

export async function exportChangelogPdf(): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentW = pageW - margin * 2;
  const bottom = 14;
  let y = margin;

  const ensure = (need: number): void => {
    if (y + need > pageH - bottom) {
      doc.addPage();
      y = margin;
    }
  };

  const setFill = (rgb: RGB) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  const setStroke = (rgb: RGB) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  const setText = (rgb: RGB) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

  const paragraph = (
    text: string,
    size: number,
    style: "normal" | "bold" | "italic" = "normal",
    xOff = 0,
    color: RGB = [55, 55, 65]
  ): void => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    setText(color);
    const lines = doc.splitTextToSize(normalize(text), contentW - xOff);
    const lh = size * 0.42 + 1.3;
    for (const line of lines) {
      ensure(lh);
      doc.text(line, margin + xOff, y);
      y += lh;
    }
  };

  const bullet = (text: string, accent: RGB): void => {
    const size = 9.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    const indent = 9;
    const lines = doc.splitTextToSize(normalize(text), contentW - indent);
    const lh = size * 0.42 + 1.25;
    for (let i = 0; i < lines.length; i++) {
      ensure(lh);
      if (i === 0) {
        setFill(accent);
        doc.circle(margin + 4.5, y - 1.2, 0.7, "F");
      }
      setText([60, 60, 70]);
      doc.text(lines[i], margin + indent, y);
      y += lh;
    }
  };

  // ── Cover page ─────────────────────────────────────────────────────────
  setFill([30, 27, 75]); // deep indigo-950
  doc.rect(0, 0, pageW, pageH, "F");

  // Accent gradient-ish stripes
  setFill([76, 29, 149]);
  doc.rect(0, 0, pageW, 3, "F");
  setFill([139, 92, 246]);
  doc.rect(0, 3, pageW, 1.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(32);
  setText([255, 255, 255]);
  doc.text("Legal Dashboard", margin, 55);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  setText([199, 187, 255]);
  doc.text("Changelog complet", margin, 66);

  // Version + stats block
  setFill([49, 46, 129]);
  doc.roundedRect(margin, 85, contentW, 38, 3, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText([199, 187, 255]);
  doc.text("VERSIUNE CURENTA", margin + 6, 94);
  doc.setFontSize(22);
  setText([255, 255, 255]);
  doc.text(normalize(`v${__APP_VERSION__}`), margin + 6, 107);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText([199, 187, 255]);
  doc.text("VERSIUNI DOCUMENTATE", margin + 75, 94);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  setText([255, 255, 255]);
  doc.text(String(versions.length), margin + 75, 107);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText([199, 187, 255]);
  doc.text("GENERAT", margin + 130, 94);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  setText([255, 255, 255]);
  doc.text(new Date().toLocaleDateString("ro-RO"), margin + 130, 107);

  // Summary list on cover
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  setText([199, 187, 255]);
  doc.text("CUPRINS", margin, 145);

  let cy = 154;
  const maxCoverVersions = Math.min(versions.length, 16);
  for (let i = 0; i < maxCoverVersions; i++) {
    const v = versions[i];
    const pal = paletteFor(v);
    setFill(pal.strong);
    doc.circle(margin + 2, cy - 1.2, 1.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setText([255, 255, 255]);
    doc.text(normalize(v.version), margin + 7, cy);
    doc.setFont("helvetica", "normal");
    setText([180, 170, 220]);
    doc.text(normalize(v.date), margin + 33, cy);
    if (v.subtitle) {
      setText([145, 135, 190]);
      const line = doc.splitTextToSize(normalize(v.subtitle), contentW - 70)[0];
      doc.text(line, margin + 72, cy);
    }
    cy += 7;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setText([145, 135, 190]);
  doc.text("Legal Dashboard - desktop (Electron) + web ready", margin, pageH - 10);

  // ── Content pages ─────────────────────────────────────────────────────
  doc.addPage();
  y = margin;

  for (let idx = 0; idx < versions.length; idx++) {
    const v = versions[idx];
    const pal = paletteFor(v);
    ensure(22);

    // Version header banner
    setFill(pal.soft);
    doc.roundedRect(margin - 1, y - 4, contentW + 2, 13, 1.5, 1.5, "F");
    setFill(pal.strong);
    doc.rect(margin - 1, y - 4, 2, 13, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    setText(pal.ink);
    doc.text(normalize(v.version), margin + 4, y + 2.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    setText([110, 110, 130]);
    doc.text(normalize(v.date), pageW - margin - 1, y + 2.5, { align: "right" });
    y += 11;

    if (v.subtitle) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9.5);
      setText([110, 110, 125]);
      const subs = doc.splitTextToSize(normalize(v.subtitle), contentW);
      for (const line of subs) {
        ensure(4.5);
        doc.text(line, margin, y);
        y += 4.3;
      }
    }
    y += 3;

    for (const section of v.sections) {
      ensure(9);
      // Section title with colored accent bar
      setFill(pal.strong);
      doc.rect(margin, y - 3.5, 1.2, 4.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.8);
      setText([35, 35, 55]);
      const titleLines = doc.splitTextToSize(normalize(section.title), contentW - 5);
      for (let i = 0; i < titleLines.length; i++) {
        ensure(5);
        doc.text(titleLines[i], margin + 4, y);
        y += 4.8;
      }
      y += 0.6;

      if (section.content) {
        paragraph(section.content, 9.5, "normal", 4, [70, 70, 80]);
        y += 0.8;
      }
      if (section.bullets) {
        for (const b of section.bullets) bullet(b, pal.strong);
      }
      y += 3;
    }

    if (idx < versions.length - 1) {
      ensure(5);
      setStroke([225, 225, 232]);
      doc.setLineWidth(0.2);
      doc.line(margin + 20, y, pageW - margin - 20, y);
      y += 6;
    }
  }

  // ── Footer on all content pages ───────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 2; i <= pageCount; i++) {
    doc.setPage(i);
    setStroke([230, 230, 235]);
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - 10, pageW - margin, pageH - 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText([140, 140, 155]);
    doc.text("Legal Dashboard - Changelog", margin, pageH - 5);
    doc.text(`${i} / ${pageCount}`, pageW - margin, pageH - 5, { align: "right" });
  }

  doc.save(`legal-dashboard-changelog-v${__APP_VERSION__}.pdf`);
}
