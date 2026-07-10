// v2.43.0 (rnpm-split): splitter one-time care muta datele RNPM din monolit in
// fisierele per user (<dataDir>/rnpm/<stem>.db), pastrand id-urile originale.
// Protocol crash-safe in 2 faze cu marker durabil `.split-done.json`:
//   1. marker "done" + randuri rnpm in monolit => ABORT boot (monolit restaurat
//      dintr-un backup pre-split; NU suprascriem fisierele per-user mai noi).
//   2. marker "wiping" => copierea s-a terminat si a fost verificata pentru toti
//      ownerii; reia DOAR wipe-ul (fisierele per-user sunt sursa de adevar).
//   3. fara marker + randuri rnpm => split normal (crash inainte de marker =
//      monolitul e inca sursa de adevar; fisierele partiale se rescriu integral).
// Ordinea: preflights -> pre-split backup STRICT -> copiere+verificare per owner
// -> marker "wiping" (fsync) -> wipe monolit + verificare zero -> marker "done"
// -> VACUUM best-effort. NEMONTAT la boot pana la commit-ul de cutover (rutarea
// repositories) — altfel ar exista o fereastra in care scrierile noi merg in
// fisiere per-user iar splitter-ul ulterior le-ar suprascrie din monolit.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { prunePreSplitBackupsSync } from "./backup.ts";
import { runMigrations } from "./migrations/runner.ts";
import {
  assertValidOwnerId,
  closeRnpmDb,
  getRnpmDataDir,
  getRnpmDbPath,
  MIGRATIONS_RNPM_DIR,
  registerRnpmNorm,
} from "./rnpmDb.ts";
import { getDb, getDbPath } from "./schema.ts";

// Ordinea respecta dependintele FK la INSERT; descrierile se copiaza separat
// INAINTE de rnpm_bunuri (descriere_id).
const COPY_TABLES = [
  "rnpm_searches",
  "rnpm_avize",
  "rnpm_creditori",
  "rnpm_debitori",
  "rnpm_bunuri",
  "rnpm_istoric",
] as const;
const ALL_RNPM_TABLES = [...COPY_TABLES, "rnpm_bunuri_descrieri"] as const;
const CHILD_TABLES = ["rnpm_creditori", "rnpm_debitori", "rnpm_bunuri", "rnpm_istoric"] as const;
// Wipe in ordinea copii -> parinti -> descrieri (fara sa ne bazam pe CASCADE).
const WIPE_ORDER = [
  "rnpm_istoric",
  "rnpm_bunuri",
  "rnpm_creditori",
  "rnpm_debitori",
  "rnpm_avize",
  "rnpm_searches",
  "rnpm_bunuri_descrieri",
] as const;

interface SplitMarker {
  status: "wiping" | "done";
  completedAt: string | null;
  owners: string[];
  appVersion: string;
  // Fix review (Task 3): count-urile per owner/tabela, scrise de split pe
  // marker-ul "wiping" (populate la faza de copiere, cu subsetul WHERE EXISTS
  // pentru rnpm_bunuri_descrieri). OBLIGATORIU la resume-ul "wiping" (verifica
  // fisierele per-user inainte de golirea monolitului), OPTIONAL pe "done"
  // (fresh-install si markerele istorice nu il au).
  manifest?: Record<string, Record<string, number>>;
}

export interface RnpmSplitOptions {
  // Failpoint-hook pentru testele de crash; erorile aruncate din onPhase se propaga.
  onPhase?: (phase: string, detail?: unknown) => void;
  // Injectabil pentru teste; default statfsSync pe directorul bazei.
  getFreeBytes?: (dir: string) => number;
  appVersion?: string;
}

function log(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ action: "rnpm_split", ts: new Date().toISOString(), ...fields }));
}

function markerPath(): string {
  return path.join(getRnpmDataDir(), ".split-done.json");
}

function readMarker(): SplitMarker | null {
  const p = markerPath();
  if (!fs.existsSync(p)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(
      `[rnpm_split] marker-ul de split e corupt la ${p} (${e instanceof Error ? e.message : String(e)}). ` +
        "Boot abortat fail-closed. Vezi RUNBOOK 'Monolit restaurat dupa split' pentru remediere."
    );
  }
  // Fix review (Task 3): validare runtime FAIL-CLOSED — cast-ul orb lasa un
  // marker cu status necunoscut sa cada pe fluxul de split normal, care poate
  // SUPRASCRIE fisiere per-user mai noi din monolit. Campurile necunoscute
  // sunt tolerate (forward-compat); orice abatere pe cele cunoscute = abort.
  const abort = (reason: string): never => {
    throw new Error(
      `[rnpm_split] marker-ul de split e invalid la ${p} (${reason}). ` +
        "Boot abortat fail-closed. Vezi RUNBOOK 'Monolit restaurat dupa split' pentru remediere."
    );
  };
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return abort("nu e un obiect JSON");
  const m = parsed as Partial<SplitMarker>;
  if (m.status !== "wiping" && m.status !== "done") return abort(`status necunoscut: ${JSON.stringify(m.status)}`);
  if (!Array.isArray(m.owners)) return abort("owners lipsa sau non-array");
  for (const o of m.owners) {
    if (typeof o !== "string") return abort("owner non-string in owners");
    try {
      assertValidOwnerId(o);
    } catch (e) {
      return abort(e instanceof Error ? e.message : "ownerId invalid in owners");
    }
  }
  if (
    m.manifest !== undefined &&
    (typeof m.manifest !== "object" || m.manifest === null || Array.isArray(m.manifest))
  ) {
    return abort("manifest non-obiect");
  }
  return m as SplitMarker;
}

// Scriere durabila: temp + fsync + rename atomic, apoi fsync pe director
// (best-effort — Windows nu permite open pe directoare).
function writeMarker(m: SplitMarker): void {
  fs.mkdirSync(getRnpmDataDir(), { recursive: true });
  const p = markerPath();
  const tmp = `${p}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, JSON.stringify(m, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p);
  try {
    const dirFd = fs.openSync(getRnpmDataDir(), "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    /* fsync pe director indisponibil (Windows) — best-effort */
  }
}

// unlink care inghite DOAR ENOENT — EBUSY/EPERM/EACCES opresc split-ul inainte
// de open/rename (un tmp sau WAL vechi reutilizat = corupere).
function unlinkStrict(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }
}

export function assertDiskSpaceForSplit(
  monoPath: string,
  getFreeBytes: (dir: string) => number = (dir) => {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  }
): void {
  const monoSize = (() => {
    try {
      const main = fs.statSync(monoPath).size;
      let wal = 0;
      try {
        wal = fs.statSync(`${monoPath}-wal`).size;
      } catch {
        /* absent e ok */
      }
      return main + wal;
    } catch {
      return 0;
    }
  })();
  const free = getFreeBytes(path.dirname(monoPath));
  if (free < 3 * monoSize) {
    throw new Error(
      `[rnpm_split] spatiu insuficient pe disc: liber ${(free / 1024 / 1024).toFixed(0)}MB, ` +
        `necesar ~${((3 * monoSize) / 1024 / 1024).toFixed(0)}MB (3x volumul bazei). ` +
        "Elibereaza spatiu si reporneste aplicatia; nu s-a mutat nimic."
    );
  }
}

function renameWithRetry(from: string, to: string): void {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      lastErr = e;
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw e;
      log({ stage: "rename_retry", attempt, code, from: path.basename(from) });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  throw lastErr;
}

// DEVIERE documentata fata de plan (validata cu GPT-5.6 Sol la executie):
// planul cerea ATTACH readonly prin URI percent-encodat (`file:...?mode=ro`),
// dar better-sqlite3 e compilat FARA SQLITE_USE_URI — ATTACH cu URI esueaza
// complet ("unable to open database"), iar `PRAGMA mono.query_only` nu e
// per-schema, ci pe TOATA conexiunea (ar bloca si scrierile in target).
// Inlocuitor echivalent fail-closed: monolitul se deschide pe o CONEXIUNE
// SEPARATA cu { readonly: true } (readonly REAL la open, la nivel de OS;
// spatiile din path nu sunt o problema fara URI), iar copierea se face prin
// JavaScript intre cele doua conexiuni. Un open readonly esuat opreste split-ul.
export function openMonoSourceReadonly(): Database.Database {
  return new Database(getDbPath(), { readonly: true, fileMustExist: true });
}

// Pre-split backup STRICT (fail-closed) — spre deosebire de preMigrationBackup
// (best-effort), aici backup-ul E rollback-ul promis: VACUUM INTO self-contained,
// verificare existenta + size > 0 + PRAGMA integrity_check pe copie; ORICE esec
// opreste split-ul inainte de prima mutare. Ramane SINCRON deliberat (Task 7):
// ruleaza la BOOT, inainte de serve() — nu exista event loop de protejat.
function preSplitBackupStrict(mono: Database.Database): string {
  const dir = path.join(path.dirname(getDbPath()), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  // VACUUM INTO refuza (corect) sa suprascrie; un re-run in aceeasi secunda
  // (crash imediat dupa backup) primeste un sufix incremental, nu overwrite.
  let dest = path.join(dir, `legal-dashboard.pre-rnpm-split-${stamp}.db`);
  for (let i = 2; fs.existsSync(dest); i++) {
    dest = path.join(dir, `legal-dashboard.pre-rnpm-split-${stamp}-${i}.db`);
  }
  mono.prepare("VACUUM INTO ?").run(dest);
  const size = fs.statSync(dest).size;
  if (size <= 0) throw new Error("[rnpm_split] backup pre-split gol");
  const probe = new Database(dest, { readonly: true, fileMustExist: true });
  try {
    const rows = probe.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") {
      throw new Error("[rnpm_split] backup pre-split corupt (integrity_check)");
    }
  } finally {
    probe.close();
  }
  // Fix review (Task 2): prune DUPA verificarea backup-ului proaspat — un
  // crash-loop la split (esec repetat dupa backup_ok) nu mai umple discul cu
  // cate un backup pre-split per boot; raman cele mai noi 3.
  const pruned = prunePreSplitBackupsSync();
  if (pruned > 0) log({ stage: "backup_prune", pruned });
  return dest;
}

function countRnpmRows(mono: Database.Database): number {
  let total = 0;
  for (const t of ALL_RNPM_TABLES) {
    total += (mono.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  }
  return total;
}

// PREFLIGHTS — toate fail-closed, monolitul ramane intact.
function runPreflights(mono: Database.Database, getFreeBytes?: (dir: string) => number): string[] {
  // 1. Ownerii din searches UNION avize, validati pentru operatii pe fisiere.
  const owners = mono
    .prepare("SELECT owner_id FROM rnpm_searches UNION SELECT owner_id FROM rnpm_avize ORDER BY owner_id")
    .all()
    .map((r) => (r as { owner_id: string }).owner_id);
  for (const o of owners) assertValidOwnerId(o);

  // 2. Integritate FK per tabela rnpm (mesaj cu tabela la violari).
  for (const t of ALL_RNPM_TABLES) {
    const violations = mono.prepare(`PRAGMA foreign_key_check(${t})`).all();
    if (violations.length > 0) {
      throw new Error(
        `[rnpm_split] foreign_key_check a gasit ${violations.length} violari in ${t}; ` +
          "repara monolitul inainte de split (nu s-a mutat nimic). Vezi RUNBOOK."
      );
    }
  }

  // 3. Consistenta owner parinte-copil: un rand copil cu owner diferit de avizul
  // parinte ar ajunge in fisierul altui user sau ar ramane orfan.
  for (const t of CHILD_TABLES) {
    const n = (
      mono
        .prepare(
          `SELECT COUNT(*) AS n FROM ${t} c JOIN rnpm_avize a ON c.aviz_id = a.id WHERE c.owner_id != a.owner_id`
        )
        .get() as { n: number }
    ).n;
    if (n > 0) {
      throw new Error(
        `[rnpm_split] inconsistenta owner parinte-copil in ${t}: ${n} randuri cu owner diferit de avizul parinte. ` +
          "Repara monolitul inainte de split (nu s-a mutat nimic)."
      );
    }
  }
  const crossSearch = (
    mono
      .prepare(
        "SELECT COUNT(*) AS n FROM rnpm_avize a JOIN rnpm_searches s ON a.search_id = s.id WHERE a.owner_id != s.owner_id"
      )
      .get() as { n: number }
  ).n;
  if (crossSearch > 0) {
    throw new Error(
      `[rnpm_split] inconsistenta owner intre rnpm_avize si rnpm_searches: ${crossSearch} randuri. ` +
        "Repara monolitul inainte de split (nu s-a mutat nimic)."
    );
  }

  // 4. Spatiu pe disc: copie per-user + backup pre-split + WAL => ~3x volumul bazei.
  assertDiskSpaceForSplit(getDbPath(), getFreeBytes);

  return owners;
}

function integrityCheckOrThrow(db: Database.Database, label: string): void {
  const rows = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
  if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") {
    throw new Error(`[rnpm_split] integrity_check a esuat pentru ${label}`);
  }
}

// Query-urile sursa per tabela: descrierile sunt subsetul referit de bunurile
// ownerului, cu id-urile ORIGINALE (rnpm_bunuri.descriere_id ramane valid fara
// remapare); restul tabelelor filtreaza pe owner_id.
function sourceSelect(table: string, cols: string[]): string {
  if (table === "rnpm_bunuri_descrieri") {
    return (
      `SELECT ${cols.map((c) => `d.${c}`).join(", ")} FROM rnpm_bunuri_descrieri d ` +
      "WHERE EXISTS (SELECT 1 FROM rnpm_bunuri b WHERE b.descriere_id = d.id AND b.owner_id = ?)"
    );
  }
  return `SELECT ${cols.join(", ")} FROM ${table} WHERE owner_id = ?`;
}

// Copiaza datele unui owner intr-un fisier tmp, verifica, publica prin rename.
// Sursa = conexiune readonly REALA la monolit; transferul se face prin JS
// (vezi nota de deviere de la openMonoSourceReadonly). Returneaza count-urile
// verificate per tabela — devin manifestul owner-ului din marker-ul "wiping".
function copyOwnerToFile(owner: string): Record<string, number> {
  closeRnpmDb(owner);
  const finalPath = getRnpmDbPath(owner);
  const tmpPath = `${finalPath}.split-tmp`;
  const counts: Record<string, number> = {};
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  for (const p of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) unlinkStrict(p);

  const src = openMonoSourceReadonly();
  const target = new Database(tmpPath);
  try {
    target.pragma("journal_mode = WAL");
    target.pragma("foreign_keys = ON");
    target.pragma("synchronous = NORMAL");
    target.pragma("busy_timeout = 5000");
    registerRnpmNorm(target);
    // Runner-ul INAINTE de date (capcana sentinel: pe fisier gol nu exista
    // tabele => nu backfill-uieste; cu date deja prezente ar backfill-ui).
    runMigrations(target, MIGRATIONS_RNPM_DIR);

    const columnsOf = (t: string): string[] =>
      (src.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    // Ordinea de insert: descrieri INAINTE de COPY_TABLES (rnpm_bunuri.descriere_id).
    const insertOrder = ["rnpm_bunuri_descrieri", ...COPY_TABLES] as const;

    const copyAll = target.transaction(() => {
      for (const t of insertOrder) {
        const cols = columnsOf(t);
        const insert = target.prepare(
          `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
        );
        for (const row of src.prepare(sourceSelect(t, cols)).iterate(owner)) {
          insert.run(cols.map((c) => (row as Record<string, unknown>)[c]));
        }
      }
      // sqlite_sequence: preia high-water mark-ul sursei per tabela — id-urile
      // sterse istoric peste MAX(id) nu se reemit in fisierul nou.
      for (const t of ALL_RNPM_TABLES) {
        const srcSeq = src.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get(t) as
          | { seq: number }
          | undefined;
        if (!srcSeq) continue;
        const updated = target
          .prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?")
          .run(srcSeq.seq, t);
        if (updated.changes === 0) {
          target.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(t, srcSeq.seq);
        }
      }
    });
    copyAll();

    // Verificare: COUNT per tabela (sursa WHERE owner vs fisier) + subsetul
    // descrierilor. Count-urile verificate devin manifestul owner-ului (Task 3):
    // pentru rnpm_bunuri_descrieri numarul e EXACT subsetul WHERE EXISTS al
    // countSql-ului, nu COUNT(*) global pe monolit.
    const countSql = (t: string): string =>
      t === "rnpm_bunuri_descrieri"
        ? "SELECT COUNT(*) AS n FROM rnpm_bunuri_descrieri d " +
          "WHERE EXISTS (SELECT 1 FROM rnpm_bunuri b WHERE b.descriere_id = d.id AND b.owner_id = ?)"
        : `SELECT COUNT(*) AS n FROM ${t} WHERE owner_id = ?`;
    for (const t of insertOrder) {
      const srcN = (src.prepare(countSql(t)).get(owner) as { n: number }).n;
      const mineN = (target.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
      if (srcN !== mineN) {
        throw new Error(`[rnpm_split] verificare esuata pentru ${owner}/${t}: mono=${srcN} vs fisier=${mineN}`);
      }
      counts[t] = mineN;
    }
    integrityCheckOrThrow(target, `${owner} (pre-publish)`);
    target.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  } catch (e) {
    try {
      target.close();
    } catch {
      /* best-effort */
    }
    try {
      src.close();
    } catch {
      /* best-effort */
    }
    throw e;
  }
  target.close();
  src.close();

  for (const suffix of ["-wal", "-shm"] as const) unlinkStrict(finalPath + suffix);
  renameWithRetry(tmpPath, finalPath);

  // Post-publish probe: rename reusit logic != fisier citibil; verificam inainte
  // sa declaram owner_done.
  const probe = new Database(finalPath, { readonly: true, fileMustExist: true });
  try {
    integrityCheckOrThrow(probe, `${owner} (post-publish)`);
  } finally {
    probe.close();
  }
  return counts;
}

// Fix review (Task 3): resume-ul "wiping" NU mai are voie sa goleasca
// monolitul pe incredere — fisierele per-user sunt re-verificate contra
// manifestului din marker (existenta + integrity_check + count-uri identice).
// Orice abatere = ABORT inainte de wipe, cu monolitul intact (sursa de adevar).
// Tabelele verificate vin din ALL_RNPM_TABLES (whitelist), NU din cheile
// manifestului — un marker forjat nu poate injecta nume de tabela in SQL.
function verifyWipingResume(marker: SplitMarker): void {
  // Anotarea explicita pe VARIABILA (nu doar pe return) e necesara ca TS sa
  // trateze apelul ca terminator de control-flow (narrowing dupa abort).
  const abort: (reason: string) => never = (reason) => {
    throw new Error(
      `[rnpm_split] resume 'wiping' refuzat: ${reason}. Monolitul NU a fost golit. ` +
        "Boot abortat fail-closed. Vezi RUNBOOK 'Monolit restaurat dupa split' pentru remediere."
    );
  };
  const manifest = marker.manifest;
  if (!manifest) {
    // Nu exista in productie (splitter-ul scrie mereu manifest din acest fix);
    // mediile dev cu marker pre-fix: sterge rnpm/.split-done.json + re-split
    // (linia dedicata din RUNBOOK).
    abort("marker 'wiping' fara manifest (marker pre-fix sau forjat)");
  }
  for (const owner of marker.owners) {
    const ownerManifest = manifest[owner];
    if (!ownerManifest || typeof ownerManifest !== "object") {
      abort(`manifestul nu are intrare pentru ownerul ${owner}`);
    }
    const filePath = getRnpmDbPath(owner);
    if (!fs.existsSync(filePath)) {
      abort(`fisierul per-user al ownerului ${owner} lipseste (${path.basename(filePath)})`);
    }
    let db: Database.Database;
    try {
      db = new Database(filePath, { readonly: true, fileMustExist: true });
    } catch (e) {
      abort(
        `fisierul per-user al ownerului ${owner} nu poate fi deschis: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    try {
      integrityCheckOrThrow(db, `${owner} (resume wiping)`);
      for (const t of ALL_RNPM_TABLES) {
        const expected = ownerManifest[t];
        if (typeof expected !== "number") {
          abort(`manifestul ownerului ${owner} nu are count pentru ${t}`);
        }
        const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
        if (n !== expected) {
          abort(`count nepotrivit pentru ${owner}/${t}: manifest=${expected} vs fisier=${n}`);
        }
      }
    } catch (e) {
      // integrity_check / SQL pe fisier corupt: acelasi abort cu context.
      if (e instanceof Error && e.message.includes("resume 'wiping' refuzat")) throw e;
      abort(
        `fisierul per-user al ownerului ${owner} a picat verificarea: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      db.close();
    }
  }
}

// DELETE explicit pe toate cele 7 tabele (copii -> parinti -> descrieri), apoi
// VERIFICA zero randuri in fiecare.
function wipeMonolithRnpm(mono: Database.Database): void {
  const wipe = mono.transaction(() => {
    for (const t of WIPE_ORDER) mono.prepare(`DELETE FROM ${t}`).run();
  });
  wipe();
  for (const t of ALL_RNPM_TABLES) {
    const n = (mono.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    if (n !== 0) throw new Error(`[rnpm_split] wipe incomplet: ${t} mai are ${n} randuri`);
  }
}

export function runRnpmSplitIfNeeded(opts?: RnpmSplitOptions): { split: boolean; owners: string[] } {
  const onPhase = opts?.onPhase ?? (() => {});
  const appVersion = opts?.appVersion ?? "unknown";
  const mono = getDb();
  const pending = countRnpmRows(mono);
  const marker = readMarker();

  if (marker?.status === "done") {
    if (pending === 0) return { split: false, owners: [] };
    // Monolit restaurat dintr-un backup pre-split — NU suprascrie fisierele per-user.
    throw new Error(
      "[rnpm_split] split-ul a fost deja finalizat, dar monolitul contine din nou randuri RNPM " +
        "(probabil un restore de backup vechi al bazei). Boot abortat fail-closed. " +
        "Vezi RUNBOOK 'Monolit restaurat dupa split' pentru cele doua cai de remediere."
    );
  }
  if (marker?.status === "wiping") {
    // Toti ownerii au fost deja copiati si verificati la split; re-verificam
    // fisierele contra manifestului INAINTE de wipe (Task 3) si reluam DOAR wipe-ul.
    verifyWipingResume(marker);
    log({ stage: "resume_wipe", owners: marker.owners.length });
    wipeMonolithRnpm(mono);
    writeMarker({ status: "done", completedAt: new Date().toISOString(), owners: marker.owners, appVersion });
    onPhase("marker_done");
    return { split: true, owners: marker.owners };
  }
  if (pending === 0) {
    // Instalare fresh: marcheaza direct done ca boot-urile urmatoare sa nu mai scaneze.
    writeMarker({ status: "done", completedAt: new Date().toISOString(), owners: [], appVersion });
    return { split: false, owners: [] };
  }

  const owners = runPreflights(mono, opts?.getFreeBytes);
  onPhase("preflight_ok");
  log({ stage: "start", owners: owners.length, pendingRows: pending });

  const backupPath = preSplitBackupStrict(mono);
  log({ stage: "backup_ok", backup: path.basename(backupPath) });
  onPhase("backup_ok");

  const manifest: Record<string, Record<string, number>> = {};
  for (const owner of owners) {
    manifest[owner] = copyOwnerToFile(owner);
    log({ stage: "owner_done", owner });
    onPhase("owner_done", owner);
  }

  writeMarker({ status: "wiping", completedAt: null, owners, appVersion, manifest });
  onPhase("marker_wiping");
  wipeMonolithRnpm(mono);
  writeMarker({ status: "done", completedAt: new Date().toISOString(), owners, appVersion });
  onPhase("marker_done");
  log({ stage: "done", owners: owners.length });

  try {
    mono.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    mono.exec("VACUUM");
  } catch (e) {
    log({ stage: "vacuum_failed", reason: e instanceof Error ? e.message : String(e) });
  }
  return { split: true, owners };
}
