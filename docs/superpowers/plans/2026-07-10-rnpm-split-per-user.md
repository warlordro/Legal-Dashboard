# RNPM Split Per User — Plan de Implementare (v2.43.0) — Rev. 3

> **Pentru agentul executant:** acest plan implementeaza spec-ul aprobat
> `docs/superpowers/specs/2026-07-10-rnpm-split-per-user-design.md`. Citeste spec-ul INTAI.
> Task-urile se executa IN ORDINE, cu checkbox-uri (`- [ ]`) pentru tracking. Fiecare task
> se incheie cu gate-uri verzi + commit. NU sari peste pasii de test (TDD: red inainte de green).
> Rev. 3 incorporeaza doua runde de review adversarial (review-panel multi-model + GPT-5.6 Sol);
> vezi sectiunea finala "Istoric review" pentru ce s-a schimbat si de ce.

**Goal:** separarea fizica a datelor RNPM per utilizator — fiecare user primeste fisierul lui
SQLite cu backup/restore self-service, iar baza unica (monolitul) pastreaza tot restul
(users, auth, quota, monitoring, audit, fx_rates).

**Arhitectura:** un registry de handle-uri better-sqlite3 per owner cu provisioning lazy prin
runner-ul de migrations existent; un splitter one-time la boot (cu marker durabil de finalizare)
care muta datele RNPM din monolit in fisierele per-user pastrand ID-urile originale; backup.ts
generalizat pe "targets" cu snapshot-uri self-contained via `db.backup()`; rute self-service
owner-scoped + router admin nou pentru monolit.

**Tech stack:** Node 22, Hono, better-sqlite3 (sincron), Vitest, React 18 + Vite, esbuild (backend bundlat CJS).

## Constrangeri globale (se aplica fiecarui task)

- Limba UI/mesaje: romana FARA diacritice in cod sursa (constrangere legacy a proiectului).
- Erorile HTTP folosesc envelope-ul standard: `fail(code, message, c)` din `backend/src/util/envelope.ts` (shape `{ data, error: { code, message }, requestId }`).
- SQL raw DOAR in `backend/src/db/**` (repository-only access).
- Backend-ul e bundlat CJS de esbuild: `import.meta.url` nu functioneaza in CJS — foloseste pattern-ul existent `typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url))`.
- Gate-uri INAINTE de fiecare commit (toate verzi, altfel nu comiti):
  1. `npx biome check --write <DOAR fisierele atinse de task, enumerate explicit>` (re-stage ce reformateaza)
  2. `npx tsc --noEmit -p backend/tsconfig.json`
  3. `cd frontend && npx tsc --noEmit` (doar daca ai atins frontend)
  4. `npm run build` (obligatoriu la FIECARE task — bundle-ul CJS + copierea asset-urilor pot pica independent de tsc)
  5. `npm run test:backend` (sau suite tinta cu `npx vitest run <path> --root backend` in timpul TDD; suita completa inainte de commit)
  6. `cd frontend && npm test -- --run` (doar daca ai atins frontend)
- `git add` DOAR pe fisierele enumerate in task (niciodata `git add -A` pe directoare); ruleaza `git status --short` si `git diff --stat --cached` inainte de commit si verifica sa nu fi prins fisiere straine.
- Dupa teste Node care ating better-sqlite3, inainte de orice smoke Electron: `npm run rebuild:electron`.
- Branch: `feat/v2.43.0-rnpm-split` (stacked pe `feat/v2.42.0-users-settings`). NU comite nimic pe `feat/v2.42.0-users-settings` si nimic pe `main`. NU face push fara cerere explicita a userului.
- NU redenumi/reformata cod neatins de task (schimbari chirurgicale).
- Numerele de linie din plan sunt ORIENTATIVE (pot fi decalate) — localizeaza intotdeauna dupa simbol/functie/continut.
- `requireDesktopHeader` NU se scoate de pe NICIO ruta: in desktop mode header-ul custom e apararea CSRF (forteaza preflight CORS pe request-urile cross-origin catre 127.0.0.1), iar in web mode e pass-through complet. Self-service = doar trecerea de la `requireRole("admin")` la `requireRole("admin", "user")` pe rutele owner-scoped.
- `ownerId` se valideaza `^[A-Za-z0-9_-]{1,64}$` inainte de ORICE folosire; numele de FISIER derivat din ownerId este `rnpmFileStem(ownerId)` (vezi Task 2) — NICIODATA ownerId-ul brut (coliziuni case-insensitive pe Windows/macOS + nume rezervate Windows).
- Toate snapshot-urile de backup produse de cod NOU sunt self-contained via `db.backup()` (API-ul online al SQLite) — niciodata `copyFile` pe un DB cu WAL activ.
- In teste, ORICE handle better-sqlite3 deschis se inchide in `finally`/teardown (Windows tine lock pe fisiere deschise si `rm -rf` pe tmpdir pica altfel).
- Mesaje commit: prefix conventional (`feat:`, `fix:`, `test:`, `docs:`) + descriere in romana.

---

### Task 1: Migration baseline consolidata `migrations-rnpm/0001`

**Files:**
- Create: `backend/src/db/migrations-rnpm/0001_rnpm_baseline.up.sql`
- Create: `backend/src/db/migrations-rnpm/0001_rnpm_baseline.down.sql`
- Modify: `scripts/build.js` (copierea directorului in dist-backend)
- Test: `backend/src/db/rnpmDb.test.ts` (partial — testele de baseline; fisierul creste in Task 2)

**Interfaces:**
- Produces: directorul `migrations-rnpm/` consumat de `runMigrations(db, MIGRATIONS_RNPM_DIR)` in Task 2.
- Baseline-ul = forma FINALA consolidata a tabelelor rnpm din monolit: schema din `migrations/0001_baseline.up.sql` (doar tabelele rnpm) + coloanele `_norm` din `0022` incluse INLINE in CREATE TABLE + indexul din `0021` + trigger-ele din `0022` verbatim.
- ATENTIE: testele existente ale chain-ului MONOLITIC (ex. testul migration `0021`, `downMigrations.test.ts`) NU se muta si NU se repointeaza — chain-ul monolitului ramane neatins si acoperit; baseline-ul rnpm primeste teste NOI, separate.

- [ ] **Step 1.1: Scrie fisierul up**

Creeaza `backend/src/db/migrations-rnpm/0001_rnpm_baseline.up.sql` cu EXACT continutul de mai jos
(compus din migrations 0001 + 0021 + 0022 ale monolitului; coloanele `_norm` sunt inline, deci
NU e nevoie de backfill — trigger-ele populeaza totul de la primul INSERT):

```sql
-- 0001_rnpm_baseline.up.sql — baseline consolidat pentru fisierele RNPM per user (v2.43.0).
-- Compus din migrations monolit: 0001 (tabele rnpm), 0021 (index owner+search), 0022 (_norm + triggere).
-- Coloanele _norm sunt inline in CREATE TABLE (fisier nou = zero randuri de backfill).
-- ATENTIE: trigger-ele apeleaza UDF-ul rnpm_norm() — conexiunea care ruleaza aceasta migration
-- TREBUIE sa aiba UDF-ul inregistrat INAINTE de runMigrations (vezi registerRnpmNorm in rnpmDb.ts).

CREATE TABLE rnpm_searches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL DEFAULT 'local',
  search_type   TEXT NOT NULL,
  params_json   TEXT NOT NULL,
  total_results INTEGER NOT NULL DEFAULT 0,
  criteriu      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_searches_owner ON rnpm_searches(owner_id);

CREATE TABLE rnpm_avize (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id                 TEXT NOT NULL DEFAULT 'local',
  uuid                     TEXT NOT NULL,
  identificator            TEXT NOT NULL,
  search_type              TEXT NOT NULL,
  tip                      TEXT NOT NULL,
  data                     TEXT NOT NULL,
  utilizator_autorizat     TEXT,
  activ                    INTEGER DEFAULT 1,
  needs_actualizare        INTEGER DEFAULT 0,
  destinatie               TEXT,
  tip_act                  TEXT,
  numar_act                TEXT,
  data_inreg               TEXT,
  data_expirare            TEXT,
  alte_mentiuni            TEXT,
  detalii_comune           TEXT,
  detail_fetched           INTEGER DEFAULT 0,
  search_id                INTEGER REFERENCES rnpm_searches(id) ON DELETE SET NULL,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  inscriere_initiala_id    TEXT,
  inscriere_initiala_uuid  TEXT,
  inscriere_modificata_id  TEXT,
  inscriere_modificata_uuid TEXT,
  identificator_norm        TEXT,
  tip_norm                  TEXT,
  utilizator_autorizat_norm TEXT,
  numar_act_norm            TEXT,
  tip_act_norm              TEXT,
  alte_mentiuni_norm        TEXT,
  detalii_comune_norm       TEXT,
  inscriere_initiala_id_norm  TEXT,
  inscriere_modificata_id_norm TEXT,
  UNIQUE(owner_id, identificator)
);
CREATE INDEX idx_avize_owner         ON rnpm_avize(owner_id);
CREATE INDEX idx_avize_identificator ON rnpm_avize(identificator);
CREATE INDEX idx_avize_search_type   ON rnpm_avize(owner_id, search_type);
CREATE INDEX idx_avize_data          ON rnpm_avize(data);
CREATE INDEX idx_rnpm_avize_owner_search ON rnpm_avize(owner_id, search_id);

-- Lookup dedup pentru texte descriere bunuri. In fisierul per-user NU mai e partajat
-- intre useri (fiecare fisier are copia proprie), dar pastreaza aceeasi forma ca sa nu
-- se schimbe niciun query din avizRepository.
CREATE TABLE rnpm_bunuri_descrieri (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  text      TEXT NOT NULL UNIQUE,
  text_norm TEXT
);

CREATE TABLE rnpm_creditori (
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
  nr_ordine       INTEGER,
  denumire_norm   TEXT,
  cod_norm        TEXT,
  cnp_norm        TEXT
);
CREATE INDEX idx_creditori_owner ON rnpm_creditori(owner_id);
CREATE INDEX idx_creditori_aviz  ON rnpm_creditori(aviz_id);
CREATE INDEX idx_creditori_cod   ON rnpm_creditori(cod);

CREATE TABLE rnpm_debitori (
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
  nr_ordine       INTEGER,
  denumire_norm   TEXT,
  cod_norm        TEXT,
  cnp_norm        TEXT
);
CREATE INDEX idx_debitori_owner    ON rnpm_debitori(owner_id);
CREATE INDEX idx_debitori_aviz     ON rnpm_debitori(aviz_id);
CREATE INDEX idx_debitori_cod      ON rnpm_debitori(cod);
CREATE INDEX idx_debitori_denumire ON rnpm_debitori(denumire);

CREATE TABLE rnpm_bunuri (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id         TEXT NOT NULL DEFAULT 'local',
  aviz_id          INTEGER NOT NULL REFERENCES rnpm_avize(id) ON DELETE CASCADE,
  tip_bun          TEXT NOT NULL,
  categorie        TEXT,
  identificare     TEXT,
  model            TEXT,
  serie_sasiu      TEXT,
  serie_motor      TEXT,
  nr_inmatriculare TEXT,
  referinte_json   TEXT,
  descriere_id     INTEGER REFERENCES rnpm_bunuri_descrieri(id),
  tip_bun_norm          TEXT,
  categorie_norm        TEXT,
  identificare_norm     TEXT,
  model_norm            TEXT,
  serie_sasiu_norm      TEXT,
  serie_motor_norm      TEXT,
  nr_inmatriculare_norm TEXT,
  referinte_json_norm   TEXT
);
CREATE INDEX idx_bunuri_owner        ON rnpm_bunuri(owner_id);
CREATE INDEX idx_bunuri_aviz         ON rnpm_bunuri(aviz_id);
CREATE INDEX idx_bunuri_descriere_id ON rnpm_bunuri(descriere_id);

CREATE TABLE rnpm_istoric (
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
CREATE INDEX idx_istoric_owner ON rnpm_istoric(owner_id);
CREATE INDEX idx_istoric_aviz  ON rnpm_istoric(aviz_id);

CREATE TRIGGER trg_rnpm_avize_norm_ins
AFTER INSERT ON rnpm_avize
BEGIN
  UPDATE rnpm_avize SET
    identificator_norm = rnpm_norm(NEW.identificator),
    tip_norm = rnpm_norm(NEW.tip),
    utilizator_autorizat_norm = rnpm_norm(NEW.utilizator_autorizat),
    numar_act_norm = rnpm_norm(NEW.numar_act),
    tip_act_norm = rnpm_norm(NEW.tip_act),
    alte_mentiuni_norm = rnpm_norm(NEW.alte_mentiuni),
    detalii_comune_norm = rnpm_norm(NEW.detalii_comune),
    inscriere_initiala_id_norm = rnpm_norm(NEW.inscriere_initiala_id),
    inscriere_modificata_id_norm = rnpm_norm(NEW.inscriere_modificata_id)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_avize_norm_upd
AFTER UPDATE OF
  identificator, tip, utilizator_autorizat, numar_act, tip_act,
  alte_mentiuni, detalii_comune, inscriere_initiala_id, inscriere_modificata_id
ON rnpm_avize
BEGIN
  UPDATE rnpm_avize SET
    identificator_norm = rnpm_norm(NEW.identificator),
    tip_norm = rnpm_norm(NEW.tip),
    utilizator_autorizat_norm = rnpm_norm(NEW.utilizator_autorizat),
    numar_act_norm = rnpm_norm(NEW.numar_act),
    tip_act_norm = rnpm_norm(NEW.tip_act),
    alte_mentiuni_norm = rnpm_norm(NEW.alte_mentiuni),
    detalii_comune_norm = rnpm_norm(NEW.detalii_comune),
    inscriere_initiala_id_norm = rnpm_norm(NEW.inscriere_initiala_id),
    inscriere_modificata_id_norm = rnpm_norm(NEW.inscriere_modificata_id)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_creditori_norm_ins
AFTER INSERT ON rnpm_creditori
BEGIN
  UPDATE rnpm_creditori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_creditori_norm_upd
AFTER UPDATE OF denumire, cod, cnp ON rnpm_creditori
BEGIN
  UPDATE rnpm_creditori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_debitori_norm_ins
AFTER INSERT ON rnpm_debitori
BEGIN
  UPDATE rnpm_debitori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_debitori_norm_upd
AFTER UPDATE OF denumire, cod, cnp ON rnpm_debitori
BEGIN
  UPDATE rnpm_debitori SET
    denumire_norm = rnpm_norm(NEW.denumire),
    cod_norm = rnpm_norm(NEW.cod),
    cnp_norm = rnpm_norm(NEW.cnp)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_bunuri_norm_ins
AFTER INSERT ON rnpm_bunuri
BEGIN
  UPDATE rnpm_bunuri SET
    tip_bun_norm = rnpm_norm(NEW.tip_bun),
    categorie_norm = rnpm_norm(NEW.categorie),
    identificare_norm = rnpm_norm(NEW.identificare),
    model_norm = rnpm_norm(NEW.model),
    serie_sasiu_norm = rnpm_norm(NEW.serie_sasiu),
    serie_motor_norm = rnpm_norm(NEW.serie_motor),
    nr_inmatriculare_norm = rnpm_norm(NEW.nr_inmatriculare),
    referinte_json_norm = rnpm_norm(NEW.referinte_json)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_bunuri_norm_upd
AFTER UPDATE OF
  tip_bun, categorie, identificare, model, serie_sasiu, serie_motor,
  nr_inmatriculare, referinte_json
ON rnpm_bunuri
BEGIN
  UPDATE rnpm_bunuri SET
    tip_bun_norm = rnpm_norm(NEW.tip_bun),
    categorie_norm = rnpm_norm(NEW.categorie),
    identificare_norm = rnpm_norm(NEW.identificare),
    model_norm = rnpm_norm(NEW.model),
    serie_sasiu_norm = rnpm_norm(NEW.serie_sasiu),
    serie_motor_norm = rnpm_norm(NEW.serie_motor),
    nr_inmatriculare_norm = rnpm_norm(NEW.nr_inmatriculare),
    referinte_json_norm = rnpm_norm(NEW.referinte_json)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_bunuri_descrieri_norm_ins
AFTER INSERT ON rnpm_bunuri_descrieri
BEGIN
  UPDATE rnpm_bunuri_descrieri SET
    text_norm = rnpm_norm(NEW.text)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_rnpm_bunuri_descrieri_norm_upd
AFTER UPDATE OF text ON rnpm_bunuri_descrieri
BEGIN
  UPDATE rnpm_bunuri_descrieri SET
    text_norm = rnpm_norm(NEW.text)
  WHERE id = NEW.id;
END;
```

- [ ] **Step 1.2: Scrie fisierul down**

Creeaza `backend/src/db/migrations-rnpm/0001_rnpm_baseline.down.sql`:

```sql
-- 0001_rnpm_baseline.down.sql — inversare baseline per-user (DROP TABLE sterge si trigger-ele).
DROP TABLE IF EXISTS rnpm_istoric;
DROP TABLE IF EXISTS rnpm_bunuri;
DROP TABLE IF EXISTS rnpm_debitori;
DROP TABLE IF EXISTS rnpm_creditori;
DROP TABLE IF EXISTS rnpm_bunuri_descrieri;
DROP TABLE IF EXISTS rnpm_avize;
DROP TABLE IF EXISTS rnpm_searches;
```

- [ ] **Step 1.3: Adauga copierea in build**

In `scripts/build.js`, imediat DUPA blocul existent care copiaza `migrations/` (cauta
`dist-backend", "migrations"`), adauga:

```js
mkdirSync(resolve(root, "dist-backend", "migrations-rnpm"), { recursive: true });
cpSync(resolve(root, "backend", "src", "db", "migrations-rnpm"), resolve(root, "dist-backend", "migrations-rnpm"), {
  recursive: true,
});
```

- [ ] **Step 1.4: Teste — baseline aplicabil + ECHIVALENTA de schema cu monolitul**

Creeaza `backend/src/db/rnpmDb.test.ts` cu DOUA teste (inchide toate handle-urile in `finally`):

Test A — baseline-ul se aplica si trigger-ele populeaza `_norm` (identic cu testul clasic):

```ts
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrations/runner.ts";
import { stripDiacritics } from "../util/textNormalize.ts";

const __testDir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_RNPM_DIR = path.join(__testDir, "migrations-rnpm");
const MIGRATIONS_MONO_DIR = path.join(__testDir, "migrations");

function openWithNorm(p: string): Database.Database {
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.function("rnpm_norm", { deterministic: true }, (s) =>
    s == null ? "" : stripDiacritics(String(s)).toLowerCase()
  );
  return db;
}

let tmpRoot: string;
beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpmdb-"));
});
afterEach(async () => {
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("migrations-rnpm baseline", () => {
  it("aplica baseline-ul pe un fisier fresh si trigger-ele populeaza _norm", () => {
    const db = openWithNorm(path.join(tmpRoot, "u1.db"));
    try {
      const result = runMigrations(db, MIGRATIONS_RNPM_DIR);
      expect(result.applied).toEqual([1]);
      expect(result.backfilled).toBe(false);
      db.prepare(
        "INSERT INTO rnpm_searches (owner_id, search_type, params_json, total_results) VALUES ('u1','dupa_nume','{}',0)"
      ).run();
      db.prepare(
        "INSERT INTO rnpm_avize (owner_id, uuid, identificator, search_type, tip, data) VALUES ('u1','uu','Ștefan-1','dupa_nume','aviz','2026-01-01')"
      ).run();
      const row = db.prepare("SELECT identificator_norm FROM rnpm_avize").get() as { identificator_norm: string };
      expect(row.identificator_norm).toBe("stefan-1");
    } finally {
      db.close();
    }
  });

  it("baseline-ul e ECHIVALENT structural cu tabelele rnpm dintr-un monolit fresh (anti-drift)", () => {
    const mono = openWithNorm(path.join(tmpRoot, "mono.db"));
    const user = openWithNorm(path.join(tmpRoot, "user.db"));
    try {
      runMigrations(mono, MIGRATIONS_MONO_DIR);
      runMigrations(user, MIGRATIONS_RNPM_DIR);
      const tables = ["rnpm_searches", "rnpm_avize", "rnpm_bunuri_descrieri", "rnpm_creditori", "rnpm_debitori", "rnpm_bunuri", "rnpm_istoric"];
      for (const t of tables) {
        const cols = (d: Database.Database) =>
          d.prepare(`PRAGMA table_info(${t})`).all().map((c: any) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}:${c.pk}`);
        const idx = (d: Database.Database) =>
          d.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND name NOT LIKE 'sqlite_%' ORDER BY name`).all(t).map((r: any) => r.name);
        const fks = (d: Database.Database) => d.prepare(`PRAGMA foreign_key_list(${t})`).all();
        const trg = (d: Database.Database) =>
          d.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name`).all(t).map((r: any) => r.name);
        expect(cols(user), `coloane ${t}`).toEqual(cols(mono));
        expect(idx(user), `indexuri ${t}`).toEqual(idx(mono));
        expect(fks(user), `FK ${t}`).toEqual(fks(mono));
        expect(trg(user), `triggere ${t}`).toEqual(trg(mono));
      }
      // Anti-drift invers: monolitul nu are tabele rnpm_* necunoscute listei de mai sus.
      const monoRnpm = mono
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rnpm_%' ORDER BY name`)
        .all()
        .map((r: any) => r.name);
      expect(monoRnpm.sort()).toEqual([...tables].sort());
    } finally {
      mono.close();
      user.close();
    }
  });
});
```

Testul B e apararea principala contra driftului: o migration viitoare care adauga o tabela/coloana
rnpm in monolit fara pereche in baseline PICA aici.

- [ ] **Step 1.5: Ruleaza testele** — `npx vitest run src/db/rnpmDb.test.ts --root backend`.
Pentru fisiere pur-SQL: scrii SQL-ul, apoi testele, apoi PASS. Daca vrei red-ul clasic, ruleaza
testul inainte de a crea directorul (FAIL pe "directory missing").

- [ ] **Step 1.6: Gate-uri + commit**

```bash
npx biome check --write backend/src/db/rnpmDb.test.ts scripts/build.js
npx tsc --noEmit -p backend/tsconfig.json
npm run build
npx vitest run src/db/rnpmDb.test.ts --root backend
git add backend/src/db/migrations-rnpm scripts/build.js backend/src/db/rnpmDb.test.ts
git commit -m "feat(rnpm-split): baseline consolidat migrations-rnpm/0001 + test echivalenta schema + copiere in build"
```

---

### Task 2: DB layer per user — `rnpmActivity.ts` + `rnpmDb.ts`

**Files:**
- Create: `backend/src/db/rnpmActivity.ts` (registry activitate + erori tipate — in DB layer, ca `rnpmDb` sa il poata consulta fara dependinta spre services)
- Create: `backend/src/db/rnpmDb.ts`
- Test: `backend/src/db/rnpmActivity.test.ts`, `backend/src/db/rnpmDb.test.ts` (extindere)

**Interfaces (Produces — consumate de Task 3-8):**
```ts
// rnpmActivity.ts
export class RnpmSearchActiveError extends Error { readonly code = "SEARCH_ACTIVE"; }
export class RnpmRestoreInProgressError extends Error { readonly code = "RESTORE_IN_PROGRESS"; }
export function beginRnpmSearch(ownerId: string): void;      // arunca RnpmRestoreInProgressError daca restore in curs
export function endRnpmSearch(ownerId: string): void;        // tolerant la dublu-end (warn, nu throw)
export function hasActiveRnpmSearch(ownerId: string): boolean;
export function beginRnpmRestore(ownerId: string): void;     // arunca RnpmSearchActiveError daca exista search activ
export function endRnpmRestore(ownerId: string): void;
export function isRnpmRestoreInProgress(ownerId: string): boolean;
export function __resetRnpmActivityForTests(): void;
// rnpmDb.ts
export const MIGRATIONS_RNPM_DIR: string;
export function assertValidOwnerId(ownerId: string): void;               // ^[A-Za-z0-9_-]{1,64}$
export function rnpmFileStem(ownerId: string): string;                   // nume de fisier collision-safe
export function getRnpmDataDir(): string;                                // <dirname(getDbPath())>/rnpm
export function getRnpmDbPath(ownerId: string): string;                  // <dataDir>/rnpm/<stem>.db
export function getRnpmBackupJail(ownerId: string): string;              // <dataDir>/backups/rnpm/<stem>/
export function registerRnpmNorm(db: Database.Database): void;
export function getRnpmDb(ownerId: string): Database.Database;           // latch shutdown + latch restore + provisioning lazy
export function openRnpmDbRaw(ownerId: string): Database.Database | null; // handle temporar readonly FARA provisioning (null daca fisierul lipseste); callerul inchide
export function closeRnpmDb(ownerId: string): void;
export function closeAllRnpmDbs(): void;
export function markRnpmShuttingDown(): void;
export function __resetRnpmDbForTests(): void;
export function checkpointRnpmWal(ownerId: string): void;
export function compactRnpmDb(ownerId: string): { beforeBytes: number; afterBytes: number; durationMs: number };
```

**Decizii de design incorporate din review (Sol):**
- **Numele de fisier NU e ownerId-ul brut.** ID-urile pot diferi doar prin majuscule, iar pe
  filesystem-uri case-insensitive (Windows, macOS default) `A.db` si `a.db` sunt ACELASI fisier —
  splitter-ul ar suprascrie datele unui owner cu ale altuia. In plus `CON`/`NUL`/`COM1` sunt nume
  rezervate Windows. `rnpmFileStem(ownerId) = ownerId.toLowerCase() + "-" + sha256hex(ownerId).slice(0, 10)`
  e injectiv indiferent de case-sensitivity (case-ul diferit schimba hash-ul) si sufixul face
  imposibil un nume rezervat.
- **Gardul de restore traieste in `getRnpmDb`**, nu doar in functiile de search: in timpul unui
  restore, ORICE operatie repository a acelui owner (stats, list, delete, compact, export) primeste
  `RnpmRestoreInProgressError` in loc sa redeschida lazy fisierul in mijlocul swap-ului.

- [ ] **Step 2.1: Teste failing** — `rnpmActivity.test.ts`: begin/end simetric; `beginRnpmRestore`
arunca `RnpmSearchActiveError` daca exista search activ; `beginRnpmSearch` arunca
`RnpmRestoreInProgressError` daca restore activ; ownerii diferiti nu se blocheaza; dublu-begin +
un end => inca activ; dublu-end => warn, nu throw. In `rnpmDb.test.ts` adauga:

```ts
describe("getRnpmDb", () => {
  it("provisioneaza lazy fisierul per owner cu baseline-ul aplicat", () => { /* tabelele rnpm_* + _schema_versions.max=1 */ });
  it("NU backfill-uieste sentinel pe fisier fresh (capcana runner)", () => { /* sha256_up != "__backfilled_v1__" */ });
  it("acelasi handle la apeluri repetate; handle diferit per owner", () => {});
  it("rnpmFileStem e injectiv pe case-insensitive FS si evita nume rezervate", () => {
    expect(rnpmFileStem("UserA")).not.toBe(rnpmFileStem("usera"));
    expect(rnpmFileStem("UserA").toLowerCase()).toBe(rnpmFileStem("UserA")); // stem-ul e deja lowercase
    expect(rnpmFileStem("CON").startsWith("con-")).toBe(true); // sufixul hash face numele portabil
  });
  it("respinge ownerId invalid (traversal, lungime)", () => { /* "../evil", "a/b", "x".repeat(65) => throw */ });
  it("refuza reopen dupa markRnpmShuttingDown", () => {});
  it("refuza orice acces in timpul unui restore al ownerului (latch)", () => {
    getRnpmDb("u1");
    beginRnpmRestore("u1");
    try {
      closeRnpmDb("u1");
      expect(() => getRnpmDb("u1")).toThrow(RnpmRestoreInProgressError);
      expect(() => getRnpmDb("u2")).not.toThrow(); // alti owneri neafectati
    } finally {
      endRnpmRestore("u1");
    }
    expect(() => getRnpmDb("u1")).not.toThrow();
  });
  it("esec la initializare => handle-ul e inchis, nu ramane orfan", () => {
    // forteaza esec: creeaza <stem>.db ca DIRECTOR (open pica) sau injecteaza un
    // MIGRATIONS_RNPM_DIR inexistent printr-un spy pe runner; asserteaza ca dupa
    // throw se poate re-incerca curat (fara EBUSY pe Windows la rm tmpdir).
  });
  it("openRnpmDbRaw NU provisioneaza: null pe fisier lipsa, readonly pe fisier existent", () => {});
  it("compactRnpmDb ruleaza VACUUM pe fisierul ownerului", () => {});
});
```

- [ ] **Step 2.2: Ruleaza — FAIL**, apoi **Step 2.3: Implementeaza `rnpmActivity.ts`:**

```ts
// Gard in-proces (v2.43.0): restore-ul inlocuieste fisierul RNPM al ownerului, deci
// nu are voie sa ruleze cat timp o cautare a ACELUIASI owner e in zbor — si invers,
// nicio operatie pe fisier nu are voie sa redeschida fisierul in timpul swap-ului
// (getRnpmDb consulta isRnpmRestoreInProgress). Erori cu cod MASINA pentru envelope.
const activeSearches = new Map<string, number>();
const restoring = new Set<string>();

export class RnpmSearchActiveError extends Error {
  readonly code = "SEARCH_ACTIVE";
  constructor() {
    super("Exista o cautare RNPM in curs pentru acest cont; operatia e refuzata pana se termina");
  }
}

export class RnpmRestoreInProgressError extends Error {
  readonly code = "RESTORE_IN_PROGRESS";
  constructor() {
    super("Restaurare in curs pentru acest cont; reincearca dupa finalizare");
  }
}

export function beginRnpmSearch(ownerId: string): void {
  if (restoring.has(ownerId)) throw new RnpmRestoreInProgressError();
  activeSearches.set(ownerId, (activeSearches.get(ownerId) ?? 0) + 1);
}

export function endRnpmSearch(ownerId: string): void {
  const n = (activeSearches.get(ownerId) ?? 0) - 1;
  if (n < 0) console.warn(`[rnpmActivity] endRnpmSearch fara begin pentru ${ownerId}`);
  if (n <= 0) activeSearches.delete(ownerId);
  else activeSearches.set(ownerId, n);
}

export function hasActiveRnpmSearch(ownerId: string): boolean {
  return (activeSearches.get(ownerId) ?? 0) > 0;
}

export function beginRnpmRestore(ownerId: string): void {
  if (hasActiveRnpmSearch(ownerId)) throw new RnpmSearchActiveError();
  restoring.add(ownerId);
}

export function endRnpmRestore(ownerId: string): void {
  restoring.delete(ownerId);
}

export function isRnpmRestoreInProgress(ownerId: string): boolean {
  return restoring.has(ownerId);
}

export function __resetRnpmActivityForTests(): void {
  activeSearches.clear();
  restoring.clear();
}
```

- [ ] **Step 2.4: Implementeaza `rnpmDb.ts`** (punctele care difera de un simplu registry):

```ts
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getDbPath } from "./schema.ts";
import { discoverMigrations, runMigrations } from "./migrations/runner.ts";
import { stripDiacritics } from "../util/textNormalize.ts";
import { isRnpmRestoreInProgress, RnpmRestoreInProgressError } from "./rnpmActivity.ts";

const __rnpmDir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_RNPM_DIR = path.join(__rnpmDir, "migrations-rnpm");

const OWNER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const handles = new Map<string, Database.Database>();
let shuttingDown = false;

export function assertValidOwnerId(ownerId: string): void {
  if (!OWNER_ID_RE.test(ownerId)) {
    throw new Error(`ownerId invalid pentru operatii pe fisiere: ${JSON.stringify(ownerId)}`);
  }
}

// Nume de fisier collision-safe: lowercase + hash scurt al ID-ului EXACT.
// Injectiv si pe filesystem-uri case-insensitive (Windows/macOS) si imun la
// numele rezervate Windows (CON, NUL, COM1...) datorita sufixului.
export function rnpmFileStem(ownerId: string): string {
  assertValidOwnerId(ownerId);
  const hash = createHash("sha256").update(ownerId, "utf8").digest("hex").slice(0, 10);
  return `${ownerId.toLowerCase()}-${hash}`;
}

export function getRnpmDataDir(): string {
  return path.join(path.dirname(getDbPath()), "rnpm");
}

export function getRnpmDbPath(ownerId: string): string {
  return path.join(getRnpmDataDir(), `${rnpmFileStem(ownerId)}.db`);
}

export function getRnpmBackupJail(ownerId: string): string {
  return path.join(path.dirname(getDbPath()), "backups", "rnpm", rnpmFileStem(ownerId));
}

export function registerRnpmNorm(db: Database.Database): void {
  db.function("rnpm_norm", { deterministic: true }, (s) => (s == null ? "" : stripDiacritics(String(s)).toLowerCase()));
}

export function getRnpmDb(ownerId: string): Database.Database {
  if (shuttingDown) throw new Error("RNPM DB closed; refusing to reopen during shutdown");
  assertValidOwnerId(ownerId);
  // Gardul de restore la NIVELUL DB layer-ului: acopera TOATE operatiile repository
  // (nu doar search) — fara el, un GET /stats in timpul swap-ului ar redeschide lazy
  // fisierul vechi (EBUSY pe Windows la rename; scrieri pierdute pe POSIX).
  if (isRnpmRestoreInProgress(ownerId)) throw new RnpmRestoreInProgressError();
  const existing = handles.get(ownerId);
  if (existing) return existing;

  const dbPath = getRnpmDbPath(ownerId);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // pre-migration backup per fisier cand exista migrations pending (paritate cu
  // schema.ts, dar SELF-CONTAINED: temp connection readonly + db.backup(dest) in
  // jail-ul ownerului, nume rnpm.pre-schema-upgrade-<stamp>.db) — vezi helperul
  // preRnpmMigrationBackup de mai jos in fisier.

  // Orice esec dupa open inchide handle-ul (altfel ramane lock nativ orfan pe
  // Windows care blocheaza retry-ul/rename-ul urmator).
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = NORMAL");
    db.pragma("busy_timeout = 5000");
    // WAL-truncate >32MB la deschidere (paritate schema.ts).
    registerRnpmNorm(db);
    const result = runMigrations(db, MIGRATIONS_RNPM_DIR);
    if (result.applied.length > 0) console.log(`[rnpmDb] ${ownerId}: applied migrations ${result.applied.join(", ")}`);
  } catch (e) {
    try {
      db.close();
    } catch {
      /* best-effort */
    }
    throw e;
  }
  handles.set(ownerId, db);
  return db;
}

// Handle temporar FARA provisioning si FARA registry — pentru backup-ul fisierelor
// userilor inactivi si pentru snapshot-ul pre-restore. Callerul inchide.
export function openRnpmDbRaw(ownerId: string): Database.Database | null {
  const dbPath = getRnpmDbPath(ownerId);
  if (!fs.existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}
```

`closeRnpmDb` / `closeAllRnpmDbs` / `markRnpmShuttingDown` / `__resetRnpmDbForTests` /
`checkpointRnpmWal` / `compactRnpmDb` — ca in Rev. 2 (registry inchis complet la shutdown,
compact per handle cu masurare before/after). `preRnpmMigrationBackup(ownerId, src, label)`:
deschide temp `{ readonly: true, fileMustExist: true }`, `db.backup(dest)` in jail (self-contained,
fara sidecars), close; best-effort cu warn (paritate cu schema.ts).

- [ ] **Step 2.5: Toate testele PASS + gate-uri + commit**

```bash
npx biome check --write backend/src/db/rnpmActivity.ts backend/src/db/rnpmActivity.test.ts backend/src/db/rnpmDb.ts backend/src/db/rnpmDb.test.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run build
npm run test:backend
git add backend/src/db/rnpmActivity.ts backend/src/db/rnpmActivity.test.ts backend/src/db/rnpmDb.ts backend/src/db/rnpmDb.test.ts
git commit -m "feat(rnpm-split): rnpmDb + rnpmActivity — registry per owner, stem collision-safe, latch restore in DB layer"
```

---

### Task 3: Splitter one-time `rnpmSplitter.ts` (modul + teste, FARA wiring)

**Files:**
- Create: `backend/src/db/rnpmSplitter.ts`
- Test: `backend/src/db/rnpmSplitter.test.ts`
- NU se atinge `index.ts` in acest task — wiring-ul se face ATOMIC cu rutarea repositories in
  Task 4 (altfel exista o fereastra de commit in care scrierile noi merg in fisiere per-user
  iar splitter-ul ulterior le-ar suprascrie din monolit — finding Sol HIGH).

**Interfaces:**
- Produces: `runRnpmSplitIfNeeded(opts?: { onPhase?: (phase: string, detail?: unknown) => void }): { split: boolean; owners: string[] }` — idempotent, fail-closed; `onPhase` e failpoint-hook pentru testele de crash.
- Marker durabil: `<dataDir>/rnpm/.split-done.json` — `{ status: "wiping" | "done", completedAt, owners, appVersion }`.

**Protocol crash-safe (incorporeaza CRITICAL-urile Sol):**
1. Daca marker `status="done"` exista SI monolitul are randuri rnpm => **ABORT boot** cu mesaj
   actionabil: inseamna ca cineva a restaurat un backup de monolit pre-split; splitter-ul NU
   suprascrie automat fisierele per-user mai noi. RUNBOOK descrie cele doua iesiri (re-split
   fortat cu stergerea explicita a fisierelor per-user + marker, SAU golirea randurilor rnpm din
   monolitul restaurat pentru a pastra fisierele per-user).
2. Daca marker `status="wiping"` exista => faza de wipe a fost intrerupta DUPA verificarea
   completa a tuturor ownerilor: reia DOAR wipe-ul (fisierele per-user sunt sursa de adevar).
3. Fara marker + randuri rnpm prezente => split normal (crash inainte de marker = monolitul e
   inca sursa de adevar; fisierele partiale se rescriu integral).
4. Ordinea: preflights -> pre-split backup STRICT -> copiere+verificare per owner -> scrie marker
   `wiping` (fsync pe fisier si pe director unde platforma permite) -> wipe monolit + verificare
   zero randuri -> marker `done` -> VACUUM best-effort.

- [ ] **Step 3.1: Teste failing** — seed monolit prin `getDb()` + INSERT-uri raw (2 owneri,
descriere PARTAJATA intre ei, `_norm` populate via conexiunea cu UDF):

```ts
it("muta datele fiecarui owner in fisierul lui (stem collision-safe), pastrand id-urile", ...)
// COUNT per tabela per owner identic; descrierea partajata exista in ambele fisiere cu id-ul
// original; monolitul are 0 randuri in TOATE cele 7 tabele rnpm_*; marker status=done exista;
// fisierele sunt <stem>.db, nu <ownerId>.db

it("este idempotent: al doilea apel nu face nimic (marker done + monolit gol)", ...)

it("crash INAINTE de marker (dupa owner 1 din 2): re-run reface totul din monolit", ...)
// foloseste onPhase pentru a arunca dupa "owner_done" #1; asserteaza ca monolitul e INTACT;
// re-run fara failpoint => ambii owneri coreecti, fisierul partial al lui owner1 suprascris curat

it("crash IN TIMPUL wipe-ului (marker wiping): re-run reia DOAR wipe-ul, nu re-copiaza", ...)
// onPhase arunca dupa "marker_wiping"; scrie apoi un rand nou in fisierul per-user al lui u1;
// re-run => monolit golit, randul nou al lui u1 SUPRAVIETUIESTE (dovada ca nu s-a re-copiat)

it("marker done + randuri rnpm reaparute in monolit (restore de monolit vechi) => ABORT boot", ...)
// re-seed monolit dupa split complet => runRnpmSplitIfNeeded() ARUNCA cu mesaj care pomeneste
// RUNBOOK; fisierele per-user raman neatinse

it("owner cu id invalid => abort inainte de orice mutare, monolit intact", ...)
it("spatiu insuficient (getFreeBytes injectat) => abort inainte de orice mutare", ...)
it("bresa FK in monolit => abort cu mesaj care numeste tabela", ...)
it("copil cu owner_id diferit de parinte => abort (consistenta owner parinte-copil)", ...)
// seed rnpm_creditori cu owner_id='B' pe un aviz al lui 'A' => throw, monolit intact
it("backup-ul pre-split esueaza (disc plin simulat pe calea de backup) => abort, monolit intact", ...)
it("ATTACH readonly refuza scrierile spre mono.*", ...)
// dupa ATTACH, un INSERT INTO mono.rnpm_searches trebuie sa arunce (test pe Windows real)
it("dupa split, un INSERT fara id explicit primeste id peste maximul istoric", ...)
// verifica preluarea sqlite_sequence (high-water), nu doar MAX(id) copiat
```

- [ ] **Step 3.2: Implementeaza `rnpmSplitter.ts`** — schelet cu punctele critice:

```ts
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getDb, getDbPath } from "./schema.ts";
import {
  assertValidOwnerId,
  getRnpmDataDir,
  getRnpmDbPath,
  registerRnpmNorm,
  MIGRATIONS_RNPM_DIR,
  closeRnpmDb,
} from "./rnpmDb.ts";
import { runMigrations } from "./migrations/runner.ts";

// Ordinea respecta dependintele FK la INSERT; descrierile se copiaza separat
// INAINTE de rnpm_bunuri (descriere_id).
const COPY_TABLES = ["rnpm_searches", "rnpm_avize", "rnpm_creditori", "rnpm_debitori", "rnpm_bunuri", "rnpm_istoric"] as const;
const ALL_RNPM_TABLES = [...COPY_TABLES, "rnpm_bunuri_descrieri"] as const;
const CHILD_TABLES = ["rnpm_creditori", "rnpm_debitori", "rnpm_bunuri", "rnpm_istoric"] as const;

function markerPath(): string {
  return path.join(getRnpmDataDir(), ".split-done.json");
}

// unlink care inghite DOAR ENOENT — EBUSY/EPERM/EACCES opresc split-ul inainte
// de open/rename (un tmp sau WAL vechi reutilizat = corupere) (finding Sol CRITICAL).
function unlinkStrict(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }
}

export function assertDiskSpaceForSplit(monoPath: string, getFreeBytes?: (dir: string) => number): void {
  // ca in Rev. 2 (statfsSync, prag 3x main+wal, mesaj actionabil, injectabil pentru teste)
}

function renameWithRetry(from: string, to: string): void {
  // ca in Rev. 2 (5 incercari, doar EPERM/EBUSY/EACCES, sleep sincron 200ms, log per incercare)
}

// Pre-split backup STRICT (fail-closed) — spre deosebire de preMigrationBackup
// (best-effort), aici backup-ul E rollback-ul promis: db.backup() self-contained,
// verificare existenta + size > 0 + PRAGMA integrity_check pe copie; ORICE esec
// opreste split-ul inainte de prima mutare (finding Sol HIGH).
function preSplitBackupStrict(mono: Database.Database): string {
  const dir = path.join(path.dirname(getDbPath()), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(dir, `legal-dashboard.pre-rnpm-split-${stamp}.db`);
  // better-sqlite3 db.backup e async (Promise) — foloseste varianta sincrona prin
  // VACUUM INTO (self-contained, atomic la nivel de fisier):
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
  return dest;
}
```

`runRnpmSplitIfNeeded(opts)` implementeaza protocolul crash-safe:

```ts
export function runRnpmSplitIfNeeded(opts?: { onPhase?: (phase: string, detail?: unknown) => void }): {
  split: boolean;
  owners: string[];
} {
  const onPhase = opts?.onPhase ?? (() => {});
  const mono = getDb();
  const pending = /* SUM COUNT peste TOATE cele 7 tabele ALL_RNPM_TABLES */;
  const marker = readMarker(); // null | { status, ... }

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
    // Toti ownerii au fost deja copiati si verificati; reia DOAR wipe-ul.
    wipeMonolithRnpm(mono);
    writeMarker({ status: "done", ... });
    return { split: true, owners: marker.owners };
  }
  if (pending === 0) {
    writeMarker({ status: "done", owners: [], ... }); // instalare fresh: marcheaza direct
    return { split: false, owners: [] };
  }

  // PREFLIGHTS (toate fail-closed, monolit intact):
  // 1. owners din searches UNION avize; assertValidOwnerId pe fiecare.
  // 2. PRAGMA foreign_key_check per tabela rnpm (mesaj cu tabela la violari).
  // 3. Consistenta owner parinte-copil (finding Sol HIGH) — pentru fiecare tabela copil:
  //    SELECT COUNT(*) FROM <copil> c JOIN rnpm_avize a ON c.aviz_id = a.id WHERE c.owner_id != a.owner_id
  //    si pentru avize vs searches:
  //    SELECT COUNT(*) FROM rnpm_avize a JOIN rnpm_searches s ON a.search_id = s.id WHERE a.owner_id != s.owner_id
  //    Orice count > 0 => abort cu tabela numita.
  // 4. assertDiskSpaceForSplit(getDbPath()).
  onPhase("preflight_ok");

  preSplitBackupStrict(mono);
  onPhase("backup_ok");

  for (const owner of owners) {
    closeRnpmDb(owner);
    const finalPath = getRnpmDbPath(owner);
    const tmpPath = `${finalPath}.split-tmp`;
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    for (const p of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) unlinkStrict(p);

    const target = new Database(tmpPath);
    try {
      // pragmas + registerRnpmNorm + runMigrations(target, MIGRATIONS_RNPM_DIR) — ORDINEA
      // runner-inainte-de-date e obligatorie (capcana sentinel din runner).
      // ATTACH READONLY prin URI PERCENT-ENCODAT (path-ul real contine spatii!):
      //   const monoUri = `file:${encodeURI(getDbPath().replace(/\\/g, "/"))}?mode=ro`;
      //   target.prepare("ATTACH DATABASE ? AS mono").run(monoUri);
      // FAIL-CLOSED: fara fallback read-write; la esec => throw cu mesaj actionabil.
      // Copiere: descrieri subset (WHERE EXISTS pe mono.rnpm_bunuri al ownerului, cu id-urile
      // originale) apoi COPY_TABLES in ordine, coloane enumerate din PRAGMA table_info,
      // WHERE owner_id = ?. Trigger-ele _norm recalculeaza aceleasi valori (UDF determinist).
      // sqlite_sequence: dupa copiere, pentru fiecare tabela preia high-water mark-ul sursei:
      //   INSERT INTO sqlite_sequence(name, seq) SELECT name, seq FROM mono.sqlite_sequence WHERE name = ?
      //     ON CONFLICT(name) DO UPDATE SET seq = MAX(seq, excluded.seq)
      // (id-urile sterse istoric peste MAX(id) nu se reemit — finding Sol MEDIUM).
      // Verificare: COUNT per tabela (mono WHERE owner vs target) + subsetul descrierilor +
      // PRAGMA integrity_check; DETACH; wal_checkpoint(TRUNCATE).
    } finally {
      target.close();
    }
    for (const suffix of ["-wal", "-shm"] as const) unlinkStrict(finalPath + suffix);
    renameWithRetry(tmpPath, finalPath);
    // Post-publish probe: redeschide finalPath readonly + integrity_check rapid
    // (rename reusit logic != fisier citibil; verificam inainte sa declaram owner_done).
    onPhase("owner_done", owner);
  }

  writeMarker({ status: "wiping", owners, ... }); // + fsync fisier si director (best-effort pe Windows)
  onPhase("marker_wiping");
  wipeMonolithRnpm(mono); // DELETE explicit pe toate 7 tabelele, copii->parinti->descrieri,
                          // apoi VERIFICA zero randuri in fiecare (throw daca nu)
  writeMarker({ status: "done", owners, ... });
  onPhase("marker_done");
  try {
    mono.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    mono.exec("VACUUM");
  } catch (e) {
    log({ stage: "vacuum_failed", reason: e instanceof Error ? e.message : String(e) });
  }
  return { split: true, owners };
}
```

NOTA `db.backup()` vs `VACUUM INTO`: better-sqlite3 `db.backup()` e asincron (Promise). In tot
acest plan, "snapshot self-contained" se implementeaza SINCRON cu `VACUUM INTO ?` (atomic,
include tot ce e comis, nu depinde de WAL) — foloseste-l consecvent si in Task 6.

- [ ] **Step 3.3: Toate testele PASS + gate-uri + commit**

```bash
npx biome check --write backend/src/db/rnpmSplitter.ts backend/src/db/rnpmSplitter.test.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run build
npm run test:backend
git add backend/src/db/rnpmSplitter.ts backend/src/db/rnpmSplitter.test.ts
git commit -m "feat(rnpm-split): splitter one-time cu marker durabil, preflights fail-closed si failpoints de test (nemontat)"
```

---

### Task 4: CUTOVER atomic — rutare repositories + wiring splitter la boot (UN SINGUR commit)

**Files:**
- Modify: `backend/src/db/avizRepository.ts` (11 call-sites `getDb()` + import + `checkpointWal`)
- Modify: `backend/src/db/searchRepository.ts` (5 call-sites + `getSearchOwnership`)
- Modify: `backend/src/services/rnpmSearchService.ts` (blocul ownership)
- Modify: `backend/src/index.ts` (wiring splitter + shutdown)
- Test: `backend/src/db/repository-isolation.test.ts` (rescriere semantica) + suitele rnpm afectate

**De ce atomic:** dupa acest commit, boot-ul MUTA datele in fisiere per-user si repos citesc DE
ACOLO. Orice ordine alternativa lasa un commit intermediar in care aplicatia scrie intr-un layout
si citeste din altul (finding Sol HIGH).

- [ ] **Step 4.1: Teste de izolare rescrise (red)** — ca in Rev. 2: doua fisiere separate pe disc
(cu `rnpmFileStem`!), fisierul lui A nu contine randuri ale lui B, `getSearchOwnership` fara starea
`foreign`, teardown cu `__resetRnpmDbForTests()`.

- [ ] **Step 4.2: Rutare `avizRepository.ts`** — importul devine
`import { checkpointRnpmWal, getRnpmDb } from "./rnpmDb.ts";`; cele 11 call-sites
(`saveAvizFull`~155 via `input.ownerId`; `getAvizById`~344, `getAvizByIdentificator`~354,
`getAvize`~429, `deleteAviz`~534, `deleteAllAvize`~547, `deleteAvizeByIds`~563, `getAvizStats`~586,
`getAvizeByIds`~609, `filterRnpmSearchResults`~708 via parametrul/`opts.ownerId`;
`loadAvizChildren`~362 via `aviz.owner_id`); `checkpointWal()` -> `checkpointRnpmWal(ownerId)` (3 apeluri);
`cleanupOrphanDescrieri(db: Database.Database)` (tip din better-sqlite3, nu `ReturnType<typeof getDb>`).

- [ ] **Step 4.3: Rutare `searchRepository.ts` + contract ownership** — ca in Rev. 2:
`getSearchOwnership` devine owned/missing cu query owner-scoped pe `getRnpmDb(ownerId)`;
descoperirea consumatorilor DUPA SIMBOL (`grep -rn "getSearchOwnership\|searchBelongsToOwner\|SearchOwnership" backend/src frontend/src`
plus `grep -rn "\"foreign\"\|'foreign'" backend/src`); blocul din `rnpmSearchService.ts` (~109-128)
pastreaza doar branch-ul missing (drop existingSearchId/gcode/startRnpmPage).
LIMITARE DOCUMENTATA (accepta, nu "repara"): dupa un restore, un searchId cache-uit in alt tab
poate coincide cu un id realocat propriu — UI-ul reseteaza starea la restore (onRestored ->
onAfterDeleteAll), iar restore-ul refuza cautari active; nota in spec, fara fingerprint in v1.

- [ ] **Step 4.4: Wiring in `index.ts`** — DUPA TOATE validarile fatale de configuratie
(`acquireInstanceLock`, `validateAuthConfig` si orice alt gate `fatalBoot` de configuratie
existent — cauta toate apelurile `fatalBoot(` si plaseaza-l dupa ULTIMUL gate de config, inainte
de prewarm/scheduler/serve):

```ts
try {
  const splitResult = runRnpmSplitIfNeeded();
  if (splitResult.split) console.log(`[boot] rnpm split complet: ${splitResult.owners.length} owneri`);
} catch (e) {
  fatalBoot("rnpm split failed", e);
}
```

In `gracefulShutdown`, INAINTE de `markShuttingDown()`: `markRnpmShuttingDown()` in try/catch.

- [ ] **Step 4.5: Triaj + reparare suite** — ca in Rev. 2 (doua categorii: API-public vs
raw-`new Database(dbPath)`), cu completarile: testele chain-ului monolitic (0021, downMigrations)
NU se repointeaza; lista suitelor din Rev. 2 nu e garantat completa —
`grep -l "LEGAL_DASHBOARD_DB_PATH\|new Database(" backend/src/**/*.test.ts` si verifica fiecare
hit care atinge tabele rnpm. Nu slabi asertii.

- [ ] **Step 4.6: Gate-uri + commit** (enumera fisierele exact, fara `git add -A`):

```bash
npx biome check --write backend/src/db/avizRepository.ts backend/src/db/searchRepository.ts backend/src/services/rnpmSearchService.ts backend/src/index.ts backend/src/db/repository-isolation.test.ts <suitele adaptate, enumerate>
npx tsc --noEmit -p backend/tsconfig.json
npm run build
npm run test:backend
git add <aceleasi fisiere enumerate>
git commit -m "feat(rnpm-split): CUTOVER — repositories pe fisiere per user + splitter montat la boot"
```

---

### Task 5: Bracketing activitate in service + garduri pre-SSE in rute

**Files:**
- Modify: `backend/src/services/rnpmSearchService.ts` (bracket begin/end in executeSearch / executeBulkSearch / executeSplitSearch)
- Modify: `backend/src/routes/rnpm.ts` (gard pre-SSE) + `backend/src/index.ts` (mapare centrala erori)
- Test: extinde `backend/src/db/rnpmActivity.test.ts` + teste route-level noi in `backend/src/routes/rnpm.split-route.test.ts`

- [ ] **Step 5.1:** In cele 3 functii de search: imediat dupa ce `ownerId` e disponibil,
`beginRnpmSearch(ownerId)` + `try { ... } finally { endRnpmSearch(ownerId); }`.
- [ ] **Step 5.2 (finding Sol):** Gardul trebuie sa loveasca INAINTE de a porni stream-ul SSE —
un throw dupa `streamSSE` a inceput inseamna 200 deja trimis si eroare in mijlocul stream-ului.
In rutele `/search`, `/bulk`, `/search-split` din `rnpm.ts`, PRIMUL lucru dupa parsarea
body-ului: `if (isRnpmRestoreInProgress(getOwnerId(c))) return c.json(fail("RESTORE_IN_PROGRESS", ..., c), 409);`.
- [ ] **Step 5.3:** Mapare centrala: in error-handler-ul global din `index.ts` (sau `app.onError`
existent), mapeaza `RnpmRestoreInProgressError` si `RnpmSearchActiveError` (dupa proprietatea
`code`) la envelope 409 — plasa de siguranta pentru orice cale care arunca din repository layer
(inclusiv `getRnpmDb` latch).
- [ ] **Step 5.4:** Teste route-level: cele 3 endpoint-uri raspund 409 `RESTORE_IN_PROGRESS`
(envelope complet, nu 500) cand restore-ul ownerului e activ; un GET (`/stats`) in timpul
restore-ului raspunde tot 409 prin maparea centrala. Gate-uri (lista explicita de fisiere) + commit
`feat(rnpm-split): bracketing activitate + garduri pre-SSE + mapare centrala 409`.

---

### Task 6: Backup multi-target — generalizarea `backup.ts`

**Files:**
- Modify: `backend/src/db/backup.ts`, `backend/src/db/schema.ts` (preMigrationBackup self-contained), `backend/src/index.ts` (await backup la shutdown)
- Test: `backend/src/db/backup.test.ts` (extindere) + `backend/src/db/rnpmBackup.test.ts` (nou) + `backend/src/db/rnpmFullFlow.test.ts` (nou)

**Interfaces (Produces — consumate de Task 7):** ca in Rev. 2 (monolit: `listBackupsWithMeta` /
`restoreFromBackup` / `deleteAllBackups` / `createManualBackup` NOU; per user: `getRnpmBackupDir(ownerId)`
= `getRnpmBackupJail`, `listRnpmBackups`, `createRnpmManualBackup`, `restoreRnpmFromBackup`,
`deleteRnpmBackups`), cu urmatoarele DECIZII revizuite:

1. **Toate snapshot-urile noi sunt self-contained** prin `VACUUM INTO` (sincron; vezi nota Task 3):
   daily, manual, pre-restore, pre-migration (si cel din `schema.ts` pentru monolit — inlocuieste
   copyFile+sidecars cu temp-connection + `VACUUM INTO`; scoate copierea sidecar-urilor).
2. **Contract handle:** in loc de `openForBackup()` ambiguu, foloseste callback:
   `withBackupConnection(target, fn)` — main: ruleaza fn(getDb()) fara close; rnpm: deschide prin
   `openRnpmDbRaw(ownerId)` (readonly, fileMustExist — zero TOCTOU de creare fisier gol), close in
   finally, si SKIP cu log daca fisierul nu exista.
3. **Restore compatibil cu backup-urile legacy** (facute inainte de v2.43.0, cu sidecars):
   `restoreTargetImpl` copiaza ca BUNDLE — daca langa `<name>.db` exista `<name>.db-wal`/`-shm`,
   se copiaza si ele (snapshot-ul legacy e coerent doar ca triplet); backup-urile noi nu au sidecars.
   Prune/delete sterg si sidecar-urile ca bundle (fara orfani permanenti in jail).
4. **Pre-restore snapshot** prin `VACUUM INTO` de pe handle-ul viu (sau `openRnpmDbRaw` daca nu e
   in registry), VERIFICAT (size>0 + integrity_check), INAINTE de close/unlink/swap. Fail => abort
   restore cu fisierul viu neatins.
5. **Auto-revert fail-safe**: revert-ul se face prin copie in `.revert-tmp` + `renameWithRetry`
   (nu copyFile direct peste fisierul viu); esecul de unlink pe sidecars in revert e THROW
   (fail-closed), nu doar log.
6. **Validare de versiune la restore RNPM**: inainte de swap, deschide backup-ul readonly si
   compara `MAX(version)` din `_schema_versions` cu max-ul din `discoverMigrations(MIGRATIONS_RNPM_DIR)`;
   backup dintr-o versiune mai NOUA => reject cu mesaj clar (altfel urmatorul `getRnpmDb` pica pe
   anti-downgrade-ul runner-ului si fisierul ramane blocat).
7. **Restore per user** = `withMaintenanceWrite` -> `beginRnpmRestore(ownerId)` (throw
   `SEARCH_ACTIVE` daca are cautare activa) in try/finally -> validare nume (regex cu prefix
   ESCAPAT + `path.resolve` jail check) -> validare versiune -> pre-restore snapshot verificat ->
   `closeRnpmDb(ownerId)` -> unlink sidecars live (`unlinkStrict`) -> copy bundle la `.restore.tmp`
   + rename -> integrity_check -> auto-revert la esec. Latch-ul din `getRnpmDb` (Task 2) tine
   restul operatiilor ownerului afara pe toata durata.
8. **`createRnpmManualBackup(ownerId)`**: daca fisierul nu exista inca, PROVISIONEAZA prin
   `getRnpmDb(ownerId)` (un user nou primeste un backup valid al bazei goale — decizie explicita);
   apoi `VACUUM INTO` in jail cu nume `rnpm.manual-<stamp>.db`, pool `manual` cu retentie 5.
9. **Daily backup**: enumerare DE PE DISC a stem-urilor (`fs.readdir(getRnpmDataDir())`, filtru
   `\.db$`), FARA provisioning; ELIMINA early-return-ul global de freshness (`latestBackupMtime`)
   si inlocuieste-l cu freshness PER TARGET (finding Sol: main fresh nu are voie sa sara peste
   targeturile rnpm noi/stale); totul intr-o singura fereastra `withMaintenanceWrite`, DAR
   **offsite hook-urile ruleaza DUPA eliberarea lock-ului** (aduna lista de fisiere proaspete sub
   lock, upload-urile afara — altfel N useri x 10 min timeout blocheaza toate scrierile).
10. **Shutdown**: pastreaza promise-ul backup-ului in curs intr-o variabila de modul;
   `gracefulShutdown` il asteapta cu timeout (10s) inainte de `markRnpmShuttingDown`/`markShuttingDown`.
11. **Retentie**: 4 pool-uri disjuncte per target (daily/pre-restore/pre-migration/manual), regex
   cu `escapeRegExp(prefix)`, ancorate `^...\.db$`, label-uri cu puncte acceptate (`[^\\/]+`);
   teste adversariale ca pool-urile nu se fura reciproc si ca prune curata bundle-ul.

- [ ] **Step 6.1: Teste failing** — cazurile din Rev. 2 (manual/restore/jail/race/daily/retentie/
full-flow) PLUS: restore de backup legacy cu sidecars (datele din WAL supravietuiesc — seed un
backup .db+.db-wal construit manual); restore de backup cu versiune de schema mai noua => reject;
manual backup pentru user fara fisier => provisioneaza si reuseste; daily: main fresh dar rnpm
fara backup => rnpm primeste backup (early-return-ul global eliminat); prune sterge bundle-ul.
- [ ] **Step 6.2: Implementare** conform deciziilor 1-11.
- [ ] **Step 6.3: PASS + suita integrala + gate-uri + commit** (fisiere enumerate explicit):
`feat(rnpm-split): backup multi-target — snapshot-uri self-contained, restore bundle-aware, offsite in afara lock-ului`.

---

### Task 7: Rute — self-service RNPM owner-scoped + router admin pentru monolit

**Files:**
- Modify: `backend/src/routes/rnpm.ts`; Create: `backend/src/routes/adminBackups.ts`; Modify: `backend/src/index.ts` (mount)
- Test: `backend/src/routes/rnpmBackups.contract.test.ts` (nou) + `backend/src/routes/adminBackups.test.ts` (nou)

**Contract (toate mutatiile pastreaza `requireDesktopHeader`; self-service = `requireRole("admin", "user")`):**
- `GET /api/rnpm/backups` -> `{ backups }` din jail-ul callerului; admin poate `?ownerId=`.
- `POST /api/rnpm/backups/create` -> `{ ok, name }`; audit `backup.rnpm.create`; **cooldown 60s per
  owner** (finding Sol: create = maintenance lock + VACUUM INTO + offsite => abuzabil; pattern-ul
  de cooldown exista deja pe `/email-settings/test` — 429 cu `Retry-After`).
- `POST /api/rnpm/backups/restore` body `{ name }` (admin: `{ name, ownerId }`) -> `{ ok, preRestoreName }`;
  409 `SEARCH_ACTIVE`; erorile de VALIDARE (nume invalid, iesire din jail, versiune mai noua) sunt
  **400 `INVALID_PARAMS`**, nu 500 (finding Sol: 500 pe input invalid ascunde clasificarea si
  polueaza alerting-ul); audit succes + eroare.
- `DELETE /api/rnpm/backups` -> `{ deleted }` doar jail-ul propriu; audit.
- `GET /stats`, `POST /compact`, `DELETE /saved/all` — pe fisierul callerului
  (`getRnpmDbPath`/`compactRnpmDb`); guard `requireDesktopHeader, requireRole("admin", "user")`.
  **`DELETE /saved/all` si `POST /saved/delete-batch` primesc gardul SEARCH_ACTIVE** (finding Sol:
  delete in timpul unei cautari active => FK errors sau repopulare imediat dupa stergere):
  `if (hasActiveRnpmSearch(owner)) return c.json(fail("SEARCH_ACTIVE", ..., c), 409);`.
- `open-db-folder`/`open-backups-folder` — desktop-only, pe fisierul/jail-ul userului local.
- `resolveBackupOwner(c, requested)` ca in Rev. 2 (sursa parametrizata query/body; non-admin:
  cererea straina se IGNORA silentios; admin: `assertValidOwnerId(requested)` inainte de folosire;
  verifica accessorul de rol din `requireRole.ts` inainte de `c.get("role")`).
- `/api/admin/backups` (monolit, `requireRole("admin")`): `GET /`, `POST /create` (audit
  `backup.create`), `POST /restore` (`requireDesktopHeader` + `limitSmall`; audit `backup.restore`),
  `DELETE /` (`requireDesktopHeader`; audit `backup.delete_all`). Rutele vechi de monolit din
  rnpm.ts se elimina. **RUNBOOK (Task 9) documenteaza interactiunea restore-monolit + marker split.**

- [ ] **Step 7.1: Teste failing (contract)** — cazurile din Rev. 2 PLUS: non-admin cu body
`{ name, ownerId: "u2" }` la restore => opereaza pe fisierul PROPRIU si fisierul lui u2 ramane
byte-identic (vectorul din body, nu doar query — finding Sol); admin targeting pozitiv cu audit
`targetOwnerId`; nume invalid / traversal => 400 `INVALID_PARAMS` (nu 500); cooldown create =>
429 cu `Retry-After`; delete-all cu search activ => 409 `SEARCH_ACTIVE`.
- [ ] **Step 7.2: Implementare** conform contractului. **Step 7.3:** `adminBackups.ts` + mount.
- [ ] **Step 7.4: PASS + gate-uri + commit** (fisiere enumerate):
`feat(rnpm-split): rute backup self-service cu cooldown si clasificare erori + /api/admin/backups`.

---

### Task 8: Frontend — "Baza mea RNPM" + tab Setari "Backup"

Identic cu Rev. 2 (rnpmApi `rnpmCreateBackup`, `adminBackupsApi.ts`, copy nou pe
`RnpmSavedStats`/`RnpmRestoreModal`, `pages/admin/Backups.tsx` embedded + tab in `Settings.tsx`,
teste), cu completarile:
- Trateaza si 429 (cooldown) pe butonul "Creeaza backup acum" — mesajul din envelope se afiseaza
  ca eroare temporara, butonul ramane activ.
- Dupa restore reusit, verifica in test ca `onRestored` -> `onAfterDeleteAll` reseteaza starea
  cautarii (protectia UI pentru searchId-uri cache-uite — limitarea documentata din Task 4.3).
- Gate-uri frontend complete + `npm run build` + commit.

---

### Task 9: Documentatie + bump v2.43.0

Ca in Rev. 2 (RUNBOOK / SECURITY / DEPLOY-SERVER / CLAUDE.md / checklist bump), cu sectiuni
RUNBOOK suplimentare (findings Sol):
- **"Monolit restaurat dupa split"**: ce inseamna abort-ul de boot cu marker `done` + randuri rnpm;
  cele doua cai de remediere (re-split fortat: sterge fisierele per-user + marker-ul, reporneste;
  SAU pastreaza fisierele per-user: goleste randurile rnpm din monolitul restaurat cu SQL-ul dat).
- **"Owner invalid la split"**: ce faci daca boot-ul aborteaza pe `ownerId invalid` (fixezi manual
  randul din users/owner_id in monolit; split-ul nu a mutat nimic).
- **Igiena fisiere orfane** (soft-delete de cont => fisierele raman pentru reactivare; ID-urile nu
  se reutilizeaza pentru ca randul users ramane; procedura de curatare definitiva manuala).
- **Offsite**: acum N+1 fisiere/noapte; upload-urile ruleaza dupa fereastra de maintenance.

---

### Task 10: Verificare finala end-to-end

Ca in Rev. 2 (npm run check + build + rebuild:electron + smoke desktop cu split real + smoke web
cu doi useri), plus:
- **Smoke pe bundle**: dupa `npm run build`, porneste backend-ul din `dist-backend` (sau
  `npm run electron:dev` care il foloseste) si verifica in log ca `migrations-rnpm` s-a gasit
  (provisioning-ul unui user nou functioneaza din bundle, nu doar din surse).
- Smoke desktop include: restore de backup LEGACY (pre-v2.43.0, daca exista pe masina) si
  verificarea ca marker-ul `.split-done.json` exista si boot-ul urmator nu re-splituieste.
- Raport final fara push; push doar la cererea userului.

---

## Istoric review

- **Rev. 1** (468b744): planul initial.
- **Rev. 2** (06a9c48): fixuri din review-panel multi-model (Opus 4.8 + Kimi K2.7 + GLM-5.2 +
  DeepSeek V4, sinteza Fable 5): preflight disc, pastrarea requireDesktopHeader (CSRF desktop),
  ATTACH fail-closed, probe split 6 tabele, foreign_key_check, retry rename, VACUUM negardat,
  wipe explicit, cod RESTORE_IN_PROGRESS, resolveBackupOwner, jail path.resolve, regex escapate,
  cap ownerId, checkpoint pre-migration, descoperire pe simbol, triaj teste, full-flow test.
  Findings respinse cu motivare: renameSync EEXIST pe Windows (fals — MOVEFILE_REPLACE_EXISTING),
  endRnpmSearch throw pe underflow (tolerarea e deliberata), closeAllRnpmDbs in fatalBoot (speculativ).
- **Rev. 3** (acest fisier): fixuri din review-ul GPT-5.6 Sol (2 CRITICAL + HIGH-uri noi):
  `rnpmFileStem` collision-safe (case-insensitive FS + nume rezervate Windows), marker durabil
  `.split-done.json` cu protocol crash-safe in 2 faze si ABORT pe monolit restaurat post-split,
  cutover atomic (splitter nemontat pana la commit-ul de rutare repos), consistenta owner
  parinte-copil la preflight, URI ATTACH percent-encodat (path-ul real contine spatii),
  snapshot-uri self-contained prin VACUUM INTO peste tot (inclusiv preMigrationBackup monolit),
  pre-split backup STRICT verificat, unlinkStrict (doar ENOENT), latch restore in getRnpmDb
  (acopera toate operatiile, nu doar search), gard pre-SSE la nivel de ruta + mapare centrala 409,
  validare versiune schema la restore, restore bundle-aware pentru backup-uri legacy, auto-revert
  prin temp+rename, freshness per target (eliminat early-return-ul global), offsite in afara
  lock-ului, await backup la shutdown, cooldown pe backup manual, erori de validare = 400 (nu 500),
  gard SEARCH_ACTIVE pe delete-all/delete-batch, teste de crash cu failpoints (onPhase), test
  echivalenta structurala baseline vs monolit, sqlite_sequence high-water, build gate per commit,
  biome/git add chirurgicale, teste chain monolit pastrate. Acceptat ca limitare documentata (nu
  se implementeaza in v1): fingerprint pe searchId dupa restore (UI-ul reseteaza starea; restore
  refuza cautari active).
