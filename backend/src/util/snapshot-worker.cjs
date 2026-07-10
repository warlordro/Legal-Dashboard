// Task 7 (fixuri post-review): worker CJS PUR (fara TS, fara bundling) —
// VACUUM INTO ruleaza aici ca sa nu blocheze event loop-ul principal
// (Codex H2 + panel H1). One-shot: primeste op-ul prin workerData, raspunde
// { ok } / { error } prin postMessage si iese. Conexiune readonly PROPRIE
// per op (WAL MVCC: snapshot consistent point-in-time, fara sa blocheze
// scriitorii de pe conexiunea vie a procesului principal).
// Fisierul e copiat de scripts/build.js in dist-backend/ si exclus din asar
// (package.json build.asarUnpack) — worker_threads incarca de pe disc real.
"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const Database = require("better-sqlite3");

function run(op) {
  if (
    !op ||
    op.op !== "vacuum_into" ||
    typeof op.srcPath !== "string" ||
    op.srcPath.length === 0 ||
    typeof op.destPath !== "string" ||
    op.destPath.length === 0
  ) {
    return { error: `[snapshot-worker] op invalid: ${JSON.stringify(op?.op)}` };
  }
  let db = null;
  try {
    db = new Database(op.srcPath, { readonly: true, fileMustExist: true });
    db.prepare("VACUUM INTO ?").run(op.destPath);
    return { ok: true };
  } catch (e) {
    return { error: e?.message ? e.message : String(e) };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* best-effort */
      }
    }
  }
}

parentPort.postMessage(run(workerData));
