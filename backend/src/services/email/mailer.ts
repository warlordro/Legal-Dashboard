import type { Transporter } from "nodemailer";
import type {
  AlertKind,
  AlertSeverity,
  MonitoringAlertRow,
} from "../../db/monitoringAlertsRepository.ts";
import type { EmailSettings } from "../../db/ownerEmailSettingsRepository.ts";

interface MailerConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

export type EmailSendResult =
  | { ok: true }
  | { ok: false; reason: "mailer_disabled" | "no_recipient" | "send_failed" };

// v2.10.1 #8: cache the in-flight Promise rather than the resolved Transporter
// so concurrent first calls don't double-build the transport (each
// nodemailer.createTransport opens a connection pool — building two on race is
// a leak). A single Promise that all callers await converges on one transport.
let cachedTransportPromise: Promise<Transporter> | null = null;
let mailerStatusLogged = false;

export function readMailerConfig(): MailerConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number.parseInt(process.env.SMTP_PORT ?? "", 10);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM?.trim();
  const secureEnv = process.env.SMTP_SECURE?.trim().toLowerCase();
  // v2.10.1 #11: SMTP_PORT must be in the TCP range. Out-of-range or NaN ports
  // were previously passed through to nodemailer which would fail later with a
  // less obvious error.
  if (!host || !Number.isFinite(port) || port < 1 || port > 65535) return null;
  if (!user || !pass || !from) return null;
  const secure = secureEnv === "true" ? true : secureEnv === "false" ? false : port === 465;
  return { host, port, user, pass, from, secure };
}

export function isMailerConfigured(): boolean {
  return readMailerConfig() !== null;
}

async function getTransport(): Promise<Transporter | null> {
  if (cachedTransportPromise) return cachedTransportPromise;
  const config = readMailerConfig();
  if (!config) {
    if (!mailerStatusLogged) {
      console.info("[email] disabled (SMTP_* env vars not configured)");
      mailerStatusLogged = true;
    }
    return null;
  }
  cachedTransportPromise = (async () => {
    const nodemailer = await import("nodemailer");
    // v2.10.1 #2: explicit timeouts so a hung SMTP server doesn't pin the
    // alert dispatch microtask forever. Defaults in nodemailer are minutes
    // (or none) — too long for a user-facing notification path.
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 5_000,
      socketTimeout: 15_000,
    });
  })().catch((err) => {
    // Don't poison the cache on first-build failure — the next call should
    // be allowed to retry rather than getting a permanently rejected promise.
    cachedTransportPromise = null;
    throw err;
  });
  return cachedTransportPromise;
}

export function resetMailerForTests(): void {
  cachedTransportPromise = null;
  mailerStatusLogged = false;
}

// v2.17.0 — typed as `Record<AlertSeverity|AlertKind, string>` (was
// `Record<string, string>`) so the canonical tuples in monitoringAlertsRepository
// stay the single source of truth. Pre-fix this map was missing
// `termen_dupa_solutie` (added in v2.15.0) entirely, so the kind composite
// alerts surfaced in the per-alert email subject as the raw `termen_dupa_solutie`
// token instead of the human label. tsc would now refuse the missing entry.
const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: "Info",
  warning: "Avertisment",
  critical: "Critic",
};

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

function safeJson(detailJson: string): unknown {
  try {
    return JSON.parse(detailJson);
  } catch {
    return { raw: detailJson };
  }
}

function prettyDetail(alert: MonitoringAlertRow): string {
  return JSON.stringify(
    {
      title: alert.title,
      severity: alert.severity,
      kind: alert.kind,
      created_at: alert.created_at,
      detail: safeJson(alert.detail_json),
    },
    null,
    2,
  );
}

export function buildSubject(alert: MonitoringAlertRow): string {
  const severity = SEVERITY_LABELS[alert.severity] ?? "Info";
  const kind = KIND_LABELS[alert.kind] ?? alert.kind;
  return `[Legal Dashboard] ${severity}: ${kind}`;
}

export function buildHtmlBody(alert: MonitoringAlertRow): string {
  const subject = buildSubject(alert);
  const detail = escapeHtml(prettyDetail(alert));
  return [
    `<h2>${escapeHtml(subject)}</h2>`,
    "<p>Detalii:</p>",
    `<pre>${detail}</pre>`,
    `<p>Vezi in aplicatie: <a href="legal-dashboard://alerts/${alert.id}">deschide</a></p>`,
  ].join("");
}

export function buildTextBody(alert: MonitoringAlertRow): string {
  return [
    buildSubject(alert),
    "",
    "Detalii:",
    prettyDetail(alert),
    "",
    `Vezi in aplicatie: legal-dashboard://alerts/${alert.id}`,
  ].join("\n");
}

export async function sendAlertEmail(
  alert: MonitoringAlertRow,
  settings: EmailSettings,
): Promise<EmailSendResult> {
  const transport = await getTransport();
  if (!transport) return { ok: false, reason: "mailer_disabled" };
  if (!settings.toAddress) return { ok: false, reason: "no_recipient" };
  const config = readMailerConfig();
  if (!config) return { ok: false, reason: "mailer_disabled" };
  try {
    await transport.sendMail({
      from: config.from,
      to: settings.toAddress,
      subject: buildSubject(alert),
      html: buildHtmlBody(alert),
      text: buildTextBody(alert),
    });
    return { ok: true };
  } catch (err) {
    console.error("[email] sendAlertEmail failed", err);
    return { ok: false, reason: "send_failed" };
  }
}

// v2.13.0: helper trimite email pre-randat (HTML + text + subject) catre o
// adresa data. Folosit de dailyReportScheduler — rendarea sta in
// dailyReportTemplate, mailer-ul nu are nimic de stiut despre alerte.
export async function sendComposedEmail(
  toAddress: string,
  composed: { subject: string; html: string; text: string },
): Promise<EmailSendResult> {
  const transport = await getTransport();
  if (!transport) return { ok: false, reason: "mailer_disabled" };
  const config = readMailerConfig();
  if (!config) return { ok: false, reason: "mailer_disabled" };
  try {
    await transport.sendMail({
      from: config.from,
      to: toAddress,
      subject: composed.subject,
      html: composed.html,
      text: composed.text,
    });
    return { ok: true };
  } catch (err) {
    console.error("[email] sendComposedEmail failed", err);
    return { ok: false, reason: "send_failed" };
  }
}

export async function sendTestEmail(toAddress: string): Promise<EmailSendResult> {
  const transport = await getTransport();
  if (!transport) return { ok: false, reason: "mailer_disabled" };
  const config = readMailerConfig();
  if (!config) return { ok: false, reason: "mailer_disabled" };
  try {
    await transport.sendMail({
      from: config.from,
      to: toAddress,
      subject: "[Legal Dashboard] Test notificari email",
      html: "<h2>Legal Dashboard</h2><p>Email-ul de test a fost trimis cu succes.</p>",
      text: "Legal Dashboard\n\nEmail-ul de test a fost trimis cu succes.",
    });
    return { ok: true };
  } catch (err) {
    console.error("[email] sendTestEmail failed", err);
    return { ok: false, reason: "send_failed" };
  }
}
