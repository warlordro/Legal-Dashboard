# Plan Remediere Audit — 2026-04-29

Document derivat din verificarea AUDIT-REPORT-2026-04-29.md (auditor extern,
2026-04-29) impotriva codului v2.2.0. Raportul original a fost arhivat dupa
extragerea actiunilor concrete in acest plan.

## Verdict global

28 findings auditate → **24 reale/partiale** (de remediat), **2 mitigate**
(#9 manual run, R2 /health expune deja `running:false`), **2 acceptate**
(#14 SOAP HTTP upstream, #5 Compose loopback by design).

## Tabel sintetic

| # | Finding | Verdict | Severitate |
|---|---------|---------|------------|
| 1 | Deps vulnerabile xlsx/jspdf/dompurify | REAL | Critical |
| 2 | Restore SQLite sidecar WAL/SHM | PARTIAL | High |
| 3 | Electron `startsWith` URL bypass | REAL | High |
| 4 | Remote mode auth-less | REAL (PR-9) | High |
| 5 | Docker Compose loopback bind | PARTIAL (intentionat) | Low |
| 6 | Docker DB fara volum | REAL | High |
| 7 | Backup daily doar la boot | REAL | High |
| 8 | Maintenance lock nu acopera RNPM writers | REAL | High |
| 9 | `runJobNow` fire-and-forget | MITIGAT | — |
| 10 | `finalize()` fara state guard | REAL | Medium |
| 11 | RNPM `searchId` cross-tenant | REAL | Medium |
| 12 | `notify_days_before` / `email_to` neimplementate | REAL | Medium |
| 13 | CSRF localhost | PARTIAL (doar remote) | Medium |
| 14 | SOAP HTTP plaintext | ACCEPTAT | — |
| 15 | RNPM destructive fara audit complet | REAL (3/6 rute) | Medium |
| P1.A | RNPM modale fara role/aria-modal/focus | REAL | Medium |
| P1.B | Escape inchide parent + child | PARTIAL | Low |
| P1.C | Randuri tabel click-only (4 componente) | REAL | Medium |
| P1.D | Labels neasociate htmlFor | REAL | Medium |
| P2 | Touch targets sub 44px | REAL | Low |
| P2 | XLSX in initial graph | PARTIAL | Low |
| P2 | DosareTable sort fara `useMemo` | REAL | Low |
| R1 | SIGTERM nu inchide HTTP server | REAL | High |
| R2 | `/health` 200 cand scheduler crap | PARTIAL | Medium |
| R3 | `dotenv` override unconditional | REAL | Medium |
| R4 | Vite proxy 3001 vs backend 3002 | REAL | Low |
| R5 | CI fara Windows/server ZIP | REAL | Medium |
| R6 | requestId mounted dupa logger | REAL | Low |

## Plan in 3 valuri

### Hotfix v2.2.1 (1-2 zile)

1. **#3** Electron `new URL()` allow-list — `electron/main.js:337-342` foloseste
   `startsWith()`. URL-ul `http://localhost:3002@attacker.example/` trece
   verificarea. Inlocuieste cu parser strict (oglindeste pattern-ul deja
   prezent in `setWindowOpenHandler` L348-355).
2. **#11** RNPM `searchId` cross-tenant — adauga `searchRepository.belongsToOwner`
   helper si `executeSearch` apeleaza inainte sa accepte `existingSearchId`.
3. **#15** RNPM destructive audit complet — adauga `recordAudit` in:
   - `POST /saved/delete-batch`
   - `DELETE /saved/:id`
   - `DELETE /searches/:id`
4. **R3** dotenv `override` conditional — `index.ts:40` schimba la
   `override: process.env.NODE_ENV !== "production"`.
5. **R4** Vite proxy port — `frontend/vite.config.ts:41,47,52` aliniaza la 3002.

### Patch v2.3.0 — LIVRAT 2026-04-29 (intre PR-4 si PR-5)

6. **#2** Restore SQLite — `backup.ts` throw pe non-ENOENT la unlink sidecar +
   `PRAGMA integrity_check` post rename; abort daca nu e `ok`.
7. **#7** Backup recurring — `setInterval` 24h dupa `httpServer.listen`,
   `clearInterval` in `gracefulShutdown` inainte de `db.close()`.
8. **#8** RNPM in `withMaintenanceRead` — wrap loop-ul de persist din
   `executeSearch` (DB writes only, NU fetch HTTP — pattern dosarSoapRunner).
9. **#10** Finalize state-guarded + migration **0005** (runner-ul cere
   numerotare contigua; PR-5 va folosi 0006):
   - `WHERE id = ? AND status = 'running'` in `finalize()`
   - `CREATE UNIQUE INDEX idx_one_running_per_job ON monitoring_runs(job_id)
     WHERE status='running'`
10. **R1** `gracefulShutdown` — `await httpServer.close()` cu timeout 30s drain
    inainte de stop scheduler + close DB.
11. **#1** Bump `dompurify ≥3.4.1` + `jspdf ≥4.2.1`; pentru `xlsx` evaluare
    `exceljs` ca migrare (sau pin + plafon strict pe rows/cols la import).

### Roadmap PR-5 → PR-10

12. **#4 + #13** Auth + CSRF — PR-9 (sapt 8-9, deja in roadmap).
13. **#6** Docker volum persistent — PR-10 (cutover web).
14. **#12** Email reminder — implementare in PR-5 (sau strip campuri din schema
    in patch interim ca sa nu inducem in eroare userii).
15. **P1 a11y + P2 perf** — sprint dedicat post PR-5.
16. **R5** CI Windows + server ZIP — workflow nou in PR-10.
17. **R6** requestId in logger — quick win poate intra in v2.3.0.

## Findings deja gestionate

- **#5** Compose loopback — by design (security default), doar README override
  exemplu pentru reverse-proxy deploy.
- **#9** `runJobNow` — auditorul a pierdut path-ul: `monitoring.ts:389` face
  `await scheduler.runJobNow(...).catch(...)`; scheduler `void runOne()` are
  `.finally()` la L397.
- **#14** SOAP HTTP — limitare upstream PortalJust, deja in SECURITY.md ca
  risc acceptat (date publice, fara auth).
- **R2** `/health` — expune deja `monitoring.running` boolean. Poate evolua la
  `/live` + `/ready` separat in PR-10.
