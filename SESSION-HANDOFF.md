# Session Handoff — PR-5 in lucru (3/6 commits livrate)

**Data**: 2026-04-29
**Branch activ**: `feat/pr5-name-lists-bulk` (NU pe `main`)
**Branch parinte**: `main` la `9af559b` (docs sync v2.3.0)
**Push status**: branch local — nu este push-uit la origin
**Versiune target**: `v2.4.0` (PR-5 livrabil)
**Test count curent**: **413 backend** (era 357 dupa v2.3.0; +56 din PR-5 commits 1-3)

---

## TL;DR pentru sesiunea noua

PR-5 (bulk name lists + `name_soap` runner) este in lucru. Din 6 commits planificate, **3 sunt livrate si testate**:

| # | Commit | Hash | Ce livreaza | Teste |
|---|--------|------|-------------|-------|
| 1 | Migration 0006 + repository | `046fb66` | `name_lists`, `name_list_items`, FK invers `monitoring_jobs.name_list_id`, `nameListsRepository` complet | +15 (372 total) |
| 2 | Parser XLSX + CSV | `ffc8ba7` | `nameListParser` cu validation/dedup + deps `xlsx@0.18.5` + `csv-parse@^5.6.0` | +24 (396 total) |
| 3 | Rute `/preview` + `/commit` | — | `nameListsRouter` (preview multipart + commit JSON), `validateRawItems` re-validation, autoCreateJobs sync cu cap 100 + lineage `name_list_id` | +17 (413 total) |
| 4 | `nameSoapRunner` + scheduler dispatch | — | **URMATORUL** | — |
| 5 | UI pagina bulk import | — | pending | — |
| 6 | k6 harness bulk import | — | pending | — |

Ambele commits trec `npx tsc --noEmit -p backend/tsconfig.json` si `npm test --workspace=backend`.

Inainte sa scrii cod nou, citeste sectiunea **Decizii inchise** (mai jos) — sunt deja luate, nu le re-deschide.

---

## Stare Git

```
ffc8ba7 (HEAD -> feat/pr5-name-lists-bulk) feat(monitoring): nameListParser XLSX+CSV (PR-5 commit 2/6)
046fb66 feat(monitoring): migration 0006 + nameListsRepository (PR-5 commit 1/6)
9af559b (origin/main, main) docs: sync v2.3.0 across all maintained .md files
d02222c docs(changelog): expand v2.3.0 — bidirectional self-heal + worker breadth
854a675 feat(migrations): bidirectional CRLF self-heal + observability + .gitattributes
```

Branch nu e push-uit la origin inca. Push-ul se face cand toate cele 6 commits sunt gata si suite-ul full trece (sau cand sesiunea noua decide intermediar).

Working tree: clean.

---

## Ce este livrat in commits-urile curente

### Commit 1/6 — Migration 0006 + repository (`046fb66`)

**Fisiere:**
- `backend/src/db/migrations/0006_name_lists.up.sql` — schema noua
- `backend/src/db/migrations/0006_name_lists.down.sql` — manual rollback
- `backend/src/db/nameListsRepository.ts` — CRUD owner-scoped
- `backend/src/db/nameListsRepository.test.ts` — 15 teste

**Schema adaugata:**
- `name_lists` cu `UNIQUE(owner_id, source_sha256)` → re-upload idempotent
- `name_list_items` cu FK `list_id REFERENCES name_lists(id) ON DELETE RESTRICT` (Constatare adversiala #6)
- `monitoring_jobs.name_list_id` — FK invers `REFERENCES name_lists(id) ON DELETE RESTRICT`, nullable (joburile existente nu sunt rupte)
- Indexuri: `idx_name_lists_owner`, `idx_nli_owner_list`, `idx_nli_norm`, `idx_nli_job` (partial WHERE NOT NULL), `idx_mj_name_list` (partial WHERE NOT NULL)

**Decizie schema**: `name_kind` CHECK lista DOAR `'fizic'`/`'juridic'`, NU si `'unknown'` (specul §2.3 mentiona 3-value, dar zod `TargetNameSoap.name_kind` din [backend/src/schemas/monitoring.ts:40](backend/src/schemas/monitoring.ts#L40) e doar 2-value; runner-ul name_soap nu poate construi un target valid din `'unknown'`). Vezi sectiunea Decizii inchise.

**Repository surface:**
- `createList(input)` — tranzactie BEGIN IMMEDIATE; replay pe sha256 returneaza `{duplicate: true}`.
- `listLists` / `listItems` — paginate, owner-scoped, `listLists` exclude archived by default.
- `getCommittableItems(ownerId, listId)` — ok+warn unlinked → input pentru /commit.
- `linkItemToJob` — idempotent (primul linker castiga; retry no-op).
- `archiveList` — soft-delete cu `blockingJobs` guard (refuza daca exista joburi care refera lista; RESTRICT-aware fara sa arunce FK error).

### Commit 2/6 — nameListParser XLSX + CSV (`ffc8ba7`)

**Fisiere:**
- `backend/src/services/nameListParser.ts` — parser unificat XLSX+CSV
- `backend/src/services/nameListParser.test.ts` — 24 teste
- `backend/package.json` — deps adaugate
- `package-lock.json` — lockfile sync

**Deps backend (NOI):**
- `xlsx@0.18.5` — match versiune frontend (audit plan #1: pin + plafon strict)
- `csv-parse@^5.6.0` — sync API pentru parsing CSV

**Capuri (audit plan 2026-04-29 #1):**
- `MAX_FILE_BYTES = 10 MB` (verificat inainte de parse)
- `MAX_ROWS = 50_000`
- `MAX_COLS = 20`
- `MAX_NAME_LEN = 200`, `MIN_NAME_LEN = 2`

**Format detection:** zip magic bytes (`PK\003\004`) → XLSX; orice altceva → CSV. Filename e doar hint, magic bytes castiga (cazul "user a redenumit `.csv` → `.xlsx`" gestionat).

**Surface public:**
- `parseNameList(buf, opts) → ParseResult { rows, totals, sha256 }` — entry point principal
- `normalizeName(s) → string` — lowercase + diacritic strip + collapse whitespace (exportat pentru reutilizare in routes/runner)
- `ParseError` — typed error cu `code: ParseErrorCode`

**Validation rules implementate (PLAN §5.2 L460-464):**
- reject: nume gol, < 2 chars (post-normalize), > 200 chars (raw), doar cifre
- warn: tip lipsa/gol/necunoscut → default `'fizic'`
- warn: duplicate intra-fisier pe `(name_normalized, name_kind)` → primul ramane ok, restul `'duplicate_in_file'`

**Sinonime header acceptate (toleranta input):**
- `nume` ← "nume", "name", "denumire"
- `tip` ← "tip", "categorie", "kind"
- `cnp` ← "cnp"
- `cui` ← "cui", "cif"

CSV separator auto-detect: `,` sau `;` (Excel ro-RO export).

---

## Decizii inchise (NU le re-deschide)

### 1. `name_kind` enum: 2-value, NU 3-value

PLAN §2.3 L231 mentiona `CHECK(name_kind IN ('fizic','juridic','unknown'))`. Implementarea foloseste DOAR `'fizic'`/`'juridic'`.

**Motiv:** [backend/src/schemas/monitoring.ts:40](backend/src/schemas/monitoring.ts#L40) `TargetNameSoap.name_kind` e zod enum 2-value (definit in PR-3, neschimbat). Runner-ul `name_soap` nu poate construi target valid din `'unknown'`. Adaugarea `'unknown'` in DB ar produce drift permanent (DB accepta valori pe care alta cale le respinge).

**Workaround pentru tip lipsa:** parser-ul seteaza `name_kind = 'fizic'` cu `validation = 'warn'` + `validation_msg = 'tip_lipsa (presupus fizic)'`. User-ul vede explicit pe preview ca a primit default.

### 2. `cautareDosare` reutilizat, NU noua functie SOAP

PLAN §5.2 L445 zice `cautareDosareDupaParte({nume, institutie?})`. Verificare cod: [backend/src/soap.ts:182](backend/src/soap.ts#L182) `cautareDosare(params, options)` accepta deja `params.numeParte` ca camp (folosit din [routes/dosare.ts:66](backend/src/routes/dosare.ts#L66) si [routes/termene.ts:61](backend/src/routes/termene.ts#L61)).

**Decizie:** runner-ul `name_soap` (commit 4) va apela `cautareDosare({ numeParte: nameRaw, institutie: ... })` direct, fara wrapper nou. Numele de functie din spec e o eroare in spec, NU in cod.

### 3. xlsx@0.18.5 in backend (audit accepta)

xlsx 0.18.5 are CVE-uri cunoscute (prototype pollution + ReDoS). [AUDIT-REMEDIATION-PLAN-2026-04-29.md](AUDIT-REMEDIATION-PLAN-2026-04-29.md) §11: *"pentru xlsx evaluare exceljs ca migrare (sau pin + plafon strict pe rows/cols la import)"*. Strict caps sunt mitigarea documentata. PR-5 IS exact unde caps-urile se aplica (10MB / 50000 rows / 20 cols).

**Migrare la `exceljs`** ramane in roadmap pentru PR-7+; nu e blocker pentru PR-5.

### 4. xlsx-js-style **NU** ales (a fost considerat)

Frontend foloseste `xlsx-js-style` (fork pentru styling). Backend foloseste `xlsx` (sheetjs original). Diferenta: backend doar CITESTE, frontend si CITESTE si EXPORTA (cu styling). Pe import, `xlsx` standard e suficient si match-uieste API-ul mai bine (sheet_to_json cu header:1).

---

## Decizii inchise in commit 3/6

### A. Stateless preview/commit (opt 4 din decizii)
`/preview` returneaza FULL rows array (~10MB JSON in flight); `/commit` primeste `{title, sourceFilename, sourceSha256, items[], autoCreateJobs?, maxJobs?}` si re-aplica validation pe server via `validateRawItems()`. Niciun cache server-side. Defense-in-depth: clientul nu poate ocoli regulile flag-uind items 'rejected' ca 'ok'.

### B. Auto-create jobs sync cu cap 100/cerere
`autoCreateJobs=true` pe `/commit` creeaza pana la `maxJobs` (default 100, max 100) joburi `name_soap` in tranzactie unica. Cand `jobsTotal > maxJobs`, returneaza `partial: true` — UI re-trimite cererea (idempotent prin sha256 → `duplicate=true`) iar `getCommittableItems` filtreaza `monitoring_job_id IS NULL` deci batch-ul urmator consuma items inca nelegate. Joburile auto-create-d primesc `name_list_id` pentru lineage (folosit de `archiveList` + UI inverse joins).

### C. Body limits dedicate
`/preview` — 10 MB (match parser `MAX_FILE_BYTES`). `/commit` — 15 MB JSON (acomodeaza 50000 × ~200B + JSON overhead). Per-item cap pe `nameRaw` la 200 chars (zod) impiedica payload-uri patologice 50000 × 5KB. Rate limit global aplicat deja la `/api/*` (30 req/min per IP+ownerId).

### D. Audit shape pentru commit 3
- `monitoring.name_list.created` — un rind, doar pe insert nou (replay sha256 NU emite). Detail: title, sha256, total/valid rows.
- `monitoring.name_list.committed` — un rind per cerere cu `autoCreateJobs=true`, NU unul per job (bulk audit). Detail: jobs_created, jobs_attempted, jobs_total, partial.

---

## Decizii deschise (de luat in commit 4 — nameSoapRunner + scheduler dispatch)

### A. Stateful vs stateless preview/commit (livrat: opt 4 stateless)

Spec §5.2 L437-444:
- `/preview` parseaza fisierul, returneaza JSON, **NU persista nimic**.
- `/commit` primeste `{title, sha256, only_validations}` — NU re-trimite fisierul.

Asta implica server cache parse intre cereri (keyed by sha256, TTL ~10 min). Stateful, NU sopravietuieste restart.

**Trei optiuni:**

1. **Cache in-memory (Map<sha256, ParseResult> cu TTL)** — desktop OK, web mode (PR-9) va trebui inlocuit cu Redis/etc.
2. **Re-upload pe commit** (divergenta de la spec) — stateless, dublu I/O.
3. **Persist preview cu marker `archived_at='preview-pending'`** — DB ca cache; cleanup task purge dupa 24h. Foloseste deja UNIQUE(owner_id, source_sha256) ca idempotency.

**Recomandat (de validat la inceputul sesiunii noi):** opt 3 — DB-backed preview, mai simplu si mai aliniat cu setup-ul existent. UI vede listele cu `validation` filter pana la commit.

**Sau opt 4 (cea mai simpla):** `/preview` returneaza FULL rows array (50000 × ~200B = ~10MB JSON in flight, OK); `/commit` primeste `{title, sourceFilename, sourceSha256, items: [...]}` si re-valideaza pe server. Stateless, niciun cache. Server re-aplica regulile (defense-in-depth: client nu poate ocoli flag-uri schimband JSON-ul).

Nota despre opt 4: parser-ul deja exporta `CreateListItemInput` ca shape al items-ului; `/commit` re-aplica `parseNameList`-style validation pe items dupa ce verifica sha256 in DB sau accepta items as-is.

### B. Auto-create jobs pe /commit?

Spec §5.2 step 5: "Optional: `auto_create_jobs:true`". Throttle: max 100 joburi noi/cerere; restul async background.

**Sub-decizii:**
- Sync sau async dispatch?
- Daca async, queue table sau scheduler in-process?

**Recomandat:** sync, max 100 joburi in tranzactie unica. Daca itemi > 100, returnam `partial: true` cu lista de itemi remaining; client face urmatorul commit cu offset. Mai simplu decat un queue separat, fara nevoie pentru tabela noua.

### C. Body limits pentru rute noi

Trebuie sa adaug rate limit + body size limit pe `/preview` (multipart 10MB) si `/commit` (JSON 10-15MB). Existing middleware: [backend/src/middleware/rate-limit.ts](backend/src/middleware/rate-limit.ts).

---

## Comenzi practice pentru sesiunea noua

### Setup mediu

```bash
git checkout feat/pr5-name-lists-bulk
git log --oneline -5  # confirm: ffc8ba7, 046fb66, 9af559b...
npm install --workspace=backend  # daca e prima ruta
```

### Verificare ca tot trece inainte sa atingi cod

```bash
npx tsc --noEmit -p backend/tsconfig.json
npm test --workspace=backend  # asteapta 396 pass / 24 files
```

### Daca better-sqlite3 ABI greseste (post electron:dev)

```bash
npm rebuild better-sqlite3   # → Node ABI 137 pentru vitest
# DUPA teste, inainte de electron:dev:
npm run rebuild:electron     # → Electron ABI 145
```

Documentat in [CLAUDE.md](CLAUDE.md) sectiunea Comenzi.

### Workflow pentru commit 3 (rute /preview + /commit)

1. **Citeste primul** [PLAN-monitoring-webmode.md](PLAN-monitoring-webmode.md) §5.2 (L429-466) pentru full flow.
2. **Decide A + B + C** (vezi sectiunea Decizii deschise) inainte de orice cod. Recomandat: opt 4 (stateless preview/commit) + sync auto-create jobs cu cap 100.
3. Creaza `backend/src/routes/nameLists.ts` cu Hono router.
4. Mount in [backend/src/index.ts](backend/src/index.ts) (cauta unde sunt mount-ate alte rute monitoring).
5. Adauga zod schemas pentru body in [backend/src/schemas/monitoring.ts](backend/src/schemas/monitoring.ts) sau fisier nou `nameLists.ts`.
6. Teste pe rute (mirror pattern din `backend/src/routes/monitoring.test.ts` daca exista — sau fa unul nou).
7. Type-check + tests + commit cu mesaj `feat(monitoring): /preview + /commit routes (PR-5 commit 3/6)`.

### Workflow pentru commit 4 (nameSoapRunner + scheduler dispatch)

1. Citeste [backend/src/services/monitoring/dosarSoapRunner.ts](backend/src/services/monitoring/dosarSoapRunner.ts) pentru pattern (DI cu `searchDosare`, `withMaintenanceRead` pentru DB writes, AbortSignal handling).
2. Creaza `backend/src/services/monitoring/nameSoapRunner.ts` care:
   - Apeleaza `cautareDosare({ numeParte: target.name_normalized })` (vezi Decizia inchisa #2).
   - Captura imbogatita varianta B per spec L446 — `{version, fetched_at, dosare: [{numar, stadiu, categorie, instanta}]}`.
   - Diff per `numar`: `dosar_new`, `dosar_disappeared`, `stadiu_changed`, `categorie_changed` + `dosar_relevant_now` / `dosar_no_longer_relevant` daca filtre `alert_config.stadii`/`categorii` set.
   - Dedup key: `${kind}|${numar}|${tranzitie}` (spec L453).
   - Cap snapshot 1MB → emit `source_error` cu `code: 'SNAPSHOT_OVERSIZE'`.
   - Filtrele aplicate la **emit time**, nu la save (spec L455).
3. In [backend/src/index.ts](backend/src/index.ts) bootstrap, adauga:
   ```ts
   const nameSoapRunner = createNameSoapRunner({ searchDosare: cautareDosare });
   const scheduler = new Scheduler({
     ...
     runners: { dosar_soap: dosarSoapRunner, name_soap: nameSoapRunner },
   });
   ```
4. Teste runner mirror [backend/src/services/monitoring/dosarSoapRunner.test.ts](backend/src/services/monitoring/dosarSoapRunner.test.ts).
5. Verify `MONITORING_DISABLED_KINDS=name_soap` kill switch functioneaza fara modificari (deja gestionat de `claimDueJobs.enabledKinds` + `getDisabledMonitoringKinds`).

---

## Verificari pentru new session inainte de cod

### Confirma stari critice

```bash
# Stare branch
git branch --show-current   # → feat/pr5-name-lists-bulk
git log --oneline -3        # → ffc8ba7, 046fb66, 9af559b

# Stare working tree
git status -s               # → empty (clean)

# Verify deps adaugate
grep -A2 dependencies backend/package.json  # → vezi xlsx + csv-parse

# Verify migration prezent
ls backend/src/db/migrations/0006_name_lists.*  # → up.sql + down.sql
```

### Confirma test count

```bash
npm test --workspace=backend
# Expect: Test Files 24 passed (24), Tests 396 passed (396)
```

Daca testele esueaza cu `NODE_MODULE_VERSION` mismatch: `npm rebuild better-sqlite3` (vezi sectiunea Comenzi practice).

---

## Linkuri rapide

- Master spec PR-5: [PLAN-monitoring-webmode.md §5.2](PLAN-monitoring-webmode.md) (L429-466)
- DDL spec: [PLAN-monitoring-webmode.md §2.3](PLAN-monitoring-webmode.md) (L195-247) — note: implementarea livrata difera in `name_kind` enum, vezi Decizii inchise #1
- Roadmap: [EXECUTION-ROADMAP.md](EXECUTION-ROADMAP.md) — PR-5 entry, target v2.4.0
- Audit ce a generat caps-urile xlsx: [AUDIT-REMEDIATION-PLAN-2026-04-29.md](AUDIT-REMEDIATION-PLAN-2026-04-29.md) §11
- Pattern reference (dosar_soap runner): [backend/src/services/monitoring/dosarSoapRunner.ts](backend/src/services/monitoring/dosarSoapRunner.ts)
- Pattern reference (route layer monitoring): [backend/src/routes/monitoring.ts](backend/src/routes/monitoring.ts)
- Auto-memory PR-5 status (in `~/.claude/projects/.../memory/`): vezi MEMORY.md indexul

---

## Note operationale

- **NU** push la origin pana sesiunea nu confirma cele 6 commits sunt complete.
- Branch-ul ramane separat pana cand PR-5 e gata complet; merge in main face un commit de release `v2.4.0`.
- Daca sesiunea decide sa schimbe abordarea (ex: stateful preview), creaza un commit de backout pentru a nu pierde contextul.
- Cand termini PR-5, **actualizeaza versiunea peste tot** (vezi `feedback_version_bump_docs` in MEMORY.md): `package.json` x3, README, CLAUDE.md, CHANGELOG, STATUS, EXECUTION-ROADMAP, SESSION-HANDOFF (acest document), HARDENING, PLAN-monitoring-webmode, SECURITY, frontend changelog-entries.tsx.
