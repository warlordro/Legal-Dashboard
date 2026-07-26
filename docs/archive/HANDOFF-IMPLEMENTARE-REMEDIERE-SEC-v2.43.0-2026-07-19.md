# HANDOFF — Implementare remediere audit sec + corectitudine v2.43.0 (2026-07-19)

**Scop sesiune noua: EXECUTA planul de remediere (7 PR-uri), TDD, pe branch nou. Toata analiza e INCHISA — nu re-verifica, nu re-planifica, doar implementeaza.**

## 0. TL;DR — de unde incepi

1. Citeste planul complet: [docs/superpowers/plans/2026-07-19-remediere-audit-sec-v2.43-rev2.md](docs/superpowers/plans/2026-07-19-remediere-audit-sec-v2.43-rev2.md) — **REV2 e sursa unica de adevar**. Ignora Rev1 (`...-v2.43.md` fara `-rev2`), pastrat doar pentru trasabilitate.
2. Deschide branch nou din `feat/v2.43.0-rnpm-split` (Task 0 din plan): `git checkout -b fix/audit-sec-v2.43-remediere`.
3. Executa PR-urile in ordine (vezi §3), fiecare task TDD: **test rosu → fix minim → verde**.
4. Commit-uri locale pe parcurs. **UN SINGUR push pe GitLab la final** (Task F1), dupa ce toate cele 7 PR-uri trec `npm run check` verde. NIMIC pe main (memory `gitlab-workflow-branches`).

## 1. Context: cum am ajuns aici

Auditul `AUDIT-SEC-CORECTITUDINE-v2.43.0-2026-07-18.md` (23 findings) a fost verificat pe cod (21 confirmate, 2 partiale) — vezi [HANDOFF-VERIFICARE-AUDIT-SEC-v2.43.0-2026-07-18.md](HANDOFF-VERIFICARE-AUDIT-SEC-v2.43.0-2026-07-18.md). Userul a triat ce se implementeaza. Planul Rev1 a fost apoi supus la **doua review-uri adversariale independente pe cod** (workflow intern 7 agenti + Codex) — ambele NO-GO pe Rev1 as-is, cu bug-uri reale in fixuri/teste. Rev2 le integreaza pe toate + 2 decizii de owner. **Planul Rev2 e considerat de incredere si gata de executie.**

## 2. Decizii de owner (2026-07-19) — NU le redeschide

**PR-5 = varianta STRICTA.** Serverul web refuza sa porneasca (fatalBoot) cand e `auth_mode=web` + bind loopback + `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` gol (topologia proxy co-locat, unde originGuard loopback-bypass devine bypass total). Decuplat de `REMOTE_BIND_ACTIVE`. Un web bind DIRECT non-loopback NU e blocat (pastreaza peer real). Desktop neafectat. Mesaj de eroare clar la boot (spune ce linie sa adaugi).

**PR-8 / BUG-04 = per-owner STRICT.** Cand tick-ul se trezeste in afara orei (pentru ca exista un retry due), proceseaza DOAR ownerii cu retry due/exhausted; ownerii fara entry de retry NU primesc trimiterea initiala off-hour. Fara „email la ora gresita".

**NU se implementeaza (risc acceptat / amanat):** PR-4 (portita stocare gcode), PR-7 (plafon joburi), PR-3 (Content-Type 415). Electron 43 = milestone separat. Se adauga doar note de risc acceptat in SECURITY.md pentru BUG-02 + SEC-09 (Task 6.5).

## 3. Ordinea de executie (PR-uri izolate)

**PR-1 → PR-2 → PR-5 → PR-6 → PR-8 (BUG-04 primul) → PR-9 → PR-10 → F1.**

| PR | Ce face | Fisiere-cheie |
|---|---|---|
| PR-1 | SEC-01: guard CSRF desktop global pe mutatii `/api/*` (exemptie PAT + SSE), warn la boot pe kill switch, repara `index.test.ts` + 2 load-testuri | `middleware/requireDesktopHeaderGlobal.ts` (nou), `index.ts`, `index.test.ts`, `scripts/loadtest-*.js` |
| PR-2 | SEC-02a: update Electron in linia 41 (doar lockfile), rebuild DUPA gate teste | `package-lock.json` |
| PR-5 | NEW-02: fail-closed strict web+loopback fara CIDR + `::1/128` canonic + anti-regresie dev-web-local | `util/proxyIp.ts`, `util/trustedProxyBootCheck.ts` (nou), `index.ts`, `scripts/dev-web-local.ps1`, `.env.example` |
| PR-6 | SEC-04 (redirect:manual keyValidation+soap) + SEC-07 (cap rnpmClient+iccj warmSession) + note risc acceptat | `services/keyValidation.ts`, `soap.ts`, `services/rnpmClient.ts`, `services/iccj/iccjClient.ts`, `SECURITY.md` |
| PR-8 | BUG-04 (retry off-hour per-owner), BUG-03 (409 pe race), BUG-06 (clamp pagesTotal), SEC-06 (decodeXmlEntities U+FFFD), SEC-05 (sanitize faultstring) | `services/email/dailyReportScheduler.ts`, `services/monitoring/scheduler.ts`, `services/rnpmSearchService.ts`, `soap.ts` |
| PR-9 | BUG-01 (cleanup tmp PDF), SEC-08 (IPC fail-closed), SEC-10 (will-redirect), BUG-05 (splitter try/finally), BUG-08 (unref timer), SEC-11 (respinge placeholder JWT) | `services/alertsExportPdf.ts`, `electron/notifications.js`, `electron/main.js`, `db/rnpmSplitter.ts`, `auth/config.ts`, `docker-compose.web.example.yml` |
| PR-10 | SEC-03 (corecteaza „write-only" xlsx fara istoric datat), SEC-13 (sync versiuni deploy), BUG-10 (toate pasajele manual), SEC-12 (tracking uuid) | `SECURITY.md`, `STATUS.md`, `SESSION-HANDOFF.md`, `docker-compose.yml`, `deploy/*`, `frontend/src/pages/manual-content.tsx`, `frontend/src/lib/export-manual.ts` |

## 4. Capcane critice (din dublul review — NU le repeta)

Aceste corectii sunt DEJA in Rev2; le repet aici ca sa nu regresezi in timpul executiei:

1. **BUG-03:** match pe `code === "SQLITE_CONSTRAINT_UNIQUE" && message.includes("monitoring_runs.job_id")`. NU `idx_one_running_per_job` — numele indexului NU apare in eroarea better-sqlite3 (raporteaza `tabela.coloana`).
2. **keyValidation / SOAP teste:** mock cu `new Response(null, { status: 302 })`. `status: 0` arunca RangeError la construire (valid 200-599) → test fals-verde.
3. **rnpmClient cap:** extrage `const composed = withRnpmTimeout(signal)` O DATA, reutilizeaza la fetch SI la citire. NU re-apela `withRnpmTimeout` la citire (dubleaza bugetul ~120s). Testul asteapta `code: "response_too_large"` (nu `{name:"RnpmError"}` generic — schema validation arunca RnpmError inainte de fix).
4. **iccj warmSession test:** NU testa prin `searchIccjEnriched` (postSearch face JSON.parse pe `<html>` → arunca inainte SI dupa fix). Type-check + suita iccj existenta.
5. **BUG-04:** off-hour proceseaza DOAR ownerii cu retry (per-owner), exhausted ruleaza si off-hour. Testul are 3 cazuri (due off-hour ruleaza; owner fara retry NU e trimis; exhausted curatat off-hour). Helperi reali: `seedJob`, `seedRun`, `seedAlertAt`, `_resetDailyReportRetryStateForTest` — `seedOwnerWithAlerts` NU exista, seedeaza direct in DB.
6. **BUG-06:** clampeaza bucla + `nextRnpmPage` + valoarea `pagesTotal` returnata in contract. Test cu `pagesTotal=50` (NU 1M → timeout).
7. **SEC-05:** regex cu control chars necesita `// biome-ignore lint/suspicious/noControlCharactersInRegex` (precedent soap.ts:57), altfel gate-ul Biome pica. Include si U+0085/U+2028/U+2029.
8. **BUG-01:** `fs.stat` INAUNTRUL try-ului (paritate reala cu rnpmExportPdf.ts:314-319). Test before/after pe tmp (nu doar `rejects.toThrow`).
9. **SEC-08:** parametrul `isTrustedIpcSender` obligatoriu, fallback FAIL-CLOSED (throw daca lipseste), nu `() => true`. Actualizeaza apelantul din main.js:350.
10. **PR-1:** testeaza cu `npm test --workspace=backend -- index monitoring alerts rnpm.contract rnpmBackups.contract requireDesktopHeader --run` — include `index` (3 teste 413/400/413 se rup real). Repara si `scripts/loadtest-monitoring.js` + `loadtest-name-lists.js` (adauga desktop header). Warn la boot cand kill switch-ul e activ.
11. **PR-2:** modifica DOAR `package-lock.json` (nu inventa diff in package.json). Ruleaza `npm rebuild better-sqlite3` (ABI Node) + `npm run check` INAINTE de `npm run rebuild:electron` (ABI Electron), altfel testele pica pe `NODE_MODULE_VERSION`. Accepta orice 41.x rezolvat (nu te bloca pe cifra exacta).
12. **PR-5:** apelul `assertTrustedProxyForWeb` plasat IN AFARA try-ului de boot (index.ts 596-705), langa `REMOTE_BIND_ACTIVE` (dupa L527) — altfel fatalBoot e reambalat gresit ca „schema/prewarm failed". Canonicalizare IPv6 (`::1` == `0:0:0:0:0:0:0:1`). Actualizeaza warn-ul stale „IPv4-only". **Task 5.3 anti-regresie: adauga `TRUSTED_PROXY_CIDR=127.0.0.1/32` in dev-web-local.ps1** (altfel smoke-ul web local nu porneste).
13. **PR-10:** NU edita randuri de changelog datate (SECURITY.md:256 2026-04-18, STATUS.md:65 istoric — imutabile per CLAUDE.md). Corectia „write-only" merge in „Riscuri acceptate" sau rand nou. La STATUS.md:65/SESSION-HANDOFF.md:474 sterge DOAR „write-only prin xlsx-js-style" (fals), pastreaza „xlsx nu mai e pe path-ul de input user" (corect). BUG-10: corecteaza TOATE pasajele (manual-content.tsx 618-619/727/730 + export-manual.ts 406-407/470/473), nu doar unul.

## 5. Regresie identificata (o singura reala, deja prevenita in plan)

**PR-5 strict ar fi rupt `dev-web-local.ps1`** (ruleaza web pe loopback fara CIDR). Task 5.3 din plan o previne (adauga linia CIDR in script + comentariu in .env.example). Confirma la Task 5.3 Step 3 ca smoke-ul porneste. Restul fixurilor nu regreseaza operarea normala (detalii in plan §„fara regresie"). BUG-06 are un risc de nisa documentat ca acceptat (daca RNPM subraporteaza `total`).

## 6. Workflow obligatoriu inainte de push (CLAUDE.md, non-negociabil)

Inainte de `git push` (Task F1):
1. `npm rebuild better-sqlite3` (daca PR-2 a lasat modulul pe ABI Electron).
2. `npx biome check --write` pe fisierele atinse; re-stage; commit `style: biome format pass` daca reformateaza.
3. `npm run check` (lint + typecheck + toate testele) — **confirma pass REAL, nu presupune**. Un review a rulat vitest intr-un sandbox care a blocat tmp (EPERM) si a raportat 0 teste — ruleaza intr-un mediu real.
4. `npm run build` — bundle curat.
5. Smoke desktop: `npm run rebuild:electron && npm run electron:dev`.
6. `git push -u origin fix/audit-sec-v2.43-remediere`.

## 7. Mod de executie recomandat

Subagent-driven (superpowers:subagent-driven-development): un subagent proaspat per task, review intre task-uri. Alternativ inline (superpowers:executing-plans) cu checkpoint-uri. Planul are checkbox-uri `- [ ]` per pas.

## 8. Stare git la momentul handoff-ului

Branch: `feat/v2.43.0-rnpm-split`. Fisiere untracked relevante (nu le sterge): planurile din `docs/superpowers/plans/2026-07-19-remediere-audit-sec-v2.43*.md`, auditul din `audit/`, acest handoff. Zero cod modificat inca — sesiunea de planificare n-a atins sursa.
