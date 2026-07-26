# Autocompact conditionat dupa delete-batch RNPM — Implementation Plan (Rev. 2)

> **Rev. 2:** corectiile review-ului adversarial Codex (2026-07-12) sunt integrate in sectiunea "Rev. 2 — corectii obligatorii" de la final; unde exista conflict, Rev. 2 castiga asupra textului initial al taskurilor.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stergerea pe selectie a avizelor (`POST /saved/delete-batch`) elibereaza automat si spatiul pe disc cand cantitatea eliberata e semnificativa — un singur click, rezultatul asteptat — fara sa incetineasca stergerile mici cu compactari inutile.

**Architecture:** Dupa mutatia de delete comisa, ruta masoara spatiul liber intern al fisierului RNPM al ownerului (PRAGMA freelist_count/page_count pe handle-ul din registry) si, daca pragul e depasit (default: >=10 MB liber SI >=20% din fisier), ruleaza compactarea existenta `compactRnpmDbViaWorker` (maintenance write lock + latch de owner, refuz tipat la cautare activa/restore). Esecul compactarii NU rastoarna delete-ul: raspunsul devine `{ deleted, compacted: false }` iar UI-ul afiseaza avertismentul deja folosit la "Sterge tot" (RnpmSavedStats.tsx:208). Pragul e configurabil prin env (kill switch operational: valoare foarte mare = dezactivat).

**Tech Stack:** TypeScript (Hono backend + React frontend), better-sqlite3, vitest, biome.

## Global Constraints

- Romana fara diacritice in cod sursa; copy UI in romana.
- SQL raw / PRAGMA DOAR in `backend/src/db/**` (repository-only) — masurarea freelist si decizia traiesc in `backup.ts`, NU in ruta.
- Delete-ul comis nu se rastoarna: orice esec de compactare = `compacted:false` + log + audit, niciodata 500 peste o stergere reusita (contract Rev. 4, identic cu delete-all).
- Gate pre-commit: biome -> `npx tsc --noEmit -p backend/tsconfig.json` + `cd frontend && npx tsc --noEmit` -> teste backend + frontend afectate. Fara push fara confirmare. Serverul dev-web-local NU se opreste.
- Fara bump de versiune in acest plan.

---

### Task 1 (backend): pragul pur + `maybeAutoCompactRnpm`

**Files:**
- Modify: `backend/src/db/backup.ts` (dupa `compactRnpmDbViaWorker`, ~linia 1125)
- Test: `backend/src/db/rnpmAutoCompact.test.ts` (nou)

**Interfaces:**
- Consumes: `compactRnpmDbViaWorker(ownerId)` (existent, backup.ts:1109 — write lock + latch + refuz tipat), `getRnpmDb(ownerId)` (handle registry, rnpmDb.ts).
- Produces:
  - `shouldAutoCompactRnpm(freelistBytes: number, totalBytes: number, minFreeBytes: number): boolean` — functie PURA: `freelistBytes >= minFreeBytes && totalBytes > 0 && freelistBytes / totalBytes >= 0.2`.
  - `readAutoCompactMinFreeBytes(): number` — env `LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB` (default 10; invalid => default cu warn o data per proces, pattern `readDefaultQuotaMilli`).
  - `maybeAutoCompactRnpm(ownerId: string): Promise<{ attempted: boolean; compacted: boolean; freedBytes: number }>` — masoara PRAGMA pe handle, decide cu functia pura; sub prag => `{attempted:false, compacted:false, freedBytes:0}`; peste prag => apeleaza `compactRnpmDbViaWorker` si intoarce `{attempted:true, compacted:true, freedBytes: beforeBytes-afterBytes}`; erorile TIPATE (search activ / restore / shutdown) => `{attempted:true, compacted:false, freedBytes:0}` + `logBackupEvent({action:"rnpm_autocompact_skipped", ...})`; erorile netipate se PROPAGA doar din masurare (inainte de decizie), dar din compactare se logheaza si intorc `compacted:false` (delete-ul e deja comis — acelasi contract ca delete-all).

- [ ] **Step 1: Teste rosii (unit, functia pura + orchestrarea)**

```ts
// backend/src/db/rnpmAutoCompact.test.ts
import { describe, expect, it } from "vitest";
import { shouldAutoCompactRnpm } from "./backup.ts";

describe("shouldAutoCompactRnpm", () => {
  it("sub pragul absolut nu compacteaza chiar la procent mare", () => {
    expect(shouldAutoCompactRnpm(5 * 1024 * 1024, 6 * 1024 * 1024, 10 * 1024 * 1024)).toBe(false);
  });
  it("peste pragul absolut dar sub 20% din fisier nu compacteaza", () => {
    expect(shouldAutoCompactRnpm(15 * 1024 * 1024, 200 * 1024 * 1024, 10 * 1024 * 1024)).toBe(false);
  });
  it("peste ambele praguri compacteaza", () => {
    expect(shouldAutoCompactRnpm(50 * 1024 * 1024, 200 * 1024 * 1024, 10 * 1024 * 1024)).toBe(true);
  });
  it("fisier gol (totalBytes 0) nu compacteaza si nu imparte la zero", () => {
    expect(shouldAutoCompactRnpm(0, 0, 10 * 1024 * 1024)).toBe(false);
  });
});
```

Plus 2 teste de integrare in acelasi fisier (DB temp real, pattern-ul din `rnpmBackup.test.ts`: `LEGAL_DASHBOARD_DB_PATH` pe mkdtemp + `getRnpmDb` provisioning):
- seed cu avize + bunuri voluminoase, delete masiv prin repository, env `LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB=0.1` -> `maybeAutoCompactRnpm` intoarce `attempted:true, compacted:true, freedBytes>0` si `page_count` scade.
- acelasi setup dar cu `vi.spyOn`/mock pe compactare care arunca `RnpmSearchActiveError` -> `attempted:true, compacted:false` si evenimentul `rnpm_autocompact_skipped` logat (captureaza logBackupEvent prin spy pe console.log, pattern-ul suitei backup).

- [ ] **Step 2: Ruleaza si confirma RED** — `npx vitest run src/db/rnpmAutoCompact.test.ts` (din backend/): FAIL pe importuri inexistente.

- [ ] **Step 3: Implementarea in `backup.ts`** — cele 3 functii de mai sus; masurarea: `const db = getRnpmDb(ownerId); const pageSize = db.pragma("page_size", {simple:true}); const pageCount = db.pragma("page_count", {simple:true}); const freelist = db.pragma("freelist_count", {simple:true});` `totalBytes = pageSize*pageCount`, `freelistBytes = pageSize*freelist`. Ratia 0.2 e constanta locala documentata (`AUTOCOMPACT_MIN_FREE_RATIO`).

- [ ] **Step 4: GREEN** — aceeasi comanda, toate trec.

- [ ] **Step 5: Commit** — `git add backend/src/db/backup.ts backend/src/db/rnpmAutoCompact.test.ts && git commit -m "feat(rnpm): maybeAutoCompactRnpm — prag pur (>=10MB si >=20% freelist, env override) peste compactRnpmDbViaWorker, esec tipat nu rastoarna delete-ul"`

---

### Task 2 (backend): ruta delete-batch apeleaza autocompact + contract de raspuns

**Files:**
- Modify: `backend/src/routes/rnpm.ts:889-920` (ruta `POST /saved/delete-batch`)
- Test: `backend/src/routes/rnpm.contract.test.ts` (describe nou) sau fisier dedicat `backend/src/routes/rnpmDeleteBatchCompact.test.ts` daca harness-ul contract nu se preteaza

**Interfaces:**
- Consumes: `maybeAutoCompactRnpm(ownerId)` din Task 1.
- Produces: raspunsul rutei devine `{ deleted: number; compacted?: boolean; freedBytes?: number }` — `compacted`/`freedBytes` PREZENTE doar cand pragul a cerut compactare (`attempted:true`); absente = nu a fost nevoie (stergere mica). Audit `aviz.delete_batch` primeste in detail `compacted`/`freedBytes` cand attempted.

- [ ] **Step 1: Teste rosii (route-level, DB temp real)**
  - stergere mica (prag default nedepasit): raspunsul NU contine `compacted` (backward compatible).
  - stergere mare cu `LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB=0.1`: raspunsul contine `compacted:true` si `freedBytes>0`; fisierul pe disc s-a micsorat.
  - compactare refuzata tipat (mock `maybeAutoCompactRnpm` -> `{attempted:true, compacted:false, freedBytes:0}`): status 200, `deleted` corect, `compacted:false`.

- [ ] **Step 2: RED** -> **Step 3: Implementare** (dupa `deleteAvizeByIds` + audit: `const auto = await maybeAutoCompactRnpm(ownerId).catch(...)` — catch generic => log + `{attempted:true, compacted:false}`; raspuns si audit conform contractului) -> **Step 4: GREEN**.

- [ ] **Step 5: Commit** — `fix(rnpm): delete-batch elibereaza automat spatiul pe disc cand freelist-ul depaseste pragul — compactare atomica sub write lock, esec tipat raportat compacted:false fara a rasturna delete-ul`

---

### Task 3 (frontend): contract client + avertisment la compactare esuata

**Files:**
- Modify: `frontend/src/lib/rnpmApi.ts:340-349` (`rnpmDeleteAvizeBatch` intoarce `{ deleted, compacted?, freedBytes? }`)
- Modify: `frontend/src/components/rnpm/RnpmSavedData.tsx` (handler `handleDeleteSelected`, ~liniile 165-184: stare noua `deleteWarning`, afisata inline peste lista — acelasi copy ca RnpmSavedStats.tsx:208-210)
- Test: `frontend/src/components/rnpm/RnpmSavedData.test.tsx` (extinde harness-ul existent daca exista; altfel test nou jsdom pe pattern-ul RnpmStorage.test.tsx)

**Interfaces:**
- Consumes: raspunsul Task 2.
- Produces: la `compacted === false` UI-ul afiseaza: "Avizele au fost sterse, dar eliberarea spatiului pe disc a esuat. Spatiul se recupereaza la urmatoarea compactare reusita." La `compacted === true` sau camp absent: niciun mesaj suplimentar (asteptarea e implinita silentios).

- [ ] **Step 1: Test rosu** — mock `rnpmDeleteAvizeBatch` -> `{deleted: 5, compacted: false}`; dupa confirmare, textul de avertisment apare; cu `{deleted: 5}` (fara camp) nu apare.
- [ ] **Step 2: RED** -> **Step 3: Implementare** -> **Step 4: GREEN**.
- [ ] **Step 5: Commit** — `feat(ui): avertisment cand delete-batch sterge dar compactarea automata esueaza (paritate cu Sterge tot)`

---

### Task 4: gate final + documentare env

**Files:**
- Modify: `SESSION-HANDOFF.md` (randul nou in tabelul de kill switches: `LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB` — default 10; valoare foarte mare = autocompact dezactivat operational)

- [ ] `npx biome check --write` pe toate fisierele atinse; `npx tsc --noEmit -p backend/tsconfig.json`; `cd frontend && npx tsc --noEmit`; `npm test --workspace=backend`; `cd frontend && npx vitest run`.
- [ ] Commit final doc + eventualele reformatari.

---

## Decizii (context pentru reviewer)

1. **Prag dublu (>=10 MB SI >=20%)** — stergerile mici raman instante (fara VACUUM inutil care rescrie tot fisierul); stergerile masive (cazul real de azi: 202 MB freelist / 99.9%) compacteaza sigur. Ratia singura ar compacta fisiere mici degeaba; pragul absolut singur ar compacta prea des fisierele mari.
2. **Sincron, in acelasi request** — raspunsul poate raporta onest `compacted`/`freedBytes`; costul e platit doar la stergeri mari (compactarea de azi pe ~200 MB: 2.9s masurat in log). Identic filozofic cu delete-all (EXT-M-01), care e tot sincron.
3. **Esecul compactarii nu rastoarna delete-ul** — contract existent Rev. 4 / delete-all; UI reutilizeaza avertismentul existent, zero copy nou de tradus.
4. **Scope: DOAR `POST /saved/delete-batch`** — delete-all compacteaza deja atomic; `DELETE /saved/:id` si `DELETE /searches/:id` sterg volume mici (sub prag prin natura lor) si se pot adauga ulterior in 2 linii fiecare daca apare nevoia. Semnalat, nu implementat (YAGNI).
5. **Env-ul e si kill switch** — valoare mare (ex. 100000) dezactiveaza autocompact-ul fara deploy; nu introducem un al doilea env dedicat.
6. **Masurarea freelist pe handle-ul registry** (`getRnpmDb`) — provisioneaza fisierul daca lipseste, dar ruta delete-batch a rulat deja `deleteAvizeByIds` care il provisioneaza oricum; nu se creeaza fisiere noi pentru useri fara activitate.
7. **Fara cooldown per owner** — dupa o compactare freelist-ul e ~0, deci pragul se re-atinge doar dupa alta stergere masiva; seria de stergeri pagina-cu-pagina din testarea de azi ar fi declansat cel mult 2 compactari, ambele utile.

## Riscuri semnalate (de validat in review)

- **Latenta pe fisiere foarte mari**: compactarea unui fisier de 1 GB poate dura >10s in request; clientul are timeout? (de verificat in review: `apiFetch` nu seteaza timeout explicit; Electron/browser default e generos). Alternativa respinsa: compactare async post-raspuns — raspunsul n-ar mai putea raporta `compacted` si am reintroduce "a doua actiune" sub alta forma.
- **Interactiune cu maintenance write lock**: compactarea dupa delete NU mai e atomica cu delete-ul (spre deosebire de delete-all) — o cautare pornita exact intre delete si compact ruleaza legitim, iar COMPACTAREA e cea refuzata tipat (`compacted:false`); acceptat, avertismentul UI acopera. (Corectie Codex #3: cautarea nu e refuzata, compactarea da.)

---

## Rev. 2 — corectii obligatorii (review Codex, findings CONFIRM acceptate)

1. **Re-verificare a pragului SUB write lock + coalescing (Codex #4).** `maybeAutoCompactRnpm` masoara pragul de doua ori: o data inainte (decizia ieftina, evita lock-ul pentru stergeri mici) si INCA O DATA in interiorul `compactRnpmDbViaWorker`-path-ului, dupa dobandirea lock-ului — daca intre timp alta cerere a compactat deja (freelist sub prag), se iese cu `{attempted:true, compacted:true, freedBytes:0, coalesced:true}` fara VACUUM duplicat. Implementare: compactarea se apeleaza printr-o varianta `compactRnpmIfStillNeeded(ownerId, minFreeBytes)` care face recheck-ul inauntru.
2. **Audit separat, fara fereastra de pierdere (Codex #6).** `aviz.delete_batch` se inregistreaza IMEDIAT dupa commit-ul delete-ului, exact ca azi (neatins). Compactarea emite un eveniment DISTINCT `rnpm.autocompact` (recordAuditSafe) cu `detail: { attempted, compacted, freedBytes, reason?, durationMs }`. Un crash intre delete si compact lasa intact auditul stergerii.
3. **Kill switch explicit (Codex #8).** Env nou `LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_DISABLED=1` = dezactivare semantica (nu "valoare mare" la prag). Documentare: rand in tabelul de kill switches din SESSION-HANDOFF.md + `.env.example` (daca exista in repo) + pass-through in `docker-compose` acolo unde sunt listate env-urile operationale. Pragul MB ramane separat, doar pentru tuning.
4. **Seam injectabil pentru teste (Codex #10).** `maybeAutoCompactRnpm(ownerId, deps?: { compact?: typeof compactRnpmIfStillNeeded })` — parametrul cu default permite testelor sa injecteze esecuri (tipate si netipate) fara mock pe binding lexical intern (vi.spyOn pe export-ul aceluiasi modul NU intercepteaza apelul intern — capcana documentata in rnpmBackup.test.ts).
5. **Teste de boundary si env (Codex #9).** Se adauga la Task 1: prag exact (freelistBytes == minFreeBytes → true; minFreeBytes-1 → false; ratie exact 0.2 → true; sub → false), env invalid ("abc", "-5", "1.5", "" → default 10 cu warn o data), env "0" (compacteaza agresiv, valid pentru teste), plus un test de esec NETIPAT al compactarii (injectat prin seam) → `compacted:false` + eveniment logat, delete-ul ramane 200.
6. **Latenta sincrona (Codex #7) — decizie asumata, nu ignorata.** Compactarea ramane SINCRONA in request, cu doua garduri: (a) feature-ul de cap de stocare per user (plan separat, aprobat de principiu: default 200 MB) plafoneaza dimensiunea fisierelor, deci si durata VACUUM (masurat azi: 2.9s la 200 MB); (b) nota de deploy in RUNBOOK/DEPLOY-SERVER: timeout-ul oauth2-proxy/Cloudflare pe rutele API trebuie sa fie >=60s (documentat, nu cod). Alternativa job async + status API ramane escaladarea daca in practica apar timeouts — semnalata, nu implementata (YAGNI cat timp cap-ul exista).
7a. **Rev. 3 (review-panel multi-model, 2026-07-12) — corectii suplimentare care CASTIGA asupra Rev. 2:**
   - **(HIGH) Recheck-ul sub lock NU poate folosi `getRnpmDb`**: latch-ul de restore setat de `compactRnpmDbViaWorker` (backup.ts:1113-1118) blocheaza `getRnpmDb`. Secventa corecta in `compactRnpmIfStillNeeded`: sub write lock, DUPA `beginRnpmRestore`, se deschide handle DIRECT (`openRnpmDbHandleDirect`), se masoara PRAGMA freelist/page pe el, se INCHIDE handle-ul, apoi VACUUM INTO. Test dedicat: cautare pornita intre prima masurare si latch => refuz tipat, nu VACUUM peste scrieri.
   - **(HIGH) Justificarea sincron se recalculeaza la cap-ul REAL de 500 MB** (planul-frate; 200 MB era cifra veche): ~7-9s estimat la 500 MB (2.9s masurat la 200 MB; extrapolarea liniara e optimista), pana la ~15s pentru fisiere supradimensionate instalate prin restore. Ramane SINCRON (decizie user), sub nota de deploy proxy >=60s; fara escaladare async in acest batch.
   - Parser-ul de prag accepta fractii finite >=0 (ex. "0.1" valid — testele depind de el); DOAR NaN/negativ/non-finit => default cu warn. Se scoate "1.5" din cazurile invalide.
   - Tipul de retur devine `{ attempted; compacted; freedBytes; coalesced?; durationMs?; reason? }` — altfel auditul promis la Rev. 2 #2 nu e implementabil.
   - Kill switch definit functional: `LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_DISABLED=1` => `{attempted:false}` (fara camp `compacted` in raspuns, fara avertisment UI, dependinta de compactare neapelata) + test.
   - ENOSPC la VACUUM INTO => rezultat tipat `compacted:false, reason:"enospc"` (nu throw netipat care ar incalca contractul "delete-ul nu se rastoarna") + test cu fault injection pe runSnapshotOp.
   - Scope extins: acelasi `maybeAutoCompactRnpm` se apeleaza si pe `DELETE /saved/:id` si `DELETE /searches/:id` (rnpm.ts:1260, :1389) — altfel freelist-ul din stergeri individuale nu se recupereaza niciodata si consuma limita de stocare din planul-frate.
   - Test anti-provisioning: delete-batch fara potriviri pentru un user FARA fisier RNPM => `{attempted:false}` si NICIUN fisier creat pe disc.
   - Test de concurenta REALA (nu mock): cautare care porneste intre delete si compact => `RnpmSearchActiveError` la `beginRnpmRestore` => 200 cu `compacted:false` + eveniment `rnpm_autocompact_skipped`.

7. **Riscuri acceptate, declarate formal**: (a) ENOSPC la VACUUM INTO (fisier temporar ~= datele vii) — esec TOLERAT si raportat (`compacted:false` + eveniment + avertisment UI), fara preflight de spatiu (complexitate statfs nejustificata la fisiere plafonate de cap); (b) toate lock-urile (maintenance, active-search, restore latch) sunt process-local — constrangere SINGLE-INSTANCE pre-existenta a intregii aplicatii (identica pentru delete-all/compact/restore de azi), documentata ca atare in plan, nu introdusa de acest feature.
