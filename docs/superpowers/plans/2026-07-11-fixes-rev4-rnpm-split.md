# Fixuri Rev. 4 — review adversarial Codex pe intreg branch-ul v2.43.0

> **Pentru agentul executant:** REQUIRED SUB-SKILL: superpowers:executing-plans.
> TDD strict (red confirmat inainte de green). UN SINGUR commit consolidat
> (COMMIT E) la final, apoi review adversarial Codex de INCHIDERE pe delta.

**Goal:** inchide cele 4 findings confirmate din review-ul adversarial Codex pe
intreg branch-ul (`aac59da..ccab664`, raport `review-mrfijdtk-6hpgld`, verdict
NO-SHIP): 1 HIGH (exclusivitate multi-proces la split) + 3 MEDIUM (audit
post-restore care rastoarna rezultatul, coliziune de nume la backup manual,
retentie care raporteaza stergeri inexistente). Securitatea si arhitectura au
iesit curate — nu se atinge nimic in plus.

**Architecture:** fixuri chirurgicale; niciun protocol nou. Task 1 schimba O
CONDITIE in instanceLock (PID viu pe acelasi host = nu se recupereaza automat);
restul sunt mecanice pe pattern-uri deja stabilite in branch (recordAuditSafe,
sufix incremental la nume, ENOENT-only swallow).

**Tech Stack:** Node 22 + Hono + better-sqlite3 12, Vitest, Biome.

## Constrangeri globale (identice cu Rev. 2/3)

- Romana FARA diacritice in cod sursa; envelope standard pe erori HTTP.
- SQL raw DOAR in `backend/src/db/**`; CJS-safe (pattern `typeof __dirname`).
- Gate-uri inainte de commit: biome pe fisierele atinse, tsc backend,
  `npm run build`, `npm run test:backend` de la zero.
- Branch: `feat/v2.43.0-rnpm-split`. NU push fara cerere explicita.
- UN SINGUR commit consolidat (COMMIT E) la finalul Task 5.
- Dupa teste Node pe better-sqlite3: `npm run rebuild:electron` la final.
- Numerele de linie sunt ORIENTATIVE — localizeaza dupa simbol/continut.

---

### Task 1: instanceLock — PID viu pe acelasi host NU se recupereaza automat (Codex HIGH)

**Files:**
- Modify: `backend/src/db/instanceLock.ts:106-116`
- Create: `backend/src/db/instanceLock.test.ts` (NU exista test dedicat azi)

**Confirmat pe cod:** `alive = sameHost ? processAlive(pid) : !stale;` urmat de
`if (alive && !stale) throw` — pe acelasi host, un PID VIU cu heartbeat stale
(>30s = `STALE_FACTOR(6) * HEARTBEAT_MS(5000)`) pica pe ramura de reclaim.
Split-ul sincron de la boot blocheaza event loop-ul (deci si heartbeat-ul
setInterval) exact atat pe baze mari; un al doilea proces pornit intre timp
(docker restart, `node dist-backend` orfan — a existat unul real in sesiunile
precedente) fura lock-ul si opereaza pe aceleasi fisiere SQLite.

**Semantica noua:**
- acelasi host + PID viu => REFUZ neconditionat (indiferent de heartbeat);
  mesajul de eroare primeste hint-ul de break-glass cand heartbeat-ul e stale.
- acelasi host + PID mort => reclaim (neschimbat — indiferent de heartbeat).
- cross-host => heartbeat-ul ramane singurul criteriu (neschimbat; PID-ul nu e
  verificabil peste host).
- **`processAlive` devine fail-closed (fix panel-pe-plan):** DOAR `ESRCH`
  inseamna "mort"; `EPERM` (proces viu sub alta identitate OS) si orice alta
  eroare = "posibil viu" => refuz. Azi, ORICE throw al lui
  `process.kill(pid, 0)` e tratat ca mort — gaura reziduala care ar fi lasat
  reclaim-ul peste un proces viu inaccesibil.
- `LEGAL_DASHBOARD_FORCE_BOOT=1` ramane singura cale de reclaim peste un PID
  viu (mecanism existent, cu audit).
- Limita ASUMATA (documentata in cod): PID reuse — un proces STRAIN care a
  primit intre timp pid-ul unei instante moarte tine boot-ul blocat pana la
  FORCE_BOOT; fals-pozitiv rar si sigur (fail-closed), preferabil coruperii.

**Interfaces:** nimic nou exportat; conditia + mesajul + `processAlive`.

- [ ] **1.1 (red): test file NOU `instanceLock.test.ts`**

```ts
// Rev. 4 (Codex HIGH pe branch-ul rnpm-split): exclusivitatea multi-proces pe
// acelasi host nu are voie sa cada pe heartbeat — split-ul sincron de la boot
// tine event loop-ul (si heartbeat-ul) blocat legitim peste prag.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireInstanceLock, releaseInstanceLock } from "./instanceLock.ts";

let tmpRoot: string;
let originalForceBoot: string | undefined;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-instlock-"));
  originalForceBoot = process.env.LEGAL_DASHBOARD_FORCE_BOOT;
});

afterEach(async () => {
  vi.restoreAllMocks();
  releaseInstanceLock();
  if (originalForceBoot === undefined) {
    // biome-ignore lint/performance/noDelete: env unset real.
    delete process.env.LEGAL_DASHBOARD_FORCE_BOOT;
  } else {
    process.env.LEGAL_DASHBOARD_FORCE_BOOT = originalForceBoot;
  }
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function writeForeignLock(overrides: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(tmpRoot, ".instance.lock"),
    JSON.stringify({
      pid: process.pid, // pid GARANTAT viu pe acelasi host: chiar procesul de test
      hostname: os.hostname(),
      startedAt: new Date().toISOString(),
      heartbeatAt: Date.now(),
      nonce: "nonce-strain",
      ...overrides,
    })
  );
}

// Mock DETERMINIST pe process.kill(pid, 0) — fara scanare de pid-uri (fix
// panel-pe-plan: bucla de cautare a unui pid mort era teoretic epuizabila).
// DOAR probele (semnal 0) pe pid-ul tinta sunt interceptate; restul trec.
function mockPidProbe(pid: number, behavior: "esrch" | "eperm"): void {
  const realKill = process.kill.bind(process);
  vi.spyOn(process, "kill").mockImplementation(((target: number, signal?: string | number) => {
    if (target === pid && signal === 0) {
      throw Object.assign(new Error(behavior.toUpperCase()), { code: behavior.toUpperCase() });
    }
    return realKill(target, signal as never);
  }) as typeof process.kill);
}

describe("acquireInstanceLock — exclusivitate pe acelasi host (Rev. 4)", () => {
  it("PID viu + heartbeat STALE => REFUZ (nu reclaim), cu hint de FORCE_BOOT", () => {
    // Heartbeat vechi de 10 minute — mult peste STALE_FACTOR * HEARTBEAT_MS.
    writeForeignLock({ heartbeatAt: Date.now() - 10 * 60 * 1000 });

    // Asertii SEPARATE (fix panel-pe-plan): si refuzul, si hint-ul.
    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/detine lock-ul/i);
    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/FORCE_BOOT/);
    // Lock-ul strain a ramas NEATINS (nu a fost redenumit in .dead-*).
    expect(fs.existsSync(path.join(tmpRoot, ".instance.lock"))).toBe(true);
    const kept = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(kept.nonce).toBe("nonce-strain");
  });

  it("PID viu + heartbeat proaspat => REFUZ (regresie)", () => {
    writeForeignLock({});
    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/detine lock-ul/i);
  });

  it("proba de PID care da EPERM (proces viu sub alta identitate) => REFUZ fail-closed", () => {
    mockPidProbe(999_999, "eperm");
    writeForeignLock({ pid: 999_999, heartbeatAt: Date.now() - 10 * 60 * 1000 });

    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/detine lock-ul/i);
    const kept = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(kept.nonce).toBe("nonce-strain");
  });

  it("PID mort (ESRCH) => reclaim, chiar cu heartbeat PROASPAT (regresie)", () => {
    mockPidProbe(999_999, "esrch");
    writeForeignLock({ pid: 999_999, heartbeatAt: Date.now() });

    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
    const now = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(now.pid).toBe(process.pid);
  });

  it("FORCE_BOOT=1 recupereaza si peste un PID viu (break-glass, regresie)", () => {
    writeForeignLock({ heartbeatAt: Date.now() - 10 * 60 * 1000 });
    process.env.LEGAL_DASHBOARD_FORCE_BOOT = "1";
    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
  });
});

// Cross-host (fix panel-pe-plan: ramurile "neschimbate" primesc gard —
// o inversare accidentala a lui !stale ar fi trecut altfel de toata suita).
describe("acquireInstanceLock — cross-host ramane pe heartbeat (regresie)", () => {
  it("host strain + heartbeat proaspat => REFUZ", () => {
    writeForeignLock({ hostname: "alt-host-inexistent", heartbeatAt: Date.now() });
    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/detine lock-ul/i);
  });

  it("host strain + heartbeat stale => reclaim", () => {
    writeForeignLock({ hostname: "alt-host-inexistent", heartbeatAt: Date.now() - 10 * 60 * 1000 });
    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
    const now = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(now.pid).toBe(process.pid);
  });
});
```

(importa si `vi` din vitest.)

Run: `npm run test:backend -- src/db/instanceLock.test.ts`
Expected: FAIL pe testul 1 (azi, PID viu + stale = reclaim => nu arunca si
lock-ul strain e redenumit) si pe testul EPERM (azi, EPERM = "mort" => reclaim);
celelalte trec (regresii).

NOTA teste: `acquireInstanceLock` porneste heartbeat-ul (setInterval, unref) —
`releaseInstanceLock()` in afterEach il opreste si pe testele care au achizitionat
(pattern-ul din index.test.ts: fara release, heartbeat-ul orfan arunca
"ownership lost" flaky pe suita — capcana documentata in handoff).

- [ ] **1.2 (green): processAlive fail-closed + conditia + mesajul**

(1) `processAlive` — DOAR ESRCH inseamna mort:

```ts
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // Rev. 4 (panel-pe-plan): DOAR ESRCH inseamna "mort". EPERM = proces VIU
    // sub alta identitate OS; orice alta eroare = necunoscut => fail-closed
    // (posibil viu) — reclaim-ul peste un proces viu inaccesibil ar pune doua
    // procese pe aceleasi fisiere SQLite.
    return (e as NodeJS.ErrnoException)?.code !== "ESRCH";
  }
}
```

(2) In `acquireInstanceLock`, inlocuieste blocul:

```ts
      const heartbeatAge = Date.now() - existing.heartbeatAt;
      const sameHost = existing.hostname === osHostname();
      const stale = heartbeatAge > STALE_FACTOR * HEARTBEAT_MS;
      const alive = sameHost ? processAlive(existing.pid) : !stale;
      if (alive && !stale) {
        throw new Error(
          `Alt proces Legal Dashboard detine lock-ul SQLite (pid=${existing.pid}, host=${existing.hostname}).`
        );
      }
```

cu:

```ts
      const heartbeatAge = Date.now() - existing.heartbeatAt;
      const sameHost = existing.hostname === osHostname();
      const stale = heartbeatAge > STALE_FACTOR * HEARTBEAT_MS;
      // Rev. 4 (Codex HIGH): pe ACELASI host, un PID viu nu se recupereaza
      // NICIODATA automat, indiferent de heartbeat — operatiile sincrone de
      // boot (split, migratii, pre-migration backup) blocheaza legitim event
      // loop-ul (deci si heartbeat-ul setInterval) peste prag, iar un reclaim
      // ar pune DOUA procese pe aceleasi fisiere SQLite. Heartbeat-ul ramane
      // criteriul DOAR cross-host (pid-ul nu e verificabil acolo). Limita
      // asumata: PID reuse de catre un proces strain = refuz fals-pozitiv,
      // deblocabil manual (fail-closed, preferabil coruperii). Break-glass:
      // LEGAL_DASHBOARD_FORCE_BOOT=1 (cu audit).
      const blocked = sameHost ? processAlive(existing.pid) : !stale;
      if (blocked) {
        throw new Error(
          `Alt proces Legal Dashboard detine lock-ul SQLite (pid=${existing.pid}, host=${existing.hostname}` +
            `, heartbeat acum ${Math.round(heartbeatAge / 1000)}s).` +
            (stale
              ? " Heartbeat-ul e vechi dar procesul e VIU (posibil blocat intr-o operatie lunga de boot);" +
                " daca esti sigur ca e mort/blocat definitiv, opreste-l manual sau porneste cu LEGAL_DASHBOARD_FORCE_BOOT=1."
              : "")
        );
      }
```

- [ ] **1.3: ruleaza — trebuie sa treaca**

Run: `npm run test:backend -- src/db/instanceLock.test.ts` apoi
`npm run test:backend -- src/index.test.ts` (testul de remote-bind elibereaza
lock-ul in finally — neafectat, dar e consumatorul real).
Expected: PASS integral.

---

### Task 2: recordAuditSafe pe SUCCESUL restore-ului (Codex MEDIUM — rezultat rasturnat)

**Files:**
- Modify: `backend/src/routes/rnpm.ts` (POST /backups/restore, calea de succes)
- Modify: `backend/src/routes/adminBackups.ts` (POST /restore, calea de succes)
- Test: `backend/src/routes/rnpmBackups.contract.test.ts`

**Confirmat pe cod:** dupa `restoreRnpmFromBackup` REUSIT, ruta apeleaza
`recordAudit` in ACELASI try; daca auditul arunca (ex. latch-ul global al unui
restore de monolit care tocmai a intrat pe maintenance lock => `getDb()` arunca
RESTORE_IN_PROGRESS; sau un SQLITE_BUSY tranzitoriu), catch-ul clasifica si
raspunde 409/500 desi fisierul a fost DEJA restaurat — clientul poate repeta o
operatie distructiva. Aceeasi granita defecta in `adminBackups.ts`. E clasa de
bug inchisa in Rev. 2 pe admin.ts (recordAuditSafe post-mutatie) — rutele de
restore au scapat.

- [ ] **2.1 (red): test — restore reusit ramane 200 chiar daca auditul pica**

In `rnpmBackups.contract.test.ts` (describe-ul POST /backups/restore); importa
`clearMonolithRestoreInProgress, setMonolithRestoreInProgress` din
`../db/schema.ts`:

```ts
it("restore REUSIT ramane 200 chiar daca scrierea de audit pica (latch monolit activ)", async () => {
  seedRnpm("u1", "pre");
  const name = await createBackupAs("u1");
  seedRnpm("u1", "post");
  __resetRnpmDbForTests();

  // Latch-ul global al restore-ului de monolit face getDb() (deci si
  // recordAudit) sa arunce tipat — restore-ul RNPM in sine NU atinge getDb.
  setMonolithRestoreInProgress();
  try {
    const res = await buildApp("u1").request("/api/rnpm/backups/restore", {
      method: "POST",
      headers: JSON_DESKTOP,
      body: JSON.stringify({ name }),
    });
    // Mutatia s-a COMIS — raspunsul nu are voie sa o rastoarne in 409/500.
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  } finally {
    clearMonolithRestoreInProgress();
  }
  // Fisierul chiar e cel restaurat (1 rand, nu 2).
  expect((getRnpmDb("u1").prepare("SELECT COUNT(*) AS n FROM rnpm_searches").get() as { n: number }).n).toBe(1);
});
```

Run: `npm run test:backend -- src/routes/rnpmBackups.contract.test.ts -t "ramane 200"`
Expected: FAIL — azi recordAudit arunca RESTORE_IN_PROGRESS => rethrow tipat =>
409 prin handlerul central.

Note (panel-pe-plan): (a) asumptia de mediu — pe app-ul de test (desktop, fara
middleware care atinge getDb inainte de handler) latch-ul nu blocheaza cererea
inainte de restore; asertia pe continut (1 rand) ramane gardul real. (b) latch-ul
se curata OBLIGATORIU in finally (altfel otraveste toate testele urmatoare din
fisier — snippet-ul de mai sus o face deja). (c) pentru ruta ADMIN de monolit,
swap-ul e MECANIC fara red dedicat (exceptie TDD documentata): latch-ul propriu
al restore-ului de monolit e curatat inainte ca ruta sa auditeze, deci aceeasi
injectie nu functioneaza acolo; gardul de clasa e testul rnpm + simetria codului.

- [ ] **2.2 (green): swap la recordAuditSafe pe caile de succes**

In `rnpm.ts`, POST /backups/restore, calea de succes:
`recordAudit(c, "backup.rnpm.restore", {...})` devine
`recordAuditSafe(c, "backup.rnpm.restore", {...})` cu comentariu:

```ts
    // Rev. 4 (Codex): mutatia e COMISA — un esec al scrierii de audit nu are
    // voie sa rastoarne rezultatul in 409/500 (clientul ar repeta un restore
    // distructiv). Acelasi contract ca site-urile post-mutatie din admin.ts.
```

In `adminBackups.ts`, POST /restore, calea de succes: `recordAudit(c,
"backup.restore", {...})` devine `recordAuditSafe(...)` (acelasi comentariu
scurt). `recordAuditSafe` e deja importat in ambele fisiere.

- [ ] **2.3: ruleaza — trebuie sa treaca**

Run: `npm run test:backend -- src/routes/rnpmBackups.contract.test.ts src/routes/adminBackups.test.ts`
Expected: PASS integral.

---

### Task 3: Nume unic la backup-ul manual (Codex MEDIUM — coliziune in aceeasi secunda)

**Files:**
- Modify: `backend/src/db/backup.ts` (`stampNow` -> helper de rezervare de nume)
- Test: `backend/src/db/backup.test.ts`

**Confirmat pe cod:** `stampNow()` trunchiaza la secunda; ruta admin de create
NU are cooldown (spre deosebire de cea RNPM), iar publish-ul suprascrie prin
rename — doua create-uri in aceeasi secunda produc UN singur snapshot, silentios.

**Interfaces:**
- Produces (backup.ts): `uniqueManualBackupName(dir: string, prefix: string, stamp?: string): string`
  (privat) — returneaza `${prefix}manual-<stamp-cu-ms>.db`, cu sufix incremental
  `-2`, `-3`... cat timp numele exista pe disc, PLAFONAT (fix panel-pe-plan: la
  peste 1000 de coliziuni arunca — o bucla nemarginita sub write lock ar bloca
  toate scrierile de mentenanta); export de test
  `__uniqueManualBackupNameForTests(dir, prefix, stamp)`.

- [ ] **3.1 (red): test pe helper**

In `backup.test.ts`:

```ts
import { __uniqueManualBackupNameForTests } from "./backup.ts";

describe("nume unic pentru backup-ul manual (Rev. 4)", () => {
  it("acelasi stamp + fisier existent => sufix incremental, fara suprascriere", async () => {
    const dir = getBackupDir();
    await fsPromises.mkdir(dir, { recursive: true });
    const stamp = "2026-07-11T10-00-00-000Z";
    const first = __uniqueManualBackupNameForTests(dir, "legal-dashboard.", stamp);
    expect(first).toBe("legal-dashboard.manual-2026-07-11T10-00-00-000Z.db");

    fs.writeFileSync(path.join(dir, first), "x");
    const second = __uniqueManualBackupNameForTests(dir, "legal-dashboard.", stamp);
    expect(second).toBe("legal-dashboard.manual-2026-07-11T10-00-00-000Z-2.db");
    fs.writeFileSync(path.join(dir, second), "x");
    const third = __uniqueManualBackupNameForTests(dir, "legal-dashboard.", stamp);
    expect(third).toBe("legal-dashboard.manual-2026-07-11T10-00-00-000Z-3.db");
  });

  // Fix panel-pe-plan: red COMPORTAMENTAL pe fluxul de PRODUCTIE, nu doar pe
  // helper — doua create-uri cu acelasi timestamp trebuie sa produca DOUA
  // fisiere distincte pe disc (azi al doilea il suprascrie pe primul).
  it("doua backup-uri manuale cu acelasi timestamp => doua fisiere distincte pe disc", async () => {
    const frozen = "2026-07-11T10:00:00.000Z";
    const spy = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(frozen);
    let a: { name: string };
    let b: { name: string };
    try {
      a = await createManualBackup();
      b = await createManualBackup();
    } finally {
      spy.mockRestore();
    }
    expect(a.name).not.toBe(b.name);
    expect(fs.existsSync(path.join(getBackupDir(), a.name))).toBe(true);
    expect(fs.existsSync(path.join(getBackupDir(), b.name))).toBe(true);
  });
});
```

(NOTA mediu: `getBackupDir()` in acest fisier e derivat din tmpdir-ul creat in
beforeEach — fiecare test are director proaspat, nu exista coliziune la re-run.
Spy-ul pe `Date.prototype.toISOString` afecteaza si `logBackupEvent`/audit —
restore-ul lui e in finally, iar continutul log-urilor nu e asertat aici.
ATENTIE: spy-ul ingheata si timestamp-urile din interiorul worker-ului? NU —
worker-ul e proces JS separat (worker_threads), spy-ul traieste doar pe main
thread; operatia in sine nu depinde de timp.)

Run: `npm run test:backend -- src/db/backup.test.ts -t "nume unic"` si
`-t "doua fisiere distincte"`
Expected: FAIL pe ambele — exportul nu exista; pe fluxul de productie, al
doilea create suprascrie primul (un singur fisier pe disc).

- [ ] **3.2 (green): helper + folosire in ambele create-uri manuale**

In `backup.ts`, langa `stampNow`:

```ts
// Rev. 4 (Codex): nume REZERVAT pe disc — ms + sufix incremental pe coliziune.
// stampNow() trunchia la secunda, iar publish-ul suprascrie prin rename: doua
// create-uri in aceeasi secunda (ruta admin nu are cooldown) produceau UN
// singur snapshot, silentios. Rezervarea ruleaza sub maintenance write lock
// (callerii), deci verificarea existsSync nu are cursa in-proces.
function uniqueManualBackupName(dir: string, prefix: string, stamp?: string): string {
  const s = stamp ?? new Date().toISOString().replace(/[:.]/g, "-");
  let name = `${prefix}manual-${s}${BACKUP_SUFFIX}`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) {
    // Plafon (fix panel-pe-plan): o bucla nemarginita sub write lock ar bloca
    // toate scrierile de mentenanta pe un director patologic.
    if (i > 1000) throw new Error(`[backup] nu am putut rezerva un nume unic in ${dir} (peste 1000 de coliziuni)`);
    name = `${prefix}manual-${s}-${i}${BACKUP_SUFFIX}`;
  }
  return name;
}

export function __uniqueManualBackupNameForTests(dir: string, prefix: string, stamp: string): string {
  return uniqueManualBackupName(dir, prefix, stamp);
}
```

In `createManualBackupForTarget`: numele se calculeaza IN interiorul
`withMaintenanceWrite` (rezervarea sub lock), inlocuind
`const name = \`${t.prefix}manual-${stampNow()}${BACKUP_SUFFIX}\`;`:

```ts
async function createManualBackupForTarget(t: BackupTarget): Promise<{ name: string; dest: string }> {
  let name = "";
  const dest = await withMaintenanceWrite(async () => {
    name = uniqueManualBackupName(t.dir, t.prefix);
    const out = await snapshotViaVacuumIntoAsync(t.dbPath, t.dir, name);
    await pruneOld(t.dir, t.prefix);
    return out;
  });
  ...
```

Identic in `createRnpmManualBackup` (numele in interiorul lock-ului, prin
acelasi helper cu `RNPM_PREFIX`).

- [ ] **3.3: curatenie + verificare de format + ruleaza**

1. `Grep "stampNow" backend/src` — daca a ramas fara calleri, STERGE-L (pas
   explicit, fix panel-pe-plan).
2. `Grep "manual-" backend/src --glob "*.test.ts"` — inventariaza asertiile pe
   formatul numelui: cele existente verifica doar prefixul (`/^rnpm\.manual-/`),
   deci trecerea la stamp cu milisecunde nu le rupe; daca gasesti o asertie pe
   formatul EXACT (secunde), actualizeaz-o si noteaza in raport.
3. Run: `npm run test:backend -- src/db/backup.test.ts src/db/rnpmBackup.test.ts src/routes/rnpmBackups.contract.test.ts`
   Expected: PASS (numele raman in pool-ul `manual-*`; regexul accepta orice sufix).

---

### Task 4: pruneOld numara stergerile REALE + warn pe EPERM/EBUSY/EACCES (Codex MEDIUM)

**Files:**
- Modify: `backend/src/db/backup.ts` (`unlinkBundle`, `pruneOld`)
- Test: `backend/src/db/rnpmBackup.test.ts`

**Confirmat pe cod:** `pruneOld` returneaza `toDelete.length`, dar `unlinkBundle`
inghite ORICE eroare — sub un AV/ACL care refuza unlink-ul, log-ul raporteaza
prune reusit in timp ce discul creste.

- [ ] **4.1 (red): test**

In `rnpmBackup.test.ts` (describe-ul "runDailyBackup — multi-target"; pattern-ul
captureConsoleLog nu exista aici — foloseste interceptarea console.log locala):

```ts
it("prune raporteaza DOAR stergerile reale si emite warn pe unlink refuzat (Rev. 4)", async () => {
  seedSearch("u1", "a");
  const jail = getRnpmBackupDir("u1");
  fs.mkdirSync(jail, { recursive: true });
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  // Ani clar in trecut (fix panel-pe-plan: 2026-01-0X ar coliziona cu
  // todayBackupName daca suita ruleaza chiar in acele zile calendaristice).
  for (let i = 1; i <= 9; i++) {
    const p = path.join(jail, `rnpm.1999-01-0${i}.db`);
    fs.writeFileSync(p, "x");
    fs.utimesSync(p, old, old);
  }
  __resetRnpmDbForTests();
  // Preconditie EXPLICITA (fix panel-pe-plan): fisierul per-user ramane pe
  // disc dupa resetul de registry — daily-ul enumereaza stem-urile de pe disc
  // si trebuie sa produca al 10-lea backup datat (altfel aritmetica de mai
  // jos ar picat pentru alt motiv).
  expect(fs.existsSync(getRnpmDbPath("u1"))).toBe(true);

  // Unlink-ul REFUZA exact un fisier candidat la prune (EPERM sustinut).
  // (vi.restoreAllMocks() din afterEach-ul fisierului curata spy-ul.)
  const realUnlink = fsPromises.unlink.bind(fsPromises);
  vi.spyOn(fsPromises, "unlink").mockImplementation(async (p) => {
    if (String(p).endsWith("rnpm.1999-01-01.db")) {
      throw Object.assign(new Error("EPERM simulat de AV"), { code: "EPERM" });
    }
    return realUnlink(p as Parameters<typeof realUnlink>[0]);
  });

  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string") lines.push(args[0]);
  };
  try {
    await runDailyBackup();
  } finally {
    console.log = originalLog;
  }

  // 9 vechi + 1 nou = 10 -> candidate la prune: 3; una refuzata => pruned=2.
  const daily = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((o) => o && o.action === "daily_backup" && String(o.target).startsWith("rnpm:"));
  expect(daily.pruned).toBe(2);
  // Fisierul refuzat exista inca pe disc, iar refuzul e semnalat structurat.
  expect(fs.existsSync(path.join(jail, "rnpm.1999-01-01.db"))).toBe(true);
  expect(lines.some((l) => l.includes("backup_prune_failed") && l.includes("rnpm.1999-01-01.db"))).toBe(true);
});
```

Run: `npm run test:backend -- src/db/rnpmBackup.test.ts -t "stergerile reale"`
Expected: FAIL — azi `pruned` raporteaza 3 si nu exista `backup_prune_failed`.

- [ ] **4.2 (green): unlinkBundle intoarce realitatea**

In `backup.ts`:

```ts
// Sterge un backup impreuna cu sidecar-urile lui (bundle). Rev. 4 (Codex):
// intoarce TRUE doar daca fisierul PRINCIPAL a disparut efectiv (sters acum
// sau deja absent); EPERM/EBUSY/EACCES nu se mai inghit silentios — un AV/ACL
// care refuza unlink-ul lasa discul sa creasca in timp ce log-ul raporta
// prune reusit. Sidecar-urile raman best-effort (orfanele se curata la
// urmatorul prune reusit).
async function unlinkBundle(dir: string, name: string): Promise<boolean> {
  let mainGone = true;
  for (const suffix of ["", "-wal", "-shm"] as const) {
    try {
      await fsPromises.unlink(path.join(dir, name + suffix));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") continue; // absent = obiectivul e atins
      if (suffix === "") {
        mainGone = false;
        logBackupEvent({ action: "backup_prune_failed", file: name, errnoCode: code ?? null });
      }
    }
  }
  return mainGone;
}
```

In `pruneOld`, inlocuieste:

```ts
  for (const f of toDelete) {
    await unlinkBundle(dir, f);
  }
  return toDelete.length;
```

cu:

```ts
  let pruned = 0;
  for (const f of toDelete) {
    if (await unlinkBundle(dir, f)) pruned++;
  }
  return pruned;
```

- [ ] **4.3: ruleaza — trebuie sa treaca (inclusiv testele de retentie existente)**

Run: `npm run test:backend -- src/db/rnpmBackup.test.ts src/db/backup.test.ts`
Expected: PASS integral (testele existente de retentie sterg fara refuzuri —
count-ul ramane identic).

---

### Task 5: Gate final + docs + COMMIT E

**Files:** `CHANGELOG.md`, `SESSION-HANDOFF.md`

- [ ] **5.1: gate complet**

1. `npx biome check --write <fisierele atinse>` (re-stage)
2. `npx tsc --noEmit -p backend/tsconfig.json`
3. `npm run build`
4. `npm run test:backend` de la zero
5. `npm run rebuild:electron`
6. Smoke bundle (scriptul existent din scratchpad) — reconfirmare rapida.

- [ ] **5.2: docs**

CHANGELOG.md — la finalul sub-sectiunii "Fixuri post-review adversarial
(pre-merge)" din v2.43.0:

```markdown
**Runda de inchidere (Rev. 4, review Codex pe intreg branch-ul).** Securitatea si arhitectura au iesit curate; s-au inchis ultimele findings de rezilienta si cod: lock-ul de instanta nu mai recupereaza automat un PID viu de pe acelasi host (operatiile sincrone de boot — split, migratii — pot bloca legitim heartbeat-ul peste prag; break-glass ramane `LEGAL_DASHBOARD_FORCE_BOOT=1`, iar mesajul de refuz explica situatia), auditul de dupa un restore reusit nu mai poate rasturna rezultatul in 409/500 (recordAuditSafe pe caile de succes), backup-urile manuale primesc nume unic cu milisecunde si sufix incremental (doua create-uri in aceeasi secunda nu se mai suprascriu), iar retentia numara doar stergerile reale si semnaleaza structurat unlink-urile refuzate de AV/ACL (`backup_prune_failed`).
```

SESSION-HANDOFF.md — actualizeaza sectiunea sprintului cu Rev. 4 (commit E) +
verdictul review-ului Codex full-branch + review-ul de INCHIDERE care urmeaza.

- [ ] **5.3: COMMIT E**

```bash
git add backend/src/db/instanceLock.ts backend/src/db/instanceLock.test.ts backend/src/routes/rnpm.ts backend/src/routes/adminBackups.ts backend/src/routes/rnpmBackups.contract.test.ts backend/src/db/backup.ts backend/src/db/backup.test.ts backend/src/db/rnpmBackup.test.ts CHANGELOG.md SESSION-HANDOFF.md
git commit -m "fix(rnpm-split): Rev. 4 — lock de instanta fail-closed pe PID viu, audit post-restore safe, nume unic backup manual, prune cu contorizare reala"
```

(enumerarea se ajusteaza la fisierele REAL atinse; niciodata -A.)

- [ ] **5.4: review adversarial Codex de INCHIDERE**

Dupa COMMIT E: `adversarial-review --background --base ccab664 --scope branch`
cu focus pe delta Rev. 4 (verificarea celor 4 fixuri + regresii). Raportul se
consolideaza pentru user cu triaj; capcanele operationale din handoff raman
valabile (launcher timeout != esec; verifica pid-ul la stall).

---

## Findings RESPINSE / in afara scope-ului

1. **"Lock OS suplimentar (flock)"** din recomandarea Codex la HIGH — amanat:
   conditia PID-viu inchide vectorul real pe acelasi host; un lock OS aduce
   complexitate cross-platform (Windows) nejustificata la scara proiectului.
   Se documenteaza in cod ca directie viitoare daca apare web multi-instanta.
2. **Smoke cu doua procese pe baza mare (split >30s)** din next-steps Codex —
   inlocuit cu testul unitar determinist pe conditia de reclaim (1.1); un smoke
   dual-proces cu timing real e fragil si lent in suita.

## Acceptate ca limitari documentate

- **PID reuse** (proces strain pe pid-ul unei instante moarte) => refuz
  fals-pozitiv pana la FORCE_BOOT — fail-closed, comentat in cod (Task 1).
- **Sidecar-urile refuzate la prune** raman best-effort (doar fisierul
  principal decide count-ul) — orfanele se curata la urmatorul prune reusit.
- **`prunePreSplitBackupsSync` pastreaza count-ul de candidati** (aceeasi clasa
  de raportare ca finding-ul din Task 4, semnalata de panel) — ACCEPTAT: e cale
  de BOOT, count-ul e folosit doar intr-un log informativ de split, iar
  fisierele refuzate raman oricum sub plafonul pool-ului la urmatorul boot.
- **Alte 4 site-uri `recordAudit` pe cai de succes** (semnalate de panel in
  rnpm.ts: aviz.delete, aviz.delete_all, search.delete etc.) raman FOLLOW-UP —
  in afara celor 4 findings confirmate; mutatiile lor sunt idempotente sau
  ieftin de repetat (spre deosebire de restore).
- **Ruta ADMIN de restore primeste swap-ul recordAuditSafe FARA red dedicat**
  (exceptie TDD documentata — fault-injection-ul folosit la rnpm nu functioneaza
  acolo; gardul de clasa e testul rnpm + simetria).
- Limitarile din Rev. 2/3 raman in vigoare.

## Istoric review

- **Rev. 4 initial:** consolideaza review-ul adversarial Codex pe INTREG
  branch-ul (`review-mrfijdtk-6hpgld`, NO-SHIP: 1 HIGH rezilienta + 3 MEDIUM;
  securitate si arhitectura curate). Toate cele 4 findings REVERIFICATE pe cod
  inainte de plan (instanceLock.ts:109-116, rnpm.ts/adminBackups.ts succes-path
  recordAudit, stampNow() secunde + fara cooldown pe ruta admin, unlinkBundle
  catch-all).
- **Rev. 4 CORECTAT (acest fisier), dupa review-ul PANELULUI PE PLAN** (Opus +
  GPT-5.6 Sol + Kimi + GLM + DeepSeek, sinteza Fable; toate cele 4 fixuri
  confirmate corecte de 4/4 revieweri pe truth-table): `processAlive` devine
  fail-closed (DOAR ESRCH = mort; EPERM = viu) + test dedicat; teste cross-host
  pentru ramurile "neschimbate"; mock determinist pe process.kill in loc de
  scanare de pid-uri; asertii separate refuz/hint + env save/restore pe
  FORCE_BOOT; red COMPORTAMENTAL pe fluxul de productie la numele unic (doua
  create-uri cu timestamp inghetat) + plafon pe bucla de sufixe + pas explicit
  de stergere stampNow + grep de format; preconditie explicita si date 1999 in
  testul de prune + nota pe restoreAllMocks; exceptia TDD pe ruta admin si
  asumptia de middleware documentate; prunePreSplitBackupsSync si celelalte
  site-uri recordAudit mutate explicit la limitari/follow-up. Respinse (cu
  motivarea sintezei): cross-host dead-pid ca defect de plan (comportament
  existent, limitare asumata), existsSync sub lock (stil), logging pe sidecars
  (decizie documentata).
