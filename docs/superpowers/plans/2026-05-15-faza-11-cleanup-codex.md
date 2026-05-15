# Faza 11 Cleanup — Codex Execution Plan (v2, post-review)

> **For agentic workers (Codex):** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inchide cele 4 findings ramase din auditul Faza 11 (F11-F2, F11-F3 part 2, F11-F4, F11-F5) prin schimbari mecanice + un sprint de normalizare biome, fara regresii functionale.

**Architecture:** 4 task-uri secventiale, fiecare cu propriile commit-uri. **Ordinea (post-review):** Task 1 = renormalize global LF + biome CI gate (F11-F2) PRIMUL, ca diff-urile celorlalte task-uri sa nu fie poluate de line-ending churn. Apoi Task 2 = mesaj 501 + /health (F11-F4). Apoi Task 3 = rebuild-electron `shell:false` (F11-F5). Apoi Task 4 = split export.ts complet + eliminare barrel (F11-F3). Toate task-urile pastreaza envelope-ul existent `{ data, error: { code, message }, requestId }`.

**Tech Stack:** Hono backend (Node 22, ESM, esbuild → CJS bundle), React 18 + Vite 6 frontend, Biome 1.9.4 (lineEnding lf), GitHub Actions (Windows + macOS), Electron 41.

**Review history:** Reviewed by 4 agents 2026-05-15 (reliability / correctness / refactor / release-readiness). All BLOCKER + HIGH findings folded into this v2.

**Excludere explicita:**
- Memoria `project_export_server_streaming` (planul XLSX/PDF streaming) este STALE; sprintul a fost LIVRAT in commits `3b69e4c` / `f9d11ec` / `d600959` / `9ece8ca` (2026-05-13). NU include nimic din acel scope aici.
- F11-F1 (originGuard CSRF) deja livrat in v2.27.2 (`5eb6f4e` + `f175d38`).

**Pre-flight (run before Task 1, no exceptions):**

```bash
git status                              # working tree must be clean
git checkout main && git pull --ff-only
git checkout -b chore/faza-11-cleanup
node --version                          # expect v22+
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
npm test --workspace=backend -- --run
cd frontend && npm test -- --run && cd ..
npx biome check 2>&1 | tail -5          # capture baseline count
git ls-files --eol | grep "i/crlf" | wc -l  # baseline CRLF count
```

Capture both baselines — they're acceptance signals for Task 1.

---

## Task 1: F11-F2 — Renormalize global LF + Biome CI gate

**Why first:** Task ce atinge 600+ fisiere. Daca ruleaza dupa Tasks 2/3/4, diff-urile lor sunt poluate cu line-endings si commits-urile devin nereviewable. Trebuie SA fie primul, ca subsequenele sa lande cu LF canonic deja.

**Files:**
- Create: `.editorconfig`
- Modify: `.gitattributes`
- Modify: `.github/workflows/build-windows.yml`
- Modify: `.github/workflows/build-mac.yml`
- Modify: TOATE fisierele text in repo (via `git add --renormalize`)

**Risk:** DESTRUCTIVE pe working tree daca ruleaza pe dirty state. Verifica `git status` strict clean inainte. NU ruleaza paralel cu alte tools.

- [ ] **Step 1.1: Verifica baseline empiric**

```bash
git ls-files --eol | grep "i/crlf" | wc -l       # expect ~600
npx biome check 2>&1 | tail -5                    # expect ~654 errors
git config --get core.autocrlf                    # may be unset, true, false
```

- [ ] **Step 1.2: Creeaza `.editorconfig` (root)**

Adresa preventiva — fara aceasta, dev-ii cu `core.autocrlf=true` global vor reintroduce CRLF la fiecare touch.

```ini
root = true

[*]
end_of_line = lf
charset = utf-8
indent_style = space
indent_size = 2
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab
```

- [ ] **Step 1.3: Extinde `.gitattributes` cu regula globala LF**

Inlocuieste integral:

```
# Default: toate fisierele text sunt stocate cu LF si checkout-uite cu LF
# (biome.json lineEnding:"lf"). Fara aceasta regula, core.autocrlf pe Windows
# inlocuieste \n cu \r\n la checkout si biome raporteaza 600+ "use lf" errors.
* text=auto eol=lf

# Binare explicite (extensii care nu trebuie normalizate)
*.png binary
*.jpg binary
*.jpeg binary
*.ico binary
*.icns binary
*.pdf binary
*.zip binary
*.exe binary
*.dll binary
*.node binary
*.db binary
*.db-wal binary
*.db-shm binary
*.xlsx binary

# Pastrare existenta: migrari SQL trebuie LF strict (hash check)
backend/src/db/migrations/*.sql text eol=lf
```

- [ ] **Step 1.4: Commit `.editorconfig` + `.gitattributes` SEPARAT**

```bash
git status                                        # only the 2 files
git add .editorconfig .gitattributes
git commit -m "$(cat <<'EOF'
chore(git): editorconfig + .gitattributes eol=lf global (F11-F2 prep)

.editorconfig forteaza LF in toate editoarele moderne (VS Code, JetBrains,
GitHub web) fara a cere dev-ilor sa schimbe core.autocrlf global.
.gitattributes adauga `* text=auto eol=lf` ca regula globala. Migrari SQL
pastreaza regula existenta (hash-integrity).

Pregateste pasul de renormalize din commit-ul urmator.
EOF
)"
```

- [ ] **Step 1.5: Renormalize repo-ul (CANONICAL PATH, no alternatives)**

```bash
# Guard: setam core.autocrlf=false LOCAL doar daca e setat la true.
# NU schimbam core.autocrlf global (interzis per CLAUDE.md).
if [ "$(git config --get core.autocrlf)" = "true" ]; then
  git config --local core.autocrlf false
fi

# Aplica regulile noi pe index + working tree.
git add --renormalize .

# Verifica scope-ul: 500-700 fisiere atinse, fara schimbari de continut.
git diff --cached --stat | tail -10
```

> NOTA Codex: daca `git diff --cached --stat` arata >800 fisiere sau apar `.exe`/`.png`/`.db` in diff, regula `binary` din `.gitattributes` nu a prins. STOP. Verifica `.gitattributes` si reincearca dupa `git reset HEAD`.
> NOTA recovery: daca STEP esueaza la jumatate (de ex Ctrl+C), ruleaza `git reset HEAD` + `git checkout -- .` ca sa revii la commit-ul Step 1.4. NU rula `git stash pop` (nu am stash-uit nimic in path-ul asta).

- [ ] **Step 1.6: Commit renormalize SEPARAT**

```bash
git commit -m "$(cat <<'EOF'
chore: renormalize line endings la LF global (F11-F2)

Aplicat `git add --renormalize` dupa .gitattributes eol=lf global.
~600 fisiere atinse, zero schimbari de continut (doar \r\n -> \n).
Inchide gross biome lint debt (CRLF vs LF).
EOF
)"
```

- [ ] **Step 1.7: Biome auto-format pass**

```bash
npx biome check --write .
npx biome check 2>&1 | tail -10
```

Expected: trece de la ~654 errors la <20 errors. Erorile ramase sunt format/lint issues reale (nu line-ending).

- [ ] **Step 1.8: Fix manual erorile ramase**

```bash
npx biome check 2>&1 | head -50
```

HARD CAP: daca raman >15 erori care necesita fix manual, STOP si raporteaza user-ului inainte de a continua. Erori tipice:
- `noUnusedVariables`: sterge variabila daca chiar e dead, sau prefixeaza cu `_` daca e parametru required.
- `noExplicitAny`: pune `unknown` cu type narrowing, sau lasa warning daca e justified (biome.json deja are `warn`, nu `error`).

Suppression locala doar cu justificare: `// biome-ignore lint/<rule>: <motiv>`. Niciodata global.

- [ ] **Step 1.9: Commit biome manual fixes (daca exista)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
style: biome manual fixes post-renormalize (F11-F2)

Fixed remaining lint issues that --write nu le-a putut auto-corecta.
EOF
)"
```

Daca biome check returneaza 0 erori dupa Step 1.7, skip acest commit.

- [ ] **Step 1.10: Adauga biome step in `.github/workflows/build-windows.yml`**

Insereaza IMEDIAT dupa `Install dependencies` step si INAINTE de `Backend type-check`. Indentare cu 6 spaces (match step-ul `Install dependencies`):

```yaml
      - name: Biome lint + format check
        # Gate fail-fast: regresii format/lint pic in CI nu in PR review.
        # CLAUDE.md cere `biome check --write` local pe fisierele atinse;
        # acest step previne PR-uri care sar peste regula.
        run: npx biome check
```

- [ ] **Step 1.11: Acelasi step in `.github/workflows/build-mac.yml`**

Cititi `.github/workflows/build-mac.yml`, gaseste step-ul `Install dependencies`, adauga acelasi `Biome lint + format check` imediat dupa, inainte de primul typecheck.

- [ ] **Step 1.12: Validate YAML structural**

```bash
node -e "const yaml = require('js-yaml'); yaml.load(require('fs').readFileSync('.github/workflows/build-windows.yml','utf8'))" 2>&1 || echo "PARSE FAIL"
node -e "const yaml = require('js-yaml'); yaml.load(require('fs').readFileSync('.github/workflows/build-mac.yml','utf8'))" 2>&1 || echo "PARSE FAIL"
```

Daca `js-yaml` nu e instalat: skip si verifica vizual indentarea (6 spaces pentru `- name:`, 8 pentru `run:`, alignat cu pattern-ul existing steps).

- [ ] **Step 1.13: Full validation gate**

```bash
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
npm test --workspace=backend -- --run
cd frontend && npm test -- --run && cd ..
npm run build
npx biome check
```

ALL 6 must be PASS. Daca tests pica dupa renormalize, e probabil snapshot stale: `npm test --workspace=backend -- -u` (acceptable doar dupa diff inspection — verifica ca update-ul e DOAR linie endings).

- [ ] **Step 1.14: Commit CI integration**

```bash
git add .github/workflows/build-windows.yml .github/workflows/build-mac.yml
git commit -m "$(cat <<'EOF'
ci: F11-F2 adauga step biome check in workflows Windows + macOS

Gate biome ruleaza dupa npm ci si inainte de tsc. CLAUDE.md deja cere
biome --write local pe fisierele atinse; CI gate previne accidentele.

Closes F11-F2.
EOF
)"
```

---

## Task 2: F11-F4 — Mesaj 501 + `/health` expune authMode + loginAvailable

**Files:**
- Modify: `backend/src/routes/auth.ts:35-40`
- Modify: `backend/src/index.ts` (healthHandler at line 210; `getAuthMode` ALREADY imported at line 14, no new import)
- Modify: `SECURITY.md` (add nota web mode = auth seam)
- Modify: `backend/src/index.test.ts` (extend existing /health test — NU crea fisier nou)
- Create: `backend/src/routes/auth.test.ts` (matches convention `routes/admin.test.ts`)

**Pattern reference:** test-urile backend folosesc co-located `*.test.ts`, nu `__tests__/`. Vezi `backend/src/index.test.ts` pentru /health pattern (importFreshIndex + waitForHealth) si `backend/src/routes/admin.test.ts` pentru router-only pattern.

- [ ] **Step 2.1: Citeste pattern-urile canonice**

```bash
# Verifica ce shape are testul /health existent.
grep -n "health" backend/src/index.test.ts | head -20
# Verifica router test pattern.
head -60 backend/src/routes/admin.test.ts
```

- [ ] **Step 2.2: Scrie failing test pentru noul mesaj 501**

Creeaza `backend/src/routes/auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { authRouter } from "./auth.ts";

describe("POST /api/v1/auth/login", () => {
  it("returneaza 501 cu cod not_implemented + mesaj fara referinta la PR-10", async () => {
    const app = new Hono().route("/api/v1/auth", authRouter);
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("not_implemented");
    expect(body.error.message).not.toMatch(/PR-10/i);
    expect(body.error.message).toMatch(/extern/i);
  });
});
```

- [ ] **Step 2.3: Verifica testul pica**

```bash
npm test --workspace=backend -- --run auth.test.ts
```

Expected: FAIL — mesajul curent contine "PR-10".

- [ ] **Step 2.4: Update mesajul 501 in `backend/src/routes/auth.ts:35-40`**

Replace:

```typescript
authRouter.post("/login", (c) => {
  return c.json(
    fail("not_implemented", "Login endpoint nu este disponibil in v2.7.x. Vezi PR-10 pentru SSO/IdP cutover.", c),
    501
  );
});
```

With:

```typescript
authRouter.post("/login", (c) => {
  return c.json(
    fail(
      "not_implemented",
      "Login first-party nu este livrat. In modul web tokenele JWT trebuie provisionate extern (IdP/SSO) si trimise prin cookie auth standard.",
      c
    ),
    501
  );
});
```

- [ ] **Step 2.5: Verifica testul trece**

```bash
npm test --workspace=backend -- --run auth.test.ts
```

Expected: PASS.

- [ ] **Step 2.6: Extinde testul /health existent**

Cauta in `backend/src/index.test.ts` testul pentru /health (pattern `importFreshIndex` + `waitForHealth`). Adauga un nou `it()` IN ACELASI describe block care boot-eaza fresh + asertioneaza noul payload:

```typescript
it("expune authMode + loginAvailable:false + service contract intact (Electron splash)", async () => {
  process.env.AUTH_MODE = "desktop";
  const { app, markReady } = await importFreshIndex();
  await markReady();
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    status: string;
    service: string;
    authMode: string;
    loginAvailable: boolean;
  };
  expect(body.status).toBe("ok");
  expect(body.service).toBe("Legal Dashboard API"); // contract pentru electron/main.js splash poll
  expect(body.authMode).toBe("desktop");
  expect(body.loginAvailable).toBe(false);
});
```

> NOTA Codex: ajusteaza importFreshIndex/markReady la API-ul real din `index.test.ts`. Daca pattern-ul e diferit (de ex. `serve()` + fetch direct cu port aleator), foloseste pattern-ul existent verbatim — NU inventa unul nou.

- [ ] **Step 2.7: Verifica testul pica**

```bash
npm test --workspace=backend -- --run index.test.ts
```

Expected: FAIL — campurile `authMode` + `loginAvailable` nu exista.

- [ ] **Step 2.8: Update `healthHandler` in `backend/src/index.ts:210-240`**

`getAuthMode` este DEJA importat la `backend/src/index.ts:14` — NU adauga import duplicat. Verifica:

```bash
grep -n "getAuthMode" backend/src/index.ts | head -5
```

Daca import-ul exista deja, schimba doar return-ul. Inlocuieste:

```typescript
return c.json({
  status: "ok",
  service: "Legal Dashboard API",
  monitoring,
  emailConfigured,
});
```

With:

```typescript
return c.json({
  status: "ok",
  service: "Legal Dashboard API",
  authMode: getAuthMode(),
  loginAvailable: false,
  monitoring,
  emailConfigured,
});
```

NU schimba branch-ul `starting` (503) — `authMode`/`loginAvailable` sunt expuse doar in payload-ul `ready`.

- [ ] **Step 2.9: Verifica testele trec**

```bash
npm test --workspace=backend -- --run
```

Expected: ALL PASS, inclusiv noul test /health.

- [ ] **Step 2.10: Verifica .env.example mentioneaza AUTH_MODE**

```bash
grep -n "AUTH_MODE" .env.example
```

Daca lipseste, adauga:

```
AUTH_MODE=desktop  # OPTIONAL — "desktop" (default) sau "web". Web requires JWT_SECRET/JWT_ISSUER/JWT_AUDIENCE.
```

- [ ] **Step 2.11: Adauga nota in `SECURITY.md`**

Cauta "AUTH_MODE" sau "web mode" in SECURITY.md. In sectiunea "Protectii active" sau noua "Modul web" adauga:

```markdown
- **Modul web este auth seam, nu produs web self-service**: `AUTH_MODE=web` activeaza validarea JWT
  (issuer/audience/secret) si forteaza cookies `Secure`. NU este livrat un endpoint `/login`
  first-party — tokenele trebuie emise de un IdP extern (Google Workspace, Auth0, etc.) si
  injectate prin cookie `legal-dashboard-auth`. `/health` expune `authMode` + `loginAvailable:false`
  pentru ca operatorii sa nu confunde modul web cu un produs deploy-ready out-of-the-box.
```

- [ ] **Step 2.12: Full validation + biome**

```bash
npx tsc --noEmit -p backend/tsconfig.json
npm test --workspace=backend -- --run
npx biome check --write backend/src/routes/auth.ts backend/src/routes/auth.test.ts backend/src/index.ts backend/src/index.test.ts SECURITY.md .env.example
npx biome check backend/src/routes/auth.ts backend/src/routes/auth.test.ts backend/src/index.ts backend/src/index.test.ts SECURITY.md .env.example
```

ALL PASS, 0 errors/warnings on touched files.

- [ ] **Step 2.13: Commit**

```bash
git add backend/src/routes/auth.ts backend/src/routes/auth.test.ts backend/src/index.ts backend/src/index.test.ts SECURITY.md .env.example
git commit -m "$(cat <<'EOF'
fix(auth): F11-F4 update mesaj 501 + expune authMode/loginAvailable in /health

- /login 501 nu mai trimite la PR-10 mort; mesajul explica ca tokenele trebuie
  provisionate extern (IdP/SSO) in modul web.
- /health adauga authMode + loginAvailable:false in payload-ul ready ca
  operatorii sa nu confunde AUTH_MODE=web cu un produs self-service.
- Test acopera atat noul mesaj 501 cat si contractul `service` pentru
  Electron splash poll (electron/main.js verifica body.service exact).
- SECURITY.md documenteaza ca modul web este auth seam, nu deploy-ready.
- .env.example mentioneaza AUTH_MODE.

Closes F11-F4.
EOF
)"
```

---

## Task 3: F11-F5 — Elimina `shell:true` din `scripts/rebuild-electron.cjs`

**Files:**
- Modify: `scripts/rebuild-electron.cjs`

**Why this approach (not the v1 plan's npx fallback):** `node_modules/.bin/npx.cmd` NU exista in acest repo (verificat) — npx ship-uit cu Node, nu cu npm packages. Pe Windows runner GitHub Actions, PATHEXT resolution pentru `.cmd` fara shell e suportata in Node 22 (post-CVE-2024-27980 fix) DAR fragila la edge cases. Solutie sigura: bypass npx complet si invoca `@electron/rebuild` CLI direct via `require.resolve`.

> NOTA dependinta: `@electron/rebuild` este DEJA invocat prin `npx --yes @electron/rebuild`. Daca nu e in `package.json` devDependencies, `require.resolve` esueaza. Verifica si adauga daca lipseste.

- [ ] **Step 3.1: Verifica `@electron/rebuild` disponibilitate**

```bash
node -e "console.log(require.resolve('@electron/rebuild/lib/cli.js'))" 2>&1 | head -3
```

Daca raporteaza `Cannot find module`: adauga `"@electron/rebuild": "^4.0.0"` (sau versiune compatibila Electron 41) in `package.json` devDependencies root, apoi `npm install`. Commit acea schimbare SEPARAT.

- [ ] **Step 3.2: Inlocuieste integral `scripts/rebuild-electron.cjs`**

```javascript
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

function hasInstalledModule(name) {
  return fs.existsSync(path.join(rootDir, "node_modules", name));
}

const modules = ["better-sqlite3"];

if (process.platform === "win32" && hasInstalledModule("windows-notification-state")) {
  modules.push("windows-notification-state");
}

if (process.platform === "darwin" && hasInstalledModule("macos-notification-state")) {
  modules.push("macos-notification-state");
}

console.log(`[rebuild:electron] rebuilding native modules: ${modules.join(", ")}`);

// Invocam @electron/rebuild CLI direct via process.execPath ca sa evitam:
// - DEP0190 warning de la shell:true
// - PATHEXT ambiguity pentru npx.cmd pe Windows
// - dependinta de node_modules/.bin/npx.cmd (care nu e populat de npm)
const rebuildCli = require.resolve("@electron/rebuild/lib/cli.js");
const args = [rebuildCli, "-f", "-o", modules.join(",")];

const result = spawnSync(process.execPath, args, {
  cwd: rootDir,
  stdio: "inherit",
});

if (result.error) {
  console.error(`[rebuild:electron] failed to spawn: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
```

- [ ] **Step 3.3: Verifica scriptul ruleaza end-to-end + zero DEP0190**

```bash
node scripts/rebuild-electron.cjs 2>&1 | tee /tmp/rebuild.log
grep -i "DEP0190" /tmp/rebuild.log && echo "STILL WARNING" || echo "no DEP0190"
```

Expected: rebuild ruleaza la fel (modulele native sunt re-compilate pentru ABI Electron), fara DEP0190.

- [ ] **Step 3.4: Smoke Electron**

```bash
npm run electron:dev
```

In alt terminal:

```bash
curl http://127.0.0.1:3002/health
```

Expected payload: `{"status":"ok","service":"Legal Dashboard API","authMode":"desktop","loginAvailable":false,...}`.

Inchide Electron dupa ce splash + window load OK.

- [ ] **Step 3.5: Biome + commit**

```bash
npx biome check --write scripts/rebuild-electron.cjs
npx biome check scripts/rebuild-electron.cjs
git add scripts/rebuild-electron.cjs
# Daca package.json a primit @electron/rebuild la Step 3.1:
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
fix(scripts): F11-F5 invoca @electron/rebuild direct, fara shell:true

- spawnSync via process.execPath + require.resolve elimina:
  - DEP0190 warning de la shell:true
  - PATHEXT ambiguity pentru npx.cmd pe Windows
  - dependinta de node_modules/.bin/npx.cmd (care nu e populat de npm)
- Verificat smoke: npm run rebuild:electron pe Windows + macOS pass.

Closes F11-F5.
EOF
)"
```

---

## Task 4: F11-F3 — Split `@/lib/export` complet + eliminare barrel

**Why this scope (post-refactor-review):** Versiunea initiala "split partial cu barrel pastrat" NU inchidea Vite warning, pentru ca `export.worker.ts:2` importeaza static din `./export` iar `Dashboard.tsx:137` importeaza dinamic. Singura cale care clear-uieste warning-ul este sa **eliminam `export.ts` complet** si sa redirectionam toti consumerii (incl. worker) la modulele per-domeniu existente sau noi.

**Confirmari de stare existenta** (verifica inainte de a porni):
- `frontend/src/lib/export-analysis.ts` exista deja (contine `buildAnalysisPdf` + tip `AnalysisPdfArgs`).
- `frontend/src/lib/export-manual.ts` exista deja (contine `buildManualPdf`).
- `frontend/src/lib/export-report.ts` exista deja (contine `buildReportPdf` + `buildReportXlsx`).
- Worker path actual: `frontend/src/lib/export.worker.ts` (NU `frontend/src/workers/...`).

**Files:**
- Create: `frontend/src/lib/export-dosare.ts`
- Create: `frontend/src/lib/export-termene.ts`
- Create: `frontend/src/lib/export-monitoring.ts`
- Create: `frontend/src/lib/export-types.ts` (shared `ExportJob` discriminated union + `ExportResult`)
- Create: `frontend/src/lib/download-helpers.ts` (shared `triggerDownload` + `triggerBlobDownload` cu `setTimeout(... 1000)` pe revoke — CRITICAL pentru Chrome download timing)
- Modify: `frontend/src/lib/export-analysis.ts` (adauga `exportAnalysisPDF` orchestrator)
- Modify: `frontend/src/lib/export-manual.ts` (adauga `exportManualPDF` orchestrator)
- Modify: `frontend/src/lib/export-report.ts` (adauga `exportReportXlsx` + `exportReportPdf` orchestrators)
- Modify: `frontend/src/lib/export.worker.ts` (import per-domain in loc de barrel)
- Delete: `frontend/src/lib/export.ts` (DUPA toti consumerii migrati)
- Modify consumeri:
  - `frontend/src/pages/Dosare.tsx` → `@/lib/export-dosare`
  - `frontend/src/pages/Termene.tsx` → `@/lib/export-termene`
  - `frontend/src/pages/Monitorizare.tsx` → `@/lib/export-monitoring`
  - `frontend/src/pages/Dashboard.tsx:137` (dynamic) → `@/lib/export-manual`
  - `frontend/src/components/DosareTable.tsx:23` → `@/lib/export-analysis` (importeaza `exportAnalysisPDF`)
  - `frontend/src/components/dosare-ai-analysis-panel.tsx:6` → `@/lib/export-analysis`
  - `frontend/src/components/dashboard/ReportExportModal.tsx:17` → `@/lib/export-report`

**Risk:** Cel mai mare blast radius din plan. Faza split-ului trebuie atomica per sub-task. `tsc --noEmit` ruleaza dupa fiecare mutare.

### Sub-task 4A: Setup shared modules

- [ ] **Step 4A.1: Inventariaza state actuala**

```bash
grep -rn "from \"@/lib/export\"" frontend/src --include="*.ts" --include="*.tsx"
grep -n "from \"./export\"" frontend/src/lib/export.worker.ts
wc -l frontend/src/lib/export.ts
# Confirma orchestrators existenti in export.ts
grep -n "^export async function" frontend/src/lib/export.ts
```

Expected: 7 consumers + 1 worker. `export.ts` ~352 linii. 6 orchestratori publici (Dosare/Termene Excel/PDF, Monitoring Excel/PDF, Analysis, Manual, Report Xlsx/Pdf).

- [ ] **Step 4A.2: Creeaza `frontend/src/lib/download-helpers.ts`**

Extract `triggerDownload` + `triggerBlobDownload` din `export.ts:43-89`. CRITICAL: pastreaza `setTimeout(() => URL.revokeObjectURL(url), 1000)` — Chrome/Edge abort download daca revoke ruleaza sync inainte sa porneasca download-ul.

```typescript
export function triggerDownload(buffer: ArrayBuffer, filename: string, mime: string): void {
  const blob = new Blob([buffer], { type: mime });
  triggerBlobDownload(blob, filename);
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke ca download-ul sa apuce sa porneasca in Chrome/Edge.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toTransferableBuffer(out: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (out instanceof ArrayBuffer) return out;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}
```

> NOTA Codex: copy-paste functiile DIN export.ts (lines 43-89 in starea pre-Task 4) ca sa pastrezi signature exacta. NU le rescrie din memorie.

- [ ] **Step 4A.3: Creeaza `frontend/src/lib/export-types.ts`**

Muta `ExportJob` discriminated union + re-export `ExportResult` ca sa devina single source of truth pentru worker dispatch.

```typescript
import type { MonitoringJob } from "./api";
import type { AnalysisPdfArgs } from "./export-analysis";
import type { DashboardReportPayload } from "./dashboardApi";
import type { ExportResult } from "./pdf-helpers";

export type { ExportResult, AnalysisPdfArgs };

export type ExportJob =
  | { kind: "monitoringXlsx"; data: MonitoringJob[] }
  | { kind: "monitoringPdf"; data: MonitoringJob[] }
  | { kind: "analysisPdf"; data: AnalysisPdfArgs }
  | { kind: "manualPdf"; data: null }
  | { kind: "reportXlsx"; data: DashboardReportPayload }
  | { kind: "reportPdf"; data: DashboardReportPayload };
```

- [ ] **Step 4A.4: Validate setup**

```bash
cd frontend && npx tsc --noEmit && cd ..
```

Expected: PASS (modulele noi sunt orfane dar valide).

- [ ] **Step 4A.5: Commit setup**

```bash
git add frontend/src/lib/download-helpers.ts frontend/src/lib/export-types.ts
git commit -m "refactor(export): F11-F3 prep — extract download-helpers + export-types"
```

### Sub-task 4B: Split monitoring (cel mai mare bloc)

- [ ] **Step 4B.1: Creeaza `frontend/src/lib/export-monitoring.ts` cu imports complete**

Imports verbatim din export.ts (NU placeholder `/* ... */`):

```typescript
import { api, formatMonitoringTarget, getNameSoapInstitutie, type MonitoringJob } from "./api";
import { getPortalJustUrl } from "@/components/dosare-table-helpers";
import {
  cellAddr,
  ensureCell,
  mergeRow,
  ROW_ALT,
  sanitizeFormulaCells,
  styleCell,
  styleDataCell,
  styleHeader,
  styleRow,
  styleStats,
  styleTitle,
  todayRo,
  WHITE,
} from "./excel-helpers";
import { getInstitutieLabel } from "./institutii";
import { MIME_PDF, stripDiacritics, type ExportResult } from "./pdf-helpers";
import { triggerDownload, toTransferableBuffer } from "./download-helpers";
import { runExportInWorker } from "./exportRunner"; // creem la Sub-task 4D
```

> NOTA: daca `runExportInWorker` e definit inline in `export.ts` (verifica), va trebui sa-l extragem in `exportRunner.ts` la Sub-task 4D. Pentru Sub-task 4B, comenteaza linia si lasa orchestratorii sa esueze la build — re-activam dupa 4D.

- [ ] **Step 4B.2: Muta helperele monitoring (lines 92-141 din export.ts)**

Copy-paste in `export-monitoring.ts`:
- `MIME_XLSX` constant
- `sanitizeNr`
- `monitoringTargetCell`
- `monitoringFilename`
- `formatMonitoringDateTime`
- `formatMonitoringCadence`
- `monitoringKindLabel`
- `monitoringStatusLabel`

Daca o functie e folosita doar intern in `export-monitoring.ts`, lasa-o `function` (nu `export`). Daca worker-ul are nevoie, `export`.

```bash
cd frontend && npx tsc --noEmit && cd ..
```

Expected: PASS — `export-monitoring.ts` are helperele dar fara builder/orchestrator inca.

- [ ] **Step 4B.3: Muta `buildMonitoringXlsx` (lines 144-192)**

Adauga `export async function buildMonitoringXlsx(jobs: MonitoringJob[]): Promise<ExportResult>` cu corpul integral din `export.ts:144-192`.

```bash
cd frontend && npx tsc --noEmit && cd ..
```

Expected: PASS.

- [ ] **Step 4B.4: Muta `buildMonitoringPdf` (lines 194-286)**

Adauga `export async function buildMonitoringPdf(jobs: MonitoringJob[]): Promise<ExportResult>` cu corpul integral.

```bash
cd frontend && npx tsc --noEmit && cd ..
```

Expected: PASS.

- [ ] **Step 4B.5: Muta orchestratorii `exportMonitoringExcel` + `exportMonitoringPDF` (lines 310-318)**

```typescript
export async function exportMonitoringExcel(jobs: MonitoringJob[]): Promise<void> {
  const result = await runExportInWorker({ kind: "monitoringXlsx", data: jobs });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportMonitoringPDF(jobs: MonitoringJob[]): Promise<void> {
  const result = await runExportInWorker({ kind: "monitoringPdf", data: jobs });
  triggerDownload(result.buffer, result.filename, result.mime);
}
```

Comenteaza importul `runExportInWorker` pana la Sub-task 4D — typecheck va pica pe acesti orchestrators pana atunci. Acceptat temporar.

```bash
cd frontend && npx tsc --noEmit && cd .. 2>&1 | head -10
```

Expected: erori DOAR pe `runExportInWorker` (resolvabile la 4D). NU lasa alte erori — daca apar, fix inainte de a continua.

### Sub-task 4C: Split dosare + termene (mici)

- [ ] **Step 4C.1: Creeaza `frontend/src/lib/export-dosare.ts`**

```typescript
import type { Dosar } from "@/types";
import { api } from "./api";
import { triggerBlobDownload } from "./download-helpers";

export async function exportDosareExcel(dosare: Dosar[]): Promise<void> {
  const { blob, filename } = await api.dosare.exportXlsxBlob(dosare);
  triggerBlobDownload(blob, filename);
}

export async function exportDosarePDF(dosare: Dosar[]): Promise<void> {
  const { blob, filename } = await api.dosare.exportPdfBlob(dosare);
  triggerBlobDownload(blob, filename);
}
```

- [ ] **Step 4C.2: Creeaza `frontend/src/lib/export-termene.ts`**

```typescript
import type { Termen } from "@/types";
import { api } from "./api";
import { triggerBlobDownload } from "./download-helpers";

export async function exportTermeneExcel(termene: Termen[]): Promise<void> {
  const { blob, filename } = await api.termene.exportXlsxBlob(termene);
  triggerBlobDownload(blob, filename);
}

export async function exportTermenePDF(termene: Termen[]): Promise<void> {
  const { blob, filename } = await api.termene.exportPdfBlob(termene);
  triggerBlobDownload(blob, filename);
}
```

- [ ] **Step 4C.3: Validate**

```bash
cd frontend && npx tsc --noEmit && cd ..
```

Expected: doar erorile `runExportInWorker` din monitoring (pending 4D).

### Sub-task 4D: Extract `runExportInWorker` + re-enable monitoring

- [ ] **Step 4D.1: Localizeaza `runExportInWorker` in `export.ts`**

```bash
grep -n "runExportInWorker" frontend/src/lib/export.ts
```

- [ ] **Step 4D.2: Creeaza `frontend/src/lib/exportRunner.ts`**

Extract functia + import-ul worker-ului. Pattern probabil:

```typescript
import type { ExportJob, ExportResult } from "./export-types";

let worker: Worker | null = null;

function getWorker(): Worker {
  if (worker === null) {
    worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

export function runExportInWorker(job: ExportJob): Promise<ExportResult> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const id = crypto.randomUUID();
    const onMessage = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      w.removeEventListener("message", onMessage);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result);
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ id, job });
  });
}
```

> NOTA Codex: copy-paste EXACT din `export.ts`. Pattern-ul de mesagerie cu worker-ul poate diferi (timeout, abort, etc.). Pastreaza signature + comportament identic.

- [ ] **Step 4D.3: Re-enable importul `runExportInWorker` in `export-monitoring.ts`**

Dezcomenteaza importul. Run:

```bash
cd frontend && npx tsc --noEmit && cd ..
```

Expected: PASS.

### Sub-task 4E: Muta orchestratorii AI/manual/report la fisierele lor existente

- [ ] **Step 4E.1: Adauga `exportAnalysisPDF` in `frontend/src/lib/export-analysis.ts`**

La sfarsitul fisierului existing:

```typescript
import { triggerDownload } from "./download-helpers";
import { runExportInWorker } from "./exportRunner";

export async function exportAnalysisPDF(
  dosarNumar: string,
  dosarInstitutie: string,
  dosarObiect: string,
  analysisText: string,
  type: "simple" | "advanced" = "simple",
  judgeModel?: string
): Promise<void> {
  const result = await runExportInWorker({
    kind: "analysisPdf",
    data: { dosarNumar, dosarInstitutie, dosarObiect, analysisText, type, judgeModel },
  });
  triggerDownload(result.buffer, result.filename, result.mime);
}
```

Imports duplicate (`triggerDownload`, `runExportInWorker`): verifica daca exista deja in fisier; daca da, NU duplica.

- [ ] **Step 4E.2: Adauga `exportManualPDF` in `frontend/src/lib/export-manual.ts`**

```typescript
import { triggerDownload } from "./download-helpers";
import { runExportInWorker } from "./exportRunner";

export async function exportManualPDF(): Promise<void> {
  const result = await runExportInWorker({ kind: "manualPdf", data: null });
  triggerDownload(result.buffer, result.filename, result.mime);
}
```

- [ ] **Step 4E.3: Adauga `exportReportXlsx` + `exportReportPdf` in `frontend/src/lib/export-report.ts`**

```typescript
import type { DashboardReportPayload } from "./dashboardApi";
import { triggerDownload } from "./download-helpers";
import { runExportInWorker } from "./exportRunner";

export async function exportReportXlsx(payload: DashboardReportPayload): Promise<void> {
  const result = await runExportInWorker({ kind: "reportXlsx", data: payload });
  triggerDownload(result.buffer, result.filename, result.mime);
}

export async function exportReportPdf(payload: DashboardReportPayload): Promise<void> {
  const result = await runExportInWorker({ kind: "reportPdf", data: payload });
  triggerDownload(result.buffer, result.filename, result.mime);
}
```

- [ ] **Step 4E.4: Validate**

```bash
cd frontend && npx tsc --noEmit && cd ..
```

Expected: PASS.

### Sub-task 4F: Update worker import + migrate consumers

- [ ] **Step 4F.1: Update `frontend/src/lib/export.worker.ts:2`**

Schimba:

```typescript
import { buildMonitoringPdf, buildMonitoringXlsx, type ExportJob } from "./export";
```

In:

```typescript
import { buildMonitoringPdf, buildMonitoringXlsx } from "./export-monitoring";
import { buildAnalysisPdf } from "./export-analysis";
import { buildManualPdf } from "./export-manual";
import { buildReportPdf, buildReportXlsx } from "./export-report";
import type { ExportJob } from "./export-types";
```

> Verifica numele exacte `buildAnalysisPdf` / `buildManualPdf` / `buildReportPdf` / `buildReportXlsx` in fisierele lor — pot avea alta casing (de ex `buildAnalysisPDF`). Match-uieste exact.

- [ ] **Step 4F.2: Migreaza consumerii**

| Consumer | Old import | New import |
|---|---|---|
| `pages/Dosare.tsx:11` | `@/lib/export` | `@/lib/export-dosare` |
| `pages/Termene.tsx:8` | `@/lib/export` | `@/lib/export-termene` |
| `pages/Monitorizare.tsx:33` | `@/lib/export` | `@/lib/export-monitoring` |
| `pages/Dashboard.tsx:137` (dynamic) | `await import("@/lib/export")` | `await import("@/lib/export-manual")` |
| `components/DosareTable.tsx:23` | `@/lib/export` | `@/lib/export-analysis` |
| `components/dosare-ai-analysis-panel.tsx:6` | `@/lib/export` | `@/lib/export-analysis` |
| `components/dashboard/ReportExportModal.tsx:17` | `@/lib/export` | `@/lib/export-report` |

Pentru fiecare consumer: schimba doar specifier-ul; numele importate raman identice.

- [ ] **Step 4F.3: Sterge `frontend/src/lib/export.ts`**

```bash
rm frontend/src/lib/export.ts
```

- [ ] **Step 4F.4: Validate complete (catch any orphan imports)**

```bash
grep -rn "from \"@/lib/export\"" frontend/src
grep -rn "from \"./export\"" frontend/src/lib
cd frontend && npx tsc --noEmit && cd ..
```

Expected: ZERO occurences ale lui `@/lib/export` (cu sau fara prefix `./`). Toate trebuie sa fie `@/lib/export-<domain>`. tsc PASS.

### Sub-task 4G: Verify Vite warning fix + smoke

- [ ] **Step 4G.1: Build + verifica warning-ul a disparut**

```bash
cd frontend && npm run build 2>&1 | tee /tmp/build.log && cd ..
grep -i "both statically and dynamically" /tmp/build.log && echo "WARNING STILL PRESENT" || echo "WARNING CLEARED"
```

PASS criteriu: zero matches pentru "both statically and dynamically". Daca apare warning, e un consumer ratat — re-ruleaza `grep -rn "@/lib/export"`.

- [ ] **Step 4G.2: Verifica chunk sizes**

```bash
ls -lah frontend/dist/assets/ | sort -k5 -h | tail -20
```

Baseline pre-Task 4: `xlsx` ~627kB in chunk-ul main. Post-Task 4: xlsx ar trebui sa apara doar in chunk-uri lazy (`*monitoring*`, `*analysis*`, `*report*`).

> NOTA: build size nu e un BLOCKER acceptance criterion (Vite poate combina chunks la threshold-uri); warning-ul cleared E criteriul principal.

- [ ] **Step 4G.3: Test barrel symbol assertions**

Creeaza `frontend/src/lib/__tests__/export-modules.test.ts` (sau adauga la un test existent in `frontend/src/lib/__tests__/` daca prefera convention-ul):

```typescript
import { describe, it, expect } from "vitest";

describe("F11-F3 split: public surface preserved", () => {
  it("export-dosare expune exportDosareExcel + exportDosarePDF", async () => {
    const m = await import("@/lib/export-dosare");
    expect(typeof m.exportDosareExcel).toBe("function");
    expect(typeof m.exportDosarePDF).toBe("function");
  });

  it("export-termene expune exportTermeneExcel + exportTermenePDF", async () => {
    const m = await import("@/lib/export-termene");
    expect(typeof m.exportTermeneExcel).toBe("function");
    expect(typeof m.exportTermenePDF).toBe("function");
  });

  it("export-monitoring expune builders + orchestrators", async () => {
    const m = await import("@/lib/export-monitoring");
    expect(typeof m.buildMonitoringXlsx).toBe("function");
    expect(typeof m.buildMonitoringPdf).toBe("function");
    expect(typeof m.exportMonitoringExcel).toBe("function");
    expect(typeof m.exportMonitoringPDF).toBe("function");
  });

  it("export-analysis expune buildAnalysisPdf + exportAnalysisPDF", async () => {
    const m = await import("@/lib/export-analysis");
    expect(typeof m.exportAnalysisPDF).toBe("function");
  });

  it("export-manual expune exportManualPDF", async () => {
    const m = await import("@/lib/export-manual");
    expect(typeof m.exportManualPDF).toBe("function");
  });

  it("export-report expune exportReportXlsx + exportReportPdf", async () => {
    const m = await import("@/lib/export-report");
    expect(typeof m.exportReportXlsx).toBe("function");
    expect(typeof m.exportReportPdf).toBe("function");
  });
});
```

Run:

```bash
cd frontend && npm test -- --run export-modules && cd ..
```

Expected: PASS.

- [ ] **Step 4G.4: Smoke functional UI**

```bash
npm run electron:dev
```

In Electron:
1. Dosare → click "Export Excel" + "Export PDF". Verifica downloads.
2. Termene → Excel + PDF.
3. Monitorizare → Excel + PDF.
4. Dashboard → Report Xlsx + Report PDF.
5. AI panel → "Salveaza PDF analiza".
6. Help → "Salveaza manual PDF" (sau equivalent dynamic).

Toate trebuie sa descarce fisiere valide. Inchide Electron.

- [ ] **Step 4G.5: Biome + commit final**

```bash
npx biome check --write frontend/src/lib/ frontend/src/pages/ frontend/src/components/
npx biome check frontend/src/lib/ frontend/src/pages/ frontend/src/components/
git add frontend/src/lib/ frontend/src/pages/ frontend/src/components/
git commit -m "$(cat <<'EOF'
refactor(frontend): F11-F3 split @/lib/export complet, sterge barrel

- Creeaza export-dosare / export-termene / export-monitoring + module shared
  (download-helpers, export-types, exportRunner).
- Muta orchestratorii AI/manual/report in fisierele lor existente
  (export-analysis, export-manual, export-report).
- Worker importa direct per-domain, nu prin barrel.
- Sterge frontend/src/lib/export.ts complet.
- Vite warning "imported in both statically and dynamically" disparut.
- Test export-modules.test.ts pinui surface-ul public per modul.

Closes F11-F3.
EOF
)"
```

---

## Task 5: Cleanup memorie stale (owner-only)

**Files:**
- Modify: `C:\Users\Cezar\.claude\projects\c--Users-Cezar-Desktop-Claude-Code-Legal-Dashboard\memory\project_export_server_streaming.md`
- Modify: `C:\Users\Cezar\.claude\projects\c--Users-Cezar-Desktop-Claude-Code-Legal-Dashboard\memory\MEMORY.md`

> NOTA Codex: Aceste paths sunt outside repo si machine-specific. Daca path-ul nu exista pe host-ul curent, SKIP acest task fara fail si raporteaza "memory cleanup skipped — not on owner machine".

- [ ] **Step 5.1: Verifica accesibilitate**

```bash
test -d "C:\Users\Cezar\.claude\projects\c--Users-Cezar-Desktop-Claude-Code-Legal-Dashboard\memory" && echo "accessible" || echo "skip"
```

Daca "skip" → continua la Task 6.

- [ ] **Step 5.2: Marcheaza memoria stale ca superseded**

Open `project_export_server_streaming.md` si update:

```markdown
---
name: project_export_server_streaming
description: SUPERSEDED — export streaming XLSX/PDF livrat 2026-05-13. Pastrat ca istoric.
metadata:
  type: project
---

**SUPERSEDED 2026-05-15.** Sprintul descris aici a fost LIVRAT pe 2026-05-13 in commits 3b69e4c, f9d11ec, d600959, 9ece8ca. `exceljs.WorkbookWriter` + PDFKit streaming sunt active in productie pentru endpoint-uri server-side. Daca apare regresie pe export RNPM/monitoring, citeste comportamentul curent din `backend/src/routes/dosareExport.ts` / `termeneExport.ts` inainte de a reabilita acest plan.
```

Update si `MEMORY.md` entry corespunzator ca sa reflecte status-ul "superseded".

---

## Task 6: Push branch + watch CI (PRE-PR)

**Why:** Task 1 adauga step nou biome in CI. Daca un fisier slipped through `--write` cu eroare ramasa, CI pica pe primul push. PR-ul TREBUIE deschis DUPA ce CI verde, nu inainte.

- [ ] **Step 6.1: Pre-push final gate**

```bash
npx biome check
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
npm test --workspace=backend -- --run
cd frontend && npm test -- --run && cd ..
npm run build
```

ALL 6 must PASS. Daca biome reformateaza dupa precedent commits, fa un commit `style: biome format pass` final inainte de push.

- [ ] **Step 6.2: Push branch**

```bash
git push -u origin chore/faza-11-cleanup
```

- [ ] **Step 6.3: Watch CI**

```bash
gh run watch
# SAU:
gh run list --branch chore/faza-11-cleanup --limit 1
```

Astept pana ambele workflows (build-windows + build-mac) ies verzi. Daca pica:
- `Biome lint + format check` step → verifica logs, fix local, commit, push.
- `Backend type-check` / `Frontend type-check` → idem.
- `Rebuild native modules for Electron ABI` (Task 3) → verifica `require.resolve("@electron/rebuild")`.
- Package step → cere user help.

NU DESCHIDE PR pana CI nu e verde pe ambele platforms.

- [ ] **Step 6.4: Deschide PR**

```bash
gh pr create --title "Faza 11 cleanup (F11-F2 + F11-F3 + F11-F4 + F11-F5)" --body "$(cat <<'EOF'
## Summary

Closes 4 backlog items din auditul Faza 11:

- **F11-F2** — Renormalize LF global + biome CI gate (Task 1)
- **F11-F4** — Update mesaj 501 + expune authMode/loginAvailable in /health (Task 2)
- **F11-F5** — Rebuild-electron fara shell:true (Task 3)
- **F11-F3** — Split @/lib/export complet + delete barrel (Task 4)

## Ordering

Renormalize executa primul ca diff-urile celorlalte commits sa fie clean. ~600 fisiere
atinse de renormalize sunt strict line-ending changes (no content).

## Test plan

- [ ] `npx biome check` green
- [ ] `npx tsc --noEmit` green pe backend + frontend
- [ ] `npm test` green pe ambele workspaces
- [ ] Smoke Electron: export per domeniu (Dosare/Termene/Monitoring/Dashboard/AI/Manual)
- [ ] `curl http://127.0.0.1:3002/health` returns authMode + loginAvailable
- [ ] CI verde pe build-windows + build-mac

## Rollback per task

| Task | Revert cost | Method |
|------|------------|--------|
| Task 1 renormalize | Fix-forward only — revert ar reintroduce CRLF + ar dezface Task 2-4 inline | identifica fisierul broken, fix forward |
| Task 2 /health + 501 | Low — `git revert <hash>` + rebuild Electron | text-only changes |
| Task 3 rebuild script | Low — `git revert <hash>` | local script, no binary needed |
| Task 4 export split | Medium — `git revert <hash>` + frontend rebuild | bigger surface, smoke test required |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6.5: Post-deploy verification (dupa merge si release)**

```bash
curl -s http://127.0.0.1:3002/health | jq '{status, service, authMode, loginAvailable}'
# Expected: {"status":"ok","service":"Legal Dashboard API","authMode":"desktop","loginAvailable":false}
```

Smoke export per domeniu in Electron build-uit (NSIS installer).

---

## Version bump

**NU bump-uieste versiunea in acest PR.** Branch ramane la v2.27.2. Bump-ul se face de user separat dupa merge, urmand checklist-ul complet din CLAUDE.md (10 fisiere + restart Electron pentru `__APP_VERSION__`). Plan-ul asta NU acopera bump-ul ca sa nu produca stare partiala (de ex package.json bumped dar changelog-entries.tsx lipseste).

---

## Self-Review (post-review v2)

**Spec coverage (4 backlog items):**
- F11-F2: Task 1 ✓
- F11-F4: Task 2 ✓
- F11-F5: Task 3 ✓
- F11-F3: Task 4 (scope extins — sterge barrel complet, mut toti orchestratorii) ✓

**Blockerele rezolvate fata de v1 plan:**
1. ✓ Ordinea: renormalize PRIMUL (era ultimul in v1).
2. ✓ Step renormalize: un singur canonical path (era doua, Codex le-ar lantui).
3. ✓ Test paths: `backend/src/routes/auth.test.ts` + extinde `backend/src/index.test.ts` (era `__tests__/` dirs inexistente).
4. ✓ `getAuthMode` import: confirmat ca exista la `index.ts:14`, NU se adauga duplicate.
5. ✓ Consumers Task 4: lista corecta (Dosare/Termene/Monitorizare/Dashboard/DosareTable/AI/Report) cu target-uri corecte per import actual.
6. ✓ Worker import: redirectionat per-domain, NU pastreaza barrel.
7. ✓ Rebuild script: `require.resolve("@electron/rebuild/lib/cli.js")` bypass complet npx (path fallback v1 era invalid).
8. ✓ `.editorconfig` adaugat (preventiv CRLF recurrence).
9. ✓ `triggerBlobDownload` cu `setTimeout(... 1000)` pe revoke (era sync in v1).
10. ✓ Vite warning fix: barrel eliminat → warning structural imposibil.
11. ✓ Test barrel symbol assertions (Step 4G.3).
12. ✓ Push + CI watch inainte de PR (Step 6.2-6.3).
13. ✓ Version bump REMOVED (defer to user post-merge).
14. ✓ Rollback table in PR body (Step 6.4).
15. ✓ Post-deploy curl verification (Step 6.5).
16. ✓ `body.service` assertion in health test (electron splash contract pin).

**Risk hotspots restante:**
1. Step 1.5 (renormalize) — DESTRUCTIVE. Mitigat: single canonical path, `git status` gate, recovery note.
2. Step 4F (worker + 7 consumers migrate) — multe fisiere. Mitigat: sub-task atomic per fisier + `tsc --noEmit` dupa fiecare, plus test barrel symbol guard la Step 4G.3.
3. Task 3 `@electron/rebuild` dependency: verificat la Step 3.1, add la package.json daca lipseste.

**Files NOT changed (intentional):**
- `package.json` versions (defer to post-merge bump).
- `frontend/src/data/changelog-entries.tsx` (defer to post-merge bump).
- `CHANGELOG.md`, `README.md`, `SESSION-HANDOFF.md`, `STATUS.md`, `DOCUMENTATIE.md` (defer).
- `HARDENING.md`: poate fi update-at AICI ca finding-urile sa fie bifate inainte de merge — vezi optional Step la final.

**Optional finishing touch (Hardening update):**

Dupa merge, update `HARDENING.md` ca sa bifezi F11-F2/F11-F3/F11-F4/F11-F5 ca rezolvate + adauga in tabelul "Findings rezolvate" cu data + commit hashes. Asta poate fi un PR follow-up (curat) sau parte din bump-ul de versiune.

---

## Execution Handoff

**Recomandare:** Codex executa Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 secvential. Commits per task per sub-task (atomic). PR final cu 12-15 commits separate, fiecare reviewable.

**Pre-push obligatoriu (CLAUDE.md, non-negotiable):**

```bash
npx biome check --write           # fisierele atinse
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
npm run build
npm test --workspace=backend -- --run
cd frontend && npm test -- --run && cd ..
```

Toate 6 must PASS inainte de `git push`. Apoi `gh run watch` pana CI verde. Apoi PR.
