import ExcelJS from "exceljs";
import type { AuditRow } from "../db/auditRepository.ts";

// v2.42.0: raport de audit descarcabil (xlsx) — generat server-side, ca
// template-ul de import useri. Audit-ul e append-only: raportul e calea
// legitima de a "lua" datele; stergerea NU exista (retention-ul automat de 90
// de zile din scheduler ramane singura curatare).

// Detail_json e deja plafonat la scriere (auditSanitize), dar re-plafonam la
// randare ca celula sa ramana lizibila in Excel.
const DETAIL_CELL_MAX = 500;

// Aceeasi conventie ca alertsExportXlsx/dosareExportXlsx/rnpmExportXlsx:
// celulele care incep cu caractere de formula primesc prefixul ' (aparare in
// adancime — exceljs le scrie oricum ca text, dar o trecere viitoare la CSV
// sau alta librarie nu trebuie sa redeschida vectorul).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
function safeCell(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export async function buildAuditReportXlsx(
  rows: AuditRow[],
  meta: { since?: string; until?: string },
  // id user -> eticheta umana ("email — Nume"); ID-urile brute (UUID) sunt
  // inutile intr-un raport citit de om. Fallback: ID-ul, pentru useri stersi
  // fizic sau evenimente system.
  userLabels: Map<string, string> = new Map()
): Promise<Buffer> {
  const labelOf = (id: string | null): string => (id === null ? "system" : (userLabels.get(id) ?? id));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Audit");
  ws.columns = [
    { header: "Data (UTC)", key: "ts", width: 22 },
    { header: "Actiune", key: "action", width: 34 },
    { header: "Rezultat", key: "outcome", width: 10 },
    { header: "Owner", key: "owner", width: 30 },
    { header: "Actor", key: "actor", width: 30 },
    { header: "Target", key: "target", width: 34 },
    { header: "IP", key: "ip", width: 16 },
    { header: "Request ID", key: "requestId", width: 30 },
    { header: "Detalii", key: "detail", width: 80 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    const detail = r.detail_json ?? "";
    ws.addRow({
      ts: r.ts,
      action: safeCell(r.action),
      outcome: r.outcome,
      // Placeholder UNIC pentru owner/actor null: "system" — identic cu UI-ul
      // (CodeRabbit: exportul avea "system"/gol, pagina avea "-").
      owner: safeCell(labelOf(r.owner_id)),
      actor: safeCell(labelOf(r.actor_id)),
      target: safeCell([r.target_kind, r.target_id].filter(Boolean).join(" / ")),
      ip: safeCell(r.ip ?? ""),
      requestId: safeCell(r.request_id ?? ""),
      detail: safeCell(detail.length > DETAIL_CELL_MAX ? `${detail.slice(0, DETAIL_CELL_MAX)}…` : detail),
    });
  }

  const info = wb.addWorksheet("Raport");
  info.columns = [{ width: 60 }];
  info.addRows([
    ["Raport audit Legal Dashboard"],
    [`Interval: ${meta.since ?? "inceputul bazei"} -> ${meta.until ?? "prezent"}`],
    [`Randuri: ${rows.length}`],
    ["Nota: audit-ul e append-only; retention automat 90 de zile."],
  ]);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as unknown as ArrayBuffer);
}
