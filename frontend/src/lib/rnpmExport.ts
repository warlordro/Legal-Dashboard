import type { RnpmDocument, RnpmAvizFull, RnpmParty, RnpmBun, RnpmBunPartyRef, RnpmIstoricEntry } from "@/types/rnpm";
import { rnpmExport as fetchRnpmExport } from "@/lib/rnpmApi";

function todayRo(): string {
  return new Date().toLocaleDateString("ro-RO");
}

function stripDiacritics(s: string): string {
  return (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function partyLabel(p: RnpmParty): string {
  if (p.tip_persoana === "PF") return [p.denumire, p.prenume].filter(Boolean).join(" ");
  return p.denumire ?? "";
}

function partyId(p: RnpmParty): string {
  return p.cnp ?? p.cod ?? p.nr_identificare ?? "";
}

function subscriptorLabel(v: number | null): string {
  if (v === 1) return "Da";
  if (v === 0) return "Nu";
  return "";
}

function bunLabel(b: RnpmBun): string {
  return [b.model, b.identificare, b.descriere, b.serie_sasiu, b.nr_inmatriculare].filter(Boolean).join(" · ");
}

function refLabel(r: RnpmBunPartyRef): string {
  const name = r.tip_persoana === "PF"
    ? [r.denumire, r.prenume].filter(Boolean).join(" ")
    : (r.denumire ?? "");
  return `${r.rol}:${r.tip_persoana}:${name}`;
}

async function fetchDetails(docs: RnpmDocument[], avizIds: (number | null)[]): Promise<Map<string, RnpmAvizFull>> {
  const ids: number[] = [];
  for (let i = 0; i < docs.length; i++) {
    const id = avizIds[i];
    if (id != null) ids.push(id);
  }
  if (ids.length === 0) return new Map();
  const { items } = await fetchRnpmExport(ids);
  const byIdentificator = new Map<string, RnpmAvizFull>();
  for (const item of items) byIdentificator.set(item.aviz.identificator, item);
  return byIdentificator;
}

// ─── Excel styling (aliniat cu exportul PortalJust din src/lib/export.ts) ─────

function colLetter(col: number): string {
  let letter = "";
  let n = col + 1;
  while (n > 0) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

function cellAddr(r: number, c: number): string {
  return `${colLetter(c)}${r + 1}`;
}

function ensureCell(ws: Record<string, unknown>, addr: string, value: string | number = "") {
  if (!ws[addr]) ws[addr] = { t: typeof value === "number" ? "n" : "s", v: value };
}

const BLUE_DARK  = "1E40AF";
const BLUE_MAIN  = "2563EB";
const BLUE_LIGHT = "DBEAFE";
const ROW_ALT    = "EFF6FF";
const WHITE      = "FFFFFF";
const TEXT_DARK  = "111827";
const TEXT_MID   = "374151";

const styleTitle = {
  font: { bold: true, sz: 13, color: { rgb: WHITE } },
  fill: { patternType: "solid", fgColor: { rgb: BLUE_DARK } },
  alignment: { horizontal: "center", vertical: "center" },
};
const styleStats = {
  font: { sz: 9, italic: true, color: { rgb: TEXT_MID } },
  fill: { patternType: "solid", fgColor: { rgb: "F1F5F9" } },
  alignment: { horizontal: "left", vertical: "center" },
};
const styleHeader = {
  font: { bold: true, sz: 9, color: { rgb: WHITE } },
  fill: { patternType: "solid", fgColor: { rgb: BLUE_MAIN } },
  alignment: { horizontal: "left", vertical: "center", wrapText: true },
  border: { bottom: { style: "thin", color: { rgb: "1D4ED8" } } },
};

function styleData(rowIdx: number, bold = false): Record<string, unknown> {
  const alt = rowIdx % 2 === 1;
  return {
    font: { sz: 9, bold, color: { rgb: TEXT_DARK } },
    fill: { patternType: "solid", fgColor: { rgb: alt ? ROW_ALT : WHITE } },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
  };
}

function styleLink(rowIdx: number): Record<string, unknown> {
  const alt = rowIdx % 2 === 1;
  return {
    font: { bold: true, sz: 9, color: { rgb: "1D4ED8" }, underline: true },
    fill: { patternType: "solid", fgColor: { rgb: alt ? ROW_ALT : WHITE } },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
  };
}

function styleRow(ws: Record<string, unknown>, r: number, numCols: number, style: Record<string, unknown>) {
  for (let c = 0; c < numCols; c++) {
    const addr = cellAddr(r, c);
    ensureCell(ws, addr);
    (ws[addr] as Record<string, unknown>).s = style;
  }
}

function styleCell(ws: Record<string, unknown>, r: number, c: number, style: Record<string, unknown>) {
  const addr = cellAddr(r, c);
  ensureCell(ws, addr);
  (ws[addr] as Record<string, unknown>).s = style;
}

function setLink(ws: Record<string, unknown>, r: number, c: number, target: string, tooltip?: string) {
  const addr = cellAddr(r, c);
  ensureCell(ws, addr);
  (ws[addr] as Record<string, unknown>).l = { Target: target, Tooltip: tooltip };
}

function mergeRow(ws: Record<string, unknown>, r: number, numCols: number) {
  if (!ws["!merges"]) ws["!merges"] = [];
  (ws["!merges"] as unknown[]).push({ s: { r, c: 0 }, e: { r, c: numCols - 1 } });
}

// ─── Export Excel (styled) ────────────────────────────────────────────────────

export async function exportRnpmExcel(
  docs: RnpmDocument[],
  avizIds: (number | null)[],
  searchType?: string
) {
  const XLSX = await import("xlsx-js-style");
  const details = await fetchDetails(docs, avizIds);

  const dateStr = todayRo();

  // Pre-compute counts + first-row offsets in each child tab.
  // Child sheet layout: title(0), stats(1), gap(2), header(3), data from row 4.
  const CHILD_DATA_START = 4;
  const counts = new Map<string, { creditori: number; debitori: number; bunuri: number; istoric: number }>();
  const firstRow = new Map<string, { creditori?: number; debitori?: number; bunuri?: number; istoric?: number }>();
  let credRow = CHILD_DATA_START - 1, debRow = CHILD_DATA_START - 1, bunRow = CHILD_DATA_START - 1, istRow = CHILD_DATA_START - 1;
  for (const d of docs) {
    const full = details.get(d.identificator.v);
    if (!full) continue;
    const c = full.creditori.length, db = full.debitori.length, b = full.bunuri.length, i = full.istoric.length;
    counts.set(d.identificator.v, { creditori: c, debitori: db, bunuri: b, istoric: i });
    const fr: { creditori?: number; debitori?: number; bunuri?: number; istoric?: number } = {};
    if (c) { credRow += 1; fr.creditori = credRow; credRow += c - 1; }
    if (db) { debRow += 1; fr.debitori = debRow; debRow += db - 1; }
    if (b) { bunRow += 1; fr.bunuri = bunRow; bunRow += b - 1; }
    if (i) { istRow += 1; fr.istoric = istRow; istRow += i - 1; }
    firstRow.set(d.identificator.v, fr);
  }

  const totalCred = [...counts.values()].reduce((s, c) => s + c.creditori, 0);
  const totalDeb = [...counts.values()].reduce((s, c) => s + c.debitori, 0);
  const totalBun = [...counts.values()].reduce((s, c) => s + c.bunuri, 0);

  // ─── Avize sheet ─────────────────────────────────────────────────────────
  const A_HEADERS = [
    "#", "Identificator", "Data", "Tip", "Utilizator autorizat", "Necesita act.", "Activ",
    "Destinatie", "Tip act", "Numar act", "Data inregistrare", "Data expirare",
    "Inscriere initiala", "Inscriere modificata",
    "Creditori", "Debitori", "Bunuri", "Istoric",
    "Alte mentiuni", "Detalii comune",
  ];
  const A_WIDTHS = [5, 30, 11, 30, 32, 10, 6, 22, 14, 16, 14, 14, 26, 26, 10, 9, 8, 8, 40, 60];
  const A_COLS = A_HEADERS.length;

  const avizeAoA: (string | number | null)[][] = [
    [`LEGAL DASHBOARD - RNPM${searchType ? ` / ${searchType.toUpperCase()}` : ""}`, ...Array(A_COLS - 1).fill(null)],
    [`Generat: ${dateStr}  |  ${docs.length} avize  |  ${totalCred} creditori  |  ${totalDeb} debitori  |  ${totalBun} bunuri`, ...Array(A_COLS - 1).fill(null)],
    Array(A_COLS).fill(null),
    A_HEADERS,
    ...docs.map((d, i) => {
      const full = details.get(d.identificator.v);
      const a = full?.aviz;
      const cnt = counts.get(d.identificator.v) ?? { creditori: 0, debitori: 0, bunuri: 0, istoric: 0 };
      return [
        i + 1,
        d.identificator.v,
        d.data ?? "",
        d.tip ?? "",
        d.utilizatorAutorizat ?? "",
        d.needsActualizare ? "Da" : "Nu",
        a ? (a.activ ? "Da" : "Nu") : "",
        a?.destinatie ?? "",
        a?.tip_act ?? "",
        a?.numar_act ?? "",
        a?.data_inreg ?? "",
        a?.data_expirare ?? "",
        a?.inscriere_initiala_id ?? "",
        a?.inscriere_modificata_id ?? "",
        cnt.creditori || "",
        cnt.debitori || "",
        cnt.bunuri || "",
        cnt.istoric || "",
        a?.alte_mentiuni ?? "",
        a?.detalii_comune ?? "",
      ];
    }),
  ];

  const wsAvize = XLSX.utils.aoa_to_sheet(avizeAoA) as Record<string, unknown>;
  wsAvize["!cols"] = A_WIDTHS.map((w) => ({ wch: w }));
  wsAvize["!rows"] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 6 }, { hpt: 22 }];

  mergeRow(wsAvize, 0, A_COLS);
  mergeRow(wsAvize, 1, A_COLS);
  styleRow(wsAvize, 0, A_COLS, styleTitle);
  styleRow(wsAvize, 1, A_COLS, styleStats);
  styleRow(wsAvize, 3, A_COLS, styleHeader);

  const NAV_COLS = { creditori: 14, debitori: 15, bunuri: 16, istoric: 17 };
  docs.forEach((d, i) => {
    const r = 4 + i;
    const fr = firstRow.get(d.identificator.v);
    const hasChildren = fr && (fr.bunuri || fr.debitori || fr.creditori || fr.istoric);
    for (let c = 0; c < A_COLS; c++) {
      const isIdent = c === 1;
      const isNav = c >= NAV_COLS.creditori && c <= NAV_COLS.istoric;
      const isLink = (isIdent && hasChildren) ||
        (c === NAV_COLS.creditori && fr?.creditori) ||
        (c === NAV_COLS.debitori && fr?.debitori) ||
        (c === NAV_COLS.bunuri && fr?.bunuri) ||
        (c === NAV_COLS.istoric && fr?.istoric);
      const s = isLink ? styleLink(i) : styleData(i, isIdent);
      if (isNav) {
        (s as { alignment: Record<string, unknown> }).alignment = { horizontal: "center", vertical: "top" };
      }
      styleCell(wsAvize, r, c, s);
    }
    // Hyperlinks
    if (isNullish(fr)) return;
    const primary = fr.bunuri ?? fr.debitori ?? fr.creditori ?? fr.istoric;
    if (primary != null) {
      const sheet = fr.bunuri ? "Bunuri" : fr.debitori ? "Debitori" : fr.creditori ? "Creditori" : "Istoric";
      setLink(wsAvize, r, 1, `#${sheet}!A${primary + 1}`, "Deschide detaliile avizului");
    }
    if (fr.creditori != null) setLink(wsAvize, r, NAV_COLS.creditori, `#Creditori!A${fr.creditori + 1}`, "Vezi creditori");
    if (fr.debitori != null) setLink(wsAvize, r, NAV_COLS.debitori, `#Debitori!A${fr.debitori + 1}`, "Vezi debitori");
    if (fr.bunuri != null) setLink(wsAvize, r, NAV_COLS.bunuri, `#Bunuri!A${fr.bunuri + 1}`, "Vezi bunuri");
    if (fr.istoric != null) setLink(wsAvize, r, NAV_COLS.istoric, `#Istoric!A${fr.istoric + 1}`, "Vezi istoric");
  });

  // ─── Helper pentru child sheets (Creditori / Debitori / Bunuri / Istoric) ─
  type ChildRow = { aviz: string; values: (string | number)[] };
  const buildChildSheet = (
    name: string,
    headers: string[],
    widths: number[],
    rows: ChildRow[],
    avizSummary: Map<string, number>, // identificator → row 0-indexed in Avize sheet
  ) => {
    if (rows.length === 0) return null;
    const cols = headers.length;
    const aoa: (string | number | null)[][] = [
      [`${name.toUpperCase()} - RNPM`, ...Array(cols - 1).fill(null)],
      [`Generat: ${dateStr}  |  ${rows.length} inregistrari`, ...Array(cols - 1).fill(null)],
      Array(cols).fill(null),
      headers,
      ...rows.map((r) => r.values),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa) as Record<string, unknown>;
    ws["!cols"] = widths.map((w) => ({ wch: w }));
    ws["!rows"] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 6 }, { hpt: 22 }];
    mergeRow(ws, 0, cols);
    mergeRow(ws, 1, cols);
    styleRow(ws, 0, cols, styleTitle);
    styleRow(ws, 1, cols, styleStats);
    styleRow(ws, 3, cols, styleHeader);

    rows.forEach((row, i) => {
      const r = 4 + i;
      const avizRow = avizSummary.get(row.aviz);
      for (let c = 0; c < cols; c++) {
        const isAvizCol = c === 0;
        const isLink = isAvizCol && avizRow != null;
        styleCell(ws, r, c, isLink ? styleLink(i) : styleData(i, isAvizCol));
      }
      if (avizRow != null) {
        setLink(ws, r, 0, `#Avize!B${avizRow + 1}`, "Inapoi la aviz");
      }
    });
    return ws;
  };

  // avizRowOf: identificator → 0-indexed row in Avize sheet
  const avizRowOf = new Map<string, number>();
  docs.forEach((d, i) => avizRowOf.set(d.identificator.v, 4 + i));

  // Build child rows
  const creditoriRows: ChildRow[] = [];
  const debitoriRows: ChildRow[] = [];
  const bunuriRows: ChildRow[] = [];
  const istoricRows: ChildRow[] = [];
  for (const d of docs) {
    const full = details.get(d.identificator.v);
    if (!full) continue;
    const idv = d.identificator.v;
    const dc = full.aviz.detalii_comune ?? "";
    for (const p of full.creditori) {
      creditoriRows.push({ aviz: idv, values: [
        idv, p.tip_persoana, p.nr_ordine ?? "", subscriptorLabel(p.subscriptor),
        p.denumire ?? "", p.prenume ?? "", p.tip_entitate ?? "",
        p.cnp ?? "", p.cod ?? "", p.nr_identificare ?? "",
        p.sediu ?? "", p.localitate ?? "", p.judet ?? "", p.cod_postal ?? "", p.tara ?? "",
        p.alte_date ?? "",
      ] });
    }
    for (const p of full.debitori) {
      debitoriRows.push({ aviz: idv, values: [
        idv, p.calitate ?? "", p.tip_persoana, p.nr_ordine ?? "", subscriptorLabel(p.subscriptor),
        p.denumire ?? "", p.prenume ?? "", p.tip_entitate ?? "",
        p.cnp ?? "", p.cod ?? "", p.nr_identificare ?? "",
        p.sediu ?? "", p.localitate ?? "", p.judet ?? "", p.cod_postal ?? "", p.tara ?? "",
        p.alte_date ?? "",
      ] });
    }
    for (const b of full.bunuri) {
      bunuriRows.push({ aviz: idv, values: [
        idv, b.tip_bun, b.categorie ?? "", b.identificare ?? "",
        b.descriere ?? "", b.model ?? "", b.serie_sasiu ?? "", b.serie_motor ?? "",
        b.nr_inmatriculare ?? "", b.referinte.map(refLabel).join(" | "), dc,
      ] });
    }
    for (const h of full.istoric) {
      istoricRows.push({ aviz: idv, values: [
        idv, h.identificator, h.data, h.tip, h.inscriere_m_v ?? "",
      ] });
    }
  }

  const wsCred = buildChildSheet(
    "Creditori",
    ["Aviz", "Tip", "Nr ordine", "Subscriptor", "Denumire", "Prenume", "Tip entitate",
      "CNP", "Cod fiscal", "Nr identificare", "Sediu", "Localitate", "Judet", "Cod postal", "Tara", "Alte date"],
    [30, 5, 9, 11, 34, 18, 16, 16, 16, 18, 36, 18, 14, 10, 10, 30],
    creditoriRows, avizRowOf,
  );
  const wsDeb = buildChildSheet(
    "Debitori",
    ["Aviz", "Calitate", "Tip", "Nr ordine", "Subscriptor", "Denumire", "Prenume", "Tip entitate",
      "CNP", "Cod fiscal", "Nr identificare", "Sediu", "Localitate", "Judet", "Cod postal", "Tara", "Alte date"],
    [30, 16, 5, 9, 11, 34, 18, 16, 16, 16, 18, 36, 18, 14, 10, 10, 30],
    debitoriRows, avizRowOf,
  );
  const wsBun = buildChildSheet(
    "Bunuri",
    ["Aviz", "Tip bun", "Categorie", "Identificare", "Descriere", "Model",
      "Serie sasiu", "Serie motor", "Nr inmatriculare", "Referinte", "Detalii comune"],
    [30, 16, 18, 30, 40, 20, 22, 18, 16, 30, 60],
    bunuriRows, avizRowOf,
  );
  const wsIst = buildChildSheet(
    "Istoric",
    ["Aviz", "Identificator", "Data", "Tip", "Inscriere modificatoare"],
    [30, 30, 11, 28, 30],
    istoricRows, avizRowOf,
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsAvize as import("xlsx").WorkSheet, "Avize");
  if (wsCred) XLSX.utils.book_append_sheet(wb, wsCred as import("xlsx").WorkSheet, "Creditori");
  if (wsDeb) XLSX.utils.book_append_sheet(wb, wsDeb as import("xlsx").WorkSheet, "Debitori");
  if (wsBun) XLSX.utils.book_append_sheet(wb, wsBun as import("xlsx").WorkSheet, "Bunuri");
  if (wsIst) XLSX.utils.book_append_sheet(wb, wsIst as import("xlsx").WorkSheet, "Istoric");

  const suffix = searchType ? `_${searchType}` : "";
  XLSX.writeFile(wb, `rnpm${suffix}_${dateStr}.xlsx`);
}

function isNullish<T>(v: T | undefined | null): v is undefined | null {
  return v == null;
}

// ─── Export PDF (neschimbat funcțional, doar detalii_comune la Bunuri) ────────

export async function exportRnpmPDF(
  docs: RnpmDocument[],
  avizIds: (number | null)[],
  searchType?: string
) {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const details = await fetchDetails(docs, avizIds);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14);
  doc.text(stripDiacritics(`Legal Dashboard - RNPM${searchType ? ` (${searchType})` : ""}`), 14, 15);
  doc.setFontSize(10);
  doc.text(stripDiacritics(`Data export: ${todayRo()} · ${docs.length} inregistrari`), 14, 21);

  autoTable(doc, {
    startY: 26,
    head: [["Nr", "Identificator", "Data", "Tip", "Utilizator autorizat", "Actualizare"]],
    body: docs.map((d) => [
      d.no,
      stripDiacritics(d.identificator.v),
      stripDiacritics(d.data ?? ""),
      stripDiacritics(d.tip ?? ""),
      stripDiacritics(d.utilizatorAutorizat ?? ""),
      d.needsActualizare ? "Da" : "Nu",
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [37, 99, 235] },
  });

  for (const d of docs) {
    const full = details.get(d.identificator.v);
    if (!full) continue;
    doc.addPage();
    doc.setFontSize(12);
    doc.text(stripDiacritics(`Aviz ${d.identificator.v} · ${d.tip} · ${d.data}`), 14, 15);
    const a = full.aviz;
    const meta: [string, string][] = [
      ["Activ", a.activ ? "Da" : "Nu"],
      ["Destinatie", a.destinatie ?? ""],
      ["Tip act", a.tip_act ?? ""],
      ["Numar act", a.numar_act ?? ""],
      ["Data inregistrare", a.data_inreg ?? ""],
      ["Data expirare", a.data_expirare ?? ""],
      ["Inscriere initiala", a.inscriere_initiala_id ?? ""],
      ["Inscriere modificata", a.inscriere_modificata_id ?? ""],
      ["Alte mentiuni", a.alte_mentiuni ?? ""],
    ];
    autoTable(doc, {
      startY: 20,
      body: meta.filter(([, v]) => v !== "").map(([k, v]) => [k, stripDiacritics(v)]),
      styles: { fontSize: 8 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
    });

    const section = (title: string, head: string[], rows: string[][]) => {
      if (rows.length === 0) return;
      const y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 20;
      doc.setFontSize(10);
      doc.text(stripDiacritics(title), 14, y + 8);
      autoTable(doc, {
        startY: y + 11,
        head: [head],
        body: rows,
        styles: { fontSize: 7 },
        headStyles: { fillColor: [37, 99, 235] },
      });
    };

    section(
      "Creditori",
      ["Nr", "Tip", "Subscr.", "Denumire", "Tip ent.", "Identificator", "Sediu", "Cod postal"],
      full.creditori.map((p) => [
        p.nr_ordine != null ? String(p.nr_ordine) : "",
        p.tip_persoana,
        subscriptorLabel(p.subscriptor),
        stripDiacritics(partyLabel(p)),
        stripDiacritics(p.tip_entitate ?? ""),
        partyId(p),
        stripDiacritics(p.sediu ?? ""),
        p.cod_postal ?? "",
      ])
    );
    section(
      "Debitori",
      ["Nr", "Tip", "Calitate", "Subscr.", "Denumire", "Tip ent.", "Identificator", "Sediu", "Cod postal"],
      full.debitori.map((p) => [
        p.nr_ordine != null ? String(p.nr_ordine) : "",
        p.tip_persoana,
        stripDiacritics(p.calitate ?? ""),
        subscriptorLabel(p.subscriptor),
        stripDiacritics(partyLabel(p)),
        stripDiacritics(p.tip_entitate ?? ""),
        partyId(p),
        stripDiacritics(p.sediu ?? ""),
        p.cod_postal ?? "",
      ])
    );

    if (a.detalii_comune) {
      const y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 20;
      doc.setFontSize(10);
      doc.text(stripDiacritics("Detalii comune"), 14, y + 8);
      autoTable(doc, {
        startY: y + 11,
        body: [[stripDiacritics(a.detalii_comune)]],
        styles: { fontSize: 8, cellPadding: 2 },
        theme: "plain",
      });
    }

    section(
      "Bunuri",
      ["Tip", "Categorie", "Detalii", "Referinte"],
      full.bunuri.map((b) => [
        b.tip_bun,
        b.categorie ?? "",
        stripDiacritics(bunLabel(b)),
        stripDiacritics(b.referinte.map(refLabel).join(" | ")),
      ])
    );
    section(
      "Istoric",
      ["Identificator", "Data", "Tip"],
      full.istoric.map((h: RnpmIstoricEntry) => [h.identificator, h.data, stripDiacritics(h.tip)])
    );
  }

  const suffix = searchType ? `_${searchType}` : "";
  doc.save(`rnpm${suffix}_${todayRo()}.pdf`);
}
