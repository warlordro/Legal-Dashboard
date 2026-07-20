# HANDOFF — Implementare fixuri audit v2.43.0 (sesiune 3, 2026-07-11)

**Branch:** `feat/v2.43.0-rnpm-split` · **HEAD la predare:** `96221ba` · **Working tree: CURAT** (batch 1 + batch 2 COMPLETE si comise)
**Plan executat:** `docs/superpowers/plans/2026-07-11-fixes-audit-v2.43-core.md` (**Rev. 2** — corectiile review-ului Codex integrate; raportul Codex: `...core.review-codex.md`)
**NU s-a facut niciun push. NIMIC pe main (Dokploy!).**

> **UPDATE la finalul sesiunii 3:** T6+T7 au fost FINALIZATE si comise ca bloc (`96221ba`) inainte de predare — §2 si §3 de mai jos raman doar ca istoric al rezolvarii; NU mai e nimic de reparat acolo. **Primul pas real al sesiunii noi = §4 (batch 3, T8–T15).** Testul FS-error a fost inchis cu spy pe `fsPromises.stat` (EACCES), iar testul de contract "rolul user ARE acces..." a primit `seedAviz` explicit (delete-all nu mai provisioneaza implicit fisierul — semantica noua, intentionata).

---

## 0. Obiectivul sesiunii (setat de user prin /goal, ramane valabil)

Implementeaza planul Rev. 2 cu metodologia acceptata: **taskurile mecanice → subagenti Sonnet 5** (un task per subagent, secvential), **taskurile delicate 5–7 → direct orchestratorul (Fable)**; orchestratorul face REVIEW pe diff-ul fiecarui task Sonnet (anti-slop, anti-regresie — cerinta explicita user); **Codex** se consulta la nevoie (thread resumabil: `codex resume 019f5098-2230-78b2-9678-f155d98f95b0`); la final **review adversarial cu `mcp__review-panel__multi_model_review`** pe diff-ul integral (focus T5–T7).

**Cerinte user adaugate in mers:**
1. **Commit-uri pe blocuri MARI** (nu per task): batch 2 = UN commit (T6+T7 impreuna; T5 a apucat sa fie comis separat), batch 3 = un bloc, etc.
2. **Tracker TDD vizual** in fiecare raport de progres (tabel: 🔴 test rosu / 🟢 verde / gate / commit / review).

## 1. Stare batch-uri

| Batch | Task | Stare | Commit |
|---|---|---|---|
| 1 | T1 daily backup errno (EXT-H-02) | ✅ TDD + review diff | `15b53db` |
| 1 | T2 recordAuditSafe + denied (INT-H3) | ✅ TDD + review diff | `c5df00a` |
| 1 | T3 Enter confirm-dialog (EXT-H-03) | ✅ TDD + review diff | `0a49627` |
| 1 | T4 titlu + reload restore (INT-H11/M12) | ✅ TDD + review diff | `6b633d3` |
| 2 | T5 heartbeat resilient (INT-H1/H2) | ✅ TDD (34P) | `18d6d93` |
| 2 | T6 shutdown lock retention (EXT-H-01) | ✅ TDD complet | `96221ba` (bloc T6+T7) |
| 2 | T7 delete-all atomic (EXT-M-01) | ✅ TDD complet (37/37 + 44 contract + 160 total suite batch) | `96221ba` (bloc T6+T7) |
| 3 | T8–T15 | ⬜ | — |
| 4 | T16 gate final + review-panel | ⬜ | — |

## 2. PRIMUL PAS in sesiunea noua — inchide testul rosu T7

Testul `rnpmBackup.test.ts` › "eroare FS non-ENOENT la verificarea fisierului se PROPAGA" pica: pe Windows, `stat("<fisier>/<copil>")` da **ENOENT**, nu ENOTDIR (aranjamentul "directorul rnpm devine fisier" nu produce codul asteptat), deci operatia rezolva `{deleted:0}` in loc sa respinga.

**Fix stabilit (nu re-investiga):** inlocuieste aranjamentul cu spy pe namespace-ul fsPromises — functioneaza pentru ca `backup.ts` foloseste `fsPromises.stat(...)` (obiect namespace, intercept OK; acelasi pattern ca mock-ul copyFile de la `rnpmBackup.test.ts:662`):

```ts
it("eroare FS non-ENOENT la verificarea fisierului se PROPAGA (nu succes fals)", async () => {
  vi.spyOn(fsPromises, "stat").mockRejectedValueOnce(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));
  await expect(deleteAllRnpmAndCompact("u1")).rejects.toMatchObject({ code: "EACCES" });
});
```

(sterge integral vechiul aranjament cu `writeFile(rnpmDir, ...)` + try/finally). Apoi:

1. `npx vitest run src/db/rnpmBackup.test.ts src/db/backup.test.ts src/routes/rnpmBackups.contract.test.ts src/db/rnpmFullFlow.test.ts src/db/rnpmDb.test.ts src/index.test.ts` — ATENTIE: contract-testele delete-all pot asserta mesajul VECHI al rutei ("reincearca dupa finalizare"); refuzul vine acum din `RnpmSearchActiveError` cu mesajul "…operatia e refuzata pana se termina" prin handlerul central. Daca vreun test pica pe TEXT, actualizeaza asertia la cod/status (nu reveni la guard-ul vechi).
2. `npx biome check --write` pe fisierele din §3 → `npx tsc --noEmit -p backend/tsconfig.json`.
3. **UN SINGUR COMMIT T6+T7** (blocul batch 2), mesaj sugerat: `fix(rnpm): shutdown cu lock retinut la writeri nesettled + delete-all+compact atomic pe handle configurat (EXT-H-01, EXT-M-01)`.

## 3. Working tree — fisiere modificate NECOMISE (T6+T7)

- `backend/src/db/backup.ts` — T6: recheck shutdown dupa acquire in `withMaintenanceWrite`; `waitForBackupToSettle` → boolean + clearTimeout. T7: extractie `compactRnpmUnderLatch` (corpul vechi din compactRnpmDbViaWorker, NEmodificat logic); `deleteAllRnpmAndCompact` nou; import `openRnpmDbHandleDirect` + `deleteAllAvizeOnHandle`.
- `backend/src/index.ts` — T6: `LEGAL_DASHBOARD_SETTLE_TIMEOUT_MS` (default 30000), log `shutdown.maintenance_unsettled`, release conditionat + log `shutdown.lock_retained`. (Promise-join-ul gracefulShutdown e deja comis in T5.)
- `backend/src/db/rnpmDb.ts` — T7: `applyRnpmConnectionPragmas` extras (open-ul existent il refoloseste); export nou `openRnpmDbHandleDirect(dbPath)` cu `fileMustExist:true`.
- `backend/src/db/avizRepository.ts` — T7: export nou `deleteAllAvizeOnHandle(db, ownerId)` (cu `assertOwnerIdForMutation` inauntru); `deleteAllAvize` refactorizat sa-l apeleze.
- `backend/src/routes/rnpm.ts` — T7: `DELETE /saved/all` rescris pe `deleteAllRnpmAndCompact` (try/catch cu audit denied pe erori tipate + `rethrowTypedMaintenanceError`); importuri: + `deleteAllRnpmAndCompact`, + `RnpmRestoreInProgressError`, − `deleteAllAvize` (orfan).
- `backend/src/db/backup.test.ts` — T6: describe "shutdown vs maintenance writers (EXT-H-01)" (2 teste); testul VECHI Rev. 4 "un writer DEJA in coada..." ACTUALIZAT INTENTIONAT la semantica noua (refuzat la acquire, `secondRan === false`) — nu-l reveni.
- `backend/src/index.test.ts` — T6: describe "shutdown — lock retention..." (settle 100ms via env, assert `.instance.lock` ramane).
- `backend/src/db/rnpmBackup.test.ts` — T7: describe "deleteAllRnpmAndCompact (EXT-M-01)" (5 teste: search activ refuza; cascade + `foreign_key_check` gol; izolare 2 owneri; owner fara fisier; FS error — ULTIMUL E CEL ROSU, fix in §2).

Verificare rapida la reluare: `git status` + `git diff --stat` trebuie sa arate exact fisierele de mai sus.

## 4. Dupa commit-ul batch 2 → batch 3 (T8–T15, subagenti Sonnet)

Prompt-sablon folosit deja pentru T1–T4 (pastreaza formatul): subagent `general-purpose` cu `model: "sonnet"`, foreground, UN task per subagent, secvential; instructiuni stricte: citeste DOAR "Global Constraints" + "Decizii" + task-ul lui din planul Rev. 2; TDD cu confirmare rosu; adapteaza scheletele la harness-urile REALE (Codex a validat ca planul citeaza fisierele corecte); fara push; **FARA COMMIT** — batch 3 se comite ca UN bloc de orchestrator dupa review-ul tuturor diff-urilor (cerinta user de commit-uri mari; spune-le subagentilor sa NU comita, doar sa lase working tree-ul curat pe fisierele lor).

Orchestratorul REVIZUIESTE diff-ul fiecarui task inainte de a lansa urmatorul (git diff pe fisierele taskului). Ordinea: T8 → T9 → ... → T15 (ating fisiere comune: rnpm.ts la T8/T9/T13/T15, backup.ts la T15).

## 5. Batch 4 (T16) — gate final

`npm run check` → `npm run build` → `npm run rebuild:electron` → smoke web local (dev-web-local.ps1, fara token handling manual — memoria "smoke-fara-token-handling") → **review-panel adversarial** (`mcp__review-panel__multi_model_review`) pe diff-ul integral al branch-ului fata de `6b633d3`~4 (adica fata de starea pre-batch-1: baza e commit-ul `a9630b9`... corect: diff-ul de review = `git diff a9630b9..HEAD`), focus T5–T7 (lock/shutdown/atomic delete). Findings confirmate in scope → fix inainte de raportul final. Push DOAR cu confirmarea userului. Smoke Electron = derogare user, dar OBLIGATORIU inainte de tag-ul de release (noteaza in raport).

## 6. Capcane invatate IN ACEASTA sesiune (nu re-descoperi)

1. **Biome `noAssignInExpressions`**: `(r) => (x = r)` pica — foloseste block body `(r) => { x = r; }`. A lovit de 2 ori.
2. **Mock pe fs named-imports NU functioneaza** pentru `instanceLock.ts` (import { renameSync } — binding capturat). Solutie folosita la T5: cu fake timers `Date.now()` e determinist → pre-creezi un DIRECTOR pe path-ul temp exact al tick-ului urmator → writeFileSync arunca EISDIR real. Pentru `backup.ts` mock-ul pe `fsPromises.stat/copyFile` FUNCTIONEAZA (namespace object).
3. **Windows `stat("<fisier>/<copil>")` = ENOENT**, nu ENOTDIR — nu folosi aranjamentul "parintele devine fisier" pentru erori non-ENOENT pe stat.
4. **Testul Rev. 4 al writer-ului din coada** codifica semantica veche — a fost actualizat intentionat la EXT-H-01 (refuz la acquire). Daca alte teste pica pe aceeasi tema, actualizeaza-le la contractul nou, nu reveni fixul.
5. Suita `backup.test.ts` foloseste `captureConsoleLog` propriu (spy-ul pe console.log NU prinde peste microtask-hop-ul maintenance-lock) — vezi comentariul din fisier.
6. Subagentii Sonnet au livrat curat cu prompt-ul strict + "OPRESTE-TE la deviere" (T4 a gasit singur `vi.stubGlobal("location", ...)` pentru jsdom reload — pattern nou acceptat in suita).
7. Codex: task-urile de fundal pot muri cu registry "running" stale — verifica PID + mtime log; recuperare prin `task --resume` pe acelasi thread (nu re-investigheaza). `MSYS_NO_PATHCONV=1` la cancel/result.

## 7. Referinte

- Plan (sursa unica, Rev. 2): `docs/superpowers/plans/2026-07-11-fixes-audit-v2.43-core.md`
- Review Codex pe plan: `docs/superpowers/plans/2026-07-11-fixes-audit-v2.43-core.review-codex.md`
- Audit consolidat (context findings): `audit/AUDIT-CONSOLIDAT-v2.43.0-rnpm-split-2026-07-11.md`
- Raport non-tehnic: `Legal-Dashboard-v2.43.0-Audit-Consolidat.html`
- Reguli push (non-negotiable): biome → tsc backend+frontend → build → teste → commit; push DOAR cu confirmarea userului. Romana fara diacritice in cod. Fara bump de versiune in acest plan.
