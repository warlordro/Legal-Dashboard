# Plan â€” Handoff Codex pentru continuarea dezvoltarii Legal Dashboard

> **Status**: draft v1.0, 2026-05-01 (post-v2.6.8)
> **Audienta**: agent Codex (sau orice agent succesor cu acces la repo).
> **Scop**: oferi un onboarding scurt, dur si executabil ca agentul sa preia munca fara sa rupa nimic, sa respecte conventiile proiectului si sa stie cand sa foloseasca tools/skills externe.
> **Limba documentului**: romana fara diacritice (vezi Â§2 conventii).

---

## 0. TL;DR â€” primele 5 actiuni cand preiei

1. **Citeste** in ordine: `CLAUDE.md`, `SESSION-HANDOFF.md`, `EXECUTION-ROADMAP.md` (sectiunea PR curent), `SECURITY.md`, acest plan.
2. **Verifica build curat**: `npx tsc --noEmit -p backend/tsconfig.json` + `cd frontend && npx tsc --noEmit` + `npm test --workspace=backend`. Trebuie verzi de la inceput.
3. **Porneste app-ul local**: scrub `ELECTRON_RUN_AS_NODE` din env (vezi Â§6 pitfalls), apoi `npm run electron:dev`. Verifica ca backend-ul porneste pe `:3002`, scheduler-ul scrie linii in stdout, fereastra Electron deschide Dashboard-ul.
4. **Identifica task-ul curent**: `git status` + ultima sectiune din `SESSION-HANDOFF.md` ("TL;DR sesiune curenta"). Daca user-ul ti-a dat task explicit in prompt â€” acela are prioritate.
5. **Nu deschide PR-uri si nu da `git push` fara confirmare explicita.** Comiti local OK; push-ul cere autorizare.

---

## 1. Stare curenta (snapshot la 2026-05-01)

| Camp | Valoare |
|------|---------|
| Versiune curenta | **v2.6.8** |
| Branch principal | `main` |
| Status push | up-to-date cu `origin/main` la `8e0eaa6` (v2.6.8) |
| Tag-uri pe main | local: v2.0.10, v2.1.0, v2.1.1, v2.2.0, v2.3.0, v2.4.0, v2.4.1, v2.4.2, v2.5.0, v2.5.1, v2.6.0..v2.6.8. Remote: v2.6.5..v2.6.8 necesita push explicit/confirmare. |
| Sprint activ | monitoring + web mode (PR-0..PR-12) |
| PR-uri livrate | PR-0..PR-8 + patches v2.6.1..v2.6.8 |
| PR-uri pendinte | **PR-9 Auth pluggable (desktop noop / web SSO)** â€” next, vezi `EXECUTION-ROADMAP.md` |
| Tests | 546/546 vitest backend (v2.6.4 â†’ v2.6.8 nu a adaugat tests noi) |
| Stack | Electron 41 + Hono backend (port 3002) + better-sqlite3 + React 18 + Vite + Tailwind |

**Documentele de adevar** (in ordine de prioritate):
1. `CLAUDE.md` (root proiect) â€” context permanent + roadmap inalt nivel.
2. `EXECUTION-ROADMAP.md` â€” DoD per PR; **citeste sectiunea PR curent inainte de orice cod**.
3. `SESSION-HANDOFF.md` â€” context transfer intre sesiuni; ultima sesiune e top.
4. `PLAN-monitoring-webmode.md` â€” spec tehnic master pentru sprint-ul curent.
5. `SECURITY.md` â€” threat model, **toate schimbarile de securitate trec prin acest doc**.
6. `HARDENING.md` â€” fazat; L274-440 e SUPERSEDED (banner OBSOLETE), restul ramane relevant.
7. `STATUS.md` â€” readout uman pentru utilizator.
8. `CHANGELOG.md` â€” entries per release.
9. `frontend/src/data/changelog-entries.tsx` â€” in-app changelog (mirror-ul din `CHANGELOG.md`).

---

## 2. Conventii non-negociabile

### Limba & stil
- **Romana fara diacritice** in tot codul, comentariile, mesajele UI, doc-urile. Constraint legacy de la PortalJust SOAP â€” `s/t/a/i/A/T/I/S` cu sedila si breve nu sunt acceptate consistent. Nu introduce `Äƒ`, `Ã¢`, `Ã®`, `È™`, `È›`, `Ä‚`, `Ã‚`, `ÃŽ`, `È˜`, `Èš`.
- **Engleza in cod ramane OK** pentru identifieri si comments tehnici scurti â€” dar copy-ul UI e romana.
- **Mesaje user-facing** in romana fara diacritice, dar termeni tehnici universali raman in engleza (`status`, `error`, `timeout`, `OK`, `JSON`).

### Comments
- **Default zero comments.** Adaugi un singur comment cand WHY nu e evident (workaround pentru bug specific, invariant non-trivial, racing constraint).
- **Nu** scrie comments `// added for X`, `// used by Y`, `// fix for issue #N` â€” astea apartin in PR description / commit message.
- **Niciodata** nu scrii docstring multi-linie sau JSDoc bloc lung. Maxim o linie scurta.

### Cod
- **Repository-only DB access**: SQL raw doar in `backend/src/db/**`. Routes & services NU executa SQL direct.
- **`getOwnerId(c)`** peste tot la query / mutate. Niciun `'local'` hardcodat in cod nou (DEFAULT in DDL e OK).
- **Pagination offset-based** pe listari principale (`{ data, page, pageSize, total }`).
- **`async fs/promises`** in handlers. Niciun `readFileSync` / `execSync` in request path.
- **`AbortSignal`** peste tot la I/O extern (SOAP, HTTP, fetch). Timeout intern + signal propagat.
- **`clientRequestId` opt-in** pe mutations cand e useful (idempotency).
- **`Recharts`** pentru charts (deja in bundle).
- **`xlsx-js-style`** pentru WRITE export, **`exceljs`** pentru READ user input (decizia v2.6.4 â€” `xlsx@0.18.5` e bannit pe path-ul de parsare input).
- **Web Worker** pentru export-uri (deja avem `export.worker.ts`).
- **`cn()` helper** din `frontend/src/lib/utils.ts` pentru classes condiÈ›ionale (clsx + tailwind-merge).

### Stil entries noi in CHANGELOG / SESSION-HANDOFF / STATUS
- **Structured-section** (introdus consistent in v2.6.4+): subsections pe rol (Frontend / Backend / Docs / Style / Validare / Fisiere modificate / Risc), fiecare cu bullet-uri scurte.
- **NU monolite** â€” un paragraf de 5 randuri fara header-uri e OK doar pentru patches mici (3-line bug fix).
- **Risc/regression surface** ramane sectiune separata si onesta â€” daca nu exista risc, scrie "Zero â€” schimbari izolate la X".

### Test coverage
- Tests noi pentru orice ruta noua, orice mutation in repository, orice helper non-trivial.
- Tests existente trebuie sa ramana verzi. Daca rup un test, **fix root cause** sau actualizeaza test cu motivatie clara in commit message.
- Pattern: `describe('... PR-N', () => {...})` ca sa marchezi tests adaugate in PR-ul curent.

---

## 3. Workflow per task (rigid, nu sari pasi)

```
1. Read context        â†’ CLAUDE.md, EXECUTION-ROADMAP (PR curent), SESSION-HANDOFF, code in scope
2. Plan / brainstorm   â†’ daca task-ul e netrivial, foloseste skill superpowers:brainstorming
                         sau Agent Plan ca sa propui implementare inainte sa scrii cod
3. Spike (optional)    â†’ pentru integrari noi (lib, API extern), un mini-spike de 1-2 fisiere
4. Implement smallest  â†’ SLICE minima end-to-end (DDL + repo + route + UI + test)
5. Verify              â†’ tsc backend + frontend, vitest backend, build, smoke desktop
6. Bump version        â†’ patch sau feature; vezi Â§4
7. Update docs         â†’ CHANGELOG, STATUS, SESSION-HANDOFF, CLAUDE.md "Versiune Curenta",
                         EXECUTION-ROADMAP status line, frontend/src/data/changelog-entries.tsx
8. Commit              â†’ mesaj structurat (vezi Â§5); creezi commit local NUMAI
9. (Eventual) push     â†’ cere autorizare user; push-ul e in afara default-ului
10. Tag                â†’ la patch/release, daca user confirma; "git tag vN.N.N" + push tag
```

**Daca rupi pasul 5** (verificari), **NU** comiti. Repari. Daca nu poti repara, escalez user-ului cu citat de eroare.

---

## 4. Versionare

Schema **semver**:
- **Major (X.0.0)**: breaking change in DDL / API public / contracts. Doar la cutover-uri mari.
- **Minor (X.Y.0)**: feature drop nou (PR mare cu impact UX semnificativ).
- **Patch (X.Y.Z)**: bug fix, hardening, doc updates, refactor invizibil.

**Reguli**:
- Bump in **TOATE** locurile simultan: `package.json` (root, frontend, backend) + `CHANGELOG.md` (top-entry) + `STATUS.md` + `SESSION-HANDOFF.md` (TL;DR) + `CLAUDE.md` (Versiune Curenta) + `EXECUTION-ROADMAP.md` (header line) + `frontend/src/data/changelog-entries.tsx`.
- **Verifica cu Grep** pe versiunea veche dupa bump â€” nu ramane nici o referinta la versiunea anterioara in afara de istoricul changelog.
- **ReporneÈ™te Electron-ul** dupa bump â€” `__APP_VERSION__` se reinjecteaza la build/dev start.

**Tagging**:
- Format `vX.Y.Z` (cu prefix `v`).
- `git tag vX.Y.Z` LOCAL, push tag DOAR cu autorizare user (`git push origin vX.Y.Z`).
- Nu tag-ui inainte de commit-ul corespunzator.

---

## 5. Commit & push reguli

### Format mesaj commit
```
<tip>(<scope>): vX.Y.Z - <descriere scurta>

<corp paragraf scurt â€” what + why; nu what-step-by-step>

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

Tipuri: `feat`, `fix`, `patch`, `docs`, `refactor`, `test`, `build`, `chore`.

### Git safety (preluat din CLAUDE.md global)
- **NICIODATA** `--no-verify`, `--no-gpg-sign`, `--amend` pe commit-uri publicate.
- **NICIODATA** `git reset --hard`, `git push --force` pe `main` fara confirmare explicita.
- **NICIODATA** `git add -A` / `git add .` daca exista risc de a captura `.env` / fisiere mari / artefacte build.
- **DA** `git add <fisier>` explicit pe fiecare fisier modificat.

### Push
- Push DOAR la cerere explicita.
- Daca user spune "push", confirmi inainte ca destinatia e `origin/main` si ca nu e merge cu istoric impredictibil.

---

## 6. Pitfalls cunoscute (lessons learned din sesiunile anterioare)

### 6.1 `ELECTRON_RUN_AS_NODE` env leak
- **Simptom**: `npm run electron:dev` arunca `TypeError: app.requestSingleInstanceLock is not a function` (sau similar pe `app.whenReady`).
- **Cauza**: env var `ELECTRON_RUN_AS_NODE=1` ramasa setata in shell-ul curent (aplicatia ruleaza Electron in mod Node pur, fara `app` API).
- **Fix**: `Remove-Item Env:ELECTRON_RUN_AS_NODE` (PowerShell) sau `unset ELECTRON_RUN_AS_NODE` (bash) inainte de `npm run electron:dev`. Nu re-investiga, e fix cunoscut.

### 6.2 better-sqlite3 ABI lock intre Node & Electron
- **Simptom**: dupa rulat `npm test` din root, `npm run electron:dev` esueaza cu "node version mismatch" / "NODE_MODULE_VERSION mismatch".
- **Cauza**: `better-sqlite3` e compilat pentru ABI-ul Node 22; Electron 41 are alt ABI.
- **Fix**: `npm run rebuild:electron` (recompileaza pentru ABI-ul Electron). Inversul (re-Node) la `npm rebuild`.

### 6.3 CRLF / LF pe migrations
- Migrations sunt deja protejate via `migration runner self-heal bidirectional pe line endings` (v2.3.0). Nu modifica `.gitattributes` fara sa intelegi de ce â€” e setat ca `*.sql text eol=lf`.

### 6.4 Single-instance lock + safeStorage IPC
- Daca pornesti `npm run electron:dev` de doua ori in paralel, instanta a doua se inchide tacut (single-instance). Verifica `Get-Process electron` daca crezi ca-i deja deschis.
- safeStorage cere main process activ â€” nu poti testa decryptie din test-uri Node pure.

### 6.5 SOAP cancellation upstream lent
- PortalJust raspunde uneori in 30-60s. Avem timeout 90s + `AbortSignal` propagat. Nu reduce timeout-ul fara load-test pe orele de varf (10-12 dimineata).

### 6.6 RNPM gcode caching nu se face
- Empiric (2026-04-26): RNPM rejecta gcode reuse cross-search. Captcha-per-query e cost intrinsec API. Nu re-investiga.

### 6.7 Daily backup tmp file orphan
- Daily backup scrie la `.db.tmp` apoi rename atomic. Daca aplicatia crash-eaza in fereastra de scriere, ramane `.db.tmp` orfan. Cleanup-ul ruleaza la urmatorul start. Daca debug-ezi crash-uri, verifica `app.getPath('userData')` pentru orphan tmp.

---

## 7. Tools & skills â€” cand le folosesti

### Agent tool (subagents)
| Subagent | Cand il chemi |
|----------|---------------|
| `Explore` | cautare cross-codebase >3 query-uri ("unde e folosit X?", "ce fisiere au pattern Y?") |
| `Plan` | task netrivial, vrei plan de implementare cu trade-off-uri inainte sa scrii cod |
| `debug-investigator` | bug reproducibil greu, race condition, "merge pe masina mea" |
| `deep-code-reviewer` | review pre-merge la PR mare (>500 linii diff) |
| `repo-security-auditor` | review pe orice schimbare de auth/CSP/IPC/config sensibil |
| `audit-trail-reviewer` | schimbari pe `recordAudit()` / audit log / decision flow |
| `database-change-reviewer` | migration noua sau schimbari de schema |
| `release-readiness-reviewer` | inainte de tag major/minor cu impact production |
| `general-purpose` | cautare deschisa cand nu esti sigur |

**Reguli**:
- **Nu duplica munca**: daca subagent-ul cauta X, nu cauta tu in paralel acelasi X.
- **Briefing clar**: subagent-ul nu vede istoricul tau de conversatie. Trebuie sa-i dai context complet (ce fac, ce am incercat, ce vreau).
- **Foreground vs background**: foreground daca rezultatul lui blocheaza decizia ta urmatoare; background daca ai munca paralela.

### Skills (superpowers + bundled)
| Skill | Cand il invoki |
|-------|---------------|
| `superpowers:brainstorming` | la inceput de feature mare, vrei tradeoffs explorate |
| `superpowers:debugging` | bug greu, vrei rigor pe metoda diferentiala |
| `superpowers:tdd` | feature cu logic complexa, vrei test-first |
| `update-config` | schimbari in `.claude/settings.json`, hooks, permissions |

**Cand NU folosesti skills**: task simplu (fix typo, rename var, edit doc o linie). Skills sunt overhead â€” folosesti cand merita.

### MCP servers
- **`context7`**: documentatie up-to-date pentru biblioteci/SDK-uri (React, Electron, Hono, better-sqlite3, etc.). Foloseste **inainte** de a presupune API curent. Training-ul tau poate fi outdated.
- **`Supabase`**: NU folosit in proiectul asta (DB e SQLite local). Ignora.
- **`Vercel`**: NU folosit (deploy-ul e on-prem ZIP / Docker).
- **`Gmail`, `Google Calendar`, `Google Drive`, `Linear`, `Hugging Face`**: doar daca user cere explicit integrare cu serviciu extern.

### Bash & PowerShell
- **PowerShell** e shell-ul default pe Windows aici. `&&` / `||` NU functioneaza in PS 5.1 â€” foloseste `; if ($?) { ... }` sau Bash via tool.
- **Bash** e disponibil prin `Bash` tool â€” il folosesti pentru `git`, scripturi POSIX, `npm`.
- **Niciodata** nu pune `cd` la inceput de Bash command â€” working directory e deja setat.

---

## 8. Comenzi cheie (cheat-sheet)

```bash
# Dev
npm run electron:dev          # porneste Electron + backend in-process pe 3002
npm run dev:backend           # backend standalone (mod web dev)
npm run dev:frontend          # Vite pe 5173 (nu uita: backend trebuie pornit separat)

# Build
npm run build                 # frontend (Vite) + backend (esbuild â†’ CJS)
npm run dist                  # electron-builder Windows NSIS
npm run dist:server           # ZIP deployabil pe server (dist-backend + dist-frontend + Dockerfile)

# Verificari
npx tsc --noEmit -p backend/tsconfig.json     # type-check backend
cd frontend && npx tsc --noEmit               # type-check frontend
npm test --workspace=backend                  # vitest backend (target 546+ tests verzi)
npx biome check                               # lint + format

# Native rebuild (atentie: ABI Electron != Node)
npm run rebuild:electron      # recompileaza better-sqlite3 pentru Electron
npm rebuild                   # recompileaza pentru Node (necesar dupa rebuild:electron daca rulezi vitest)

# Operational
$env:MONITORING_DISABLED_KINDS = "dosar_soap,name_soap"  # kill switch scheduler
$env:LEGAL_DASHBOARD_ALLOW_REMOTE = "1"                  # opt-in LAN bind
$env:LEGAL_DASHBOARD_ACK_NO_AUTH = "1"                   # ack required pentru remote fail-closed
```

---

## 9. Checklist DoD per PR (canonic)

- [ ] Cod scris si idiomatic conform Â§2 conventii
- [ ] `npx tsc --noEmit` curat backend + frontend
- [ ] `npm test --workspace=backend` verde (546+ tests, plus tests noi pentru schimbarile aduse)
- [ ] `npm run build` curat
- [ ] Smoke desktop manual: pornit `npm run electron:dev`, ad-hoc test pe flow-ul afectat, zero erori in DevTools console
- [ ] `getOwnerId(c)` peste tot la query/mutate (zero `'local'` hardcoded in cod nou)
- [ ] Audit log scrie pe rute non-trivial (write operations + admin)
- [ ] Body limits + rate limits aplicate la rute noi
- [ ] Version bumpat in TOATE fisierele simultan (vezi Â§4)
- [ ] CHANGELOG.md, STATUS.md, SESSION-HANDOFF.md, CLAUDE.md, EXECUTION-ROADMAP.md, frontend/src/data/changelog-entries.tsx â€” toate actualizate
- [ ] Commit local cu mesaj structurat
- [ ] (Optional) Tag `vX.Y.Z` local cu autorizare
- [ ] (Optional) Push la origin cu autorizare

---

## 10. Task pendinte â€” prioritati

### Imediat decis cu user inainte sa pornesti
1. **Push tag-uri v2.6.5..v2.6.8?** Tag-urile exista local. Push catre GitHub doar cu confirmare explicita (`git push origin v2.6.5 v2.6.6 v2.6.7 v2.6.8`).
2. **Ordinea PR-9 vs Dashboard redesign?** PR-9 (Auth pluggable) e in EXECUTION-ROADMAP ca next. Plan-ul Dashboard (vezi `PLAN-dashboard-redesign.md`) propune PR-A (KPI strip + summary endpoint) inainte de PR-9. Cere user sa aleaga.

### PR-9 â€” Auth pluggable (next planificat)
- Vezi `EXECUTION-ROADMAP.md` sectiunea PR-9 + `PLAN-monitoring-webmode.md` Â§3.1-3.3.
- DDL: nimic nou (tabel `users` deja exista din PR-2 ca shadow).
- Backend: `authStrategy` interface (`desktop` noop returneaza `'local'`, `web` valideaza JWT din cookie). Setting `APP_MODE=desktop|web`. Middleware `auth()` + route `/api/v1/auth/login`, `/api/v1/auth/logout`, `/api/v1/auth/refresh`.
- Frontend: niciun impact in mod desktop. In mod web: ecran login + redirect.
- Tests: matrix `APP_MODE=desktop` + `APP_MODE=web`.

### PR-10..PR-12 (web cutover)
- PR-10: deploy server (Docker + Litestream + reverse proxy).
- PR-11: Google Workspace SSO integration (OAuth via Google).
- PR-12: migrare data desktop â†’ web per angajat (export CLI + import endpoint).

### Dashboard redesign (alternativ)
- Vezi `PLAN-dashboard-redesign.md`. 3 PR-uri secventiale (PR-A..C), ~6.5 zile dev. Recomandare: PR-A inainte de PR-9, PR-B + PR-C dupa.

---

## 11. Comportament cand esti blocat

1. **Eroare reproducibila** â†’ reproduci de 2 ori, capturezi stacktrace, escaladez la user cu citat exact de eroare.
2. **Ambiguitate in cerinta** â†’ intrebi user. NU ghicesti. Auto mode nu te scuza sa iei decizii destructive.
3. **Test esueaza dupa schimbare** â†’ fix root cause; daca testul era gresit, repari testul cu motivatie in commit. NU `--no-verify` ca sa treci hook-ul.
4. **Build esueaza** â†’ fix; nu commiti rosu.
5. **Push respins** â†’ opresti, citesti raspunsul, raportezi user. Nu `--force`.
6. **Subagent intoarce raspuns gresit** â†’ contraexemplu impotriva, reconcile call cu evidenta primara. Nu te plimbi orb dupa el.

---

## 12. Reguli de etica si securitate

- **Niciodata** nu commit-uiezi `.env`, chei API, tokens, secrets in clear in cod.
- **Niciodata** nu transmiti chei API in raspunsuri / log-uri / mesaje commit.
- **Niciodata** nu modifici `SECURITY.md` fara sa intelegi threat model-ul curent.
- **Niciodata** nu scoti CSP, sandbox, contextIsolation "ca sa mearga ceva". Reparari root cause, nu bypass.
- **Niciodata** nu add-uiezi un dep nou fara verificare (audit, weekly downloads, last update). Dep-uri noi cer `repo-security-auditor` review.

---

## 13. Resurse externe (cand ai nevoie)

| Subiect | Resursa |
|---------|---------|
| Hono docs | context7 query "hono web framework" |
| better-sqlite3 | context7 query "better-sqlite3 node" |
| Electron API | context7 query "electron 41" |
| React patterns | context7 query "react 18" |
| Recharts | context7 query "recharts react" |
| xlsx-js-style | github docs (deja folosit, conventiile cunoscute) |
| exceljs | context7 query "exceljs node" |
| Tailwind | context7 query "tailwind v3" |
| Anthropic SDK | context7 query "anthropic sdk node" |

---

## 14. Inchidere

**Daca esti un agent succesor citind asta**: fa primii 5 pasi din Â§0. Daca primii 5 pasi raman verzi, esti pe pamant cunoscut. Daca o sa rosi pe build/test, nu trecut peste â€” cer user help, raporteaza exact ce-ai facut + output.

**Daca esti user-ul citind asta**: planul e ferm. Cer-i agent-ului sa "execute Plan-Codex-handoff Â§0" si verifica-i output-urile. Daca apare ceva nou, adauga in `SESSION-HANDOFF.md` si cere agent-ului sa-l reciteasca.

---

**Versiune doc**: 1.0 (2026-05-01). Update-uri ulterioare ramane sa apara aici cu changelog jos:

## Changelog plan

- **2026-05-01 â€” v1.0** initial draft, post-v2.6.8.
