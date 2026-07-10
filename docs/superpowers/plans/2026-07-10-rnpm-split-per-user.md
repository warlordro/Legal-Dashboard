# RNPM Split Per User — Plan de Implementare (v2.43.0)

> **Pentru agentul executant:** acest plan implementeaza spec-ul aprobat
> `docs/superpowers/specs/2026-07-10-rnpm-split-per-user-design.md`. Citeste spec-ul INTAI.
> Task-urile se executa IN ORDINE, cu checkbox-uri (`- [ ]`) pentru tracking. Fiecare task
> se incheie cu gate-uri verzi + commit. NU sari peste pasii de test (TDD: red inainte de green).

**Goal:** separarea fizica a datelor RNPM per utilizator — fiecare user primeste fisierul lui
SQLite `rnpm/<ownerId>.db` cu backup/restore self-service, iar baza unica (monolitul) pastreaza
tot restul (users, auth, quota, monitoring, audit, fx_rates).

**Arhitectura:** un registry de handle-uri better-sqlite3 per owner cu provisioning lazy prin
runner-ul de migrations existent; un splitter one-time la boot care muta datele RNPM din monolit
in fisierele per-user pastrand ID-urile originale; backup.ts generalizat pe "targets" (monolit +
N fisiere rnpm); rute self-service owner-scoped + router admin nou pentru monolit.

**Tech stack:** Node 22, Hono, better-sqlite3 (sincron), Vitest, React 18 + Vite, esbuild (backend bundlat CJS).

## Constrangeri globale (se aplica fiecarui task)

- Limba UI/mesaje: romana FARA diacritice in cod sursa (constrangere legacy a proiectului).
- Erorile HTTP folosesc envelope-ul standard: `fail(code, message, c)` din `backend/src/util/envelope.ts` (shape `{ data, error: { code, message }, requestId }`).
- SQL raw DOAR in `backend/src/db/**` (repository-only access).
- Backend-ul e bundlat CJS de esbuild: `import.meta.url` nu functioneaza in CJS — foloseste pattern-ul existent `typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url))`.
- Gate-uri INAINTE de fiecare commit (toate verzi, altfel nu comiti):
  1. `npx biome check --write <fisierele atinse>` (re-stage ce reformateaza)
  2. `npx tsc --noEmit -p backend/tsconfig.json`
  3. `cd frontend && npx tsc --noEmit` (doar daca ai atins frontend)
  4. `npm run test:backend` (sau suite tinta cu `npx vitest run <path> --root backend` in timpul TDD; suite completa inainte de commit)
  5. `cd frontend && npm test -- --run` (doar daca ai atins frontend)
- Dupa teste Node care ating better-sqlite3, inainte de orice smoke Electron: `npm run rebuild:electron`.
- Branch: `feat/v2.43.0-rnpm-split` (stacked pe `feat/v2.42.0-users-settings`). NU comite nimic pe `feat/v2.42.0-users-settings` si nimic pe `main`. NU face push fara cerere explicita a userului.
- NU redenumi/reformata cod neatins de task (schimbari chirurgicale).
- `ownerId` e validat `^[A-Za-z0-9_-]+$` inainte de ORICE folosire intr-un path de fisier.
- Mesaje commit: prefix conventional (`feat:`, `fix:`, `test:`, `docs:`) + descriere in romana.

---

### Task 1: Migration baseline consolidata `migrations-rnpm/0001`

**Files:**
- Create: `backend/src/db/migrations-rnpm/0001_rnpm_baseline.up.sql`
- Create: `backend/src/db/migrations-rnpm/0001_rnpm_baseline.down.sql`
- Modify: `scripts/build.js` (copierea directorului in dist-backend)
- Test: `backend/src/db/rnpmDb.test.ts` (partial — testul de baseline; fisierul creste in Task 2)

**Interfaces:**
- Produces: directorul `migrations-rnpm/` consumat de `runMigrations(db, MIGRATIONS_RNPM_DIR)` in Task 2.
- Baseline-ul = forma FINALA consolidata a tabelelor rnpm din monolit: schema din `migrations/0001_baseline.up.sql` (doar tabelele rnpm) + coloanele `_norm` din `0022` incluse INLINE in CREATE TABLE + indexul din `0021` + trigger-ele din `0022` verbatim.

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

In `scripts/build.js`, imediat DUPA blocul existent care copiaza `migrations/` (liniile ~52-53:
`mkdirSync(resolve(root, "dist-backend", "migrations"), ...)` + `cpSync(...)`), adauga:

```js
mkdirSync(resolve(root, "dist-backend", "migrations-rnpm"), { recursive: true });
cpSync(resolve(root, "backend", "src", "db", "migrations-rnpm"), resolve(root, "dist-backend", "migrations-rnpm"), {
  recursive: true,
});
```

- [ ] **Step 1.4: Test failing — baseline-ul se aplica pe un DB fresh cu UDF inregistrat**

Creeaza `backend/src/db/rnpmDb.test.ts`:

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

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpmdb-"));
});

afterEach(async () => {
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("migrations-rnpm baseline", () => {
  it("aplica baseline-ul pe un fisier fresh si trigger-ele populeaza _norm", () => {
    const db = new Database(path.join(tmpRoot, "u1.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.function("rnpm_norm", { deterministic: true }, (s) =>
      s == null ? "" : stripDiacritics(String(s)).toLowerCase()
    );
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
    db.close();
  });
});
```

- [ ] **Step 1.5: Ruleaza testul — trebuie sa PICE**

Run: `npx vitest run src/db/rnpmDb.test.ts --root backend`
Expected: FAIL — directorul `migrations-rnpm` nu exista inca / dupa Step 1.1-1.2 trebuie sa TREACA.
(Daca ai scris SQL-ul inainte de test, ruleaza testul si confirma PASS — ordinea red/green aici e
acceptabil inversata pentru fisiere pur-SQL.)

- [ ] **Step 1.6: Gate-uri + commit**

```bash
npx biome check --write backend/src/db/rnpmDb.test.ts scripts/build.js
npx tsc --noEmit -p backend/tsconfig.json
npx vitest run src/db/rnpmDb.test.ts --root backend
git add backend/src/db/migrations-rnpm scripts/build.js backend/src/db/rnpmDb.test.ts
git commit -m "feat(rnpm-split): baseline consolidat migrations-rnpm/0001 + copiere in build"
```

---

### Task 2: DB layer per user — `rnpmDb.ts`

**Files:**
- Create: `backend/src/db/rnpmDb.ts`
- Test: `backend/src/db/rnpmDb.test.ts` (extinde fisierul din Task 1)

**Interfaces (Produces — consumate de Task 3-7):**
- `getRnpmDataDir(): string` — `<dirname(getDbPath())>/rnpm`
- `getRnpmDbPath(ownerId: string): string`
- `getRnpmDb(ownerId: string): Database.Database` — lazy open + provisioning
- `closeRnpmDb(ownerId: string): void`, `closeAllRnpmDbs(): void`, `markRnpmShuttingDown(): void`, `__resetRnpmDbForTests(): void`
- `checkpointRnpmWal(ownerId: string): void`
- `compactRnpmDb(ownerId: string): { beforeBytes: number; afterBytes: number; durationMs: number }`
- `registerRnpmNorm(db: Database.Database): void`
- `assertValidOwnerId(ownerId: string): void`
- `MIGRATIONS_RNPM_DIR: string`

- [ ] **Step 2.1: Teste failing (extinde rnpmDb.test.ts)**

Adauga in `backend/src/db/rnpmDb.test.ts` (importa acum din `./rnpmDb.ts`):

```ts
import {
  __resetRnpmDbForTests,
  assertValidOwnerId,
  closeAllRnpmDbs,
  compactRnpmDb,
  getRnpmDb,
  getRnpmDbPath,
  markRnpmShuttingDown,
} from "./rnpmDb.ts";
```

si suite-ul (in acelasi fisier; seteaza `process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db")`
in `beforeEach` si curata env + `__resetRnpmDbForTests()` in `afterEach`):

```ts
describe("getRnpmDb", () => {
  it("provisioneaza lazy fisierul per owner cu baseline-ul aplicat", () => {
    const db = getRnpmDb("u1");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rnpm_%' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual([
      "rnpm_avize",
      "rnpm_bunuri",
      "rnpm_bunuri_descrieri",
      "rnpm_creditori",
      "rnpm_debitori",
      "rnpm_istoric",
      "rnpm_searches",
    ]);
    const version = db.prepare("SELECT MAX(version) AS v FROM _schema_versions").get() as { v: number };
    expect(version.v).toBe(1);
  });

  it("NU backfill-uieste sentinel pe fisier fresh (capcana runner.ts:126-148)", () => {
    getRnpmDb("u1");
    const raw = new Database(getRnpmDbPath("u1"), { readonly: true });
    const row = raw.prepare("SELECT sha256_up FROM _schema_versions WHERE version = 1").get() as {
      sha256_up: string;
    };
    raw.close();
    expect(row.sha256_up).not.toBe("__backfilled_v1__");
  });

  it("returneaza acelasi handle la apeluri repetate si handle diferit per owner", () => {
    const a1 = getRnpmDb("u1");
    const a2 = getRnpmDb("u1");
    const b = getRnpmDb("u2");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("respinge ownerId invalid pentru path (traversal)", () => {
    expect(() => getRnpmDb("../evil")).toThrow();
    expect(() => assertValidOwnerId("a/b")).toThrow();
    expect(() => assertValidOwnerId("ok_user-1")).not.toThrow();
  });

  it("refuza reopen dupa markRnpmShuttingDown", () => {
    getRnpmDb("u1");
    markRnpmShuttingDown();
    expect(() => getRnpmDb("u1")).toThrow(/shutdown/i);
  });

  it("compactRnpmDb ruleaza VACUUM pe fisierul ownerului si intoarce dimensiuni", () => {
    getRnpmDb("u1");
    const res = compactRnpmDb("u1");
    expect(res.beforeBytes).toBeGreaterThan(0);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2.2: Ruleaza testele — FAIL** (`rnpmDb.ts` nu exista)

Run: `npx vitest run src/db/rnpmDb.test.ts --root backend` — Expected: FAIL (cannot resolve `./rnpmDb.ts`).

- [ ] **Step 2.3: Implementeaza `backend/src/db/rnpmDb.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getDbPath } from "./schema.ts";
import { discoverMigrations, runMigrations } from "./migrations/runner.ts";
import { stripDiacritics } from "../util/textNormalize.ts";

// Fisier SQLite separat per utilizator pentru modulul RNPM (v2.43.0, spec
// 2026-07-10-rnpm-split-per-user-design.md). Monolitul (schema.ts) pastreaza
// tot ce NU e RNPM; aici traieste registry-ul de handle-uri per owner.

const __rnpmDir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_RNPM_DIR = path.join(__rnpmDir, "migrations-rnpm");

// Acelasi charset ca id-urile de useri; orice altceva e refuzat INAINTE sa
// atinga un path de fisier (anti path-traversal, fail-closed).
const OWNER_ID_RE = /^[A-Za-z0-9_-]+$/;

const handles = new Map<string, Database.Database>();
let shuttingDown = false;

export function assertValidOwnerId(ownerId: string): void {
  if (!OWNER_ID_RE.test(ownerId)) {
    throw new Error(`ownerId invalid pentru operatii pe fisiere: ${JSON.stringify(ownerId)}`);
  }
}

export function getRnpmDataDir(): string {
  return path.join(path.dirname(getDbPath()), "rnpm");
}

export function getRnpmDbPath(ownerId: string): string {
  assertValidOwnerId(ownerId);
  return path.join(getRnpmDataDir(), `${ownerId}.db`);
}

// UDF-ul de normalizare (diacritice + lowercase) — identic cu cel din schema.ts.
// Trigger-ele din migrations-rnpm/0001 il apeleaza, deci TREBUIE inregistrat pe
// orice conexiune INAINTE de runMigrations sau de scrieri.
export function registerRnpmNorm(db: Database.Database): void {
  db.function("rnpm_norm", { deterministic: true }, (s) => (s == null ? "" : stripDiacritics(String(s)).toLowerCase()));
}

// Paritate cu hasPendingSchemaMigrations din schema.ts, dar pe chain-ul rnpm.
// Fail-closed: orice eroare de probe => "ar putea avea pending" => backup.
function hasPendingRnpmMigrations(dbPath: string): boolean {
  try {
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const hasVersionsTable = probe
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_versions'`)
        .get();
      const files = discoverMigrations(MIGRATIONS_RNPM_DIR);
      if (!hasVersionsTable) return files.length > 0;
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

// Snapshot pre-migration per fisier user, in jail-ul lui de backups
// (backups/rnpm/<ownerId>/rnpm.pre-<label>-<stamp>.db). Best-effort, ca in schema.ts.
function preRnpmMigrationBackup(ownerId: string, src: string, label: string): void {
  try {
    const dir = path.join(path.dirname(getDbPath()), "backups", "rnpm", ownerId);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = path.join(dir, `rnpm.pre-${label}-${stamp}.db`);
    fs.copyFileSync(src, dest);
    for (const suffix of ["-wal", "-shm"] as const) {
      const sidecarSrc = src + suffix;
      if (fs.existsSync(sidecarSrc)) {
        try {
          fs.copyFileSync(sidecarSrc, dest + suffix);
        } catch (e) {
          console.warn(`[rnpmDb] pre-migration sidecar ${suffix} failed (continuing):`, e instanceof Error ? e.message : e);
        }
      }
    }
    console.log(`[rnpmDb] pre-migration backup -> ${dest}`);
  } catch (e) {
    console.warn("[rnpmDb] pre-migration backup failed (continuing):", e instanceof Error ? e.message : e);
  }
}

export function getRnpmDb(ownerId: string): Database.Database {
  if (shuttingDown) {
    throw new Error("RNPM DB closed; refusing to reopen during shutdown");
  }
  assertValidOwnerId(ownerId);
  const existing = handles.get(ownerId);
  if (existing) return existing;

  const dbPath = getRnpmDbPath(ownerId);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  if (fs.existsSync(dbPath) && hasPendingRnpmMigrations(dbPath)) {
    preRnpmMigrationBackup(ownerId, dbPath, "schema-upgrade");
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");

  // Paritate cu schema.ts: truncheaza WAL-ul umflat la deschidere.
  try {
    const walSize = fs.statSync(`${dbPath}-wal`).size;
    if (walSize > 32 * 1024 * 1024) {
      const t0 = Date.now();
      db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      console.log(`[rnpmDb] WAL ${ownerId} was ${(walSize / 1024 / 1024).toFixed(1)}MB; truncated in ${Date.now() - t0}ms`);
    }
  } catch {
    /* -wal absent e ok */
  }

  // ORDINE CRITICA: UDF inainte de runMigrations (trigger-ele din 0001 il apeleaza)
  // si runner-ul INAINTE de orice scriere (altfel detectia legacy din runner.ts
  // ar backfill-ui sentinel pe un DB cu tabele rnpm dar fara _schema_versions).
  registerRnpmNorm(db);
  const result = runMigrations(db, MIGRATIONS_RNPM_DIR);
  if (result.applied.length > 0) {
    console.log(`[rnpmDb] ${ownerId}: applied migrations ${result.applied.join(", ")}`);
  }

  handles.set(ownerId, db);
  return db;
}

export function closeRnpmDb(ownerId: string): void {
  const db = handles.get(ownerId);
  if (db) {
    db.close();
    handles.delete(ownerId);
  }
}

export function closeAllRnpmDbs(): void {
  for (const [ownerId, db] of handles) {
    try {
      db.close();
    } catch (e) {
      console.warn(`[rnpmDb] close ${ownerId} failed:`, e instanceof Error ? e.message : e);
    }
  }
  handles.clear();
}

// Productie: gracefulShutdown il apeleaza inainte de markShuttingDown() pe monolit.
export function markRnpmShuttingDown(): void {
  shuttingDown = true;
  closeAllRnpmDbs();
}

// Testele reseteaza latch-ul intre cazuri (paritate cu closeDb-ul monolitului).
export function __resetRnpmDbForTests(): void {
  shuttingDown = false;
  closeAllRnpmDbs();
}

export function checkpointRnpmWal(ownerId: string): void {
  getRnpmDb(ownerId).prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
}

export function compactRnpmDb(ownerId: string): { beforeBytes: number; afterBytes: number; durationMs: number } {
  const db = getRnpmDb(ownerId);
  const dbPath = getRnpmDbPath(ownerId);
  const sizeOf = (p: string): number => {
    try {
      return fs.statSync(p).size;
    } catch {
      return 0;
    }
  };
  const before = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`) + sizeOf(`${dbPath}-shm`);
  const t0 = Date.now();
  db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  db.exec("VACUUM");
  db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  const durationMs = Date.now() - t0;
  const after = sizeOf(dbPath) + sizeOf(`${dbPath}-wal`) + sizeOf(`${dbPath}-shm`);
  return { beforeBytes: before, afterBytes: after, durationMs };
}
```

- [ ] **Step 2.4: Ruleaza testele — PASS**

Run: `npx vitest run src/db/rnpmDb.test.ts --root backend` — Expected: PASS (toate).

- [ ] **Step 2.5: Gate-uri + commit**

```bash
npx biome check --write backend/src/db/rnpmDb.ts backend/src/db/rnpmDb.test.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run test:backend
git add backend/src/db/rnpmDb.ts backend/src/db/rnpmDb.test.ts
git commit -m "feat(rnpm-split): rnpmDb.ts — registry handle-uri per owner + provisioning lazy prin runner"
```

---

### Task 3: Rutarea repositories pe fisierul per user + contractul de ownership

**Files:**
- Modify: `backend/src/db/avizRepository.ts` (11 call-sites `getDb()` la liniile ~155, 344, 354, 362, 429, 534, 547, 563, 586, 609, 708 + import + `checkpointWal`)
- Modify: `backend/src/db/searchRepository.ts` (5 call-sites: ~28, 49, 70, 79, 98 + `getSearchOwnership`)
- Modify: `backend/src/services/rnpmSearchService.ts` (blocul ownership, liniile ~109-128)
- Test: `backend/src/db/repository-isolation.test.ts` (rescriere semantica) + suitele existente rnpm

**Interfaces:**
- Consumes: `getRnpmDb(ownerId)`, `checkpointRnpmWal(ownerId)` din Task 2.
- Produces (contract NOU): `getSearchOwnership(id, ownerId): "owned" | "missing"` — starea `foreign` DISPARE
  (id-urile devin namespace per fisier user; izolarea e fizica). `searchBelongsToOwner` ramane cu aceeasi
  semnatura (`ownership === "owned"`).

- [ ] **Step 3.1: Rescrie testele de izolare (red)**

In `backend/src/db/repository-isolation.test.ts`: pastreaza setup-ul tmpdir + env, dar semantica noua:
datele lui A se scriu prin `saveAvizFull({ ownerId: "userA", ... })` si ajung in `rnpm/userA.db`;
ale lui B in `rnpm/userB.db`. Asertiile noi:
1. `getAvize({ ownerId: "userA" })` vede DOAR datele lui A; idem B (ca inainte).
2. NOU: fisierele exista separat pe disc (`fs.existsSync(getRnpmDbPath("userA"))` si `userB`), iar
   `rnpm/userA.db` NU contine niciun rand cu `owner_id = 'userB'` (deschide raw readonly si verifica
   `SELECT COUNT(*) FROM rnpm_avize WHERE owner_id != 'userA'` = 0).
3. NOU: `getSearchOwnership(idInexistent, "userA")` intoarce `"missing"` (nu mai exista `"foreign"`).
4. Sterge drill-urile "FK breach cross-owner in acelasi DB" (nu se mai pot construi — noteaza in
   comentariul de header ca izolarea e acum fizica, prin fisier).
Adapteaza si `afterEach` sa apeleze `__resetRnpmDbForTests()` din `./rnpmDb.ts`.
Run: `npx vitest run src/db/repository-isolation.test.ts --root backend` — Expected: FAIL.

- [ ] **Step 3.2: Ruteaza avizRepository.ts**

- Inlocuieste importul liniei 1: `import { getDb, checkpointWal } from "./schema.ts";` cu
  `import { checkpointRnpmWal, getRnpmDb } from "./rnpmDb.ts";`
- La FIECARE din cele 11 call-sites, inlocuieste `const db = getDb();` cu `const db = getRnpmDb(ownerId);`
  folosind ownerId-ul DEJA prezent in scope: `input.ownerId` (saveAvizFull L155), `ownerId` parametru
  (getAvizById L344, getAvizByIdentificator L354, getAvize L429 via `opts.ownerId`, deleteAviz L534,
  deleteAllAvize L547, deleteAvizeByIds L563, getAvizStats L586, getAvizeByIds L609,
  filterRnpmSearchResults L708 via `opts.ownerId`), iar in `loadAvizChildren` (L362) foloseste
  `aviz.owner_id` (row-ul e deja incarcat).
- Inlocuieste cele 3 apeluri `checkpointWal()` (L541, L556, L574) cu `checkpointRnpmWal(ownerId)`.
- `cleanupOrphanDescrieri(db)` ramane neschimbat (primeste handle-ul ca parametru; acum e handle-ul
  per-user, deci GC-ul e sigur — descrierile nu mai sunt partajate intre useri). Actualizeaza
  comentariul de deasupra lui (L517-519): dedup-ul e acum per-fisier-user, nu cross-user.
- Atentie tip: `cleanupOrphanDescrieri(db: ReturnType<typeof getDb>)` — schimba in
  `Database.Database` (importa `type Database from "better-sqlite3"`) ca sa nu mai depinda de schema.ts.

- [ ] **Step 3.3: Ruteaza searchRepository.ts + noul contract ownership**

- Inlocuieste importul `getDb` cu `getRnpmDb` si fiecare `const db = getDb();` cu
  `const db = getRnpmDb(<ownerId din scope>);` (saveSearch: `input.ownerId`; getSearches: `opts.ownerId`;
  updateSearchTotal/deleteSearch: parametrul `ownerId`).
- Rescrie finalul fisierului (L84-104) astfel:

```ts
// v2.43.0 (rnpm-split): id-urile de search sunt namespace PER FISIER USER — un id
// al altui owner nu mai e observabil (fisierul lui nici nu e deschis), deci starea
// "foreign" a disparut din contract. Garda de tenant (audit 2026-04-29 #11) e acum
// izolarea fizica insasi. "missing" ramane benign: searchId cache-uit in UI dupa
// "Sterge baza" sau dupa un restore la un snapshot anterior.
export type SearchOwnership = "owned" | "missing";

export function getSearchOwnership(id: number, ownerId: string): SearchOwnership {
  const db = getRnpmDb(ownerId);
  const row = db.prepare("SELECT id FROM rnpm_searches WHERE id = ? AND owner_id = ? LIMIT 1").get(id, ownerId) as
    | { id: number }
    | undefined;
  return row ? "owned" : "missing";
}

export function searchBelongsToOwner(id: number, ownerId: string): boolean {
  return getSearchOwnership(id, ownerId) === "owned";
}
```

- [ ] **Step 3.4: Simplifica blocul ownership din rnpmSearchService.ts (liniile ~109-128)**

Inlocuieste blocul existent (care are branch `foreign` cu `throw new RnpmError(..., 403)`) cu:

```ts
  // v2.43.0 (rnpm-split): id-urile sunt per fisier user, deci singura stare posibila
  // in afara de "owned" e "missing" (ex. searchId cache-uit in UI dupa "Sterge baza"
  // sau dupa un restore). Missing = tratam ca search nou, fara eroare vizibila.
  let existingSearchId = input.existingSearchId ?? undefined;
  let existingGcode = input.existingGcode ?? undefined;
  let startRnpmPage = input.startRnpmPage;
  if (existingSearchId != null && getSearchOwnership(existingSearchId, ownerId) === "missing") {
    existingSearchId = undefined;
    existingGcode = undefined;
    startRnpmPage = undefined;
  }
```

Cauta cu `grep -rn "foreign" backend/src` si adapteaza/sterge orice alta referinta la starea `foreign`
(inclusiv teste care o asteapta — ele se rescriu pe noul contract: id inexistent => flux de search nou,
NU 403).

- [ ] **Step 3.5: Ruleaza suitele atinse, apoi TOATA suita backend**

Run: `npx vitest run src/db/repository-isolation.test.ts --root backend` — PASS.
Run: `npm run test:backend` — repara TOATE testele care pica din cauza noii rutari
(suitele care seteaza `LEGAL_DASHBOARD_DB_PATH` si citesc tabele rnpm din monolit trebuie sa citeasca
acum din `getRnpmDbPath(owner)`; suite cunoscute: `avizRepository.*.test.ts`, `avizPageSizeCap.test.ts`,
`rnpm.contract.test.ts`, `rnpm.owner-isolation.test.ts`, `rnpm.filter.test.ts`, `rnpm.split-route.test.ts`,
`rnpmGuards.test.ts`, `rnpmCaptchaQuota.test.ts`, `rnpmSearchService.split.test.ts`, `migrations/0021` test).
REGULA: nu slabi asertiile; muta-le pe fisierul corect. Adauga `__resetRnpmDbForTests()` in teardown-uri.

- [ ] **Step 3.6: Gate-uri + commit**

```bash
npx biome check --write backend/src
npx tsc --noEmit -p backend/tsconfig.json
npm run test:backend
git add -A backend/src
git commit -m "feat(rnpm-split): repositories RNPM rutate pe fisierul per user; ownership owned/missing"
```

---

### Task 4: Splitter one-time `rnpmSplitter.ts` + wiring la boot

**Files:**
- Create: `backend/src/db/rnpmSplitter.ts`
- Modify: `backend/src/index.ts` (wiring dupa validarea auth, inainte de scheduler/serve)
- Test: `backend/src/db/rnpmSplitter.test.ts`

**Interfaces:**
- Produces: `runRnpmSplitIfNeeded(): { split: boolean; owners: string[] }` — idempotent; apelat o data la boot.

- [ ] **Step 4.1: Teste failing — `backend/src/db/rnpmSplitter.test.ts`**

Setup per test: tmpdir + `LEGAL_DASHBOARD_DB_PATH`; seed-uieste monolitul prin `getDb()` (ruleaza
migrations monolit) + INSERT-uri raw in tabelele rnpm din monolit pentru 2 owneri (`userA`, `userB`),
inclusiv: 1 search/owner, 2 avize/owner (cu `search_id` legat), cate 1 creditor/debitor/istoric per aviz,
2 bunuri care REFOLOSESC ACEEASI descriere (`rnpm_bunuri_descrieri` partajata intre A si B — cazul dedup).
Fiecare INSERT de aviz trece prin conexiunea `getDb()` (are UDF + triggere) ca `_norm` sa fie populate.
Cazuri:

```ts
it("muta datele fiecarui owner in fisierul lui, pastrand id-urile originale", ...)
// - runRnpmSplitIfNeeded() => { split: true, owners: ["userA","userB"] }
// - rnpm/userA.db contine EXACT randurile lui A (COUNT per tabela == COUNT-ul seed-uit),
//   cu ACELEASI id-uri (SELECT id ... ORDER BY id identic cu snapshot-ul pre-split)
// - descrierea partajata exista in AMBELE fisiere cu id-ul original
// - monolitul are 0 randuri in toate tabelele rnpm_*

it("este idempotent: al doilea apel nu face nimic", ...)
// dupa primul split, runRnpmSplitIfNeeded() => { split: false, owners: [] }

it("crash intre copiere si stergere: re-run reface fisierele din monolit", ...)
// simuleaza: dupa split complet, restaureaza manual randurile in monolit (re-seed)
// si sterge fisierul userA.db; re-run => userA.db refacut, monolit golit din nou

it("owner cu id invalid pentru path => abort cu eroare clara, monolitul ramane intact", ...)
// seed cu owner_id "a/b" => runRnpmSplitIfNeeded() arunca; COUNT-urile monolitului neschimbate

it("scrie pre-split backup inainte de mutare", ...)
// dupa split exista backups/legal-dashboard.pre-rnpm-split-*.db
```

Run: `npx vitest run src/db/rnpmSplitter.test.ts --root backend` — FAIL.

- [ ] **Step 4.2: Implementeaza `backend/src/db/rnpmSplitter.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getDb, getDbPath, preMigrationBackup } from "./schema.ts";
import {
  assertValidOwnerId,
  getRnpmDbPath,
  registerRnpmNorm,
  MIGRATIONS_RNPM_DIR,
  closeRnpmDb,
} from "./rnpmDb.ts";
import { runMigrations } from "./migrations/runner.ts";

// Splitter one-time (v2.43.0): muta datele RNPM din monolit in fisiere per owner.
// Invariant de siguranta: monolitul ramane SURSA DE ADEVAR pana cand TOTI ownerii
// au fisierele copiate si verificate; abia apoi randurile rnpm_* se sterg din monolit.
// Crash oriunde inainte de stergere => re-run reface totul din monolit (idempotent).

const COPY_TABLES = [
  "rnpm_searches",
  "rnpm_avize",
  "rnpm_creditori",
  "rnpm_debitori",
  "rnpm_bunuri",
  "rnpm_istoric",
] as const;

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ action: "rnpm_split", ...entry, ts: new Date().toISOString() }));
}

export function runRnpmSplitIfNeeded(): { split: boolean; owners: string[] } {
  const mono = getDb();
  const pending = (
    mono
      .prepare("SELECT (SELECT COUNT(*) FROM rnpm_searches) + (SELECT COUNT(*) FROM rnpm_avize) AS n")
      .get() as { n: number }
  ).n;
  if (pending === 0) return { split: false, owners: [] };

  const owners = (
    mono
      .prepare(
        `SELECT DISTINCT owner_id AS o FROM rnpm_searches
         UNION SELECT DISTINCT owner_id FROM rnpm_avize ORDER BY 1`
      )
      .all() as { o: string }[]
  ).map((r) => r.o);

  // Fail-closed INAINTE de orice mutare: un owner nevalidabil ar produce un path
  // nescriabil; abortam cu monolitul intact.
  for (const owner of owners) assertValidOwnerId(owner);

  log({ stage: "start", owners: owners.length, rows: pending });
  preMigrationBackup(getDbPath(), "rnpm-split");

  const monoPath = getDbPath();
  for (const owner of owners) {
    // Handle-ul din registry (daca exista) tine fisierul FINAL deschis; il inchidem
    // ca rename-ul de mai jos sa nu pice pe Windows.
    closeRnpmDb(owner);
    const finalPath = getRnpmDbPath(owner);
    const tmpPath = `${finalPath}.split-tmp`;
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    for (const p of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* absent e ok */
      }
    }

    const target = new Database(tmpPath);
    try {
      target.pragma("journal_mode = WAL");
      target.pragma("foreign_keys = ON");
      registerRnpmNorm(target);
      // Runner-ul INAINTE de copiere — altfel detectia legacy (runner.ts) ar
      // backfill-ui sentinel pe un DB cu tabele dar fara _schema_versions.
      runMigrations(target, MIGRATIONS_RNPM_DIR);

      // ATTACH monolitul readonly (URI). Daca build-ul de SQLite nu accepta URI,
      // fallback la path simplu — nu emitem niciodata scrieri spre `mono.*`.
      try {
        target.prepare("ATTACH DATABASE ? AS mono").run(`file:${monoPath.replace(/\\/g, "/")}?mode=ro`);
      } catch {
        target.prepare("ATTACH DATABASE ? AS mono").run(monoPath);
      }

      const copyAll = target.transaction((ownerId: string) => {
        target
          .prepare(
            `INSERT INTO rnpm_bunuri_descrieri (id, text, text_norm)
             SELECT d.id, d.text, d.text_norm FROM mono.rnpm_bunuri_descrieri d
             WHERE EXISTS (SELECT 1 FROM mono.rnpm_bunuri b WHERE b.descriere_id = d.id AND b.owner_id = ?)`
          )
          .run(ownerId);
        for (const table of COPY_TABLES) {
          // Lista explicita de coloane, identica in ambele scheme (baseline-ul rnpm
          // consolideaza exact coloanele monolitului) — pastram id-urile originale.
          const cols = (target.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
            .map((c) => c.name)
            .join(", ");
          target.prepare(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM mono.${table} WHERE owner_id = ?`).run(ownerId);
        }
      });
      copyAll(owner);

      // Verificare: COUNT per tabela, monolit vs fisier nou.
      for (const table of [...COPY_TABLES, "rnpm_bunuri_descrieri"]) {
        const where = table === "rnpm_bunuri_descrieri" ? "" : " WHERE owner_id = ?";
        const src = (
          table === "rnpm_bunuri_descrieri"
            ? (target
                .prepare(
                  `SELECT COUNT(*) AS n FROM mono.rnpm_bunuri_descrieri d
                   WHERE EXISTS (SELECT 1 FROM mono.rnpm_bunuri b WHERE b.descriere_id = d.id AND b.owner_id = ?)`
                )
                .get(owner) as { n: number })
            : (target.prepare(`SELECT COUNT(*) AS n FROM mono.${table}${where}`).get(owner) as { n: number })
        ).n;
        const dst = (
          table === "rnpm_bunuri_descrieri"
            ? (target.prepare("SELECT COUNT(*) AS n FROM rnpm_bunuri_descrieri").get() as { n: number })
            : (target.prepare(`SELECT COUNT(*) AS n FROM ${table}${where}`).get(owner) as { n: number })
        ).n;
        if (src !== dst) {
          throw new Error(`[rnpm_split] count mismatch ${owner}/${table}: monolit=${src} fisier=${dst}`);
        }
      }
      const integrity = target.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
      if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
        throw new Error(`[rnpm_split] integrity_check failed pentru ${owner}`);
      }
      target.prepare("DETACH DATABASE mono").run();
      target.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    } finally {
      target.close();
    }

    // Replace atomic: fisier final vechi (dintr-un run partial) e suprascris.
    for (const suffix of ["-wal", "-shm"] as const) {
      try {
        fs.unlinkSync(finalPath + suffix);
      } catch {
        /* absent e ok */
      }
    }
    fs.renameSync(tmpPath, finalPath);
    log({ stage: "owner_done", owner });
  }

  // Toti ownerii verificati — abia acum golim monolitul (CASCADE curata copiii avizelor).
  const wipe = mono.transaction(() => {
    mono.prepare("DELETE FROM rnpm_avize").run();
    mono.prepare("DELETE FROM rnpm_searches").run();
    mono.prepare("DELETE FROM rnpm_bunuri_descrieri").run();
  });
  wipe();
  mono.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  mono.exec("VACUUM");
  log({ stage: "done", owners: owners.length });
  return { split: true, owners };
}
```

- [ ] **Step 4.3: Wiring in `backend/src/index.ts`**

Dupa blocul `validateAuthConfig()` (linia ~183-187) adauga:

```ts
try {
  const splitResult = runRnpmSplitIfNeeded();
  if (splitResult.split) {
    console.log(`[boot] rnpm split complet: ${splitResult.owners.length} owneri`);
  }
} catch (e) {
  fatalBoot("rnpm split failed", e);
}
```

cu importul `import { runRnpmSplitIfNeeded } from "./db/rnpmSplitter.ts";`. Fail-closed intentionat:
daca split-ul pica, boot-ul se opreste cu monolitul INTACT si backup-ul pre-split pe disc.
In `gracefulShutdown` (langa `markShuttingDown()`, linia ~905) adauga INAINTE:

```ts
  try {
    markRnpmShuttingDown();
  } catch (e) {
    console.error("[shutdown] markRnpmShuttingDown failed:", e);
  }
```

cu importul `import { markRnpmShuttingDown } from "./db/rnpmDb.ts";`.

- [ ] **Step 4.4: Ruleaza testele — PASS**, apoi `npm run test:backend` integral.

- [ ] **Step 4.5: Gate-uri + commit**

```bash
npx biome check --write backend/src/db/rnpmSplitter.ts backend/src/db/rnpmSplitter.test.ts backend/src/index.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run test:backend
git add backend/src/db/rnpmSplitter.ts backend/src/db/rnpmSplitter.test.ts backend/src/index.ts
git commit -m "feat(rnpm-split): splitter one-time la boot — monolit -> fisiere per owner, fail-closed"
```

---

### Task 5: Registry de activitate + gardul race restore-vs-search

**Files:**
- Create: `backend/src/services/rnpmActivityRegistry.ts`
- Modify: `backend/src/services/rnpmSearchService.ts` (bracket in executeSearch / executeBulkSearch / executeSplitSearch)
- Test: `backend/src/services/rnpmActivityRegistry.test.ts`

**Interfaces (Produces — consumate de Task 6/7):**
```ts
export function beginRnpmSearch(ownerId: string): void;   // arunca RnpmError(409) daca restore in curs
export function endRnpmSearch(ownerId: string): void;
export function hasActiveRnpmSearch(ownerId: string): boolean;
export function beginRnpmRestore(ownerId: string): void;  // arunca Error cu .code="SEARCH_ACTIVE" daca exista search activ
export function endRnpmRestore(ownerId: string): void;
export function __resetRnpmActivityForTests(): void;
```

- [ ] **Step 5.1: Test failing** — `rnpmActivityRegistry.test.ts`: begin/end simetric (count 0 dupa end);
`beginRnpmRestore` arunca daca `beginRnpmSearch` e activ; `beginRnpmSearch` arunca daca restore activ;
ownerii diferiti nu se blocheaza reciproc; dublu `beginRnpmSearch` + un `endRnpmSearch` => inca activ.

- [ ] **Step 5.2: Implementare**

```ts
import { RnpmError } from "./rnpmClient.ts";

// Gard in-proces (v2.43.0): restore-ul inlocuieste fisierul RNPM al ownerului, deci
// nu are voie sa ruleze cat timp o cautare a ACELUIASI owner e in zbor (scrierile
// post-swap ar pica pe FK, cu captcha platit degeaba) — si invers.
const activeSearches = new Map<string, number>();
const restoring = new Set<string>();

export function beginRnpmSearch(ownerId: string): void {
  if (restoring.has(ownerId)) {
    throw new RnpmError("Restaurare in curs pentru acest cont; reincearca dupa finalizare", 409);
  }
  activeSearches.set(ownerId, (activeSearches.get(ownerId) ?? 0) + 1);
}

export function endRnpmSearch(ownerId: string): void {
  const n = (activeSearches.get(ownerId) ?? 0) - 1;
  if (n <= 0) activeSearches.delete(ownerId);
  else activeSearches.set(ownerId, n);
}

export function hasActiveRnpmSearch(ownerId: string): boolean {
  return (activeSearches.get(ownerId) ?? 0) > 0;
}

export class RnpmSearchActiveError extends Error {
  readonly code = "SEARCH_ACTIVE";
  constructor() {
    super("Exista o cautare RNPM in curs pentru acest cont; restore-ul e refuzat pana se termina");
  }
}

export function beginRnpmRestore(ownerId: string): void {
  if (hasActiveRnpmSearch(ownerId)) throw new RnpmSearchActiveError();
  restoring.add(ownerId);
}

export function endRnpmRestore(ownerId: string): void {
  restoring.delete(ownerId);
}

export function __resetRnpmActivityForTests(): void {
  activeSearches.clear();
  restoring.clear();
}
```

- [ ] **Step 5.3: Bracket in rnpmSearchService.ts** — in `executeSearch` (incepe L103), `executeBulkSearch`
si `executeSplitSearch` (incepe L618): imediat dupa ce `ownerId` e disponibil, `beginRnpmSearch(ownerId)`
si `try { ...corpul existent... } finally { endRnpmSearch(ownerId); }`. NU muta alta logica.

- [ ] **Step 5.4: Teste PASS + suita integrala + commit**

```bash
npx biome check --write backend/src/services
npx tsc --noEmit -p backend/tsconfig.json
npm run test:backend
git add backend/src/services
git commit -m "feat(rnpm-split): registry activitate per owner + gard race restore-vs-search"
```

---

### Task 6: Backup multi-target — generalizarea `backup.ts`

**Files:**
- Modify: `backend/src/db/backup.ts`
- Test: `backend/src/db/backup.test.ts` (extindere) + `backend/src/db/rnpmBackup.test.ts` (nou)

**Interfaces (Produces — consumate de Task 7):**
```ts
// Monolit (comportament identic celui de azi):
export function listBackupsWithMeta(): Promise<BackupEntry[]>;
export function restoreFromBackup(name: string): Promise<{ preRestoreName: string }>;
export function deleteAllBackups(): Promise<number>;
export function createManualBackup(): Promise<{ name: string }>;              // NOU — monolit on-demand
export function getBackupDir(): string;
// Per user RNPM (toate valideaza ownerId si opereaza in jail-ul backups/rnpm/<ownerId>/):
export function getRnpmBackupDir(ownerId: string): string;
export function listRnpmBackups(ownerId: string): Promise<BackupEntry[]>;
export function createRnpmManualBackup(ownerId: string): Promise<{ name: string }>;
export function restoreRnpmFromBackup(ownerId: string, name: string): Promise<{ preRestoreName: string }>;
export function deleteRnpmBackups(ownerId: string): Promise<number>;
// Neschimbate: withMaintenanceRead / withMaintenanceWrite / runDailyBackup (extins intern).
```

- [ ] **Step 6.1: Teste failing** — in `rnpmBackup.test.ts` (setup: tmpdir + env + `getRnpmDb("u1")` cu date):
1. `createRnpmManualBackup("u1")` creeaza `backups/rnpm/u1/rnpm.manual-<stamp>.db` si `listRnpmBackups("u1")` il vede.
2. `restoreRnpmFromBackup("u1", name)`: scrie un aviz DUPA backup, restaureaza, avizul post-backup dispare,
   cele pre-backup exista; pre-restore snapshot `rnpm.pre-restore-*.db` exista in jail-ul lui u1.
3. Jail: `restoreRnpmFromBackup("u1", "../../legal-dashboard.2026-01-01.db")` si nume cu `/` sau `\\` => throw;
   `listRnpmBackups("u2")` NU vede fisierele lui u1.
4. Gard race: cu `beginRnpmSearch("u1")` activ, `restoreRnpmFromBackup("u1", ...)` arunca `RnpmSearchActiveError`.
5. `runDailyBackup()` produce si `legal-dashboard.YYYY-MM-DD.db` (monolit) si `rnpm.YYYY-MM-DD.db` in
   jail-ul fiecarui fisier user EXISTENT PE DISC (creeaza `rnpm/u1.db` inchis — fara handle in registry —
   si verifica ca backup-ul apare fara ca registry-ul sa deschida handle nou persistent).
6. Retentie per pool per target: seed >7 daily + >5 manual in jail-ul u1 => prune la 7/5 fara sa atinga
   pool-urile monolitului.
In `backup.test.ts` existent: verifica ca toate cazurile de azi raman verzi (comportamentul monolitului NU se schimba).

- [ ] **Step 6.2: Implementare in `backup.ts`** — refactor intern pe un tip privat:

```ts
interface BackupTarget {
  id: string;                       // "main" | `rnpm:${ownerId}`
  dbPath: string;
  backupDir: string;
  prefix: string;                   // "legal-dashboard." | "rnpm."
  openForBackup(): Database.Database;   // main: getDb(); rnpm: handle temporar NOU pe fisier existent (fara registry/migrations)
  closeForRestore(): void;              // main: closeDb(); rnpm: closeRnpmDb(ownerId)
  checkpointBeforeRestore(): void;      // best-effort PRAGMA wal_checkpoint(TRUNCATE) pe handle-ul viu daca exista
}
```

Reguli de implementare (pastreaza TOT fluxul existent, doar parametrizat):
- `mainTarget()` reproduce exact comportamentul de azi (prefix `legal-dashboard.`, dir `backups/`, `closeDb()`).
- `rnpmTarget(ownerId)`: `assertValidOwnerId` la constructie; dir `backups/rnpm/<ownerId>/`; prefix `rnpm.`;
  `openForBackup()` deschide `new Database(dbPath)` DOAR daca fisierul exista (fara provisioning) si
  callerul il inchide dupa `db.backup()`; `closeForRestore()` = `closeRnpmDb(ownerId)`.
- Regex-urile de retentie devin functii de prefix: daily `^<prefix>\d{4}-\d{2}-\d{2}\.db$`,
  pre-restore `^<prefix>pre-restore-`, pre-migration `^<prefix>pre-(?!restore-)[^.]+\.db$`,
  manual `^<prefix>manual-` cu `MANUAL_RETAIN = 5` (pool NOU, disjunct — adapteaza si `pruneOld`).
- `restoreFromBackupImpl` devine `restoreTargetImpl(target, name)`: validare nume
  `^<prefix>[A-Za-z0-9._-]+\.db$` + reject `/` si `\\`, apoi EXACT pasii existenti (checkpoint, close,
  pre-restore snapshot IN dir-ul targetului, unlink sidecars cu throw pe non-ENOENT, copy+rename atomic,
  integrity_check pe handle readonly, auto-revert). `restoreFromBackup(name)` = wrapper pe mainTarget;
  `restoreRnpmFromBackup(ownerId, name)` = `withMaintenanceWrite` + `beginRnpmRestore(ownerId)` in
  try/finally cu `endRnpmRestore` + `restoreTargetImpl(rnpmTarget(ownerId), name)`.
- `createManualBackup()` / `createRnpmManualBackup(ownerId)`: sub `withMaintenanceWrite`, `db.backup(tmp)`
  + rename la `<prefix>manual-<stamp ISO cu dashes>.db` + prune + `runOffsiteBackupHook(dest)`.
- `runDailyBackupImpl`: dupa snapshot-ul monolitului, enumereaza DE PE DISC `rnpm/*.db` (glob pe
  `getRnpmDataDir()`, `fs.readdir` + filtru `\.db$`, ownerId = basename fara extensie, skip daca
  `assertValidOwnerId` pica — log warn), si pentru fiecare: freshness check per jail, `openForBackup()`
  temporar, `db.backup(tmp)` + rename + prune + offsite hook + close. TOT in acelasi
  `withMaintenanceWrite` (o singura fereastra de maintenance pe noapte).
- `deleteRnpmBackups(ownerId)`: sterge doar fisierele `rnpm.*.db` din jail-ul ownerului, cu audit line
  `delete_rnpm_backups` + count. `logBackupEvent` primeste `target: target.id` pe toate evenimentele.

- [ ] **Step 6.3: Teste PASS + suita integrala**

Run: `npx vitest run src/db/rnpmBackup.test.ts src/db/backup.test.ts --root backend` apoi `npm run test:backend`.

- [ ] **Step 6.4: Gate-uri + commit**

```bash
npx biome check --write backend/src/db
npx tsc --noEmit -p backend/tsconfig.json
npm run test:backend
git add backend/src/db
git commit -m "feat(rnpm-split): backup multi-target — monolit + fisiere rnpm per user, backup manual, retentie per pool"
```

---

### Task 7: Rute — self-service RNPM owner-scoped + router admin pentru monolit

**Files:**
- Modify: `backend/src/routes/rnpm.ts` (blocurile: /stats L863-876, /saved/all L830-845, /compact L899-909, /open-db-folder L877-897, /backups* L910-985)
- Create: `backend/src/routes/adminBackups.ts`
- Modify: `backend/src/index.ts` (mount `/api/admin/backups`)
- Test: `backend/src/routes/rnpmBackups.contract.test.ts` (nou) + `backend/src/routes/adminBackups.test.ts` (nou)

**Interfaces:**
- Consumes: functiile din Task 6 + `hasActiveRnpmSearch`/erori din Task 5 + `compactRnpmDb`/`getRnpmDbPath` din Task 2.
- Contract rute RNPM (self-service, FARA `requireDesktopHeader` — blast radius = fisierul propriu):
  - `GET /api/rnpm/backups` -> `{ backups }` din jail-ul callerului; admin poate `?ownerId=<id>`.
  - `POST /api/rnpm/backups/create` -> `{ ok, name }`; audit `backup.rnpm.create`.
  - `POST /api/rnpm/backups/restore` body `{ name }` -> `{ ok, preRestoreName }`; 409 envelope
    `SEARCH_ACTIVE` daca ownerul are cautare activa; audit `backup.rnpm.restore` (succes + eroare);
    `limitSmall`; admin poate `{ name, ownerId }`.
  - `DELETE /api/rnpm/backups` -> `{ deleted }` doar jail-ul propriu; audit `backup.rnpm.delete_all`.
- Contract `/api/admin/backups` (monolit, `requireRole("admin")`):
  - `GET /` -> `{ backups }`; `POST /create` -> `{ ok, name }` (audit `backup.create`);
  - `POST /restore` (`requireDesktopHeader` pastrat + `limitSmall`) -> `{ ok, preRestoreName }` (audit `backup.restore`);
  - `DELETE /` (`requireDesktopHeader`) -> `{ deleted }` (audit `backup.delete_all`).

- [ ] **Step 7.1: Teste failing (contract)** — `rnpmBackups.contract.test.ts`: app Hono de test cu
`ownerContext` fals (userul `u1` rol `user`, userul `admin1` rol `admin`, pattern-ul din
`rnpm.contract.test.ts`); cazuri: user vede doar jail-ul lui; user NU poate `?ownerId=u2` (parametrul e
ignorat sau 403 — decide: IGNORAT pentru non-admin, folosit pentru admin); create+restore+delete pe
fisierul propriu; 409 `SEARCH_ACTIVE` cand `beginRnpmSearch("u1")` e activ; restore accepta doar nume
`rnpm.*.db` fara separatoare. `adminBackups.test.ts`: non-admin => 401/403; admin list/create ok;
restore cere header desktop in mod desktop.

- [ ] **Step 7.2: Implementare rute RNPM (in rnpm.ts):**
- `GET /stats` (L863-876): inlocuieste `getDbPath()` cu `getRnpmDbPath(getOwnerId(c))` (import din
  `../db/rnpmDb.ts`); raportul `db.path`/`sizeBytes` devine al fisierului RNPM propriu.
- `DELETE /saved/all` (L830): scoate `requireDesktopHeader` si `requireRole("admin")` NU se scoate —
  ATENTIE: pastreaza `requireRole("admin")`? NU — decizia spec: operatiile pe date proprii devin
  self-service. Ruta opereaza deja owner-scoped (`deleteAllAvize(getOwnerId(c))`). Pastreaza
  `requireRole("admin", "user")` ca gard de cont activ (requireRole cere user existent + activ) si
  inlocuieste `compactDb()` cu `compactRnpmDb(getOwnerId(c))`.
- `POST /compact` (L899): idem — `compactRnpmDb(getOwnerId(c))`, guard `requireRole("admin", "user")`,
  scoate `requireDesktopHeader`.
- `POST /open-db-folder` (L877): ramane desktop-only (electron shell), dar arata fisierul
  `getRnpmDbPath(getOwnerId(c))`.
- `POST /open-backups-folder`: idem, `getRnpmBackupDir(getOwnerId(c))`.
- Inlocuieste integral blocul `/backups*` (L910-985) cu rutele self-service din contract; helper comun:

```ts
function resolveBackupOwner(c: import("hono").Context): string {
  const caller = getOwnerId(c);
  const requested = c.req.query("ownerId");
  if (requested && requested !== caller && c.get("role") === "admin") return requested;
  return caller;
}
```

(pentru POST restore, `ownerId` vine din body in loc de query — aceeasi regula). Fiecare mutatie:
`recordAudit(c, "backup.rnpm.<op>", { targetKind: "backup", targetId: <name|ownerId>, detail })`
pe succes SI pe eroare (pattern-ul existent L914-968). Mapare erori: `RnpmSearchActiveError` =>
`c.json(fail("SEARCH_ACTIVE", e.message, c), 409)`; restul => `internalError(c, msg)`.

- [ ] **Step 7.3: Creeaza `backend/src/routes/adminBackups.ts`** — router Hono nou cu cele 4 rute din
contract, folosind `listBackupsWithMeta/createManualBackup/restoreFromBackup/deleteAllBackups` (monolit)
si audit-urile existente `backup.restore`/`backup.delete_all` + `backup.create` nou. Mount in `index.ts`
langa celelalte (linia ~410): `app.route("/api/admin/backups", adminBackupsRouter);`.

- [ ] **Step 7.4: Teste PASS + suita integrala + commit**

```bash
npx biome check --write backend/src/routes backend/src/index.ts
npx tsc --noEmit -p backend/tsconfig.json
npm run test:backend
git add backend/src/routes backend/src/index.ts
git commit -m "feat(rnpm-split): rute backup self-service owner-scoped + /api/admin/backups pentru monolit"
```

---

### Task 8: Frontend — "Baza mea RNPM" + tab Setari "Backup"

**Files:**
- Modify: `frontend/src/lib/rnpmApi.ts` (functie noua `rnpmCreateBackup`; restul raman — path-urile nu se schimba)
- Create: `frontend/src/lib/adminBackupsApi.ts`
- Modify: `frontend/src/components/rnpm/RnpmSavedStats.tsx` + `frontend/src/components/rnpm/RnpmRestoreModal.tsx` (copy + buton nou)
- Create: `frontend/src/pages/admin/Backups.tsx` (pattern `embedded` ca `pages/admin/Users.tsx`)
- Modify: `frontend/src/pages/Settings.tsx` (tab nou)
- Test: `frontend/src/components/rnpm/RnpmRestoreModal.test.tsx` (adapteaza copy), `frontend/src/pages/admin/Backups.test.tsx` (nou)

- [ ] **Step 8.1: rnpmApi.ts** — adauga:

```ts
export async function rnpmCreateBackup(): Promise<{ name: string }> {
  const res = await apiFetch(`${BASE}/backups/create`, { method: "POST" });
  const data = await jsonOrThrow<{ ok: true; name: string }>(res);
  return { name: data.name };
}
```

- [ ] **Step 8.2: adminBackupsApi.ts** — functii `adminListBackups() / adminCreateBackup() /
adminRestoreBackup(name) / adminDeleteBackups()` pe `/api/admin/backups*`, acelasi pattern
`apiFetch` + `jsonOrThrow` si tipul `RnpmBackupEntry` reexportat ca `BackupEntry`.

- [ ] **Step 8.3: Copy + buton in componentele RNPM:**
- `RnpmSavedStats.tsx`: butonul "Info baza locala" devine "Baza mea RNPM"; adauga langa "Backups" un
  buton "Creeaza backup acum" care apeleaza `rnpmCreateBackup()` (spinner pe durata + mesaj cu numele
  fisierului la succes, pattern-ul `compactMsg`); copy-ul de la "Sterge back-up" devine: "Stergi toate
  backup-urile TALE RNPM?\n\nCelelalte module si ceilalti utilizatori nu sunt afectati."
- `RnpmRestoreModal.tsx`: titlul devine "Restaurare baza mea RNPM"; mesajul de confirmare (L48-53) devine:
  `Restaurezi DOAR datele tale RNPM din ${entry.name}?\n\nRestul aplicatiei (monitorizari, utilizatori, setari) NU este afectat. Baza ta actuala va fi salvata automat ca rnpm.pre-restore-*.db inainte de suprascriere.`
  Mesajul de succes: `Restaurare completa. Snapshot pre-restore: ${preRestoreName}.` (fara "reporneste
  aplicatia" — fisierul viu se redeschide lazy, nu mai e nevoie de restart).
- Trateaza 409 SEARCH_ACTIVE: mesajul erorii vine din envelope prin `extractErrorMessage` (deja folosit
  de `jsonOrThrow`); verifica doar ca se afiseaza in `error` state-ul modalului.

- [ ] **Step 8.4: `pages/admin/Backups.tsx`** — pagina embedded admin cu: lista backup-urilor monolitului
(nume mono, data, dimensiune — reuse `formatBytes`/`formatBackupDate` pattern), buton "Creeaza backup acum",
buton "Restaureaza" per rand cu `useConfirm` destructive si mesajul EXACT:
`Restaurezi backup-ul COMPLET al bazei — toate modulele, toti utilizatorii (datele RNPM au backup separat per utilizator)?\n\nBaza curenta va fi salvata automat inainte de suprascriere. Dupa restore este recomandata repornirea aplicatiei.`
si buton "Sterge toate backup-urile" (destructive). Stare loading/error/success ca in `RnpmRestoreModal`.

- [ ] **Step 8.5: Settings.tsx** — adauga in `TABS` (dupa "audit"): `{ key: "backup", label: "Backup", adminOnly: true }`,
lazy import `const AdminBackups = lazy(() => import("@/pages/admin/Backups"));` si blocul de montare
identic cu celelalte (`AdminGate` + `Suspense` + `<AdminBackups embedded />`).

- [ ] **Step 8.6: Teste frontend** — adapteaza `RnpmRestoreModal.test.tsx` la noul copy; test nou pentru
`Backups.tsx` (render embedded, lista mock, confirmarea destructiva apare la restore). Run:
`cd frontend && npm test -- --run` — PASS.

- [ ] **Step 8.7: Gate-uri + commit**

```bash
npx biome check --write frontend/src
cd frontend && npx tsc --noEmit && npm test -- --run && cd ..
npm run build
git add frontend/src
git commit -m "feat(rnpm-split): UI Baza mea RNPM (self-service + backup manual) + tab Setari Backup (monolit, admin)"
```

---

### Task 9: Documentatie + bump v2.43.0

**Files:**
- Modify: `RUNBOOK.md`, `SECURITY.md`, `DEPLOY-SERVER.md`, `CLAUDE.md`, `SESSION-HANDOFF.md`
- Bump: `package.json` (root + backend + frontend) + `package-lock.json`, `frontend/src/data/changelog-entries.tsx`, `CHANGELOG.md`, `README.md`, `STATUS.md`, `DOCUMENTATIE.md`

- [ ] **Step 9.1: RUNBOOK.md** — sectiuni noi: (a) "Split-ul RNPM per utilizator (v2.43.0)" — ce s-a
intamplat la primul boot, unde sunt fisierele (`<dataDir>/rnpm/<ownerId>.db`), backup-ul pre-split
`legal-dashboard.pre-rnpm-split-*.db` ca rollback; (b) "Backup si restore per utilizator (RNPM)" —
jail-urile `backups/rnpm/<ownerId>/`, pool-urile daily/manual/pre-restore, restore self-service +
gardul SEARCH_ACTIVE; (c) actualizeaza sectiunea 5 (restore local) si 6 (offsite): offsite hook-ul
ruleaza acum per fisier (monolit + fiecare rnpm), deci destinatia primeste N+1 fisiere/noapte;
(d) nota: rollback-ul migrations rnpm foloseste `migrations-rnpm/*.down.sql`.
- [ ] **Step 9.2: SECURITY.md** — intrare noua: suprafata self-service restore (jail per owner, validare
ownerId pe path, fara upload, audit `backup.rnpm.*`, gard race); mentioneaza scoaterea
`requireDesktopHeader` de pe rutele rnpm-backup si motivatia (blast radius per fisier propriu).
Adauga rand in changelog-table-ul de la baza fisierului.
- [ ] **Step 9.3: DEPLOY-SERVER.md** — volumul `ld_data` contine acum `rnpm/` + `backups/rnpm/`;
recomandarea de sincronizare offsite acopera ambele.
- [ ] **Step 9.4: CLAUDE.md** — actualizeaza sectiunea Structura/Arhitectura: DB monolit + fisiere
`rnpm/<ownerId>.db` per user (repository-only ramane; `backend/src/db/rnpmDb.ts` e noul entry point
pentru handle-uri RNPM); actualizeaza "Versiune Curenta" la v2.43.0 conform regulilor din fisier.
- [ ] **Step 9.5: Bump v2.43.0** — urmeaza EXACT "Checklist bump de versiune" din CLAUDE.md (package.json
x3 + lockfile via `npm install --package-lock-only`, changelog-entries.tsx cu intrarea v2.43.0,
CHANGELOG.md, README.md, STATUS.md header, DOCUMENTATIE.md, SESSION-HANDOFF.md context nou). Sanity:
`grep -rn "2\.42\.0" *.md` — orice hit care nu e istoric se actualizeaza.
- [ ] **Step 9.6: Gate-uri + commit**

```bash
npx biome check --write .
npm run typecheck && npm run build && npm run check
git add -A
git commit -m "docs+release: v2.43.0 — split RNPM per user, backup self-service, tab Setari Backup"
```

---

### Task 10: Verificare finala end-to-end

- [ ] **Step 10.1:** `npm run check` + `npm run build` — ambele verzi de la zero.
- [ ] **Step 10.2:** `npm run rebuild:electron` (dupa toate testele Node).
- [ ] **Step 10.3: Smoke desktop (Electron real, `npm run electron:dev`):** pe o copie de DB v2.42 cu
date RNPM: (1) primul boot ruleaza split-ul — verifica log JSON `rnpm_split` + fisierul
`rnpm/local.db` + monolitul fara randuri rnpm (sqlite3 sau DB browser); (2) datele RNPM identice in UI
(tab Salvate — acelasi numar de avize); (3) cautare RNPM noua functioneaza; (4) "Creeaza backup acum" +
restore propriu functioneaza; (5) restore refuzat cu 409 cand o cautare e in curs; (6) restart —
split-ul NU re-ruleaza (log absent).
- [ ] **Step 10.4: Smoke web (`scripts/dev-web-local.ps1` din pwsh 7, DOI useri):** (1) userul A isi
restaureaza fisierul, userul B nu pierde nimic; (2) A nu vede backup-urile lui B (jail); (3) restore-ul
lui A nu atinge monolitul (fx_rates/monitoring/users neschimbate); (4) tab-ul Setari > Backup e vizibil
doar pentru admin si functioneaza; (5) daily backup (fortat prin restart) produce fisiere pentru monolit
si pentru fiecare user.
- [ ] **Step 10.5:** Raporteaza rezultatul complet (gate-uri, smoke, orice abatere de la plan) FARA push;
push-ul se face doar la cererea explicita a userului.

---

## Self-review (rulat la scriere)

- Acoperire spec: layout fisiere (T1-T2), DB layer (T2), migrations (T1), splitter + fail-closed +
  fatalBoot (T4), backup multi-target + manual + retentie (T6), gard race (T5), contract ownership (T3),
  rute self-service + admin (T7), UI + copy explicit (T8), docs + bump (T9), verificare (T10). Out of
  scope confirmat: restore sub-modul, DROP tabele monolit, lock per-fisier.
- Fara placeholders: fiecare pas are cod/comenzi concrete; unde modificarea e mecanica, call-site-urile
  sunt enumerate cu linii exacte.
- Consistenta tipuri: `getRnpmDb(ownerId)` / `RnpmSearchActiveError.code === "SEARCH_ACTIVE"` /
  `restoreRnpmFromBackup(ownerId, name)` folosite identic in T2/T5/T6/T7.
