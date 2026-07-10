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

function resolveWorkerPath(): string {
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
    // terminate() pe TOATE caile (fix panel) — inclusiv succes: worker-ul e
    // one-shot si nu are voie sa ramana viu daca postMessage a ajuns dar
    // exit-ul intarzie.
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => {
        /* best-effort */
      });
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`[snapshot] worker timeout dupa ${SNAPSHOT_WORKER_TIMEOUT_MS}ms (${op.op})`)));
    }, SNAPSHOT_WORKER_TIMEOUT_MS);
    timer.unref?.();

    worker.once("message", (msg: { ok?: boolean; error?: string }) => {
      if (msg?.ok) {
        finish(resolve);
      } else {
        finish(() => reject(new Error(msg?.error ?? "[snapshot] worker a raspuns fara ok/error")));
      }
    });
    worker.once("error", (err) => {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
    worker.once("exit", (code) => {
      if (!settled) {
        finish(() => reject(new Error(`[snapshot] worker exit ${code} fara raspuns`)));
      }
    });
  });
}
