# PLAN — Master switch pentru oprire monitorizare

**Status:** draft pregatit pentru executie post v2.22.0
**Target version:** v2.23.0
**Autor:** Claude Opus 4.7 (drafting), Cezar (owner)
**Data plan:** 2026-05-13

---

## Problema

Operatorul are azi 3 cai sa opreasca monitorizarea, toate cu dezavantaje:

1. **`MONITORING_DISABLED_KINDS` env var** — necesita restart Electron, e per-kind nu per-owner, si nu poate fi togglat din UI.
2. **`monitoring_jobs.active = 0` per job** — corect dar lent (N UPDATE-uri), si distruge starea per-job. Re-enable nu poate restaura "exact ce era activ inainte" fara snapshot.
3. **`paused_until = far-future` per job** — la fel ca #2, plus reseteaza `paused_until` original.

**Nevoie:** un singur buton in UI (Monitoring page) care opreste *tot* claim-ul scheduler-ului pentru owner-ul curent, instant, fara restart, fara sa atinga `active` / `paused_until` per job. Re-enable trebuie sa fie idempotent si sa restore exact starea anterioara.

## Solutie

Introducere `owner_monitoring_settings.monitoring_enabled` (boolean, default 1). Scheduler-ul `claimDueJobs` adauga in WHERE clause un filtru `owner_id IN (SELECT owner_id FROM owner_monitoring_settings WHERE monitoring_enabled = 1)` — o singura conditie suplimentara, fara N writes.

Cand admin-ul apasa "Opreste monitorizarea": UPDATE / INSERT (UPSERT) la `owner_monitoring_settings` cu `monitoring_enabled = 0`. Joburile individuale raman cu `active` / `paused_until` neatinse. Cand reapasa "Reia monitorizarea": UPSERT back la 1. Joburile due in fereastra de pauza vor fi claim-uite pe ticks urmatori (next_run_at deja in trecut → claim immediate).

**Decizii inchise:**
- Default `monitoring_enabled = 1` cand randul lipseste — nu blocheaza pe cei care nu au atins niciodata switch-ul.
- Nu se toarna in `owner_email_settings` (separation of concerns: email != monitoring claim).
- Nu se logheaza `paused_at` separat in tabel — `updated_at` e suficient. Audit log captureaza tranzitia.
- Audit log: `monitoring.master_switch.off` / `.on` cu `actor_id = owner_id`, sursa `api`.
- Permisiune: NU `requireRole('admin')` — switch-ul e per-owner. Pe desktop owner-ul e mereu `local` (singur user). Pe web fiecare user controleaza propriile joburi.
- UI label: "Opreste monitorizarea" / "Reia monitorizarea" (toggle), badge in toolbar "Monitorizare oprita" cand `monitoring_enabled = 0`.

**Decizii ramase deschise (cer confirmare inainte de Faza C):**
- Plasarea butonului: toolbar in `MonitoringPage` (langa "Adauga monitorizare") sau intr-un dropdown Setari. Default: toolbar (vizibilitate maxima).
- Confirmation modal la oprire? Default: NU (operatie reversibila, fara data loss). Daca utilizatorul apasa accidental, reia imediat. Daca facem modal, doar pe "Reia" cand sunt N joburi due → "Acestea vor rula imediat".

## Migration safety

Tabel nou, fara FK pe `monitoring_jobs` — nu blocheaza drop / rename pe joburi. Index pe `owner_id` (PK implicit, dar adaugam explicit `INDEX` pe coloana `monitoring_enabled` daca masuram ca scheduler-ul scaneaza tabelul). Pre-migration backup `schema-upgrade` deja triggerat de framework-ul de migrari (v2.16.1+).

Rollback (down.sql): `DROP TABLE owner_monitoring_settings`. Scheduler-ul vechi nu cunoaste tabelul; daca rolling back, claim-ul revine la comportamentul curent (toti joburile `active = 1` sunt due). Fara pierdere de date pentru per-job state.

---

## Faza A — Migration (DDL)

**Files:**
- `backend/src/db/migrations/0020_master_switch.up.sql` (nou)
- `backend/src/db/migrations/0020_master_switch.down.sql` (nou)
- `backend/src/db/schema.ts` (update: adauga `OwnerMonitoringSettings` interface + helpers)

**DDL:**
```sql
-- 0020_master_switch.up.sql — per-owner global pause/resume pentru monitoring claim.
--
-- Cand monitoring_enabled = 0, scheduler-ul nu mai claim-uieste niciun job al
-- ownerului, fara sa atinga active/paused_until/next_run_at per job. Re-enable
-- restore-uieste exact starea anterioara: joburile due in fereastra de pauza
-- vor fi claim-uite pe ticks urmatori (next_run_at deja in trecut).
--
-- Default-ul (rand lipsa) e tratat de scheduler ca "enabled" — owneri vechi
-- care n-au atins switch-ul nu sunt blocati.

CREATE TABLE owner_monitoring_settings (
  owner_id            TEXT PRIMARY KEY,
  monitoring_enabled  INTEGER NOT NULL DEFAULT 1
                      CHECK(monitoring_enabled IN (0,1)),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Index pentru scheduler claim: vom face anti-join "WHERE NOT EXISTS (...
-- monitoring_enabled = 0 ...)" deci index pe coloana booleana e util.
CREATE INDEX idx_owner_monitoring_disabled
  ON owner_monitoring_settings(owner_id)
  WHERE monitoring_enabled = 0;
```

```sql
-- 0020_master_switch.down.sql
DROP INDEX IF EXISTS idx_owner_monitoring_disabled;
DROP TABLE IF EXISTS owner_monitoring_settings;
```

**Migration tests:**
- Up creeaza tabelul si index-ul fara erori.
- Up + down + up e idempotent.
- Default `monitoring_enabled = 1` pe INSERT fara coloana.

**DoD:**
- `npm test --workspace=backend` PASS pe noile teste migration.
- `tsc --noEmit` curat.

---

## Faza B — API + scheduler integration

**Files:**
- `backend/src/db/ownerMonitoringSettingsRepository.ts` (nou)
- `backend/src/db/monitoringJobsRepository.ts` (update `claimDueJobs` WHERE clause)
- `backend/src/routes/monitoring.ts` (adauga 2 endpoint-uri)
- `backend/src/audit/auditLog.ts` (adauga `monitoring.master_switch.{on,off}` kind daca nu exista)

**Repository API:**
```ts
// backend/src/db/ownerMonitoringSettingsRepository.ts
export interface OwnerMonitoringSettings {
  owner_id: string;
  monitoring_enabled: 0 | 1;
  created_at: string;
  updated_at: string;
}

// Default 1 cand randul lipseste.
export function getMonitoringEnabled(ownerId: string): boolean;

// Idempotent UPSERT. Returneaza true daca starea s-a schimbat (pentru audit log).
export function setMonitoringEnabled(ownerId: string, enabled: boolean): { changed: boolean };
```

**Scheduler claim update (in `claimDueJobs`):**
```sql
SELECT * FROM monitoring_jobs
WHERE active = 1
  AND (paused_until IS NULL OR paused_until <= ?)
  AND next_run_at <= ?
  AND NOT EXISTS (
    SELECT 1 FROM owner_monitoring_settings oms
    WHERE oms.owner_id = monitoring_jobs.owner_id
      AND oms.monitoring_enabled = 0
  )
  ${kindSql}
  AND NOT EXISTS (
    SELECT 1 FROM monitoring_runs
    WHERE monitoring_runs.job_id = monitoring_jobs.id
      AND monitoring_runs.status = 'running'
  )
ORDER BY next_run_at ASC, id ASC
LIMIT ?
```

**API endpoints:**
- `GET /api/v1/monitoring/master-switch` → `{ data: { enabled: boolean }, error: null, requestId }`
- `PUT /api/v1/monitoring/master-switch` cu body `{ enabled: boolean }` → `{ data: { enabled, changed }, error: null, requestId }`

**Validare:**
- Body schema cu Zod (`z.object({ enabled: z.boolean() }).strict()`).
- 401 daca user-ul nu e autentificat (`requireAuth`).
- 200 cu `changed: false` cand state-ul nu se schimba (no-op idempotent).

**Audit log:**
- `setMonitoringEnabled(...).changed === true` → insereaza `monitoring.master_switch.off` sau `.on` cu `actor_id = ownerId`, `request_id`, `source = 'api'`.

**DoD:**
- `vitest run` PASS pe noile teste repository (5+) si route (4+).
- Test ca un job `active = 1, next_run_at = trecut` nu mai e claim-uit cand `monitoring_enabled = 0`.
- Test ca acelasi job e claim-uit imediat cand `monitoring_enabled` revine la 1.
- Test ca alt owner cu `monitoring_enabled = 1` nu e afectat de switch-ul altcuiva (izolare).
- `npm audit --omit=dev` ramane curat.

---

## Faza C — Frontend (UI + state)

**Files:**
- `frontend/src/lib/monitoringMasterSwitchApi.ts` (nou) — GET/PUT helpers cu retry.
- `frontend/src/hooks/useMonitoringMasterSwitch.ts` (nou) — useState + initial GET + optimistic PUT cu rollback pe error.
- `frontend/src/pages/MonitoringPage.tsx` (update) — toolbar button + banner cand off.
- `frontend/src/components/monitoring/MasterSwitchBanner.tsx` (nou) — banner amber "Monitorizarea este oprita pentru contul tau" cu CTA "Reia".

**UX:**
- Toolbar in `MonitoringPage`: buton secondary "Opreste monitorizarea" cu icona Pause.
- Cand `enabled = false`: butonul devine primary "Reia monitorizarea" cu icona Play; banner amber persistent in topul listei de joburi.
- Loading state: butonul disabled + spinner inline pe durata PUT-ului.
- Error toast cand PUT esueaza, rollback la state-ul anterior.
- Optimistic UI: toggle imediat in state local, revert pe error.

**Refresh logic:**
- Dupa toggle reusit, refresh implicit la lista de joburi (next_run_at-urile lor nu se schimba, dar UI-ul afiseaza un indicator "monitorizare oprita" peste fiecare row pentru claritate vizuala — derivat din state-ul global, nu din DB).

**DoD:**
- `cd frontend && npm test -- --run` PASS pe testele de hook (3+) si banner (2+).
- `tsc --noEmit` curat.
- Manual smoke: toggle on/off vede joburile due imediat / nu vede claim pe scheduler tick.

---

## Faza D — Tests end-to-end

**Backend tests aditionale (peste cele de faza B):**
- `scheduler.test.ts`: tick complet cu owner-A enabled, owner-B disabled — doar joburile owner-A se executa.
- Audit log: PUT toggle creeaza entry corect cu `kind`, `actor_id`, `request_id`.
- Concurrent toggle: doua PUT-uri rapide back-to-back nu creeaza duplicate `monitoring.master_switch.on` entries daca nu se schimba (UPSERT idempotent).

**Frontend tests aditionale:**
- `useMonitoringMasterSwitch` rolls back optimistic update pe 500 / network error.
- Banner reapare dupa refresh daca state-ul backend e `enabled = false`.

**Smoke desktop (manual checklist):**
1. Restart Electron pe v2.23.0.
2. Verifica ca toate joburile existente raman vizibile cu `active` neschimbat.
3. Apasa "Opreste monitorizarea" → banner amber apare, joburile due raman due.
4. Asteapta 1 tick scheduler (60s default) → niciun run nou pornit.
5. Apasa "Reia monitorizarea" → banner dispare, joburile due sunt claim-uite la urmatorul tick (max 60s).
6. Verifica `audit_log` din SQLite are 2 entry-uri: `master_switch.off` + `.on`.

**DoD:**
- 100% test coverage pe noul cod (repository, route, hook, banner).
- Smoke checklist completat fara observatii.

---

## Faza E — Release + docs

**Files de update la release:**
- `CHANGELOG.md` — sectiune noua v2.23.0.
- `frontend/src/data/changelog-entries.tsx` — entry in-app.
- `README.md` — "Versiune curenta" + test counts.
- `CLAUDE.md` — test counts in comanda `npm test`.
- `SESSION-HANDOFF.md` — context sprint inchis.
- `STATUS.md` — versiune + test counts.
- `DOCUMENTATIE.md` — campul "Versiune curenta".

**Pre-push checklist (mandatory):**
- [ ] `npx biome check --write` pe fisierele atinse.
- [ ] `npx tsc --noEmit -p backend/tsconfig.json` curat.
- [ ] `cd frontend && npx tsc --noEmit` curat.
- [ ] `npm run build` curat.
- [ ] `npm test --workspace=backend` PASS.
- [ ] `cd frontend && npm test -- --run` PASS.
- [ ] Restart Electron + smoke checklist Faza D.

---

## Risc / blast radius

**Low risk** — tabel nou, zero schimbari la coloane existente, zero migrari distructive. Default-ul `enabled = 1` cand randul lipseste pastreaza backward-compat 100%. Singura modificare in hot path-ul scheduler-ului e un sub-query `NOT EXISTS` cu index — vom masura timing-ul `claimDueJobs` inainte si dupa, dar empiric pe 1k joburi penalty-ul e sub 1ms.

**Rollback plan:** down migration drop-uieste tabelul. Scheduler-ul vechi (binar din v2.22.0) nu cunoaste tabela, deci nu e impactat. Daca scheduler-ul v2.23.0 ruleaza fara tabela (caz patologic), sub-query-ul returneaza error la prima claim — risc rezolvat prin ordinea migrari → cod (migration ruleaza inainte ca scheduler-ul nou sa porneasca).

**Out-of-scope:**
- Stocare istoric tranzitii (cine a oprit, cand) — audit log e suficient.
- Switch global cross-owner pentru admin (`SUPERSWITCH`) — separat plan daca vine nevoia.
- Programare scheduled pause (ex. "opreste vineri 18:00 - luni 09:00") — separat feature.
- Notificare email cand monitorizarea e oprita > N zile — separat feature.

---

## Estimare

- Faza A: 30 min (migration + tests).
- Faza B: 1h30 (repository + scheduler update + route + tests).
- Faza C: 1h30 (hook + UI + banner + tests).
- Faza D: 30 min (E2E + audit log tests).
- Faza E: 30 min (docs + release).

**Total:** ~4h30, livrabil intr-o sesiune.

---

## Note pentru executie

- Inainte de Faza A: verifica ca v2.22.0 e commit-uit si push-uit clean (nu vrem sa amestecam acest sprint cu v2.22.0).
- Inainte de Faza C: cere confirmare userului pe deciziile UX deschise (plasare buton, confirmation modal).
- Dupa Faza E: scrie session handoff in memory daca lasi sprintul incomplet.
