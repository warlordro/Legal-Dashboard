# Fixuri Rev. 5 — inchiderea HIGH-urilor din review-ul Codex de pe delta Rev. 4 (focus deploy WEB)

> **Pentru agentul executant:** REQUIRED SUB-SKILL: superpowers:executing-plans.
> TDD strict (red confirmat inainte de green). UN SINGUR commit consolidat
> (COMMIT F) la final, apoi review adversarial Codex de INCHIDERE pe delta.

**Goal:** inchide cele 2 HIGH din review-ul Codex de inchidere pe Rev. 4
(`review-mrfka72k-z0p6y3`): (1) prune-ul poate corupe bundle-ul legacy pe care
il "pastreaza" (sidecars stersi desi principalul a fost refuzat); (2) reclaim-ul
unui lock mort nu e atomic intre doua boot-uri concurente. Ambele afecteaza
DIRECT deploy-ul web: F1 e cale de corupere in codul comun; F2 e fluxul normal
de docker restart/redeploy pe acelasi volum (pe web nu exista single-instance
lock-ul Electron — instanceLock-ul e singurul gard).

**Architecture:** F1 = reordonare in `unlinkBundle` (principalul decide; sidecars
doar dupa). F2 = gate de reclaim creat atomic cu `O_EXCL` (`.instance.lock.reclaim-gate`)
+ re-validare nonce SUB gate + self-heal pe gate orfan; pierzatorul refuza
fail-closed cu mesaj de retry. Niciun alt protocol atins.

**Tech Stack:** Node 22, Vitest, Biome.

## Constrangeri globale (identice cu Rev. 2-4)

- Romana FARA diacritice in cod sursa.
- Gate-uri inainte de commit: biome pe fisierele atinse, tsc backend,
  `npm run build`, `npm run test:backend` de la zero.
- Branch: `feat/v2.43.0-rnpm-split`. NU push fara cerere explicita.
- UN SINGUR commit consolidat (COMMIT F) la finalul Task 3.
- Dupa teste Node pe better-sqlite3: `npm run rebuild:electron` la final.

---

### Task 1: unlinkBundle — sidecars NEATINSE cand principalul e refuzat (Codex HIGH-1)

**Files:**
- Modify: `backend/src/db/backup.ts` (`unlinkBundle`)
- Test: `backend/src/db/rnpmBackup.test.ts`

**Confirmat pe cod:** bucla din `unlinkBundle` continua pe `-wal`/`-shm` chiar
cand unlink-ul pe `.db` a fost refuzat (EPERM/EBUSY/EACCES) — la bundle-urile
legacy datele comise pot trai DOAR in WAL (dovedit de testul legacy-bundle),
deci "recovery point-ul pastrat" ramane pe disc INCOMPLET, silentios. Calea e
pre-existenta (si codul vechi stergea sidecars best-effort dupa un main esuat),
dar Rev. 4 i-a dat semnificatie fisierului pastrat.

- [ ] **1.1 (red): test — WAL-ul supravietuieste cand principalul e refuzat**

In `rnpmBackup.test.ts`, lânga testul "prune raporteaza DOAR stergerile reale"
(acelasi pattern de seed + spy):

```ts
it("prune refuzat pe .db NU sterge sidecars-ul bundle-ului (WAL-ul ramane restaurabil)", async () => {
  seedSearch("u1", "a");
  const jail = getRnpmBackupDir("u1");
  fs.mkdirSync(jail, { recursive: true });
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  for (let i = 1; i <= 9; i++) {
    const p = path.join(jail, `rnpm.1998-01-0${i}.db`);
    fs.writeFileSync(p, "x");
    fs.utimesSync(p, old, old);
  }
  // Bundle legacy: candidatul refuzat are un WAL care conteaza la restore.
  fs.writeFileSync(path.join(jail, "rnpm.1998-01-01.db-wal"), "date-comise-doar-in-wal");
  __resetRnpmDbForTests();
  expect(fs.existsSync(getRnpmDbPath("u1"))).toBe(true);

  const realUnlink = fsPromises.unlink.bind(fsPromises);
  vi.spyOn(fsPromises, "unlink").mockImplementation(async (p) => {
    if (String(p).endsWith("rnpm.1998-01-01.db")) {
      throw Object.assign(new Error("EPERM simulat de AV"), { code: "EPERM" });
    }
    return realUnlink(p as Parameters<typeof realUnlink>[0]);
  });

  await runDailyBackup();

  // Bundle-ul refuzat ramane INTACT: si .db, si WAL-ul lui.
  expect(fs.existsSync(path.join(jail, "rnpm.1998-01-01.db"))).toBe(true);
  expect(fs.existsSync(path.join(jail, "rnpm.1998-01-01.db-wal"))).toBe(true);
});
```

Run: `npm run test:backend -- src/db/rnpmBackup.test.ts -t "NU sterge sidecars"`
Expected: FAIL — azi WAL-ul e sters desi .db a fost refuzat.

- [ ] **1.2 (green): reordonare — principalul decide**

In `backup.ts`, `unlinkBundle` devine:

```ts
// Sterge un backup impreuna cu sidecar-urile lui (bundle). Rev. 5 (Codex):
// fisierul PRINCIPAL decide — daca stergerea lui e refuzata (non-ENOENT),
// sidecars NU se ating: la bundle-urile legacy datele comise pot trai doar in
// WAL, iar un .db "pastrat" fara WAL-ul lui e un recovery point corupt
// silentios. Sidecars se sterg DOAR dupa ce principalul a disparut (sters
// acum sau deja absent); esecul pe sidecars ramane best-effort (orfanele se
// curata la urmatorul prune reusit).
async function unlinkBundle(dir: string, name: string): Promise<boolean> {
  try {
    await fsPromises.unlink(path.join(dir, name));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      logBackupEvent({ action: "backup_prune_failed", file: name, errnoCode: code ?? null });
      return false;
    }
  }
  for (const suffix of ["-wal", "-shm"] as const) {
    await fsPromises.unlink(path.join(dir, name + suffix)).catch(() => {
      /* best-effort */
    });
  }
  return true;
}
```

- [ ] **1.3: ruleaza — trebuie sa treaca (inclusiv testele de prune existente)**

Run: `npm run test:backend -- src/db/rnpmBackup.test.ts src/db/backup.test.ts`
Expected: PASS integral.

---

### Task 2: Reclaim atomic prin gate O_EXCL + re-validare nonce (Codex HIGH-2, critic pentru web)

**Files:**
- Modify: `backend/src/db/instanceLock.ts`
- Test: `backend/src/db/instanceLock.test.ts`

**Confirmat pe cod:** doua procese pot citi ACELASI lock mort/stale; primul face
`renameSync` + `writeNewLock`, al doilea (suspendat intre citire si rename)
revine si redenumeste lock-ul NOU al primului, apoi publica al lui — ambele
ruleaza boot-ul (schema init + split) pana cand heartbeat-ul primului detecteaza
pierderea (~5s). Pe web (docker restart pe acelasi volum) e fluxul normal, nu
edge-case.

**Design:**
- `GATE_NAME = ".instance.lock.reclaim-gate"`, `GATE_STALE_MS = 60_000`.
- Orice RECLAIM (lock mort/stale sau lock invalid/ilizibil) trece prin gate:
  1. `openSync(gatePath, "wx")` — atomic; castiga UN singur proces.
  2. Pierzatorul (EEXIST): daca gate-ul e ORFAN (mtime mai vechi de
     GATE_STALE_MS — crash mid-reclaim), il sterge best-effort si ARUNCA
     "reincearca pornirea" (self-heal convergent: urmatoarea pornire ia gate-ul);
     altfel arunca "alt proces recupereaza lock-ul chiar acum; reincearca".
     FAIL-CLOSED in ambele cazuri — nu exista drum spre doua procese active.
  3. Castigatorul, SUB gate: re-citeste lock-ul si RE-VALIDEAZA ca e tot cel
     evaluat (acelasi `nonce`; pentru lock invalid: tot invalid) — daca s-a
     schimbat, alt proces l-a publicat intre evaluare si gate => elibereaza
     gate-ul si arunca (lock-ul nou se respecta).
  4. rename -> `.dead-*` + `writeNewLock` + audit, apoi `finally`: closeSync +
     unlink pe gate.
- Branch-ul FORCE_BOOT ramane in afara gate-ului (break-glass manual, semantica
  existenta neatinsa).
- Limita ASUMATA: interleaving-ul complet (suspendare exact intre openSync si
  re-validare) nu e testabil determinist in proces unic — gate-ul O_EXCL e
  arbitrul testat; re-validarea e plasa suplimentara, comentata in cod.

- [ ] **2.1 (red): teste pe arbitru**

In `instanceLock.test.ts` (helpers `writeForeignLock`/`mockPidProbe` exista):

```ts
describe("acquireInstanceLock — reclaim atomic prin gate (Rev. 5)", () => {
  function gatePath(): string {
    return path.join(tmpRoot, ".instance.lock.reclaim-gate");
  }

  it("gate PROASPAT existent + lock mort => REFUZ fail-closed (alt proces recupereaza)", () => {
    mockPidProbe(999_999, "ESRCH");
    writeForeignLock({ pid: 999_999, heartbeatAt: Date.now() - 10 * 60 * 1000 });
    fs.writeFileSync(gatePath(), JSON.stringify({ pid: 4242, at: Date.now() }));

    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/recupereaza|reincearca/i);
    // Lock-ul strain si gate-ul strain raman neatinse.
    const kept = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(kept.nonce).toBe("nonce-strain");
    expect(fs.existsSync(gatePath())).toBe(true);
  });

  it("gate ORFAN (vechi) + lock mort => self-heal: gate-ul dispare, boot-ul curent refuza, urmatorul reuseste", () => {
    mockPidProbe(999_999, "ESRCH");
    writeForeignLock({ pid: 999_999, heartbeatAt: Date.now() - 10 * 60 * 1000 });
    fs.writeFileSync(gatePath(), JSON.stringify({ pid: 4242, at: 0 }));
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(gatePath(), old, old);

    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/reincearca/i);
    expect(fs.existsSync(gatePath())).toBe(false); // self-heal
    // A doua incercare (aceeasi semantica cu o repornire) reuseste.
    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
    const now = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(now.pid).toBe(process.pid);
  });

  it("reclaim reusit lasa gate-ul CURATAT (regresie pe fluxul normal)", () => {
    mockPidProbe(999_999, "ESRCH");
    writeForeignLock({ pid: 999_999, heartbeatAt: Date.now() });

    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
    expect(fs.existsSync(gatePath())).toBe(false);
  });

  it("lock INVALID (JSON ilizibil) trece tot prin gate (gate proaspat => refuz)", () => {
    fs.writeFileSync(path.join(tmpRoot, ".instance.lock"), "{ corupt");
    fs.writeFileSync(gatePath(), JSON.stringify({ pid: 4242, at: Date.now() }));

    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/recupereaza|reincearca/i);
  });
});
```

Run: `npm run test:backend -- src/db/instanceLock.test.ts`
Expected: **FAIL pe testele 1, 2 si 4** (azi nu exista gate — reclaim-ul trece
direct peste el); **testul 3 TRECE si azi** (verifica doar absenta gate-ului,
care nici nu se creeaza) — e REGRESIE, marcata explicit.

- [ ] **2.1b (red, fisier separat `instanceLock.gate.test.ts`): gate-ul se curata cand fn() arunca**

Fault-injection determinist prin vi.mock partial pe node:fs (pattern-ul din
rnpmBackups.auditSafe.test.ts; fisier separat pentru ca mock-ul e per-fisier):

```ts
// Rev. 5 (fix panel-pe-plan): garantia CRITICA a gate-ului — un esec in
// interiorul reclaim-ului (rename refuzat) nu lasa gate orfan care sa
// blocheze reclaim-urile urmatoare 60s.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: vi.fn((from: string, to: string) => {
      if (String(to).includes(".dead-") && process.env.__TEST_FAIL_RENAME === "1") {
        throw Object.assign(new Error("EPERM simulat la rename"), { code: "EPERM" });
      }
      return actual.renameSync(from, to);
    }),
  };
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsPromises from "node:fs/promises";
import { acquireInstanceLock, releaseInstanceLock } from "./instanceLock.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-instgate-"));
});

afterEach(async () => {
  releaseInstanceLock();
  // biome-ignore lint/performance/noDelete: env unset real.
  delete process.env.__TEST_FAIL_RENAME;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("withReclaimGate — exception safety (Rev. 5)", () => {
  it("rename refuzat in reclaim => eroarea se propaga, gate-ul NU ramane orfan, lock-ul vechi e intact", () => {
    fs.writeFileSync(path.join(tmpRoot, ".instance.lock"), "{ corupt"); // branch invalid
    process.env.__TEST_FAIL_RENAME = "1";

    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/EPERM simulat/);
    expect(fs.existsSync(path.join(tmpRoot, ".instance.lock.reclaim-gate"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8")).toBe("{ corupt");

    // Dupa disparitia cauzei, reclaim-ul reuseste (gate-ul nu a ramas blocat).
    // biome-ignore lint/performance/noDelete: env unset real.
    delete process.env.__TEST_FAIL_RENAME;
    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
  });
});
```

Expected red: azi nu exista gate deloc — asertia pe absenta gate-ului trece
trivial, dar testul intreg PICA la primul expect pentru ca fara gate rename-ul
mock-uit arunca EPERM BRUT... care e chiar comportamentul curent => testul e
GARD DE REGRESIE pe partea de gate-cleanup (exceptie TDD documentata, la fel ca
2.1 testul 3); valoarea red REALA ramane pe 2.1 (1, 2, 4).

- [ ] **2.2 (green): gate-ul in ambele branch-uri de reclaim**

In `instanceLock.ts`:

```ts
// Plafonul de self-heal e cuplat de invariantul ca fn() ramane DOAR
// recheck+rename+write (microsecunde) — nu adauga I/O lent in gated fn(),
// altfel expirarea devine atinsa si ABA-ul de unlink inceteaza sa fie teoretic.
const GATE_STALE_MS = 60_000;

function gatePathFor(path: string): string {
  return `${path}.reclaim-gate`;
}

// Rev. 5 (Codex HIGH, critic pentru web): reclaim-ul unui lock mort/stale
// trece printr-un GATE creat atomic (O_EXCL) — doua boot-uri concurente care
// citesc acelasi lock mort (docker restart pe acelasi volum) nu mai pot face
// AMBELE rename+write; pierzatorul refuza fail-closed cu mesaj de retry.
// Gate-ul orfan (crash mid-reclaim) se autovindeca: peste GATE_STALE_MS e
// sters best-effort si pornirea CURENTA tot refuza — urmatoarea il castiga.
// Exception-safe (fix panel-pe-plan): UN singur try acopera open+fn; finally
// curata fd + gate cu garzi individuale (un esec in fn nu lasa gate orfan si
// nu e mascat de un esec de cleanup). Continutul gate-ului nu e citit de
// nimeni — nu se scrie nimic in el (suprafata de esec mai mica).
function withReclaimGate(path: string, fn: () => void): void {
  const gate = gatePathFor(path);
  let fd: number | null = null;
  try {
    try {
      fd = openSync(gate, "wx");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let orphan = false;
      try {
        orphan = Date.now() - statSync(gate).mtimeMs > GATE_STALE_MS;
      } catch {
        /* gate-ul a disparut intre timp (TOCTOU) — refuz tipat; retry-ul reuseste */
      }
      if (orphan) {
        try {
          unlinkSync(gate);
        } catch {
          /* best-effort */
        }
        throw new Error(
          "Recuperarea lock-ului SQLite a fost intrerupta anterior (gate orfan curatat). Reincearca pornirea."
        );
      }
      throw new Error("Alt proces Legal Dashboard recupereaza lock-ul SQLite chiar acum. Reincearca pornirea.");
    }
    fn();
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* best-effort */
      }
      try {
        unlinkSync(gate);
      } catch {
        /* best-effort */
      }
    }
  }
}
```

(adauga `statSync` la importurile din `node:fs`.)

In `acquireInstanceLock`, ambele branch-uri de reclaim se impacheteaza:

- branch-ul `existing` (lock mort/stale, dupa verificarea `blocked`):

```ts
      withReclaimGate(path, () => {
        // Re-evaluare COMPLETA sub gate (fix panel-pe-plan: nonce-ul singur nu
        // ajunge — heartbeat-ul reimprospateaza ACELASI nonce, deci un lock
        // cross-host citit stale in snapshot poate fi din nou viu aici):
        // acelasi criteriu ca evaluarea initiala, pe o citire proaspata.
        const recheck = readLock(path);
        if (!recheck || recheck.nonce !== existing.nonce) {
          throw new Error(
            "Lock-ul SQLite a fost preluat de alt proces in timpul recuperarii. Reincearca pornirea."
          );
        }
        const recheckAge = Date.now() - recheck.heartbeatAt;
        const recheckStale = recheckAge > STALE_FACTOR * HEARTBEAT_MS;
        const recheckBlocked = sameHost ? processAlive(recheck.pid) : !recheckStale;
        if (recheckBlocked) {
          throw new Error(
            "Lock-ul SQLite a redevenit activ in timpul recuperarii (heartbeat proaspat). Reincearca pornirea."
          );
        }
        const deadPath = `${path}.dead-${existing.pid}-${Date.now()}`;
        try {
          renameSync(path, deadPath);
        } catch (e) {
          // ENOENT = alt proces (ex. FORCE_BOOT concurent) a mutat lock-ul
          // intre recheck si rename — refuz TIPAT, nu eroare bruta.
          if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
            throw new Error(
              "Lock-ul SQLite a fost preluat de alt proces in timpul recuperarii. Reincearca pornirea."
            );
          }
          throw e;
        }
        writeNewLock(path, record);
        pendingReclaimAudit = {
          forced: false,
          previousPid: existing.pid,
          previousHostname: existing.hostname,
          previousHeartbeatAgeMs: heartbeatAge,
        };
      });
```

- branch-ul `else` (lock cu JSON neparseabil — contractul EXACT al lui
  `readLock` care intoarce null):

```ts
      withReclaimGate(path, () => {
        // Re-validare sub gate: daca intre timp un proces a scris un lock
        // VALID, il respectam (nu-l redenumim).
        if (readLock(path) !== null) {
          throw new Error(
            "Lock-ul SQLite a fost preluat de alt proces in timpul recuperarii. Reincearca pornirea."
          );
        }
        const deadPath = `${path}.dead-invalid-${Date.now()}`;
        try {
          renameSync(path, deadPath);
        } catch (e) {
          if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
            throw new Error(
              "Lock-ul SQLite a fost preluat de alt proces in timpul recuperarii. Reincearca pornirea."
            );
          }
          throw e;
        }
        writeNewLock(path, record);
        pendingReclaimAudit = { forced: false, invalidPrevious: true };
      });
```

`cleanupDeadSidecars` NU atinge gate-ul (filtrul e pe `.dead-`); verifica.

- [ ] **2.3: ruleaza — trebuie sa treaca (toata suita instanceLock + index)**

Run: `npm run test:backend -- src/db/instanceLock.test.ts src/index.test.ts`
Expected: PASS integral (testele Rev. 4 neatinse; boot-urile reale din
index.test nu fac reclaim, deci gate-ul nu apare acolo).

---

### Task 3: Gate final + docs + COMMIT F + review de inchidere

- [ ] **3.1:** biome pe fisierele atinse; tsc backend; `npm run build`;
  `npm run test:backend` de la zero; `npm run rebuild:electron`; smoke bundle.
- [ ] **3.2 (docs):** CHANGELOG — completeaza paragraful "Runda de inchidere
  (Rev. 4...)" cu o fraza Rev. 5 (bundle intact la prune refuzat + reclaim
  atomic prin gate — focus web); SESSION-HANDOFF — starea finala; RUNBOOK §3
  (boot failure) — un rand pentru mesajele noi de gate ("Reincearca pornirea").
- [ ] **3.3: COMMIT F** (`fix(rnpm-split): Rev. 5 — bundle intact la prune
  refuzat, reclaim atomic al lock-ului prin gate O_EXCL (web restart safety)`),
  apoi review adversarial Codex de INCHIDERE pe delta (`--base <commit E>`).

## Acceptate ca limitari documentate

- Interleaving-ul complet gate↔re-validare nu e testabil determinist in proces
  unic; arbitrul (O_EXCL) e testat, re-validarea e plasa in plus, comentata.
- Refuzul fail-closed la gate pierdut cere o REPORNIRE (operator/orchestrator)
  — corect pentru web (restart policy face retry oricum) si pentru desktop.
  Worst-case dupa un crash intre open si cleanup: reclaim-ul e blocat pana la
  GATE_STALE_MS (60s) + o repornire — documentat in RUNBOOK.
- **Publicarea INITIALA a lock-ului** (`writeNewLock`: openSync "wx" +
  writeSync separat) are o fereastra de microsecunde cu fisier gol, aceeasi
  clasa de cursa (semnalata de panel, PRE-existenta) — acceptata: fereastra e
  ordine de marime mai mica decat cea inchisa aici, iar heartbeat-ul +
  "ownership lost" o detecteaza; candidat pentru hardening viitor (temp +
  rename no-replace).
- **FORCE_BOOT ramane in afara gate-ului** (break-glass manual): doua porniri
  fortate SIMULTANE raman responsabilitatea operatorului; coliziunea cu un
  reclaim normal e tipata (ENOENT -> "preluat de alt proces").
- **ABA pe unlink-ul de gate dupa o suspendare >60s in sectiunea critica**:
  trasat fail-closed de panel (rename ENOENT / writeNewLock EEXIST) — ramane
  doar posibilitatea stergerii gate-ului succesorului, care duce tot la refuz
  tipat + retry; invariantul "fn() = recheck+rename+write, fara I/O lent" e
  comentat pe GATE_STALE_MS.
- **`prunePreSplitBackupsSync` pastreaza pattern-ul vechi de stergere** —
  constient in afara scope-ului: backup-urile pre-split sunt VACUUM INTO
  self-contained (fara WAL cu date), deci clasa de corupere din Task 1 nu se
  aplica.
- **O_EXCL pe volume network (NFS)**: atomicitatea gate-ului si a lock-ului
  presupune storage local/overlay/bind — o fraza in RUNBOOK; mostenita de la
  lock-ul insusi, nu inrautatita.
- Comentariul din unlinkBundle despre orfani se corecteaza: sidecars ale caror
  unlink a esuat DUPA stergerea principalului nu mai sunt redescoperite de
  enumerare (raman orfane) — best-effort asumat.
- Limitarile Rev. 2-4 raman in vigoare.

## Istoric review

- **Rev. 5 initial:** cele 2 HIGH din `review-mrfka72k-z0p6y3` (inchiderea
  Rev. 4), ambele REVERIFICATE pe cod; prioritizate la cererea userului pentru
  focusul de deploy WEB (F2 = fluxul normal de docker restart; F1 = corupere de
  date in codul comun).
- **Rev. 5 CORECTAT (acest fisier), dupa review-ul PANELULUI PE PLAN** (5
  modele, sinteza Fable; verdict: planul e sanatos, ambele HIGH-uri se inchid
  ca design, ZERO Critical/High pe plan; Task 1 confirmat corect de 5/5):
  withReclaimGate exception-safe (un try peste open+fn, finally cu garzi
  individuale, fara writeSync in gate — continutul nu e citit de nimeni);
  re-evaluare COMPLETA sub gate (nonce + liveness + staleness — heartbeat-ul
  reimprospateaza acelasi nonce); ENOENT tipat pe rename in ambele branch-uri;
  test nou de fault-injection pe cleanup-ul gate-ului (fisier separat cu
  vi.mock pe node:fs, marcat regresie); TOCTOU pe statSync tratat tipat;
  etichetarea red-urilor clarificata (FAIL pe 1/2/4, testul 3 = regresie);
  contractul branch-ului invalid restrans la "JSON neparseabil"; publicarea
  initiala neatomica, FORCE_BOOT in afara gate-ului, ABA-ul de unlink,
  prunePreSplitBackupsSync, NFS si worst-case-ul de 60s mutate explicit la
  limitari documentate; invariant comentat pe GATE_STALE_MS.
