# PLAN — Web UX Etapa 2: management useri + "Setari" pe roluri (target v2.42.0)

**Data**: 2026-07-04. **Status**: v2 — post review adversarial (review-panel: Opus 4.8 +
GPT-5.5 + Kimi K2.7 + GLM 5.2 + Qwen3.7, sinteza Fable 5); findings integrate mai jos `[RP]`.
**Predecesor**: PLAN-web-ux-fixes.md (Etapa 1, PR #65). Constrangerile raman identice:
zero schimbari Docker/Caddy/oauth2-proxy; desktop-ul Electron ramane vizual si functional
identic (schimbarile de mai jos sunt web-only, gated pe semnalele stabilite in Etapa 1).

## Scope

- **E2-A: Provisionare useri din UI (problema #1)** — azi singura cale e `seed-admin.mjs` + SQL
  manual pe server; bridge-ul oauth2 e fail-closed pe useri existenti.
  - **A1 — individual**: formular "Adauga utilizator" (email + nume afisat + rol) in pagina
    Utilizatori; backend `POST /api/v1/admin/users`.
  - **A2 — bulk din Excel** (cerinta user 2026-07-04): buton "Descarca template" (xlsx generat
    de aplicatie: coloane Email, Nume afisat, Rol) + upload fisier completat; backend parseaza
    si creeaza userii, cu raport per rand (creat / duplicat / invalid).
- **E2-B: "Setari" pe roluri (problema #4)** — in web, sectiunea Administrare dispare din
  sidebar; intrarea "Setari API" devine "Setari" si deschide o pagina cu tab-uri, cu continut
  in functie de rol.

## Asumptii si fapte verificate

- `insertUser` / `getUserByEmail` exista in `userRepository.ts`; `adminRouter` e montat sub
  `requireRole("admin")`.
- `[RP High — adoptat]` **Unicitatea emailului devine garantie de DB, nu check-then-insert**:
  migration noua `0040_users_email_unique` cu `CREATE UNIQUE INDEX ... ON users(email COLLATE
  NOCASE)` (interdictia initiala de migrari era auto-impusa si gresita — orice garantie de
  identitate a bridge-ului fail-closed sta pe unicitatea asta). Daca indexul nu se poate crea
  (dubluri istorice), migration-ul esueaza LOUD cu instructiuni in RUNBOOK; pre-migration
  backup exista deja automat. Insert-urile trateaza violarea de index ca "duplicat" (409 /
  rand `duplicate_in_db`), inchizand si race-ul intre request-uri concurente.
- `[RP Medium — adoptat]` **Canonicalizator unic de email**: `canonicalizeEmail()` exportat
  (`trim().toLowerCase()`) folosit IDENTIC la creare individuala, import, si in lookup-ul
  bridge-ului oauth2 (care azi face deja lowercase — se muta pe helperul comun);
  `getUserByEmail` primeste `COLLATE NOCASE` ca defense-in-depth. Test cu rand mixed-case
  pre-existent.
- Parsare Excel server-side: pattern existent `services/nameListParser.ts` cu `exceljs`
  (migrat de la `xlsx` in v2.6.4 tocmai pentru inputul userului). Template generat tot cu
  `exceljs` (server, endpoint GET) — un singur loc care cunoaste formatul.
- `[RP Medium — adoptat]` **Roluri creabile: whitelist unic `user | admin`** folosit de AMBELE
  cai (individual si bulk). `USER_ROLES` contine si `support`/`readonly`, dar ele NU sunt
  creabile din UI (un rand de import cu alt rol => `invalid` cu motiv uman); rolurile existente
  raman schimbabile din tabelul Users ca azi.
- `[RP blind-spot — verificat]` `password_hash = null` e sigur: web nu are login cu parola
  (POST /auth/login raspunde explicit "Login first-party nu este livrat"), identitatea vine
  exclusiv din bridge-ul oauth2.
- `[RP Medium — invariant documentat]` **Adminul controleaza provisionarea, IdP-ul controleaza
  identitatea**: un user creat devine imediat logabil DACA trece de Google + oauth2-proxy
  (config-ul proxy-ului, inclusiv eventuala restrictie de domeniu, ramane neatins — Etapa 2
  nu schimba infra). UI-ul afiseaza emailul exact cum a fost creat, adminul e responsabil.

## E2-A1 — POST /api/v1/admin/users (individual)

- **Validare comuna** `[RP Low — adoptat]`: modul partajat (schema Zod) pentru
  `{ email, displayName, role }` folosit de creare individuala SI de fiecare rand din import:
  email valid max 254 + canonicalizat; displayName trim 1..120; role in whitelist creabil.
- **Backend** (`routes/admin.ts`): `POST /users`, body Zod `.strict()` pe schema comuna.
  Duplicat → 409 `{ code: "email_exists" }` care include si **statusul randului existent**
  `[RP Medium — adoptat]` (un email suspendat/dezactivat nu e fundatura: mesajul indica
  actiunea "reactiveaza din tabel", nu se creeaza al doilea rand). Insert cu
  `id = crypto.randomUUID()`, `status = "active"`, `password_hash = null`; violarea de index
  unique mapata tot la 409 (race-ul concurent). Audit `admin.users.create` cu
  `targetKind: "user"`, `targetId: <id>`, `detail: { email, role }` `[RP Medium — adoptat]`.
- **Frontend** (`pages/admin/Users.tsx`): card "Adauga utilizator" deasupra tabelului:
  email + nume + rol (select cu etichete umane) + buton; dupa succes refresh lista + mesaj
  "Userul se poate loga cu contul Google <email>". Erorile 409 afisate ca atare.

## E2-A2 — bulk import din Excel

- **Template**: `GET /api/v1/admin/users/import-template` — xlsx generat cu `exceljs`:
  sheet "Utilizatori" DOAR cu header `Email | Nume afisat | Rol` `[RP Low — adoptat:
  fara rand exemplu importabil]`; exemplul si valorile valide de rol stau intr-un sheet
  separat "Instructiuni" pe care importul il ignora complet.
  `Content-Disposition: attachment; filename="template-utilizatori.xlsx"`.
- **Upload**: `POST /api/v1/admin/users/import` — body raw xlsx
  (`Content-Type: application/octet-stream`), citit cu `c.req.arrayBuffer()` si limitat de un
  **`bodyLimit` dedicat de 512KB** (NU `limitAdminBody` de 4KB) `[RP Medium — adoptat;
  referinta initiala la "bulk-urile existente" era gresita — nameListParser accepta 10MB,
  aici 512KB ajunge pentru sute de randuri]`.
- **Parsare** `[RP Medium — adoptat]`: reuzeaza mecanismele din nameListParser — detectie
  magic-bytes (respinge non-xlsx cu 400, nu 500), timeout de parsare (30s), `workbook.xlsx.load`
  in try/catch mapat la 400 "fisier corupt". Cap: max 500 randuri de date (peste => 413).
- **Pipeline determinist** `[RP Medium — adoptat]`: (1) citeste randurile sheet-ului
  "Utilizatori"; (2) canonicalizeaza email per rand; (3) valideaza pe schema comuna
  (rol gol => `user`; rol in afara whitelist-ului => `invalid`); (4) dedup in-fisier pe emailul
  canonic (al doilea+ => `duplicate_in_file`); (5) check DB; (6) insert-urile randurilor
  valide ruleaza intr-O SINGURA tranzactie `better-sqlite3` (sincrona — fara await inauntru);
  statusurile `created` se emit DOAR dupa commit; o eroare de DB in tranzactie face rollback
  complet si raportul intoarce eroarea batch-ului (fara `created` partial mintit).
  Clasificare per rand: `created | duplicate_in_db (cu statusul existent) | duplicate_in_file
  | invalid (motiv uman)`.
- **Audit** `[RP Medium — adoptat]`: un eveniment `admin.users.import` cu sumarul
  `{ created, duplicates, invalid, total }` PLUS cate un `admin.users.create` per user creat
  (targetId + email + rol) — calea care provisioneaza mai multe login-uri nu inregistreaza
  mai putina identitate decat cea individuala.
- **Frontend** (in cardul "Adauga utilizator"): sub formular, zona "Import din Excel":
  link "Descarca template", input file `.xlsx`, dupa upload tabel-raport per rand cu
  statusuri colorate (pattern existent: MonitoringBulkImportCard). Refresh lista la final.

## E2-B — pagina "Setari" pe roluri (web-only)

- **Ruta noua `/setari`** (`pages/Settings.tsx`): bloc nou in switch-ul manual pe `pathname`
  din AppShell `[RP Medium — specificat]`, randat DOAR cand runtime-ul e browser
  (`!window.desktopApi`); pe desktop ruta nu exista (nimic nu navigheaza la ea).
  Nota: paginile admin sunt importate eager azi (App.tsx) — nu exista lazy chunks de protejat.
- **Tab-uri cu `?tab=` query param** `[RP Low — adoptat]` (deep-link + refresh persistent,
  zero sub-rute): `?tab=general|utilizatori|chei|cote|granturi|consum|audit`.
  - **General** (toti userii): status chei tenant read-only (extras din ApiKeyDialog intr-o
    componenta `TenantKeyStatusPanel` reutilizata de ambele), AI Usage, Notificari email;
    pentru admin si panoul PAT.
  - **Admin-only**: Utilizatori, Audit, Cote, Granturi, Consum, Chei API.
    `[RP High — adoptat]` Continutul NU e pagina intreaga: componentele de pagina primesc
    prop `embedded` care suprima shell-ul propriu (h1 + padding-ul de pagina + max-width) —
    fara titluri duble si fara padding dublu; se randeaza DOAR tab-ul activ (mount-on-demand,
    deci fara fetch-uri eager pe toate 6). `[RP Medium — adoptat]` Fiecare tab admin e wrapped
    in `AdminGate` (acelasi guard + mesaj ca deep-link-urile; serverul ramane autoritativ).
- **Sidebar (web)**: sectiunea Administrare (6 iteme) DISPARE; in footer, intrarea
  "Setari API" devine "Setari" si face `navigate("/setari")` in loc sa deschida dialogul
  (`SidebarFooter.onConfigureApiKey` — comportament decis in AppShell:
  `isDesktop ? deschide dialogul : navigate("/setari")`). Badge-ul de chei ramane.
- `[RP Medium — adoptat]` **Toate call-site-urile dialogului devin web-aware**: inventar
  `handleOpenKeyDialog` (sidebar footer, prompt-ul de chei din Dosare, butonul "Configureaza
  2Captcha" din RNPM — vizibil doar pe BYOK): in web navigheaza la `/setari` (tab General);
  pe desktop deschid dialogul ca azi. In web NU mai exista doua experiente de setari paralele.
- **Desktop**: neatins — fara ruta /setari, label neschimbat, dialogul BYOK ramane.
- **Compatibilitate**: rutele `/admin/*` RAMAN functionale (deep links) — pagina /setari e
  poarta canonica, dar nu sparge nimic existent.

## Ce NU intra (explicit)

- Stergere useri / dezactivare in masa (statusul se schimba deja per user din tabel).
- Invitatii pe email / notificarea userului creat (nu exista cerinta; bridge-ul il lasa sa
  intre imediat ce exista in DB).
- Restructurarea sidebar-ului pe desktop.
- Sanitizare activa de formule in displayName `[RP conflict transat]`: read-path-ul e sigur
  (validarea respinge formule pe email, React randeaza text); riscul rezidual e doar la un
  eventual re-export viitor, acoperit deja de escape-ul global XLSX la scriere.

## Testare `[RP — extins]`

- Backend: POST /users (creare, 409 duplicat CU status, 409 pe rand mixed-case pre-existent,
  validari, audit cu targetId, **race concurent → al doilea insert primeste duplicat, nu 500**),
  import (template e xlsx valid cu sheet Instructiuni ignorat; parse:
  creat/duplicat-db/duplicat-fisier/invalid; rol `readonly`/`support` in fisier => invalid;
  cap 500 => 413; fisier corupt/non-xlsx => 400 mapat, nu 500; limita 512KB distincta de
  limitAdminBody; email normalizat; tranzactie — eroare DB => rollback fara `created` mintit),
  migration 0040 (index unique NOCASE; insert duplicat case-different => eroare de constrangere).
- Frontend: formular add (validare + 409 afisat), flux import (mock API, raport per rand),
  pagina /setari (tab-uri pe rol: non-admin nu vede tab-urile admin; `?tab=` deep-link;
  tab admin wrapped in AdminGate), sidebar web fara sectiunea Administrare + "Setari" navigheaza.
- Smoke pe serverul web local (dev-web-local + proxy): template descarcat, fisier completat
  incarcat, useri creati vizibili; login-ul unui user nou creat prin bridge
  (X-Forwarded-Email pe emailul proaspat creat) intra fara "Acces refuzat".
- Desktop: sidebar identic (fara /setari, dialog BYOK neschimbat).

## Rollout

- Acelasi branch `fix/v2.41.0-web-ux` NU — branch nou `feat/v2.42.0-users-settings` peste
  main DUPA merge-ul PR #65, SAU peste branch-ul PR #65 daca merge-ul intarzie (decizie la
  implementare in functie de starea PR-ului; default: peste PR #65 ca sa poata fi testat
  imediat pe serverul local existent).
- Version bump v2.42.0 cu checklist-ul standard la final.
