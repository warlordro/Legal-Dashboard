# Session Handoff

**Versiune curenta**: v2.43.2 (2026-07-21) — branch `feat/v2.43.0-rnpm-split`. v2.43.2 = refresh model AI (Gemini 3.5 Flash -> 3.6 Flash, cheie interna `gemini-flash-3.6`, nativ + OpenRouter). Munca de dupa push-ul initial din 13 iulie (remediere sec + rezultate partiale PortalJust) e reincadrata ca release patch v2.43.1 peste v2.43.0.

Document de context transfer intre sesiuni Claude. Pentru istoric versiuni detaliat
vezi [CHANGELOG.md](CHANGELOG.md). Aici tin doar reguli active de lucru,
operational kill switches, riscuri ramase si directii deschise pentru urmatorul agent.

## Stadiu curent (2026-07-20): remediere sec + rezultate partiale PortalJust livrate pe branch

Dupa push-ul initial v2.43.0 (13 iulie), pe acelasi branch s-au livrat si pushuit DOUA directii mari (reincadrate ca release patch v2.43.1), ambele dublu-review-uite adversarial (Codex GPT-5.6 Sol + panel multi-model):

**Remediere audit securitate + corectitudine** — guard CSRF desktop GLOBAL pe mutatiile `/api/*` (`X-Legal-Dashboard-Desktop`, exemptie PAT+SSE, kill switch cu warn la boot) (SEC-01); Electron 41.10.2 patch Chromium via lockfile (SEC-02a); gate trusted-proxy fail-closed la boot pe web+loopback fara `TRUSTED_PROXY_CIDR`, cu validare reala a CIDR-urilor + clasificator loopback unificat + `::1/128` (NEW-02); `redirect:manual` + guard 3xx pe validarea cheilor API si pe SOAP PortalJust (SEC-04); cap 20MB pe raspunsul RNPM (`response_too_large`) + drenare `warmSession` ICCJ si body-uri abandonate (SEC-07); sanitizare `faultstring` + `decodeXmlEntities` cu `U+FFFD` (SEC-05/06); respingere placeholder JWT secret (SEC-11); IPC notificari fail-closed + validare `will-redirect` + `unref` timer shutdown (SEC-08/10, BUG-08); raport zilnic email retry off-hour STRICT per-owner care supravietuieste miezului noptii (BUG-04); `409 in_flight` pe race monitoring runs (BUG-03); clamp `pagesTotal` RNPM (BUG-06); cleanup tmp PDF cu `finished()` (BUG-01); `try/finally` pe splitter (BUG-05); backup fail-closed pe sidecar WAL ilizibil si ledger RNPM gol; avertizari buget AI respecta web-mode; manual in-app + DEPLOY-SERVER + versiuni deploy corectate; tracking `GHSA-w5hq-g745-h8pq`. Riscuri acceptate in SECURITY.md.

**Rezultate partiale la cautarea PortalJust** — la esecul apelului agregat, `GET /api/dosare` face fallback tolerant per instanta (~246 instante, concurenta 10, buget 120s, max 2 fallback-uri concurente/proces, cap fail-closed 413) si intoarce rezultatele sanatoase + `failedInstitutii`; la >=2 instante selectate esecurile nu mai sunt inghitite silentios. UI: banner amber cu instantele fara raspuns, empty-state temperat, confirmare la export XLSX/PDF partial. Contract in `API.md` + OpenAPI (200 poate fi partial; `exactMatch` garantat doar fara `failedInstitutii`; dedup `institutie|numar`). Verificat LIVE pe pana reala Galati: fallback 23s, 240 dosare. Plus UI: Dashboard afiseaza garantiile de securitate corecte per mod (desktop = OS keystore/loopback; web = chei server-side criptate).

Detaliul complet e in CHANGELOG v2.43.1 si SECURITY.md (rand `2026-07-20`). Sectiunile de mai jos raman istoric datat imutabil.

## Sprint EXECUTAT: fixuri post-review adversarial split (acelasi branch `feat/v2.43.0-rnpm-split`)

**Context:** dupa executia integrala a split-ului (sectiunea urmatoare), userul a cerut
review adversarial dublu pe delta `aac59da..89986ff`: Codex GPT-5.6 Sol (verdict: NU e
merge-ready — 0 CRITICAL, 5 HIGH, 6 MEDIUM, 2 LOW) + review-panel (Opus+Kimi). Findings-urile
au fost consolidate intr-un plan de fixuri care a trecut EL INSUSI printr-un review de panel
(4 modele) si a fost corectat la Rev. 2.

**SURSA UNICA de executat:** `docs/superpowers/plans/2026-07-10-fixes-review-rnpm-split.md`
(Rev. 2, comis in ea85f79). 8 task-uri TDD, 3 commit-uri consolidate: COMMIT A dupa Task 3,
COMMIT B dupa Task 6, COMMIT C dupa Task 8. Planul contine si sectiunile "Findings RESPINSE
cu dovezi" si "Acceptate ca limitari" — NU le redeschide.

**STARE EXECUTIE: TOATE task-urile 1-8 COMPLETE pe TDD (2026-07-10), 3 commit-uri
consolidate pe branch:**
- **Commit A (2bd4a55)** — Task 1-3: restore atomic prin STAGING (fault-injection
  complet, auto-revert reordonat, retry EPERM, fail-closed pe lipsa
  `_schema_versions` la rnpm), serializare delete-all sub maintenance lock,
  prune si la restore, pool DEDICAT pre-split (3, regex exclusiv + prune sincron
  in `preSplitBackupStrict`), cooldown cu refund la esec, 400 pe ownerId admin
  invalid, marker split validat runtime fail-closed + manifest cu count-uri pe
  calea de resume `wiping` (testul vechi de resume adaptat INSERT->UPDATE — cu
  manifest, dovada no-re-copy e continutul modificat, nu count-ul crescut).
- **Commit B (d90b667)** — Task 4-6: gate master-key INAINTE de split (web),
  schema-init cu atributie proprie, `MaintenanceShutdownError` (503 +
  Retry-After central) cu flag verificat inainte de coada lock-ului + settle-set
  care include timpul de asteptare pe lock (plafon 30s la shutdown), latch
  global `RESTORE_IN_PROGRESS` pe `getDb()` la restore-ul monolitului
  (indisponibilitate globala scurta, documentata RUNBOOK) cu anti-self-block,
  validare versiune monolit (legacy fara tabela ramane acceptat), rethrow pe
  erorile tipate din catch-urile generice rnpm.ts + adminBackups.ts, prewarm
  rnpm gate-uit pe desktop, stats/compact fara provisioning (latch prioritar
  la 409), warn `proxy.trusted_cidr.missing` + docs DEPLOY-SERVER/RUNBOOK.
- **Commit C** — Task 7-8: VACUUM INTO in WORKER THREAD (`snapshot-worker.cjs`
  + `snapshotRunner.ts`, timeout 10 min cu terminate pe toate caile, fallback
  sincron cu warn `snapshot.worker_fallback`, copiat in dist-backend de
  build.js + asarUnpack), toate snapshot-urile (daily/manual/pre-restore) pe
  varianta async, compact per user = `compactRnpmDbViaWorker` (swap atomic sub
  maintenance lock, in bracket `beginRnpmRestore`/`endRnpmRestore` — DECIZIE
  luata cu advisorul Codex, optiunea B: inchide fereastra de lost-write dintre
  VACUUM INTO si rename; guard explicit anti-clobber pe latch pentru ca
  `beginRnpmRestore` nu e reentrant-aware), `compactRnpmDb`/`compactDb` vechi
  marcate DEPRECATED (nu sterse), anti-drift intarit pe DEFINITII (SQL
  normalizat + `index_xinfo`, inclusiv autoindexuri UNIQUE), CHANGELOG
  sub-sectiune "Fixuri post-review adversarial", RUNBOOK actualizat.
- **REVIEW ADVERSARIAL FINAL FACUT (2026-07-10/11)** pe delta `485c455..f29e510`:
  Codex GPT-5.6 Sol (`review-mresqsud-5igk0y`, verdict NO-SHIP: 3 HIGH, 2 MEDIUM)
  + review-panel multi-model (5 MEDIUM, ~6 LOW; concurenta/staging/swap
  verificate CURATE de 3-4 revieweri). Findings-urile consolidate in planul
  **Rev. 3** (`docs/superpowers/plans/2026-07-11-fixes-rev3-rnpm-split.md`),
  care a trecut EL INSUSI prin review de panel (BLOCKER gasit: catch-ul de
  staging distrugea code-ul erorilor tipate) si a fost corectat inainte de executie.
- **Commit D (Rev. 3)** — toate cele 8 task-uri executate pe TDD: asarUnpack
  bindings + file-uri-to-path + handshake `ready` cu fallback pe esec ASYNC de
  startup (worker viabil in Electron impachetat); refuz 400 la restore de
  monolit pre-split dupa split (inclusiv marker ilizibil = fail-closed);
  validare ledger de migratii pe copia STAGED (hash + self-heal raw/crlf +
  sentinel v1 + prefix contiguu 1..N) prin hook-ul `verifyStaged`, cu rethrow
  tipat in catch-ul de staging (BLOCKER-ul panelului); reconciliere owneri
  monolit vs marker la resume-ul wiping; retry pe publish-ul snapshot-urilor +
  writeMarker; settle STRICT dupa terminate confirmat (fara plafon in runner;
  plafonul de shutdown ramane in waitForBackupToSettle) + integrity_check mutat
  IN worker (`assertSnapshotNonEmpty` pe main); auto-revert dublu-esuat cu
  context complet + code pastrat; camp `compacted` pe DELETE /saved/all;
  asertia moarta `.restore.tmp` inlocuita; teste de regresie documentate ca
  exceptii TDD (6.1, anti-clobber); testul settle-peste-worker determinist
  (worker lent injectat prin `__setSnapshotWorkerPathForTests`).
- **REVIEW CODEX PE INTREG BRANCH-UL FACUT (2026-07-11)** — la cererea userului,
  pe `aac59da..ccab664`, dimensiuni: securitate/cod/bug-uri/rezilienta/
  arhitectura (`review-mrfijdtk-6hpgld`; prima lansare a facut STALL real —
  pid mort cu registry "running", anulata curat si relansata). Verdict:
  securitate + arhitectura CURATE; 1 HIGH rezilienta + 3 MEDIUM, toate
  verificate pe cod si inchise in **Rev. 4 (Commit E)** dupa acelasi workflow
  (plan `2026-07-11-fixes-rev4-rnpm-split.md`, corectat cu review-ul panelului
  pe plan — panel-ul a mai gasit: processAlive trata EPERM ca "mort"):
  instanceLock nu mai recupereaza un PID viu pe acelasi host (+ ESRCH-only,
  hint FORCE_BOOT in mesaj, test file NOU instanceLock.test.ts cu mock
  determinist pe process.kill si garduri cross-host), recordAuditSafe pe
  succesul restore-ului (rnpm + admin; red prin vi.mock in fisier dedicat
  rnpmBackups.auditSafe.test.ts — latch-ul nu functiona ca injectie, requireRole
  atinge getDb in middleware), nume unic la backup manual (ms + sufix plafonat,
  rezervat sub lock; stampNow sters), prune cu contorizare reala + warn
  `backup_prune_failed` pe EPERM/EBUSY/EACCES.
- **Rev. 5 (Commit F, focus deploy WEB, la decizia userului)** — cele 2 HIGH
  din review-ul Codex de inchidere pe Rev. 4 (`review-mrfka72k-z0p6y3`),
  ambele DIRECT relevante pe web: (1) `unlinkBundle` nu mai atinge sidecars
  cand stergerea principalului e refuzata (bundle legacy = date comise doar in
  WAL; recovery point corupt silentios); (2) reclaim-ul unui lock mort trece
  prin gate atomic O_EXCL (`.instance.lock.reclaim-gate`) cu re-evaluare
  COMPLETA sub gate (nonce + liveness + staleness — nonce-ul singur nu ajunge,
  heartbeat-ul il reimprospateaza neschimbat), ENOENT tipat pe rename,
  self-heal pe gate orfan (60s) si exception-safety testata prin fault
  injection (instanceLock.gate.test.ts, vi.mock pe node:fs). Planul
  `2026-07-11-fixes-rev5-rnpm-split.md` a trecut prin review de panel
  (verdict: design corect, zero Critical/High pe plan) inainte de executie.
  Limitari asumate documentate in plan: publicarea initiala a lock-ului
  (fereastra de microsecunde, pre-existenta), FORCE_BOOT in afara gate-ului,
  O_EXCL pe NFS, worst-case 60s pe gate orfan.
- **Rev. 5.1 (micro-fix, aprobat de user dupa review-ul de inchidere pe Rev. 5,
  `review-mrflqs9x-9ly5vf`):** F1 (bundle la prune) confirmat INCHIS de Codex;
  din cele 2 findings ramase: (a) MEDIUM reparat — mesaj EXPLICIT (errno +
  path) cand gate-ul orfan nu poate fi sters + warn structurat pe finally +
  fault-injection pe unlinkSync in instanceLock.gate.test.ts; (b) HIGH-ul
  "heartbeat vs reclaim cross-host" DOCUMENTAT ca in afara topologiei
  sustinute (volum partajat intre host-uri = nesuportat; pe single-host
  reclaim-ul same-host cere PID mort, care nu are heartbeat — cursa
  imposibila) — nota de topologie in RUNBOOK. VERDICT INTERN: branch-ul e
  merge-ready pe cod pentru web.
- Ramas pe RELEASE CHECKLIST: smoke pe artefact Electron IMPACHETAT
  (backup/restore/compact rulate din app.asar.unpacked — abia acolo se
  exerseaza real asarUnpack-ul + rezolutia bindings) + smoke web cu 2 useri pe
  dev-web-local.ps1 + `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` setat la deploy.

**Stare ABI better-sqlite3: NODE** (`npm rebuild better-sqlite3` rulat pentru vitest).
OBLIGATORIU `npm run rebuild:electron` inainte de orice smoke Electron si la finalul
sprintului (e pas explicit in Task 8.2).

**Reguli sprint (mostenite + noi):** TDD strict (red inainte de implementare); gate-uri
complete inainte de fiecare commit (biome pe fisierele atinse, tsc, build, suite);
commit-uri DOAR cele 3 consolidate (A/B/C); `git add` doar pe fisiere enumerate; push
DOAR la cererea userului; Codex (GPT-5.6 Sol) se foloseste ca ADVISOR la neclaritati sau
decizii de design (goal-ul setat de user).

**Capcane operationale Codex descoperite in sesiunea asta (respecta-le):**
- Lansarea prin subagentul `codex:codex-rescue` poate pica mid-flight cu task-ul TOTUSI
  pornit — inainte de relansare verifica `node .../codex-companion.mjs status --json`
  (altfel dublezi task-ul).
- `cancel` prin Git Bash mangleaza `taskkill /PID` (MSYS path conversion) — ruleaza cu
  `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"`; un cancel cu `/T` pe runtime-ul partajat
  a OMORAT silentios si un task legitim in curs (status ramane "running" stale — verifica
  pid-ul din `status <id> --json` cu tasklist inainte sa crezi registry-ul).
- Raportul Codex complet al review-ului: `node .../codex-companion.mjs result
  task-mreltttf-13q85p`; sesiune Codex reluabila: `codex resume 019f4ae4-a4f0-7ac1-a1b0-6af770a65f5e`.

**Alte note de mediu:** exista un `node dist-backend/index.cjs` ORFAN dintr-o sesiune
veche (PID 16792, pornit 2026-07-06) — nu e al sesiunilor noastre; de oprit manual daca
nu e intentionat. Fisierele de smoke ale sesiunii precedente sunt in scratchpad-ul ei
(efemere, nu conteaza).

## Sprint EXECUTAT: v2.43.0 — Split RNPM per user (branch `feat/v2.43.0-rnpm-split`)

**Decizia (2026-07-10, dupa incidentul restore whole-DB de la testul live):** separare fizica
DOAR pe modulul RNPM, per utilizator — fiecare user primeste fisierul lui SQLite
`rnpm/<stem>.db` cu backup/restore self-service (inclusiv backup manual); restul aplicatiei
(users, auth, quota, monitoring, audit, fx_rates) ramane in baza unica. Managementul backup-ului
bazei unice se muta in Setari (admin-only, cu backup manual si copy explicit). ID-urile de
search/aviz devin namespace per user — starea "foreign"/403 dispare, izolarea e fizica
(confirmat explicit de user: "fiecare user este izolat de celalalt"). Analiza comparativa a 5
variante (artifact HTML): https://claude.ai/code/artifact/bdd089f7-467c-433e-995d-80f85d98d236

**STARE: EXECUTAT INTEGRAL (Task 0-10, 2026-07-10), TDD strict, gate-uri complete la fiecare
commit.** Task 10 FACUT: `npm run check` verde de la zero (a cerut 2 fixuri de verificare:
template literal biome in Backups.tsx + release pe instance lock in testul remote-bind — flake
pre-existent de heartbeat orfan amplificat de load); smoke pe BUNDLE (dist-backend, port 3719,
DB copie): boot fresh marcheaza done fara split, seed pre-split + reboot => split REAL 2 owneri
(backup pre-split, marker, monolit 0 randuri, id-uri pastrate, descriere partajata in ambele
fisiere, _norm recalculat), API self-service ok (stats per-user, create/list backup, cooldown
429, restore), boot 3 fara re-split; smoke DESKTOP (Electron real, userData izolat prin
--user-data-dir pe monolitul pre-split): split la boot, backup manual -> sterge baza -> restore
cu reopen LAZY (fara restart), restart fara re-split, shutdown curat. NEFACUT (recomandat inainte
de merge, userul testeaza oricum live): smoke web cu 2 useri pe dev-web-local.ps1. Push NEFACUT.
Nota: exista un `node dist-backend/index.cjs` ORFAN al unei sesiuni vechi (PID 16792, pornit
2026-07-06) — nu i-am dat kill (nu e al sesiunii asteia); de oprit manual daca nu e intentionat.
Commit-uri (branch cu commit-uri consolidate, la cererea userului):
d4ff132 (Task 0 CodeRabbit) -> f8e341c (T1-T3: baseline migrations-rnpm, rnpmDb+rnpmActivity,
splitter nemontat) -> 27ad85f (T4-T5: CUTOVER atomic repositories + splitter la boot +
bracketing/garduri 409) -> 0e64961 (T6-T7: backup multi-target + rute self-service +
/api/v1/admin/backups) -> 0201545 (T8: frontend Baza mea RNPM + tab Setari > Backup) + commit-ul
de docs/bump v2.43.0. Stare gate-uri la final: 1795 teste backend + 347 frontend, biome/tsc/build verzi.

**DEVIERE documentata fata de plan (validata cu GPT-5.6 Sol prin /codex: la executie):**
ATTACH readonly prin URI percent-encodat NU functioneaza — better-sqlite3 e compilat fara
SQLITE_USE_URI, iar `PRAGMA mono.query_only` e connection-wide (ar bloca si scrierile in
target). Inlocuitor echivalent fail-closed: sursa monolit deschisa pe conexiune SEPARATA cu
`{ readonly: true }` (readonly REAL la nivel de OS) + copiere prin JavaScript intre conexiuni.
Comentariu in `rnpmSplitter.ts` la `openMonoSourceReadonly`.

**Sursele de adevar:**
1. `docs/superpowers/plans/2026-07-10-rnpm-split-per-user.md` — planul executabil (Rev. 3).
2. `docs/superpowers/specs/2026-07-10-rnpm-split-per-user-design.md` — spec-ul aprobat.

**Review consumat (3 runde; toate findings-urile confirmate sunt IN plan, cele respinse au
motivarea documentata in sectiunea "Istoric review" din plan):** review-panel multi-model
(Opus 4.8 + Kimi K2.7 + GLM-5.2 + DeepSeek V4, sinteza Fable) + GPT-5.6 Sol (2 rapoarte).
Decizii de design iesite din review — NU le "simplifica" inapoi la executie:
- nume de fisier = `rnpmFileStem` (lowercase + hash sha256 scurt) — coliziuni case-insensitive
  pe Windows/macOS + nume rezervate Windows;
- marker durabil `rnpm/.split-done.json` (faze wiping/done) + ABORT de boot daca monolitul e
  restaurat dintr-un backup pre-split (splitter-ul NU suprascrie fisiere per-user mai noi);
- cutover ATOMIC: Task 3 construieste splitter-ul NEMONTAT; Task 4 = rutare repositories +
  montare la boot intr-UN SINGUR commit;
- snapshot-uri self-contained prin `VACUUM INTO` peste tot (nu copyFile pe DB cu WAL);
- latch-ul de restore e verificat in `getRnpmDb` (acopera toate operatiile, nu doar search);
- `requireDesktopHeader` RAMANE pe toate rutele (CSRF desktop; pass-through pe web);
  self-service = `requireRole("admin", "user")` in loc de admin-only;
- URI-ul ATTACH e percent-encodat (path-ul real contine spatii).

**Task 0 (fixuri CodeRabbit) LIVRAT in d4ff132:** pricing `openai/gpt-5.4` output 10 -> 15,
fallback `Necunoscut (token)` in cele 4 helpere de etichete + teste, `recordAuditSafe` pe caile
de refuz din `routes/admin.ts`. RESPINS cu dovada: mutarea `PERIOD_RO` in lib (single-use).

**Reguli sprint (stricte):**
- Branch-ul e STACKED pe `feat/v2.42.0-users-settings`, care e INGHETAT (MR-ul lui spre main
  asteapta aprobare in GitLab) — NU comite nimic acolo si nimic pe `main`. Merge-ul v2.42 se
  face fara squash, deci v2.43 nu va avea nevoie de rebase.
- `main` a primit intre timp merge-uri GitLab (fixuri oauth2-proxy) — nu le atinge; la un
  `git checkout main` fisierele sprintului dispar din working tree (sunt pe branch), nu e pierdere.
- Gate-uri la FIECARE commit: biome doar pe fisierele atinse (re-stage), tsc backend + frontend,
  `npm run build`, suita de teste; `git add` DOAR pe fisiere enumerate (niciodata -A pe directoare).
- TDD strict (testul pica INAINTE de implementare); nu slabi asertii; push DOAR la cererea userului.
- `PROMPT-GPT56-SOL-rnpm-split.md` (radacina, untracked) = promptul de REVIEW pentru GPT-5.6 Sol;
  a fost deja consumat pe Rev. 2 (findings aplicate) — refoloseste-l doar daca userul cere alt review.
- Dupa teste Node care ating better-sqlite3: `npm run rebuild:electron` inainte de smoke Electron.

## Sprint v2.42.0 — INCHIS; MR spre main IN ASTEPTARE (branch `feat/v2.42.0-users-settings`)

Reimplementare delta v2.40.1 -> v2.42.0 dupa `GHID-IMPLEMENTARE-GITLAB-v2.41-v2.42.md`.
Reguli: doar branch-uri (nimic pe main), branch-uri minime, gate-uri 0.3 inainte de
fiecare commit, smoke pe mediul local (2.x). NOTA: pe modelul Fable filtrele de
siguranta intrerup des sesiunea pe subiecte de auth/tastatura — continua pe Opus.

**LIVRAT + push (commit-uri pe branch):**
- MR 5 (3e71a6e): migration 0040 email unic NOCASE + canonicalizeEmail + POST
  /users + import xlsx (template + parse server-side) + guard last-admin activ-only + UI Users.
- MR 6 (ed8661c): pagina /setari pe taburi + prop embedded pe cele 6 pagini admin
  + useCurrentUser rescris ca store partajat (useSyncExternalStore).
- MR 7 (1640731): migrations 0041 (pool "ai" consolidat) + 0042 (backfill UTC) +
  quotaGuard pe pool unic + grants exclusiv (422 unlimited_budget) + POST /grants/:id/revoke
  + /me/budget pe "ai".
- MR 8 (e42e91b): GET /usage/overview (AI + captcha, aceleasi functii ca guard-ul)
  + useClientSort + SortableTh + tab Consum cu paginare client-side.
- MR 9 (a0ef7af): audit enrichment email + listAuditEventsForExport (413 peste 10000)
  + services/auditExport.ts (safeCell inclusiv ip) + GET /audit/export + Audit.tsx pe
  pattern 6.7 (debounce+flush, AbortController, reset inline, refreshTick).
- MR 10 (a59d41f): Sonnet 5 (modelId claude-sonnet-5, slug anthropic/claude-sonnet-5,
  pricing standard $3/$15) + AiPrompt {system,user} + prompturi verbatim 10.3 +
  helper comun dosar_data (30 sedinte, campuri ICCJ, caiAtac) + validateAiBody caiAtac.
- MR 11 (2646048): 6.1 chunk-reload in main.tsx; 6.2 confirmari (stergere cheie,
  revoke-all, inchidere alerta); 6.5 monitoringRunStatus + userLabels sursa unica +
  Keys in romana + Refresh->Reincarca; 6.6 dark mode; 6.10 autoLoading pe captcha-block.

- MR 12 (5e5c275 + 99fca23 + a101e03): toast.tsx (ToastProvider + useToast, cap 4,
  timere curatate) + fix CRITIC useDialog (onClose in ref, efect pe `[open]`) +
  AlertsExportModal/ReportExportModal pe useDialog + bulk-dismiss Alerts pe useConfirm
  cu toast pe dismissedCount REAL (0 = info) + toast-uri pe mutatii (Keys, Users,
  Quota, Grants, ApiAccessPanel, exporturi PDF Changelog+Manual cu toast EROARE) +
  SortableTh/useClientSort in Users/Audit/Monitorizare pe etichete umane + teste
  (toast timere, useDialog focus, Keys+ApiAccessPanel cu ToastProvider in render).

**Post-MR 12 (2026-07-07, testare reala cu userul):** aliniere design la repo-ul de
referinta (paritate cu `feat/v2.42.0-users-settings` din repo-ul original, cu 4 extras
pastrate: revocare grant din vederea globala, coloane Limita efectiva/Sursa in Consum,
pre-populare la Editeaza in Cote, panou chei tenant cu badge-uri) + fixuri din feedback:
popover istoric pe sidebar colapsat (fixed vs clipping), Cache-Control explicit pe static
(no-cache HTML / immutable assets — inchide "vad varianta veche" dupa rebuild), select-uri
custom tematizate (dark mode), reactivare conturi sterse la re-adaugare (create + import),
reset formular cota la schimbare feature, badge PJ lizibil si absent pe RNPM, titluri
alerta fara ghilimele, JobKindTabs h-9, NotificationStatusPanel doar pe desktop.

**BUMP v2.42.0 FACUT** (package.json x3 + lockfile, changelog-entries.tsx, CHANGELOG,
README, STATUS, DOCUMENTATIE, SECURITY entry, CLAUDE.md header, card Versiune Aplicatie
din Dashboard) + sectiune v2.41.0 in CHANGELOG si changelog-ul in-app (branch-ul
`feat/v2.41.0-web-ux` cu MR 0-4 e baza integrala a v2.42; fara artefact propriu).
Smoke local FACUT (health, gate auth 401, cache-control, bundle 2.42.0, proxies).

**Post-bump (2026-07-07, sesiunea 2):**
- Card Dashboard "Surse de date & API" (PortalJust + ICCJ + RNPM + API propriu).
- Claim-uri CodeRabbit verificate: aiUsageRepository aliasuri (RESPINS cu dovezi —
  niciun writer nu scrie feature='ai' in ai_usage; nu adauga aliasul defensiv, ar
  masca bug-uri viitoare); catch-all reactivare (CONFIRMAT, reparat — catch ingustat
  pe "user not deleted", audit + 201 scoase din try); clientRequestId pe mutatiile
  admin (AMANAT — singura ne-idempotenta e POST /grants, low-stakes).
- **Audit frontend bugs v2.41+v2.42** (4 agenti paraleli, toata delta): 1 mediu +
  4 low, TOATE reparate in ba43867: Users abort+reset inline (pattern 6.7);
  alert-context strip «» doar pe segmentul "pentru «NUME»"; useTenantKeyStatus
  STORE PARTAJAT la nivel de modul (model useCurrentUser, __resetTenantKeyStatusStoreForTests
  in 3 fisiere de test + test dedup nou); Sidebar popover inchis la scroll/resize;
  Keys dirty flag pe toggle captcha (CapSolver nu mai e revertit de refresh).
- Alte fixuri din testare: reactivare conturi sterse la re-adaugare (create+import,
  tranzactional), Cache-Control pe static (no-cache HTML / immutable assets),
  select-uri custom peste tot (dark mode), titluri alerta fara ghilimele la numele
  monitorizat, badge PJ/ICCJ lizibile + PJ absent pe RNPM, JobKindTabs h-9,
  NotificationStatusPanel doar desktop, popover istoric functional pe sidebar colapsat.
- Stare gate-uri la ba43867: biome curat, tsc backend+frontend verzi, build ok,
  327 teste frontend + 1665 backend.

**Review backend FACUT (2026-07-07, sesiunea 3):** 5 agenti paraleli pe delta
main...HEAD (deep review, fiabilitate, teste, release readiness, conformitate
CLAUDE.md) — zero CRITICAL. Planul de fixes a trecut prin review-panel adversarial
(5 modele + sinteza) inainte de executie, apoi a fost executat integral
subagent-driven (implementer + task reviewer pe task-urile grele, review final
whole-branch pe tot diff-ul, CONFIRMED ready-to-merge). Plan complet:
`docs/superpowers/plans/2026-07-07-fixes-review-backend-v2.42.md`.

**LIVRAT (17 commit-uri, 7a0ea6d..ffea12d):** recordAuditSafe pe site-urile
post-mutatie; invariant last-admin atomic in repository (role + status, orice
admin); buildPrompt inainte de rezervarea de cota in analyze-multi; refetch la
409 pe cursa de reactivare; getActorId pe quota/grants; log parse-fail xlsx;
stergere insertUsersBulk (mort); USAGE_OVERVIEW_CAP 500; export audit cu toate
filtrele paginii; teste P0+P1 noi (cost-aware reservation, rollback bulk, down
migrations 0040/0042, budget-warnings cu izolare owner, celule xlsx, caiAtac);
RUNBOOK pre-flight 0040 + rollback prin backup + note upgrade cota; feature nou:
cota AI alocata + consum in panoul AI Usage (QuotaCard doar in web mode,
/me/budget aliniat la regula guard-ului: default env web-only + rolling window
pe pool-ul "ai" + limitSource).

**Stare gate-uri la ffea12d:** npm run check verde (biome + typecheck + 1691
backend + 333 frontend + electron), npm run build curat.

**Backlog triat de review-ul final (nu blocheaza):** fixture ExcelJS via
cell.model fragil la upgrade major; testul rolling-window pierde discriminarea
in fereastra 23:00-24:00 (nu da fals-negativ); re-check ieftin de buget inainte
de faza judge in analyze-multi (candidat HARDENING.md); agregare set-based pe
usage/overview la scara.

**SPRINT INCHIS (2026-07-07):** userul a incheiat lucrul la proiect. Livrari
finale post-review: fix parser ECB (curs USD/EUR functional), cota AI vizibila
in panoul AI Usage (single-row + EUR), batch CodeRabbit (7 fixuri confirmate,
inclusiv retry-ul de email de warning reparat — quotaFeatureOf accepta "ai"),
totaluri consum per user + total general in tab-ul Consum (mini-celule, copy
integral romana, text-foreground), smoke functional pe tokenurile API (emitere/
folosire/scope/revocare OK; `LEGAL_DASHBOARD_PAT_ALLOW_HTTP=1` adaugat in
dev-web-local.ps1 — folosirea PAT era blocata local de cerinta HTTPS).
Decizie merge: MR UNIC `feat/v2.42.0-users-settings` -> `main` (branch-ul
contine integral baseline-audit si v2.41.0-web-ux — lant liniar, verificat cu
merge-base); dupa merge, branch-urile vechi se pot sterge; fara squash.
Pre-flight-ul 0040 nu se aplica (nu exista date reale pre-v2.42).

## BATCH HARDENING 2026-07-09/10 — INCHIS (commit unic + push 2026-07-10)

**STARE FINALA:** batch-ul e LIVRAT — commit unic pe
`feat/v2.42.0-users-settings` + push (2026-07-10), dupa testul live al
userului pe mediul web local (testul a confirmat si a scos 2 probleme reale,
ambele tratate — vezi mai jos). Mediul local dev-web a fost OPRIT dupa push;
repornire: `& scripts/dev-web-local.ps1 -SkipBuild` din pwsh 7, NU powershell
5.1 (parseaza gresit UTF-8). Sprintul e INCHIS; urmeaza merge-ul MR-ului
`feat/v2.42.0-users-settings` -> `main` (decizie existenta: MR unic, fara
squash), apoi follow-up-urile din plan pe branch-uri separate.

**Plan executat (sursa unica, cu triaj audit + follow-up):**
`docs/superpowers/plans/2026-07-09-fixes-v2.42.1-2-gitlab.md`. Continut batch:
fixurile v2.42.1->v2.42.2 din review-ul GitHub in forma FINALA (Bug 1a plasa
globala bodyLimit 1MB pe /api/* cu exceptii exact-match + plafon exterior 25MB;
Bug 2 preAuth release in try/finally cu flag local `completed`; Bug 3 weight 3x
analyze-multi pe ambele mount-uri + per-token; Bug 4 plafon pe fereastra
proaspata; Bug 5 /health/detail 403 in web mode; Bug 6 ownerId obligatoriu in
aviz/searchRepository; Bug 7 scheduler guard finalize() + durationMs real;
Bug 8-10 electron: IS_DEV din app.isPackaged, IPC sender validation, boot nonce
in /health doar non-web, shutdown 40s) + F06 catch pe writeSSE rnpm (anti
proces-kill web) + fix mailto import useri (mailto castiga DOAR cand textul
afisat nu contine @; decodare RFC 6068) + migrare modele OpenAI GPT-5.4 ->
GPT-5.6 Sol/Terra/Luna (pricing preview verificat: 5/30, 2.5/15, 1/6 per 1M;
5.4 ramane in pricing pentru retry-uri) + changelog v2.42.0 extins (in-app +
CHANGELOG.md, FARA bump de versiune — decizia userului) + quota: estimari
realiste de rezervare AI in quotaGuard (single $0.25 / multi $0.50, fost
$2/$8 — decizia userului 2026-07-10 la testul live: politica ~$5/user facea
multi-model inutilizabil; TDD, costuri reale ~$0.27/run multi, suita 1719
verde; env LEGAL_DASHBOARD_QUOTA_ESTIMATE_MULTIPLIER ramane knob peste noile
valori).

**Verificari FACUTE:** TDD per fix (red inainte de implementare); gate complet
verde la commit (npm run check: biome + tsc backend+frontend + 1719 backend +
340 frontend + 2 scripts; npm run build curat); smoke pe aplicatia REALA pe
localhost (login proxy 200, tokens 201, >1MB=413 PAYLOAD_TOO_LARGE, export
1.5MB=400 nu 413, /health/detail 403, /health fara bootNonce); AUDIT ADVERS
review-panel (Opus 4.8 + GPT-5.6 Sol + Kimi K2.7 + GLM-5.2, sinteza Fable):
4 findings reparate PE LOC (plafon 25MB, flag completed, gate web bootNonce,
decodare mailto), 5 pe follow-up in plan (top: OPS verifica
`LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` pe Dokploy!), 6 respinse cu dovezi
(detalii in plan + raportul HTML).

**Iesite din testul live al userului (2026-07-10), pe follow-up (notate si in
memoria agentului):**
- Restore-ul din zona RNPM e de fapt WHOLE-DB (nu exista restore per-modul sau
  per-user/owner_id) — userul a facut restore crezand ca e doar RNPM si a
  pierdut scrierile post-boot (inclusiv fx_rates proaspat). Follow-up: RUNBOOK
  sectiune "recuperare selectiva per user din backup" + copy explicit pe
  modalul de restore (+ eventual mutat din zona RNPM in Setari).
- Mesajul 429 QUOTA_EXCEEDED e generic desi `details` are toate cifrele —
  follow-up UX: afiseaza "estimarea ($X) depaseste limita ($Y)" + nota in Cote
  despre pragul minim pentru multi. (Cauza radacina — estimarile worst-case
  $2/$8 — a fost REZOLVATA in batch: single $0.25 / multi $0.50.)

**Artefacte sesiune:** raportul final pentru user
`Legal-Dashboard-v2.42.0-Fixuri-Post-Review.html` (radacina, untracked, NU se
comite); scriptul de smoke reutilizabil in scratchpad-ul sesiunii vechi
(`smoke-web-local.mjs` — login prin proxy, API direct pe 3002, cookie doar in
memorie; clientii Node strica raspunsurile timpurii 413 prin mini-proxy-ul dev,
de aceea API-ul se testeaza direct pe backend).

**Paritate GitHub (dupa push):** fixurile NOI din acest batch care nu exista pe
GitHub (F06 catch SSE, mailto import, GPT-5.6, cele 4 intariri de audit, quota
estimates $0.25/$0.50) se aplica si acolo la urmatorul sync — doar surse, nu
infra.

## Kill switches operationale

| Variabila / mecanism | Effect cand activat | Cand folosesti |
|----------------------|---------------------|----------------|
| `SMTP_HOST/PORT/USER/PASS/FROM` lipsesc sau invalide | `isMailerConfigured()` ramane `false`; dispatcher-ul scurt-circuiteaza inainte de SELECT, panoul UI arata "SMTP off" | Default desktop / mod degraded controlat |
| `SMTP_SECURE=true\|false` | Forteaza TLS implicit/explicit; default = `port === 465` | Cand provider-ul SMTP cere STARTTLS pe 587 (`SMTP_SECURE=false`) sau implicit TLS pe 465 |
| `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` | Scheduler-ul nu mai claim-uieste tipurile listate; joburile raman in DB, alertele existente raman accesibile | Stop temporar pe sursa upstream cu probleme (PortalJust SOAP rate-limit) |
| `OPENROUTER_DISABLED=1` | `callOpenRouter` esueaza imediat si nu face fallback silent la native | Stop urgent daca OpenRouter are incident, billing risc sau policy drift |
| `OPENROUTER_MODEL_OVERRIDES=modelKey:provider/slug` | Suprascrie slug-uri OpenRouter fara rebuild backend | Cand OpenRouter redenumeste un model sau muta un provider |
| `RNPM_AUDIT_CAP_HIT_DISABLED=1` | `POST /api/v1/rnpm/search-split` sare INSERT-ul `rnpm.cap_hit` din `audit_log`; restul flow-ului (SSE, decision, captchasUsed) ruleaza neschimbat | Stop urgent daca tabela audit creste suspect sau introduce contention vizibil pe write |
| `RNPM_RUNTIME_VALIDATION_DISABLED=1` | Opt-out temporar pentru validarea runtime RNPM fail-closed; payload-urile invalide sunt acceptate doar cat timp flag-ul este setat | Foloseste doar ca rollback operational daca upstream-ul RNPM schimba schema in productie |
| `LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_DISABLED=1` | Dezactiveaza semantic autocompact-ul dupa stergeri; raspunsurile raman fara campul `compacted` | Stop temporar daca VACUUM introduce latenta sau presiune pe disc |
| `LEGAL_DASHBOARD_RNPM_AUTOCOMPACT_MIN_FREE_MB=10` | Regleaza pragul absolut de freelist pentru autocompact; accepta valori fractionare finite >=0 | Tuning operational; default 10 MB, aplicat impreuna cu pragul de 20% din fisier |
| `LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB=750` | Limita implicita per user pentru baza RNPM vie; `0` sau negativ = nelimitat | Admission control pe cautari; override-ul `rnpm.storage` per user are prioritate |
| `LEGAL_DASHBOARD_RNPM_BACKUP_CAP_MB=500` | Plafon best-effort per jail de backup RNPM; `0` sau negativ = nelimitat | Anti-acumulare; podeaua de siguranta a pool-urilor poate tine jail-ul peste plafon |
| `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` | Permite folosirea `X-Forwarded-For` doar cand peer-ul intra in CIDR-ul proxy-ului de incredere | Setat in deploy prin Docker network CIDR; lasa gol pe desktop |
| `LEGAL_DASHBOARD_FORCE_BOOT=1` | Permite reclaim fortat al instance lock-ului SQLite cand operatorul confirma manual ca procesul vechi nu mai ruleaza | Break-glass dupa crash/stale lock, cu audit `system.instance_lock.reclaim` |
| `RNPM_RESULTS_FILTER_DISABLED=1` | Ruta POST `/api/rnpm/search/:searchId/filter` raspunde 503 cu `code: "FILTER_DISABLED"`; UI ascunde inputul si arata banner | Stop urgent daca filtrul provoaca contention DB sau bug regresat |
| `LEGAL_DASHBOARD_ALLOW_REMOTE=1` (+ `LEGAL_DASHBOARD_AUTH_MODE=web` + JWT valid) | Backend-ul accepta bind non-loopback | Setup web/server, niciodata desktop |
| `TENANT_KEY_ENCRYPTION_SECRET` | Master key AES-256-GCM pentru `tenant_api_keys`; lipsa in web mode opreste boot-ul | Obligatoriu pentru web admin keys; pastreaza separat de backup-ul DB |
| Cooldown POST `/email-settings/test` (60s/owner) | Ruta returneaza 429 cu `Retry-After`; audit `me.email_settings.test outcome=denied reason=cooldown` | Limita built-in vs user click loop pe butonul "Trimite test" |
| `drainEmailDispatches(timeoutMs)` | Asteapta SMTP-urile in flight inainte sa inchida DB-ul; default 10s, shutdown 5s | Gracefull shutdown — invocat automat din `gracefulShutdown()` |
| `DAILY_REPORT_HOUR=9` | Schimba ora locala la care ruleaza scheduler-ul de raport zilnic | Cand 09:00 default e nepotrivit (ex. dev local sau alt fus orar operator) |

## Reguli active pentru urmatorul agent

- Executa doar planul agreat. Daca vezi o problema care cere schimbare
  fundamentala, anunta si asteapta aprobare.
- Nu scoate flow-uri existente care functioneaza.
- Electron smoke inseamna aplicatia desktop Electron, nu doar web localhost.
- La lansare Electron:
  - curata `ELECTRON_RUN_AS_NODE`;
  - evita terminal vizibil daca userul nu cere explicit;
  - prefera `Start-Process ... -WindowStyle Hidden`.
- Daca rulezi teste Node si atingi `better-sqlite3`:
  - pentru Vitest poate fi necesar `npm rebuild better-sqlite3`;
  - dupa teste ruleaza obligatoriu `npm run rebuild:electron`.
- SQLite nu permite modificarea unui CHECK existent via `ALTER TABLE`; pentru
  CHECK-uri trebuie rebuild de tabel sau drop complet de CHECK.
- Nu lasa procese Electron/backend pornite inutil daca nu sunt necesare.
- Pentru web mode v2.30.0, cheile AI/captcha sunt ale tenantului si stau in
  `tenant_api_keys`; non-adminii nu trebuie sa poata trimite BYOK in body.
- **Promovarea la admin pe desktop ramane manuala**:
  `UPDATE users SET role='admin' WHERE id='local';` direct in SQLite. Workflow
  tehnic acceptat pentru desktop solo; cutover-ul web (daca se reia) ar expune
  un mecanism legat de Google Workspace SSO.

## Probleme/riscuri ramase

- **De rezolvat in v2.42.0 (audit v2.41.0 vs ghid)**: `GET /api/v1/ai/settings`
  (si `PUT`-ul pereche) raspund cu forma legacy `{ mode }` in loc de envelope-ul
  standard `{ data, error, requestId }` (invariant 0.2 din ghid). Mostenire de
  pe main, nu regresie v2.41; fix-ul cere schimbare coordonata backend
  (`ok()` in `routes/ai.ts`) + frontend (`useAiSettings` citeste `data.mode`).
- `useCurrentUser` se apeleaza din mai multe locuri (Sidebar + AdminGate per
  pagina admin). Pe desktop call-ul este local si rapid; daca devine vizibil in
  load tests pe web mode, va fi lift-ed in context shared (sau cache-uit).
- Pe desktop quota este informativa/bypass. Enforce real ramane pentru web
  cutover viitor (daca se reia).
- PR-9 livreaza seam-ul de auth (desktop noop / web JWT validation, livrat in
  v2.7.0). Cutover-ul real web — Google Workspace SSO/OIDC, deploy server, TLS,
  backup S3-compatible — este reevaluabil separat (PR-10 GCS si PR-12 GDPR
  delete + hash-chain audit eliminate prin decizia #11 din
  `EXECUTION-ROADMAP.md`, 2026-05-03).
- Email canal SMTP (PR-11, v2.10.0) ramane optional; dispatcher scurt-circuiteaza
  cand `SMTP_*` lipsesc. Daily report email livrat in v2.13.0 + boot-time SMTP
  partial-config probe in v2.17.0 (warn la lipsa partiala in loc de silent
  runtime fail).
- `xlsx@0.18.5` nu mai este pe path-ul de parsare a inputului user (in v2.6.4
  `nameListParser.ts` a fost migrat la `exceljs@^4.4.0`). Codul SheetJS 0.18.5
  ramane transitiv prin `xlsx-js-style`, care e folosit atat la export cat si la
  parsarea de preview a importului bulk Monitorizare (`parseBulkFile`,
  `XLSX.read`) — deci nu e write-only; mitigat de cap pe dimensiunea fisierului +
  validare interna, iar parsarea autoritativa a importului ramane pe `exceljs`.
  Pachetul `xlsx` standalone ramane doar in fixturile de test.

## Sprint inchis 2026-05-20 - v2.34.0 web hardening

**Status**: livrat pe branch `feat/v2.34.0-web-hardening`.

**Scope**: inchide 4 P0 + 8 P1 din `audit/AUDIT-FINAL-FULL-PROJECT-v2.33.0-2026-05-19.md`. P0 acopera auth surface (Google OAuth2 device-code POST-only + RL `(ip, ua)`, admin guards intarite pe tenant-keys, blocare self-grant edits). P1 acopera SOAP retry budget, captcha balance per-tenant TTL, owner-scoped tenant key guard, body-key warning hardening, per-user captcha quota count-based cu rolling 24h/7d/30d si intent-recording, CI fixtures via `openssl rand`, offsite backup hook env-configurabil cu RUNBOOK.md (12 sectiuni).

**Solutie**: tot codul nou este gateuit pe `getAuthMode() === "web"` sau pe rute web-only (admin endpoints). Cota captcha este atomic-in-tranzactie cu pattern "record-at-guard-accept" (overcount-never-undercount). Offsite backup hook este fail-open (local backup ramane chiar la hook failure); structured JSON `offsite_backup` / `offsite_backup_failed`. Sentry SDK explicit amanat la v2.35.0 — workaround documentat in RUNBOOK §12 (stdout structured JSON grep-friendly cu Loki/Promtail/fluent-bit).

**Invariante pastrate**: desktop ZERO impact, BYOK desktop unchanged, `rejectApiKeysFromBodyInWebMode` activ, web-mode 501 gate pe `rejectCaptchaKeyInWebMode`, `TENANT_KEY_ENCRYPTION_SECRET` strict 32 bytes base64, raw SQL nou doar in `backend/src/db/**`.

**Test coverage**: 1334 pass / 5 skipped backend (4 noi POSIX-only pentru offsite hook + 1 pre-existent). Biome pass, tsc backend + frontend pass, build pass.

## Sprint inchis 2026-05-19 - v2.33.0 security hardening

**Status**: livrat pe branch `feat/v2.33.0-security-hardening`.

**Scope**: inchide CRITICAL-1 + 5 HIGH + 11 MEDIUM + 3 LOW din planurile `audit/FIX-PLAN-CLUSTER-*.md`, cu overlay obligatoriu din `audit/FIX-PLAN-v2.33.0-REMEDIATION.md`.

**Solutie**: quota/budget foloseste rezervari atomice in web mode dupa provider resolution si include pending spend in fereastra rolling; deployment-ul primeste instance lock atomic, proxy trust explicit si digest pinning; SOAP/RNPM/FX/key validation devin fail-closed unde planul cere; audit trail-ul elimina plaintext din SMTP errors, key events si logout attribution edge cases.

**Invariante pastrate**: desktop ZERO impact, `rejectApiKeysFromBodyInWebMode` activ, web-mode 501 gate pe `rejectCaptchaKeyInWebMode`, `TENANT_KEY_ENCRYPTION_SECRET` strict 32 bytes base64, LAN bind doar cu `LEGAL_DASHBOARD_ALLOW_REMOTE=1`, raw SQL nou doar in `backend/src/db/**`.

## Sprint inchis 2026-05-19 - v2.30.0 web admin keys + per-user budget

**Status**: livrat pe branch `feat/web-admin-keys-budget`.

**Solutie**: web mode muta cheile AI si captcha in `tenant_api_keys`, criptate AES-256-GCM cu `TENANT_KEY_ENCRYPTION_SECRET`. Adminul foloseste `/admin/keys`; non-adminii nu mai vad dialogul BYOK in web mode. AI foloseste fallback-ul `env > tenant DB > BYOK desktop`, iar RNPM captcha ia provider/mode/cheie din tenant DB in web mode.

**Budget**: `quotaGuard` aplica limitele zilnice per user pentru AI single si multi, cu `QUOTA_EXCEEDED` 429 si `Retry-After`. `/me/budget` si `BudgetIndicator` expun consumul curent cand exista limita.

**Teste cheie**: crypto, repository tenant keys, admin routes, me key-status/budget, quota guard, OpenRouter tenant DB, RNPM captcha web flow, ApiKeyDialog guard, AdminKeys page si BudgetIndicator.

## Sprint inchis 2026-05-18 - v2.29.0 monitoring noise & storage

**Status**: livrat pe branch `feat/monitoring-noise-storage`.

**Solutie**: `monitoring_snapshots` este curatat incremental prin `deletePriorSnapshots()` in aceeasi tranzactie cu insertul nou pentru `name_soap` si `dosar_soap`. Snapshot cap-ul este 3 MiB, cu titlu oversize parametrizat. Filtrarea pe nume foloseste set equality, deci un party superset nu mai trece pentru target mai scurt. `name_soap` snapshot include `latest_sedinta_at`, iar `diffNameSoap` primeste `jobCreatedAt` ca sa suprime `dosar_new` istoric fara activitate dupa adaugarea la monitorizare.

**Observability**: retention emite log JSON `monitoring.snapshot_retention` cand sterge randuri. Suppressia istorica face fail-open si logheaza `console.error("[diffNameSoap.isHistoricNoise] invalid date input", ...)` pentru date invalide.

**Teste cheie**: rollback tranzactie DELETE+INSERT, 3 tick-uri = 1 snapshot/job, oversize peste 3 MiB vs 2 MiB valid, `parte.nume` null/undefined, set equality si suppressie istorica cu date invalide.

## Sprint inchis 2026-05-14 - Notite editabile per job + propagare in alerte

**Status**: livrat pe branch `feat/monitoring-notes-edit`.

**Solutie**: `monitoring_jobs.notes` ramane coloana existenta, fara migration
noua. Backend-ul limiteaza write-urile la 200 caractere prin Zod, `listAlerts`
propaga `j.notes AS job_notes`, iar frontend-ul ofera `NoteEditor` inline in
Monitorizare si bloc `Notita: ...` in Alerte.

**UX validat**: notitele lungi fac wrap in coloana tintei si nu intra sub
butonul `Dosare`; randurile fara nota afiseaza `+ Adauga notita`.

**Teste cheie**: limita Zod notes, join `job_notes`, `NoteEditor` si
`AlertNoteBlock`.

## Sprint inchis 2026-05-13 - PR-6 Envelope Migration

**Status**: Task 1-8 complet pe branch `feat/pr6-envelope-migration`.
Executia este oprita intentionat dupa release bump v2.26.0, inainte de Task 9
smoke desktop, push si tag.

**Solutie**: rutele HTTP legacy din `rnpm.ts`, `ai.ts` si `termene.ts` emit
envelope standard pentru 4xx/5xx. `INSUFFICIENT_FUNDS` foloseste 402 +
`Retry-After: 0`, detectat tipizat prin `CaptchaInsufficientFundsError`;
`LIMIT_EXCEEDED` pastreaza `details` pentru split-search; `FILTER_DISABLED` si
`FILTER_TIMEOUT` se citesc din `body.error.code`.

**Frontend**: `frontend/src/lib/api.ts` are `extractErrorMessage` dual-shape,
folosit pe exporturi XLSX/PDF, load-more SSE si AI multi-model ca mesajele
reale sa nu cada pe fallback generic.

**Scope exclus intentionat**: path-ul RNPM 499 abort cu `searchId`,
payload-urile SSE, raspunsurile OK 200/201 si `recordAudit()` raman nemigrate.
Pagination ramane shape-only, fara `INVALID_PAGE` nou unde exista coercitie
silentioasa.

## Sprint inchis 2026-05-13 - Filtru RNPM multi-token + highlight

**Status**: livrat pe branch `feat/rnpm-filter-multitoken-highlight`, peste
branch-ul `feat/rnpm-results-filter` fast-forwarded in `main`.

**Solutie**: filtrul text RNPM tokenizes query-ul in backend si frontend,
deduplica termenii case-insensitive/diacritics-insensitive si limiteaza
evaluarea la `FILTER_TOKEN_MAX_COUNT = 8`. Backend-ul construieste o grupa OR
de 24 LIKE-uri pentru fiecare token si combina grupele cu AND, pastrand owner
isolation, `search_id`, `buildRnpmLikePattern()` si indexul
`idx_rnpm_avize_owner_search`. Frontend-ul foloseste aceiasi tokeni pentru
highlight in randul colapsat si in tab-urile Creditori/Debitori/Bunuri/Istoric.

**UX**: cand avizul match-uieste doar in detaliile expandate, tabelul afiseaza
badge-ul `match in detalii` sub Identificator. Highlight-ul galben pastreaza
textul original si face potrivire diacritics-insensitive.

## Sprint inchis anterior 2026-05-13 - Filtru text rezultate RNPM

**Status**: livrat integral pe branch `feat/rnpm-results-filter`. 9 commit-uri TDD planificate pentru implementare + release, cu biome, tsc si 51 teste noi pe zonele schimbate.

**Trigger**: search RNPM cu zeci-sute de avize facea inutil scroll-ul fara filtru text peste rezultatele deja gasite. Planul/spec-ul au fost realiniate la schema curenta inainte de Task 2: `rnpm_bunuri` nu are `descriere_proprie`, iar textul descrierii vine exclusiv prin `descriere_id -> rnpm_bunuri_descrieri.text`.

**Solutie**: endpoint nou `POST /api/rnpm/search/:searchId/filter` cu helper repository dedicat, fara refactor pe `getAvize()`. Helper-ul cauta in 24 campuri normalizate pe `rnpm_norm()`: 9 din `rnpm_avize`, 3 creditori, 3 debitori si 9 bunuri, inclusiv `rnpm_bunuri_descrieri.text` via JOIN. UI-ul filtreaza local pe `Set<avizId>` si pastreaza exportul/paginarea aliniate cu randurile vizibile. Spec full: [`docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md`](docs/superpowers/specs/2026-05-13-rnpm-results-text-filter-design.md).

**Decizii arhitecturale cheie**:
- POST, nu GET - evita leak `q` in Hono `logger()` URL.
- Anti-enumeration 404 pentru `searchId` neexistent sau apartinand altui owner.
- `AbortSignal.any([req.signal, AbortSignal.timeout(5000)])` - cancel client + timeout intern.
- Truncare la 1500 ID-uri cu `truncated: boolean`.
- `missingDetails` counter transparent - UI banner non-blocant pentru avize fara detalii.
- Helper privat `buildResultsFilterClause` - nu este partajat cu `getAvize().searchText`, pentru zero-regresie pe `/api/rnpm/saved?q=`.

## Sprint inchis 2026-05-13 — Migrare exporturi server-side streaming

**Status**: livrat integral. 4 commits secventiale, fiecare cu smoke + biome + tsc verzi.

**Trigger**: RNPM export pe 148 avizi a hang-uit Electron main process la 4GB peak (Codex telemetry 2026-05-12: PID 3960 1.6GB → 4.06GB → AppHangTransient → kill toate procesele; `/health` timeout = main process blocat). Cauza: `xlsx-js-style` build in-memory + backend in-process in Electron main = same V8 isolate ca UI thread.

**Solutie**: rewrite la `exceljs.stream.xlsx.WorkbookWriter` (row-by-row pe disk temp) si `pdfkit` streaming pentru toate exporturile data-driven. Renderer cere blob, backend stream-uieste fisierul temp + `unlink` in `close` event.

| Faza | Scope | Commit | Status |
|---|---|---|---|
| 1 | RNPM XLSX server-side (avize/parti/bunuri/istoric, hyperlinks cross-sheet workaround) | `3b69e4c` | Done |
| 2 | RNPM PDF server-side (A4 landscape, index + 1 pagina/aviz, max 50 pagini la long fields) | `f9d11ec` | Done |
| 3a | PortalJust dosare + termene XLSX+PDF | `d600959` | Done |
| 3b | Alerte XLSX+PDF (refactor `collectAlertExportRows` + `streamExportResult`, `export-alerts.ts` sters) | `9ece8ca` | Done |

**NU migrate** (scale fix mic, safe pe client): `export-analysis.ts`, `export-manual.ts`,
`export-report.ts` raman in `export.worker.ts`; `changelog-pdf.ts` si
`monitoringBulkTemplate.ts` sunt importate direct in `pages/Changelog.tsx` respectiv
`MonitoringBulkImportCard.tsx`, fara worker (build sincron pe demand de user).

**Regula generala stabilita**: server-side stream DACA scale-ul depinde de count user. Client-side OK doar pentru scale fix cunoscut.

**Caveats tehnice consumate**:
- `WorkbookWriter` NU permite revenire la sheet anterior dupa `.commit()` → row offsets cross-sheet pre-calculate.
- ExcelJS hyperlinks cross-sheet au bug pe writer-ul streaming → workaround via HYPERLINK formula (`{ formula: \`HYPERLINK("#'Sheet'!A1","label")\`, result: "label" }`).
- pdfkit Helvetica.afm trebuie copiata in `dist-backend/data/` la build → fix in `scripts/build.js`.
- Stilizare ExcelJS per-celula: `cell.font` / `cell.fill` / `cell.alignment` / `cell.border` (API direct).

## Urmatoarea etapa (background, fara timeline)

Sprintul de monitorizare + email este incheiat. Roadmap-ul oficial
(`EXECUTION-ROADMAP.md`) nu mai are PR-uri planificate dupa v2.10.1 — PR-10
(Litestream/GCS) si PR-12 (GDPR delete + hash-chain audit) au fost eliminate
prin decizia #11 (cost-benefit negativ pentru solo dev fara firma; compliance
theatre pentru uz personal).

Directii deschise (toate optionale, fara timeline):

### A. Web cutover viitor (reevaluabil separat)

- Google Workspace SSO real peste seam-ul PR-9 (desktop noop / web JWT
  validation deja livrat in v2.7.0).
- Deploy server: Docker image, reverse proxy, TLS.
- Backup S3-compatible (Cloudflare R2 / Backblaze B2 ca alternativa la GCS
  eliminat).
- Captcha provider keys (2Captcha / CapSolver) muta-le in `.env` server-side
  in web mode; desktop pastreaza Electron `safeStorage`.

### B. Continuare ad-hoc

- Bug fixes / UX polish pe fluxurile existente (Monitorizare, Alerte,
  Dashboard, Admin) pe baza feedback-ului direct din uz real.
