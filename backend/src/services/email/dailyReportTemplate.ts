import type {
  AlertKind,
  AlertSeverity,
  MonitoringAlertRow,
} from "../../db/monitoringAlertsRepository.ts";

// v2.13.0: HTML + text template pentru daily digest email. Genereaza un singur
// email per owner cu toate alertele din ziua precedenta, grupate vizual pe
// severitate (critical → warning → info). Numerele de dosar sunt link-uri
// catre portal.just.ro/SitePages/cautare.aspx?k=<numar> (URL public).

// v2.17.0 — typed as `Record<AlertSeverity, string>` / `Record<AlertKind, string>`
// (was `Record<string, string>`) so adding a new alert kind to the canonical
// `ALERT_KINDS` tuple in monitoringAlertsRepository surfaces here as a tsc
// error instead of a silent fall-through to a raw kind string in the email.
const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: "Info",
  warning: "Avertisment",
  critical: "Critic",
};

const SEVERITY_ORDER = ["critical", "warning", "info"] as const;

const KIND_LABELS: Record<AlertKind, string> = {
  dosar_new: "Dosar nou",
  termen_new: "Termen nou",
  termen_changed: "Termen modificat",
  termen_dupa_solutie: "Termen nou dupa solutie",
  solutie_aparuta: "Solutie aparuta",
  dosar_disappeared: "Dosar disparut",
  stadiu_changed: "Stadiu modificat",
  categorie_changed: "Categorie modificata",
  dosar_relevant_now: "Dosar relevant",
  dosar_no_longer_relevant: "Dosar nerelevant",
  aviz_changed: "Aviz modificat",
  source_error: "Eroare sursa",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Invalid JSON in detail / target — caller falls back to undefined fields.
  }
  return {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

// PortalJust SharePoint indexer nu retine sufixul de dosar asociat (/a, /a1, /a2 ...).
// Strip-ul cauta dosarul parinte ca search-ul sa returneze macar contextul; user-ul
// gaseste asociatii din pagina parinte.
export function getPortalJustUrl(numarDosar: string): string {
  const parent = numarDosar.replace(/\/a\d*$/i, "");
  return `https://portal.just.ro/SitePages/cautare.aspx?k=${encodeURIComponent(parent)}`;
}

export interface AlertDigestRow {
  id: number;
  createdAt: string;
  kindLabel: string;
  severity: string;
  severityLabel: string;
  title: string;
  numarDosar: string | null;
  dosarLink: string | null;
  nameMonitored: string | null;
}

// Mirror of frontend `buildAlertContext` for the email digest. We only need
// the identifiers (numar_dosar + name_normalized), not the full structured
// facts list — those would clutter a digest with N rows per alert.
export function deriveAlertDigestRow(alert: MonitoringAlertRow): AlertDigestRow {
  const detail = safeJsonObject(alert.detail_json);
  const target = safeJsonObject(alert.job_target_json ?? null);
  const numarDosar =
    asString(detail.numar_dosar) ??
    asString(detail.numar) ??
    asString(detail.dosar) ??
    asString(target.numar_dosar) ??
    asString(target.numar) ??
    null;
  const nameMonitored = asString(detail.name_normalized) ?? asString(target.name_normalized) ?? null;
  return {
    id: alert.id,
    createdAt: alert.created_at,
    kindLabel: KIND_LABELS[alert.kind] ?? alert.kind,
    severity: alert.severity,
    severityLabel: SEVERITY_LABELS[alert.severity] ?? alert.severity,
    title: alert.title,
    numarDosar,
    dosarLink: numarDosar ? getPortalJustUrl(numarDosar) : null,
    nameMonitored,
  };
}

function formatRomanianDate(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const [, y, mo, d] = m;
  return `${d}.${mo}.${y}`;
}

function formatTime(iso: string): string {
  // alerts.created_at is UTC ISO `YYYY-MM-DDTHH:MM:SS.sssZ`. We want Romania
  // local time in the digest since the report is anchored to a local day.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export interface DailyReportTemplateInput {
  /** YYYY-MM-DD in server local timezone — the day the alerts cover. */
  reportDateLocal: string;
  alerts: MonitoringAlertRow[];
}

export interface RenderedDailyReport {
  subject: string;
  html: string;
  text: string;
  rowCount: number;
}

function renderHtmlSeverityBlock(severity: AlertSeverity, rows: AlertDigestRow[]): string {
  if (rows.length === 0) return "";
  const label = SEVERITY_LABELS[severity] ?? severity;
  const accent = severity === "critical" ? "#dc2626" : severity === "warning" ? "#d97706" : "#0284c7";
  const tableRows = rows
    .map((row) => {
      const dosarCell = row.dosarLink
        ? `<a href="${escapeHtml(row.dosarLink)}" style="color:#0284c7;text-decoration:underline">${escapeHtml(row.numarDosar ?? "")}</a>`
        : "—";
      return [
        "<tr>",
        `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#475569;white-space:nowrap">${escapeHtml(formatTime(row.createdAt))}</td>`,
        `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#0f172a">${escapeHtml(row.kindLabel)}</td>`,
        `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#0f172a">${escapeHtml(row.title)}</td>`,
        `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;font-family:monospace">${dosarCell}</td>`,
        `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#475569">${escapeHtml(row.nameMonitored ?? "—")}</td>`,
        "</tr>",
      ].join("");
    })
    .join("");
  return [
    `<h3 style="margin:24px 0 8px;color:${accent};font-size:14px;border-left:4px solid ${accent};padding-left:8px">${escapeHtml(label)} (${rows.length})</h3>`,
    '<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif">',
    "<thead>",
    '<tr style="background:#f8fafc">',
    '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#475569;border-bottom:1px solid #cbd5e1">Ora</th>',
    '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#475569;border-bottom:1px solid #cbd5e1">Tip</th>',
    '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#475569;border-bottom:1px solid #cbd5e1">Titlu</th>',
    '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#475569;border-bottom:1px solid #cbd5e1">Dosar</th>',
    '<th style="padding:8px 10px;text-align:left;font-size:11px;color:#475569;border-bottom:1px solid #cbd5e1">Nume monitorizat</th>',
    "</tr>",
    "</thead>",
    `<tbody>${tableRows}</tbody>`,
    "</table>",
  ].join("");
}

function renderTextSeverityBlock(severity: AlertSeverity, rows: AlertDigestRow[]): string {
  if (rows.length === 0) return "";
  const label = SEVERITY_LABELS[severity] ?? severity;
  const lines: string[] = [`### ${label} (${rows.length})`, ""];
  for (const row of rows) {
    const dosar = row.numarDosar ? `${row.numarDosar} (${row.dosarLink})` : "—";
    lines.push(
      `- [${formatTime(row.createdAt)}] ${row.kindLabel}: ${row.title}`,
      `  Dosar: ${dosar}`,
      `  Nume monitorizat: ${row.nameMonitored ?? "—"}`,
      ""
    );
  }
  return lines.join("\n");
}

export function renderDailyReport(input: DailyReportTemplateInput): RenderedDailyReport {
  const rows = input.alerts.map(deriveAlertDigestRow);
  // Sort by created_at ascending within the day so the email reads as a
  // chronological recap.
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const grouped = new Map<string, AlertDigestRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.severity) ?? [];
    list.push(row);
    grouped.set(row.severity, list);
  }
  const dateLabel = formatRomanianDate(input.reportDateLocal);
  const subject = `[Legal Dashboard] Raport zilnic ${dateLabel} — ${rows.length} ${
    rows.length === 1 ? "alerta" : "alerte"
  }`;

  const htmlSections = SEVERITY_ORDER.map((sev) => renderHtmlSeverityBlock(sev, grouped.get(sev) ?? []))
    .filter((s) => s.length > 0)
    .join("");
  const html = [
    '<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:760px;margin:0 auto;padding:16px">',
    `<h2 style="margin:0 0 4px;font-size:18px">Raport zilnic — ${escapeHtml(dateLabel)}</h2>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#475569">Toate alertele de monitorizare generate in ziua precedenta (${rows.length} ${
      rows.length === 1 ? "intrare" : "intrari"
    }).</p>`,
    htmlSections,
    '<p style="margin:24px 0 0;font-size:11px;color:#94a3b8">Acest mesaj a fost generat automat de Legal Dashboard. Poti dezactiva raportul zilnic din Setari → Notificari email.</p>',
    "</div>",
  ].join("");

  const textSections = SEVERITY_ORDER.map((sev) => renderTextSeverityBlock(sev, grouped.get(sev) ?? []))
    .filter((s) => s.length > 0)
    .join("\n");
  const text = [
    `Raport zilnic — ${dateLabel}`,
    `Total: ${rows.length} ${rows.length === 1 ? "alerta" : "alerte"}`,
    "",
    textSections,
    "Dezactiveaza raportul din Setari → Notificari email.",
  ].join("\n");

  return { subject, html, text, rowCount: rows.length };
}
