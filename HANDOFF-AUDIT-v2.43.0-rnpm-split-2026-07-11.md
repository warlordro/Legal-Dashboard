# HANDOFF — Audit comprehensiv v2.43.0 (RNPM split per-user)

**Data:** 2026-07-11
**Branch:** `feat/v2.43.0-rnpm-split` · **HEAD:** `a9630b9` · **Base (merge-base main):** `6f326e4`
**Scop sesiune:** audit read-only (securitate, reliability, concurenta, accesibilitate, consistenta UI) conform promptului extins al userului. Niciun fisier de cod modificat. Deliverables cerute care RAMAN de produs: raport tehnic .md consolidat + raport HTML non-tehnic (focus web deploy), cu nume usor de identificat.

---

## 0. Stare curenta (unde ne-am oprit)

| Pas | Stare |
|---|---|
| Audit intern — 15 agenti paraleli (full-review) | ✅ COMPLET. Sinteza in `.claude/reviews/a9630b9.md` |
| Raport extern primit (`AUDIT-FINAL-FULL-PROJECT-v2.43.0-2026-07-11.md`, 32 findings, verdict DO NOT SHIP) | ✅ Primit de la user (sesiune separata) |
| Verificare adversariala BACKEND a raportului extern (11 claims) | ✅ COMPLET — 8 CONFIRMED, 3 PARTIALLY, 0 REFUTED (vezi §4) |
| Verificare adversariala FRONTEND a raportului extern (H-03 + 18× M-*/L-*) | ✅ COMPLET (2026-07-11, sesiune 2) — 17 CONFIRMED, 1 PARTIALLY (L-07), 0 REFUTED |
| Verificare 4 claims backend neacoperite initial (M-03, M-04, L-03, L-04) | ✅ COMPLET — toate CONFIRMED |
| Raport tehnic consolidat .md (deliverable) | ✅ LIVRAT: `audit/AUDIT-CONSOLIDAT-v2.43.0-rnpm-split-2026-07-11.md` |
| Raport HTML non-tehnic (deliverable) | ✅ LIVRAT: `Legal-Dashboard-v2.43.0-Audit-Consolidat.html` |

**Stare finala:** toate cele 32 findings externe verificate — 28 CONFIRMED, 4 PARTIALLY, 0 REFUTED. Sursa unica pentru planul de fixuri e acum raportul consolidat `audit/AUDIT-CONSOLIDAT-v2.43.0-rnpm-split-2026-07-11.md` (§5 clustere + §6 plan P0/P1/P2).

---

## 1. Ce conteaza cel mai mult (verdict de release)

**Zero probleme Critical/BLOCKER pe securitate.** Nucleul splitului RNPM e solid si crash-safe (marker 2-phase durabil, backup pre-split cu integrity_check, resume fail-closed, restore prin staging + rename atomic cu auto-revert, latch-uri simetrice). Securitatea rutelor noi e curata: fara IDOR, path traversal, SQL injection, secrete (jail dublu pe stem-uri: `OWNER_ID_RE` allowlist + hash injectiv).

**Verdict consolidat:**
- **Desktop (Electron): SHIP WITH KNOWN RISKS** — riscurile ramase sunt operationale (freeze UI la primul boot cu monolit mare, lipsa kill-switch splitter) + un bug real de UX-safety (Enter pe "Anuleaza" confirma stergerea — EXT-H-03). Recomandat sa iei quick-win-urile P0 inainte de tag.
- **Web multi-user: DO NOT SHIP inca** — pana la inchiderea clusterului P0. Motoarele: fereastra dual-writer / lock (INT-H1/H2 + EXT-H-01), gap silentios de recovery pe backup zilnic (EXT-H-02), integritate audit pe operatii distructive (INT-H3/H4), datorii de contract API (INT-H5/H6), plus bariere de accesibilitate WCAG (INT-H7/H8/H9).

**Reconciliere cu raportul extern (DO NOT SHIP):** justificat, dar cele 3 "High" externe se recalibreaza dupa verificare pe cod: **EXT-H-01 → Medium** (web) / Low (desktop) — vezi §4; **EXT-H-02 → Medium dar recovery-critical si NOU in branch** (cel mai actionabil finding nou); **EXT-H-03 → confirmat, real, all-modes**. Adevaratele blocante de web raman clusterul combinat intern+extern din §6.

---

## 2. Surse de findings (3)

1. **Audit intern — 15 agenti** (full-review skill). Sinteza persistata: `.claude/reviews/a9630b9.md`. Verdict: 🟡 CONDITIONAL. Agenti: deep-code-reviewer, claude-guard, repo-security-auditor (CLEAN), release-readiness, backend-reliability, api-contract, database-change, dependency-security (CLEAN), data-validation, workflow-risk, audit-trail, test-architect + 3 general-purpose (a11y WCAG 2.2 AA, UI consistency, frontend concurrency).
2. **Raport extern** `AUDIT-FINAL-FULL-PROJECT-v2.43.0-2026-07-11.md` — 0 Critical / 3 High / 22 Medium / 7 Low = 32. Verdict: DO NOT SHIP. (Consolidat Warden/Prism/Vigil/Proof.)
3. **Verificari adversariale** ale raportului extern pe codul curent (aceasta sesiune): backend complet (§4), frontend partial (§5).

---

## 3. Findings interne cheie (din `.claude/reviews/a9630b9.md`, verificate pe cod)

Severitati unificate proiect: 🔴 BLOCKER (data loss/security/injection) · 🟠 HIGH (reliability prod, race, silent errors) · 🟡 MEDIUM (UX, coupling) · 🟢 LOW.

| ID | Sev | Locatie | Esenta |
|---|---|---|---|
| INT-H1 | 🟠 | `backend/src/db/instanceLock.ts:264-281` | Heartbeat (write+rename la 5s) fara try/catch → EBUSY/EPERM tranzitoriu pe Windows arunca in setInterval; `index.ts` fara handler `uncaughtException` → proces ucis, sare peste graceful shutdown (fara drain, WAL checkpoint, release curat). Electron face `app.exit(1)` (sare `before-quit`). |
| INT-H2 | 🟠 | `backend/src/db/instanceLock.test.ts:99-104`, `:273` | Reclaim `LEGAL_DASHBOARD_FORCE_BOOT=1` pe PID viu se bazeaza pe self-crash-ul heartbeat-ului procesului deposedat; niciun test cu doi holderi concurenti nu dovedeste ca moare inainte sa mai scrie SQLite (fereastra dual-writer = exact ce previne lock-ul). |
| INT-H3 | 🟠 | `backend/src/routes/rnpm.ts:884`, `:907` | `aviz.delete_all`/`delete_batch` (rescrise in branch: rol largit `admin,user`, gard SEARCH_ACTIVE nou) folosesc `recordAudit` care ARUNCA pe calea de succes, nu `recordAuditSafe` → esec audit dupa delete comis = 500 → client reia op distructiva deja terminata. Exact clasa reparata in Rev.4 cateva sute de linii mai jos. |
| INT-H4 | 🟠 | `rnpm.ts:1100,1109,1126`; `rnpmSplitter.ts` (fara recordAudit); `rnpm.ts:865-869,893-897,964-985`; `adminBackups.ts:55-60,85-94,109-114` | Audit trail incomplet pe op privilegiate: owner afectat de restore/delete cross-owner admin doar in `detail_json` neindexat (nequeriabil in UI Audit); wipe monolit invizibil in `audit_log`; refuzuri SEARCH_ACTIVE si compact neauditate; 409/503 marcate `outcome:"error"` in loc de `"denied"`. |
| INT-H5 | 🟠 | `backend/src/routes/adminBackups.ts:35,52,82,106` + `util/envelope.ts:21-48` + `frontend/src/lib/rnpmApi.ts:95-115` | adminBackups intoarce succes RAW (`{backups}`, `{ok,name}`, `{deleted}`) — fara envelope `ok()`, asimetric cu `fail()` din acelasi fisier; coduri `RESTORE_IN_PROGRESS`/`SEARCH_ACTIVE`/`MAINTENANCE_SHUTDOWN`/`cooldown` neinregistrate in `ErrorCodes`; `jsonOrThrow` pierde `.code` → UI nu distinge retryable de fatal. |
| INT-H6 | 🟠 | `rnpm.ts:992-1120`; `backend/src/routes/me.ts:151` | `/api/rnpm/backups*` si-a schimbat semantica (admin-monolit → self-service per-owner) pe acelasi URL/verb fara versionare API; `/me/budget` a inlocuit cheia `feature` `ai.single`/`ai.multi` cu `"ai"` → frontend web vechi cache-uit randeaza buget gol in tacere. Mitigare partiala: jail-ul de prefixe da 400, nu corupere. |
| INT-H7 | 🟠 a11y | `frontend/src/components/rnpm/RnpmSavedStats.tsx:237-247`, `RnpmRestoreModal.tsx:72-80` | Modalele RNPM (nucleul branch-ului) fara `role="dialog"`/`aria-modal`/focus trap/restore focus; comentariile biome-ignore invoca un "focus trap intern" inexistent. `useDialog` exista si e folosit corect de `ApiKeyDialog`. |
| INT-H8 | 🟠 a11y | `Backups.tsx:144-160`, `RnpmRestoreModal.tsx:97-110`, `RnpmBulkSearch.tsx:451-461`, `RnpmSearch.tsx:570-586` | Stari async (succes/eroare restore, progres bulk, overlay split) fara `role="status"`/`aria-live` → screen reader nu afla ca operatia s-a terminat. |
| INT-H9 | 🟠 a11y | `ApiKeyDialog.tsx:142-163,295-329`, `Keys.tsx:191-229`; `ApiKeyDialog.tsx` ×6 + `Keys.tsx:155-161`; `RnpmResultsTable.tsx:515-520` | Toggle-uri Native/OpenRouter, 2Captcha/CapSolver, Secvential/Paralel cu selectie doar prin culoare (fara `aria-pressed`); inputuri chei API fara `<label>` (nume doar din placeholder); checkbox-uri per rand fara nume accesibil. |
| INT-H10 | 🟠 copy | `TenantKeyStatusPanel.tsx:105`, `Keys.tsx:120`, `changelog-entries.tsx:129,142`; `Quota.tsx:283+`, `Grants.tsx:283+` | "tenant" in copy vizibil (regula user EXPLICITA: interzis) in heading-uri + changelog in-app; "Feature" ca eticheta; "user/userul" amestecat cu "utilizator". `ApiKeyDialog` are deja formularea corecta "la nivel de organizatie". |
| INT-H11 | 🟠 UX | `frontend/src/pages/admin/Backups.tsx:67-74` + `confirm-dialog.tsx:85` | Confirmarea de RESTAURARE a monolitului se deschide cu titlul fallback "Confirmare stergere" (nu se paseaza `title`, `destructive:true`) — copy derutant pe cea mai periculoasa actiune. |

**Medium interne notabile (detalii complete in `.claude/reviews/a9630b9.md`):** M1 backup zilnic tine lock exclusiv O(N useri) (`backup.ts:1338`); M2 lipsa kill-switch splitter; M3 freeze UI Electron first-boot; M4 Docker `start-period=120s`; M5 `waitForBackupToSettle` timeout silentios; M6 dedup `clientRequestId` process-local (multi-replica); M7 `0041.down` dubleaza bugetul AI; M8 `preSplitBackupStrict` VACUUM INTO fara staging; M9 `ownerId` fara typeof (500 in loc de 400); M10 `fs.existsSync` sincron ×2; M11 `createGrant` fara idempotenta; M12 stare stale post-restore monolit pe web; M13 restore/compact fara dedup server; M14 gap-uri de teste crash-injection; M15 inconsistente UI (format data, feedback, valuta).

---

## 4. Verificare BACKEND a raportului extern — COMPLETA (11 claims)

**Rezultat: 8 CONFIRMED, 3 PARTIALLY CONFIRMED, 0 REFUTED.** Severitatile externe "High" se recalibreaza mai jos.

| ID extern | Verdict | Locatie HEAD | Severitate reala | Scope |
|---|---|---|---|---|
| **H-01** shutdown elibereaza lock inainte de settle | 🟡 PARTIALLY | `index.ts:958-982`, `backup.ts:73-91,1255-1265`, `snapshotRunner.ts:23,112-116` | **Medium (web) / Low (desktop)** | IN SCOPE |
| **H-02** daily backup omite silentios toate DB RNPM | ✅ CONFIRMED | `backup.ts:1317-1323` | **Medium (recovery-critical, NOU)** | IN SCOPE |
| **M-01** DELETE /saved/all non-atomic vs search/compact | ✅ CONFIRMED | `rnpm.ts:861-888`, `backup.ts:993-998`, `rnpmActivity.ts:23-26,39-42` | Low (per-owner, fara corupere, `compacted:false` vizibil) | IN SCOPE |
| **M-02** preflight disc subestimeaza descrierile partajate | 🟡 PARTIALLY | `0001_baseline.up.sql:59-64`, `avizRepository.ts:294-296`, `rnpmSplitter.ts:334-342,163-192` | Low (fail-closed, monolit intact; imposibil pe desktop 1-owner) | IN SCOPE |
| **M-05** create backup pending pe hook offsite in afara lock-ului | ✅ CONFIRMED | `backup.ts:1207-1243,1138-1141`, `adminBackups.ts:45-52`, `rnpm.ts:1037` | Low (doar daca `LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD` setat) | IN SCOPE |
| **M-06** CSRF localhost pe 2 POST body-less | ✅ CONFIRMED | `originGuard.ts:52-56`, `monitoring.ts:457`, `me.ts:301`, `requireDesktopHeader.ts:38-41` | Low (DOAR desktop; web fail-closed prin SameSite=Strict + ownerContext; nuisance) | PRE-EXISTENT |
| **M-07** query-uri juridice (PII) in loguri | ✅ CONFIRMED | `index.ts:95` (logger global), `dosare.ts:100-101`, `termene.ts:106-107`, `dosareIccj.ts:88-89,170-171`, `rnpm.ts:825-831` | **Medium (web/Docker: PII in stdout persistat)** | PRE-EXISTENT |
| **M-08** erori SMTP logate brut | ✅ CONFIRMED | `mailer.ts:187,213,233` vs `auditSanitize.ts:63-74` (sanitizer folosit doar in `alertEmailDispatcher.ts:100`) | Low | PRE-EXISTENT |
| **M-09** retentie audit/AI depinde de scheduler monitoring | ✅ CONFIRMED | `scheduler.ts:401,423`, `index.ts:764,789,815-838`, `auditRepository.ts:315-324` | Low (opt-in: doar cu `MONITORING_ENABLED=0`; `MONITORING_DISABLED_KINDS` NU declanseaza) | PRE-EXISTENT |
| **L-01** listBackups intoarce [] pe orice eroare FS | ✅ CONFIRMED | `backup.ts:235-242` | Low | Pattern PRE-EXISTENT, purtat in cod rescris |
| **L-05** no-store doar pe PAT/export, nu global | 🟡 PARTIALLY | `patSecurity.ts:22-25`, `index.ts:98-114` (+ `apiTokens.ts:22`, `admin.ts:333,699`, `alerts.ts:635`) | Low (defense-in-depth; relevant la layer Cloudflare cu cache agresiv) | PRE-EXISTENT |

**Nuante critice din verificare:**
- **H-01 nu inseamna "dual writers → corupere".** Pe SIGTERM/SIGINT, `process.exit(0)` ruleaza imediat dupa release (`index.ts:984-989`) → procesul vechi moare la milisecunde, fereastra de coexistenta e ~nula, iar writerul "in zbor" e ucis, nu lasat sa scrie 9,5 min. Desktop are `requestSingleInstanceLock()` Electron. Riscul rezidual real: **operatie de mentenanta ucisa mid-swap la exit** (mitigata de checkpoint la close + cleanup orphan tmp la boot + backup pre-restore), NU dual writers. Fixul cerut ramane valid (recheck latch dupa acquire; nu elibera lock cat exista writeri), dar severitatea e Medium(web)/Low(desktop).
- **H-02 e cel mai actionabil finding nou** (fix ~5 linii: errno check + log; inghite doar ENOENT). Contrastul: esecurile per-target SUNT deja logate (`daily_backup_failed`), doar enumerarea directorului RNPM e gaura silentioasa.
- **Introduse de branch (in scope):** H-01, H-02, M-01, M-02, M-05. **Pre-existente:** M-06, M-07, M-08, M-09, L-01, L-05.
- Quick-win-uri backend cu raport valoare/efort maxim: **H-02** (errno+log), **M-06** (`requireDesktopHeader` pe 2 rute), **M-08** (sanitizeSmtpError in 3 console.error).

---

## 5. Verificare FRONTEND a raportului extern — PARTIALA

**H-03 — CONFIRMED** (agent `verify-frontend`, la HEAD): `confirm-dialog.tsx:48-57` inregistreaza `onKey` pe `window`; la Enter face NECONDITIONAT `e.preventDefault()` + `close(true)`, fara verificare `activeElement`/`e.target`. Butonul "Anuleaza" (`:91`) e `<button>` simplu; `preventDefault` in bubbling anuleaza click-ul nativ al Cancel-ului → **Enter pe "Anuleaza" CONFIRMA actiunea distructiva**. Agravant: handler pe `window` + fara focus trap → Enter oriunde in pagina confirma dialogul (inclusiv `destructive:true`: admin Backups, Users, RNPM delete-all). Escape anuleaza corect; Space pe Cancel anuleaza corect. Fara test (`confirm-dialog.test.tsx` inexistent).

**INCA IN CURS / DE COLECTAT (18 claims trimise la `verify-frontend`):** M-05 (FE busy flags), M-10 (key save pare succes), M-11 (manual descrie gresit custodia cheilor web), M-12 (modale RNPM focus — se suprapune cu INT-H7), M-13 (shell fara reflow 320px/400%), M-14 (modale depasesc viewport fara scroll), M-15 (taburi Settings ARIA incomplet), M-16 (select fara aria-activedescendant — de transat: audit intern a spus select.tsx OK cu role=combobox), M-17 (filtre/paginare fara label), M-18 (checkbox/randuri expandabile — se suprapune cu INT-H9), M-19 (progres/erori neanuntate — se suprapune cu INT-H8), M-20 (touch targets 6px + focus ring), M-21 (toast expira fara pauza hover/focus), M-22 (contrast amber-600 ~3.05:1), L-02 (fetch/timeout fara cleanup), L-06 (fara prefers-reduced-motion), L-07 (terminologie backup amestecata).

**Actiune sesiune noua:** colecteaza tabelul de la `verify-frontend` (SendMessage cu `to: "verify-frontend"` daca inca traieste, altfel re-ruleaza un general-purpose a11y pe lista de mai sus). Multe se confirma reciproc cu INT-H7/H8/H9 — la consolidare, dedup.

---

## 6. Tabel consolidat pentru planul de fixuri (grupat pe cluster de cauza)

Ordonat dupa blast radius: data loss > security > downtime > UX > style. `[web]` = blocant pentru deploy web; `[desktop]` = relevant si desktop.

### Cluster A — Data-safety & reliability (P0, web-blocking)
- **A1** Lock de instanta fragil + fereastra dual-writer: **INT-H1** (`instanceLock.ts:264-281` — try/catch pe heartbeat, arunca doar pe mismatch de continut citit) + **INT-H2** (test doi holderi concurenti) + **EXT-H-01** (recheck latch shutdown dupa `acquireWrite`; nu elibera lock cat exista writeri — `index.ts:958-982`, `backup.ts:73-91`).
- **A2** Recovery silentios rupt: **EXT-H-02** (`backup.ts:1317-1323` — errno check, log, marcheaza partial/failed; inghite doar ENOENT). NOU, fix ~5 linii.
- **A3** Retry pe op distructiva comisa: **INT-H3** (`rnpm.ts:884,907` — `recordAudit`→`recordAuditSafe`).
- **A4** Actiune distructiva la Enter pe Cancel: **EXT-H-03** (`confirm-dialog.tsx:48-57` — elimina confirmarea globala pe Enter; lasa butonul focalizat sa gestioneze activarea; focus implicit pe Anuleaza in destructive) `[desktop+web]`.
- **A5** Titlu confirm gresit la restore: **INT-H11** (`Backups.tsx:67-74` — `title:"Restaureaza backup"`).
- **A6** Delete/all non-atomic: **EXT-M-01** (`rnpm.ts:861-888` — muta delete+compact sub acelasi write lock + owner latch inainte de prima mutatie).

### Cluster B — Audit trail integrity (P0/P1)
- **B1** **INT-H4**: `ownerId:owner` in AuditOptions la restore/delete cross-owner; audit pe wipe monolit (flush deferat, pattern `flushPendingReclaimAudit`); audit pe refuzuri SEARCH_ACTIVE + compact; clasifica 409/503 ca `denied` nu `error`.

### Cluster C — API contract (P1, web)
- **C1** **INT-H5**: envelope `ok()` pe adminBackups; inregistreaza codurile in `ErrorCodes`; `jsonOrThrow` sa pastreze `.code`.
- **C2** **INT-H6**: alias-uri legacy `ai.single`/`ai.multi` in `/me/budget` un ciclu; versionare/negociere pentru `/api/rnpm/backups*`.

### Cluster D — Accessibility (P1, web-launch)
- **D1** Dialog primitiv unic stack-aware cu focus trap/restore: **INT-H7** + **EXT-M-12** + **EXT-M-14** (max-height + scroll) + pre-existent `confirm-dialog.tsx`.
- **D2** Live regions + aria-busy: **INT-H8** + **EXT-M-19**.
- **D3** Nume accesibile + aria-pressed: **INT-H9** + **EXT-M-16/M-17/M-18**.
- **D4** Taburi ARIA complet (roving tabindex, arrows): **EXT-M-15** (reutilizeaza `JobKindTabs`).
- **D5** Responsive/reflow 320px/400%: **EXT-M-13**.
- **D6** Touch targets ≥24px + focus ring: **EXT-M-20**.
- **D7** Toast pauza la hover/focus + `role="alert"` erori: **EXT-M-21**.
- **D8** Contrast amber (amber-700/800 pe light): **EXT-M-22**.
- **D9** `prefers-reduced-motion`: **EXT-L-06**.

### Cluster E — Security hardening (P1/P2, mostly pre-existing)
- **E1** **EXT-M-06**: `requireDesktopHeader` pe `POST /monitoring/jobs/:id/run` + `POST /me/email-settings/test` (desktop-only nuisance).
- **E2** **EXT-M-07**: logger custom pathname-only (redacteaza query PII) `[web]`.
- **E3** **EXT-M-08**: `sanitizeSmtpError` in cele 3 `console.error` din mailer.
- **E4** **EXT-M-09**: retention worker independent de `MONITORING_ENABLED` (sau timere dedicate ca la reservations/JTI).
- **E5** **EXT-L-03/L-04** + INT-LOW: scoate `db.path` absolut din `/stats`; mesaje generice + requestId in loc de `e.message` brut pe rutele de backup.
- **E6** **EXT-L-05**: `Cache-Control: no-store, private` global pe API autentificat cu cookie.

### Cluster F — Copy & UI consistency (P2)
- **F1** **INT-H10** + **EXT-M-11** (manual gresit web keys) + **EXT-L-07**: elimina "tenant"/"Feature"/"user" vizibil; glosar unic backup/restaurare; corecteaza manualul (desktop=safeStorage, web=tenant keys criptate).
- **F2** INT-M15: format data unic (`formatIsoDateTime`), feedback unic (toast vs banner), valuta consistenta, flex-wrap la 360px, unificare taburi.

### Cluster G — Correctness side-paths (P2)
- **G1** **EXT-M-02** preflight disc realist per-owner cu descrieri duplicate; **EXT-M-03** ledger idempotency restore; **EXT-M-04** prune si pe failure paths; **EXT-M-05** hook offsite fire-and-forget cu status; **INT-M7** `0041.down` (injumatateste sau 0+re-grant); **INT-M8** staging pre-split VACUUM; **INT-M9** typeof ownerId; **INT-M10** async fs; **INT-M11** createGrant idempotent; **INT-M12** reload post-restore web; **INT-M13** dedup restore/compact server-side; **INT-M14** teste crash-injection; **EXT-L-01/L-02** empty-state vs eroare FS, cleanup fetch/timeout.

---

## 7. Plan de remediere prioritizat

**P0 — inainte de ORICE release (inclusiv desktop):**
A2 (EXT-H-02 recovery), A3 (INT-H3), A4 (EXT-H-03 Enter), A5 (INT-H11 titlu), A1 partial (INT-H1 try/catch heartbeat + INT-H2 test), A6 (EXT-M-01). Apoi: fault-injection shutdown >30s + pornire a doua instanta; suite complete backend/frontend/electron; smoke Electron impachetat pe backup/restore/compact.

**P1 — inainte de promovarea web:** A1 complet (EXT-H-01 recheck latch), B1 (audit), C1/C2 (contract), D1–D3 (a11y core), E1/E2/E4 (CSRF, PII logs, retention), E5/E6 (leak path/error, no-store). Smoke web 2 useri + proxy CIDR real; test keyboard/screen-reader pe dialoguri distructive; matrice responsive/zoom.

**P2 — imediat dupa blocante:** D4–D9, E3, F1/F2, G1 (tot clusterul).

**Quick wins (risc regresie ~zero):** errno check daily backup (A2); `recordAudit`→`recordAuditSafe` (A3, 2 linii); elimina handler global Enter (A4); `title` la confirm restore (A5); `requireDesktopHeader` pe 2 rute (E1); `sanitizeSmtpError` ×3 (E3); scoate `db.path` + mesaje generice 500 (E5); `no-store` global (E6); inlocuiri "tenant"/"Feature"/"user" (F1); `typeof ownerId` (INT-M9); `fsPromises.access` (INT-M10); inregistrare coduri `ErrorCodes` (C1); exclude pool `pre-rnpm-split-*` din delete-all; `formatIsoDateTime` in Backups.

---

## 8. Zone verificate FARA finding (nu re-investiga)

Auth web valideaza JWT/PAT server-side, owner din credential nu din body; rute admin cu `requireRole("admin")`; repositories owner-scoped; Electron pastreaza contextIsolation/sandbox/nodeIntegration:false/CSP/allowlist URL; DOMPurify doar pe output AI (singurul sink `dangerouslySetInnerHTML`); SQL parametrizat, identifiers din allowlist intern; jail stem `OWNER_ID_RE` + hash injectiv (rezista traversal/collision Windows); baseline RNPM verificat structural echivalent cu monolitul (anti-drift test real cu SQLite); migrations 0040-0042 UP atomice + idempotente cu backup pre-migration; `xlsx-js-style` pe write/export (advisory prototype pollution = read-only, neafectat); `jspdf@4.2.1` cu fixuri; dependency graph = pur version bump 2.40→2.43 fara deps noi; `snapshot-worker.cjs` static, `VACUUM INTO ?` parametrizat, fara net/eval; dev-web-proxy/dev-web-local bind 127.0.0.1, secrete crypto RNG git-ignored; electron/main.js = hardening net (IS_DEV via app.isPackaged, boot nonce, IPC sender validation).

---

## 9. Artefacte & fisiere cheie

| Fisier | Ce e |
|---|---|
| `.claude/reviews/a9630b9.md` | Sinteza auditului intern (15 agenti) + per-agent verdicts |
| `HANDOFF-AUDIT-v2.43.0-rnpm-split-2026-07-11.md` | Acest document |
| `AUDIT-FINAL-FULL-PROJECT-v2.43.0-2026-07-11.md` | Raportul extern (32 findings). **NU e pe disc** — userul il are ca attachment; toate cele 32 findings sunt insa consolidate + verificate in §4/§5/§6 de mai sus, deci handoff-ul e self-contained. Daca ai nevoie de detaliile brute (evidence/reproduction per finding), cere userului attachment-ul. |
| DE FACUT | Raport tehnic consolidat .md (deliverable pt plan fixuri) |
| DE FACUT | Raport HTML non-tehnic (limbaj pt non-tehnic, focus impact web deploy, per finding: ce e / efect / impact web / propunere) |

**Constrangeri deliverable HTML (din cererea userului):** limbaj usor de inteles pentru non-tehnic; pentru fiecare finding — ce inseamna, efectul, impactul asupra web deploy in special, propunere de rezolvare. Nume de fisier usor de identificat. (Foloseste skill-ul `artifact-design` daca se publica ca Artifact; altfel HTML self-contained.)

---

## 10. Reguli de sesiune de retinut (din CLAUDE.md + memory)

- Audit READ-ONLY: nu s-a modificat cod. Orice fix ulterior respecta: repository-only DB access (SQL raw doar in `backend/src/db/**`), `owner_id` pe toate tabelele, chain separat `migrations-rnpm/` cu test anti-drift, backend CJS bundle (`typeof __dirname`), copy UI romana FARA diacritice.
- Regula user EXPLICITA: fara "tenant"/engleza in copy vizibil; labels/values pe `text-foreground` nu muted; EUR langa USD.
- Workflow push (non-negotiable): biome check --write → tsc --noEmit (backend+frontend) → build → teste → abia apoi commit. Nimic pe `main` direct (memory: doar branch-uri).
- Riscuri acceptate (NU sunt findings): SOAP HTTP upstream, binary Windows nesemnat, LAN bind opt-in fara auth.
- Codex companion: verifica status inainte de relansare (dubluri), MSYS_NO_PATHCONV la cancel.
