# Full-Review Fixes (v2.37.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediaza findingurile cu risc maxim din full-review-ul `920ef31` (corectitudinea alertelor de monitoring, cost dublu RNPM, rollback migratii, web auth) cu impact minim asupra comportamentului existent.

**Architecture:** Trei valuri pe un branch nou `fix/v2.37.1-review-hardening`: (0) igiena fara risc, (1) corectitudinea alertelor de monitoring — clusterele 1-3 din review, (2) fiabilitate (RNPM timeout, migratii, reziduuri ICCJ). Fiecare schimbare de comportament pastreaza un kill-switch env sau semantica "sticky" fata de baseline ca sa nu produca churn. Clusterele amanate (cu motiv) sunt listate la final.

**Tech Stack:** Node 22 + Hono, better-sqlite3, vitest; frontend React 18 + Vite.

**Reguli de verificare (CLAUDE.md):** dupa fiecare task care atinge cod: `npx tsc --noEmit -p backend/tsconfig.json` + teste tinta; la final: biome + tsc x2 + `npm run build` + `npm test --workspace=backend` + `cd frontend && npx vitest run`. Commits locale per task; NU push (decizia userului).

---

## Task 0: Branch nou

- [ ] `git checkout -b fix/v2.37.1-review-hardening` (din `feat/v2.37.0-iccj-integration` @ 920ef31)

## Task 1: Igiena repo — PII + gitignore (cluster 13)

**Files:** Delete: `ta.json`, `tn.json`, `tv.json`, `tvx.json`, `tvy.json` (root, untracked, contin nume reale de parti). Modify: `.gitignore`.

- [ ] Sterge cele 5 fisiere `t*.json` din radacina.
- [ ] In `.gitignore`, dupa blocul `backend/rnpm-dumps/`, adauga:

```gitignore

# Worktrees temporare create de tooling (audit/composr)
.worktrees/
```

- [ ] Commit: `chore(hygiene): delete ICCJ smoke dumps with real PII + gitignore .worktrees`

## Task 2: Documentare env + kill-switches (cluster 13, carry-forward release-readiness)

**Files:** Modify: `backend/.env.example` (linia ~136), `SECURITY.md:126,166` (liste kinds), `README.md:68` (lista kinds).

- [ ] In `.env.example`, dupa `MONITORING_DISABLED_KINDS=`, actualizeaza comentariul "Values:" sa includa `iccj` si adauga blocul:

```bash
# OPTIONAL - kill switch interactiv pentru rutele ICCJ (/api/dosare-iccj + /api/termene-iccj); 1 = 503
ICCJ_ROUTES_DISABLED=
# OPTIONAL - timeout per-fetch scraping scj.ro, ms (default 30000)
ICCJ_TIMEOUT_MS=
# OPTIONAL - cap dimensiune raspuns scj.ro, bytes (default 20971520)
ICCJ_MAX_RESPONSE_BYTES=
# OPTIONAL - buget total imbogatire detalii ICCJ per cautare, ms (default 45000)
ICCJ_ENRICH_BUDGET_MS=
# OPTIONAL - timeout per-fetch RNPM, ms (default 60000) [v2.37.1]
RNPM_TIMEOUT_MS=
# OPTIONAL - 0 dezactiveaza alertele source_partial / multi-instanta (default: activ din v2.37.1)
MONITORING_PARTIAL_ALERTS_ENABLED=
```

- [ ] In SECURITY.md si README.md, adauga `iccj` la enumerarile de kinds pentru `MONITORING_DISABLED_KINDS` (grep `dosar_soap,name_soap`).
- [ ] Commit: `docs(ops): document ICCJ kill-switches + RNPM timeout in .env.example/SECURITY/README`

## Task 3: CLAUDE.md stale facts (cluster 13)

**Files:** Modify: `CLAUDE.md:83` ("latest 0025" → "latest 0035" — vezi Task 12 care adauga 0035), `CLAUDE.md:99` ("(102 teste)" → fara count hardcodat).

- [ ] Commit: `docs: CLAUDE.md migration latest + drop stale test count`

## Task 4: Supply-chain hygiene (cluster 13)

**Files:** Modify: `deploy/docker-compose.prod.yml:81`, `.github/workflows/docker-build.yml` (dupa `on:`).

- [ ] `image: legal-dashboard:${APP_VERSION:-2.33.0}` → `${APP_VERSION:-2.37.0}`.
- [ ] In docker-build.yml adauga la nivel de workflow:

```yaml
permissions:
  contents: read
```

- [ ] Commit: `chore(ci): docker-build least-privilege permissions + compose default tag 2.37.0`

## Task 5: Caddyfile — web auth (cluster 7)

**Files:** Modify: `deploy/Caddyfile:24-25`.

- [ ] Sterge DOAR linia `header_up -Cookie` si adauga comentariu:

```caddyfile
	reverse_proxy oauth2-proxy:4180 {
		# v2.37.1: NU stripui Cookie — oauth2-proxy isi citeste sesiunea si
		# tokenul CSRF din cookie, iar backend-ul primeste legal_dashboard_session
		# pe acelasi canal. Stripuim doar header-ele de identitate spoofabile,
		# pe care DOAR oauth2-proxy are voie sa le seteze.
		header_up -Authorization
		header_up -X-Auth-Request-Email
```

- [ ] Commit: `fix(deploy): keep Cookie through Caddy — oauth2-proxy session was unreachable`

## Task 6: Micro-fixuri cod, batch A (clusterele 9/11/14)

**Files:** Modify: `backend/src/services/monitoring/iccjRunner.ts:72-78`, `backend/src/services/alerts/alertEventService.ts` (recordAudit actor), `backend/src/routes/dosareIccj.ts:22-28,114-117`, `frontend/src/pages/Monitorizare.tsx:265-268`, `frontend/src/components/DosareTable.tsx:142-146`.

- [ ] iccjRunner — coduri distincte (importa erorile din iccjClient):

```ts
        const errorCode =
          err instanceof IccjSourceError
            ? "ICCJ_SOURCE_FAIL"
            : err instanceof IccjParseError
              ? "ICCJ_PARSE_FAIL"
              : "ICCJ_FAIL";
        return {
          status: "error",
          errorCode,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
```

- [ ] alertEventService — `recordAudit(null, ...)` → `recordAudit("system", ...)` (verifica semnatura recordAudit; daca primul arg e actorId, foloseste "system" ca restul evenimentelor de sistem din index.ts:463).
- [ ] dosareIccj — 503 cu cod + Retry-After:

```ts
const ICCJ_DISABLED_BODY = {
  error: "Cautarea ICCJ (scj.ro) este dezactivata temporar de catre administrator.",
  code: "ICCJ_DISABLED",
} as const;
dosareIccjRouter.use("*", async (c, next) => {
  if (iccjRoutesDisabled()) return c.json(ICCJ_DISABLED_BODY, 503, { "Retry-After": "300" });
  await next();
});
```

(idem pe `termeneIccjRouter`).
- [ ] Monitorizare.tsx — header copy: "verificare automata pe PortalJust" → "verificare automata pe PortalJust si ICCJ (scj.ro)".
- [ ] DosareTable.tsx sort numar: `av.localeCompare(bv)` → `av.localeCompare(bv, undefined, { numeric: true })` (doar pentru coloana numar).
- [ ] Run: `npx tsc --noEmit -p backend/tsconfig.json` + `cd frontend && npx tsc --noEmit` → PASS.
- [ ] Commit: `fix(misc): ICCJ error codes, system actor on alert audit, 503 code+Retry-After, UI copy + numeric sort`

## Task 7: SOAP false-empty guard (cluster 3)

**Files:** Modify: `backend/src/soap.ts:249-253`. Test: `backend/src/soap.test.ts` (append, urmand stub-ul fetch existent).

- [ ] In `cautareDosare`, dupa `callSoap`:

```ts
  const xml = await callSoap("CautareDosare", body, options?.signal);
  // v2.37.1 (review cluster 3): un body 200 fara envelope-ul asteptat (pagina
  // WAF/proxy/mentenanta, tag redenumit) NU e totuna cu "0 rezultate". Fara
  // guard, [] ajunge in dosarSoapRunner -> diff -> dosar_disappeared FALS +
  // snapshot resetat. Raspunsul gol legitim contine elementul
  // <CautareDosareResult/> (self-closed sau gol), deci substring-ul exista.
  if (!xml.includes("CautareDosareResult")) {
    console.error("[soap] CautareDosare: raspuns 200 fara envelope (lungime", xml.length, ")");
    throw new Error("Raspuns neasteptat de la PortalJust (envelope absent).");
  }
  const resultXml = extractFirst(xml, "CautareDosareResult");
  if (!resultXml) return [];
```

- [ ] Test nou in soap.test.ts (pattern-ul de stub existent):

```ts
it("arunca pe 200 fara envelope-ul CautareDosareResult (pagina drifted != 0 rezultate)", async () => {
  stubFetchOk("<html><body>Mentenanta programata</body></html>");
  await expect(cautareDosare({ numarDosar: "1/2/2026" })).rejects.toThrow(/envelope absent/);
});
it("returneaza [] pe envelope cu rezultat gol", async () => {
  stubFetchOk("<soap:Envelope><soap:Body><CautareDosareResponse><CautareDosareResult /></CautareDosareResponse></soap:Body></soap:Envelope>");
  await expect(cautareDosare({ numarDosar: "1/2/2026" })).resolves.toEqual([]);
});
```

- [ ] Run: `npm test --workspace=backend -- --run soap` → PASS.
- [ ] Commit: `fix(soap): treat drifted 200 body as source error, not empty result (kills false dosar_disappeared)`

## Task 8: nameSoap — failedInstitutii in diff + ancorare dedup + flag ON (cluster 1)

**Files:** Modify: `backend/src/services/monitoring/diff/nameSoap.ts`, `backend/src/services/monitoring/nameSoapRunner.ts:26-28,95-101`. Test: `backend/src/services/monitoring/diff/nameSoap.test.ts` (append), `nameSoapRunner.test.ts` (ajusteaza testele care presupun default-off).

- [ ] `NameSoapDiffInput` += `failedInstitutii?: string[]` si `prevSnapshotId: number | null` (comentarii ca in dosarSoap).
- [ ] `dedupKey` primeste ancora:

```ts
function dedupKey(numar: string, transition: NameSoapAlertKind, anchor: string): string {
  // v2.37.1: ancora pe prev-snapshot (pattern diff/dosarSoap transitionAnchor).
  // Fara ea cheia e constanta pe viata jobului si ON CONFLICT DO NOTHING
  // inghite a doua tranzitie reala (Fond->Apel alerteaza, Apel->Recurs nu).
  return `name_soap|${numar}|${transition}|${anchor}`;
}
```

In `diffNameSoap`: `const anchor = \`s${input.prevSnapshotId ?? "init"}\`;` si toate apelurile `dedupKey(numar, kind)` devin `dedupKey(numar, kind, anchor)`.
- [ ] Carry-forward + suprimare disappeared pentru institutiile picate:

```ts
  const failed = new Set((input.failedInstitutii ?? []).filter((x) => x.length > 0));
  let newSnapshot = currentSnapshot;
  if (failed.size > 0 && prevSnapshot) {
    // Dosarele gazduite la o institutie care a picat in fan-out nu AU CUM sa
    // apara in currentSnapshot — absenta lor e necunoscut, nu disparitie.
    // Le purtam neschimbate in baseline ca tick-ul urmator sa nu le vada
    // ca "noi" la recuperare.
    const carried = prevSnapshot.dosare.filter(
      (d) => d.numar && !currentByNumar.has(d.numar) && failed.has(d.instanta)
    );
    if (carried.length > 0) {
      newSnapshot = {
        ...currentSnapshot,
        dosare: [...currentSnapshot.dosare, ...carried].sort((a, b) => a.numar.localeCompare(b.numar)),
      };
    }
  }
```

In bucla disappeared: `if (failed.has(prev.instanta)) continue;` inainte de push. Return `{ newSnapshot, alerts }`.
- [ ] Runner: paseaza ambele campuri:

```ts
        const { newSnapshot, alerts } = diffNameSoap({
          prevSnapshot,
          currentSnapshot,
          alertConfig,
          now: nowIso,
          jobCreatedAt: job.created_at,
          prevSnapshotId: prevRow?.id ?? null,
          failedInstitutii: partialInstitutii
            .map((f) => f.institutie)
            .filter((x): x is string => typeof x === "string" && x.length > 0),
        });
```

- [ ] Flip default: `partialAlertsEnabled()` → `process.env.MONITORING_PARTIAL_ALERTS_ENABLED !== "0"` + comentariu actualizat (rollout v2.20.8 incheiat; `=0` ramane kill switch). Ajusteaza testele din nameSoapRunner.test.ts care presupun default-off (seteaza explicit env in testele vechi sau inverseaza asertiile pe default).
- [ ] Teste noi in diff/nameSoap.test.ts:

```ts
it("nu emite dosar_disappeared pentru dosare la institutii picate si le pastreaza in snapshot", () => {
  const prev = snap([{ numar: "1/3/2024", stadiu: "Fond", categorie: "Civil", instanta: "TribunalulCLUJ", latest_sedinta_at: null }]);
  const current = snap([]);
  const out = diffNameSoap({ prevSnapshot: prev, currentSnapshot: current, alertConfig: cfgDisappeared, now: NOW, jobCreatedAt: OLD, prevSnapshotId: 7, failedInstitutii: ["TribunalulCLUJ"] });
  expect(out.alerts).toHaveLength(0);
  expect(out.newSnapshot.dosare.map((d) => d.numar)).toContain("1/3/2024");
});
it("a doua tranzitie de stadiu primeste o cheie dedup diferita (ancora pe baseline)", () => {
  const t1 = diffNameSoap({ prevSnapshot: snap([fond]), currentSnapshot: snap([apel]), alertConfig: cfg, now: NOW, jobCreatedAt: OLD, prevSnapshotId: 1 });
  const t2 = diffNameSoap({ prevSnapshot: snap([apel]), currentSnapshot: snap([recurs]), alertConfig: cfg, now: NOW, jobCreatedAt: OLD, prevSnapshotId: 2 });
  const k1 = t1.alerts.find((a) => a.kind === "stadiu_changed")?.dedupKey;
  const k2 = t2.alerts.find((a) => a.kind === "stadiu_changed")?.dedupKey;
  expect(k1).toBeDefined();
  expect(k2).toBeDefined();
  expect(k1).not.toEqual(k2);
});
```

- [ ] Run: `npm test --workspace=backend -- --run nameSoap` → PASS.
- [ ] Commit: `fix(monitoring): name_soap partial-failure no longer fakes disappearance; dedup keys anchored per baseline; partial alerts default ON`

## Task 9: dosarSoap — selectie sticky multi-rand + alerta de vizibilitate (cluster 2)

**Files:** Modify: `backend/src/services/monitoring/dosarSoapRunner.ts:84,107-120,198-211`. Test: `dosarSoapRunner.test.ts` (append).

- [ ] Adauga helperul (import `normalizeStadiu` din `./sedintaKey.ts`; foloseste ACEEASI normalizare ca buildSedintaKey — verifica sedintaKey.ts):

```ts
// v2.37.1 (review cluster 2): PortalJust intoarce un rand per instanta pentru
// acelasi numar (fond la tribunal + apel la curte). Istoric urmaream orbeste
// dosare[0] (ordinea upstream, nedeterminista): un flip de ordine rotea toate
// cheile sedintelor (flood termen_new) si pierdea starea. Selectie "sticky":
// preferam randul al carui stadiu apare deja in baseline; fallback dosare[0].
function pickWatchedDosar(dosare: Dosar[], prevSnapshot: DiffSnapshotPayload | null): Dosar | null {
  if (dosare.length <= 1) return dosare[0] ?? null;
  const prevStadii = new Set(
    (prevSnapshot?.sedintaKeys ?? []).map((k) => k.split("|")[0] ?? "").filter((s) => s.length > 0)
  );
  if (prevStadii.size > 0) {
    const sticky = dosare.find((d) => prevStadii.has(normalizeStadiu(d.stadiuProcesual)));
    if (sticky) return sticky;
  }
  return dosare[0] ?? null;
}
```

- [ ] Muta selectia in callback (linia 84 dispare; in withMaintenanceRead, dupa prevSnapshot): `const currentDosar = pickWatchedDosar(dosare, prevSnapshot);` — declara `let currentDosar: Dosar | null = null;` inainte de callback daca scope-ul o cere (dosarContext/enrich raman in interiorul callback-ului, deja au acces).
- [ ] In tranzactie, dupa bucla de insert alerts, alerta de vizibilitate (o singura data per set de instante, gated de flag-ul partial):

```ts
          if (partialAlertsEnabled() && dosare.length > 1) {
            const institutii = dosare.map((d) => d.institutie ?? "?").sort();
            const watched = currentDosar?.institutie ?? "?";
            const multiResult = insertAlert({
              ownerId: job.owner_id,
              jobId: job.id,
              runId,
              kind: "source_partial",
              severity: "info",
              title: `Dosarul apare la ${institutii.length} instante - doar ${watched} este monitorizata`,
              detail: { numar_dosar: target.numar_dosar, institutii, watched_instanta: watched, observedAt: nowIso },
              dedupKey: `multi_instanta|${institutii.join(",")}`,
            });
            insertedResults.push(multiResult);
            if (multiResult.inserted) insertedCount += 1;
          }
```

(`partialAlertsEnabled` — exporta-l din nameSoapRunner sau duplica functia de 2 linii cu comentariu; verifica si CHECK-ul/Zod-ul de alert kinds accepta `source_partial` cu severity info — nameSoapRunner il insereaza deja.)
- [ ] Test nou:

```ts
it("selectie sticky: pastreaza randul cu stadiul din baseline cand upstream-ul intoarce 2 randuri in alta ordine", async () => {
  // tick1: doar randul Apel -> baseline cu chei Apel
  // tick2: upstream intoarce [Fond, Apel] -> trebuie urmarit tot Apel; fara termen_new
});
it("emite o singura alerta multi-instanta per set de instante (dedup)", async () => { /* doua tick-uri, 1 insert */ });
```

- [ ] Run: `npm test --workspace=backend -- --run dosarSoapRunner` → PASS.
- [ ] Commit: `fix(monitoring): dosar_soap sticky row selection on multi-court dockets + one-time multi-instanta visibility alert`

## Task 10: RNPM timeout per-fetch + TTL idempotency (cluster 4)

**Files:** Modify: `backend/src/services/rnpmClient.ts` (search/fetchPart/fetchIstoric), `backend/src/routes/rnpm.ts:148`. Test: `backend/src/services/rnpmClient.test.ts` (append, daca exista; altfel test nou minimal).

- [ ] In rnpmClient.ts (module-top):

```ts
// v2.37.1 (review cluster 4): singurul upstream FARA backstop de timeout era
// RNPM (soap.ts are 60s, iccjClient 30s). Un socket mj.rnpm.ro agatat pina
// acum tinea cererea (si gcode-ul captcha platit) la nesfirsit.
const RNPM_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.RNPM_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
})();

function withRnpmTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(RNPM_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
```

- [ ] In `search`: `signal: withRnpmTimeout(signal)`. In `fetchPart`: idem. In `fetchIstoric`: `const composed = withRnpmTimeout(signal);` la inceput, foloseste `composed` in `doFetch` (un singur buget pe ambele attempts).
- [ ] In rnpm.ts: `INFLIGHT_TTL_SEARCH_MS = 120_000` → `900_000` cu comentariu:

```ts
// v2.37.1: 15 min — peste worst-case-ul real al unui /search (captcha solve
// 30-120s + retries + fetch-uri cu timeout 60s fiecare). TTL-ul vechi de 120s
// expira IN TIMPUL unei cautari normale: retry-ul clientului pornea o a doua
// cautare concurenta (captcha platit dublu, randuri duplicate).
export const INFLIGHT_TTL_SEARCH_MS = 900_000;
```

- [ ] Test (fetch stub care nu raspunde): cu `RNPM_TIMEOUT_MS=50`, `client.search(...)` rejects cu TimeoutError/AbortError.
- [ ] Run: `npm test --workspace=backend -- --run rnpmClient` → PASS.
- [ ] Commit: `fix(rnpm): per-fetch timeout backstop (RNPM_TIMEOUT_MS) + inflight TTL 15min (no more concurrent duplicate searches)`

## Task 11: Migratii — `_schema_versions` in down-uri + runbook 0034 (cluster 5)

**Files:** Modify: 24 fisiere `backend/src/db/migrations/00NN_*.down.sql` (0008-0011, 0013-0018, 0021-0034), `RUNBOOK.md`. Create: `backend/src/db/migrations/downSchemaVersions.test.ts`.

- [ ] Append per fisier (N = versiunea din nume, fara zerouri):

```sql

-- v2.37.1: rollback-ul trebuie sa stearga si randul de versiune, altfel
-- runner-ul crede ca migratia e inca aplicata si nu o re-ruleaza la upgrade.
DELETE FROM _schema_versions WHERE version = N;
```

(Bash loop pe `*.down.sql`: skip 0001 si fisierele care contin deja `_schema_versions`.)
- [ ] Test guard nou:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname);
describe("down migrations clean up _schema_versions", () => {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".down.sql"))) {
    const version = Number.parseInt(f.slice(0, 4), 10);
    if (version === 1) continue; // 0001 e stub fail-loud intentionat
    it(f, () => {
      const sql = readFileSync(join(dir, f), "utf8");
      expect(sql).toMatch(new RegExp(`DELETE FROM _schema_versions WHERE version = ${version};`));
    });
  }
});
```

- [ ] RUNBOOK.md — sectiune noua "Rollback migratie 0034 (iccj)": 1) opreste aplicatia; 2) backup (exista si `schema-upgrade` pre-migration); 3) `DELETE FROM monitoring_jobs WHERE kind='iccj';` (cascade pe runs/snapshots/alerts iccj); 4) ruleaza down-ul cu `sqlite3 -bail` si `PRAGMA foreign_keys=OFF` (CLI default off; tooling-ul cu FK ON ar face CASCADE-wipe la DROP); 5) verifica `_schema_versions` nu mai contine 34; 6) instaleaza binarul anterior.
- [ ] Run: `npm test --workspace=backend -- --run downSchemaVersions` → PASS (24+9 fisiere).
- [ ] Commit: `fix(db): down migrations delete their _schema_versions row + 0034 rollback runbook`

## Task 12: Migratia 0035 — index audit_log(ts) + purge chunked (clusterele 5/6)

**Files:** Create: `backend/src/db/migrations/0035_audit_log_ts_index.up.sql` + `.down.sql` (urmand EXACT pattern-ul 0019 pentru inregistrarea versiunii). Modify: `backend/src/db/auditRepository.ts:284-288` (chunking ca `purgeOldRuns`).

- [ ] up.sql: `CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);` (+ insert versiune daca pattern-ul 0019 o face in fisier; altfel runner-ul o face).
- [ ] down.sql: `DROP INDEX IF EXISTS idx_audit_log_ts;` + `DELETE FROM _schema_versions WHERE version = 35;`
- [ ] purgeOldAuditLog — chunked:

```ts
export function purgeOldAuditLog(retentionDays: number): number {
  const db = getDb();
  const cutoff = /* pastreaza formula existenta de cutoff */;
  let total = 0;
  // v2.37.1: chunked ca purgeOldRuns — DELETE-ul unbounded tinea write lock-ul
  // pe un full scan; cu idx_audit_log_ts (0035) + LIMIT, fiecare batch e scurt.
  for (;;) {
    const r = db
      .prepare(`DELETE FROM audit_log WHERE rowid IN (SELECT rowid FROM audit_log WHERE ts < ? LIMIT 1000)`)
      .run(cutoff);
    total += r.changes;
    if (r.changes < 1000) break;
  }
  return total;
}
```

(pastreaza semnatura/cutoff-ul existente; vezi `purgeOldRuns` din monitoringRunsRepository.ts:147-167 pentru pattern.)
- [ ] Run: `npm test --workspace=backend -- --run audit` → PASS; testul 0034 ramane verde.
- [ ] Commit: `perf(db): audit_log ts index (0035) + chunked purge`

## Task 13: ICCJ reziduuri (cluster 9) + extragere fetchCurrentDosar (cluster 8)

**Files:** Create: `backend/src/services/monitoring/iccjFetchCurrent.ts` + `.test.ts`, `backend/src/services/iccj/iccjSectiiIds.ts`. Modify: `backend/src/index.ts:669-690`, `backend/src/routes/dosareIccj.ts:36-50,62-71` (+ termene twin), `backend/src/db/monitoringJobsRepository.ts:88-92`.

- [ ] iccjFetchCurrent.ts:

```ts
import { IccjSourceError } from "../iccj/iccjClient.ts";
// tipurile/semnaturile: oglindeste exact deps.fetchCurrentDosar din iccjRunner.ts

// Strip marker-ele scj.ro `*`/`**` (trailing SI mid-string inainte de `/`,
// ex. "1859/107/2009**/a3.1"); conservativ — nu atinge alte caractere.
export function normalizeIccjNumar(s: string): string {
  return s.replace(/\*+(?=\/|\s*$)/g, "").trim();
}

export function makeIccjFetchCurrentDosar(deps: {
  searchIccj: typeof import("../iccj/iccjClient.ts").searchIccj;
  fetchIccjDetail: typeof import("../iccj/iccjClient.ts").fetchIccjDetail;
}) {
  return async (
    { numarDosar, iccjId }: { numarDosar: string; iccjId?: string },
    { signal }: { signal?: AbortSignal }
  ) => {
    if (iccjId) return deps.fetchIccjDetail(iccjId, { signal });
    const wanted = normalizeIccjNumar(numarDosar);
    // v2.37.1: query-ul pleaca NORMALIZAT (inainte trimitea string-ul decorat
    // "107/213/2017**" -> potential 0 match la match literal pe scj.ro).
    const res = await deps.searchIccj({ numarDosar: wanted }, { signal });
    const matches = res.dosare.filter((d) => normalizeIccjNumar(d.numar) === wanted);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new IccjSourceError(`ambiguous ICCJ match for "${numarDosar}" (${matches.length} dosare)`);
    }
    return deps.fetchIccjDetail(matches[0].iccjId, { signal });
  };
}
```

- [ ] index.ts: inlocuieste closure-ul cu `fetchCurrentDosar: makeIccjFetchCurrentDosar({ searchIccj, fetchIccjDetail })` (pastreaza comentariile-cheie in noul modul).
- [ ] Teste (4): cu iccjId → doar detail, fara search; sufix `**` normalizat → match + detail cu id-ul gasit; 0 match → null; 2 match → IccjSourceError. Mock deps simple (vi.fn).
- [ ] targetForHash (monitoringJobsRepository.ts:89): `.replace(/\*+\s*$/, "")` → `.replace(/\*+(?=\/|\s*$)/g, "")` + nota: hash-ul se schimba DOAR pentru target-uri cu marker mid-string (pana acum imposibil de creat curat — risc ~0 de dedup miss pe joburi existente).
- [ ] iccjSectiiIds.ts:

```ts
// Mirror al frontend/src/lib/iccjSectii.ts (Department ids scj.ro, 2026-06-06).
// "" = toate sectiile (fara filtru).
export const ICCJ_SECTII_IDS = new Set([
  "", "154", "155", "157", "158", "163", "182", "183", "190", "202", "210",
]);
```

- [ ] dosareIccj.ts: `import { isValidDate } from "../util/validation.ts";`, `badDate` → `!!v && !isValidDate(v)`; validare sectie pe ambele rute: `if (sectie && !ICCJ_SECTII_IDS.has(sectie)) return c.json({ error: "Sectie necunoscuta." }, 400);`; mapError:

```ts
function mapError(err: unknown): { status: 502 | 504 | 500; message: string } {
  if (err instanceof IccjSourceError) {
    return { status: 502, message: "Serviciul ICCJ (scj.ro) nu a raspuns corect. Incercati din nou." };
  }
  if (err instanceof IccjParseError) {
    return { status: 502, message: "Raspuns neasteptat de la ICCJ (scj.ro). Reincercati mai tarziu." };
  }
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return { status: 504, message: "Serviciul ICCJ (scj.ro) nu a raspuns in timp util. Incercati din nou." };
  }
  return { status: 500, message: "Eroare la comunicarea cu ICCJ." };
}
```

si in catch-uri: `const clientGone = c.req.raw.signal.aborted; if (!clientGone) console.error(...)`.
- [ ] Run: `npm test --workspace=backend -- --run iccj` → PASS.
- [ ] Commit: `fix(iccj): normalized docket in fallback query, mid-string markers, sectie enum, real-date guard, 504 on timeout; extract+test fetchCurrentDosar`

## Task 14: Verificare finala (gates CLAUDE.md)

- [ ] `npx biome check --write .` → re-stage daca reformateaza.
- [ ] `npx tsc --noEmit -p backend/tsconfig.json` si `cd frontend && npx tsc --noEmit` → PASS.
- [ ] `npm run build` → PASS.
- [ ] `npm test --workspace=backend` (≈1374+) si `cd frontend && npx vitest run` (232) → PASS.
- [ ] Commit final daca biome a atins fisiere: `style: biome format pass`.
- [ ] NU push — userul decide merge/push/release (la release: bump v2.37.1 + checklist CLAUDE.md, inclusiv changelog-entries.tsx).

---

## Amanate deliberat (cu motiv) — raman in backlog-ul reviewului

- **Cluster 6 partial (soft-delete joburi + exceptii retentie audit):** decizie de produs (schema noua + filtrare in toate listarile); de discutat inainte.
- **Cluster 7 rest (bucket rate-limit rnpm/saved, semafor global ICCJ, weight v1/ai):** relevante doar la web cutover; se livreaza in valul web.
- **Cluster 10 (cheie compusa numar|institutie pe 3 straturi):** schimba vizibil UX-ul de selectie/export; val propriu cu teste UI.
- **Cluster 11 (SSE after-commit + outbox email):** corecte, dar ating seam-ul de fanout — cer design + teste dedicate (at-least-once vs duplicate).
- **Cluster 12 rest (422→400, saved page 0→1 sincronizat FE+BE, balance 400→502, frame-uri SSE timeout/aborted in client):** schimbari de contract; pachet API separat.
- **captchaSolver test suite + route tests dosareIccj complete; README __fixtures__; stergerea searchSedinteIccj (cod mort — semnalat, nu sters, per regula Karpathy); rnpm detail parts Zod; dt-label IccjParseError; MetricsPanel "N din M"; Termene ICCJ live date filter; paginare ICCJ page<20 client:** valoroase, dar sub pragul acestui val — pastrate in `.claude/reviews/920ef31-full-app.md`.
