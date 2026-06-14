// Detecteaza stall-uri ale event loop-ului main process (Electron) si scrie
// pe disc lag-ul + un diagnostic report Node (stack-uri V8 ale tuturor thread-urilor)
// pentru investigatie post-mortem.
//
// Motivatie: 2026-05-17 main process a fost stuck CPU 1161s — IPC safeStorage
// timeout 10s a aparut ca "API keys disparute" cand de fapt main era blocat.
// Watchdog-ul prinde stack-ul exact data viitoare.
//
// Implementare: monitorEventLoopDelay() din perf_hooks ruleaza in libuv (NU JS
// event loop) deci masoara lag-ul corect chiar in timpul stall-urilor JS. Polling
// la 5s; daca histograma raporteaza max > LAG_THRESHOLD_MS in fereastra, scrie
// log + report.

const { monitorEventLoopDelay } = require("node:perf_hooks");
const path = require("node:path");
const fs = require("node:fs");

const POLL_INTERVAL_MS = 5_000;
const LAG_THRESHOLD_MS = 5_000;
const LOG_MAX_LINES = 200;
const REPORT_MAX_FILES = 20;

let started = false;
let timer = null;
let histogram = null;

function trimLogFile(logPath) {
  try {
    const raw = fs.readFileSync(logPath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length <= LOG_MAX_LINES) return;
    const trimmed = lines.slice(lines.length - LOG_MAX_LINES).join("\n") + "\n";
    fs.writeFileSync(logPath, trimmed, "utf8");
  } catch {
    // best-effort
  }
}

function pruneOldReports(reportsDir) {
  try {
    const files = fs
      .readdirSync(reportsDir)
      .filter((name) => name.startsWith("stall-") && name.endsWith(".json"))
      .map((name) => ({ name, mtime: fs.statSync(path.join(reportsDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const file of files.slice(REPORT_MAX_FILES)) {
      try {
        fs.unlinkSync(path.join(reportsDir, file.name));
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
}

function startEventLoopWatchdog(userDataPath) {
  if (started) return;
  started = true;

  const diagDir = path.join(userDataPath, "diagnostic");
  const reportsDir = path.join(diagDir, "reports");
  const logPath = path.join(diagDir, "event-loop-lag.log");

  try {
    fs.mkdirSync(reportsDir, { recursive: true });
  } catch (err) {
    console.warn("[watchdog] cannot create diagnostic dir:", err?.message ?? err);
    return;
  }

  histogram = monitorEventLoopDelay({ resolution: 100 });
  histogram.enable();

  timer = setInterval(() => {
    const maxNs = histogram.max;
    histogram.reset();
    if (!Number.isFinite(maxNs) || maxNs <= 0) return;
    const maxMs = Math.round(maxNs / 1e6);
    if (maxMs < LAG_THRESHOLD_MS) return;

    const ts = new Date().toISOString();
    const line = `${ts} STALL max_lag_ms=${maxMs} threshold_ms=${LAG_THRESHOLD_MS}`;
    console.warn(`[watchdog] ${line}`);

    try {
      fs.appendFileSync(logPath, line + "\n", "utf8");
      trimLogFile(logPath);
    } catch (err) {
      console.warn("[watchdog] log append failed:", err?.message ?? err);
    }

    try {
      const reportName = `stall-${ts.replace(/[:.]/g, "-")}-${maxMs}ms.json`;
      const reportPath = path.join(reportsDir, reportName);
      const report = process.report.getReport();
      // Redact secret-bearing sections recursively (incl. worker sub-reports).
      redactReportSecrets(report);
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      pruneOldReports(reportsDir);
    } catch (err) {
      console.warn("[watchdog] writeReport failed:", err?.message ?? err);
    }
  }, POLL_INTERVAL_MS);

  // Timer-ul nu trebuie sa tina procesul viu daca tot ce ramane e watchdog-ul.
  if (typeof timer.unref === "function") timer.unref();
}

function stopEventLoopWatchdog() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (histogram) {
    try {
      histogram.disable();
    } catch {
      // best-effort
    }
    histogram = null;
  }
  started = false;
}

// Strip secret-bearing sections from a Node diagnostic report before persisting.
// process.report includes `environmentVariables` and `header.commandLine` verbatim,
// plus one full sub-report per worker_thread under `workers[]` (which can nest) —
// each carrying its own env + cmdline. Recurse so no secret survives at any level.
// (Backend runs in-process with the Electron main process, so env can hold secrets.)
function redactReportSecrets(node) {
  if (!node || typeof node !== "object") return;
  node.environmentVariables = undefined;
  if (node.header) node.header.commandLine = undefined;
  if (Array.isArray(node.workers)) {
    for (const worker of node.workers) redactReportSecrets(worker);
  }
}

module.exports = { startEventLoopWatchdog, stopEventLoopWatchdog, redactReportSecrets };
