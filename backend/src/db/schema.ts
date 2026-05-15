import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { stripDiacritics } from "../util/textNormalize.ts";
import { discoverMigrations, runMigrations } from "./migrations/runner.ts";

// Resolve migrations dir for both dev (Node --experimental-strip-types, ESM)
// and prod (esbuild CJS bundle). In CJS __dirname is `dist-backend/`; in dev
// it's `backend/src/db/`. Either way, sibling `migrations/` is the target.
const __schemaDir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__schemaDir, "migrations");

export function preMigrationBackup(src: string, label: string): void {
  try {
    const dir = path.join(path.dirname(src), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = path.join(dir, `legal-dashboard.pre-${label}-${stamp}.db`);
    // Plain file copy — DB is not yet opened when this runs (called from getDb before new Database(...)).
    fs.copyFileSync(src, dest);
    // v2.17.0 — also copy WAL (-wal) and SHM (-shm) sidecars when they exist.
    // SQLite serializes a checkpointed copy of the latest committed pages in
    // the WAL; without it, restoring the .db alone could lose in-flight writes
    // that hadn't been checkpointed back into the main file at shutdown. The
    // -shm file is regenerated from -wal on open, but copying both keeps the
    // backup self-consistent without requiring SQLite tooling on the recovery
    // host. Sidecars-missing is fine (DB was checkpointed clean).
    for (const suffix of ["-wal", "-shm"] as const) {
      const sidecarSrc = src + suffix;
      if (fs.existsSync(sidecarSrc)) {
        try {
          fs.copyFileSync(sidecarSrc, dest + suffix);
        } catch (e) {
          console.warn(
            `[schema] pre-migration backup sidecar ${suffix} failed (continuing):`,
            e instanceof Error ? e.message : e
          );
        }
      }
    }
    console.log(`[schema] pre-migration backup -> ${dest}`);
  } catch (e) {
    console.warn("[schema] pre-migration backup failed (continuing):", e instanceof Error ? e.message : e);
  }
}

let db: Database.Database | null = null;
// Once closeDb() runs (graceful shutdown drain), reject any late getDb()
// callers — without this, a deferred ai_usage write on the microtask queue
// would silently re-open the DB after the WAL was checkpointed and the
// process is moments from exit, leaving an unflushed handle. Pattern mirrors
// the scheduler.running guard inside `tickOnce` after withMaintenanceRead.
let shuttingDown = false;

export function getDbPath(): string {
  return process.env.LEGAL_DASHBOARD_DB_PATH ?? path.join(process.cwd(), "legal-dashboard.db");
}

export function getDb(): Database.Database {
  if (shuttingDown) {
    throw new Error("DB closed; refusing to reopen during shutdown");
  }
  if (db) return db;

  const dbPath = getDbPath();

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // One-shot pre-migration backup: only when the old `descriere` column still exists
  // and a migration is about to run. Copy is cheap, DB is closed, and we want a
  // checkpointed file on disk before ALTER TABLE / DROP COLUMN touch user data.
  if (fs.existsSync(dbPath) && needsDescriereMigration(dbPath)) {
    preMigrationBackup(dbPath, "descriere-dedup");
  }

  // v2.16.1 — generic pre-migration backup: orice migration noua (de la 0016
  // incolo, de exemplu rebuild-uri CHECK enum) face o copie a DB-ului inainte
  // de exec. Daca migrarea esueaza (CHECK reject pe randuri pre-existente,
  // INSERT SELECT cu coloane lipsa, etc.), operatorul are o copie identica
  // pre-mutatie de care sa pornesca recovery-ul. Cap deduplicarii cu legacy
  // descriere-dedup: doua backup-uri pe acelasi boot e acceptabil (se intampla
  // o singura data per upgrade major).
  if (fs.existsSync(dbPath) && hasPendingSchemaMigrations(dbPath)) {
    preMigrationBackup(dbPath, "schema-upgrade");
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // v2.22.0 — synchronous = NORMAL. SQLite default e FULL (fsync la fiecare
  // commit), care e overkill cu WAL: WAL + NORMAL face fsync doar la
  // checkpoint, fara risc de corruption pe crash (commit-urile ne-fsync-ate
  // se pierd dar DB-ul ramane consistent). Trade-off: ultimul commit dintr-un
  // crash brutal poate fi pierdut, ceea ce e acceptabil pentru un app desktop
  // single-writer cu daily backup. Reduce I/O semnificativ pe bulk inserts
  // (monitoring runs, RNPM saves) si elimina pause-uri vizibile la fsync.
  db.pragma("synchronous = NORMAL");
  // v2.17.0 — busy_timeout 5s. better-sqlite3 returns SQLITE_BUSY immediately
  // when a writer holds the lock; with WAL + a single writer (this process)
  // contention is rare, but daily backup, manual restore, and the maintenance
  // RWLock briefly block the connection. busy_timeout makes SQLite spin-wait
  // up to 5s before returning SQLITE_BUSY rather than failing the request
  // outright when a transient overlap happens.
  db.pragma("busy_timeout = 5000");

  // Truncate oversized WAL on boot. VACUUM + massive UPDATE sequences leave the -wal file
  // bloated (SQLite only auto-checkpoints, doesn't truncate). One-shot check: if WAL >
  // 32 MB at boot, force a TRUNCATE so disk usage settles quickly without waiting for the
  // next natural checkpoint.
  try {
    const walSize = fs.statSync(dbPath + "-wal").size;
    if (walSize > 32 * 1024 * 1024) {
      const t0 = Date.now();
      db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      console.log(`[schema] WAL was ${(walSize / 1024 / 1024).toFixed(1)}MB; truncated in ${Date.now() - t0}ms`);
    }
  } catch {
    /* -wal absent is fine */
  }

  // Custom scalar used by the "Baza locala" filter so "Stefan" matches "Ștefan".
  // Registered per-connection; SQLite has no built-in diacritic folding.
  db.function("rnpm_norm", { deterministic: true }, (s) => (s == null ? "" : stripDiacritics(String(s)).toLowerCase()));

  initSchema(db);

  // v2.27.5 — backfill _norm columns post-migration. Trigger-ele din 0022 populeaza
  // INSERT/UPDATE viitoare, dar randurile pre-existente in DB raman cu NULL pe _norm
  // dupa ALTER. Backfill-ul ruleaza aici (UDF e registrat) si e idempotent — la
  // boot-urile urmatoare WHERE-ul gaseste 0 randuri si nu face nimic.
  backfillRnpmNormColumns(db);

  // v2.24.0 - probe lightweight pentru index-ul filterRnpmSearchResults.
  // NU fail-closed: doar warn pentru ops (migration 0021 ar trebui sa-l creeze).
  try {
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_rnpm_avize_owner_search'")
      .get();
    if (!exists) {
      console.warn(
        "[schema] WARN: idx_rnpm_avize_owner_search lipseste; filtrul RNPM va fi mai lent. Ruleaza migration 0021."
      );
    }
  } catch (e) {
    console.warn(`[schema] index probe failed: ${e instanceof Error ? e.message : "unknown"}`);
  }

  return db;
}

// v2.16.1 — pre-open probe: pe un readonly connection citim _schema_versions
// si comparam cu fisierele de pe disk. Returneaza true daca exista vreo
// migration version necunoscuta la stored set (= pending).
// v2.17.0 — fail-closed: cand probe-ul nu poate citi `_schema_versions` (DB
// blocat de alt proces, eroare I/O tranzitorie, glitch de permisiuni), tratam
// ca "ar putea avea pending" si trigger-uim backup-ul. Un backup inutil e
// ieftin (copy de fisier); un backup ratat inainte de ALTER destructiv
// inseamna pierdere de date.
function hasPendingSchemaMigrations(dbPath: string): boolean {
  try {
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const hasVersionsTable = probe
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_versions'`)
        .get();
      const files = discoverMigrations(MIGRATIONS_DIR);
      // Legacy DB fara _schema_versions (v2.0.10 si anterior): runMigrations
      // backfill-uieste sentinel pentru baseline (version=1) si apoi aplica
      // 0002+...0N pe schema utilizatorului. Daca avem fisiere non-baseline,
      // backup inainte: o esuare pe oricare migration trebuie sa fie reversibila.
      if (!hasVersionsTable) return files.some((f) => f.version > 1);
      const stored = new Set<number>(
        (probe.prepare("SELECT version FROM _schema_versions").all() as { version: number }[]).map((r) => r.version)
      );
      return files.some((f) => !stored.has(f.version));
    } finally {
      probe.close();
    }
  } catch {
    return true;
  }
}

// Fast pre-open check: opens a temporary read-only connection to inspect columns.
// Needed because the backup copy must happen BEFORE the main connection opens in WAL mode.
function needsDescriereMigration(dbPath: string): boolean {
  try {
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const bunuriExists = probe
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='rnpm_bunuri'`)
        .get();
      if (!bunuriExists) return false;
      const cols = probe.prepare("PRAGMA table_info(rnpm_bunuri)").all() as { name: string }[];
      const hasOld = cols.some((c) => c.name === "descriere");
      const hasNew = cols.some((c) => c.name === "descriere_id");
      // Migration runs only when old column still exists AND new one is missing.
      return hasOld && !hasNew;
    } finally {
      probe.close();
    }
  } catch {
    return false;
  }
}

function initSchema(d: Database.Database): void {
  // Phase 1 — versioned migration framework (PR-0).
  // On a fresh DB: 0001_baseline.up.sql installs the full schema; later migration
  // files (0002+, added in PR-2 onward) extend it.
  // On a legacy DB (v2.0.10 and earlier): runMigrations backfills version=1 with
  // the sentinel hash, the baseline file is SKIPPED, and the idempotent legacy
  // block below continues to maintain inline ALTER history exactly as before —
  // zero behavior change for installed users.
  const migrationResult = runMigrations(d, MIGRATIONS_DIR);
  if (migrationResult.applied.length > 0) {
    console.log(`[schema] applied migrations: ${migrationResult.applied.join(", ")}`);
  }
  if (migrationResult.backfilled) {
    console.log("[schema] legacy DB — backfilled _schema_versions(1, sentinel)");
  }
  if (migrationResult.selfHealed.length > 0) {
    // Operator-visible signal: self-heal a rescris stored hash-ul (raw/CRLF -> normalized)
    // pentru DB-uri produse inainte ca normalizarea sa fie introdusa. Fara log, un boot
    // post-Litestream-restore arata identic cu un boot normal idempotent (PR-5+ web mode).
    console.log(`[schema] self-healed hash normalization for migrations: ${migrationResult.selfHealed.join(", ")}`);
  }

  // Phase 2 — legacy idempotent CREATE/ALTER block. Required for DBs backfilled
  // with the sentinel: those rows skip 0001_baseline so the historic ALTER chain
  // is what keeps their schema in lockstep with the code. Once all production
  // installs are migrated through the runner end-to-end this block can retire.
  d.exec(`
    CREATE TABLE IF NOT EXISTS rnpm_searches (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id      TEXT NOT NULL DEFAULT 'local',
      search_type   TEXT NOT NULL,
      params_json   TEXT NOT NULL,
      total_results INTEGER NOT NULL DEFAULT 0,
      criteriu      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_searches_owner ON rnpm_searches(owner_id);

    CREATE TABLE IF NOT EXISTS rnpm_avize (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id             TEXT NOT NULL DEFAULT 'local',
      uuid                 TEXT NOT NULL,
      identificator        TEXT NOT NULL,
      search_type          TEXT NOT NULL,
      tip                  TEXT NOT NULL,
      data                 TEXT NOT NULL,
      utilizator_autorizat TEXT,
      activ                INTEGER DEFAULT 1,
      needs_actualizare    INTEGER DEFAULT 0,
      destinatie           TEXT,
      tip_act              TEXT,
      numar_act            TEXT,
      data_inreg           TEXT,
      data_expirare        TEXT,
      alte_mentiuni        TEXT,
      detalii_comune       TEXT,
      detail_fetched       INTEGER DEFAULT 0,
      search_id            INTEGER REFERENCES rnpm_searches(id) ON DELETE SET NULL,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_id, identificator)
    );
    CREATE INDEX IF NOT EXISTS idx_avize_owner ON rnpm_avize(owner_id);
    CREATE INDEX IF NOT EXISTS idx_avize_identificator ON rnpm_avize(identificator);
    CREATE INDEX IF NOT EXISTS idx_avize_search_type ON rnpm_avize(owner_id, search_type);
    CREATE INDEX IF NOT EXISTS idx_avize_data ON rnpm_avize(data);

    CREATE TABLE IF NOT EXISTS rnpm_creditori (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id        TEXT NOT NULL DEFAULT 'local',
      aviz_id         INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
      tip_persoana    TEXT NOT NULL,
      denumire        TEXT,
      prenume         TEXT,
      tip_entitate    TEXT,
      sediu           TEXT,
      nr_identificare TEXT,
      cod             TEXT,
      cnp             TEXT,
      tara            TEXT,
      localitate      TEXT,
      judet           TEXT,
      cod_postal      TEXT,
      alte_date       TEXT,
      subscriptor     INTEGER,
      nr_ordine       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_creditori_owner ON rnpm_creditori(owner_id);
    CREATE INDEX IF NOT EXISTS idx_creditori_aviz ON rnpm_creditori(aviz_id);
    CREATE INDEX IF NOT EXISTS idx_creditori_cod ON rnpm_creditori(cod);

    CREATE TABLE IF NOT EXISTS rnpm_debitori (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id        TEXT NOT NULL DEFAULT 'local',
      aviz_id         INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
      tip_persoana    TEXT NOT NULL,
      calitate        TEXT,
      denumire        TEXT,
      prenume         TEXT,
      tip_entitate    TEXT,
      sediu           TEXT,
      nr_identificare TEXT,
      cod             TEXT,
      cnp             TEXT,
      tara            TEXT,
      localitate      TEXT,
      judet           TEXT,
      cod_postal      TEXT,
      alte_date       TEXT,
      subscriptor     INTEGER,
      nr_ordine       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_debitori_owner ON rnpm_debitori(owner_id);
    CREATE INDEX IF NOT EXISTS idx_debitori_aviz ON rnpm_debitori(aviz_id);
    CREATE INDEX IF NOT EXISTS idx_debitori_cod ON rnpm_debitori(cod);
    CREATE INDEX IF NOT EXISTS idx_debitori_denumire ON rnpm_debitori(denumire);

    CREATE TABLE IF NOT EXISTS rnpm_bunuri (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id         TEXT NOT NULL DEFAULT 'local',
      aviz_id          INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
      tip_bun          TEXT NOT NULL,
      categorie        TEXT,
      identificare     TEXT,
      descriere        TEXT,
      model            TEXT,
      serie_sasiu      TEXT,
      serie_motor      TEXT,
      nr_inmatriculare TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bunuri_owner ON rnpm_bunuri(owner_id);
    CREATE INDEX IF NOT EXISTS idx_bunuri_aviz ON rnpm_bunuri(aviz_id);

    CREATE TABLE IF NOT EXISTS rnpm_istoric (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id        TEXT NOT NULL DEFAULT 'local',
      aviz_id         INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
      identificator   TEXT NOT NULL,
      uuid            TEXT NOT NULL,
      data            TEXT NOT NULL,
      tip             TEXT NOT NULL,
      inscriere_m_v   TEXT,
      inscriere_m_k   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_istoric_owner ON rnpm_istoric(owner_id);
    CREATE INDEX IF NOT EXISTS idx_istoric_aviz ON rnpm_istoric(aviz_id);
  `);

  // Migration: add referinte_json column to rnpm_bunuri (idempotent)
  const cols = d.prepare("PRAGMA table_info(rnpm_bunuri)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "referinte_json")) {
    d.exec("ALTER TABLE rnpm_bunuri ADD COLUMN referinte_json TEXT");
  }

  // Migration: add inscriere_initiala_id + inscriere_initiala_uuid to rnpm_avize (idempotent).
  // Populated on avize modificatoare to preserve the link back to the parent aviz.
  const avizeCols = d.prepare("PRAGMA table_info(rnpm_avize)").all() as { name: string }[];
  if (!avizeCols.some((c) => c.name === "inscriere_initiala_id")) {
    d.exec("ALTER TABLE rnpm_avize ADD COLUMN inscriere_initiala_id TEXT");
  }
  if (!avizeCols.some((c) => c.name === "inscriere_initiala_uuid")) {
    d.exec("ALTER TABLE rnpm_avize ADD COLUMN inscriere_initiala_uuid TEXT");
  }
  if (!avizeCols.some((c) => c.name === "inscriere_modificata_id")) {
    d.exec("ALTER TABLE rnpm_avize ADD COLUMN inscriere_modificata_id TEXT");
  }
  if (!avizeCols.some((c) => c.name === "inscriere_modificata_uuid")) {
    d.exec("ALTER TABLE rnpm_avize ADD COLUMN inscriere_modificata_uuid TEXT");
  }

  // Migration: add subscriptor + nr_ordine to rnpm_creditori / rnpm_debitori (idempotent).
  // subscriptor = boolean flag (whether this party signed the aviz). nr_ordine = RNPM's display order.
  for (const t of ["rnpm_creditori", "rnpm_debitori"] as const) {
    const partyCols = d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
    if (!partyCols.some((c) => c.name === "subscriptor")) {
      d.exec(`ALTER TABLE ${t} ADD COLUMN subscriptor INTEGER`);
    }
    if (!partyCols.some((c) => c.name === "nr_ordine")) {
      d.exec(`ALTER TABLE ${t} ADD COLUMN nr_ordine INTEGER`);
    }
  }

  // Descriere dedup (lookup table) — idempotent.
  // Why: rnpm_bunuri.descriere was ~2KB × thousands of near-identical rows per aviz
  // (the same legal clause copied on every bun). Size grew to ~160MB on 500 avize.
  // Moving unique texts to rnpm_bunuri_descrieri keyed by id reduces duplication ~99%
  // while keeping the API shape unchanged (loadAvizChildren joins and aliases bd.text AS descriere).
  d.exec(`
    CREATE TABLE IF NOT EXISTS rnpm_bunuri_descrieri (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      text  TEXT NOT NULL UNIQUE
    );
  `);
  const bunuriCols = d.prepare("PRAGMA table_info(rnpm_bunuri)").all() as { name: string }[];
  const hasDescrId = bunuriCols.some((c) => c.name === "descriere_id");
  const hasDescrText = bunuriCols.some((c) => c.name === "descriere");
  if (!hasDescrId) {
    d.exec("ALTER TABLE rnpm_bunuri ADD COLUMN descriere_id INTEGER REFERENCES rnpm_bunuri_descrieri(id)");
  }
  // Index on descriere_id speeds up orphan-descriere GC after aviz deletes.
  d.exec("CREATE INDEX IF NOT EXISTS idx_bunuri_descriere_id ON rnpm_bunuri(descriere_id)");
  if (hasDescrText) {
    console.log("[schema] migrating rnpm_bunuri.descriere -> rnpm_bunuri_descrieri (may take 30-90s)");
    const t0 = Date.now();
    const migrate = d.transaction(() => {
      // Populate lookup with distinct non-empty texts. NULL stays NULL (no row inserted).
      d.exec(`
        INSERT OR IGNORE INTO rnpm_bunuri_descrieri (text)
        SELECT DISTINCT descriere FROM rnpm_bunuri WHERE descriere IS NOT NULL AND descriere <> ''
      `);
      // Fill descriere_id for rows that have text.
      d.exec(`
        UPDATE rnpm_bunuri
        SET descriere_id = (
          SELECT id FROM rnpm_bunuri_descrieri WHERE text = rnpm_bunuri.descriere
        )
        WHERE descriere IS NOT NULL AND descriere <> ''
      `);
      // Drop the now-redundant column. SQLite >= 3.35 supports DROP COLUMN inline.
      d.exec("ALTER TABLE rnpm_bunuri DROP COLUMN descriere");
    });
    migrate();
    console.log(`[schema] migration done in ${Date.now() - t0}ms; running VACUUM to reclaim disk space`);
    // VACUUM cannot run inside a transaction — do it after commit.
    const t1 = Date.now();
    d.exec("VACUUM");
    console.log(`[schema] VACUUM done in ${Date.now() - t1}ms`);
    // WAL keeps pages from before VACUUM — a checkpoint+truncate frees the -wal file too.
    // Without this, legal-dashboard.db-wal stays ~= pre-VACUUM size on disk and the UI's
    // "Dimensiune" (data+jurnal) still reports the old total.
    const t2 = Date.now();
    d.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    console.log(`[schema] WAL truncate done in ${Date.now() - t2}ms`);
  }
}

// v2.27.5 — backfill randurilor pre-existente cu valorile normalizate.
// Idempotent (WHERE col_norm IS NULL AND col IS NOT NULL); ruleaza rapid pe boot daca DB e deja in sync.
function backfillRnpmNormColumns(d: Database.Database): void {
  // Guard: daca migration-ul 0022 nu a rulat inca (ex. install fresh inainte de PR-ul asta), iesim.
  // Verificam o singura coloana — daca exista, restul sunt garantate de migration.
  try {
    const cols = d.prepare("PRAGMA table_info(rnpm_avize)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "identificator_norm")) return;
  } catch {
    return;
  }

  type Group = { table: string; cols: string[] };
  const groups: Group[] = [
    {
      table: "rnpm_avize",
      cols: [
        "identificator",
        "tip",
        "utilizator_autorizat",
        "numar_act",
        "tip_act",
        "alte_mentiuni",
        "detalii_comune",
        "inscriere_initiala_id",
        "inscriere_modificata_id",
      ],
    },
    { table: "rnpm_creditori", cols: ["denumire", "cod", "cnp"] },
    { table: "rnpm_debitori", cols: ["denumire", "cod", "cnp"] },
    {
      table: "rnpm_bunuri",
      cols: [
        "tip_bun",
        "categorie",
        "identificare",
        "model",
        "serie_sasiu",
        "serie_motor",
        "nr_inmatriculare",
        "referinte_json",
      ],
    },
    { table: "rnpm_bunuri_descrieri", cols: ["text"] },
  ];

  let totalUpdated = 0;
  const t0 = Date.now();
  for (const g of groups) {
    // Detecteaza randuri unde *vreuna* dintre _norm e NULL dar sursa nu e NULL.
    // Trimite UPDATE pe TOATE _norm-urile (cheltuiala suplimentara minima, dar singura tranzactie).
    const needsClause = g.cols.map((c) => `(${c}_norm IS NULL AND ${c} IS NOT NULL)`).join(" OR ");
    const setClause = g.cols.map((c) => `${c}_norm = rnpm_norm(${c})`).join(", ");
    const sql = `UPDATE ${g.table} SET ${setClause} WHERE ${needsClause}`;
    try {
      const res = d.prepare(sql).run();
      if (res.changes > 0) totalUpdated += res.changes;
    } catch (e) {
      console.warn(
        `[schema] backfill _norm pe ${g.table} esuat (continuam): ${e instanceof Error ? e.message : "unknown"}`
      );
    }
  }
  if (totalUpdated > 0) {
    console.log(`[schema] backfill _norm: ${totalUpdated} randuri actualizate in ${Date.now() - t0}ms`);
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Production shutdown sets this AFTER awaiting in-flight drains so any late
// `recordAiUsageSafely` microtask (or other deferred write) cannot reopen
// the DB on its way out. Tests use closeDb() between cases without this
// latch — they only need the handle reset, not the one-way shutdown lock.
export function markShuttingDown(): void {
  shuttingDown = true;
  if (db) {
    db.close();
    db = null;
  }
}

// SQLite DELETE-urile acumuleaza in WAL pana la checkpoint automat, iar modalul "Info baza locala"
// raporteaza "date + jurnal" (main.db + main.db-wal). Fara TRUNCATE dupa bulk delete, fisierul WAL
// continua sa creasca si da impresia ca baza "se mareste pe masura ce sterg".
export function checkpointWal(): void {
  const d = getDb();
  d.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
}

// VACUUM rescrie intregul fisier eliminand paginile libere ramase dupa DELETE.
// Nu poate rula in tranzactie si ia un lock exclusiv → blocheaza alte operatii pentru cateva secunde la 100MB.
// Apelam TRUNCATE pe WAL inainte si dupa, ca statisticile post-compact sa reflecte imediat noua dimensiune.
export function compactDb(): { beforeBytes: number; afterBytes: number; durationMs: number } {
  const d = getDb();
  const dbPath = getDbPath();
  const sizeOf = (p: string): number => {
    try {
      return fs.statSync(p).size;
    } catch {
      return 0;
    }
  };
  const before = sizeOf(dbPath) + sizeOf(dbPath + "-wal") + sizeOf(dbPath + "-shm");
  const t0 = Date.now();
  d.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  d.exec("VACUUM");
  d.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  const durationMs = Date.now() - t0;
  const after = sizeOf(dbPath) + sizeOf(dbPath + "-wal") + sizeOf(dbPath + "-shm");
  return { beforeBytes: before, afterBytes: after, durationMs };
}
