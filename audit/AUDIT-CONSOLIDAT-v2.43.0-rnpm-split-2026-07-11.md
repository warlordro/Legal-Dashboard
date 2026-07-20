# Raport consolidat de audit — Legal Dashboard v2.43.0 (RNPM split per-user)

**Data:** 2026-07-11
**Branch:** `feat/v2.43.0-rnpm-split` · **HEAD:** `a9630b9` · **Base (merge-base main):** `6f326e4`
**Diff auditat:** 185 fisiere, ~23.4k linii adaugate
**Mod:** audit read-only; acest document este raportul tehnic unitar (deliverable 1 din 2)

---

## 1. Verdict de release

**Zero findings Critical/BLOCKER pe securitate.** Nucleul splitului RNPM e solid si crash-safe (marker 2-phase durabil, backup pre-split cu integrity_check, resume fail-closed, restore prin staging + rename atomic cu auto-revert, latch-uri simetrice search/restore). Securitatea rutelor noi e curata: fara IDOR, path traversal, SQL injection, secrete; jail dublu pe stem-uri (`OWNER_ID_RE` allowlist + hash injectiv).

| Mod | Verdict | Conditie |
|---|---|---|
| **Desktop (Electron)** | 🟡 **SHIP WITH KNOWN RISKS** | Dupa quick-win-urile P0 (in special A4/EXT-H-03 — Enter pe "Anuleaza" confirma actiunea distructiva). Riscuri ramase acceptabile: freeze UI la primul boot cu monolit mare, lipsa kill-switch splitter. |
| **Web multi-user** | 🔴 **DO NOT SHIP inca** | Pana la inchiderea clusterelor P0 + P1 (lock/dual-writer, recovery backup, audit trail, contract API, a11y core, PII in loguri). |

**Reconciliere cu verdictul extern (DO NOT SHIP):** justificat ca directie, dar cele 3 High externe se recalibreaza dupa verificarea pe cod: EXT-H-01 → Medium (web) / Low (desktop); EXT-H-02 → Medium dar recovery-critical si NOU in branch; EXT-H-03 → High confirmat, all-modes. Adevaratele blocante de web sunt clusterul combinat intern + extern din §5.

---

## 2. Surse si metoda

1. **Audit intern — 15 agenti paraleli** (full-review). Sinteza: `.claude/reviews/a9630b9.md`. Verdict: 🟡 CONDITIONAL. 11 findings HIGH (INT-H1..H11), ~15 MEDIUM, LOW-uri.
2. **Raport extern** `audit/AUDIT-FINAL-FULL-PROJECT-v2.43.0-2026-07-11.md` (consolidare Warden/Prism/Vigil/Proof): 0 Critical / 3 High / 22 Medium / 7 Low = 32 findings. Verdict: DO NOT SHIP.
3. **Verificare adversariala a raportului extern pe codul de la HEAD** — completa pe toate cele 32 findings:
   - backend, 11 claims (sesiunea anterioara): 8 CONFIRMED, 3 PARTIALLY, 0 REFUTED;
   - frontend, 18 claims (H-03 + 17, re-verificate in aceasta sesiune cu 3 agenti paraleli): 17 CONFIRMED (unele cu nuante), 1 PARTIALLY, 0 REFUTED;
   - backend, 4 claims neacoperite initial (M-03, M-04, L-03, L-04 — verificate inline in aceasta sesiune): toate CONFIRMED.

**Bilant verificare raport extern: 28 CONFIRMED · 4 PARTIALLY CONFIRMED · 0 REFUTED.** Raportul extern e de incredere pe fapte; severitatile insa au necesitat recalibrare in ~o treime din cazuri (vezi §3).

---

## 3. Tabel de verificare — toate cele 32 findings externe

Verdictele si severitatile de mai jos sunt rezultatul verificarii pe cod la HEAD `a9630b9`. "Scope": `branch` = introdus de acest branch (in scope pentru v2.43.0), `pre-existent` = exista pe main, `mixt` = pattern pre-existent extins/atins de branch.

| EXT | Esenta | Verdict | Severitate reala | Scope |
|---|---|---|---|---|
| H-01 | Shutdown elibereaza instance lock inainte de settle-ul writerilor | 🟡 PARTIALLY | **Medium (web) / Low (desktop)** | branch |
| H-02 | Daily backup omite silentios toate DB-urile RNPM la eroare de enumerare | ✅ CONFIRMED | **Medium, recovery-critical** | branch (NOU) |
| H-03 | Enter confirma actiunea distructiva chiar cu focus pe "Anuleaza" | ✅ CONFIRMED | **High, all-modes** | pre-existent, central in flow-urile noi |
| M-01 | DELETE /saved/all non-atomic vs search/compact | ✅ CONFIRMED | Low | branch |
| M-02 | Preflight disc split subestimeaza descrierile partajate | 🟡 PARTIALLY | Low (fail-closed, monolit intact) | branch |
| M-03 | Restore fara idempotency durabila (fara clientRequestId) | ✅ CONFIRMED | Medium (web) / Low (desktop) | branch |
| M-04 | Snapshot-uri pre-restore acumulate pe failure paths (prune doar la succes) | ✅ CONFIRMED | Low | branch |
| M-05 | Mutatii RNPM conflictuale in paralel (busy flags separate + hook offsite in afara lock-ului) | ✅ CONFIRMED (BE+FE) | Medium (FE enabler; BE Low, doar cu `LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD`) | branch partial |
| M-06 | CSRF localhost pe 2 POST-uri body-less | ✅ CONFIRMED | Low (doar desktop; web fail-closed) | pre-existent |
| M-07 | Query-uri juridice (PII) integral in loguri | ✅ CONFIRMED | **Medium (web/Docker)** | pre-existent |
| M-08 | Erori SMTP logate brut (sanitizer exista dar nefolosit la console) | ✅ CONFIRMED | Low | pre-existent |
| M-09 | Retentie audit/AI depinde de schedulerul de monitoring | ✅ CONFIRMED | Low (doar cu `MONITORING_ENABLED=0`) | pre-existent |
| M-10 | Salvarea cheilor pare reusita desi persistenta a esuat | ✅ CONFIRMED | Medium (desktop, silent loss) | pre-existent |
| M-11 | Manualul descrie gresit custodia cheilor in web mode | ✅ CONFIRMED | Medium (doc-only fix) | pre-existent, amplificat de branch |
| M-12 | Modale RNPM fara dialog semantics + Escape in cascada | ✅ CONFIRMED | Medium | pre-existent |
| M-13 | Shell fara reflow la 320px/400% zoom | ✅ CONFIRMED (nuante) | Medium (doar web; Electron are minWidth 900) | mixt (Backups.tsx nou) |
| M-14 | Modale backup fara max-height/scroll | ✅ CONFIRMED | Low | pre-existent |
| M-15 | Taburi Settings fara pattern ARIA complet | ✅ CONFIRMED | Low (operabile cu Tab+Enter) | branch (Settings.tsx nou) |
| M-16 | Select custom fara aria-activedescendant | ✅ CONFIRMED (conflict transat) | Medium | pre-existent |
| M-17 | Filtre/paginare fara etichete persistente | ✅ CONFIRMED | Low | pre-existent |
| M-18 | Checkbox/randuri expandabile fara semantica | ✅ CONFIRMED (mai grav la TermeneTable) | Medium | pre-existent |
| M-19 | Progres/erori dinamice neanuntate (fara aria-live) | ✅ CONFIRMED | Medium | mixt (Backups.tsx nou) |
| M-20 | Touch targets 6-22px, focus ring inconsistent | ✅ CONFIRMED | Medium | pre-existent |
| M-21 | Toast expira fara pauza la hover/focus | ✅ CONFIRMED (nuanta: SR e acoperit) | Medium | branch (fisier nou, munca v2.42 consolidata) |
| M-22 | Contrast amber-600 = 3.05:1 in light mode | ✅ CONFIRMED (masurat) | Medium | pre-existent |
| L-01 | listBackups intoarce [] pe orice eroare FS | ✅ CONFIRMED | Low | pattern pre-existent |
| L-02 | Fetch/timeout fara cleanup/generation guard | ✅ CONFIRMED | Low | mixt |
| L-03 | /rnpm/stats expune path absolut al DB-ului | ✅ CONFIRMED | Low | branch |
| L-04 | Endpoint-uri backup returneaza `e.message` brut | ✅ CONFIRMED | Low | branch |
| L-05 | no-store doar pe PAT/export, nu global | 🟡 PARTIALLY | Low (defense-in-depth) | pre-existent |
| L-06 | prefers-reduced-motion lipseste complet | ✅ CONFIRMED | Low | pre-existent |
| L-07 | Terminologie backup/restore amestecata | 🟡 PARTIALLY | Low (scope-ul E precizat in confirmari) | mixt |

### Nuante importante din verificare

**H-01 nu inseamna "dual writers → corupere".** Pe SIGTERM/SIGINT, `process.exit(0)` ruleaza imediat dupa release (`index.ts:984-989`) → procesul vechi moare in milisecunde, fereastra de coexistenta e ~nula, iar writerul in zbor e ucis, nu lasat sa scrie. Desktop are si `requestSingleInstanceLock()` Electron. Riscul rezidual real: operatie de mentenanta ucisa mid-swap la exit (mitigata de checkpoint la close + cleanup orphan tmp la boot + backup pre-restore). Fixul cerut ramane valid (recheck latch dupa `acquireWrite`; nu elibera lock cat exista writeri).

**H-02 e cel mai actionabil finding nou** — fix ~5 linii (`backup.ts:1317-1323`): errno check care inghite doar ENOENT + log + rezultat agregat `partial`/`failed`. Esecurile per-target SUNT deja logate (`daily_backup_failed`); doar enumerarea directorului RNPM e gaura silentioasa.

**H-03, mecanica exacta** (`confirm-dialog.tsx:48-57`): handler `keydown` pe `window`; la Enter face neconditionat `preventDefault()` + `close(true)`, fara verificare `activeElement`. `preventDefault` in bubbling anuleaza si click-ul nativ al butonului "Anuleaza" focalizat. Agravant: fara focus trap, Enter oriunde in pagina confirma dialogul deschis (inclusiv `destructive:true`: admin Backups, Users, RNPM delete-all). Escape si Space pe Cancel functioneaza corect. Fara test.

**M-03/M-04 (verificate in aceasta sesiune):** dedup `clientRequestId` in-flight exista pe search/bulk/split (`rnpm.ts:249,470,628`) dar NU pe restore/compact; nu exista ledger durabil, deci retry dupa raspuns pierdut re-executa restore-ul si creeaza alt snapshot pre-restore — la peste `PRE_RESTORE_RETAIN=5` retries, snapshot-ul starii originale e evictat de prune. Pe failure paths (staging invalid), snapshot-ul creat la `backup.ts:486` ramane pe disc si `pruneOld` (`backup.ts:720`) nu ruleaza → acumulare la retry repetat pe backup invalid. Corroborat de INT-M13.

**M-05 (FE):** `creatingBackup`, `compacting`, `deleting`, `restoring` sunt flags separate in `RnpmSavedStats.tsx:73-79`; "Sterge back-up" e disabled doar de `backupCount === 0`, "Restaurare" nu e disabled de nimic, `handleDeleteBackups` nu are deloc busy flag. Contrast: `admin/Backups.tsx` (nou pe branch) foloseste corect UN singur `busy` partajat — pattern-ul corect exista in acelasi branch.

**M-10 (traseu exact):** `setKeysState(trimmed)` (`useApiKey.ts:178`) ruleaza inainte de `persist()` (fire-and-forget, fara status); pe keystore indisponibil/encrypt fail se seteaza `encryptionUnavailable`, dar grep pe tot frontend-ul arata ZERO consumatori ai flag-ului; pe `localStorage.setItem` aruncat, eroarea e inghitita total (nici flag-ul nu se seteaza). Badge-ul "Activa" citeste state-ul in-memory. Footer-ul dialogului afirma "Cheile se salveaza doar local" chiar cand salvarea a esuat.

**M-11 (citate care contrazic codul):** `manual-content.tsx:392` ("Aplicatia nu stocheaza niciodata cheia captcha pe server"), `:618-619` ("Cheile sunt stocate doar local... obfuscate in localStorage"), `:727` ("Pe web... obfuscate reversibil in localStorage"); similar `export-manual.ts:406-409,470`. Realitatea: in web BYOK e ascuns complet, `clearLegacyStorage()` sterge intrarile obfuscate, iar cheile (inclusiv captcha) traiesc server-side criptat (migration `0026_tenant_api_keys`). Fix doc-only, dar promisiune de securitate falsa exact inainte de deploy web.

**M-16 (conflict intern/extern transat in favoarea raportului extern):** trigger-ul din `select.tsx` e corect (combobox+expanded+haspopup+controls), dar la deschidere focusul DOM se muta pe containerul `role="listbox"` (`select.tsx:196-198`), optiunile nu au `id`, nu primesc focus, si listbox-ul nu seteaza `aria-activedescendant` → AT nu anunta nimic la navigarea cu sageti. Auditul intern evaluase doar trigger-ul. Consumatorii (Audit, Alerts, Users) nu pun `aria-label` pe trigger.

**M-18, mai grav decat claim-ul:** randul expandabil din `TermeneTable.tsx:274-289` nu are `tabIndex`/`onKeyDown` deloc — expandarea e imposibila din tastatura; comentariul biome-ignore ("expusa si prin butoanele de actiune") e factual fals. Similar, comentariile din `RnpmSavedStats.tsx:243` si `RnpmRestoreModal.tsx:76` invoca un "focus trap intern" inexistent.

**M-21 (partial refutat pe SR):** toast-ul ARE `aria-live="polite"` + `<output>` (`toast.tsx:112`), deci anuntarea screen reader functioneaza; ce lipseste real e pause/resume la hover/focus si un mod persistent pentru erori.

**M-22 (masurat):** `#d97706` pe background light (~#f9fafb) = 3.05:1, pe card alb = 3.19:1; toate utilizarile citate sunt text mic (12px) → prag 4.5:1, FAIL in light mode. Scope real: 19 aparitii in 12+ fisiere; dark mode (amber-400) trece.

**M-12 (mecanica cascadei):** `StatsModal` si `RnpmRestoreModal` inregistreaza fiecare `keydown` pe `window` care inchide la Escape fara verificare `defaultPrevented` → un singur Escape inchide modalul copil SI parintele simultan; peste confirm-dialog, inchide tot stack-ul. Primitiva corecta `useDialog` (Escape, focus trap, focus restore, scroll lock) exista si e folosita de `ApiKeyDialog`.

---

## 4. Findings interne cheie (11 HIGH, verificate pe cod)

Detalii complete in `.claude/reviews/a9630b9.md`. Severitati unificate proiect: 🔴 BLOCKER · 🟠 HIGH · 🟡 MEDIUM · 🟢 LOW.

| ID | Sev | Locatie | Esenta |
|---|---|---|---|
| INT-H1 | 🟠 | `instanceLock.ts:264-281` | Heartbeat fara try/catch → EBUSY/EPERM tranzitoriu pe Windows omoara procesul (fara handler `uncaughtException`), sare graceful shutdown. |
| INT-H2 | 🟠 | `instanceLock.test.ts:99-104` | Reclaim FORCE_BOOT pe PID viu: fereastra dual-writer nedovedita de niciun test cu doi holderi concurenti. |
| INT-H3 | 🟠 | `rnpm.ts:884,907` | `delete_all`/`delete_batch` folosesc `recordAudit` care ARUNCA pe succes → esec audit dupa delete comis = 500 → client reia op distructiva terminata. |
| INT-H4 | 🟠 | `rnpm.ts:1100+`, `rnpmSplitter.ts`, `adminBackups.ts` | Audit trail incomplet: owner afectat de op cross-owner doar in `detail_json` nequeriabil; wipe monolit invizibil; refuzuri neauditate; 409/503 = `error` nu `denied`. |
| INT-H5 | 🟠 | `adminBackups.ts:35+`, `envelope.ts`, `rnpmApi.ts:95-115` | Succes RAW fara envelope `ok()`; coduri noi neinregistrate in `ErrorCodes`; `jsonOrThrow` pierde `.code`. |
| INT-H6 | 🟠 | `rnpm.ts:992-1120`, `me.ts:151` | Semantica `/api/rnpm/backups*` schimbata pe acelasi URL fara versionare; `/me/budget` cheie `ai` in loc de `ai.single`/`ai.multi` → frontend vechi cache-uit randeaza buget gol. |
| INT-H7 | 🟠 a11y | `RnpmSavedStats.tsx:237-247`, `RnpmRestoreModal.tsx:72-80` | Modale fara `role="dialog"`/`aria-modal`/focus trap (= EXT-M-12). |
| INT-H8 | 🟠 a11y | `Backups.tsx:144-160` s.a. | Stari async neanuntate (= EXT-M-19). |
| INT-H9 | 🟠 a11y | `ApiKeyDialog.tsx`, `Keys.tsx`, `RnpmResultsTable.tsx` | Toggle-uri doar prin culoare (fara `aria-pressed`); inputuri chei fara label; checkbox-uri fara nume (se suprapune cu EXT-M-16/17/18). |
| INT-H10 | 🟠 copy | `TenantKeyStatusPanel.tsx:105`, `Keys.tsx:120`, `changelog-entries.tsx:129,142`, `Quota/Grants` | "tenant"/"Feature"/"user" in copy vizibil — regula user explicita incalcata. |
| INT-H11 | 🟠 UX | `Backups.tsx:67-74` | Confirmarea de RESTAURARE monolit se deschide cu titlul fallback "Confirmare stergere". |

**Medium interne notabile:** M1 daily backup tine lock exclusiv O(N useri); M2 lipsa kill-switch splitter; M3 freeze UI Electron first-boot; M4 Docker start-period; M5 settle timeout silentios; M6 dedup process-local (multi-replica gate); M7 `0041.down` dubleaza bugetul AI; M8 pre-split VACUUM fara staging; M9 `ownerId` fara typeof; M10 sync fs ×2; M11 `createGrant` fara idempotenta; M12 stale state post-restore web; M13 restore/compact fara dedup server (= EXT-M-03); M14 gap-uri teste crash-injection; M15 inconsistente UI.

---

## 5. Findings consolidate pe clustere de cauza (dedup intern + extern)

Ordonat dupa blast radius: data loss > security > downtime > UX > style. `[web]` = blocant pentru deploy web.

### Cluster A — Data-safety si reliability (P0)

| # | Findings | Fix |
|---|---|---|
| A1 `[web]` | INT-H1 + INT-H2 + EXT-H-01 | Heartbeat cu try/catch (arunca doar pe mismatch de continut citit); test doi holderi concurenti FORCE_BOOT; recheck latch shutdown dupa `acquireWrite`; nu elibera instance lock cat exista writeri. |
| A2 `[web+desktop]` | EXT-H-02 | `backup.ts:1317-1323`: inghite doar ENOENT; altfel log `daily_backup_failed` stage `enumerate_rnpm` + rezultat `partial`/`failed`. Fix ~5 linii. |
| A3 | INT-H3 | `recordAudit` → `recordAuditSafe` pe `delete_all`/`delete_batch` (2 linii, identic cu fixul Rev. 4). |
| A4 `[all]` | EXT-H-03 | Elimina confirmarea globala pe Enter din `confirm-dialog.tsx`; lasa butonul focalizat sa gestioneze activarea nativa; focus implicit pe "Anuleaza" la `destructive:true`; test keyboard. |
| A5 | INT-H11 | `title: "Restaureaza backup"` la confirmarea de restore monolit. |
| A6 | EXT-M-01 | Delete + compact intr-o singura operatie DB-layer, sub acelasi write lock, cu latch owner inainte de prima mutatie. |

### Cluster B — Audit trail integrity (P0/P1) `[web]`

**B1** (INT-H4): `ownerId: owner` in AuditOptions la op cross-owner; audit pe wipe monolit (pattern `flushPendingReclaimAudit`); audit pe refuzuri SEARCH_ACTIVE + compact; 409/503 clasificate `denied`.

### Cluster C — API contract (P1) `[web]`

**C1** (INT-H5): envelope `ok()` pe adminBackups; inregistreaza `RESTORE_IN_PROGRESS`/`SEARCH_ACTIVE`/`MAINTENANCE_SHUTDOWN`/`cooldown` in `ErrorCodes`; `jsonOrThrow` pastreaza `.code`.
**C2** (INT-H6): alias-uri legacy `ai.single`/`ai.multi` un ciclu de release; versionare/negociere pentru `/api/rnpm/backups*`.

### Cluster D — Accessibility (P1 core, P2 restul) `[web-launch]`

| # | Findings | Fix |
|---|---|---|
| D1 | INT-H7 + EXT-M-12 + EXT-M-14 | Primitiva Dialog unica stack-aware (extinde `useDialog`): role/aria-modal, focus trap/restore, un singur handler Escape pentru topmost, `max-h-[calc(100dvh-2rem)] overflow-y-auto`. Sterge comentariile false "focus trap intern". |
| D2 | INT-H8 + EXT-M-19 | `role="status" aria-live="polite"` pe progres, `role="alert"` pe erori, `aria-busy` pe suprafata. Pattern-ul exista deja (toast, CompactSplash, KpiStrip). |
| D3 | INT-H9 + EXT-M-16/17/18 | `aria-activedescendant` + `id` per optiune in select; `aria-label` pe triggere/filtre/paginare; `aria-pressed` pe toggle-uri; nume contextual pe checkbox-uri; buton dedicat expand cu `aria-expanded/controls` (TermeneTable: si `tabIndex`/`onKeyDown` — azi inoperabil din tastatura). |
| D4 | EXT-M-15 | Generalizeaza `JobKindTabs` (roving tabindex, arrows, Home/End) + `aria-controls`/`tabpanel` (lipsesc si in JobKindTabs). |
| D5 | EXT-M-13 | Drawer/collapse responsive sub breakpoint, `min-w-0` pe main, wrap pe action bars; matrice 320/375/768px + zoom 200-400%. |
| D6 | EXT-M-20 | Touch targets ≥24px (dots 6px, Trash2 16px, +/- 22px), `focus-visible:ring-2` pe butoanele raw. |
| D7 | EXT-M-21 | Toast: pause la hover/focus, erori persistente pana la dismiss. (SR e deja acoperit — aria-live exista.) |
| D8 | EXT-M-22 | amber-700/800 in light mode (19 aparitii, 12+ fisiere) sau token semantic verificat in ambele teme. |
| D9 | EXT-L-06 | Media query globala `prefers-reduced-motion` (61 spin, 3 ping, ~11 smooth scroll). |

### Cluster E — Security hardening (P1/P2, majoritar pre-existent)

| # | Findings | Fix |
|---|---|---|
| E1 | EXT-M-06 | `requireDesktopHeader` pe `POST /monitoring/jobs/:id/run` + `POST /me/email-settings/test`. |
| E2 `[web]` | EXT-M-07 | Logger custom pathname-only (fara query PII) in loc de `logger()` global. |
| E3 | EXT-M-08 | `sanitizeSmtpError` in cele 3 `console.error` din mailer. |
| E4 | EXT-M-09 | Retention workers (audit/AI 90d) independente de `MONITORING_ENABLED` — timere dedicate ca la reservations/JWT. |
| E5 | EXT-L-03 + EXT-L-04 + INT-LOW | Scoate `db.path` absolut din `/rnpm/stats` (`rnpm.ts:926,938`); mesaje generice + requestId in loc de `e.message` brut pe rutele de backup (`adminBackups.ts:40,54,84,108`). |
| E6 | EXT-L-05 | `Cache-Control: no-store, private` global pe API-ul autentificat cu cookie. |

### Cluster F — Copy si consistenta UI (P2)

**F1** (INT-H10 + EXT-M-11 + EXT-L-07): elimina "tenant"/"Feature"/"user" din copy vizibil; corecteaza manualul + exportul (desktop = safeStorage ciphertext; web = chei la nivel de organizatie criptate server-side, fara BYOK in browser); glosar unic backup/restaurare ("baza mea RNPM" vs "baza completa" — reziduurile "baza locala" din `RnpmSavedStats.tsx:189,217,420`).
**F2** (INT-M15): `formatIsoDateTime` unic, un singur pattern de feedback, valuta consistenta, flex-wrap la 360px, unificare taburi.

### Cluster G — Correctness cai secundare (P2)

EXT-M-02 (preflight disc realist per-owner), EXT-M-03 + INT-M13 (idempotency restore/compact: `clientRequestId` + ledger sau macar 409 pe in-flight), EXT-M-04 (prune si pe failure paths), EXT-M-05 (hook offsite cu status separat de snapshotul local; UI cu un singur `busyOperation` — pattern-ul corect exista in `admin/Backups.tsx`), EXT-M-10 (persistenta chei cu rezultat confirmat + afisare `encryptionUnavailable`), INT-M7 (`0041.down`), INT-M8 (pre-split VACUUM cu staging), INT-M9 (`typeof ownerId`), INT-M10 (async fs), INT-M11 (`createGrant` idempotent), INT-M12 (reload post-restore web), INT-M14 (teste crash-injection), EXT-L-01 (erori FS explicite la listare), EXT-L-02 (AbortController/cleanup pe fetch/timeout).

---

## 6. Plan de remediere prioritizat

**P0 — inainte de ORICE release (inclusiv desktop):**
A2 (EXT-H-02 recovery), A3 (INT-H3), A4 (EXT-H-03 Enter), A5 (INT-H11 titlu), A1 partial (INT-H1 try/catch heartbeat + INT-H2 test), A6 (EXT-M-01). Apoi: fault-injection shutdown >30s + pornire a doua instanta; suite complete backend/frontend/electron; smoke Electron impachetat pe backup/restore/compact.

**P1 — inainte de promovarea web:**
A1 complet (EXT-H-01 recheck latch), B1 (audit trail), C1/C2 (contract API), D1–D3 (a11y core), E1/E2/E4 (CSRF, PII logs, retention), E5/E6 (leak path/error, no-store). Smoke web cu 2 useri + proxy CIDR real; test keyboard/screen-reader pe dialogurile distructive; matrice responsive/zoom.

**P2 — imediat dupa blocante:**
D4–D9, E3, F1/F2, tot clusterul G.

**Quick wins (risc de regresie ~zero):**
errno check daily backup (A2); `recordAudit`→`recordAuditSafe` (A3, 2 linii); elimina handlerul global Enter (A4); `title` la confirm restore (A5); `requireDesktopHeader` pe 2 rute (E1); `sanitizeSmtpError` ×3 (E3); scoate `db.path` + mesaje generice 500 (E5); `no-store` global (E6); inlocuiri "tenant"/"Feature"/"user" (F1); `typeof ownerId`; `fsPromises.access` in loc de `existsSync`; inregistrare coduri `ErrorCodes` (C1); exclude pool `pre-rnpm-split-*` din delete-all; `formatIsoDateTime` in Backups; amber-700 in light (D8, find-replace verificat); `prefers-reduced-motion` global (D9, un media query).

---

## 7. Zone verificate FARA finding (nu re-investiga)

Auth web valideaza JWT/PAT server-side, owner din credential nu din body; rute admin cu `requireRole("admin")`; repositories owner-scoped; Electron pastreaza contextIsolation/sandbox/nodeIntegration:false/CSP/allowlist URL; DOMPurify pe output AI (singurul sink `dangerouslySetInnerHTML`); SQL parametrizat, identifiers din allowlist intern; jail stem `OWNER_ID_RE` + hash injectiv; baseline RNPM echivalent structural cu monolitul (test anti-drift real); migrations 0040-0042 UP atomice + idempotente cu backup pre-migration; `xlsx-js-style` doar pe write/export (advisory = read path, neafectat); `jspdf@4.2.1` cu fixuri; dependency graph = pur version bump fara deps noi; `snapshot-worker.cjs` static, `VACUUM INTO ?` parametrizat; dev-web-proxy/local bind 127.0.0.1; electron/main.js = hardening net.

**Riscuri acceptate (NU sunt findings):** SOAP HTTP upstream, binary Windows nesemnat, LAN bind opt-in fara auth.

---

## 8. Criterii de re-evaluare a release-ului (dupa P0)

1. Suite complete backend/frontend/electron verzi.
2. Fault-injection: shutdown cu writer >30s + pornire a doua instanta pe acelasi dataDir.
3. Daily backup cu EACCES/EIO pe directorul RNPM → rezultat `partial`/`failed` vizibil, nu succes.
4. Restore complet multi-owner din setul zilnic (monolit + toate DB-urile RNPM).
5. Smoke Electron impachetat: backup/restore/compact.
6. Smoke web cu doi useri si proxy CIDR real (pentru promovarea web).
7. Test keyboard (Tab/Shift+Tab/Enter/Escape) pe toate dialogurile distructive.
8. Matrice responsive 320/375/768px + zoom 200-400% (pentru promovarea web).

---

*Surse detaliate: `.claude/reviews/a9630b9.md` (audit intern per-agent), `audit/AUDIT-FINAL-FULL-PROJECT-v2.43.0-2026-07-11.md` (raport extern brut cu evidence/reproduction per finding), `HANDOFF-AUDIT-v2.43.0-rnpm-split-2026-07-11.md` (verificare backend detaliata §4).*
