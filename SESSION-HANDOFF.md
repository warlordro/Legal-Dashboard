# Session Handoff - v2.3.0 publicat, documentatie in sync

**Data**: 2026-04-29
**Branch activ**: `main`
**Remote**: `origin/main` la commit `d02222c` (docs changelog v2.3.0)
**Tag publicat**: `v2.3.0` (peste `v2.2.0`)
**Status**: PR-0..PR-4 livrate, patch `v2.3.0` (audit remediation hardening + export Web Worker) publicat. Urmatorul PR: PR-5 bulk name lists / `name_soap`.

---

## Stare Git

- `main` contine patch-ul `v2.3.0` peste merge-ul `feat/monitoring-hardening` (`1907373`).
- Tag-ul `v2.3.0` creat si push-uit la origin.
- Branch-uri istorice (`feat/monitoring-core`, `feat/monitoring-hardening`, `refactor/post-v2.2.0-cleanup`) pot fi sterse local — nu mai sunt necesare ca referinta.

Ultimele commit-uri relevante:

1. `d02222c` - docs(changelog): expand v2.3.0 — bidirectional self-heal + worker breadth
2. `854a675` - feat(migrations): bidirectional CRLF self-heal + observability + .gitattributes
3. `6378468` - feat(export): unified Web Worker pipeline for XLSX/PDF (RNPM + AI + Manual)
4. `faab38b` - chore(release): v2.3.0 — audit remediation hardening
5. `0da0ba2` - fix(monitoring): enforce tenant isolation in insertAlert
6. `114c503` - refactor(post-v2.2.0): extract excel helpers, monitoring add-form, bulk template

---

## Ce este livrat in v2.3.0 (patch peste v2.2.0)

### Reliability — backup, shutdown, finalize state-guarded
- Backup zilnic recurent prin `setInterval` 24h (timer cleanup la `gracefulShutdown`).
- Restore SQLite cu `PRAGMA integrity_check` inainte de promote; sidecar WAL/SHM unlink cu detection non-ENOENT.
- Graceful shutdown drain HTTP 30s la `SIGTERM` / `SIGINT` inainte de oprirea scheduler-ului si inchiderea DB-ului.
- Migration 0005 `idx_one_running_per_job` — UNIQUE partial index pe `monitoring_runs(job_id) WHERE status='running'`. Garanteaza un singur run `running` simultan per job la nivel de DB.

### RNPM — maintenance lock + audit complet
- `executeSearch` ruleaza sub `withMaintenanceRead` (write-urile in DB intra in lock, fetch HTTP NU).
- Audit log scris pe `POST /saved/delete-batch`, `DELETE /saved/:id`, `DELETE /searches/:id`.
- `executeSearch` verifica `searchRepository.belongsToOwner` inainte de a accepta `existingSearchId` (anti cross-tenant reuse).

### Migration runner — self-heal bidirectional pe line endings
- Hash SQL normalizat (CRLF → LF + BOM scos) stabil intre Windows si Linux.
- `sha256Raw` + `sha256Crlf` permit self-heal in ambele directii pentru DB-uri vechi.
- `RunMigrationsResult.selfHealed[]` expus, schema.ts loggeaza la fiecare boot cu remediere.
- `MIGRATIONS_STRICT=1` dezactiveaza self-heal in CI (drift accidental aruncat).
- `.gitattributes` forteaza `eol=lf` pe `backend/src/db/migrations/*.sql`.

### Export — Web Worker pe toate fluxurile
- XLSX si PDF mutate integral in Web Worker — RNPM avize, Dosare/Termene, panou AI, Manual.
- ArrayBuffer transferat zero-copy intre worker si main thread.
- Vite `worker.format="es"` pentru code-splitting (xlsx + jspdf chunks lazy), bundle principal sub 400 KB.
- Spinner imediat pe butoane la apasare; catch-block ca butonul sa revina la stare initiala daca worker-ul pica.

### Dependinte — bump-uri securitate
- `dompurify >= 3.4.1`, `jspdf >= 4.2.1`, `jspdf-autotable 5.0.7`.

---

## Verificare facuta pentru v2.3.0

- `npm test --workspace=backend`: 357 teste passed (de la 333 in v2.2.0). 24 noi acopera bidirectional self-heal, `MIGRATIONS_STRICT=1`, finalize state guards si recurrence backup timer.
- `npx tsc --noEmit -p backend/tsconfig.json`: clean.
- `cd frontend && npx tsc --noEmit`: clean.
- `npm run build`: passed. `export.worker` chunk emitted (~52 KB), main bundle sub 400 KB.
- Smoke Electron: backup zilnic timer wired, scheduler running, joburi `dosar_soap` finalizate cu `idx_one_running_per_job` activ. Manual PDF + Dosare/Termene XLSX/PDF confirmate.
- Smoke AI analiza: blocat extern (OpenAI 429 quota, Gemini 503) — necesita re-rulare cand quota se elibereaza.

Nota practica: dupa teste Node care rebuild-uiesc `better-sqlite3` pentru ABI-ul Node, ruleaza `npm run rebuild:electron` inainte de smoke Electron.

---

## Documentatie sincronizata

Toate fisierele de mai jos reflecta `v2.3.0`:

- `README.md` - versiune curenta + sumar release.
- `CHANGELOG.md` - intrare noua v2.3.0 peste v2.2.0.
- `STATUS.md` - header + livrat recent.
- `CLAUDE.md` - context agenti, sprint status, test count.
- `EXECUTION-ROADMAP.md` - PR-4 + patch v2.3.0 done; PR-5..PR-8 renumerotat (`v2.4.0..v2.5.1`).
- `PLAN-monitoring-webmode.md` - nota de status v2.3.0 si renumerotare PR-5.
- `SESSION-HANDOFF.md` - acest document.
- `HARDENING.md` - nota status post-v2.3.0.
- `SECURITY.md` - audit row v2.3.0 + monitoring note.
- `frontend/src/data/changelog-entries.tsx` - intrare v2.3.0 in pagina Changelog.

---

## Urmatorul PR

PR-5: bulk name lists + `name_soap`, target version `v2.4.0` (renumerotat — `v2.3.0` consumat de patch-ul de audit remediation).

Scope asteptat:

- Migration `0006_name_lists.up.sql` (0005 ocupat de `idx_one_running_per_job`).
- `name_lists` / `name_list_items` cu `ON DELETE RESTRICT` (per Constatare adversiala #6 din PR-4 review).
- Upload XLSX/CSV cu preview validation per row + commit two-phase.
- Runner `name_soap` peste `cautareDosareDupaParte` cu cap snapshot 1MB.
- Diff per element pe `numar`: `dosar_new`, `dosar_disappeared`, `stadiu_changed`, `categorie_changed`.
- Dedup pe `${kind}|${numar}|${tranzitie}` pentru flapping.
- `alert_config_json` cu filtre `categorii` / `stadii` aplicate la emit (nu la save).
- UX warning pentru nume populare (>100 results).

Inainte de PR-5, recomandat:

1. Stergere optionala branch local `refactor/post-v2.2.0-cleanup`, daca nu mai e util.
2. Re-rulare smoke AI cand cheile externe au quota disponibila.
