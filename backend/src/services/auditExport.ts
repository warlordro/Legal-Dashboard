// v2.42.0 (5.4): raportul xlsx de audit. TOATE celulele trec prin safeCell
// (escape de formule, INCLUSIV ip — 10.4c); owner/actor primesc etichete umane
// "email — Nume" printr-un map batch-uit; detaliul e plafonat la 500 chars.

import ExcelJS from "exceljs";
import type { AuditRow } from "../db/auditRepository.ts";
import { getUserById } from "../db/userRepository.ts";

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
export function safeCell(v: string): string {
  return FORMULA_PREFIX.test(v) ? `'${v}` : v;
}

const OUTCOME_RO: Record<string, string> = {
  ok: "OK",
  denied: "Refuzat",
  error: "Eroare",
};

// ACELASI placeholder ca in pagina de Audit pentru owner/actor NULL.
export const AUDIT_SYSTEM_PLACEHOLDER = "system";
const DETAIL_MAX_CHARS = 500;

// Etichete umane batch-uite: un singur lookup per id distinct, nu per rand.
function buildUserLabelMap(rows: AuditRow[]): Map<string, string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.owner_id !== null) ids.add(row.owner_id);
    if (row.actor_id !== null) ids.add(row.actor_id);
  }
  const map = new Map<string, string>();
  for (const id of ids) {
    const user = getUserById(id);
    map.set(id, user ? `${user.email} — ${user.display_name}` : id);
  }
  return map;
}

function userLabel(id: string | null, labels: Map<string, string>): string {
  if (id === null) return AUDIT_SYSTEM_PLACEHOLDER;
  return labels.get(id) ?? id;
}

function capDetail(detailJson: string): string {
  if (detailJson.length <= DETAIL_MAX_CHARS) return detailJson;
  return `${detailJson.slice(0, DETAIL_MAX_CHARS)}…`;
}

export async function buildAuditXlsx(
  rows: AuditRow[],
  interval: { since: string | null; until: string | null }
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Audit");
  sheet.columns = [
    { header: "Data", key: "ts", width: 24 },
    { header: "Actiune", key: "action", width: 32 },
    { header: "Rezultat", key: "outcome", width: 12 },
    { header: "Owner", key: "owner", width: 36 },
    { header: "Actor", key: "actor", width: 36 },
    { header: "Target", key: "target", width: 28 },
    { header: "IP", key: "ip", width: 16 },
    { header: "RequestID", key: "requestId", width: 26 },
    { header: "Detalii", key: "detail", width: 60 },
  ];
  sheet.getRow(1).font = { bold: true };

  const labels = buildUserLabelMap(rows);
  for (const row of rows) {
    const target =
      row.target_kind !== null || row.target_id !== null ? `${row.target_kind ?? ""}:${row.target_id ?? ""}` : "";
    sheet.addRow({
      ts: safeCell(row.ts),
      action: safeCell(row.action),
      outcome: safeCell(OUTCOME_RO[row.outcome] ?? row.outcome),
      owner: safeCell(userLabel(row.owner_id, labels)),
      actor: safeCell(userLabel(row.actor_id, labels)),
      target: safeCell(target),
      ip: safeCell(row.ip ?? ""),
      requestId: safeCell(row.request_id ?? ""),
      detail: safeCell(capDetail(row.detail_json)),
    });
  }

  const meta = workbook.addWorksheet("Interval");
  meta.getColumn(1).width = 24;
  meta.getColumn(2).width = 36;
  meta.getCell("A1").value = "De la";
  meta.getCell("B1").value = safeCell(interval.since ?? "inceput");
  meta.getCell("A2").value = "Pana la";
  meta.getCell("B2").value = safeCell(interval.until ?? "acum");
  meta.getCell("A3").value = "Randuri";
  meta.getCell("B3").value = rows.length;

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
