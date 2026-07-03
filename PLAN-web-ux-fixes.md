# PLAN — Web UX Fixes, Etapa 1 (target v2.41.0)

**Data**: 2026-07-03. **Status**: v2 — post review adversarial (review-panel: Opus 4.8, GPT-5.5,
Kimi K2.7, Qwen3.7; sinteza Fable 5). Pending aprobare user.

## Context

Prima sesiune reala de testare a aplicatiei web (post v2.40.1 deploy) a identificat 5 probleme.
Triaj agreat cu userul: **Varianta B** — doua etape.

- **Etapa 1 (acest plan, v2.41.0)**: fix-uri chirurgicale — #2 layout web, #3 chei tenant neconectate in frontend, #5 UX cote admin.
- **Etapa 2 (v2.42.0, plan separat)**: #1 provisionare useri din UI admin + #4 restructurare sidebar / "Setari" pe roluri.

Diagnosticele au fost produse prin doua workflow-uri multi-agent cu verificare incrucisata in cod;
planul v1 a trecut printr-un review adversarial multi-model — findings integrate mai jos (marcate `[RP]`).

## Constrangeri (non-negociabile)

1. **Zero modificari la Docker, Caddy, oauth2-proxy, ruta PAT** — infrastructura v2.40.1 ramane neatinsa.
   Toate schimbarile sunt in `frontend/src`, `backend/src` si documentatie.
2. **Desktop-ul ramane vizual si functional identic** — orice schimbare de comportament e gate-uita pe
   detectia de platforma sau pe `authMode`.
3. Conventiile proiectului: repository-only DB access, envelope `{ data, error, requestId }`, fara
   token-uri enum raw in DOM, biome + tsc + build + teste inainte de push.

## Invariant de platforma `[RP — adoptat]`

Exista azi TREI semnale divergente (`window.desktopApi`, `useAuthMode()`, `isWebRuntime()` in
ApiKeyDialog.tsx:121). Invariantul adoptat, documentat aici si aplicat consecvent:

- **`window.desktopApi`** = capabilitati de chrome Electron (drag strip, pt-8, safeStorage, notificari native).
- **`authMode === "web"`** = politica de chei si comportament API (tenant keys, guards, body-uri).
- `isWebRuntime()` din ApiKeyDialog se colapseaza in unul dintre cele doua (dupa semantica fiecarui uz).
- Combinatia dev "browser + backend desktop-auth" ramane suportata ca mediu de dezvoltare: layout web
  (fara drag strip), politica de chei desktop cu `encryptionUnavailable` — comportamentul actual, documentat.

## Asumptii

- `window.desktopApi` (expus de `electron/preload.js:22`) e deja folosit ca semnal in `Sidebar.tsx:104`.
- `GET /api/v1/me/key-status` (`backend/src/routes/me.ts:105-143`) e accesibil oricarui user autentificat
  si returneaza `tenantKeysConfigured: { anthropic, openai, google, openrouter, captcha }` — doar booleans.
  `[RP]` Trade-off asumat constient: orice user autentificat poate enumera CE capabilitati are tenantul
  (nu si valorile cheilor). Acceptat — informatia e oricum vizibila indirect din functionarea feature-urilor.
- Enum-ul de cota e fix: `QUOTA_FEATURES = ["ai.single", "ai.multi", "captcha.rnpm"]`
  (`backend/src/middleware/quotaGuard.ts:28`).
- `rejectCaptchaKeyInWebMode` are zero call-sites — verificat prin grep pe `backend/src` in faza de diagnostic.

---

## F2 — Layout web (problema #2)

### F2.1 Banda alba de sus (drag strip Electron randat in web)

- **Cauza**: `frontend/src/App.tsx:144` are `pt-8` neconditionat pe root; `App.tsx:148-151` randeaza
  un div fix de 32px cu `WebkitAppRegion: drag` (compensatie pentru `titleBarOverlay` din
  `electron/main.js:343-348`). In browser raman o banda goala.
- **Fix**: `const isDesktop = typeof window !== "undefined" && !!window.desktopApi;` in App;
  `pt-8` conditionat; drag strip wrapped in `{isDesktop && (...)}`.
- **Efect desktop**: niciunul.

### F2.2 Scala 112.5% in browser (default font 18px, compensat doar in Electron)

- **Cauza**: `useFontSize` are default step 1 = **18px** pe `document.documentElement`
  (`frontend/src/hooks/useFontSize.ts:21`; comentariul "(16px)" e stale). In Electron e mascat de
  `setZoomLevel(...)` = zoom 0.90 (`electron/main.js:377-381`), deci 16.2px efectiv. In browser
  compensarea nu exista → 112.5% si zoom-out manual.
- **Fix**: default diferentiat in `loadStep()`: desktop → step 1 (18px), web → step 0 (16px).
  `window.desktopApi` e global sincron, accesibil din `loadStep()` fara hook.
- `[RP High — adoptat]` **Default-ul singur e no-op pentru userii web existenti**: effect-ul de mount
  (`useFontSize.ts:29-34`) persista neconditionat step-ul curent, deci orice user web care a deschis
  aplicatia o data are deja `"1"` auto-scris in localStorage, iar `loadStep()` il onoreaza inaintea
  default-ului. Doua schimbari suplimentare:
  1. **Persistenta doar la alegere explicita** — mutata din effect-ul de mount in handlerul de schimbare
     (setStep). Default-urile nealese nu se mai scriu in storage.
  2. **Migrare one-time pe web** — flag `portaljust-font-size-migrated-v241`: daca flag-ul lipseste si
     `!window.desktopApi`, sterge valoarea stocata (a fost auto-persistata, nu aleasa — web-ul exista
     de prea putin timp ca sa existe alegeri reale de pastrat) si seteaza flag-ul.
     **Ordinea conteaza** `[RP blind-spot]`: migrarea ruleaza sincron in `loadStep()`/init, INAINTE de
     orice persist — altfel vechiul default in-memory o suprascrie imediat. Test dedicat cu cheia stale.
- `[RP Low — adoptat]` `loadStep` accepta non-intregi (`"1.5"` → `STEPS[1.5]` = undefined → NaN px):
  se adauga `Number.isInteger(n)`.
- **Alternativa respinsa**: eliminarea `setZoomLevel` din Electron + 16px peste tot — blast radius desktop.

### F2.3 Module inaccesibile in sidebar (fara scroll)

- **Cauza**: aside-ul (`frontend/src/components/Sidebar.tsx:137-141`) nu are scroll; root-ul App e
  `h-screen overflow-hidden` → continutul care depaseste viewport-ul e taiat. In web e agravat de
  sectiunea Administrare, vizibila doar acolo (`Sidebar.tsx:104-105, 201-229`).
- `[RP Medium — adoptat]` **Nu** `overflow-y-auto` direct pe aside (ar putea dezancora footerul si ar
  intra in conflict cu scroll-ul intern al accordionului de istoric, `Sidebar.tsx:233-236, 308`).
  **Fix**: wrapper `flex-1 min-h-0 overflow-y-auto` in jurul celor doua nav-uri + istoric; `SidebarFooter`
  ramane pinned in afara wrapperului. Comportament identic pe desktop cand continutul incape
  (scrollbar-ul apare doar la overflow); test vizual pe ambele platforme ca istoricul isi pastreaza
  scroll-ul intern.

---

## F3 — Chei tenant neconectate in frontend web (problema #3)

**Verdictul diagnosticului**: backend-ul e complet functional (RNPM rezolva cheia captcha din
`tenant_api_keys` ca sursa primara in web mode — `backend/src/routes/rnpmGuards.ts:257-273`, testat in
`rnpmGuards.test.ts:93-134`; AI rezolva env → tenant → body — `backend/src/services/ai.ts:634-646`).
Blocajul e exclusiv client-side; `GET /me/key-status` are zero consumatori in frontend.

### F3.1 Hook nou `useTenantKeyStatus`

- Fisier nou `frontend/src/hooks/useTenantKeyStatus.ts`: in `authMode === "web"` face
  `GET /api/v1/me/key-status`; in desktop returneaza starea `desktop` fara fetch.
- `[RP Medium — adoptat]` **Starea e cvadrivalenta, nu boolean**: `"loading" | "ready" | "error"` +
  `tenantKeysConfigured` cand ready. Politica de consum: **fail-open catre backend** — pe `loading`/`error`
  guard-urile client NU blocheaza (lasa request-ul sa plece; backend-ul e sursa de adevar si raspunde cu
  mesaje corecte). Badge-ul din sidebar arata stare neutra pe loading/error, nu "Neconfigurat".
- `[RP Medium — adoptat]` **Refresh wiring**: refetch la window focus si la deschiderea ApiKeyDialog;
  `refresh()` expus si apelat dupa mutatiile din pagina Admin → Chei API. Fara cache persistent.
- Unit tests: web fetch ok/eroare/loading, desktop no-fetch, refresh.

### F3.2 Sidebar badge alimentat corect in web

- `frontend/src/App.tsx:158` paseaza azi `hasApiKey={hasKey}` (permanent false in web) catre
  `SidebarFooter` (`frontend/src/components/sidebar-footer.tsx:87-95`).
- **Fix**: in web, `hasApiKey` = `cel putin o cheie AI tenant setata` (anthropic || openai || google ||
  openrouter). `[RP Low — adoptat]` Semantica ramane AI-only, identic cu desktop (`useApiKey.ts:206-207`) —
  un tenant doar-cu-captcha NU arata "Activ" fals. Starea captcha e vizibila separat in dialog (F3.4).
  Pe loading/error: badge neutru (fara "Neconfigurat").

### F3.3 Guard-urile RNPM devin web-aware

- `frontend/src/pages/RnpmSearch.tsx:98` (`runSearch`) si `:159` (`runSplit`): in web nu se mai
  blocheaza pe cheia locala. Gate: daca status e `ready` si `tenantKeysConfigured.captcha === false` →
  banner "Cheia captcha nu e configurata de administrator."; altfel request-ul pleaca.
- `[RP High — adoptat]` **`loadNextBatch` (`RnpmSearch.tsx:229`) primeste acelasi tratament** — altfel
  paginarea ("Incarca tot" + bucla de auto-load `:284-292`) devine no-op silentios in web dupa prima
  pagina: rezultate partiale cu buton mort, mai rau decat blocajul actual. Test dedicat pe paginare web.
- Butonul "Configureaza 2Captcha" (`RnpmSearch.tsx:332-336`) nu se randeaza in web.
- Acelasi tratament in `frontend/src/components/rnpm/RnpmBulkSearch.tsx:279` `[RP]` + audit la
  implementare pentru replay-ul din istoricul pending (orice alt call-site al guard-ului pe cheia locala).
- `[RP blind-spot — adoptat]` **Randarea erorilor 501/429**: erorile backend (`CAPTCHA_NOT_CONFIGURED`,
  cota 429 cu `Retry-After`) se afiseaza cu mesajul din envelope (backend-ul emite deja text in romana),
  nu reinterpretate ca "lipsa chei". Verificat in smoke web.

### F3.4 ApiKeyDialog: niciodata formularul BYOK in web

- Azi: `ApiKeyDialog.tsx:65` gate-uieste doar non-adminii (no-op silentios la click); adminul web vede
  formularul BYOK care minte ("cheile se salveaza local"), persist() esueaza silentios
  (`useApiKey.ts:151-156`), iar cheile din state se trimit in `body.apiKeys` la AI → 501
  `WEB_MODE_NOT_IMPLEMENTED` (`backend/src/routes/ai.ts:39-54`).
- **Fix**: in web, dialogul se deschide pentru TOTI userii, dar:
  - Sectiunile BYOK (formular chei AI, Rutare AI, provider/mod captcha, chei captcha) se inlocuiesc cu
    un **panou read-only** cu starea per cheie (bife din `/me/key-status`, fara valori) + textul
    "Cheile sunt gestionate de administratorul tenantului". Pentru admin, buton
    "Gestioneaza in Administrare → Chei API" care inchide dialogul (`onClose()`) inainte de `navigate()`
    `[RP Low — adoptat]`.
  - `[RP Medium — DECIS de user, 2026-07-03]` Panourile user-scoped in web:
    - **AI Usage** — ramane pentru toti userii web (usage propriu).
    - **Notificari email** — ramane pentru toti userii web (setare per user).
    - **Notificari sistem (native)** — se ELIMINA complet din dialog in web (feature Electron-only;
      bannerul "Indisponibil in browser" devine inutil daca sectiunea dispare).
    - **Acces API (token-uri PAT)** — devine **admin-only in web**; userii simpli nu vad sectiunea.
      Nota implementare: gate-ul e de UI in acest PR; daca backend-ul permite azi POST pe rutele PAT
      pentru non-admini, se adauga si guard server-side (`requireRole("admin")` conditionat pe web mode)
      ca gate-ul sa nu fie doar cosmetic — de verificat la implementare.

### F3.5 AI in web: hook-ul intreg devine tenant-aware `[RP High — reformulat integral]`

Review-ul a demontat fix-ul v1 ("sari verificarile de la :210"): `useDosareAi` deriva
`availableModels`/`availableJudgeModels`/`hasAnyKey` si effect-ul de sincronizare a selectiei
(`useDosareAi.ts:82-118, 136-152`) exclusiv din `apiKeys` locale (goale in web) — bypass-ul promptului
ar lasa dropdown-ul de modele GOL si analiza tot nu ar porni. Fix-ul real e o schimbare de semnatura:

- `UseDosareAiArgs` primeste `authMode` + `tenantKeyStatus` (sau hook-ul citeste intern
  `useTenantKeyStatus`).
- In web: `hasAnyKey` si listele de modele se deriva din `tenantKeysConfigured` (modelele providerilor
  cu cheie tenant setata; OpenRouter activ daca cheia openrouter e setata — backend-ul stie oricum sa
  ruteze, `ai.ts:673`).
- `apiKeys` se omite din body la `/ai/analyze` si `/ai/multi-analyze` **la nivelul hook/lib/api.ts**
  (`useDosareAi.ts:192, 244`), nu per-componenta.
- Prompt-ul de chei (`setShowKeyPrompt`) in web apare doar cand status e `ready` si nicio cheie AI
  tenant nu e setata; pe `loading`/`error` — fail-open (request-ul pleaca, backend-ul decide).
- Teste: disponibilitatea modelelor in web cu diverse combinatii de chei tenant; body fara `apiKeys`.

### F3.6 Backend: fallback race simetric, in resolver `[RP Medium — adoptat, mutat in resolver]`

- **Fix in `resolveCaptchaKeyForRoute`** (`rnpmGuards.ts:257-273`), nu in ramurile guard:
  return type extins cu `fallback2CaptchaKey?` derivat **simetric** din cheile tenant
  (provider capsolver + race → fallback twocaptcha; provider 2captcha + race → fallback capsolver —
  paritate cu desktop, `App.tsx:274-282`).
- `[RP Medium — adoptat]` In ramura `source === "tenant"`, campurile client
  (`captchaKey/captchaProvider/captchaMode/fallback2CaptchaKey`) se elimina din body-ul forwarded —
  `rnpm.ts:248` nu mai poate cadea pe valori din client in web mode. Se verifica la implementare ca
  `rnpm.ts` consuma output-ul guard-ului, nu body-ul brut.
- Teste noi in `rnpmGuards.test.ts`: ambele directii de fallback + body cu chei client ignorat in web.
- Nota (semnalat de panel, NU se rezolva aici — backlog separat): semantica de rezervare cota pe race
  (1 unitate/request vs 2 provideri lansati) e o intrebare pre-existenta, neatinsa de acest PR.

### F3.7 Igiena: cod orfan + documentatie stale

- Sterge `rejectCaptchaKeyInWebMode` (`rnpmGuards.ts:252-255`) — zero call-sites (verificat prin grep).
- Actualizeaza sectiunea "Web-mode 501 gate" din `CLAUDE.md`: gate-ul real e `resolveCaptchaKeyForRoute`
  cu tenant keys ca sursa primara; 501 doar cand cheia tenant lipseste.

### F3.8 Igiena: body curat in web

- `frontend/src/lib/rnpmApi.ts` (~140, 195, 494, 512): in web omite
  `captchaKey/captchaProvider/captchaMode/fallback2CaptchaKey` din body (elimina si `console.warn`-urile
  pe server la fiecare request). Devine redundant defensiv cu F3.6 (strip pe server) — se pastreaza ambele.

---

## F5 — UX Cote utilizatori (problema #5)

- **Cauza**: `frontend/src/pages/admin/Quota.tsx:285-292` — camp text liber pentru un enum inchis de 3
  valori; "RNPM" tastat → Zod respinge (`admin.ts:113`) → eroarea generica "Body invalid".
- **Fix**:
  - `<select>` cu cele 3 feature-uri, etichete umane: "AI — analiza individuala (ai.single)",
    "AI — analiza multipla (ai.multi)", "Captcha RNPM (captcha.rnpm)". Default `ai.single`.
  - Eticheta unitatii/placeholder din selectie (`limitUnitLabel` devine fiabil).
  - Helper text: `ai.*` = cost USD pe fereastra; `captcha.rnpm` = numar de captcha-uri pe fereastra.
  - `[RP Medium — adoptat]` **Edit path**: `startEdit` (`Quota.tsx:178-188`) prefill-uieste feature din
    randul existent; daca valoarea nu e in enum (rand legacy), se adauga ca optiune disabled-but-selected
    la editare (round-trip corect, fara upsert sub feature gresit).
- **Grants** (`Grants.tsx:259-267`): doar relabel pe cele DOUA optiuni existente (`ai.single`, `ai.multi`).
  `[RP conflict transat]` NU se adauga `captcha.rnpm` la Grants — granturile sunt denominate USD
  (`milliToUsd`) si guard-ul RNPM nu aplica extra-grant logic (`rnpmGuards.ts:95-97`); o optiune captcha
  ar fi inerta si gresit denominata. Grants ramane explicit AI-only.

---

## Plan de testare `[RP — extins]`

1. **Unit (vitest)**:
   - `useTenantKeyStatus`: web ok/eroare/loading, desktop no-fetch, refresh la focus/dialog.
   - Guard-uri RNPM web-aware: `runSearch`, `runSplit`, **`loadNextBatch` (paginare web)**, bulk.
   - `useDosareAi` in web: liste de modele din chei tenant (combinatii), body fara `apiKeys`,
     prompt doar pe ready+fara-chei.
   - `useFontSize`: default per platforma, **cheia stale `"1"` pe web e migrata** (ordinea
     migrare-inainte-de-persist), persist doar la alegere explicita, `Number.isInteger`.
   - `rnpmGuards`: fallback race ambele directii, strip body client pe ramura tenant.
   - Quota: select round-trip la edit, inclusiv rand cu feature non-enum.
   - Font-size web: assert programatic `document.documentElement.style.fontSize === "16px"` (nu vizual).
2. **Type-check + lint + build**: `npm run check`.
3. **Smoke desktop (Electron)**: layout identic (drag strip + pt-8 prezente, font Normal 18px,
   footer sidebar pinned), BYOK modal functional, cautare RNPM cu cheie locala + race fallback.
4. **Smoke web**: fara banda alba; fara zoom-out; sidebar scrollabil cu footer pinned; badge corect
   (inclusiv starea neutra pe loading); cautare RNPM completa **cu paginare**; analiza AI cu modele
   din chei tenant; erorile 501/429 afisate cu mesajul backend; Cote: select + salvare fara "Body invalid";
   dialog "Setari API" read-only + link admin functional.
5. **Regresie**: `scripts/smoke-deploy.*` raman verzi (nu se ating rutele/infra).

### Mediu de test web local (fara Docker/Caddy)

Script nou `scripts/dev-web-local.ps1` care ridica un server web local complet, simuland oauth2-proxy:

1. Porneste backend-ul local in web mode: `LEGAL_DASHBOARD_AUTH_MODE=web`,
   `LEGAL_DASHBOARD_JWT_SECRET`, `TENANT_KEY_ENCRYPTION_SECRET`,
   `LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET` (bind 127.0.0.1 — nu necesita `ALLOW_REMOTE`).
2. Seed admin initial via `scripts/seed-admin.mjs` daca userul nu exista.
3. Mint sesiune: `POST /api/v1/auth/oauth2/sync` cu `Authorization: Basic` + `X-Forwarded-Email`
   (exact request-ul oauth2-proxy din productie, `auth.ts:206`) → cookie `legal_dashboard_session`
   afisat pentru a fi setat in browser (sau instructiuni devtools).
4. Frontend: build servit de backend (`dist-frontend`) sau Vite dev 5173 cu proxy — cookie-ul pe
   `127.0.0.1` e valabil indiferent de port.

Cu el se smoke-uiesc toate flow-urile web reale (layout, chei tenant, RNPM cu captcha real, AI, cote)
inainte de deploy. Scriptul e doar tooling de dev — nu atinge productia.

## Rollout

- Branch `fix/v2.41.0-web-ux`, PR pe main (schimbari de cod → PR obligatoriu).
- Checklist bump versiune din CLAUDE.md (package.json x3, changelog-entries.tsx, CHANGELOG.md,
  README.md, SESSION-HANDOFF.md, STATUS.md, DOCUMENTATIE.md; CLAUDE.md — sectiunea stale de la F3.7).
- Fara migrari DB, fara env vars noi, fara schimbari Docker/Caddy → deploy = imagine noua din
  pipeline-ul existent.

## Out of scope (Etapa 2, plan separat)

- POST /admin/users + formular creare useri (problema #1).
- Restructurare sidebar + pagina "Setari" pe roluri (problema #4); reamplasarea intrarii "Setari API".
- Semantica rezervarii de cota captcha pe race mode (backlog, semnalat de review-panel).
- **Istoricul de cautari din sidebar e localStorage per browser** (`useSearchHistory`/`useRnpmHistory`):
  in web nu e per user — pe un calculator partajat istoricul ramane dupa logout si e vizibil urmatorului
  user logat. Etapa 2: mutare server-side owner-scoped sau minim clear la logout / namespacing pe user.
