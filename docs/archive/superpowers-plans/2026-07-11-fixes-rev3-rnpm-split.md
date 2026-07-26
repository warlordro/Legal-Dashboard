# Fixuri Rev. 3 — review adversarial final rnpm-split (v2.43.0, pre-merge) — CORECTAT cu review-ul panelului pe plan

> **Pentru agentul executant:** REQUIRED SUB-SKILL: superpowers:executing-plans (sau
> subagent-driven-development). Pasii folosesc checkbox (`- [ ]`). TDD strict: red
> confirmat inainte de green (exceptiile sunt marcate EXPLICIT ca teste de regresie).
> UN SINGUR commit consolidat (COMMIT D) la final.

**Goal:** inchide findings-urile confirmate din review-ul adversarial FINAL pe delta
fixurilor Rev. 2 (`485c455..f29e510`): Codex GPT-5.6 Sol (verdict NO-SHIP: 3 HIGH,
2 MEDIUM) + review-panel (sinteza: 5 MEDIUM, ~6 LOW; concurenta si protocolul
staging/swap verificate CURATE de 3-4 revieweri independent).

**Architecture:** fixuri chirurgicale pe `feat/v2.43.0-rnpm-split`, fara refactor.
Cele 3 HIGH-uri sunt gate-uri de VALIDARE (packaging worker + fallback pe esec
async de startup; refuz restore pre-split; validare ledger pe copia staged) — nu
schimba protocolul de staging/swap deja verificat curat. Worker-ul primeste
handshake `ready` (fix panel-pe-plan): fallback sincron DOAR pre-ready.

**Tech Stack:** Node 22 + Hono + better-sqlite3 12 (worker_threads), Vitest, Biome.

## Constrangeri globale (identice cu Rev. 2)

- Limba UI/mesaje: romana FARA diacritice in cod sursa.
- Erori HTTP: envelope-ul standard `fail(code, message, c)`; validare = 400
  `INVALID_PARAMS` prin `BackupValidationError`.
- SQL raw DOAR in `backend/src/db/**`.
- Backend bundlat CJS — fara `import.meta.url`; pattern `typeof __dirname`.
- Gate-uri inainte de commit: biome pe fisierele atinse (re-stage), tsc backend,
  `npm run build`, `npm run test:backend` (frontend: doar daca 7.2 cere adaptare UI).
- Branch: `feat/v2.43.0-rnpm-split`. NU push fara cerere explicita.
- UN SINGUR commit consolidat (COMMIT D) la finalul Task 8.
- Dupa teste Node pe better-sqlite3: `npm run rebuild:electron` la final.
- Numerele de linie sunt ORIENTATIVE — localizeaza dupa simbol/continut.
- Test hooks urmeaza pattern-ul existent `__*ForTests` (reset in afterEach).

---

### Task 1: Worker functional in Electron impachetat + handshake ready + fallback pe esec de STARTUP (Codex H3 + panel, corectat de panel-pe-plan)

**Files:**
- Modify: `package.json` (build.asarUnpack — ADITIV)
- Modify: `backend/src/util/snapshot-worker.cjs`
- Modify: `backend/src/util/snapshotRunner.ts`
- Test: `backend/src/util/snapshotRunner.test.ts`

**Confirmat pe cod:** `better-sqlite3@12.9.0/lib/database.js:48` face
`require('bindings')`, iar `bindings/bindings.js:7` face `require('file-uri-to-path')`.
Ambele sunt in `build.files` dar NU in `build.asarUnpack` — worker-ul pornit din
`app.asar.unpacked/dist-backend/` nu le rezolva. `require('better-sqlite3')` e
TOP-LEVEL in worker (linia ~12), deci esecul soseste ASINCRON ca eveniment
`error` la LOAD — inainte de orice mesaj. `runSnapshotOp` face fallback sincron
DOAR pe throw-ul sincron al lui `new Worker()` => in build-ul impachetat toate
backup/restore/compact ar esua, iar restore-ul ar deveni imposibil.

**Design corectat (panel-pe-plan):** worker-ul posteaza `{ ready: true }` imediat
dupa require-uri (inainte sa deschida vreun fisier). Fallback-ul sincron ruleaza
DOAR pe esec PRE-ready (`error` sau `exit` inainte de ready — startup failure;
worker-ul nu a atins niciun fisier, deci nu exista dest partial si nici handle-uri
care sa dea EBUSY la re-rularea sincrona; `runSnapshotOpSync` oricum face unlink
pe dest inainte). Esec POST-ready (operational) => REJECT dupa terminate
confirmat (Task 6), fara fallback — evita dublarea VACUUM-ului pe un dest partial.
Exit cu cod 0 FARA mesaj = eroare de PROTOCOL (reject), nu fallback.

**Interfaces:**
- Produces: `__setSnapshotWorkerPathForTests(p: string | null): void` exportat din
  `snapshotRunner.ts` (null = revert la rezolutia normala).
- Protocol worker: `postMessage({ ready: true })` la load, apoi
  `postMessage({ ok: true } | { error: string })` la final. Orice fixture de
  worker din teste TREBUIE sa respecte protocolul (posteaza ready).

- [ ] **1.1: asarUnpack pentru lantul de dependinte al worker-ului (ADITIV)**

In `package.json`, in array-ul EXISTENT `build.asarUnpack`, adauga DOUA intrari
(nu rescrie block-ul; restul intrarilor raman neatinse):

```json
      "node_modules/bindings/**/*",
      "node_modules/file-uri-to-path/**/*",
```

(config de packaging — verificabil complet doar pe artefact impachetat; ramane pe
checklist-ul de release, dar 1.2-1.4 fac fallback-ul sa acopere si cazul in care
rezolutia tot ar esua.)

- [ ] **1.2 (red): test — esec ASYNC de startup => fallback, nu reject**

In `snapshotRunner.test.ts` (helpers `seedDb`/`countRows` exista in fisier):

```ts
import { __setSnapshotWorkerPathForTests, runSnapshotOp } from "./snapshotRunner.ts";

afterEach(() => {
  __setSnapshotWorkerPathForTests(null);
});

it("worker care esueaza ASINCRON la startup (inainte de ready) => fallback sincron cu warn, nu reject", async () => {
  const src = path.join(tmpRoot, "src.db");
  const dest = path.join(tmpRoot, "dest.db");
  seedDb(src, 50);

  // Simuleaza MODULE_NOT_FOUND din Electron impachetat: throw la LOAD, inainte
  // de orice postMessage — soseste prin evenimentul 'error', nu sincron.
  const brokenWorker = path.join(tmpRoot, "broken-worker.cjs");
  fs.writeFileSync(brokenWorker, "throw new Error('MODULE_NOT_FOUND simulat');");
  __setSnapshotWorkerPathForTests(brokenWorker);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string") warnings.push(args[0]);
  };
  try {
    await runSnapshotOp({ op: "vacuum_into", srcPath: src, destPath: dest });
  } finally {
    console.warn = originalWarn;
  }

  expect(countRows(dest)).toBe(50);
  expect(warnings.some((w) => w.includes("snapshot.worker_fallback"))).toBe(true);
});

it("exit 0 FARA mesaj = eroare de protocol => reject, nu fallback", async () => {
  const src = path.join(tmpRoot, "src.db");
  seedDb(src, 5);
  const silentWorker = path.join(tmpRoot, "silent-worker.cjs");
  // Posteaza ready (protocol respectat), apoi iese curat fara rezultat.
  fs.writeFileSync(
    silentWorker,
    "const { parentPort } = require('node:worker_threads');\nparentPort.postMessage({ ready: true });\n"
  );
  __setSnapshotWorkerPathForTests(silentWorker);

  await expect(
    runSnapshotOp({ op: "vacuum_into", srcPath: src, destPath: path.join(tmpRoot, "d.db") })
  ).rejects.toThrow(/exit|fara raspuns/i);
});
```

Run: `npm run test:backend -- src/util/snapshotRunner.test.ts -t "ASINCRON"`
Expected: FAIL — `__setSnapshotWorkerPathForTests` nu exista; dupa adaugarea
hook-ului singur, primul test pica cu reject in loc de fallback.

- [ ] **1.3 (green): handshake ready in worker + hook + fallback pre-ready**

In `snapshot-worker.cjs`, imediat dupa blocul de require-uri (inainte de orice
alta logica):

```js
// Handshake (Rev. 3): ready DUPA require-uri (deci dupa incarcarea reusita a
// lui better-sqlite3), INAINTE de orice operatie pe fisiere. Runner-ul face
// fallback sincron DOAR pe esec pre-ready (startup); dupa ready, un esec e
// operational si se propaga ca reject (fara dublarea VACUUM-ului pe un dest
// posibil partial).
parentPort.postMessage({ ready: true });
```

In `snapshotRunner.ts`:

```ts
let workerPathOverrideForTests: string | null = null;
export function __setSnapshotWorkerPathForTests(p: string | null): void {
  workerPathOverrideForTests = p;
}
```

`resolveWorkerPath()` returneaza override-ul daca e setat. In `runSnapshotOp`,
protocolul devine:

```ts
    let gotReady = false;
    const fallback = (reason: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => {
        /* best-effort: worker-ul de startup esuat nu a deschis fisiere */
      });
      // Esec de STARTUP (ex. MODULE_NOT_FOUND in Electron impachetat soseste
      // asincron prin 'error', pre-ready) — degradare la varianta sincrona:
      // backup-ul ramane functional, doar blocant.
      console.warn(
        JSON.stringify({ action: "snapshot.worker_fallback", reason, ts: new Date().toISOString() })
      );
      try {
        runSnapshotOpSync(op);
        resolve();
      } catch (syncErr) {
        reject(syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
      }
    };

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
```

(`worker.once("message")` devine `worker.on("message")` — sosesc DOUA mesaje:
ready + rezultatul. `finish` ramane cel existent pana la Task 6, care il rescrie.)

Nota regresie: testul existent "(c) op invalid => rejected" ramane verde — op-ul
invalid soseste ca MESAJ `{ error }` DUPA ready, nu ca eveniment `error`.

- [ ] **1.4: ruleaza — trebuie sa treaca**

Run: `npm run test:backend -- src/util/snapshotRunner.test.ts`
Expected: PASS integral (inclusiv testele existente).

---

### Task 2: Refuz restore de monolit pre-split dupa split (Codex H2, corectat: marker ilizibil = fail-closed)

**Files:**
- Modify: `backend/src/db/backup.ts`
- Test: `backend/src/db/backup.test.ts`
- Modify: `RUNBOOK.md` (o fraza in §5)

**Confirmat pe cod:** `restoreFromBackup` valideaza doar versiunea de schema. Dupa
split (marker `done`), restaurarea unui backup de monolit care mai contine randuri
`rnpm_*` REUSESTE si raporteaza succes, dar urmatorul boot aborteaza fail-closed —
"restore reusit" -> aplicatie care nu mai porneste.

**Interfaces:**
- Produces (backup.ts, private): `readSplitMarkerStatus(): "absent" | "started" | "unreadable"`
  si `assertBackupNotPreSplit(stagedDb: Database.Database): void` (arunca
  `BackupValidationError`).
- Consumes: `getRnpmDataDir()` (deja importat). NU importa din `rnpmSplitter.ts`
  (ciclu — splitter-ul importa backup.ts); marker-ul se citeste direct de pe disc.
- Nota mediu de test: `getRnpmDataDir()` deriva din `dirname(getDbPath())`, iar
  `backup.test.ts` seteaza `LEGAL_DASHBOARD_DB_PATH` in tmpdir — marker-ul scris
  de test la `path.join(path.dirname(dbPath), "rnpm", ".split-done.json")` e
  EXACT cel citit de cod.

- [ ] **2.1 (red): teste**

In `backup.test.ts` (helper-ele `seedBackup`/`readMarker` exista; `seedBackup`
creeaza un DB cu o singura tabela `marker` — fara tabele rnpm si fara
`_schema_versions`, deci fixture-urile de mai jos nu au coliziuni; folosim
totusi forme idempotente):

```ts
describe("restore monolit — gate pre-split (Rev. 3)", () => {
  function writeSplitMarker(content: string): void {
    const dir = path.join(path.dirname(dbPath), "rnpm");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".split-done.json"), content);
  }

  function addRnpmRows(backupName: string): void {
    const forge = new Database(path.join(getBackupDir(), backupName));
    try {
      forge.exec(
        "CREATE TABLE IF NOT EXISTS rnpm_searches (id INTEGER PRIMARY KEY, owner_id TEXT NOT NULL, search_type TEXT, params_json TEXT)"
      );
      forge.prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('u1','x','{}')").run();
    } finally {
      forge.close();
    }
  }

  it("split done + backup cu randuri rnpm => 400 fail-closed, live neatins", async () => {
    const backupName = "legal-dashboard.2026-05-01.db";
    await seedBackup(backupName, "PRESPLIT");
    addRnpmRows(backupName);
    writeSplitMarker(JSON.stringify({ status: "done", completedAt: null, owners: [], appVersion: "x" }));

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(restoreFromBackup(backupName)).rejects.toThrow(/RUNBOOK|pre-split|separar/i);
    expect(readMarker(dbPath)).toBe("LIVE");
  });

  it("split wiping (mid-split) + backup cu randuri rnpm => acelasi refuz", async () => {
    const backupName = "legal-dashboard.2026-05-02.db";
    await seedBackup(backupName, "PRESPLIT");
    addRnpmRows(backupName);
    writeSplitMarker(JSON.stringify({ status: "wiping", completedAt: null, owners: [], appVersion: "x" }));

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  });

  it("marker ILIZIBIL (JSON corupt) + backup cu randuri rnpm => refuz fail-closed, nu 'split inexistent'", async () => {
    const backupName = "legal-dashboard.2026-05-05.db";
    await seedBackup(backupName, "PRESPLIT");
    addRnpmRows(backupName);
    writeSplitMarker("{ corupt");

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(readMarker(dbPath)).toBe("LIVE");
  });

  it("fara marker (split inca nerulat): backup cu randuri rnpm ramane restaurabil", async () => {
    const backupName = "legal-dashboard.2026-05-03.db";
    await seedBackup(backupName, "PRESPLIT-OK");
    addRnpmRows(backupName);

    await expect(restoreFromBackup(backupName)).resolves.toBeDefined();
    expect(readMarker(dbPath)).toBe("PRESPLIT-OK");
  });

  it("marker done + backup FARA randuri rnpm ramane restaurabil", async () => {
    const backupName = "legal-dashboard.2026-05-04.db";
    await seedBackup(backupName, "POSTSPLIT");
    writeSplitMarker(JSON.stringify({ status: "done", completedAt: null, owners: [], appVersion: "x" }));

    await expect(restoreFromBackup(backupName)).resolves.toBeDefined();
    expect(readMarker(dbPath)).toBe("POSTSPLIT");
  });
});
```

Run: `npm run test:backend -- src/db/backup.test.ts -t "gate pre-split"`
Expected: FAIL pe primele trei (restore-ul reuseste azi); ultimele doua trec
(regresie).

- [ ] **2.2 (green): gate-ul, cu marker ilizibil = fail-closed**

In `backup.ts`, sub `assertMonolithBackupVersionCompatible`:

```ts
// Rev. 3 (Codex H2): dupa split (marker done/wiping), un backup de monolit care
// mai contine randuri rnpm_* NU se mai restaureaza — restore-ul ar raporta
// succes, dar urmatorul boot ar aborta fail-closed (marker done + randuri rnpm
// reaparute), transformand un "restore reusit" intr-o aplicatie care nu mai
// porneste. Marker-ul se citeste direct de pe disc (fara import din
// rnpmSplitter — ciclu de import). Fix panel-pe-plan: un marker EXISTENT dar
// ilizibil NU inseamna "split inexistent" — boot-ul l-ar respinge fail-closed
// oricum, deci si restore-ul refuza (aceeasi soarta, semnalata mai devreme).
function readSplitMarkerStatus(): "absent" | "started" | "unreadable" {
  const p = path.join(getRnpmDataDir(), ".split-done.json");
  if (!fs.existsSync(p)) return "absent";
  try {
    const status = (JSON.parse(fs.readFileSync(p, "utf8")) as { status?: unknown }).status;
    return status === "done" || status === "wiping" ? "started" : "unreadable";
  } catch {
    return "unreadable";
  }
}

function assertBackupNotPreSplit(stagedDb: Database.Database): void {
  const markerState = readSplitMarkerStatus();
  if (markerState === "absent") return;
  // ESCAPE: '_' e wildcard in LIKE — fara escape, o tabela 'rnpmX...' ar intra
  // fals in verificare (fix panel-pe-plan).
  const rnpmTables = stagedDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rnpm\\_%' ESCAPE '\\'")
    .all() as { name: string }[];
  for (const t of rnpmTables) {
    const n = (stagedDb.prepare(`SELECT COUNT(*) AS n FROM "${t.name.replace(/"/g, '""')}"`).get() as { n: number })
      .n;
    if (n > 0) {
      throw new BackupValidationError(
        markerState === "unreadable"
          ? "Marker-ul de separare RNPM e ilizibil, iar backup-ul contine randuri rnpm_* — restore refuzat " +
            "fail-closed (boot-ul l-ar respinge oricum). Vezi RUNBOOK 'Monolit restaurat dupa split'."
          : "Backup-ul e dinaintea separarii RNPM (contine randuri rnpm_*), iar separarea a rulat deja pe " +
            "aceasta instalare — restaurarea lui ar bloca urmatoarea pornire. Vezi RUNBOOK " +
            "'Monolit restaurat dupa split' pentru cele doua cai de remediere."
      );
    }
  }
}
```

Conectarea se face prin hook-ul `verifyStaged` din Task 3 (`assertBackupNotPreSplit`
ruleaza PRIMA, inaintea validatorului de ledger — mesajul de pre-split are
prioritate cand ambele ar aplica). DACA executi Task 2 inaintea Task 3,
conecteaza TEMPORAR pe o conexiune readonly pe fisierul-sursa in
`restoreFromBackup` (dupa `assertMonolithBackupVersionCompatible(src)`) si muta
pe staged in Task 3:

```ts
    const probe = new Database(src, { readonly: true, fileMustExist: true });
    try {
      assertBackupNotPreSplit(probe);
    } finally {
      probe.close();
    }
```

- [ ] **2.3: ruleaza — trebuie sa treaca; adauga fraza in RUNBOOK §5**

Run: `npm run test:backend -- src/db/backup.test.ts`
Expected: PASS integral.

RUNBOOK.md §5, sub nota v2.43.0 (dupa fraza cu 400 anti-downgrade), adauga:
`Din Rev. 3, un backup de monolit pre-split e refuzat 400 DIRECT la restore cand
split-ul a rulat deja (mesajul trimite la sectiunea "Monolit restaurat dupa
split") — nu mai poate produce un boot blocat.`

---

### Task 3: Validare ledger de migratii pe copia staged + pastrarea erorilor tipate in staging (Codex H1 + BLOCKER-ul panelului pe plan)

**Files:**
- Modify: `backend/src/db/backup.ts`
- Test: `backend/src/db/backup.test.ts` + `backend/src/db/rnpmBackup.test.ts`

**Confirmat pe cod:** validarile de restore verifica doar `MAX(version)`; un ledger
forjat trece si e publicat, iar runner-ul il respinge abia la urmatorul open,
DUPA fereastra de auto-revert. **BLOCKER gasit de panelul pe plan:** catch-ul de
staging din `restoreTargetImpl` face `throw new Error(\`Restore esuat la staging: ...\`)`
— ar DISTRUGE `code`-ul `BackupValidationError`-urilor aruncate de `verifyStaged`
(rutele ar raspunde 500, nu 400). Fix inclus la 3.2.

**Interfaces:**
- Produces: `RestoreTargetSpec.verifyStaged?: (staged: Database.Database) => void`
  (rulat in staging, dupa integrity+checkpoint, inainte de close; throw = staging
  esuat, live neatins); `makeLedgerValidator(migrationsDir: string): (staged: Database.Database) => void`.
- Consumes: `discoverMigrations(dir): MigrationFile[]` cu campurile REALE
  `{ version, sha256, sha256Raw, sha256Crlf }` si `BACKFILL_SENTINEL`
  (`"__backfilled_v1__"`, backfill DOAR pe versiunea 1) din `./migrations/runner.ts`.

- [ ] **3.0 (GATE): confirma semnaturile**

Citeste `backend/src/db/migrations/runner.ts`: `MigrationFile.sha256/sha256Raw/sha256Crlf`,
`BACKFILL_SENTINEL`, backfill doar la version 1. Ruleaza si
`Grep "_schema_versions" backend/src --glob "*.test.ts"` ca sa inventariezi
fixture-urile existente care ating ledger-ul (validarea noua NU trebuie sa le
pice: fixture-urile forjate din testele Rev. 2 folosesc version 999 — acela e
respins deja de MAX(version) INAINTE de staging, deci raman verzi).

- [ ] **3.1 (red): teste**

In `rnpmBackup.test.ts`:

```ts
it("backup rnpm cu hash forjat in _schema_versions => 400 fail-closed, live neatins", async () => {
  seedSearch("u1", "a");
  const { name } = await createRnpmManualBackup("u1");
  const forge = new Database(path.join(getRnpmBackupDir("u1"), name));
  try {
    forge.prepare("UPDATE _schema_versions SET sha256_up = 'hash-forjat' WHERE version = 1").run();
  } finally {
    forge.close();
  }
  await expect(restoreRnpmFromBackup("u1", name)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  expect(countSearches("u1")).toBe(1);
});
```

In `backup.test.ts`:

```ts
describe("restore monolit — validare ledger (Rev. 3)", () => {
  function forgeLedger(backupName: string, rows: Array<{ version: number; hash: string }>): void {
    const forge = new Database(path.join(getBackupDir(), backupName));
    try {
      forge.exec(
        "CREATE TABLE IF NOT EXISTS _schema_versions (version INTEGER PRIMARY KEY, sha256_up TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
      );
      for (const r of rows) {
        forge.prepare("INSERT OR REPLACE INTO _schema_versions (version, sha256_up) VALUES (?, ?)").run(r.version, r.hash);
      }
    } finally {
      forge.close();
    }
  }

  it("ledger cu hash gresit la o versiune cunoscuta => 400, live neatins", async () => {
    const backupName = "legal-dashboard.2026-06-01.db";
    await seedBackup(backupName, "FORGED");
    forgeLedger(backupName, [{ version: 1, hash: "hash-forjat" }]);

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(readMarker(dbPath)).toBe("LIVE");
  });

  it("ledger cu GAURA (incepe la 3, fara 1-2) => 400 (prefix contiguu obligatoriu)", async () => {
    const backupName = "legal-dashboard.2026-06-05.db";
    await seedBackup(backupName, "GAPPED");
    // hash-ul corect al versiunii 3 se citeste din discoverMigrations la rulare:
    const { discoverMigrations } = await import("./migrations/runner.ts");
    const v3 = discoverMigrations(path.join(__dirname, "migrations")).find((f) => f.version === 3);
    if (!v3) throw new Error("fixture: migratia 3 lipseste");
    forgeLedger(backupName, [{ version: 3, hash: v3.sha256 }]);

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(readMarker(dbPath)).toBe("LIVE");
  });

  it("ledger cu versiune invalida (0) => 400", async () => {
    const backupName = "legal-dashboard.2026-06-06.db";
    await seedBackup(backupName, "ZEROVER");
    forgeLedger(backupName, [{ version: 0, hash: "orice" }]);

    await expect(restoreFromBackup(backupName)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  });

  it("ledger cu sentinel de backfill pe versiunea 1 + restul contiguu cu hash-uri reale => ACCEPTAT", async () => {
    const backupName = "legal-dashboard.2026-06-02.db";
    await seedBackup(backupName, "LEGACY");
    const { discoverMigrations } = await import("./migrations/runner.ts");
    const known = discoverMigrations(path.join(__dirname, "migrations"));
    forgeLedger(backupName, [
      { version: 1, hash: "__backfilled_v1__" },
      ...known.filter((f) => f.version > 1).map((f) => ({ version: f.version, hash: f.sha256 })),
    ]);

    await expect(restoreFromBackup(backupName)).resolves.toBeDefined();
    expect(readMarker(dbPath)).toBe("LEGACY");
  });

  it("backup FARA _schema_versions ramane acceptat la monolit (regresie)", async () => {
    const backupName = "legal-dashboard.2026-06-03.db";
    await seedBackup(backupName, "NOLEDGER");
    await expect(restoreFromBackup(backupName)).resolves.toBeDefined();
  });
});
```

(`__dirname` in backup.test.ts: fisierul e in `backend/src/db/`, sibling cu
`migrations/` — daca fisierul nu are deja pattern-ul `__testDir`, foloseste-l pe
cel din `rnpmDb.test.ts`: `typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url))`.)

Run: `npm run test:backend -- src/db/backup.test.ts -t "ledger"` +
`npm run test:backend -- src/db/rnpmBackup.test.ts -t "hash forjat"`
Expected: FAIL pe forjari/gaura/versiune-0 (restore-ul reuseste azi); sentinel +
fara-tabela trec (regresie).

- [ ] **3.2 (green): validator cu prefix contiguu + hook verifyStaged + rethrow tipat in staging**

(1) In `backup.ts` — import `BACKFILL_SENTINEL` linga `discoverMigrations`:

```ts
// Rev. 3 (Codex H1): ledger-ul copiei staged trebuie sa fie COERENT cu
// migratiile cunoscute — aceleasi invariants ca runner-ul de la boot: hash
// exact sau variantele de self-heal (raw/crlf), sentinel de backfill DOAR pe
// versiunea 1, si (fix panel-pe-plan) PREFIX CONTIGUU 1..N: un ledger care
// "incepe" la versiunea 3 ar lasa runner-ul sa aplice 1-2 peste o schema
// existenta. Limita asumata: un ledger corect forjat peste o schema alterata
// NU e prins (ar cere reconstructie structurala); recuperarea ramane
// pre-restore snapshot-ul.
function makeLedgerValidator(migrationsDir: string): (staged: Database.Database) => void {
  return (staged) => {
    const hasTable = staged
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_versions'")
      .get();
    if (!hasTable) return; // lipsa tabelei e decisa de validarile per-target existente
    const known = new Map(discoverMigrations(migrationsDir).map((f) => [f.version, f]));
    const rows = staged
      .prepare("SELECT version, sha256_up FROM _schema_versions ORDER BY version")
      .all() as Array<{ version: number; sha256_up: string }>;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.version !== i + 1) {
        throw new BackupValidationError(
          `Ledger-ul de migratii al backup-ului nu e contiguu (asteptat ${i + 1}, gasit ${row.version}) — ` +
            "fisier alterat sau instalare incompatibila; restore refuzat fail-closed."
        );
      }
      const file = known.get(row.version);
      if (!file) {
        throw new BackupValidationError(
          `Backup-ul are versiunea de schema ${row.version}, necunoscuta acestei aplicatii. Actualizeaza aplicatia inainte de restore.`
        );
      }
      const ok =
        row.sha256_up === file.sha256 ||
        row.sha256_up === file.sha256Raw ||
        row.sha256_up === file.sha256Crlf ||
        (row.version === 1 && row.sha256_up === BACKFILL_SENTINEL);
      if (!ok) {
        throw new BackupValidationError(
          `Ledger-ul de migratii al backup-ului nu corespunde migratiilor cunoscute (versiunea ${row.version}). ` +
            "Fisierul pare alterat sau provine dintr-o instalare incompatibila — restore refuzat fail-closed."
        );
      }
    }
  };
}
```

(2) `RestoreTargetSpec` primeste `verifyStaged?: (staged: Database.Database) => void;`
si `restoreTargetImpl`, in staging, imediat DUPA
`stagedDb.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();`:

```ts
      // Rev. 3: validari per-target pe copia STAGED (vad si continutul absorbit
      // din WAL-ul bundle-urilor legacy); orice throw = staging esuat, live neatins.
      t.verifyStaged?.(stagedDb);
```

(3) **BLOCKER-ul panelului:** in catch-ul FAZEI DE STAGING din `restoreTargetImpl`
(cel care face `rm` pe stagingDir si arunca "Restore esuat la staging"), imediat
dupa cleanup + logBackupEvent, INAINTE de `throw new Error(...)`:

```ts
    // Fix panel-pe-plan (BLOCKER): erorile de VALIDARE isi pastreaza tipul —
    // altfel code-ul INVALID_PARAMS moare aici si rutele raspund 500, nu 400.
    if (e instanceof BackupValidationError) throw e;
```

(4) Callerii:
- `restoreFromBackup`:

```ts
          verifyStaged: (staged) => {
            assertBackupNotPreSplit(staged);
            makeLedgerValidator(MIGRATIONS_DIR)(staged);
          },
```

  (pre-split PRIMUL — mesajul lui are prioritate; STERGE conectarea temporara
  pe sursa din Task 2.2 daca a fost folosita.)
- `restoreRnpmFromBackup`: `verifyStaged: makeLedgerValidator(MIGRATIONS_RNPM_DIR),`
  (verificarea de EXISTENTA a tabelei la rnpm ramane cea de pe sursa,
  `assertRnpmBackupVersionCompatible`).

- [ ] **3.3: ruleaza — trebuie sa treaca (inclusiv 400-urile din Task 2, acum prin staged)**

Run: `npm run test:backend -- src/db/backup.test.ts src/db/rnpmBackup.test.ts src/db/rnpmFullFlow.test.ts`
Expected: PASS integral (legacy-bundle cu sentinel ramane verde: v1 sentinel +
fara alte versiuni = prefix contiguu de lungime 1).

---

### Task 4: Reconcilierea ownerilor la resume-ul wiping (Codex M1 + panel, convergent)

**Files:**
- Modify: `backend/src/db/rnpmSplitter.ts`
- Test: `backend/src/db/rnpmSplitter.test.ts`

**Confirmat pe cod:** `verifyWipingResume` itereaza DOAR `marker.owners` — un marker
`wiping` semantic valid dar incomplet (`owners: []`, `manifest: {}`) trece, dupa
care `wipeMonolithRnpm` sterge TOT, inclusiv ownerii necopiati. Functia e
PRIVATA (nu e exportata) — verifica totusi cu
`Grep "verifyWipingResume" backend/src` ca nu exista call-site-uri de test directe.

**Interfaces:**
- `verifyWipingResume(marker: SplitMarker, mono: Database.Database): void` —
  semnatura EXTINSA; callerul (branch-ul `wiping`) paseaza `mono`.

- [ ] **4.1 (red): teste**

In `rnpmSplitter.test.ts`, in describe-ul "marker fail-closed + manifest (Task 3)":

```ts
it("(i) marker wiping cu owners GOL dar monolit plin => ABORT, monolit NEGOLIT", () => {
  const { before } = makeWipingMarker();
  const marker = JSON.parse(fs.readFileSync(markerPath(), "utf8"));
  marker.owners = [];
  marker.manifest = {};
  fs.writeFileSync(markerPath(), JSON.stringify(marker));

  expect(() => runRnpmSplitIfNeeded()).toThrow(/RUNBOOK/);
  expect(monoCounts()).toEqual(before);
});

it("(j) marker wiping cu un owner OMIS => ABORT, monolit NEGOLIT", () => {
  const { before } = makeWipingMarker();
  const marker = JSON.parse(fs.readFileSync(markerPath(), "utf8"));
  marker.owners = ["userA"]; // userB omis, desi monolitul il are
  marker.manifest = { userA: marker.manifest.userA };
  fs.writeFileSync(markerPath(), JSON.stringify(marker));

  expect(() => runRnpmSplitIfNeeded()).toThrow(/RUNBOOK/);
  expect(monoCounts()).toEqual(before);
});
```

Run: `npm run test:backend -- src/db/rnpmSplitter.test.ts -t "OMIS"` (si "(i)")
Expected: FAIL — resume-ul trece si goleste monolitul.

- [ ] **4.2 (green): deriva ownerii din monolit si cere acoperire completa**

Extinde semnatura si, in `verifyWipingResume`, dupa verificarea manifestului,
INAINTE de bucla pe `marker.owners`:

```ts
  // Rev. 3 (convergent Codex + panel): marker-ul nu e crezut pe cuvant nici la
  // ACOPERIRE — ownerii se deriva din monolit (aceeasi interogare ca
  // preflight-urile) si fiecare trebuie enumerat in marker.owners. Un marker
  // incomplet (ex. owners:[]) ar fi golit si datele necopiate.
  const monoOwners = mono
    .prepare("SELECT owner_id FROM rnpm_searches UNION SELECT owner_id FROM rnpm_avize")
    .all()
    .map((r) => (r as { owner_id: string }).owner_id);
  for (const o of monoOwners) {
    if (!marker.owners.includes(o)) {
      abort(`ownerul ${o} exista in monolit dar lipseste din marker.owners (marker incomplet sau forjat)`);
    }
  }
```

Callerul devine `verifyWipingResume(marker, mono);`.

- [ ] **4.3: ruleaza — trebuie sa treaca**

Run: `npm run test:backend -- src/db/rnpmSplitter.test.ts`
Expected: PASS integral (regresiile (e)-(h) neschimbate).

---

### Task 5: Durabilitate mecanica pe cai de publish (panel MEDIUM convergent + LOW)

**Files:**
- Modify: `backend/src/db/backup.ts`, `backend/src/db/rnpmSplitter.ts`
- Test: `backend/src/db/rnpmBackup.test.ts`

**Confirmat pe cod:** `snapshotViaVacuumIntoAsync` publica cu `fs.renameSync` fara
retry EPERM/EBUSY (toate backup-urile trec pe aici); `writeMarker` foloseste
`fs.renameSync` fara retry-ul sync existent in acelasi fisier; `pruneOld` are
guard mort `&& !res.manual.test(f)`.

- [ ] **5.1 (red): test retry pe publish-ul snapshot-ului**

In `rnpmBackup.test.ts`:

```ts
it("publish-ul snapshot-ului reincearca pe EPERM tranzitoriu (backup manual reuseste)", async () => {
  seedSearch("u1", "a");
  const realRename = fsPromises.rename.bind(fsPromises);
  let failed = false;
  vi.spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
    if (!failed && String(from).endsWith(".db.tmp")) {
      failed = true;
      throw Object.assign(new Error("EPERM tranzitoriu simulat"), { code: "EPERM" });
    }
    return realRename(from as Parameters<typeof realRename>[0], to as Parameters<typeof realRename>[1]);
  });

  const { name } = await createRnpmManualBackup("u1");
  expect(failed).toBe(true); // rename-ul async chiar e pe drumul critic acum
  expect(fs.existsSync(path.join(getRnpmBackupDir("u1"), name))).toBe(true);
});
```

Run: `npm run test:backend -- src/db/rnpmBackup.test.ts -t "EPERM tranzitoriu (backup"`
Expected: FAIL — publish-ul e `fs.renameSync` (spy-ul nu e atins; `failed` ramane false).

- [ ] **5.2 (green): rename async cu retry + curatenie**

In `snapshotViaVacuumIntoAsync`: `fs.renameSync(tmp, dest);` devine
`await renameWithRetryAsync(tmp, dest);`. In `rnpmSplitter.writeMarker`:
`fs.renameSync(tmp, p);` devine `renameWithRetry(tmp, p);`. In `pruneOld`:

```ts
  const preMigration = all
    .filter((f) => res.preMigration.test(f))
    .sort()
    .reverse();
```

(guard-ul `!res.manual.test(f)` era mort — un nume `manual-*` nu poate incepe cu
`pre-`; excluderile reale sunt in regex din Rev. 2.)

- [ ] **5.3: ruleaza — trebuie sa treaca**

Run: `npm run test:backend -- src/db/rnpmBackup.test.ts src/db/backup.test.ts src/db/rnpmSplitter.test.ts`
Expected: PASS integral.

---

### Task 6: Lifecycle worker — settle strict dupa terminate + integrity in worker (Codex M2 + panel, strategie unica)

**Files:**
- Modify: `backend/src/util/snapshotRunner.ts`, `backend/src/util/snapshot-worker.cjs`,
  `backend/src/db/backup.ts`
- Test: `backend/src/util/snapshotRunner.test.ts`

**Confirmat pe cod:** (a) `finish()` porneste `worker.terminate()` fire-and-forget
si settle-uieste imediat — la timeout, VACUUM-ul nativ poate continua DUPA
eliberarea maintenance lock-ului; (b) `verifySnapshot` ruleaza integrity_check
SINCRON pe main thread dupa fiecare snapshot.

**Strategie UNICA (fix panel-pe-plan, in locul cap-ului de 30s + timer):** settle-ul
are loc STRICT dupa `await worker.terminate()` — fara plafon in runner. Un
terminate blocat in cod nativ tine promisiunea operatiei pending, deci si
maintenance lock-ul HELD (semantica corecta: fisierele chiar sunt in uz);
plafonul de shutdown exista deja in `waitForBackupToSettle(30s)`. Fara
Promise.race => nu exista timer pierdut de curatat si nici warn fals.

**Interfaces:**
- Worker: `{ ok: true }` DOAR daca si `PRAGMA integrity_check` pe DEST intoarce
  "ok"; `{ error }` altfel (integrity muta IN worker).
- Runner: contract la resolve = dest INTEGRITY-VERIFIED (worker sau fallback-ul
  sincron, care face verificarea inline); la timeout/error post-ready, settle
  DUPA terminate confirmat.
- `__setSnapshotWorkerTimeoutForTests(ms: number | null): void` — export nou.
- backup.ts: `assertSnapshotNonEmpty(p: string, label: string): void` inlocuieste
  `verifySnapshot` pe caile post-runner.

- [ ] **6.1 (test de REGRESIE, exceptie TDD documentata): timeout => reject dupa worker mort**

Ordinea settle-vs-terminate nu are un red determinist ieftin (terminate-ul unui
worker idle e cvasi-instant); testul de mai jos e GARD DE REGRESIE — daca trece
si inainte de green, consemneaza in raport si mergi mai departe (NU forta un red
artificial):

```ts
import {
  __setSnapshotWorkerPathForTests,
  __setSnapshotWorkerTimeoutForTests,
  runSnapshotOp,
} from "./snapshotRunner.ts";

afterEach(() => {
  __setSnapshotWorkerPathForTests(null);
  __setSnapshotWorkerTimeoutForTests(null);
});

it("la timeout, reject-ul vine DUPA terminarea confirmata a worker-ului (regresie)", async () => {
  const src = path.join(tmpRoot, "src.db");
  seedDb(src, 5);
  // Worker conform protocolului (posteaza ready), care apoi NU mai raspunde —
  // timeout-ul e singura iesire; NU posteaza ok/error.
  const busyWorker = path.join(tmpRoot, "busy-worker.cjs");
  fs.writeFileSync(
    busyWorker,
    "const { parentPort } = require('node:worker_threads');\n" +
      "parentPort.postMessage({ ready: true });\n" +
      "setInterval(() => {}, 1000);\n"
  );
  __setSnapshotWorkerPathForTests(busyWorker);
  __setSnapshotWorkerTimeoutForTests(300);

  await expect(
    runSnapshotOp({ op: "vacuum_into", srcPath: src, destPath: path.join(tmpRoot, "d.db") })
  ).rejects.toThrow(/timeout/);
  // Dupa reject, worker-ul e MORT: tmpdir-ul se sterge fara EBUSY.
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-snapworker-"));
});
```

- [ ] **6.2 (green): finish async fara plafon + timeout configurabil**

In `runSnapshotOp`:

```ts
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Settle STRICT dupa terminate confirmat (Codex M2): la timeout,
      // VACUUM-ul nativ poate inca tine fisierele; fara asteptare, maintenance
      // lock-ul se elibereaza si o operatie noua ar intra peste tmp-ul viu.
      // FARA plafon aici (strategie unica, fix panel-pe-plan): un terminate
      // blocat tine promisiunea pending si lock-ul held — semantica corecta;
      // plafonul de shutdown traieste in waitForBackupToSettle.
      void worker
        .terminate()
        .catch(() => {
          /* best-effort */
        })
        .then(fn);
    };
```

si:

```ts
let timeoutOverrideForTests: number | null = null;
export function __setSnapshotWorkerTimeoutForTests(ms: number | null): void {
  timeoutOverrideForTests = ms;
}
// in runSnapshotOp:
const timeoutMs = timeoutOverrideForTests ?? SNAPSHOT_WORKER_TIMEOUT_MS;
const timer = setTimeout(() => {
  finish(() => reject(new Error(`[snapshot] worker timeout dupa ${timeoutMs}ms (${op.op})`)));
}, timeoutMs);
```

(`fallback` din Task 1 ramane cu terminate best-effort SINCRON-settle — exceptie
ASUMATA: pre-ready worker-ul nu a deschis fisiere, deci nu exista suprapunere pe
dest; comenteaza explicit.)

- [ ] **6.3 (green): integrity in worker + fallback sincron cu verificare inline + assertSnapshotNonEmpty**

(1) In `snapshot-worker.cjs`, dupa `db.prepare("VACUUM INTO ?").run(op.destPath);`:

```js
    // Rev. 3 (panel): integrity_check pe DEST ruleaza tot in worker — pe main
    // thread ar re-bloca event loop-ul cu un full-scan comparabil cu VACUUM-ul.
    let probe = null;
    try {
      probe = new Database(op.destPath, { readonly: true, fileMustExist: true });
      const rows = probe.prepare("PRAGMA integrity_check").all();
      if (rows.length !== 1 || rows[0].integrity_check !== "ok") {
        return { error: `[snapshot-worker] integrity_check a esuat pe ${op.destPath}` };
      }
    } finally {
      if (probe) {
        try {
          probe.close();
        } catch {
          /* best-effort */
        }
      }
    }
    return { ok: true };
```

(2) In `snapshotRunner.ts`, `runSnapshotOpSync` primeste EXPLICIT aceeasi
verificare (contractul "dest verificat la resolve" tine si pe fallback):

```ts
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
  // Mod degradat (worker indisponibil): verificarea ruleaza sincron pe main
  // thread — acelasi contract ca worker-ul, doar blocant.
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
```

(3) In `backup.ts`:

```ts
// Verificare usoara post-runner: integritatea e garantata de contractul
// runSnapshotOp (worker sau fallback); aici ramane doar plasa pe fisier gol.
function assertSnapshotNonEmpty(p: string, label: string): void {
  const size = fs.statSync(p).size;
  if (size <= 0) throw new Error(`[backup] snapshot gol (${label})`);
}
```

Inlocuieste `verifySnapshot(tmp, name)` cu `assertSnapshotNonEmpty(tmp, name)` in
`snapshotViaVacuumIntoAsync` si `verifySnapshot(tmp, path.basename(dbPath))` cu
`assertSnapshotNonEmpty(tmp, path.basename(dbPath))` in `compactRnpmDbViaWorker`.
Apoi `Grep "verifySnapshot" backend/src` — daca a ramas fara calleri, STERGE
functia (orfan al schimbarii).

- [ ] **6.4: ruleaza — trebuie sa treaca**

Run: `npm run test:backend -- src/util/snapshotRunner.test.ts src/db/rnpmBackup.test.ts src/db/backup.test.ts`
Expected: PASS integral (testele Rev. 2 verifica independent count + integritate
pe dest — raman garzile externe).

---

### Task 7: Batch LOW (panel) — context de eroare, compacted flag, asertii moarte, teste de gard

**Files:**
- Modify: `backend/src/db/backup.ts`, `backend/src/routes/rnpm.ts`
- Test: `backend/src/db/backup.test.ts`, `backend/src/db/rnpmBackup.test.ts`,
  `backend/src/routes/rnpmBackups.contract.test.ts`

- [ ] **7.1 (red+green): auto-revert dublu-esuat — context complet + cod tipat pastrat**

Red (in `rnpmBackup.test.ts`, describe-ul de staging):

```ts
it("esec post-publish + auto-revert esuat => eroarea numeste pre-restore snapshot-ul", async () => {
  seedSearch("u1", "a");
  const { name } = await createRnpmManualBackup("u1");
  seedSearch("u1", "b");
  __resetRnpmDbForTests();

  const realCopy = fsPromises.copyFile.bind(fsPromises);
  vi.spyOn(fsPromises, "copyFile").mockImplementation(async (from, to, mode?) => {
    if (String(to).endsWith(".revert-tmp")) {
      throw Object.assign(new Error("ENOSPC simulat la revert"), { code: "ENOSPC" });
    }
    return realCopy(from as Parameters<typeof realCopy>[0], to as Parameters<typeof realCopy>[1], mode);
  });

  await expect(
    restoreRnpmFromBackup("u1", name, {
      onPhase: (phase) => {
        if (phase === "post_publish") throw new Error("failpoint post_publish");
      },
    })
  ).rejects.toThrow(/AUTO-REVERT|pre-restore/i);
});
```

Expected red: mesajul actual e doar "failpoint post_publish". Green — in
`restoreTargetImpl`, in catch-ul post-publish, blocul `catch (revertErr)` devine:

```ts
        } catch (revertErr) {
          logBackupEvent({
            action: "restore_failed",
            target: t.key,
            source: name,
            stage: "auto_revert",
            reason: revertErr instanceof Error ? revertErr.message : String(revertErr),
          });
          // Rev. 3 (panel): dublu-esec = baza live e cea INVALIDA — callerul
          // afla ca revert-ul a esuat si UNDE e copia de recuperare. Code-ul
          // tipat al erorii ORIGINALE se pastreaza (nu se pierde clasificarea
          // 409/503/400 in handlerul central).
          const combined = new Error(
            `${e instanceof Error ? e.message : String(e)} — AUTO-REVERT ESUAT (${revertErr instanceof Error ? revertErr.message : String(revertErr)}). ` +
              `Recuperare manuala din snapshot-ul pre-restore: ${preRestoreName}`
          );
          const origCode = (e as { code?: unknown })?.code;
          if (typeof origCode === "string") {
            (combined as unknown as { code: string }).code = origCode;
          }
          throw combined;
        }
      }
      // Rev. 3 (panel LOW): eroarea ORIGINALA se propaga cu tot cu `code`-ul
      // ei tipat, nu o copie doar cu mesajul.
      throw e instanceof Error ? e : new Error(String(e));
```

(ultimul rand inlocuieste `throw new Error(e instanceof Error ? e.message : String(e));`.)

- [ ] **7.2 (red+green): `DELETE /saved/all` raporteaza compacted**

Red (in `rnpmBackups.contract.test.ts`):

```ts
it("DELETE /saved/all raporteaza si compacted (compactarea e best-effort, dar vizibila)", async () => {
  seedRnpm("u1", "a");
  const res = await buildApp("u1").request("/api/rnpm/saved/all", { method: "DELETE", headers: DESKTOP });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { deleted: number; compacted: boolean };
  expect(body.compacted).toBe(true);
});
```

Green — in ruta:

```ts
  let compacted = true;
  try {
    await compactRnpmDbViaWorker(ownerId);
  } catch (e) {
    compacted = false;
    console.warn("[rnpm] compact after delete-all failed:", e);
  }
```

si raspunsul devine `return c.json({ deleted: count, compacted });`.
INAINTE de green: `Grep "saved/all" frontend/src` — camp aditiv; daca UI-ul face
match strict pe shape (`toEqual` in teste frontend), adapteaza si acolo (atunci
gate-ul final include si testele frontend).

- [ ] **7.3: asertia moarta din backup.test.ts + gardul anti-clobber (test de REGRESIE, exceptie TDD)**

(1) In `backup.test.ts`, testul "does not leave a half-written tmp file..." —
inlocuieste `expect(fs.existsSync(dbPath + ".restore.tmp")).toBe(false);` cu:

```ts
    expect(fs.existsSync(`${dbPath}.restore-staging`)).toBe(false);
```

(DOAR staging-ul — fix panel-pe-plan: asertii pe absenta sidecar-urilor live ar
fi fragile si conceptual gresite; numele vechi `.restore.tmp` nu mai e produs de
implementarea pe staging, asertia trecea trivial.)

(2) In `rnpmBackup.test.ts`, gard NOU pe anti-clobber-ul latch-ului (exista deja
in cod — test de REGRESIE, exceptie TDD documentata; `beginRnpmRestore`/
`endRnpmRestore` sunt deja importate in fisier, adauga `isRnpmRestoreInProgress`):

```ts
it("compact refuzat sub latch-ul de restore NU curata latch-ul strain (anti-clobber)", async () => {
  seedSearch("u1", "a");
  beginRnpmRestore("u1");
  try {
    await expect(compactRnpmDbViaWorker("u1")).rejects.toMatchObject({ code: "RESTORE_IN_PROGRESS" });
    expect(isRnpmRestoreInProgress("u1")).toBe(true); // latch-ul ramane al restore-ului
  } finally {
    endRnpmRestore("u1");
  }
});
```

- [ ] **7.4 (imbunatatire de DETERMINISM, nu red — fix panel-pe-plan): testul de settle-peste-worker pe worker lent**

Testul existent "(e) waitForBackupToSettle acopera si snapshot-ul din worker in
zbor" poate trece fara fereastra reala daca VACUUM-ul e rapid. Inlocuieste-i
corpul cu varianta pe worker LENT prin hook (fixture conform protocolului ready
+ integrity din Task 1/6; path-ul absolut al lui better-sqlite3 e injectat ca
worker-ul din tmpdir sa nu esueze pe rezolutia bare-specifier — un esec de
require ar activa silentios fallback-ul si ar anula fereastra):

```ts
it("(e) waitForBackupToSettle acopera si snapshot-ul din worker in zbor (worker lent, determinist)", async () => {
  seedSearch("u1", "a");
  const bsqlPath = require.resolve("better-sqlite3").replace(/\\/g, "\\\\");
  const slowWorker = path.join(tmpRoot, "slow-worker.cjs");
  fs.writeFileSync(
    slowWorker,
    "const { parentPort, workerData } = require('node:worker_threads');\n" +
      `const Database = require("${bsqlPath}");\n` +
      "parentPort.postMessage({ ready: true });\n" +
      "const db = new Database(workerData.srcPath, { readonly: true, fileMustExist: true });\n" +
      "db.prepare('VACUUM INTO ?').run(workerData.destPath);\n" +
      "db.close();\n" +
      "const probe = new Database(workerData.destPath, { readonly: true });\n" +
      "probe.prepare('PRAGMA integrity_check').all();\n" +
      "probe.close();\n" +
      "setTimeout(() => parentPort.postMessage({ ok: true }), 400);\n"
  );
  __setSnapshotWorkerPathForTests(slowWorker);
  try {
    let done = false;
    const op = createRnpmManualBackup("u1").then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 50));

    let settled = false;
    const wait = waitForBackupToSettle(30_000).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false); // fereastra garantata de worker-ul lent

    await op;
    await wait;
    expect(done).toBe(true);
    expect(settled).toBe(true);
  } finally {
    __setSnapshotWorkerPathForTests(null);
  }
});
```

(daca `rnpmBackup.test.ts` ruleaza in ESM fara `require`, foloseste
`createRequire(import.meta.url)` sau pattern-ul `__testDir` existent; importa
`__setSnapshotWorkerPathForTests` din `../util/snapshotRunner.ts`.)

- [ ] **7.5: ruleaza tot ce e atins**

Run: `npm run test:backend -- src/db/backup.test.ts src/db/rnpmBackup.test.ts src/routes/rnpmBackups.contract.test.ts src/util/snapshotRunner.test.ts`
Expected: PASS integral.

---

### Task 8: Gate final + docs + COMMIT D

**Files:**
- Modify: `CHANGELOG.md`, `SESSION-HANDOFF.md`

- [ ] **8.1: gate complet**

Run, in ordine (toate verzi):
1. `npx biome check --write <toate fisierele atinse>` (re-stage ce reformateaza)
2. `npx tsc --noEmit -p backend/tsconfig.json`
3. `npm run build` (verifica `dist-backend/snapshot-worker.cjs`)
4. `npm run test:backend` (suita completa de la zero; + frontend daca 7.2 a atins UI)
5. `npm run rebuild:electron`
6. Smoke pe bundle (scriptul `smoke-bundle-taskC.mjs` din scratchpad sau
   echivalent): boot + create/restore/compact + zero `snapshot.worker_fallback`.

- [ ] **8.2: docs**

CHANGELOG.md — la finalul sub-sectiunii "Fixuri post-review adversarial
(pre-merge)" din v2.43.0, paragraf nou:

```markdown
**Runda finala (Rev. 3).** Review-ul adversarial FINAL (Codex + panel multi-model, plus review de panel pe planul de fixuri) a mai inchis: dependintele worker-ului (`bindings`, `file-uri-to-path`) excluse din asar + handshake `ready` cu fallback sincron pe esecul ASINCRON de startup (in Electron impachetat worker-ul ar fi fost mut, iar restore-ul imposibil); refuz 400 direct la restaurarea unui monolit pre-split dupa split, inclusiv pe marker ilizibil (inainte, "succes" urmat de boot blocat); validarea ledger-ului de migratii pe copia staged (hash-uri cu variantele de self-heal, sentinel de backfill, prefix contiguu 1..N), cu pastrarea erorilor tipate prin faza de staging; reconcilierea ownerilor din monolit cu marker-ul la reluarea golirii (un marker incomplet nu mai poate goli date necopiate); retry pe publish-ul snapshot-urilor; settle strict dupa terminate confirmat la timeout-ul worker-ului si integrity_check mutat in worker; context complet de eroare la auto-revert dublu-esuat si camp `compacted` pe stergerea totala.
```

SESSION-HANDOFF.md — actualizeaza sectiunea sprintului: Rev. 3 executat (commit
D), verdictele review-urilor, si release checklist-ul ramas (smoke pe artefact
Electron IMPACHETAT: backup/restore/compact din app.asar.unpacked).

- [ ] **8.3: COMMIT D (singurul commit al rundei)**

```bash
git add package.json backend/src/util/snapshotRunner.ts backend/src/util/snapshot-worker.cjs backend/src/util/snapshotRunner.test.ts backend/src/db/backup.ts backend/src/db/backup.test.ts backend/src/db/rnpmBackup.test.ts backend/src/db/rnpmSplitter.ts backend/src/db/rnpmSplitter.test.ts backend/src/routes/rnpm.ts backend/src/routes/rnpmBackups.contract.test.ts CHANGELOG.md SESSION-HANDOFF.md RUNBOOK.md
git commit -m "fix(rnpm-split): Rev. 3 — worker viabil in asar cu handshake ready, gate restore pre-split, validare ledger pe staged, reconciliere owneri la wiping"
```

(enumerarea exacta se ajusteaza la fisierele REAL atinse; niciodata `-A`.)

---

## Findings RESPINSE cu dovezi (nu se implementeaza)

1. **DeepSeek "race pe cooldown-ul de backup"** — fals; secventa get -> check ->
   set e integral SINCRONA (atomica pe event loop). Respins si de sinteza panelului.
2. **DeepSeek "fallback-ul sincron neaga worker-ul; inlocuiti cu reject"** —
   respins de sinteza: fallback-ul exista exact pentru esecul de packaging; un
   backup degradat-dar-functional bate "niciun backup si restore imposibil".
3. **Kimi "DELETE /saved/all = HIGH"** — demotat de sinteza la LOW; tratat cu
   camp `compacted` (Task 7.2).
4. **GPT-5.6 (panel-pe-plan) "bindings lipsa soseste ca mesaj `{error}`, nu ca
   eveniment error"** — respins de sinteza cu dovada: `require('better-sqlite3')`
   e TOP-LEVEL in worker (in afara try-ului), deci MODULE_NOT_FOUND arunca la
   LOAD => eveniment `error` pre-ready; fallback-ul il acopera.
5. **DeepSeek (panel-pe-plan) "schimbarea semnaturii verifyWipingResume rupe
   teste existente"** — speculativ; functia e PRIVATA (neexportata). Ramane
   pasul de verificare cu Grep in Task 4.

## Acceptate ca limitari documentate (fara cod nou in aceasta runda)

- **Ledger corect forjat peste schema alterata** nu e prins de Task 3 (ar cere
  reconstructie structurala completa); recuperarea ramane pre-restore snapshot-ul.
- **Fallback-ul pre-ready settle-uieste sincron** (nu asteapta terminate):
  exceptie asumata — worker-ul de startup esuat nu a deschis fisiere, iar
  `runSnapshotOpSync` face unlink pe dest inainte. Comentata in cod (Task 6.2).
- **Smoke pe artefact Electron IMPACHETAT** ramane pe checklist-ul de release —
  Task 1 reduce riscul pe ambele brate (unpack corect + fallback pe esecul ramas).
- **Integrity-in-worker fara test dedicat de dest corupt** — nereproductibil
  determinist; garzile externe raman testele Rev. 2 (count + integritate pe dest).
- **Task 6.1 si 7.3(2) sunt teste de REGRESIE** (exceptii TDD documentate) —
  ordinea settle/terminate si anti-clobber-ul nu au red determinist ieftin.
- Limitarile din Rev. 2 raman in vigoare.

## Istoric review

- **Rev. 3 initial:** consolidarea review-ului adversarial final pe delta Rev. 2
  (`485c455..f29e510`): Codex GPT-5.6 Sol (`review-mresqsud-5igk0y`, NO-SHIP:
  3 HIGH, 2 MEDIUM) + review-panel multi-model (sinteza: 5 MEDIUM, ~6 LOW).
  Findings-urile HIGH REVERIFICATE pe cod inainte de plan (inclusiv lantul
  better-sqlite3 -> bindings -> file-uri-to-path).
- **Rev. 3 CORECTAT (acest fisier), dupa review-ul PANELULUI PE PLAN** (Opus +
  GPT-5.6 Sol + Kimi + GLM + DeepSeek, sinteza Fable): BLOCKER — catch-ul de
  staging distrugea `code`-ul erorilor de validare (rethrow tipat adaugat in
  3.2); handshake `ready` pe worker (fallback doar pe esec de STARTUP; exit 0
  fara mesaj = reject); prefix contiguu 1..N la validarea ledger-ului + teste
  de gaura/versiune-0; marker ilizibil = fail-closed la gate-ul pre-split +
  LIKE cu ESCAPE pe `rnpm\_%`; strategie unica la terminate (fara cap de 30s
  => dispare si timer-ul necurat); snippet explicit pentru integrity in
  fallback-ul sincron; ordinea verifyStaged (pre-split inaintea ledger-ului);
  fixture-uri idempotente (IF NOT EXISTS / INSERT OR REPLACE); 6.1, 7.3(2) si
  7.4 reclasificate onest (regresie/determinism, nu red); asertii 7.3 reduse la
  staging-dir (fara sidecars live); asarUnpack aplicat ADITIV; path absolut
  better-sqlite3 in fixture-ul worker-ului lent. Respinse: #4 si #5 de mai sus.
