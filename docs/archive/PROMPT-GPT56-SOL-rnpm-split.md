# Prompt REVIEW catre GPT-5.6 Sol — Split RNPM per user (v2.43.0)

Review-only: Sol NU implementeaza si NU modifica nimic — verifica spec-ul si planul de
implementare contra codului real si raporteaza defecte. Copiaza blocul dintre linia de start
si linia de final, cu repo-ul `Legal Dashboard IF` ca workspace si branch-ul
`feat/v2.43.0-rnpm-split` checked out.

---- START PROMPT ----

<task>
Fa un REVIEW ADVERSARIAL, READ-ONLY, al unui design + plan de implementare pentru aplicatia
Legal Dashboard (Electron + web; backend Node 22 + Hono + better-sqlite3; frontend React 18 + Vite).
NU implementezi nimic, NU modifici niciun fisier, NU faci commit — doar citesti si raportezi.

Documentele de revizuit (ambele comise pe branch-ul curent `feat/v2.43.0-rnpm-split`):
1. `docs/superpowers/specs/2026-07-10-rnpm-split-per-user-design.md` — design-ul aprobat:
   fiecare user primeste propriul fisier SQLite `<dataDir>/rnpm/<ownerId>.db` pentru modulul RNPM;
   restul aplicatiei ramane in baza unica; splitter one-time la boot; backup/restore self-service
   per user; router admin nou pentru baza unica.
2. `docs/superpowers/plans/2026-07-10-rnpm-split-per-user.md` — planul de implementare derivat:
   10 task-uri TDD cu cod complet (SQL baseline consolidat, module noi, modificari punctuale,
   teste, comenzi, commit-uri).

Context util: `CLAUDE.md` din radacina (conventiile proiectului). Codul real din `backend/src/**`
si `frontend/src/**` este REFERINTA — orice afirmatie din plan despre cod se verifica acolo.

Obiectivul review-ului: gaseste tot ce ar face implementarea sa esueze, sa piarda date sau sa
introduca regresii — INAINTE ca planul sa fie executat.
</task>

<grounding_rules>
- Fiecare finding se ancoreaza in dovezi: citeaza fisier:linie din codul real si/sau task-ul +
  step-ul exact din plan. Fara "mi se pare" — verifica cu fisierul deschis.
- Verifica afirmatiile factuale ale planului contra codului: semnaturile functiilor si liniile
  call-site-urilor enumerate (avizRepository.ts, searchRepository.ts), fluxul din backup.ts,
  comportamentul runner-ului de migrations (runner.ts), blocul ownership din rnpmSearchService.ts,
  rutele din rnpm.ts, structura Settings.tsx. Daca planul citeaza gresit codul, e finding.
- Verifica SQL-ul baseline-ului consolidat din Task 1 coloana cu coloana contra migrations reale
  0001_baseline.up.sql + 0021 + 0022 (o coloana lipsa sau un index uitat = finding CRITICAL).
- NU inventa probleme: daca nu ai dovada concreta, nu raporta. Ipotezele se marcheaza explicit
  "IPOTEZA" cu ce ar trebui verificat ca sa fie confirmate.
</grounding_rules>

<dig_deeper_nudge>
Ataca in mod special zonele cu cel mai mare risc:
1. SIGURANTA DATELOR in splitter (plan Task 4): ordinea operatiilor, idempotenta la crash in
   fiecare punct (inainte/dupa rename, inainte/dupa DELETE din monolit), corectitudinea copierii
   subsetului rnpm_bunuri_descrieri cu id-urile originale, comportamentul ATTACH readonly
   (URI `file:...?mode=ro` cu better-sqlite3 pe Windows — chiar functioneaza?), interactiunea cu
   trigger-ele _norm la INSERT...SELECT, sqlite_sequence dupa insert cu id explicit.
2. backup.ts multi-target (Task 6): edge-case-urile deja rezolvate in codul actual (orphan tmp,
   sidecars WAL/SHM, auto-revert, freshness guard, retention pe pool-uri disjuncte) — planul le
   pastreaza pe TOATE per target? Pool-ul nou `manual-` intra in conflict cu regex-ul
   pre-migration `pre-(?!restore-)` sau cu DATED_BACKUP_RE?
3. Gardul race restore-vs-search (Task 5): acopera si executeBulkSearch? Exista alte cai de
   scriere RNPM in afara celor trei functii (ex. filter, delete-batch, load-more SSE) care ar
   trebui gardate sau care pot rula in timpul unui restore?
4. Schimbarea de contract ownership (Task 3): ce se strica in consumatorii existenti ai starii
   "foreign" (teste, rute, servicii)? Cauta toate referintele.
5. Boot ordering (Task 4 wiring): pozitia apelului runRnpmSplitIfNeeded() in index.ts fata de
   getDb()/migrations/scheduler.start()/serve() — exista vreo cale in care scheduler-ul sau o
   ruta atinge datele RNPM inainte de split?
6. Bundling/build: directorul nou migrations-rnpm/ e copiat corect in dist-backend (scripts/build.js)?
   Pattern-ul __dirname in CJS pentru MIGRATIONS_RNPM_DIR functioneaza in bundle-ul esbuild?
7. Teste: lista suitelor pe care planul le declara afectate e completa? (grep LEGAL_DASHBOARD_DB_PATH
   si `new Database(` in backend/src/**/*.test.ts si compara cu ce enumera planul).
8. Windows/Electron: file locking la rename/unlink pe fisierele per-user (AV), inchiderea
   handle-urilor la shutdown (markRnpmShuttingDown in gracefulShutdown + before-quit Electron).
9. Securitate self-service (Task 7): jail-ul backups/rnpm/<ownerId>/ e etans (validare ownerId +
   nume fisier)? Scoaterea requireDesktopHeader de pe rutele rnpm-backup lasa vreo gaura in mod
   desktop (CSRF)? resolveBackupOwner permite escaladare pentru non-admin?
10. Contradictii spec vs plan: orice punct unde planul livreaza altceva decat spune spec-ul.
</dig_deeper_nudge>

<structured_output_contract>
Raporteaza EXACT in formatul:

1. VERDICT GENERAL (o linie): READY / READY-WITH-FIXES / NOT-READY + o fraza de motivare.

2. FINDINGS — tabel ordonat dupa severitate, cu coloanele:
   | # | Severitate (CRITICAL/HIGH/MEDIUM/LOW) | Unde (task+step din plan si/sau fisier:linie din cod) | Problema (concret: ce se intampla si cand) | Fix propus (concret, aplicabil in plan) |
   CRITICAL = pierdere/corupere de date sau plan neexecutabil; HIGH = bug functional sau gaura de
   securitate; MEDIUM = regresie probabila sau test gap; LOW = calitate/claritate.

3. AFIRMATII VERIFICATE — lista scurta a claim-urilor factuale din plan pe care le-ai verificat
   contra codului si au iesit CORECTE (max 10, cele mai importante), cu fisier:linie.

4. INTREBARI DESCHISE — doar daca exista puncte pe care nu le-ai putut verifica read-only.

Fara proza suplimentara, fara rezumat al documentelor, fara laude. Concizie maxima per finding.
</structured_output_contract>

<action_safety>
- STRICT READ-ONLY: nicio modificare de fisier, niciun commit, niciun push, nicio instalare de
  dependinte, niciun test rulat care scrie in afara directoarelor temporare. Poti rula comenzi
  de citire (grep, cat, git log/diff) si type-check (`npx tsc --noEmit -p backend/tsconfig.json`)
  daca ajuta verificarea — nimic altceva.
- NU atinge fisierele untracked din radacina si NU schimba branch-ul.
</action_safety>

---- FINAL PROMPT ----
