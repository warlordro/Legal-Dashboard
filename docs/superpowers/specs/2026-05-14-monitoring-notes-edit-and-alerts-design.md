# Notite editabile per job de monitorizare + propagare in alerte — Design

**Data:** 2026-05-14
**Target release:** v2.27.0
**Branch:** `feat/monitoring-notes-edit`

## Obiectiv

Permite utilizatorului sa editeze notita atasata unui job de monitorizare existent (limita 200 caractere) si sa vada notita in randul de alerta cand alerta provine din job-ul respectiv. Notita e "post-it" personal — context pentru utilizator ("client VIP", "scadenta pe X", "contestat la apel").

## Scope

Per discutie cu user:
- **Storage**: refoloseste `monitoring_jobs.notes` deja existenta (TEXT nullable).
- **Limita**: 200 caractere (jos de la 2000 actual). Suficient pentru un memo si protejeaza layout-ul actual de display (italic truncate 420px).
- **Vizibilitate**: doar in pagina `/monitorizare` (editor + display existent) si in cardurile din pagina `/alerte`. **NU** in toast-uri desktop / notificari OS (tight pe spatiu, ar zgomotui).
- **Live read**: editarea notes-ului dupa ce alerta a fost emisa actualizeaza imediat afisajul in pagina `/alerte`. Fara denormalizare, fara snapshot.

## Ce exista deja (NU se reconstruieste)

- `monitoring_jobs.notes TEXT` — `backend/src/db/migrations/0003_monitoring_core.up.sql:40`
- Zod: `notes: z.string().max(2000).optional()` pe Create + `.nullable().optional()` pe Patch — `backend/src/schemas/monitoring.ts:93,134`
- Repository: PATCH suporta `notes` — `backend/src/db/monitoringJobsRepository.ts:261-263`
- Tip UI: `job.notes` exista in API response (fara modificare)
- UI display read-only sub target — `frontend/src/pages/Monitorizare.tsx:587-594`
- Form de creation cu input `notes` — `frontend/src/components/monitoring/MonitoringAddForm.tsx:30,53,70,221`
- Bulk import CSV/XLSX cu coloana `notes` — `frontend/src/components/monitoring/MonitoringBulkImportCard.tsx:89,94,132,163`

## Ce se construieste

### Backend

1. **Tighten zod max 2000 → 200** in `backend/src/schemas/monitoring.ts:93` si `:134`. Mesaj de eroare clar romana: `"Notita maxim 200 caractere"`. Pentru intrarile existente >200 nu modificam, doar la write blocheaza.
2. **Expune `job_notes` in listAlerts** — `backend/src/db/monitoringAlertsRepository.ts:357-360`. Extinde SELECT cu `j.notes AS job_notes` si tipul `MonitoringAlertRow` cu `job_notes?: string | null`. LEFT JOIN-ul exista deja; nu trebuie schema noua.
3. **Tests**:
   - Contract: PATCH cu notes=201 chars → 400 INVALID_PARAMS.
   - Contract: PATCH cu notes=200 chars → 200 OK, persistenta verificata.
   - Listing: GET /alerts pentru un job cu notes setat returneaza `job_notes` populat.
   - Owner isolation: PATCH pe job-ul altui owner → 404.

### Frontend

4. **Inline editor pe randul Monitorizare** — `frontend/src/pages/Monitorizare.tsx:587-594`. Cand userul face click pe `job.notes` (sau pe un buton "+ Adauga notita" cand e null), randul se transforma intr-un `<textarea maxLength={200}>` cu counter (`{n}/200`) + butoane "Salveaza" / "Anuleaza". Save trimite PATCH `/api/v1/monitoring/jobs/:id` body `{ notes: string | null }`.
5. **API client** — `frontend/src/lib/api.ts` sau `monitoring.ts` helper: `monitoring.updateNote(jobId, notes)` care wraps PATCH-ul. Optimistic update local state + rollback la eroare. Erorile envelope (din PR-6) randate via `extractErrorMessage`.
6. **Display in carduri alerte** — `frontend/src/pages/Alerts.tsx` (sau componenta `AlertCard`). Cand `alert.job_notes` exista, randeaza un bloc discret sub corpul alertei: `border-l-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs italic` cu prefix vizual "Notita: ".

### Release

7. **Bump v2.26.0 → v2.27.0** in: `package.json` x3 + `package-lock.json`, `CHANGELOG.md`, `frontend/src/data/changelog-entries.tsx`, `README.md`, `STATUS.md`, `DOCUMENTATIE.md`, `CLAUDE.md`, `SESSION-HANDOFF.md`. Biome pass pe toate fisierele atinse.

## Out of scope (explicit)

- Toast / desktop notification: NU. Notita ramane in surface UI.
- Snapshot al notes-ului la momentul alertei: NU. Read live, mai simplu.
- Migration: NU. Coloana exista, doar tighten limit la write.
- Modificare valorilor existente >200 chars: NU. Read-only valid; write nou trebuie ≤200.
- Cautare full-text in notes (filter alerte dupa note content): NU. Backlog daca user o cere.
- API public expose la `notes` din job (PATCH separat /notes endpoint): NU. PATCH-ul generic existent este suficient.

## Riscuri / open questions

- **CRLF in textarea**: Windows line endings dubleaza chars. Counter UI trebuie sa numere code points (`[...str].length` sau `.replace(/\r\n/g, "\n").length`), zod count pe `.length` (UTF-16 unit). Cele doua pot diverge pentru emoji-uri — acceptat (notite practic ascii).
- **Race condition pe save**: daca 2 tab-uri editeaza acelasi job, ultimul write castiga. Acceptat — uz mono-user desktop.
- **Backward compat**: notes existente >200 chars (din bulk import vechi) raman. UI le afiseaza intreg via truncate CSS, dar la deschiderea editor-ului textarea le va prezenta toate caracterele; la save zod le va respinge daca user nu le scurteaza. Decizie: ok, e responsabilitatea userului care a importat un note prea lung.

## Aliniere CLAUDE.md

- Repository-only DB access: respectat. Toate modificarile in `backend/src/db/**`.
- owner_id: scoped la owner pe toate read/write.
- Web-readiness: zero schimbari care leaga state-ul de un singleton. PATCH-ul ramane stateless.
- Envelope errors: 400 INVALID_PARAMS pe limit-overflow (din PR-6 deja in vigoare).
- Romana fara diacritice in cod, UI, commit messages.
