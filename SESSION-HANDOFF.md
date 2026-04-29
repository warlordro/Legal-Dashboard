# Session Handoff - PR-6 livrat / PR-7 urmator

**Data**: 2026-04-30
**Branch local**: `main`
**Remote**: `origin/main` sincronizat
**Versiune curenta**: `v2.4.1`
**Ultimele commituri**:

- `cc2098f fix(alerts): show numeric sidebar badge`
- `08cbdad feat(monitoring): add alerts inbox`
- `58b3461 Merge release/v2.4.0-pr5-docs-fixes`

## TL;DR

PR-6 este implementat, testat, commit-uit si push-uit pe `main`.

Aplicatia are acum:

- pagina `Alerte` cu inbox paginat;
- filtre dupa tip, severitate, interval, doar necitite si include dismissed;
- actiuni `Citit` si `Inchide`;
- badge numeric rosu in sidebar pentru alerte active necitite;
- badge numeric si in modul sidebar colapsat, peste iconita clopotel;
- SSE live pe `/api/v1/alerts/stream` cu reconnect/backoff;
- notificari native Electron prin IPC `desktopApi.showNotification`;
- fallback Web Notification pentru dev/web.

Repo-ul a ramas cu politica agreata: un singur `main`, fara branch-uri temporare remote.

## Status curent

- `git status --short --branch`: curat, `main...origin/main`.
- Electron este pornit in sesiunea curenta.
- `/health`: `ok`, `monitoring.enabled=true`, `monitoring.running=true`, `inflight=0`.
- Port backend: `127.0.0.1:3002`.

## Validari rulate

- `npm test --workspace=backend -- src/db/monitoringAlertsRepository.test.ts src/routes/alerts.test.ts`
  Rezultat: 13/13 teste trecute.
- `npm test --workspace=backend`
  Rezultat: 424/424 teste trecute.
- `npm exec tsc --workspace=backend -- --noEmit`
  Rezultat: trecut.
- `npm exec tsc --workspace=frontend -- --noEmit`
  Rezultat: trecut.
- `npm run build`
  Rezultat: trecut.
- `npm run rebuild:electron`
  Rulat dupa testele Node ca sa refaca ABI-ul `better-sqlite3` pentru Electron.
- Smoke Electron desktop:
  - pornire cu `ELECTRON_RUN_AS_NODE` curatat;
  - `/health` 200;
  - `/api/v1/alerts?page=1&pageSize=1` 200;
  - scheduler running.

## Ce s-a schimbat in PR-6

### Backend

Fisiere principale:

- `backend/src/db/monitoringAlertsRepository.ts`
- `backend/src/routes/alerts.ts`
- `backend/src/routes/alerts.test.ts`
- `backend/src/index.ts`

Contracte:

- `GET /api/v1/alerts`
  - query: `page`, `pageSize`, `kind`, `severity`, `onlyUnread`, `includeDismissed`, `from`, `to`;
  - raspuns: `{ rows, total, page, pageSize, unread }`.
- `PATCH /api/v1/alerts/:id/seen`
- `PATCH /api/v1/alerts/:id/dismissed`
- `GET /api/v1/alerts/stream`
  - event `ready`;
  - event `alert`, cu `id` setat la alert id.

Comportament:

- toate rutele sunt owner-scoped;
- dismissed alerts sunt excluse default din inbox;
- `includeDismissed=true` le aduce inapoi pentru audit operational;
- `unread` = `read_at IS NULL AND dismissed_at IS NULL`;
- `insertAlert()` publica in SSE doar cand insertul este nou, nu pe dedup replay.

### Frontend

Fisiere principale:

- `frontend/src/pages/Alerts.tsx`
- `frontend/src/lib/alertsApi.ts`
- `frontend/src/App.tsx`
- `frontend/src/components/Sidebar.tsx`

Comportament:

- ruta UI: `/alerte`;
- badge rosu numeric pe `Alerte`;
- badge numeric in collapsed sidebar;
- stream global in `AppShell`;
- cleanup: `EventSource.close()` in cleanup-ul `useEffect`;
- reconnect cu backoff pana la 30s;
- la reconnect se face refresh de count/lista;
- mark read / dismiss scad badge-ul.

### Electron

Fisiere:

- `electron/main.js`
- `electron/preload.js`
- `frontend/src/types/desktop-api.d.ts`

IPC nou:

- `desktopApi.showNotification({ title, body, silent })`
- main process foloseste `new Notification({ title, body, silent }).show()`.
- title/body sunt capate ca dimensiune in main process.

## Reguli de produs importante

### Baseline monitorizare

Regula confirmata de user:

- T0 = momentul inregistrarii monitorizarii.
- Tot ce exista la T0 pe dosar sau pe numele monitorizat este considerat deja stiut.
- Nu se emit alerte initiale pentru starea existenta.
- Conteaza doar ce apare/se schimba la T+1.

Aceasta regula este foarte importanta pentru `dosar_soap` si mai ales pentru `name_soap`, unde un nume poate avea multiple dosare deja existente.

### Badge Alerte

Userul a cerut explicit badge tip iPhone notification number:

- rosu, sa sara in ochi;
- cu numar, nu doar punct;
- vizibil si in sidebar expandat;
- vizibil si in collapsed/icon-only mode.

Implementarea curenta:

- expanded: langa label-ul `Alerte`;
- collapsed: peste clopotel;
- peste `99` afiseaza `99+`;
- count logic: `read_at IS NULL AND dismissed_at IS NULL`.

## Documentatie actualizata

- `CHANGELOG.md`
- `frontend/src/data/changelog-entries.tsx`
- `README.md`
- `EXECUTION-ROADMAP.md`
- `PLAN-monitoring-webmode.md`
- `SECURITY.md`
- `backend/.env.example`

Nota speciala introdusa in plan:

- captcha provider keys pentru RNPM:
  - desktop actual = UI + Electron `safeStorage`;
  - web/server mode = server-side env/config (`CAPTCHA_PROVIDER`, `TWOCAPTCHA_API_KEY`, `CAPSOLVER_API_KEY`);
  - nu BYOK si nu browser/client-supplied.

## Reguli active pentru urmatorul agent

- Executa doar planul agreat. Daca vezi o problema care cere schimbare fundamentala, anunta si asteapta aprobare.
- Nu scoate flow-uri existente care functioneaza.
- Monitorizarea se face dupa numar dosar sau nume; nu elimina suportul pentru `numar_dosar`.
- Electron smoke inseamna aplicatia desktop Electron, nu doar web localhost.
- La lansare Electron:
  - curata `ELECTRON_RUN_AS_NODE`;
  - evita terminal vizibil daca userul nu cere explicit;
  - prefera `Start-Process ... -WindowStyle Hidden`.
- Daca rulezi teste Node si atingi `better-sqlite3`:
  - pentru Vitest poate fi necesar `npm rebuild better-sqlite3`;
  - dupa teste ruleaza obligatoriu `npm run rebuild:electron`.
- SQLite nu permite modificarea unui CHECK existent via `ALTER TABLE`; pentru CHECK-uri trebuie rebuild de tabel sau drop complet de CHECK.
- Nu lasa procese Electron/backend pornite inutil daca nu sunt necesare.

## Probleme/riscuri ramase

- Nu exista inca GitHub release/tag `v2.4.1`; s-a facut push pe `main`, nu release formal.
- GitHub status prin connector a returnat anterior 404; CI status nu a fost confirmat prin connector dupa ultimul push.
- `xlsx@0.18.5` ramane risc acceptat temporar, documentat si mitigat prin limite stricte.
- Pentru PR-9 web/server mode trebuie auth real inainte de expunere remote.
- SSE alerts este in-process, suficient pentru desktop single backend; in web multi-instance va necesita strategie de leader/broker/poll fallback.

## Urmatoarea etapa

Conform roadmap:

### PR-7 - AI usage tracking + per-user quota

Scop:

- orice apel AI lasa row in `ai_usage`;
- pe desktop quota = informativ / bypass;
- pe web, PR-9+ foloseste quota inainte de call.

Tasks planificate:

1. Migration urmatorul numar liber dupa `0009`: `ai_usage`.
2. Repository `aiUsageRepository`.
3. Wrapper `aiCallTracked()` sau integrare minim invaziva in serviciul AI existent.
4. Cost model per provider/model, cu fallback safe cand token/cost lipsesc.
5. UI panel in setari pentru ultimele 24h / 30 zile.
6. Teste backend pentru write-after-call, owner scope si query sliding window.

Atentie: nu schimba prompturile/flow-ul AI fara cerere explicita; PR-7 este observability/quota, nu redesign AI.
