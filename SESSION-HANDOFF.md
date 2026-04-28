# Session Handoff - v2.2.0 publicat, documentatie in sync

**Data**: 2026-04-29
**Branch activ**: `main`
**Remote**: `origin/main` la merge commit `1907373`
**Tag publicat**: `v2.2.0`
**Status**: PR-0..PR-4 livrate. Monitoring scheduler + `dosar_soap` runner sunt pe `main`, iar full-review hardening Tier 2-6 este inclus in release.

---

## Stare Git

- `main` a fost merge-uit local cu `feat/monitoring-hardening` si push-uit la `origin/main`.
- Tag-ul `v2.2.0` a fost creat local si push-uit la origin.
- Branch-ul vechi `feat/monitoring-core` a fost verificat ca ancestor al `main`, apoi sters local si remote.
- Branch-ul local `feat/monitoring-hardening` ramane doar istoric; poate fi sters dupa ce nu mai e nevoie de referinta locala.

Ultimele commit-uri relevante:

1. `1907373` - merge `feat/monitoring-hardening` in `main` pentru v2.2.0
2. `2c55157` - follow-up review fixes: body caps monitoring, owner-scoped latest snapshot, `page=0`
3. `35a77e2` - bump release v2.2.0
4. `e78b465` - Tier 4-6 hardening follow-ups

---

## Ce este livrat in v2.2.0

- Monitoring scheduler default-on pe desktop, cu `MONITORING_ENABLED=0` kill switch.
- Runner `dosar_soap` cu snapshot, diff, alerte si manual run route.
- Maintenance RWLock pentru backup/restore vs scheduler.
- Crash recovery pentru `monitoring_runs` orphaned.
- Source-error suppression dupa 5 esecuri consecutive.
- `MONITORING_DISABLED_KINDS` pentru oprire operationala per kind.
- Retention purge pentru `monitoring_runs` la 90 zile.
- Body-size limits pe rutele monitoring POST/PATCH/manual-run.
- `getLatestSnapshot(ownerId, jobId)` izolat explicit pe `owner_id`.
- Client API pastreaza explicit `page=0` / `pageSize=0`.

---

## Verificare facuta

- `npm test --workspace=backend`: 333 teste passed.
- `npx tsc --noEmit -p backend/tsconfig.json`: clean.
- `cd frontend && npx tsc --noEmit`: clean.
- `npm run build`: passed.
- Smoke Electron pe port `3021`: backend pornit, scheduler running, job `dosar_soap` creat, run real `ok`, audit `monitoring.job.created` prezent.

Nota practica: dupa teste Node care rebuild-uiesc `better-sqlite3` pentru ABI-ul Node, ruleaza `npm run rebuild:electron` inainte de smoke Electron.

---

## Documentatie

Task curent: sincronizare documentatie dupa publicarea v2.2.0.

Fisiere care trebuie sa ramana aliniate:

- `README.md` - versiune curenta si sumar release.
- `CHANGELOG.md` - intrarea v2.2.0 si numar teste.
- `SECURITY.md` - controale monitoring si env vars.
- `CLAUDE.md` - context proiect pentru agenti.
- `EXECUTION-ROADMAP.md` - PR-4 done, PR-5 retargetat la v2.3.0.
- `PLAN-monitoring-webmode.md` - nota de status, fara rescriere completa a specului istoric.
- `HARDENING.md` - nota ca monitoring Tier 2-6 este inchis in v2.2.0.

---

## Urmatorul PR probabil

PR-5: bulk name lists + `name_soap`, target version `v2.3.0`.

Scope asteptat:

- `name_lists` / `name_list_items` migration.
- Upload XLSX/CSV cu preview validation.
- Commit two-phase pentru liste.
- Runner `name_soap` peste `cautareDosareDupaParte`.
- Cap snapshot si UX warning pentru nume populare.
- `alert_config_json` cu filtre `categorii` / `stadii`.

Inainte de PR-5, recomandat:

1. Commit pentru documentatia sincronizata.
2. Push docs commit pe `main`.
3. Stergere optionala branch local `feat/monitoring-hardening`, daca nu mai e util.
