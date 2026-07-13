// Task 7 (fixuri post-review): runner-ul pentru operatiile de snapshot din
// worker thread (snapshot-worker.cjs). VACUUM INTO pe baze de zeci-sute de MB
// bloca event loop-ul principal secunde intregi (Codex H2); worker-ul muta
// costul pe alt thread, cu timeout hard + terminate() pe TOATE caile de esec
// (workerii blocati nu se acumuleaza) si fallback SINCRON daca worker-ul nu
// porneste (packaging edge-case: backup-ul ramane functional, doar blocant).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import Database from "better-sqlite3";

export interface SnapshotOp {
  op: "vacuum_into";
  srcPath: string;
  destPath: string;
}

// Plafon generos: VACUUM INTO pe cateva sute de MB dureaza secunde-zeci de
// secunde; 10 min inseamna deja un disc/AV patologic — mai bine esec explicit
// decat worker zombie.
const SNAPSHOT_WORKER_TIMEOUT_MS = 10 * 60 * 1000;

// CJS bundle: __dirname = dist-backend/ (worker-ul e copiat acolo de
// scripts/build.js); dev ESM: backend/src/util/ (sibling-ul .cjs).
const __runnerDir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// Hook de test (Rev. 3): fixture-urile de worker (stricat/lent/mut) se
// injecteaza pe path; null = rezolutia normala.
let workerPathOverrideForTests: string | null = null;
export function __setSnapshotWorkerPathForTests(p: string | null): void {
  workerPathOverrideForTests = p;
}

function resolveWorkerPath(): string {
  if (workerPathOverrideForTests) return workerPathOverrideForTests;
  const base = path.join(__runnerDir, "snapshot-worker.cjs");
  // Electron impachetat: fisierul e exclus din asar (build.asarUnpack) —
  // worker_threads nu poate incarca prin fs-ul virtual asar, deci path-ul
  // se rescrie spre copia reala de pe disc.
  const marker = `app.asar${path.sep}`;
  if (base.includes(marker)) {
    return base.replace(marker, `app.asar.unpacked${path.sep}`);
  }
  return base;
}

// Fallback sincron (doar cand worker-ul NU PORNESTE): aceeasi operatie, pe
// thread-ul principal. Curata un dest partial lasat de o incercare anterioara.
function runSnapshotOpSync(op: SnapshotOp): void {
  try {
    fs.unlinkSync(op.destPath);
  } catch {
    /* absent e ok */
  }
  const db = new Database(op.srcPath, { readonly: true, fileMustExist: true });
  try {
    db.prepare("VACUUM INTO ?").run(op.destPath);
  } finally {
    db.close();
  }
  // Rev. 3: contractul runSnapshotOp = dest INTEGRITY-VERIFIED la resolve; in
  // mod degradat (worker indisponibil) verificarea ruleaza sincron pe main
  // thread — acelasi contract, doar blocant.
  const probe = new Database(op.destPath, { readonly: true, fileMustExist: true });
  try {
    const rows = probe.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
    if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") {
      throw new Error(`[snapshot] integrity_check a esuat pe ${op.destPath} (fallback sincron)`);
    }
  } finally {
    probe.close();
  }
}

// Timeout configurabil pentru teste (worker mut => fereastra scurta).
let timeoutOverrideForTests: number | null = null;
export function __setSnapshotWorkerTimeoutForTests(ms: number | null): void {
  timeoutOverrideForTests = ms;
}

export function runSnapshotOp(op: SnapshotOp): Promise<void> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(resolveWorkerPath(), { workerData: op });
    } catch (e) {
      // Worker-ul nu porneste (fisier lipsa / packaging) — fallback sincron
      // cu warn structurat; functionalitatea ramane, doar blocanta.
      console.warn(
        JSON.stringify({
          action: "snapshot.worker_fallback",
          reason: e instanceof Error ? e.message : String(e),
          ts: new Date().toISOString(),
        })
      );
      try {
        runSnapshotOpSync(op);
        resolve();
      } catch (syncErr) {
        reject(syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
      }
      return;
    }

    let settled = false;
    let gotReady = false;
    // terminate() pe TOATE caile (fix panel) — inclusiv succes: worker-ul e
    // one-shot si nu are voie sa ramana viu daca postMessage a ajuns dar
    // exit-ul intarzie. Rev. 3 (Codex M2): settle STRICT dupa terminate
    // confirmat — la timeout, VACUUM-ul nativ poate inca tine fisierele; fara
    // asteptare, maintenance lock-ul s-ar elibera si o operatie noua ar intra
    // peste tmp-ul viu. FARA plafon aici (strategie unica, fix panel-pe-plan):
    // un terminate blocat tine promisiunea pending si lock-ul held — semantica
    // corecta; plafonul de shutdown traieste in waitForBackupToSettle.
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker
        .terminate()
        .catch(() => {
          /* best-effort */
        })
        .then(fn);
    };
    // Fallback pe esec de STARTUP (Rev. 3): pre-ready, worker-ul nu a deschis
    // niciun fisier — re-rularea sincrona nu se poate suprapune cu un dest
    // partial (runSnapshotOpSync face si unlink pe dest inainte). Settle-ul
    // sincron aici e exceptie ASUMATA fata de regula "dupa terminate" — nu
    // exista handle-uri de asteptat.
    const fallback = (reason: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => {
        /* best-effort */
      });
      console.warn(JSON.stringify({ action: "snapshot.worker_fallback", reason, ts: new Date().toISOString() }));
      try {
        runSnapshotOpSync(op);
        resolve();
      } catch (syncErr) {
        reject(syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
      }
    };
    const timeoutMs = timeoutOverrideForTests ?? SNAPSHOT_WORKER_TIMEOUT_MS;
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`[snapshot] worker timeout dupa ${timeoutMs}ms (${op.op})`)));
    }, timeoutMs);
    timer.unref?.();

    // Sosesc DOUA mesaje (handshake + rezultat), deci .on, nu .once.
    worker.on("message", (msg: { ready?: boolean; ok?: boolean; error?: string }) => {
      if (msg?.ready) {
        gotReady = true;
        return;
      }
      if (msg?.ok) {
        finish(resolve);
      } else {
        finish(() => reject(new Error(msg?.error ?? "[snapshot] worker a raspuns fara ok/error")));
      }
    });
    worker.once("error", (err) => {
      if (!gotReady) {
        fallback(err instanceof Error ? err.message : String(err));
      } else {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    });
    worker.once("exit", (code) => {
      if (settled) return;
      if (!gotReady && code !== 0) {
        fallback(`worker exit ${code} inainte de ready`);
      } else {
        // exit 0 fara rezultat sau exit dupa ready = protocol rupt / crash
        // operational => reject (fara fallback pe un dest posibil partial).
        finish(() => reject(new Error(`[snapshot] worker exit ${code} fara raspuns`)));
      }
    });
  });
}
