# CODEX TASK — Implementare: Web admin chei centralizate + buget per user (v2.30.0)

**Cum dispatch-uiesc eu (Cezar):** copiez sectiunea **"Prompt pentru Codex"** de la finalul acestui fisier in chat-ul Codex (cloud). Nu rula Agent local, Claude a pregatit doar pachetul. Codex face commit + push + `gh pr create`; eu doar aprob si fac merge.

---

## Context business

Clientul e o firma de avocatura care urmeaza sa primeasca aplicatia in mod **web** (SaaS-style intern). In web mode, **adminul tenantului** plateste si configureaza TOATE cheile API (Anthropic, OpenAI, Google, OpenRouter, 2Captcha, CapSolver). Userii non-admin NU mai vad modalul BYOK, NU mai trimit chei in body, consuma pe **buget zilnic per user** setat de admin in `/admin/quota`. Cheile se stocheaza in DB ca ciphertext AES-256-GCM, single-tenant-per-deploy. Desktop ramane **BYOK identic** — zero behavior change pe `AUTH_MODE=desktop`.

## Sursa de adevar

- PLAN: [PLAN-web-admin-keys.md](PLAN-web-admin-keys.md) — toate detaliile §0–§13 (schema DDL, crypto, repository, routes, fallback chain, quotaGuard, captcha flow, frontend, tests, DoD, riscuri, out-of-scope).
- Memorie persistenta: `project_web_admin_centralized_api_keys` (2026-05-19).
- Branch tinta: `feat/web-admin-keys-budget`.
- Base: `main`, currently v2.29.0 (commit `d65fe93` sau mai recent — `git pull` inainte de checkout).
- Target release: **v2.30.0**.

## Code orientation (verificat de Claude inainte de dispatch)

Findings concrete pe codul curent, ca sa nu pierzi timp pe orientare:

1. **`rejectApiKeysFromBodyInWebMode` exista si e activ.**
   - Definitie: [backend/src/routes/ai.ts:38](backend/src/routes/ai.ts#L38).
   - Apeluri: [backend/src/routes/ai.ts:156](backend/src/routes/ai.ts#L156) (POST `/ai/analyze`) si [backend/src/routes/ai.ts:225](backend/src/routes/ai.ts#L225) (POST `/ai/analyze-multi`).
   - **Nu il sterge.** Vezi PLAN §5 nota CRITIC: middleware-ul ramane activ in v2.30.0.

2. **`getApiKey` curent — fallback `env > body` per provider.**
   - Definitie: [backend/src/services/ai.ts:591](backend/src/services/ai.ts#L591).
   - Cod actual:
     ```ts
     export function getApiKey(provider: string, keys: Record<string, string>): string {
       if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY || keys.anthropic || "";
       if (provider === "openai") return process.env.OPENAI_API_KEY || keys.openai || "";
       if (provider === "google") return process.env.GOOGLE_AI_KEY || keys.google || "";
       if (provider === "openrouter") return process.env.OPENROUTER_API_KEY || keys.openrouter || "";
       return "";
     }
     ```
   - Schimba la chain-ul nou `env > tenant DB (in web mode) > body BYOK` conform PLAN §5.

3. **`requireRole("admin")` middleware exista si e deja folosit pe `/admin/*`.**
   - Definitie: [backend/src/middleware/requireRole.ts](backend/src/middleware/requireRole.ts).
   - Folosit la: [backend/src/routes/admin.ts:100](backend/src/routes/admin.ts#L100) (`adminRouter.use("*", requireRole("admin"))`).
   - Noile rute admin (`/keys`, `/keys/:field`, `/keys/captcha`) mostenesc automat gate-ul prin `adminRouter.use("*", ...)`.

4. **Migration runner exista; `.down.sql` ignorate la boot, dar prezente in real repo.**
   - Runner: [backend/src/db/migrations/runner.ts](backend/src/db/migrations/runner.ts) — discovery skip-uieste `.down.sql` ([linia 75](backend/src/db/migrations/runner.ts#L75)).
   - Test runner: [backend/src/db/migrations/runner.test.ts](backend/src/db/migrations/runner.test.ts) — verifica explicit ca `0001_baseline.down.sql` exista in real repo si ca discovery le ignora ([linia 333, 347](backend/src/db/migrations/runner.test.ts#L333)).
   - **Concluzie:** runner-ul NU executa automat down. Down-ul e operational (rollback manual). Pentru `0026` livreaza ambele fisiere si verifica manual local ca `down` sa nu lase orfani; ruleaza local `sqlite3 dev.db ".read backend/src/db/migrations/0026_tenant_api_keys.down.sql"` ca sanity check.

5. **Audit log pattern existent.**
   - Helper: `recordAudit(c, action, opts)` din [backend/src/db/auditRepository.ts](backend/src/db/auditRepository.ts) (import la [backend/src/routes/admin.ts:20](backend/src/routes/admin.ts#L20)).
   - Exemplu de scriere cu `targetKind`/`targetId`/`detail`/`outcome`: [backend/src/routes/admin.ts:160-178](backend/src/routes/admin.ts#L160).
   - Foloseste exact acelasi pattern pentru `admin.tenantKeys.update` si `admin.tenantKeys.captchaSettings.update`. **Plaintext nu intra niciodata in `detail`** — doar `last4`, `hadPrevious`, `field`.

6. **Captcha service ACCEPTA TRIPLET EXTERN — direct integration posibila.**
   - Signatura: [backend/src/services/captchaSolver.ts:249](backend/src/services/captchaSolver.ts#L249).
     ```ts
     export async function solveRnpmCaptcha(
       apiKey: string,
       provider: CaptchaProvider = "2captcha",
       fallbackKey?: string,
       signal?: AbortSignal,
       mode: CaptchaMode = "sequential"
     ): Promise<string>
     ```
   - NU citeste `process.env` pentru cheie. Caller-ul (rnpm.ts) il alimenteaza direct.
   - **Concluzie:** PLAN §7 e implementabil direct, fara refactor preliminar. `resolveCaptchaKeyForRoute` produce triplet-ul, caller-ul il forward-eaza la `solveRnpmCaptcha`.

7. **`rejectCaptchaKeyInWebMode` curent.**
   - Definitie: [backend/src/routes/rnpmGuards.ts:54](backend/src/routes/rnpmGuards.ts#L54) — returneaza 501 in web mode.
   - Apeluri: [backend/src/routes/rnpm.ts:1072](backend/src/routes/rnpm.ts#L1072) (`POST /rnpm/captcha/balance`) si in `withRnpmCaptchaGuards` pentru `/search` + `/bulk`.
   - **Inlocuieste** cu `resolveCaptchaKeyForRoute(c): CaptchaResolution` (PLAN §7). Discriminated union: `body` (desktop) | `tenant ok` | `tenant fail`. Pastreaza export-ul vechi ca thin wrapper compat pentru testele care inca pot referi numele (sau migreaza in acelasi commit).

8. **Pagini admin existente (template stilistic).**
   - [frontend/src/pages/admin/Audit.tsx](frontend/src/pages/admin/Audit.tsx)
   - [frontend/src/pages/admin/Quota.tsx](frontend/src/pages/admin/Quota.tsx)
   - [frontend/src/pages/admin/Users.tsx](frontend/src/pages/admin/Users.tsx)
   - Reuse layout, ratoaie tabel/form, hook pattern (`useQuery`/`useMutation`). Pagina noua `Keys.tsx` urmeaza acelasi schelet.

9. **CHANGELOG entry format (model recent: v2.29.0).**
   - Header: `## vX.Y.Z — YYYY-MM-DD`.
   - Paragraf scurt de framing (1-2 propozitii).
   - Sectiuni standard observate in v2.29.0: `### Livrabile`, `### Test coverage`, `### Verificare` (cu lista comenzilor rulate). Vezi [CHANGELOG.md](CHANGELOG.md) primele 35 linii pentru exemplu exact.

---

## Faza F1: DB foundation (commits 1-2)

Detalii complete: PLAN §1, §2, §3.

- **Commit 1 — `feat(db): migration 0026 tenant_api_keys + crypto helper`**
  - `backend/src/db/migrations/0026_tenant_api_keys.up.sql` + `.down.sql` (PLAN §1 DDL exact).
  - `backend/src/util/tenantKeyCrypto.ts` cu `getMasterKey()`, `encryptKey()`, `decryptKey()`, `resetMasterKeyCacheForTests()` (PLAN §2).
  - Boot guard in `backend/src/index.ts`: dupa `await runMigrations()`, daca `getAuthMode() === "web"` apeleaza `getMasterKey()` o data — fail fast pe `TENANT_KEY_ENCRYPTION_SECRET` lipsa.
  - `backend/src/util/tenantKeyCrypto.test.ts`: round-trip, missing master throws, wrong-length throws.

- **Commit 2 — `feat(db): tenantKeysRepository`**
  - `backend/src/db/tenantKeysRepository.ts` cu `getTenantKeys`, `setTenantKey`, `setCaptchaSettings`, `getDecryptedKey`, `invalidateCache` (PLAN §3).
  - Cache in-process + invalidate dupa fiecare write.
  - `setTenantKey` = UN SINGUR UPDATE atomic cipher+iv+tag (PLAN §3 atomicity note).
  - `backend/src/db/tenantKeysRepository.test.ts`: upsert, clear (`""` -> NULL), cache invalidation, atomic write.

## Faza F2: Routes admin/me (commit 3)

Detalii: PLAN §4 + test-on-save.

- **Commit 3 — `feat(api): admin /keys + me/key-status`**
  - Extinde [backend/src/routes/admin.ts](backend/src/routes/admin.ts) cu `GET /admin/keys`, `PUT /admin/keys/:field`, `PUT /admin/keys/captcha`. Reuse `limitAdminBody` (4 KiB).
  - Validare pre-persist: `backend/src/services/keyValidation.ts` cu `validateKey(field, value): Promise<{ valid: boolean; reason?: string }>` — ping providers (PLAN §4 endpoints + timeout 5s). 4xx auth -> 422 `INVALID_KEY`. Network error -> save accepted cu audit `detail.validationSkipped=true`.
  - Audit pe writes: pattern de la [backend/src/routes/admin.ts:160](backend/src/routes/admin.ts#L160). Detail: `{ field, hadPrevious: bool, last4After }`. Plaintext NU intra in audit.
  - Endpoint nou non-admin: `GET /me/key-status` in `backend/src/routes/me.ts` — shape din PLAN §4. Folosit de frontend pentru a decide BYOK vs "ask admin".
  - Tests: `backend/src/routes/admin.keys.test.ts` (shape, audit, 403 non-admin), `backend/src/routes/me.test.ts` extension (key-status shape).

## Faza F3: AI fallback + quota (commits 4-5)

Detalii: PLAN §5, §6.

- **Commit 4 — `feat(ai): getApiKey fallback chain + tenant DB`**
  - Refactor [backend/src/services/ai.ts:591](backend/src/services/ai.ts#L591) la chain `env > tenant DB (in web) > body BYOK` (PLAN §5).
  - **CRITIC — NU sterge `rejectApiKeysFromBodyInWebMode`.** PLAN §5 nota explicita: middleware-ul ramane activ ca defense-in-depth. Pastreaza testele existente `web-mode-rejects-body-keys.test.ts` neschimbate.
  - Mesaj `missingApiKey(c, provider)` ([backend/src/routes/ai.ts](backend/src/routes/ai.ts)) — in web mode: "Cheia AI nu e configurata. Contacteaza adminul pentru a o seta in /admin/keys."
  - Considera tenant DB ca "openrouter available" in `shouldRouteViaOpenRouter` (PLAN §5).
  - Tests: actualizeaza `ai.contract.test.ts` cu cazul web + tenant DB; pastreaza cazul desktop.

- **Commit 5 — `feat(ai): quotaGuard middleware + enforcement + /me/budget`**
  - `backend/src/middleware/quotaGuard.ts` cu signatura din PLAN §6.
  - `sumAiUsageMilliToday(ownerId, feature)` in `backend/src/db/aiUsageRepository.ts` (sau echivalent).
  - Aplica pe `/ai/analyze` (`quotaGuard("ai.single")`) si `/ai/analyze-multi` (`quotaGuard("ai.multi")`) inainte de handler.
  - Cod nou `QUOTA_EXCEEDED = "quota_exceeded"` in `backend/src/util/envelope.ts`. Raspuns 429 cu header `Retry-After: <seconds till midnight>`.
  - Endpoint `GET /me/budget` in `routes/me.ts` (PLAN §8.4 shape).
  - Tests: `backend/src/middleware/quotaGuard.test.ts` (sub limit, peste limita, desktop bypass), update `ai.contract.test.ts` cu 429 case.

## Faza F4: Captcha (commit 6)

Detalii: PLAN §7.

- **Commit 6 — `feat(rnpm): server-side captcha in web mode`**
  - Inlocuieste [backend/src/routes/rnpmGuards.ts:54](backend/src/routes/rnpmGuards.ts#L54) cu `resolveCaptchaKeyForRoute(c): CaptchaResolution` (PLAN §7 discriminated union).
  - Caller pattern in [backend/src/routes/rnpm.ts:1072](backend/src/routes/rnpm.ts#L1072) si in `withRnpmCaptchaGuards`: vezi PLAN §7 snippet caller.
  - **CRITIC verificat de Claude:** `solveRnpmCaptcha` la [backend/src/services/captchaSolver.ts:249](backend/src/services/captchaSolver.ts#L249) accepta triplet `(apiKey, provider, fallbackKey, signal, mode)` extern. NU citeste env. Integrare directa — nu necesita refactor preliminar.
  - Cod nou `CAPTCHA_NOT_CONFIGURED` (sau reuse existent daca exista) in `envelope.ts`. Raspuns 501 in web mode fara cheie tenant.
  - Body validator dropuieste tacit `captchaKey` din body in web mode (cu logging la `logger.info`, NU `console.log`).
  - Tests: `backend/src/services/captcha-web-flow.test.ts` (web ignora body, foloseste tenant; lipsa tenant = 501). Update `rnpm.contract.test.ts` la noul flow.

## Faza F5: Frontend (commit 7)

Detalii: PLAN §8.

- **Commit 7 — `feat(ui): admin keys page + hide dialog non-admin web + budget indicator`**
  - `frontend/src/hooks/useAuthMode.ts` — decizie simpla: `window.desktopApi !== undefined ? "desktop" : "web"` (PLAN §8.1). **NU** face API call.
  - `frontend/src/components/ApiKeyDialog.tsx` — guard la inceput: `if (authMode === "web" && role !== "admin") return null;` (PLAN §8.2).
  - `frontend/src/pages/admin/Keys.tsx` (nou) — reuse layout din `Users.tsx` / `Quota.tsx`. 6 chei + provider radio + mode radio. Submit per camp pe blur sau buton "Salveaza". `value === ""` = clear.
  - Routing in `frontend/src/App.tsx`: `<Route path="/admin/keys" element={<AdminKeys />} />` sub admin gateway.
  - Sidebar: adauga link "Chei API" in sectiunea admin existenta (Audit / Quota / Users).
  - `frontend/src/components/BudgetIndicator.tsx` (nou) — afiseaza `usedMilli / limitMilli`, polling 30s pe `/me/budget`, ascuns daca `limitMilli === null`. Plasare: footer la `Dosare.tsx` cand `authMode === "web"` (~30 LOC).
  - `frontend/src/hooks/useTenantKeys.ts` — wrapper pe `/admin/keys` GET/PUT.
  - Tests vitest frontend: `ApiKeyDialog.test.tsx` (3 cazuri), `admin/Keys.test.tsx`, `BudgetIndicator.test.tsx`.

## Faza F6: Docs + version bump (commit 8)

Detalii: PLAN §10.8 + CLAUDE.md "Checklist bump versiune".

- **Commit 8 — `docs(v2.30.0): web admin centralized keys + per-user budget`**
  - `package.json` (root + `backend/` + `frontend/`) bump 2.29.0 -> 2.30.0. Regenereaza `package-lock.json`.
  - `frontend/src/data/changelog-entries.tsx` — entry v2.30.0 (in-app changelog).
  - `CHANGELOG.md` — sectiune noua urmand formatul din v2.29.0: `### Livrabile`, `### Test coverage`, `### Verificare`. Vezi [CHANGELOG.md](CHANGELOG.md) primele 35 linii pentru ton + structura exacta.
  - `README.md` — update camp "Versiune curenta" + brief description.
  - `SESSION-HANDOFF.md` — context sprint inchis.
  - `STATUS.md` — "Data curenta" + "Versiune curenta reala" la varful fisierului.
  - `DOCUMENTATIE.md` — camp "Versiune curenta" din sectiunea "Descriere Generala".
  - `SECURITY.md` — entry pentru AES-256-GCM tenant secrets + master key in env (release security-relevant: noi surface auth/secrets/threat model).
  - `.env.example` — adauga `TENANT_KEY_ENCRYPTION_SECRET=<base64 32 bytes>` cu comentariu REQUIRED in web mode, OPTIONAL desktop + recomandare backup separat.
  - Sanity grep: `Grep -i "v2.29.0"` pe `.md` root — orice hit care nu e parte din istoric trebuie actualizat la v2.30.0.

---

## Workflow non-negotiable (per commit)

Aceste 4 lucruri NU se sar peste:

- `npx biome check --write` pe fisierele atinse (re-stage daca biome reformateaza).
- `npx tsc --noEmit` pe scope-ul relevant.
- `npm test` pe scope-ul atins (full suite la commit 8).
- Build curat (`npm run build`) la commit 8.

## Red zone — full stop, ask before committing

Doar lista asta blocheaza commit-ul. Restul = decide singur si avanseaza.

- Slabesti security: sterg `rejectApiKeysFromBodyInWebMode`, expun plaintext in audit, scoate `requireRole("admin")` de pe ruta, schimba algoritm crypto sub AES-256-GCM.
- Atingi `electron/` (orice fisier).
- Adaugi npm package nou (orice dependinta in package.json).
- Introduci multi-tenant (`tenant_id`, scope variabil) — explicit OUT in PLAN §13.
- Modifici desktop BYOK in mod user-visible.
- Inversezi `getApiKey` chain order (ex: BYOK > tenant > env).
- O piesa de infra promisa de PLAN (`runMigrations`, `recordAudit`, `safeStorage` IPC etc.) lipseste din repo.
- Migration 0026 schimba PK / scope altfel decat singleton.

## PLAN specs — default, deviaza doar cu nota in commit message

Tot ce e mai jos = PLAN sugereaza X. Daca ai motiv tehnic mai bun, alege Y si documenteaza in commit (`note: ... in loc de ..., motiv: ...`). NU intrerupe flow-ul.

- Audit log entries au `targetKind`, `targetId`, `detail` cu `field`/`hadPrevious`/`last4After` (PLAN §4).
- `INSERT OR IGNORE` pe bootstrap singleton row (PLAN §1 final line).
- `setTenantKey` = single atomic UPDATE pe cipher+iv+tag (PLAN §3).
- `getMasterKey()` apelat dupa `runMigrations()` la boot in web mode (PLAN §2). Daca alegi sa-l muti, pastreaza ordering-ul.
- Test-on-save validation pre-persist, 5s timeout, 4xx -> 422, network error -> accept cu audit warning (PLAN §4).
- `useAuthMode` = `window.desktopApi !== undefined` (PLAN §8.1). Daca preferi un alt detection mechanism, OK — dar fara API call sincron la fiecare render.
- Cache `tenant_api_keys` in-process cu `invalidateCache()` exportat pentru teste (PLAN §3).
- Single-instance per docker ramane statu-quo (PLAN §12).
- `node:crypto` pentru AES-256-GCM (suficient — vezi red zone "no new npm package").
- Migration 0026 livreaza atat `up` cat si `down`. Down testat local manual (`sqlite3 dev.db ".read 0026_*.down.sql"`).
- Master key recovery story documentata in `.env.example` + SECURITY.md (PLAN §0.9): pierderea master key = re-input manual din UI.
- Rotation master key + tenant-aggregate cap + captcha_usage tabel = explicit OUT din v2.30.0 (PLAN §13 + §0.10). Daca devine clar ca unul din ele e necesar mid-implementation, ridica intrebare (e in zona dintre red zone si normal, prefer un mesaj scurt inainte de a sari scope-ul).

## Acceptance / DoD

Copiat din PLAN §11, plus pasi PR:

- [ ] Migration 0026 up/down rulat local + restore din backup verificat.
- [ ] `TENANT_KEY_ENCRYPTION_SECRET` missing in web mode = boot fail cu mesaj clar.
- [ ] `GET /api/v1/admin/keys` NU returneaza plaintext sau ciphertext (verificat manual).
- [ ] `PUT /api/v1/admin/keys/:field` loggeaza audit fara plaintext (verificat in `audit_log`).
- [ ] AI call in web mode fara cheie configurata returneaza 400 cu mesaj "contacteaza adminul".
- [ ] AI call peste buget returneaza 429 + `Retry-After`.
- [ ] Captcha in web mode functioneaza fara `captchaKey` in body.
- [ ] Modal API keys ascuns pe web non-admin.
- [ ] Admin web vede `/admin/keys` si poate seta toate cele 6 chei + provider + mode.
- [ ] BudgetIndicator afiseaza corect pe web non-admin.
- [ ] Desktop comportament identic cu inainte (`tenant_api_keys` ramane gol, env optional).
- [ ] `rejectApiKeysFromBodyInWebMode` ramane activ; testele existente verde.
- [ ] 100% teste pass: `npm test --workspace=backend` (~270+ teste, target zero regressions) + `cd frontend && npm test -- --run`.
- [ ] biome + tsc + build curat.
- [ ] CHANGELOG + in-app changelog + bump versiune in toate fisierele din CLAUDE.md checklist.
- [ ] Branch push `origin feat/web-admin-keys-budget`.
- [ ] `gh pr create --title "feat(v2.30.0): web admin centralized keys + per-user budget" --body "..."` cu body referinta PLAN-web-admin-keys.md + CHANGELOG entry.
- [ ] PR URL raportat la Cezar.

## Workflow obligatoriu

1. `git checkout main && git pull`
2. `git checkout -b feat/web-admin-keys-budget`
3. Implementare commits 1-8 secventiali. Pentru fiecare commit:
   - Scrie codul + testele in scope.
   - `npx biome check --write <fisiere modificate>`
   - `npx tsc --noEmit -p backend/tsconfig.json` (sau `cd frontend && npx tsc --noEmit` pentru commits frontend).
   - `npm test --workspace=backend` (sau `cd frontend && npm test -- --run`) — scope-uit pe modulul atins, full suite la commit-uri mari.
   - `git add -A && git commit -m "..."`
4. La commit 8 (docs/bump): ruleaza FULL suite backend + frontend + `npm run build` + sanity grep pe `v2.29.0`.
5. `git push -u origin feat/web-admin-keys-budget`
6. `gh pr create --title "feat(v2.30.0): web admin centralized keys + per-user budget" --body "$(cat <<'EOF'
## Sumar

Livreaza PLAN-web-admin-keys.md §0-§13 (target v2.30.0). Web mode: admin tenant configureaza toate cheile AI + captcha din /admin/keys, stocate AES-256-GCM in tenant_api_keys. Userii non-admin nu mai vad modalul BYOK si consuma pe buget zilnic per feature setat de admin in /admin/quota.

## Schimbari principale

- Migration 0026 tenant_api_keys (singleton row, AES-256-GCM ciphertext+iv+tag pe coloane separate).
- backend/src/util/tenantKeyCrypto.ts (node:crypto, master key in env).
- backend/src/db/tenantKeysRepository.ts (cache in-proc + invalidate).
- routes/admin: GET/PUT /admin/keys + /admin/keys/captcha; routes/me: /me/key-status + /me/budget.
- services/ai.ts: getApiKey chain env > tenant DB (web) > body BYOK; rejectApiKeysFromBodyInWebMode ramane activ.
- middleware/quotaGuard.ts: 429 + Retry-After pe AI peste buget.
- rnpmGuards: resolveCaptchaKeyForRoute (discriminated union); solveRnpmCaptcha primeste tenant triplet in web mode.
- Frontend: /admin/keys page, ApiKeyDialog hide non-admin web, BudgetIndicator footer.

## Desktop impact

Zero. tenant_api_keys ramane gol, env vars optional, BYOK identic.

## Tests

Backend ~280+ teste pass (8 noi). Frontend +3 teste noi. biome curat, tsc curat, build curat.

## Docs

CHANGELOG.md, in-app changelog (frontend/src/data/changelog-entries.tsx), README, STATUS, DOCUMENTATIE, SESSION-HANDOFF, SECURITY, .env.example.
EOF
)"`
7. Raporteaza URL-ul PR la Cezar.

## Autonomie de decizie

**Default: decide singur si continua.** PLAN-ul este ghid, nu lege. Codex e senior engineer cu repo access, nu interim trimis dupa permisiuni la fiecare virgula.

**Decide autonom (NU intrerupe flow-ul, documenteaza in commit message):**
- Diferente minore PLAN vs cod real (semnaturi de functii, nume de helperi, locatii de fisiere)
- Refactor trivial sau non-trivial care e in serviciul feature-ului (rename, extract, type tightening, split de fisiere, choose between zod vs manual validation, etc.)
- Decizii de stil: structura componente, hook composition, naming convention, layout admin page
- Schema interna a payload-urilor `/admin/keys` / `/me/budget` daca PLAN-ul e ambiguu (alege shape-ul cel mai consistent cu envelope-ul existent)
- Adaugare helper-i / utility files care nu existau in PLAN dar usureaza implementarea
- Test fixtures, mocking strategy, setup/teardown
- Logger calls, error message wording (in romana, fara diacritice)
- Tip de cache (Map vs object), invalidation policy granular
- Daca PLAN cere "polling 30s" si tu vezi ca un SSE existent e mai natural, alege SSE — documenteaza in commit `feat: ... (note: SSE in loc de polling, mai consistent cu rnpmEvents)`
- Daca un test existent pica din cauza schimbarii LEGITIME a semanticii (ex: getApiKey acum citeste DB), update testul ca sa reflecte noua realitate — documenteaza in commit

**RED ZONE — opreste-te si raporteaza inainte de commit (puneti intrebare in chat Codex sau PR draft):**
- Schimbi semantica securitatii: sterg `rejectApiKeysFromBodyInWebMode`, expun plaintext in audit, scoate `requireRole("admin")` de pe vreo ruta, schimba algoritm crypto sub AES-256-GCM
- Atingi `electron/` (orice fisier)
- Adaugi dependency npm noua (orice package nou in dependencies / devDependencies)
- Introduci multi-tenant infrastructure (coloana `tenant_id`, scope variabil, etc.) — explicit OUT in PLAN §13
- Modifici comportamentul desktop (BYOK trebuie sa ramana 100% identic dupa PR)
- Migration 0026 trebuie sa schimbe structura PK / scope altfel decat singleton — ridica intrebarea
- Inverti rolul `getApiKey` chain (ex: BYOK > tenant > env in loc de env > tenant > BYOK)
- Gasesti ca o piesa de infra promisa in PLAN (ex: `runMigrations()`, `recordAudit`) nu exista deloc — opreste-te

In red zone: scrie comentariu / question si NU face commit pe acea bucata. Tot restul = avanseaza si livreaza.

## Out of scope (PLAN §13 reluat)

- Multi-tenant (`tenant_id` coloana peste tot).
- Cache distribuit Redis.
- Quota enforcement pe RNPM/captcha (doar AI in v2.30.0).
- Migrare automata env vars -> DB (operatorul muta manual la upgrade).
- Rotirea programata a master key-ului.
- UI dedicat pentru audit cheilor (deja vizibil in `/admin/audit` generic).
- Tenant-aggregate cap (PLAN §0.10 risc acceptat).

---

## Prompt pentru Codex (copy-paste in chat-ul Codex)

```
You are senior engineer with full repo write access. Ship v2.30.0 — web admin centralized API keys + per-user budget enforcement. Work autonomously, decide details yourself, do not ask for permission outside the explicit red zone below.

Read in order before coding:
1. CODEX-TASK-web-admin-keys.md (this brief — phases, file:line orientation, autonomy rules, DoD)
2. PLAN-web-admin-keys.md (full technical spec §0-§13)
3. CLAUDE.md (project rules: biome+tsc+build+test before push, version bump checklist)
4. CHANGELOG.md first 35 lines (v2.29.0 entry as format template)

Execute commits 1-8 sequentially on branch feat/web-admin-keys-budget. Per commit: biome check --write on touched files, tsc --noEmit, vitest in scope, git commit. Full build + full test at commit 8.

DEFAULT MODE: decide and proceed. PLAN is guidance, not contract. Minor signature differences, naming choices, file layout, refactor in service of the feature, picking between equivalent approaches, fixing tests broken by legitimate semantic changes, adding helper utilities — all your call. Document non-obvious decisions in the commit message ("note: ... in loc de ..., motiv: ..."). Do NOT pause for these.

RED ZONE — only stop and ask before committing if you'd:
- Remove or weaken rejectApiKeysFromBodyInWebMode, requireRole gating, audit redaction, AES-256-GCM
- Touch electron/ (any file)
- Add a new npm dependency
- Introduce tenant_id / multi-tenant infra (out of scope §13)
- Change desktop BYOK behavior in any user-visible way
- Find that a piece PLAN assumes exists (runMigrations, recordAudit, etc.) is actually missing
- Invert getApiKey chain order

Otherwise: implement, commit, advance.

When done: git push -u origin feat/web-admin-keys-budget, gh pr create with title + body from workflow step 6, reply with PR URL.

If a test breaks because of a LEGITIMATE semantic shift you made (e.g. getApiKey now reads DB), update the test to match the new reality and commit — that's not red zone.
```

---

Branch tinta: `feat/web-admin-keys-budget`
Target release: v2.30.0
Base: `main` (v2.29.0 sau mai recent)
