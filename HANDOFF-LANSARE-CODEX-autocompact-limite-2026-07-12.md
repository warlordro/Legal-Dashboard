# HANDOFF — Lansare Codex: autocompact + limite stocare RNPM (sesiune 2026-07-12, seara)

**Branch:** `feat/v2.43.0-rnpm-split` · **HEAD:** `9959cdc` · **17 commits nepushuite peste `a9630b9`; branch-ul NU exista pe GitLab** (verificat ls-remote). Push DOAR cu confirmarea userului. Nimic pe main (Dokploy).

## 0. PRIMUL PAS al sesiunii noi

1. Comite artefactele de planificare (user-ul a fost de acord de principiu, confirma verbal inainte):
   `git add docs/superpowers/plans/2026-07-12-rnpm-autocompact-delete-batch.md docs/superpowers/plans/2026-07-12-rnpm-storage-limits.md docs/superpowers/plans/2026-07-12-admin-rnpm-delete-backups-button.md docs/superpowers/plans/2026-07-12-fix-captcha-fallback-web-mode.md PROMPT-CODEX-rnpm-autocompact-si-limite-stocare.md`
   Commit sugerat: `docs(plan): planuri Rev.3 autocompact + limite stocare RNPM (review Codex + review-panel integrate) + prompt implementare Codex`
2. **Lanseaza task-ul Codex de implementare** (userul a cerut executie prin Codex, cu monitorizare):
   - Prompt-ul EXACT: continutul fisierului `PROMPT-CODEX-rnpm-autocompact-si-limite-stocare.md` (radacina repo). NU-l rescrie — trimite-l ca task.
   - Lansare: subagent `codex:codex-rescue` (via skill `codex:rescue`) cu `--fresh`, background. Task-ul cere si `--write` (Codex MODIFICA fisiere) — verifica sintaxa `codex-companion.mjs task --background --write --fresh [prompt]`.
   - Monitorizare: log-ul jobului e in `C:\Users\Cezar\.claude\plugins\data\codex-openai-codex\state\Legal-Dashboard-IF-45fada806d526766\jobs\<jobId>.log` — armeaza Monitor (tail -f + grep pe RED/GREEN/commit/error) si verifica periodic PID viu + log proaspat (registrul poate fi stale). Subcomenzile corecte: `status <jobId> --json`, `result <jobId>`, `cancel <jobId>` (NU `task-status`); `MSYS_NO_PATHCONV=1` la result/cancel.
   - Dupa finalizare: gate INDEPENDENT rulat de tine (`npm run check`), review pe diff-ul integral al lui Codex (verification-discipline), raport catre user. Commit-urile lui Codex apar pe branch pe masura ce lucreaza (commit per task = puncte de revenire).

## 1. Sursele de adevar pentru implementare

- `PROMPT-CODEX-rnpm-autocompact-si-limite-stocare.md` — promptul pe pasi (faza A = autocompact, faza B = limite; TDD strict; gate-uri; capcane repo; criterii de done; format raport).
- `docs/superpowers/plans/2026-07-12-rnpm-autocompact-delete-batch.md` — plan faza A. Rev. 2 + punctul 7a (Rev. 3) CASTIGA asupra textului initial.
- `docs/superpowers/plans/2026-07-12-rnpm-storage-limits.md` — plan faza B. Rev. 2 + Rev. 3 castiga; deciziile DECIZIE-USER 1-3 sunt APROBATE (restore permis peste limita; pool-uri backup RNPM reduse 3/2/2/2; block imediat fara grace — app nelansata oficial).
- Review-uri deja facute PE PLANURI (nu re-rula): Codex adversarial (autocompact: thread 019f55d4...; limite: thread 019f57a6-0228-7df1-bbe9-2dd77598bcf9, REJECT integrat in Rev. 2) + review-panel multi-model (Opus/GPT/GLM; findings integrate ca Rev. 3 in ambele planuri). Divergenta pastrata constient: compactare SINCRONA (nu async cum cerea Codex) — decizie user, recalculata la cap 500 MB (~7-9s, sub nota proxy >=60s).

## 2. Starea sesiunii de azi (context)

**Commits noi azi (toate cu gate verde + review adversarial):**
- `dae281c` + `45e8302` — fix captcha fallback web mode (a doua cheie tenant ca fallback; body-BYOK blocat pe web; abort in race → 499). VALIDAT LIVE in human testing: race castigat de ambii provideri in sesiuni diferite, "Proxy IP banned by target service" (eroare reala CapSolver, ERROR_PROXY_BANNED, docs.capsolver.com/en/guide/api-error/) absorbita de 2Captcha fara 500, abort mid-race → 499 curat.
- `2281f48` + `9959cdc` — buton "Sterge backup-urile" per user in cardul admin Stocare RNPM (endpoint cross-owner existent; review-panel: clean pe securitate/concurenta, findings Low de coverage fixate). VALIDAT LIVE (delete_rnpm_backups deleted:2 in log).

**Investigatii inchise azi (nu re-deschide):**
- Fisierele RNPM de ~200 MB ale userilor de test: 94% = tabela `rnpm_bunuri` (137k randuri / 512 avize; 47 avize-portofoliu cu ~2500 bunuri fiecare); ~50% din payload = coloanele `_norm` (43 MB doar referinte_json_norm, folosit intr-un singur LIKE — avizRepository.ts:678). Optimizarea "C" (drop _norm pe bunuri + normalizare la query) = backlog, NEaprobata.
- Delete-batch NU compacteaza (by design) → fisier "coaja goala" 202 MB cu freelist 99.9% → exact motivatia feature-ului autocompact. Compacteaza manual din card daca deranjeaza intre timp.
- 429 pe /api/ai/analyze = gate-ul de cota AI (estimare $0.25/analiza rezervata in avans; userul avea override $0.30/zi setat de admin la 16:57; analiza reala a costat $0.021). Follow-up UX ramas in backlog: mesajul 429 cu cifre in UI.
- Useri cu status Sters raman cu fisierul RNPM pe disc (fara cleanup la stergere) — backlog Faza 2, decizie de lifecycle.

**Mediul de test:** dev-web-local RULEAZA pe build-ul HEAD 9959cdc — backend PID 21092 (port 3002), proxy-admin 31024 (3003/127.0.0.1), proxy-user 33852 (3004/localhost). Oprire: `Stop-Process -Id 21092,31024,33852 -Force`. NU-l opri in timpul implementarii Codex (testele folosesc DB-uri temp). ATENTIE: better-sqlite3 e compilat pe ABI-ul NODE (nu Electron) — inainte de orice smoke Electron: `npm run rebuild:electron`; dupa el, inainte de teste Node: `npm rebuild better-sqlite3`.

## 3. Dupa implementarea Codex (ordinea)

1. Gate independent: `npm run check` (backend ~1925+ teste, frontend ~384+).
2. Review pe diff (verification-discipline; focus: secventa recheck-sub-latch din A-T1, protectedNames pe ambele faze B-T2, matricea de teste din planul 2 punctul #14 bifata integral).
3. Rebuild + restart dev-web-local (cu acordul userului) + smoke manual pe fluxurile noi (delete mare → fisier micsorat automat; cautare peste limita → 429 cu cifre; card admin folosit/limita).
4. Raport final user; push-ul intregului branch ramane subiect separat (confirmare explicita).

## 4. Capcane invatate azi (pe langa cele din prompt)

1. `scripts/dev-web-local.ps1` pica pe powershell.exe 5.1 (UTF-8 fara BOM + em-dash) — ruleaza-l DOAR cu pwsh 7 (`& "scripts/dev-web-local.ps1"`).
2. ripgrep sare fisierele git-ignored (`.dev-web-local/` invizibil pentru Grep) — foloseste Select-String/Get-Content pe path direct.
3. review-panel: Kimi si DeepSeek pot expira la fisiere mari (timeout 600s) — sinteza ramane valida cu 3 modele.
4. AskUserQuestion la codex:rescue cu thread resumabil: userul prefera THREAD NOU pe subiect nou (a ales asa de 2 ori azi).
5. Userul vrea rapoarte CONCISE, netehnice ("explica mai simplu", "fara mult limbaj tehnic") — pastreaza detaliile tehnice in planuri/handoff, nu in mesaje.
