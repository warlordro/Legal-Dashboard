import {
  Sparkles,
  Palette,
  Rocket,
  Shield,
  Building2,
  BrainCircuit,
  ShieldCheck,
  MousePointerClick,
  Layers,
  CalendarSearch,
  FileText,
  FileSpreadsheet,
  Lock,
  Wrench,
  Activity,
  Bell,
  Mail,
  Users as UsersIcon,
  Split,
  PauseCircle,
} from "lucide-react";

export interface ChangeSection {
  title: string;
  content: string;
  bullets?: string[];
}

export interface VersionEntry {
  version: string;
  date: string;
  subtitle?: string;
  icon: React.ReactNode;
  borderColor: string;
  badgeClass: string;
  sections: ChangeSection[];
}

export const versions: VersionEntry[] = [
  {
    version: "v2.29.0",
    date: "18 Mai 2026",
    subtitle:
      "Monitoring noise & storage: retention atomica pentru monitoring_snapshots, cap payload 3 MiB, set equality pe nume si suppressie dosar_new istoric pe name_soap.",
    icon: <Activity className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-300",
    sections: [
      {
        title: "Storage retention",
        content:
          "deletePriorSnapshots(ownerId, jobId) curata snapshot-urile vechi in aceeasi tranzactie cu insertSnapshot pentru runnerii name_soap si dosar_soap. Daca insertul de alerta esueaza, rollback-ul pastreaza baseline-ul anterior. Cand sterge randuri, backend-ul emite log JSON monitoring.snapshot_retention cu owner_id, job_id, deleted_count si ts.",
      },
      {
        title: "Snapshot cap 3 MiB",
        content:
          "SNAPSHOT_PAYLOAD_MAX_BYTES creste la 3 MiB pentru nume corporative mari cu sute de dosare. Alerta SNAPSHOT_OVERSIZE afiseaza plafonul curent in titlu si detail.max_bytes=3145728; payload-urile de 2 MiB sunt acceptate normal.",
      },
      {
        title: "Name matching mai strict",
        content:
          "dosarMatchesAllNameTokens foloseste set equality, nu subset. PROFESIONAL CONSTRUCT SRL nu mai match-uieste NG PROFESIONAL CONSTRUCT SRL. Sufixele juridice raman ignorate, iar parti.nume null/undefined nu arunca.",
      },
      {
        title: "Historic noise suppression",
        content:
          "Snapshot-ul name_soap include latest_sedinta_at, iar diffNameSoap primeste jobCreatedAt. dosar_new este suprimat pentru dosare mai vechi decat jobul cand nu exista activitate dupa adaugarea la monitorizare. Datele invalide fac fail-open si sunt logate prin console.error.",
      },
      {
        title: "Verificare",
        content:
          "Acoperire noua pentru rollback DELETE+INSERT, 3 tick-uri = 1 snapshot/job, oversize peste 3 MiB vs 2 MiB valid, set equality, parti.nume null/undefined si suppressie istorica cu date invalide. Gate release: Biome, tsc backend, tsc frontend, teste backend, teste frontend si npm run build.",
      },
    ],
  },
  {
    version: "v2.28.4",
    date: "18 Mai 2026",
    subtitle:
      "Remediation pack audit 2026-05-18 (16 findings → 5 PR-uri merged). Security: CSRF desktop-only guards pe rute bulk + master-switch retry rezilient. Backend hygiene: AI signal propagation, bodyLimit pe /search/load-more, log redact. Frontend: XLSX caps + saved-load error banner + focus trap a11y. Web pre-cutover: ownerId obligatoriu pe inputuri repo/service, /health split (public minim + /health/detail loopback). Ops: pin Docker SHA, CORS PATCH/DELETE, worktree cleanup, migration doc.",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
    sections: [
      {
        title: "Security hotfix (F1, F4)",
        content:
          "CSRF: ruta /api/v1/monitoring/jobs/bulk-dismiss + /api/v1/alerts/dismiss-bulk primesc requireDesktopHeader gate cand authMode=desktop (Origin/Referer + X-Desktop-Header). Web mode foloseste deja JWT — neschimbat. Master-switch (env override OpenRouter): retry exponential 200ms/500ms cu jitter, in loc de fallback silent la native, ca regresii de boot transitoriu (DNS, proxy) sa nu trippeze flag-ul.",
      },
      {
        title: "Backend hygiene (F6, F7, F10)",
        content:
          "AI signal propagation: AbortSignal ajunge in toate SDK-urile (Anthropic/OpenAI/Google/OpenRouter) pana in fetch — frontend cancel devine functional end-to-end. /api/v1/rnpm/search/load-more primeste bodyLimit 512KB explicit ca payload-uri mari sa intoarca 413 cu envelope, nu sa consume RAM. Log redact: secret-uri (API keys, tokens, cookies, Authorization headers) sterse din logger middleware si din evenimentele de audit detail.",
      },
      {
        title: "Frontend hardening (F5, F11, F12, F14)",
        content:
          "XLSX bulk import: cap 10MB file size + 10k rows + 64 columns. RNPM saved load error banner: dupa load fail, UI arata bannerul cu Reincearca in loc sa ramana blank. requestId propagat pe MonitoringApiError pentru cross-referencing logs. useDialog focus trap: Tab/Shift+Tab wrap, focus re-entry cand sare in afara dialogului, fallback container.focus().",
      },
      {
        title: "Web pre-cutover (F2, F15)",
        content:
          'SaveSearchInput/GetSearchesOptions/UpsertAvizInput/GetAvizeOptions/ExecuteSearchInput/SplitSearchInput primesc ownerId obligatoriu. Fallback-ul `"local"` ramane exclusiv pe getOwnerId() din middleware/owner.ts — desktop neschimbat, web fail-closed daca caller-ul uita sa propage owner-ul autentificat. /health expune doar status+service pentru probe externe / LB / Electron splash; telemetry operational (authMode, monitoring scheduler state, emailConfigured) mutat la /health/detail gated prin loopback (getConnInfo).',
      },
      {
        title: "Ops & supply chain (F8, F9, F13, F16)",
        content:
          "GitHub Actions pinned la commit SHA (audit recommend). Dockerfile FROM pinned. CORS preflight accepta PATCH si DELETE explicit (lipseau in lista de allowed methods, blocand admin operations din browser). Worktree cleanup: scripts adauga check pentru worktree-uri orfane si fail clean cand un cleanup nu poate sterge. Migration doc: scriere/rollback pattern in backend/src/db/migrations/README.md.",
      },
      {
        title: "Test coverage",
        content:
          "1099 teste backend passing (Vitest, Node 22+). +5 teste noi pentru F2/F15: ownerId fail-closed pe getSearches/getAvize, /health public payload size + /health/detail loopback gate. Frontend test suite 102 passing. Biome + tsc + npm run build clean pe toate fisierele atinse in cele 5 PR-uri.",
      },
    ],
  },
  {
    version: "v2.28.3",
    date: "17 Mai 2026",
    subtitle:
      "Refactor closeout v2.28.3: cleanup de exporturi interne, middleware withRnpmGuards pentru rutele RNPM cu captcha si teste noi pentru invariants critice I1/I3/I-final-update. Tier 3 si restul Tier 4 raman deferred explicit dupa validare.",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
    sections: [
      {
        title: "Cleanup API surface",
        content:
          "Drop-export pe 7 simboluri folosite doar intern: PJPFToggle, PFBlock, CURATED_AUDIT_ACTIONS, AlertsDailyRow, RunsByDayStatusRow, RunsByStatusRow si AuthProvider. Helperii exportati doar pentru teste au primit marker @internal.",
      },
      {
        title: "RNPM guards consolidate",
        content:
          "withRnpmGuards centralizeaza web-mode gate, parse JSON si validarea captchaKey pentru /search, /bulk si /search-split. /captcha/balance pastreaza web gate-ul direct, fara validarea completa de body.",
      },
      {
        title: "Invariants pin",
        content:
          "Teste noi fixeaza comportamentele critice din rnpmSearchService: I1 cross-tenant existingSearchId ramane 403, I3 fail-fast pe refuzuri silentioase ramane predictibil, iar updateSearchTotal ruleaza in finally pentru partial state dupa abort.",
      },
      {
        title: "Refactor closeout",
        content:
          "audit/AUDIT-REFACTOR.md §8 marcheaza Tier 3 si restul Tier 4 ca DEFERRED sub topologia curenta SQLite + Litestream + 1 replica + sub 100 useri interni. Reactivare doar la active-active sau peste 500 useri activi.",
      },
    ],
  },
  {
    version: "v2.28.2",
    date: "17 Mai 2026",
    subtitle:
      "Bugfixes + UX tuning + ops watchdog peste audit refactor Tier 1+2 livrat. Re-activeaza flow-ul Split RNPM (silent rupt din v2.14.0), repara native AI mode (regresie v2.28.0), trateaza graceful searchId cache-uit dupa Sterge baza, adauga event-loop watchdog pentru main process Electron, strange headerele AI Analiza si vertical-aligneaza row-urile din Monitorizare.",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
    sections: [
      {
        title: "Audit refactor Tier 1+2 livrat (13 commits)",
        content:
          "Tier 1 cleanup: dead code + shared helpers. Tier 2 consolidari: per-operation TTL safety net pe inflightRequests RNPM, parseJsonBody helper (-22 LOC pe 9 site-uri), extractErrorMessage consolidat in aiUsageApi + alertsApi (-52 LOC). Tier 3 RNPM partial: isValidCaptchaKey type predicate, inflightRequests Map ancorat ca process-local. Tier 4 DosareTable P3 incepe: 14 teste caracterizare + 4 hooks extrase (useViewedDosareSession, useDosareSelection, useMonitorRowState, useDosareAi). Pasii ramasi din Tier 3+4 raman in backlog.",
      },
      {
        title: "Fix [object Object] in cautari RNPM + Split flow re-activat",
        content:
          "rnpmApi.ts nu dezambala envelope-ul v2.14.0 (error: { code, message, details }) la 400/500/SSE error. Cauza: new Error(envelope.error) cu un obiect producea Error.message = '[object Object]'. Fix: extractErrorMessage(parsed, fallback) aplicat pe rnpmSearch / rnpmSplitSearch / rnpmBulkSearch / filterRnpmResults + SSE error events. Bonus: detectia LIMIT_EXCEEDED (uppercase, pe path-ul corect error.code) re-activeaza flow-ul de Split care era silent rupt din v2.14.0 — cautarile peste 250 rezultate pe nume redeschid prompt-ul de split.",
      },
      {
        title: "Fix missing search rows dupa Sterge baza (UX cross-tenant fals)",
        content:
          "searchRepository introduce getSearchOwnership(id, ownerId): 'owned' | 'foreign' | 'missing'. executeSearch trateaza missing ca search nou (drop existingSearchId/Gcode/page + captcha proaspat in flow normal); foreign ramane 403 (audit 2026-04-29 #11 intact). Frontend: onAfterDeleteAll aborteaza orice cautare in-flight si reseteaza 8 stari (result/error/elapsedMs/phase/autoLoading/detailAvizId/pendingSplit/splitProgress).",
      },
      {
        title: "Fix native AI mode regression (v2.28.0)",
        content:
          "useOpenRouter continua sa ruteze prin OpenRouter cand userul toggla inapoi la native daca cheia sk-or-* ramanea salvata sau OPENROUTER_API_KEY env era setat — MODEL_NOT_IN_STACK pe modele native. Extras shouldRouteViaOpenRouter(modelKey, apiKeys, routing) ca singura sursa de adevar; routing.mode === 'native' invinge auto-detect-ul. Modelele provider === 'openrouter' raman rutate prin OpenRouter (fara SDK nativ). +6 teste in ai.openrouter.test.ts.",
      },
      {
        title: "Event-loop watchdog pentru main process Electron",
        content:
          "electron/event-loop-watchdog.js (nou): monitorEventLoopDelay (perf_hooks, libuv-level) polleaza 5s; daca max lag > 5000ms scrie diagnostic/event-loop-lag.log + process.report.writeReport() la diagnostic/reports/stall-*.json (trim 200 linii, prune 20 rapoarte). Motivat de incidentul 2026-05-17: main process stuck CPU 1161s -> safeStorage IPC timeout 10s vizibil userului ca 'API keys disparute'. Watchdog-ul prinde stack-ul V8 data viitoare.",
      },
      {
        title: "UX tuning headere AI + Monitorizare + notite + rows RNPM",
        content:
          "DosareAiAnalysisPanel: headerele 'Analiza AI' / 'Analiza AI Avansata' stranse de la p-4 pb-2 la px-4 py-2 (-33% inaltime cand sunt colapsate). Monitorizare: row-uri vertical-centered (align-middle) + butonul Dosare intins peste 2 randuri grid. NoteEditor: latimea notitelor inline constrânsa la max-w-[12rem]. RnpmResultsTable: row-urile cu avizId null (detail fetch esuat) sunt dezactivate silent (cursor-not-allowed + tooltip) in loc sa setteze un banner page-level fara context per-row.",
      },
    ],
  },
  {
    version: "v2.28.1",
    date: "16 Mai 2026",
    subtitle:
      "Bug fixes pentru stack chinezesc OpenRouter: Kimi K2.6 (thinking model) lovea cap-ul de 8000 tokens si analiza judecatorului ramanea goala. Cap nou 16000 tokens dedicat chinese stack, timeout-uri bumpate 300s -> 480s (backend) si 300s -> 1020s (frontend), whitelist judge models complet (GLM 5.1 + Kimi K2.6), plus reorganizare layout dialog Config Chei API.",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-rose-500",
    badgeClass: "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-300",
    sections: [
      {
        title: "Cap tokens per-stack pentru thinking models",
        content:
          "AI_MAX_TOKENS_CHINESE = 16000 (vs 8000 western). Kimi K2.6 e thinking model si consuma tokens pentru reasoning inainte de raspuns; cap-ul de 8000 era lovit constant (finish_reason: length, output trunchiat). GLM 5.1 si Qwen 3.6 Max termina natural sub 6k tokens, nu sunt impactate. Pattern: helper effectiveOpenRouterMaxTokens(stack), analog effectiveOpenRouterTimeout.",
      },
      {
        title: "Timeout-uri aliniate cu realitatea chinese stack",
        content:
          "Backend: AI_TIMEOUT_CHINESE 240s -> 360s, AI_MULTI_TIMEOUT_CHINESE 300s -> 480s (Kimi K2.6 judge ajunge la ~298s pentru 13k tokens). Frontend: analyze-multi AbortSignal 300s -> 1020s (acopera analysts paralel 480s + judge 480s + margine retea). Cap-ul vechi cauza BodyStreamBuffer was aborted chiar cand backend-ul livra cu succes.",
      },
      {
        title: "Whitelist judge models chinese complet",
        content:
          "JUDGE_MODELS include acum cele trei chinese (GLM 5.1, Kimi K2.6, Qwen 3.6 Max), nu doar Qwen. Dropdown-ul frontend si validarea backend sunt sincronizate; mesajul de eroare actualizat sa enumere toate cele 6 optiuni valide.",
      },
      {
        title: "Layout dialog Config Chei API unitar",
        content:
          "Blocul Rutare AI (toggle Native/OpenRouter + Vestic/Chinezesc) mutat adiacent cu blocul de chei API providers, ca toata configurarea AI sa stea unitara vizual. Panourile status (AI Usage, Notifications, Email) raman deasupra.",
      },
    ],
  },
  {
    version: "v2.28.0",
    date: "16 Mai 2026",
    subtitle:
      "Integrare OpenRouter in modulul AI: toggle admin intre native si OpenRouter, stack vestic mirror native, stack chinezesc premium (GLM 5.1, Kimi K2.6, Qwen 3.6 Max), persistenta per owner si protectie impotriva mixarii stack-urilor in multi-agent.",
    icon: <Layers className="h-5 w-5" />,
    borderColor: "border-l-cyan-500",
    badgeClass: "bg-cyan-100 text-cyan-900 dark:bg-cyan-900/30 dark:text-cyan-300",
    sections: [
      {
        title: "Toggle AI native / OpenRouter",
        content:
          "Adminul poate pastra mode=native, cu flow-ul existent Anthropic/OpenAI/Google, sau poate comuta pe mode=openrouter. Cand OpenRouter este activ, UI-ul afiseaza un singur slot vizibil pentru OpenRouter API Key (sk-or-v1-...), iar sloturile native sunt unmounted complet.",
      },
      {
        title: "Doua stack-uri OpenRouter",
        content:
          "Stack-ul vestic mirror-uieste modelele native prin OpenRouter. Stack-ul chinezesc expune trei modele premium: GLM 5.1, Kimi K2.6 si Qwen 3.6 Max. Model picker-ul filtreaza analistii si judecatorul dupa stack-ul activ.",
      },
      {
        title: "Persistenta si audit usage",
        content:
          "Migration 0023 adauga owner_ai_settings per owner. Migration 0024 rebuild-uieste ai_usage ca sa accepte provider=openrouter si routing_tag, astfel incat costurile si ruta efectiva raman auditate.",
      },
      {
        title: "Protectii operationale",
        content:
          "Multi-agent refuza mixarea stack-urilor cu STACK_MIX_FORBIDDEN. Web mode accepta OpenRouter doar prin OPENROUTER_API_KEY din env, iar OPENROUTER_DISABLED=1 opreste call-urile OpenRouter imediat, fara fallback silent la native.",
      },
    ],
  },
  {
    version: "v2.27.5",
    date: "16 Mai 2026",
    subtitle:
      "Release de performanta RNPM: (1) fix critic freeze filtrare 148 rezultate via materializare coloane *_norm cu triggere SQLite (8s -> sub 50ms); (2) crestere concurency details fetch 7 -> 12 reduce timpul total per cautare cu ~30% (174s -> 125s pe 148 avize, zero erori upstream); (3) diagnostic per-slot la captcha race ca sa vedem ce face fiecare provider (OK/ERR/abort).",
    icon: <Rocket className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
    sections: [
      {
        title: "Filtrare RNPM: eliminare freeze 8s pe rezultate cu 148+ avize",
        content:
          "Migration 0022 adauga 24 coloane *_norm materializate (rnpm_avize x9, rnpm_creditori x3, rnpm_debitori x3, rnpm_bunuri x8, rnpm_bunuri_descrieri x1) si 10 triggere AFTER INSERT/UPDATE OF source-cols care le populeaza automat. avizRepository.ts citeste direct col_norm in loc sa apeleze rnpm_norm() per rand. Backfill idempotent post-migration in schema.ts (WHERE col_norm IS NULL AND col IS NOT NULL).",
      },
      {
        title: "Zero regresie functionala",
        content:
          "Aceleasi 24 coloane match (identificator, tip, utilizator_autorizat, numar_act, tip_act, alte_mentiuni, detalii_comune, inscriere_initiala_id, inscriere_modificata_id pe rnpm_avize plus denumire/cod/cnp pe creditori+debitori plus tip_bun/categorie/identificare/model/serie_sasiu/serie_motor/nr_inmatriculare/referinte_json pe rnpm_bunuri plus text pe rnpm_bunuri_descrieri). Acelasi buildRnpmLikePattern + highlightTokens UI. 7 teste regresie noi acopera trigger population + zero-regresie pe scenarii diacritice/JSON/4-char prefix.",
      },
      {
        title: "Note tehnice",
        content:
          "Triggere AFTER UPDATE OF <source-cols> evita recursia (write-ul triggerului nu se incadreaza in OF list). UDF rnpm_norm() ramane registrata pe conexiune in schema.ts; migration .up.sql contine doar CREATE TRIGGER (lazy resolution la fire time, nu la CREATE). LIKE leading wildcard inca nu beneficiaza de B-tree index, dar elimina O(N) JS round-trip prin UDF per rand.",
      },
      {
        title: "RNPM details concurrency 7 -> 12 (~30% cautare mai rapida)",
        content:
          "DEFAULT_DETAIL_CONCURRENCY bump de la 7 la 12 in rnpmSearchService.ts. Empiric pe ipoteci cu 148 rezultate (6 pagini x 25 avize): timpul total per cautare scade de la ~174s la ~125s (-28.6%), zero erori upstream RNPM (148 detail-page-uri fetched fara 429/503/silent_refusal). Castig concentrat pe pagini cand RNPM e in regim mediu (p2: 32s -> 12s, p4: 45s -> 28s); pe pagini deja rapide, break-even. Localizat intr-o singura constanta - daca apare rate-limit in productie, revine la 7.",
      },
      {
        title: "Diagnostic captcha race per-slot",
        content:
          "solveRace() logheaza acum outcome-ul fiecarui slot (slot=A/B provider=... OK/ERR ms). Anterior, Promise.any inghitea rejection-urile pana cand ambele esuau, deci nu se vedea cand un provider pica devreme (ERROR_KEY/ERROR_ZERO_BALANCE/abort) vs cand pierdea race-ul fair. Validat empiric: race functioneaza in ambele directii (2Captcha 5.4s win + CapSolver abort la +4ms; CapSolver 20.4s win + 2Captcha abort la +2ms in run anterior).",
      },
    ],
  },
  {
    version: "v2.27.4",
    date: "15 Mai 2026",
    subtitle:
      "Release de consolidare: inchide Faza 11 (F11-F2..F11-F5), inchide proiectul 'biome total cleanup' (9 PR-uri Codex care duc biome la 0 errors si urca gate-ul permanent in CI), absoarbe trei runde CodeRabbit (#37, #38, #39) si trei polish-uri scurte din sesiunea curenta (BarChart tooltip cursor + animatie, plafon export RNPM 500 -> 5000, nitpicks CI lint-test).",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-violet-500",
    badgeClass: "bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-300",
    sections: [
      {
        title: "Faza 11 hardening (F11-F2..F11-F5)",
        content:
          "Hardening pe scripts/rebuild-electron.cjs (eliminat shell:true din spawn npm rebuild, resolver where/which pentru npm.cmd), separat handler auth/login de health probe in backend, split export.ts pe module per-domain (dosare, termene, alerte, monitoring, rnpm), biome check ruleaza permanent pe lint-test fara continue-on-error.",
      },
      {
        title: "Biome total cleanup: 9 PR-uri Codex la 0 errors",
        content:
          "PR-0..PR-8 inchid backlog-ul de biome warnings/errors mostenit. Highlights: overrides tintite pentru migratii/fixtures (PR-1), autofix safe-only fara modificari semantice (PR-2), pastreaza delete process.env.X ca statement NU string assignment (PR-3), centralizeaza sanitizarea AI intr-un singur helper cu DOMPurify activ (PR-4), elimina non-null assertions din prod backend (PR-5), rezolva exhaustive-deps (PR-6), inchide tail rules (PR-7), urca gate permanent in CI (PR-8). Hard constraints respectate: SQL raw doar in backend/src/db/**, owner_id pe toate tabelele, DOMPurify activ, whitelist URL neatinsa.",
      },
      {
        title: "CodeRabbit rounds #37 #38 #39",
        content:
          "PR #37 (fix-rabbit): pending search effect cu deps complete, dedup React key pe lista users, bootstrap workflow gate CI. PR #38 (tech-debt): aplica regula delete process.env.X peste tot, urca a11y rules la warn. PR #39 (a11y): fix-uri reale htmlFor pe modaluri/tabele in loc de biome-ignore, documentat use-pattern Radix unde semantic element-ul nu e accesibil.",
      },
      {
        title: "Polish UI/UX + CI in aceasta sesiune",
        content:
          "BarChart Tooltip cu cursor transparent si fara animatie de slide pe toate cele 5 grafice (Alerte/zi, Rulari/zi, Termene viitoare, Stadii procesuale, Top 5 institutii). Plafon export RNPM ridicat 500 -> 5000 ids/request pe /saved/export[.xlsx|.pdf], EXPORT_BODY_LIMIT urcat 64KB -> 256KB. Lint-test workflow primeste bloc concurrency (cancel runs superseded) si bloc permissions: contents: read (least-privilege).",
      },
      {
        title: "Lasat asa - cunoscut upstream",
        content:
          "Textul Solutie/Sumar din PortalJust contine ocazional ? literale acolo unde diacriticele s-au pierdut in pipeline-ul lor legacy ANSI/cp1250 -> UTF-8. Nu este reparabil din client - substitutia este facuta de serializatorul upstream cand nu poate mapa byte-ul, iar reconstructia (?i -> şi sau ţi) este ambigua. Lasam ca atare, nu introducem dictionar hardcodat.",
      },
    ],
  },
  {
    version: "v2.27.3",
    date: "15 Mai 2026",
    subtitle:
      "Revert export PDF pentru Dosare + Termene la pipeline-ul jsPDF + autotable (rulat in Web Worker), pentru ca PDFKit streaming livrat in v2.27.0 producea pe dosare cu ~600 sedinte un PDF dezorganizat. Export RNPM + Alerte ramane pe PDFKit streaming (volum mare). Export XLSX nu este afectat.",
    icon: <FileText className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
    sections: [
      {
        title: "Calitatea PDF-ului restaurata pe Dosare + Termene",
        content:
          "Comparativ cu dosare_05.05.2026.pdf (jsPDF), build-ul backend din v2.27.0 (PDFKit streaming) producea text suprapus si coloana Parti trunchiata la wrap pe export-uri cu sute de sedinte. Am revenit la jsPDF + jspdf-autotable, mutat in Web Worker pentru a nu bloca UI-ul. Rezultatul este identic vizual cu randarea din v2.0.x.",
      },
      {
        title: "Ce ramane pe backend streaming",
        content:
          "Export PDF pentru RNPM (poate atinge ~2000 avize si ~50k pagini) si export PDF pentru Alerte raman pe PDFKit streaming pe backend - acolo single-page jsPDF in worker nu este suficient. Export XLSX continua sa foloseasca ExcelJS WorkbookWriter pe backend pentru toate fluxurile.",
      },
      {
        title: "Cleanup backend",
        content:
          "Am eliminat handlerii POST /api/v1/dosare/export.pdf si POST /api/v1/termene/export.pdf, serviciile dosareExportPdf.ts + termeneExportPdf.ts si testele aferente. Frontendul nu mai face request HTTP la backend pentru aceste PDF-uri.",
      },
    ],
  },
  {
    version: "v2.27.2",
    date: "14 Mai 2026",
    subtitle:
      "Fix UI: dialog-urile de confirmare ('Inchide toate alertele filtrate?', popover instante monitorizate) nu mai apar lipite de marginea stanga a ecranului. Plus integrare interna F11-F1 a hardeningului OriginGuard (request-header desktop-only).",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-300",
    sections: [
      {
        title: "Dialog-uri centrate corect",
        content:
          "Doua modaluri foloseau tag-ul nativ <dialog open> care primeste de la browser stiluri UA (width: fit-content) ce intra in conflict cu Tailwind inset-0 si fortau fereastra in coltul din stanga sus. Le-am inlocuit cu div + role=alertdialog/dialog si flex centering, pe acelasi pattern ca ConfirmProvider.",
      },
      {
        title: "Locatii afectate",
        content:
          "Bulk dismiss in /alerte (confirmarea 'Inchide toate alertele filtrate?') si popover-ul cu instante asociate jobului din /monitorizare. Restul confirmarilor (folosesc ConfirmProvider) erau deja centrate corect.",
      },
      {
        title: "Hardening OriginGuard (intern, in progres)",
        content:
          "Faza 11 / F11-F1 integrata in main (work-in-progress): backend impune X-Legal-Dashboard-Desktop pe POST/DELETE admin body-less, frontendul injecteaza header-ul pe toate request-urile catre backend, originGuard returneaza envelope-shape pe erori. Inca nu e final pentru web mode - ramane de finalizat in release viitor.",
      },
    ],
  },
  {
    version: "v2.27.1",
    date: "14 Mai 2026",
    subtitle:
      "Fix cautari largi PortalJust: cap-ul intern de raspuns SOAP urcat de la 8MB la 50MB si mesaj actionable 413 in loc de 'retry' pe rezultate prea multe.",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-900 dark:bg-sky-900/30 dark:text-sky-300",
    sections: [
      {
        title: "Cautari largi (ex. 'AUTO IN SRL') nu mai pica",
        content:
          "PortalJust raspunde la query-uri largi cu pana la 1000 dosare cu parti+sedinte (~17MB empiric). Vechiul cap intern de 8MB respingea aceste raspunsuri ca 'eroare de comunicare'. Cap-ul a fost ridicat la 50MB, cu ~3x margin fata de worst-case-ul real, fara sa pierdem protectia anti-runaway.",
      },
      {
        title: "Mesaj de eroare actionable",
        content:
          "Cand raspunsul depaseste totusi cap-ul, backend-ul returneaza acum 413 cu 'Prea multe rezultate de la PortalJust (>1000). Restrange filtrele: adauga interval de date, institutie sau nume mai specific.' Mesajul vechi 'Incercati din nou' era inselator pentru ca query-ul e determinist.",
      },
      {
        title: "Aplicat pe ambele rute",
        content:
          "GET /api/dosare si GET /api/termene primesc acelasi tratament prin typed error SoapResponseTooLargeError. Restul erorilor SOAP (network, fault) raman ca 500 generic.",
      },
    ],
  },
  {
    version: "v2.27.0",
    date: "14 Mai 2026",
    subtitle:
      "Notite editabile per job de monitorizare, limita 200 caractere si propagare live in cardurile din Alerte.",
    icon: <FileText className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
    sections: [
      {
        title: "Notite editabile in Monitorizare",
        content:
          "Fiecare job de monitorizare poate avea o notita scurta editabila direct din rand: click pe nota existenta sau pe '+ Adauga notita', apoi Salveaza sau Anuleaza. Limita este 200 caractere.",
      },
      {
        title: "Propagare in Alerte",
        content:
          "Cardurile din /alerte afiseaza blocul 'Notita: ...' cand alerta provine dintr-un job cu notita setata. Afisarea este live-read, deci editarea notitei se reflecta in alertele deja emise.",
      },
      {
        title: "Validare si bulk import",
        content:
          "Backend-ul valideaza notitele la maximum 200 caractere, formularul de adaugare foloseste aceeasi limita, iar preview-ul de bulk import semnaleaza randurile cu notite prea lungi.",
      },
      {
        title: "Polish vizual",
        content: "Notitele lungi din lista de joburi fac wrap in coloana tintei si nu intra sub butonul Dosare.",
      },
    ],
  },
  {
    version: "v2.26.0",
    date: "13 Mai 2026",
    subtitle:
      "PR-6 Envelope Migration: rutele HTTP legacy din RNPM, AI si Termene returneaza envelope standard pe 4xx/5xx, iar frontend-ul citeste dual-shape mesajele de eroare pentru exporturi si SSE AI judge.",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
    sections: [
      {
        title: "Envelope standard pe erori HTTP",
        content:
          "RNPM, AI si Termene folosesc acum forma { data, error: { code, message }, requestId } pentru raspunsurile 4xx/5xx migrate, cu requestId propagat pentru diagnostic.",
      },
      {
        title: "Semantica pastrata",
        content:
          "INSUFFICIENT_FUNDS raspunde 402 Payment Required cu Retry-After: 0, LIMIT_EXCEEDED pastreaza details pentru split-search, iar pagination ramane shape-only fara INVALID_PAGE nou.",
      },
      {
        title: "Frontend dual-shape",
        content:
          "Clientul API extrage mesajul real atat din erorile legacy string, cat si din envelope, astfel exporturile XLSX/PDF si SSE AI judge nu mai cad pe fallback generic.",
      },
      {
        title: "Scope controlat",
        content:
          "Payload-urile SSE, path-ul RNPM 499 abort cu searchId, raspunsurile OK 200/201 si audit events raman nemigrate intentionat.",
      },
    ],
  },
  {
    version: "v2.25.0",
    date: "13 Mai 2026",
    subtitle:
      "Filtru RNPM multi-token cu logica AND, highlight galben pentru termenii cautati si badge 'match in detalii' cand potrivirea este doar in continutul expandat al avizului.",
    icon: <FileSpreadsheet className="h-5 w-5" />,
    borderColor: "border-l-yellow-500",
    badgeClass: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-300",
    sections: [
      {
        title: "Filtru multi-token AND",
        content:
          "Query-uri precum 'totalitatea creantelor' sunt sparte in tokeni, deduplicate si evaluate cu logica AND peste acelasi set de 24 campuri RNPM normalizate; fiecare token poate aparea in alt camp al aceluiasi aviz.",
      },
      {
        title: "Highlight in rand si detalii",
        content:
          "Termenii cautati sunt marcati cu highlight galben in randul colapsat (Identificator, Tip, Utilizator) si in tab-urile expandate Creditori, Debitori, Bunuri si Istoric.",
      },
      {
        title: "Badge match in detalii",
        content:
          "Cand niciun token nu apare in randul vizibil, dar avizul este pastrat de filtrul backend, tabelul afiseaza badge-ul 'match in detalii' sub Identificator ca indiciu ca potrivirea este in expand.",
      },
      {
        title: "Protectii si teste",
        content:
          "Tokenizer-ul backend si frontend limiteaza filtrul la maximum 8 tokeni pentru anti-DoS. Testele noi acopera tokenizare, logica AND, EXPLAIN QUERY PLAN, helperii de highlight si integrarea in tabel.",
      },
    ],
  },
  {
    version: "v2.24.0",
    date: "13 Mai 2026",
    subtitle:
      "Filtru text incremental peste rezultatele cautarii RNPM. Endpoint nou POST /api/rnpm/search/:searchId/filter cu owner isolation, anti-enumeration 404, timeout 5s, truncare la 1500 ID-uri si kill switch operational. UI-ul filtreaza live rezultatele din RnpmResultsTable cu debounce 300ms, AbortController si bannere transparente pentru rezultate trunchiate sau avize fara detalii.",
    icon: <FileSpreadsheet className="h-5 w-5" />,
    borderColor: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    sections: [
      {
        title: "Migration 0021 - idx_rnpm_avize_owner_search",
        content:
          "Index nou `(owner_id, search_id, id)` pentru filtrarea peste rezultatele unei cautari salvate, plus test de idempotenta UP/DOWN si boot-time probe care verifica prezenta indexului la startup.",
      },
      {
        title: "Backend - filtru dedicat, fara regresie pe getAvize",
        content:
          "`filterRnpmSearchResults` sta separat de `getAvize()` si cauta peste 24 campuri normalizate: 9 din `rnpm_avize`, 3 creditori, 3 debitori si 9 bunuri, inclusiv `rnpm_bunuri_descrieri.text` via JOIN. Ruta POST valideaza body-ul cu Zod, nu pune `q` in URL logs, logheaza doar `qLen`, aplica anti-enumeration 404 pentru searchId inexistent sau cross-owner si returneaza `missingDetails` + `truncated`.",
      },
      {
        title: "Frontend - filtru live in tabelul de rezultate",
        content:
          "`RnpmResultsTable` primeste input de filtru text, hook dedicat `useRnpmResultsFilter`, debounce 300ms si abort pe query nou/unmount. Filtrarea se face local pe perechi `avizId` + document, astfel exportul si paginarea folosesc exact setul filtrat afisat.",
      },
      {
        title: "Operational + tests",
        content:
          "`RNPM_RESULTS_FILTER_DISABLED=1` opreste rapid ruta si UI-ul afiseaza state degraded. 51 teste noi acopera migration, repository helper, EXPLAIN QUERY PLAN, cross-tenant breach drill, route validation/errors, hook debounce/abort si component integration.",
      },
    ],
  },
  {
    version: "v2.23.0",
    date: "13 Mai 2026",
    subtitle:
      "Master switch monitoring — buton global de pauza/reluare per-owner expus in pagina Monitorizare. Cand monitorizarea e oprita, scheduler-ul nu mai claim-uieste joburile (anti-join via partial index pe owner_monitoring_settings), dar joburile raman in lista cu state-ul lor — reluarea reia exact de unde a ramas, fara reset, fara dublu-run. Audit complet pe ambele directii cu request_id + actor_id propagate.",
    icon: <PauseCircle className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Migration 0020 — owner_monitoring_settings",
        content:
          "Tabel nou `owner_monitoring_settings (owner_id PK, monitoring_enabled INTEGER DEFAULT 1, updated_at)` + partial index `idx_owner_monitoring_settings_disabled` pe `(owner_id) WHERE monitoring_enabled = 0` pentru anti-join O(log n) la scheduler claim. Default-ul 1 pastreaza compat: orice owner nou sau cu rand lipsa e considerat activ.",
      },
      {
        title: "Backend — scheduler anti-join + audit",
        content:
          "`claimDueJobs` din scheduler filtreaza via anti-join cu partial index — joburile owner-ilor cu `monitoring_enabled = 0` nu mai apar in result set, deci scheduler-ul nu le mai atinge intre ticks. Rute `GET/PUT /api/v1/monitoring/master-switch` cu Zod `.strict()` validation (422 pe payload invalid), upsert idempotent, audit entry `monitoring.master_switch.on/.off` cu `actor_id` (owner-id) + `request_id` propagate, scris doar pe schimbare reala de state (no-op = no audit).",
      },
      {
        title: "Frontend — hook + buton in cardul de joburi",
        content:
          "`useMonitoringMasterSwitch` hook cu `enabled / loading / saving / toggle(next) / refresh()`, `AbortController` pe GET (cleanup la unmount) si optimistic flip cu rollback pe esec. Buton `Opreste/Reia monitorizarea` plasat in headerul cardului `Monitorizari active`, langa export Excel/PDF, cu spinner pe saving. Cand master e off, iconita per-rand de pauza individuala (`job.active`) e fortata la `Play` ca semnal vizual coerent ca scheduler-ul nu ruleaza nimic — toggle-ul per-job ramane functional pentru pre-configurare.",
      },
      {
        title: "Tests",
        content:
          "926 teste backend (26 noi: migration + repository + scheduler anti-join + route GET/PUT/422 + audit propagation + idempotency cu rapid back-to-back PUTs pe ambele directii .on/.off) si 102 teste frontend (1 nou pentru `refresh()` care reflecta un flip server-side de la alt client).",
      },
    ],
  },
  {
    version: "v2.22.0",
    date: "13 Mai 2026",
    subtitle:
      "Supply chain hardening + polish (Batch 7 + Batch 8 din FIXES-TODO.md) + migrare exporturi mari la backend streaming. GitHub Actions pinned la SHA-uri full, Dockerfile pinned la digest sha256, `xlsx-js-style` pe path-ul de upload XLSX user (closes 2 CVE active fara fix upstream), hono bump la 4.12.18 cu 3 CVE moderate inchise. Polish: `synchronous = NORMAL` pe SQLite WAL, `RNPM_SITEKEY` / `RNPM_PAGEURL` / `RNPM_USER_AGENT` extragate in env via lazy getters pentru hot-swap fara rebuild. Plus exporturi RNPM (avize), PortalJust (dosare + termene) si Alerte rescrise cu `exceljs.stream.xlsx.WorkbookWriter` + `pdfkit` streaming pe disk temp — elimina OOM-ul Electron main process pe 148+ avize.",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-cyan-500",
    badgeClass: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
    sections: [
      {
        title: "Supply chain pinning",
        content:
          "Workflow-urile GitHub (build-windows.yml + build-mac.yml) folosesc SHA-uri full git pe toate action-urile (`actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `softprops/action-gh-release`), nu tag-uri mobile. Dockerfile-ul folosea `node:22-alpine` (tag), acum pinned la digest sha256 pe ambele stage-uri.",
      },
      {
        title: "Migrare XLSX pe path-ul de upload user",
        content:
          "`monitoringBulkTemplate.ts` (frontend) folosea `xlsx@0.18.5` pentru parsing user input, expunere la CVE de prototype pollution + ReDoS fara fix upstream. Migrat la `xlsx-js-style` (fork cu acelasi API, fara vulnerabilitati). `xlsx` scos din `optimizeDeps` + `manualChunks` in vite.config.ts si mutat la devDependencies.",
      },
      {
        title: "hono 4.12.18 + npm audit clean",
        content:
          "Bumpat `hono` `^4.12.17` → `^4.12.18` ca sa inchidem 3 CVE moderate (CSS injection in JSX SSR, JWT NumericDate validation, Cache middleware Vary headers). `npm audit --omit=dev` ramane fara vulnerabilitati de productie.",
      },
      {
        title: "SQLite synchronous = NORMAL",
        content:
          "Adaugat `PRAGMA synchronous = NORMAL` dupa `journal_mode = WAL`. Default-ul SQLite `FULL` e overkill cu WAL (fsync la fiecare commit); NORMAL face fsync doar la checkpoint, fara risc de corruption pe crash. Reduce I/O vizibil pe bulk inserts (monitoring runs, RNPM saves) si elimina pause-uri vizibile la fsync.",
      },
      {
        title: "RNPM constants in env",
        content:
          "`RNPM_SITEKEY`, `RNPM_PAGEURL` si `RNPM_USER_AGENT` mutate la lazy getters care citesc `process.env` la apel. Operatorul poate hot-swap-a valorile fara rebuild daca RNPM roteste hCaptcha-ul sau rate-limita UA-ul vechi. Const-urile vechi raman exportate ca fallback.",
      },
      {
        title: "Exporturi RNPM / PortalJust / Alerte la backend streaming",
        content:
          "Build-ul XLSX/PDF pentru avize RNPM (sute) si liste PortalJust / Alerte sufoca Electron main process la 4GB peak. Rescris cu `exceljs.stream.xlsx.WorkbookWriter` (row-by-row pe fisier temp) si `pdfkit` streaming. Rute noi `POST /api/v1/{rnpm/saved,dosare,termene,alerte}/export.{xlsx,pdf}`, raspunsul stream-uieste fisierul temp si face unlink pe close. Frontend cere blob direct, fara round-trip prin worker. 8 fisiere de test noi acopera build + filename + stilizare + cap-uri + edge cases.",
      },
      {
        title: "Hardening post-streaming",
        content:
          "Patru fix-uri pe path-ul nou de export inainte de merge: (1) body cap 25MB pe `POST /dosare/export.*` + `POST /termene/export.*` (default Hono 8MB ar fi taiat exporturi >150 dosare cu istoric SOAP gros); (2) type-guard `isDosarShape` / `isTermenShape` care valideaza forma payload-ului inainte sa intre in builder, intoarce 400 cu pozitia elementului invalid; (3) helper shared `finishWriteStream(stream, tmpPath)` care face `Promise.race([once('finish'), once('error')])` si cleanup tmp file pe error — elimina race-ul vechi unde un error emis dupa `'open'` dar inainte de `'finish'` nu ar fi rejectat promise-ul; (4) helper shared `formatRoDate` / `formatRoDateTime` cu `timeZone: 'Europe/Bucharest'` explicit + parsare string-based pentru date-only — bug-ul vechi `new Date('2026-05-13').toLocaleDateString('ro-RO')` shift-uia data cu o zi inapoi pe masini in TZ-uri vestice (UTC-8+).",
      },
    ],
  },
  {
    version: "v2.21.0",
    date: "12 Mai 2026",
    subtitle:
      "RNPM trust + DB migrations safety: validare runtime Stage 1 cu Zod (`safeParse` + warning, throw pregatit prin `RNPM_RUNTIME_VALIDATION_ENFORCED=1`), status RNPM `activ` pastrat ca `null` cand upstream-ul nu il trimite si afisat ca `Necunoscut`, purge chunked pentru `monitoring_runs`, index nou `idx_monitoring_runs_started_at` si sentinel explicit `0001_baseline.down.sql`.",
    icon: <Shield className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "RNPM runtime validation Stage 1",
        content:
          "`RnpmClient.search()` valideaza payload-ul cu o schema Zod minima si `.passthrough()`. In acest release payload-urile invalide logheaza warning si raman compatibile; flag-ul `RNPM_RUNTIME_VALIDATION_ENFORCED=1` pregateste tranzitia la fail-loud.",
      },
      {
        title: "`activ: null` + badge Necunoscut",
        content:
          "Cand RNPM nu trimite status activ/inactiv, baza locala pastreaza `NULL`, iar UI-ul si exporturile afiseaza `Necunoscut` cu stil amber subtil in loc sa presupuna gresit ca avizul este activ.",
      },
      {
        title: "Retention safety pentru monitoring_runs",
        content:
          "`purgeOldRuns()` sterge in batch-uri de 1000 cu safety cap 1M randuri per rulare. Migration 0019 adauga index pe `started_at`, iar `0001_baseline.down.sql` refuza explicit rollback-ul baseline.",
      },
      {
        title: "Tests",
        content:
          "Teste noi pentru Zod Stage 1, `activ: null`, chunked purge, migration sentinels si status badges RNPM.",
      },
    ],
  },
  {
    version: "v2.20.9",
    date: "12 Mai 2026",
    subtitle:
      "Safety hardening fara schimbare vizibila: type-guard total pe payload RNPM, cap 8MB pe raspunsul SOAP PortalJust si sentinel pentru exporturile XLSX care scriu fara `sanitizeFormulaCells`.",
    icon: <Shield className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "RNPM first result guard",
        content:
          "`executeSearch()` refuza acum payload-uri RNPM corupte in care `total` lipseste sau este `null`; guardul nu mai poate fi bypass-uit prin `undefined > 1500`.",
      },
      {
        title: "SOAP response cap 8MB",
        content:
          "`callSoap()` verifica `Content-Length` inainte de citire si `text.length` dupa citire. Clientul primeste mesaj generic, iar detaliile de marime raman in log.",
      },
      {
        title: "XLSX formula sentinel",
        content:
          "Test nou in `frontend/src/lib/xlsx-formula-audit.test.ts` care esueaza daca apare un writer XLSX fara apel `sanitizeFormulaCells`.",
      },
    ],
  },
  {
    version: "v2.20.8",
    date: "12 Mai 2026",
    subtitle:
      "Hardening operational ce inchide Batch 2 (Operator visibility) si Batch 4 (Scheduler & captcha reliability) din FIXES-TODO.md. Operatorul primeste vizibilitate noua: alert `source_partial` (feature flag `MONITORING_PARTIAL_ALERTS_ENABLED=1`) la failure partial pe institutii SOAP, `/health` expune `emailConfigured`, pre-exit backup pe fatalBoot, cleanup `-wal`/`-shm` pe auto-revert si splash blocking peste VACUUM. Scheduler & captcha: `.catch` pe runOne fire-and-forget (elimina runs `running` stuck), `AbortSignal.timeout(15s)` pe `getBalance()`, race-mode sleep signal-aware prin `Promise.race`, retry exponential pe daily report email scheduler ([5/15/45] min cu `retry_exhausted` audit), periodic sweep 5min pe rate-limit middleware. Zero schimbari schema, zero schimbari contract API. +10 teste backend (854/854) + 100/100 frontend.",
    icon: <Shield className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Batch 2.1 — Alert `source_partial` (feature flag)",
        content:
          "Cand `MONITORING_PARTIAL_ALERTS_ENABLED=1`, `nameSoapRunner` emite un alert cu kind `source_partial` + severity `warning` daca cel putin o institutie esueaza dar restul reusesc. Anterior, failure-ul partial era doar `console.warn`, operatorul nu vedea nimic in UI Alerts. Detaliile alertului includ lista institutiilor cazute si pe a celor reusite, pentru triage rapid. Flag-ul ramane OFF default 24-48h dupa rollout — refactor: constanta top-level inlocuita cu functie lazy `partialAlertsEnabled()` ca flag-ul sa fie testabil.",
      },
      {
        title: "Batch 2.2 — Pre-exit backup pe fatalBoot",
        content:
          "`fatalBoot` din `migrate.ts` cheama acum `preMigrationBackup('schema-upgrade')` inainte de `process.exit(1)`, ca operatorul sa aiba un snapshot timestamped al DB-ului cand troubleshoot-uieste o migrare esuata.",
      },
      {
        title: "Batch 2.3 — `/health` expune `emailConfigured`",
        content:
          "Endpoint-ul `/health` returneaza acum si `emailConfigured: boolean` (derivat din prezenta `SMTP_HOST`), ca admin-ul sa vada direct daca canalul email de alerte e configurat in env.",
      },
      {
        title: "Batch 2.4 — Cleanup `-wal`/`-shm` pe auto-revert",
        content:
          "Pe revert automat al unei migrari esuate, cleanup-ul include explicit fisierele `-wal`/`-shm` ale snapshotului, nu doar `.db`. Anterior puteau ramane orfane si confunda boot-ul urmator.",
      },
      {
        title: "Batch 2.5 — VACUUM splash UX",
        content:
          "Peste modalul de stats din Baza locala RNPM apare in timpul `POST /compact` un splash full-screen blocking (`role='alertdialog'`, `aria-busy`) care interzice inchidere prin ESC, click-pe-backdrop sau X-button. Mesaj clar 'Compactez baza locala...' + warning 'Nu inchide aplicatia'. Previne corupere DB la close midstream.",
      },
      {
        title: "Batch 4.1 — `runOne` `.catch` handler",
        content:
          "Fire-and-forget `void this.runOne(...)` din scheduler are acum `.catch` care logheaza jobId + runId + `error.message` (fara stack), eliminand riscul de run-uri 'stuck' la `running` pe orice exceptie uncaught din runner.",
      },
      {
        title: "Batch 4.2 — `getBalance()` cu `AbortSignal.timeout(15s)`",
        content:
          "Ambele helpere `getBalance()` (2Captcha + CapSolver) au acum `AbortSignal.timeout(15_000)` ca admin GET `/captcha/balance` sa nu blocheze indefinit cand upstream-ul e degradat.",
      },
      {
        title: "Batch 4.3 — Race-mode sleep signal-aware",
        content:
          "In race-mode, sleep-ul din poll-ul `getResult` foloseste acum `Promise.race([sleep, signalPromise])` ca abort-ul sa fie imediat, nu doar dupa expirarea intervalului (anterior `signal.aborted` era verificat DUPA sleep, latentand cancelarea cu pana la 1s).",
      },
      {
        title: "Batch 4.4 — Daily report retry cu backoff",
        content:
          "Cand emailul zilnic esueaza (listAlerts throw, send result !ok sau send catch), scheduler-ul retry-uieste pana la 3 incercari cu backoff [5min, 15min, 45min]. Dupa epuizare, audit log `retry_exhausted` + zi marcata sent (best-effort). State `Map<ownerId, retryState>` in-memory; pierderea la restart e acceptabila pentru scheduler best-effort.",
      },
      {
        title: "Batch 4.5 — Rate-limit periodic sweep",
        content:
          "Pe langa cleanup-ul existent la `MAX_BUCKETS` threshold, adaugat `setInterval(5min)` care purga bucketurile expirate, prevenind crestere bursty-then-idle care nu mai atinge threshold-ul.",
      },
      {
        title: "Tests",
        content: "+10 teste backend (854/854), frontend 100/100. Type-check + biome + build curat.",
      },
    ],
  },
  {
    version: "v2.20.7",
    date: "11 Mai 2026",
    subtitle:
      "Polish release dupa v2.20.6, trei interventii independente narrow-scope: (a) export 'toate avizele filtrate' in Baza locala RNPM, nu doar pagina vizibila (client-side batching pe /saved + /saved/export, fara modificari backend); (b) sheet-ul 'Debitori' redenumit 'Parti' pentru ca in practica contine entitati cu rol Cesionar/Cedent/Garant/etc., nu doar literalmente debitori — verificat empiric (TELECREDIT IFN: 106 ori Cesionar, 1 Cedent); (c) toggle in-memory in Setari pentru a opri popup-urile Windows/macOS legate de alerte, fara a afecta bulina cu count sau pagina Alerts, fara queue (la reactivare nu vine flood). Plus micro-fix: tabul Bulk RNPM ramane montat la schimbare de tab ca sa nu se anuleze cautarile in progres.",
    icon: <Sparkles className="h-5 w-5" />,
    borderColor: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    sections: [
      {
        title: "Export toate avizele filtrate din Baza locala",
        content:
          "Anterior, butoanele 'Excel' si 'PDF' din panoul Baza locala RNPM exportau doar pagina vizibila (max 25 inregistrari). Acum, cand nu exista selectie explicita, exporta intregul set filtrat — `rnpmGetAllSaved` aduce toate inregistrarile pe pagini de 200 (cap-ul backend `/saved`), iar `rnpmExport` trimite IDs in batch-uri de 500 (cap-ul backend `/saved/export`). Butoanele afiseaza count-ul corect: `total` cand nu e selectie, `selectedIds.size` cand este. Backend neatins.",
      },
      {
        title: "Sheet 'Debitori' -> 'Parti'",
        content:
          "Numele sheet-ului mostenea bucket-ul RNPM upstream (`part3.debitoriF/J`), dar in practica contine entitati cu rol/calitate variata: Cesionar, Cedent, Debitor cedat, Garant, etc. Verificare empirica pe baza locala: TELECREDIT IFN (CUI 33317138) apare de 106 ori ca Cesionar, 1 data Cedent, 0 ori in tabela `rnpm_creditori`. DB schema (`rnpm_creditori` / `rnpm_debitori`) ramane neatinsa — schimbarea e doar la presentation layer (xlsx + PDF + linia de stats).",
      },
      {
        title: "Toggle notificari sistem pentru alerte",
        content:
          "Checkbox nou in Setari -> Notificari sistem: 'Trimite notificari sistem pentru alerte noi'. Cand e debifat, `useAlertsStream.showDesktopNotification` face early-return inainte de orice apel `desktopApi.showNotification`. Bulina cu numar de unread si pagina Alerts raman neatinse. Preferinta e in-memory (session-scoped), default ON la fiecare restart Electron — nu se persista in localStorage. Cand e off, nimic nu se queue-uieste, deci la reactivare nu primesti un flood de alerte missed. Butonul Test se dezactiveaza odata cu toggle-ul.",
      },
      {
        title: "Bulk RNPM ramane montat la schimbare de tab",
        content:
          "Tabul 'Bulk' din `RnpmSearch` e acum tinut montat prin `className` `hidden` cand userul comuta la 'Search' sau 'Saved', in loc sa fie unmount-uit. Anterior, schimbarea tabului in timpul unei cautari Bulk in progres declansa cleanup-ul useEffect care anula `AbortController`-ul si pierdea progresul. Acum, doar navigarea afara din pagina RnpmSearch mai aborteaza cautarea.",
      },
      {
        title: "Tests",
        content: "Frontend 100/100, backend neatins (844/844 ramane). Type-check curat pe ambele workspace-uri.",
      },
    ],
  },
  {
    version: "v2.20.6",
    date: "10 Mai 2026",
    subtitle:
      "Hygiene release: documentatie env vars + microfix envelope pe rute admin. .env.example creat de la zero (toate cele ~25 env vars folosite in cod, grupate in 7 sectiuni: mod & bind, auth web mode, storage, monitoring, email SMTP, AI providers, RNPM kill switches), cu adnotari REQUIRED-WEB / OPTIONAL si descrieri concrete — inchide CP-2 din root CLAUDE.md. requireRole.ts (admin guard) migreaza cele 3 retururi 401/403 la envelope-ul standard `{ data, error: { code, message }, requestId }` via `fail()` ca admin tooling sa traceze respins-urile prin `requestId`. Migrarea envelope pe celelalte rute legacy (rnpm/dosare/termene/ai) ramane amanata pentru PR-6 (`@hono/zod-openapi`) per policy-ul explicit din `util/envelope.ts` si guardul din `rnpm.contract.test.ts` — nu fac migrare incrementala manual ca sa nu sparg contractul.",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: ".env.example reconstruit (CP-2 closure)",
        content:
          "Pana acum repo-ul nu avea `.env.example`, desi codul referea ~25 env vars (LEGAL_DASHBOARD_*, MONITORING_*, SMTP_*, ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_KEY, RNPM_AUDIT_CAP_HIT_DISABLED, etc.). Fisierul nou grupeaza variabilele in 7 sectiuni cu comentarii explicite: ce e default-uit, ce e REQUIRED-WEB (web mode refuza pornirea fara), ce e kill switch operational. Listate la final si constantele hardcodate (RNPM_SITEKEY, RNPM_USER_AGENT) ca referinta — daca migreaza candva la env vars, pointer-ul exista deja.",
      },
      {
        title: "requireRole envelope (Batch 1.1)",
        content:
          "`backend/src/middleware/requireRole.ts` retureaza acum `fail('unauthorized'|'forbidden', message, c)` pe cele 3 cai de denial (user_not_found, user_inactive, role_mismatch) in loc de raw `{ error: { code, message } }`. Comportamentul pe wire schimba aditiv: adauga `data: null` + `requestId` (din requestId middleware) pe acelasi obiect — toate testele existente raman verde pentru ca asertarea era pe `body.error.code` si `body.error.message`, nu pe shape-ul intregului payload. Beneficiul real: admin tooling poate corela 401/403 din audit log cu request-ul HTTP exact prin `requestId`.",
      },
      {
        title: "Restul rutelor legacy — DEFER la PR-6",
        content:
          "Migrarea rnpm.ts (bodyTooLarge 413 + web-mode 501) si a dosare/termene/ai la envelope a fost EXPLICIT amanata. Doua semnale in repo o cer: (1) `backend/src/util/envelope.ts` are comentariu explicit ca migrarea sa fie one-shot odata cu `@hono/zod-openapi` (PR-6), nu incrementala; (2) `backend/src/routes/rnpm.contract.test.ts` are docstring care marcheaza testele ca guard de migrare — schimbarea shape-ului fara PR-6 sparge contract tests. Batch-urile 1.2/1.3/1.4 din FIXES-TODO ramant deschise pentru PR-6.",
      },
      {
        title: "Tests",
        content:
          "Backend 844/844, frontend 100/100. Type-check curat pe ambele. Singurele schimbari functionale sunt cele 3 retururi din requireRole — asertiile testelor erau pe `body.error.code/message`, deci raman compatibile cu shape-ul aditiv.",
      },
    ],
  },
  {
    version: "v2.20.5",
    date: "10 Mai 2026",
    subtitle:
      "Hotfix release pipeline + SSE timeout aliniat la cap-ul real de 200 CUI. v2.20.4 a fost taggat dar build-ul GitHub Actions a esuat (Docker + macOS) pentru ca commit-ul de release a stripuit accidental blocurile scripts, build si devDependencies din root package.json — NSIS/DMG-ul nu a fost generat. v2.20.5 restaureaza root package.json integral si rezolva 2 findings CodeRabbit pe v2.20.4: (1) timeout SSE bumped 60 min -> 90 min ca sa acopere worst-case-ul real de 200 CUI in 1 stream ipoteci (~83 min), nu doar use case-ul cu taburi paralele × 100 CUI; (2) wording corectat in changelog ca sa nu mai contrazica el insusi estimarea de 83 min in aceeasi propozitie cu afirmatia 'acopera 200 CUI in 1 stream'.",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Restore tooling root package.json",
        content:
          "Restaurate scripturile dev:backend, dev:frontend, build, dist, dist:mac, dist:server, electron:dev, rebuild:electron, typecheck*, test*, lint, check (fara ele 'npm run build' returneaza 'Missing script' si workflows-urile fail-eaza). Restaurat blocul electron-builder (appId, files, NSIS, mac DMG, asarUnpack). Restaurate devDependencies: @biomejs/biome, electron@41, electron-builder@26, esbuild, png-to-ico, sharp.",
      },
      {
        title: "SSE timeout 60 min -> 90 min (CodeRabbit fix)",
        content:
          "v2.20.4 a ridicat cap-ul UI la 200 CUI dar a setat SSE_TIMEOUT_MS la 60 min, sub worst-case-ul real de ~83 min (200 items × 25s ipoteci) — taia stream-ul pe la item ~144. v2.20.5: SSE_TIMEOUT_MS = 5400000 (90 min) acopera batch-uri reale de 200 CUI in 1 stream singur pe categoria ipoteci (cea mai lenta), plus margin pentru retries captcha si latenta upstream variabila. Ramane cap finit ca taburile orfane sa nu hang-uiasca indefinit.",
      },
      {
        title: "Changelog v2.20.4 — wording corectat",
        content:
          "CodeRabbit a flag-uit ca v2.20.4 anunta 'acopera 200 CUI in 1 stream singur' si in aceeasi propozitie mentiona 'worst-case ipoteci ~83 min' (auto-contradictoriu). v2.20.5 reformuleaza onest: 60 min era acoperea use case-ul cu 2-6 taburi paralele × 100 CUI; abia 90 min (v2.20.5) acopera worst-case-ul de 200 CUI / 1 stream ipoteci. v2.20.4 entry primeste un CORRIGENDUM marcat explicit.",
      },
      {
        title: "Tests",
        content:
          "Backend 844/844, frontend 100/100. Type-check curat pe ambele. Singura schimbare functionala e constanta SSE_TIMEOUT_MS — niciun test backend nu hardcoda valoarea, deci suite-ul ramane neschimbat.",
      },
    ],
  },
  {
    version: "v2.20.4",
    date: "10 Mai 2026",
    subtitle:
      "(Versiune fara installer — build CI a esuat din cauza unui regress in root package.json; vezi v2.20.5 pentru hotfix.) UX hardening pentru bulk RNPM la batch-uri mari + rate-limit ridicat. Bulk SSE timeout extins de la 10 min la 60 min ca sa acopere use case-ul cu 2-6 taburi paralele × 100 CUI fiecare in ~20-40 min. UI MAX_BATCH crescut la 200 (egaleaza cap-ul server) cu hint vizibil pentru >150 CUI ca recomanda splitting paralel. Rate-limit-ul global per (ip, ownerId) ridicat de la 30 la 120 req/min — pragul anterior era prea conservator pentru UX desktop (Refresh + Inchide toate + paginare burst-uia usor 30/min si producea 429 in flow normal pe pagina Alerts).",
    icon: <Rocket className="h-5 w-5" />,
    borderColor: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    sections: [
      {
        title: "Bulk SSE timeout 10 min -> 60 min (CORRIGENDUM v2.20.5)",
        content:
          "Pana acum SSE_TIMEOUT_MS = 600000 ucidea orice bulk peste ~24 items la 25s/item — practic peste cap-ul de 100 CUI din UI. v2.20.4 ridica timeout-ul la 3600000 (60 min) pentru use case-ul real cu 2-6 taburi paralele × 100 CUI fiecare in ~20-40 min. CORRIGENDUM v2.20.5: 60 min NU acopera worst-case-ul de 200 CUI / 1 stream ipoteci (~83 min) — v2.20.5 re-bump la 90 min ca sa-l acopere si pe acela. Functioneaza identic pe toate cele 5 categorii (ipoteci, specifice, fiducii, creante, obligatiuni).",
      },
      {
        title: "UI MAX_BATCH 100 -> 200 + hint pentru splitting paralel",
        content:
          "Cap-ul UI a fost ridicat sa egaleze cap-ul server (200), cu un hint vizibil amber sub textarea cand utilizatorul lipeste >150 CUI: recomanda splitting in 2-3 taburi paralele cu nota explicita ca fiecare bulk are propriul stream SSE si nu se influenteaza reciproc — wall time scade liniar cu numarul de taburi.",
      },
      {
        title: "Rate-limit 30 -> 120 req/min per (ip, ownerId)",
        content:
          "Constanta RATE_LIMIT exportata acum din rate-limit.ts pentru a evita duplicarea magic number-ului in teste. 120 acopera bursturi UX realiste (Alerts page Refresh + Inchide toate + paginare), pastreaza protectia impotriva runaway loops (un infinite useEffect ar fi blocat tot dupa ~1 min) si ramane izolare per (ip, ownerId) in web mode. Pe desktop ownerId e tot 'local' deci behavior-ul e simplu un budget mai larg pentru flow-urile normale ale unui singur user.",
      },
      {
        title: "Tests",
        content:
          "Backend 844/844 (neschimbate, dar testele de rate-limit folosesc acum constanta exportata in loc de magic 30). Frontend 100/100 (neschimbate). Type-check curat pe ambele.",
      },
    ],
  },
  {
    version: "v2.20.3",
    date: "8 Mai 2026",
    subtitle:
      "Hardening RNPM dupa /full-review v2.20.2. Audit_log-ul are acum retentie 90 zile (analog cu monitoring_runs si ai_usage), o coloana request_id noua corelata cu envelope-ul {data, error, requestId} (admin Audit page poate filtra exact pe requestId-ul afisat la front), si un kill switch operational (RNPM_AUDIT_CAP_HIT_DISABLED=1 sare INSERT-ul fara restart). Split-ul fail-fast-uieste dupa 3 refuzuri tacite consecutive RNPM (silent_refusal pe 3 sub-tipuri la rand inseamna ca upstream throttle-uieste wholesale — saritura restul cu reason RO in loc de waste 18 captcha). SSE-ul distinge acum aborted (client a inchis conexiunea) vs timeout (server a depasit 15min hardcap), fiecare cu searchId si timeoutMs explicit. captchasUsed acumuleaza si retry-urile interne (search_retry pe gcode invalid pe pagina). subTypeLabels validate la backend impotriva unei liste canonice (mirror al rnpm-form-constants.ts) ca nu se mai poate trimite drift.",
    icon: <Shield className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Audit retention 90 zile + corelare cu envelope requestId",
        content:
          "audit_log creste monoton pe productie cu ~1 INSERT per request mutant; v2.20.3 adauga purgeOldAuditLog(retentionDays = 90) apelat din scheduler-ul de monitoring (analog cu monitoring_runs si ai_usage). Migration 0017 adauga audit_log.request_id (TEXT, nullable pe randuri legacy) cu index partial; pagina admin Audit poate filtra acum exact pe requestId-ul afisat in toast-urile de eroare front, ca un user sa-i poata da unui admin un id si admin-ul sa gaseasca evenimentul exact in 1 click.",
      },
      {
        title: "Fail-fast pe K=3 silent_refusal consecutive",
        content:
          "Cand RNPM intoarce total>0 dar documents:[] de 3 ori la rand pe acelasi split (refuz tacit upstream — semn de throttle wholesale), backend-ul saritura restul sub-tipurilor cu reason RO 'Sarit dupa 3 refuzuri tacite consecutive RNPM (fail-fast)' in loc de a astepta sa termine toate 18 sub-tipurile pentru categoria ipoteci. Counter reseteaza pe semnale clare ca upstream functioneaza (total=0 sau success cu docs sau limit_exceeded). Erorile transient (network, captcha) nici nu reseteaza nici nu incrementeaza, ca fluctuatii nu se confunde cu refuz upstream.",
      },
      {
        title: "SSE differentiation client_aborted vs server_timeout",
        content:
          "Pana acum AbortError-ul nu distingea daca user-ul a inchis tab-ul (renderer abort) sau a expirat hardcap-ul intern de 15 minute. Acum c.req.raw.signal?.aborted === true distinge cazurile, SSE emite event 'aborted' (cu searchId, reason: 'client_aborted') sau 'timeout' (cu searchId, reason: 'server_timeout', timeoutMs: 900000). Frontend-ul stie sa afiseze toast 'cautare anulata' vs 'timeout server', si poate naviga catre searchId pentru partial state.",
      },
      {
        title: "captchasUsed corect pe retry-uri",
        content:
          "Inainte counter-ul incrementa o singura data per executeSearch, ratand search_retry-urile pe gcode invalid. Acum executeSearch returneaza captchasUsed in result, iar executeSplitSearch / executeNestedDestinationSplit acumuleaza din result. Pe error path conservative +1 (cel putin captcha-ul initial a fost consumat). Util pentru UI care afiseaza count-ul de captcha consumate la sfarsit de cautare (cost real, nu count optimist).",
      },
      {
        title: "Allow-list canonica pe subTypeLabels + kill switch RNPM_AUDIT_CAP_HIT_DISABLED",
        content:
          "Backend-ul are acum un mirror al frontend/components/rnpm/rnpm-form-constants.ts:TIP_AVIZ_BY_CATEGORY in services/rnpmSubTypes.ts; POST /search-split valideaza ca lista trimisa e prefix exact (ordine + casing). Drift accidental sau tampering pe indexarea 1-based pe care RNPM o asteapta in tipInscriere.value e respins cu 400 inainte de a porni SSE-ul. Plus: RNPM_AUDIT_CAP_HIT_DISABLED=1 in env opreste INSERT-ul rnpm.cap_hit fara restart, util operational daca audit_log creste prea repede sau in incident upstream.",
      },
      {
        title: "Tests",
        content:
          "Backend 844/844 (era 827, +17 noi cumulativ): 2 fail-fast happy path + counter reset, 5 edge cases (abort mid-tier-2, mixed gapReasons, single-sub-type, all-empty, tier-2 generic error), 4 audit requestId persist + override + NULL + filter, 2 allow-list reject + kill switch, plus auxiliare. Frontend 100/100 (neschimbate).",
      },
    ],
  },
  {
    version: "v2.20.2",
    date: "8 Mai 2026",
    subtitle:
      "Patch correctness post /full-review. Audit-ul rnpm.cap_hit nu mai converteste un succes in eroare daca insertul in audit_log esueaza (try/catch local, failure logat ca warn). Campul criteriu (CUI/CNP/nume cautat) a fost scos din audit detail (era duplicat al payload-ului de cautare si crea un risc GDPR inutil); am pastrat doar searchType. Sub-tipurile blocate in tier-2 apar acum in blockedLabels cu prefix tier1 > tier2 (pana acum nested gap-urile nu erau vizibile in audit). Aritmetica gapByReason corectata pentru status partial — folosim gap-ul deja calculat de service in loc de o derivare care dubla numara recovered tier-2. Overlay-ul split fix bottom-right e humanizat si 1-based (v2.20.1 rezolvase doar banner-ul). Switch-urile humanizers folosesc _exhaustive: never ca un enum nou neimplementat sa fail-uiasca build-ul TS. +4 teste unit pe shape audit / failure isolation / no-emit / s.gap.",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-slate-500",
    badgeClass: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400",
    sections: [
      {
        title: "Audit rnpm.cap_hit nu mai poate flip-ui un succes in eroare",
        content:
          "Inainte: daca insertul in audit_log esua (de exemplu DB locked), recordAudit arunca, intra in catch-ul SSE si event-ul de complete devenea event de eroare — userul vedea cautare esuata cu mesaj generic, desi rezultatele erau deja salvate. Acum: wrap try/catch local pe recordAudit, failure scris ca console.warn cu searchId si motivul, SSE complete-ul ajunge la client. Audit observability nu este o dependenta hard a flow-ului user.",
      },
      {
        title: "GDPR — criteriu de cautare scos din audit detail",
        content:
          "rnpm.cap_hit loga in detail criteriu (CUI / CNP / nume) duplicat fata de payload-ul de cautare. Acum scriem doar searchType (enum low-cardinality: ipoteci / specifice / creante / obligatiuni / fiducii). Cui / nume cautat raman in payload-ul cautarii originale, nu si in audit_log unde retentia poate fi diferita.",
      },
      {
        title: "blockedLabels include si destinatiile blocate in tier-2",
        content:
          "Pana acum nested gap-urile (destinatii individuale blocate in tier-2 ipoteci) nu apareau in audit. Acum blockedLabels include si entries cu prefix tier1 > tier2 (de exemplu ASUPRA CREANTELOR > INDUSTRIE) cand destinatia e blocata. Lista cap la 20 entries cu flag blockedLabelsTruncated cand depaseste, ca audit_log sa nu creasca patologic la cautari pe debitori foarte mari.",
      },
      {
        title: "gapByReason aritmetic corect pe status partial",
        content:
          "Cand un sub-tip era partial (tier-2 a recuperat parte din rezultate), aritmetica veche (subTotal - count) supraestima gap-ul pentru ca numara si rezultatele recovered. Acum folosim direct s.gap (deja calculat in service ca subTotal - SUM(nested.subTotal)) — exact partea ramasa neacoperita dupa tier-2.",
      },
      {
        title: "Overlay split fix bottom-right humanizat si 1-based",
        content:
          "v2.20.1 humanizase doar banner-ul de progres din toolbar; overlay-ul fix din coltul dreapta-jos inca afisa Split 0/7 si nested_progress brut. Acum overlay-ul foloseste describeSplitPhase + describeNestedPhase si afiseaza Split 1/7 (1-based ca banner-ul). State-ul intern stocheaza obiectul RnpmSplitProgress complet (in loc de un subset cu phase: string), deci nu mai exista divergente.",
      },
      {
        title: "TS exhaustiveness pe humanizers",
        content:
          "Switch-urile pe RnpmGapReason / split phase / nested phase aveau default: care defeats exhaustiveness — daca cineva adauga un enum nou si uita sa-l trateze, build-ul nu il prinde. Acum default: contine const _exhaustive: never = value, deci TS arunca eroare la compile. Cazul runtime undefined (gapReason optional) e tratat explicit inainte de switch.",
      },
    ],
  },
  {
    version: "v2.20.1",
    date: "8 Mai 2026",
    subtitle:
      "UX polish pe banner-ul de progres RNPM split. Cele trei cauze leak-uite tehnic catre interfata (nested_progress, nested_start, nested_done) sunt acum traduse in romana (split secundar, split secundar — start, split secundar — finalizat). Index-ul tier-1 afisat 1-based (Split 1/7 in loc de 0/7 confuz). Cand split-ul intra in tier-2, sub-progresul (3/14 destinatii) e vizibil in banner. Fara schimbari de contract HTTP / DDL / shape SSE.",
    icon: <Split className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Banner split — text humanizat, fara jargon tehnic",
        content:
          "Pana acum banner-ul afisa direct token-ul brut din backend (nested_progress, nested_start, nested_done). Acum exista helper-ul lib/rnpmProgressPhase.ts (formatSplitProgress + describeSplitPhase + describeNestedPhase) care traduce toate cele 9 valori posibile in romana. Index-ul afisat e 1-based pentru lectura naturala (Split 1/7 nu Split 0/7). Cand split-ul intra in tier-2 (sub-tip individual peste 1500), banner-ul afiseaza si sub-progresul: Split 1/7 - aviz initial (split secundar) -> 3/14 publicitatea X (cautare). +8 teste unit pe helper.",
      },
    ],
  },
  {
    version: "v2.20.0",
    date: "8 Mai 2026",
    subtitle:
      "Observability pentru cap-ul RNPM de 1500 rezultate. Banner-ul de cautare split distinge acum trei cauze de gap: terminal_cap (sub-tip > 1500 fara axa de split), silent_refusal (RNPM raporteaza total > 0 dar livreaza 0 documente — rate-limit / captcha invalid) si residual_unclassified (records istorice fara destinatie atribuita ramase dupa tier-2). Fiecare sub-tip blocat afiseaza textul exact al cauzei in loc de respins (X > limita). In paralel, scriem un audit event rnpm.cap_hit la fiecare cautare split cu gap > 0 (detalii: type, criteriu, upstreamTotal, recovered, gap, gapByReason, blockedLabels), util pentru a urmari frecventa cazurilor pe productie. Status-ul intern rejected a fost redenumit blocked, mai semantic clar.",
    icon: <Split className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Banner split — trei cauze de gap, nu una singura",
        content:
          "Pana acum, daca un sub-tip RNPM era exclus din rezultatele agregate, banner-ul afisa doar respins (X > limita), confundand trei situatii distincte: limita atinsa fara axa de split, rate-limit upstream cu raspuns silentios si records istorice fara destinatie atribuita. v2.20.0 separa aceste cauze in trei categorii cu mesaj explicit per categorie: terminal_cap (blocat de limita RNPM, fara axa de split), silent_refusal (blocat de RNPM, raport X dar nicio inregistrare livrata — rate-limit / captcha invalid) si residual_unclassified (blocat partial, ramas neacoperit dupa tier-2). Userul vede acum exact ce a esuat si de ce.",
      },
      {
        title: "Audit event rnpm.cap_hit pentru observability lung-termen",
        content:
          "Orice cautare split care nu acopera 100% din total (gap > 0 sau sub-tipuri blocate) emite un audit event rnpm.cap_hit cu detalii: type, criteriu, upstreamTotal, recovered, gap, gapByReason (suma per cauza) si blockedLabels (lista sub-tipuri blocate). Util pentru analiza retroactiva a frecventei celor trei cauze de gap pe diferite criterii de cautare, fara a deranja userul cu mesaje diagnostice in UI.",
      },
      {
        title: "Rename intern: rejected -> blocked",
        content:
          "Status-ul intern al sub-rezultatelor split a fost redenumit din rejected in blocked, mai semantic clar (RNPM nu respinge tehnic — pur si simplu nu mai poate livra rezultatele). Schimbare contract API SSE (phase si status). Fara impact pentru useri, dar relevant pentru integrari third-party care parsau evenimente split.",
      },
    ],
  },
  {
    version: "v2.19.2",
    date: "7 Mai 2026",
    subtitle:
      "Bugfix highlight Cautare dosare. Tokenii scurti din numele cautat (de exemplu DE) erau evidentiati ca prefix in cuvintele mai lungi (DEMOLARI), lasand restul cuvantului fara highlight. Fix: alternation sortata dupa lungime descrescator si delimitatori Unicode-aware (recunosc litere romanesti precum a, i, S, T) — un cuvant cautat se evidentiaza acum doar cand apare ca cuvant intreg. Fix aplicat in tabela Cautare dosare si in randul de detalii Termene.",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-slate-500",
    badgeClass: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400",
    sections: [
      {
        title: "Highlight-ul nu mai mananca prefixe din alte cuvinte",
        content:
          "La cautarea unui nume cu mai multe cuvinte (de exemplu COMPANIA DE DEMOLARI INDUSTRIALE SRL), tokenul scurt DE matchuia ca prefix in DEMOLARI si lasa MOLARI fara fundal galben. Cauza: regex-ul de highlight testa alternativele in ordinea declarata si nu avea delimitatori. Fix: alternativele sunt sortate dupa lungime descrescator (matchul lung castiga peste cel scurt) si delimitate prin lookarounds Unicode-aware (recunosc litere romanesti precum a, i, S, T), astfel ca un cuvant cautat se evidentiaza doar cand apare ca cuvant intreg, nu cand e prefix sau sufix.",
      },
    ],
  },
  {
    version: "v2.19.1",
    date: "7 Mai 2026",
    subtitle:
      "Patch hardening si UX polish post v2.19.0. Patru fix-uri descoperite la rulare empirica imediat dupa lansarea split-ului tier-2: erori afisate ca [object Object] in modalul Info baza locala in loc de mesajul real, butonul de stop care nu aparea cand incarcarea era declansata din toolbar-ul tabelului, rute admin RNPM (Sterge baza, Backups, Compacteaza) blocate cu Insufficient role pentru utilizatorul desktop, si sectiunea Administrare din sidebar care nu mai apare pe desktop. Plus o documentare formala a limitei tehnice RNPM pentru debitori cu volum foarte mare. Zero schimbari functionale in motorul de split.",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-slate-500",
    badgeClass: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400",
    sections: [
      {
        title: "Mesajele de eroare arata acum textul real, nu [object Object]",
        content:
          "Operatiile administrative pe baza RNPM (sterge tot, sterge backup, compacteaza, listare backup-uri) afisau pana acum eroarea ca [object Object] in modalul Info baza locala. Cauza: layer-ul de retea din frontend stia sa scoata mesajul de eroare doar in formatul vechi (string), nu si in cel nou introdus in v2.14.0 (obiect cu cod si mesaj). Acum acopera ambele forme — vezi mesajul real (de exemplu Insufficient role daca user-ul nu are permisiunea), nu un placeholder generic.",
      },
      {
        title: "Utilizatorul desktop primeste automat rolul de admin la pornire",
        content:
          "Operatiile administrative pe RNPM (sterge baza, sterge backup, compacteaza) erau blocate cu Insufficient role pe instalarile desktop. Cauza: rolul implicit pentru utilizatorul local era user (default sigur pentru cazul web multi-tenant), iar protectiile de admin introduse in v2.11.0 il respingeau. Pe desktop exista un singur utilizator si nu are sens sa fie blocat sa-si administreze propria baza. Fix: la fiecare pornire in mod desktop, daca utilizatorul local exista cu rol diferit de admin, este promovat automat. Idempotent — daca e deja admin, nu face nimic.",
      },
      {
        title: "Sectiunea Administrare din meniu se ascunde pe desktop",
        content:
          "Promovarea automata la admin (de mai sus) declansa side-effect vizibil: sectiunea Administrare (Utilizatori, Audit, Cote) — introdusa in v2.6.0 ca pregatire pentru deploy-ul web multi-tenant — devenea vizibila in sidebar pe desktop. Pentru o aplicatie cu un singur utilizator, e zgomot fara valoare. Acum sectiunea e ascunsa cand aplicatia ruleaza in mod desktop (Electron). Paginile raman accesibile prin URL direct daca e nevoie pentru depanare, dar nu mai sunt promovate in navigatie.",
      },
      {
        title: "Butonul rosu de oprire apare si cand incarcarea e declansata din tabel",
        content:
          "Pana acum, cand apasai Incarca mai multe pe paginarea tabelului (in loc de butonul Incarca tot din toolbar-ul de sus), butonul nu se transforma in rosu cu Opreste incarcarea — ramanea albastru si nu putea fi oprit. Cauza: conditia de afisare astepta starea de auto-loading, dar incarcarea single-batch declansata din tabel folosea o stare distincta de loading. Fix: butonul devine rosu pentru ambele tipuri de incarcare in curs, deci poate fi oprit oricum a fost declansat.",
      },
      {
        title: "Documentare formala a limitei tehnice RNPM pe debitori foarte mari",
        content:
          "Pe debitori cu volum foarte mare (peste 1500 inregistrari intr-o singura combinatie de filtre), recuperarea integrala via API public RNPM e imposibila. Site-ul oficial mj.rnpm.ro insusi cere utilizatorului sa modifice criteriile pentru a ajunge sub 1500. Un fisier nou la radacina proiectului (PROBLEM-rnpm-cap-1500.md) listeaza toate axele de split incercate (tip inscriere, destinatie, perioada, activ, nemodificat, etc.) si motivul pentru care fiecare e suficienta sau nu. v2.19.0 cu best-effort + disclosure UI ramane raspunsul corect: recuperam ce putem, raportam onest ce nu.",
      },
    ],
  },
  {
    version: "v2.19.0",
    date: "7 Mai 2026",
    subtitle:
      "Cautarile RNPM extinse cu un al doilea nivel de impartire automata cand un sub-tip individual depaseste tot capul de 1500 inregistrari. Pana in v2.18.0, daca un singur sub-tip continea peste 1500 records (caz empiric: pe categoria specifice, sub-tipul aviz initial avea singur 1823), aplicatia il marca respins si nu recupera nimic din el. v2.19.0 declanseaza in cazul acesta o a doua impartire pe destinatie (14 valori pentru specifice, 10 pentru ipoteci), recuperand records pe destinatie individuala. Recuperarea e best-effort: records fara destinatie atribuita raman neacoperite, iar gap-ul e listat explicit in banner-ul de rezultate.",
    icon: <Split className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Recuperare in doi pasi cand un sub-tip individual depaseste 1500",
        content:
          "Pe categoriile specifice si ipoteci, daca o cautare cu split (introdusa in v2.18.0) intalneste un sub-tip care singur trece de 1500 records, aplicatia incearca acum un al doilea pas: ruleaza N cautari secventiale per destinatie (14 valori pentru specifice — aviz initial, modificator, rectificare, etc.; 10 pentru ipoteci). Toate rezultatele se agrega in acelasi entry de istoric ca tier-1. Daca tier-2 acopera complet sub-tipul, status-ul afisat este recuperat. Daca acopera doar partial (records fara destinatie atribuita raman in afara filtrelor), status-ul este partial si gap-ul e listat in banner.",
      },
      {
        title: "Disclosure explicit al gap-ului in UI",
        content:
          "Dialogul de confirmare al cautarii cu split arata acum cost si timp ca interval (intre minim — daca toate sub-tipurile incap in 1500 — si maxim — daca toate declanseaza tier-2). Banner-ul de deasupra tabelei dupa rulare listeaza fiecare sub-tip cu status-ul individual (terminat, recuperat, partial, respins) si, in cazul partial, numarul exact de records care nu au putut fi recuperate. Cand suma gap-urilor depaseste zero, apare un callout amber explicit: X inregistrari fara destinatie atribuita nu au putut fi recuperate.",
      },
      {
        title: "Categoriile fara destinatii enumerable raman fail-clean",
        content:
          "Pentru creante, obligatiuni si fiducii (care nu au lista finita de destinatii in formularul oficial RNPM), comportamentul ramane cel din v2.18.0: sub-tipurile peste 1500 sunt marcate respins si rularea continua. Dialogul de confirmare diferentiaza explicit cele doua scenarii — pentru categoriile cu tier-2 disponibil afiseaza pre-warning despre best-effort, pentru celelalte mesaj de fail-clean.",
      },
      {
        title: "Timeout extins la 45 de minute pentru cazul worst-case",
        content:
          "Limita interna de timp a unei cautari cu split (SSE_SPLIT_TIMEOUT) creste de la 30 la 45 de minute pentru a acoperi cazul rar in care fan-out-ul total tier-1 + tier-2 atinge maximul (de exemplu pe ipoteci cu 18 sub-tipuri tier-1, dintre care unele declanseaza tier-2 cu 10 destinatii). Worst-case util e ~11 minute, restul e marja pentru retry captcha si jitter de retea.",
      },
      {
        title: "Acoperire pe teste",
        content:
          "Trei teste noi in suita backend verifica: (1) dispatcher-ul itereaza EVERY sub-tip tier-1 chiar cand cel din mijloc declanseaza tier-2; (2) tier-2 itereaza EVERY destinatie din lista categoriei; (3) categoriile fara destinatii enumerable raman fail-clean fara incercare de tier-2. Total: 822 teste backend (de la 819 in v2.17.0), 86 teste frontend.",
      },
    ],
  },
  {
    version: "v2.18.0",
    date: "6 Mai 2026",
    subtitle:
      "Cautarile RNPM care depasesc limita oficiala de 1500 inregistrari (caz tipic: debitor PJ cu CUI cu multe ipoteci active) primesc acum o ramificare automata: cand serverul RNPM raspunde cu mai multe rezultate decat poate intoarce intr-un singur request, aplicatia te intreaba daca vrei sa rulezi N cautari separate (cate una pentru fiecare tip de inscriere disponibil la categoria curenta). Vezi costul estimat in captcha-uri si timpul aproximativ inainte sa confirmi. La accept, fiecare sub-cautare ruleaza secvential, rezultatele se agrega intr-un singur entry de istoric, iar daca un sub-tip individual ramane peste limita, e marcat respins fara a opri restul rularii.",
    icon: <Split className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Cautare RNPM cu auto-split la depasirea limitei de 1500",
        content:
          "Pana acum, daca o cautare RNPM intorcea peste 1500 rezultate (limita oficiala a registrului), primeai eroarea opaca limita 1500 si nu aveai cum sa obtii inregistrarile. Acum aplicatia detecteaza situatia, iti arata un dialog cu numarul de sub-cautari care se vor rula (egal cu numarul tipurilor de inscriere disponibile la categoria curenta — de exemplu 18 pentru ipoteci, 9 pentru creante), costul estimat in captcha-uri (in functie de provider — 2Captcha sau CapSolver) si timpul aproximativ. La confirmare, fiecare sub-tip se ruleaza ca o cautare normala (cu propriul captcha), iar rezultatele se agrega intr-un singur entry in istoricul de cautari. Lista din dreapta sus iti arata progresul: ce sub-tip ruleaza acum, cate au fost completate, cate au fost respinse.",
      },
      {
        title: "Fail-clean per sub-tip — niciun rezultat partial nu se pierde",
        content:
          "Daca un sub-tip individual depaseste tot limita de 1500 (cazul rar in care chiar si o singura categorie de inscriere are peste 1500 rezultate active), acel sub-tip e marcat respins iar restul cautarilor continua. Inregistrarile colectate de la sub-tipurile reusite sunt salvate normal in baza locala, iar deasupra tabelei rezultate apare un banner amber care iti arata explicit ce sub-tipuri au fost respinse. Pentru cazurile respinse, urmatorul pas manual este sa adaugi filtre suplimentare (de exemplu interval data) pentru a reduce numarul de rezultate.",
      },
      {
        title: "Buton Incarca tot dezactivat in mod split",
        content:
          "Cand rezultatele provin dintr-o cautare cu split, butonul Incarca tot din pagina Cautare RNPM e dezactivat — toate documentele de la sub-tipurile reusite sunt deja incarcate in tabelul de pe ecran. Pagination ramane disponibila pentru navigarea normala pe primele 25/50/etc.",
      },
    ],
  },
  {
    version: "v2.17.0",
    date: "6 Mai 2026",
    subtitle:
      "Sesiune de hardening operational dupa multi-review-ul facut peste v2.16.1, care absoarbe 28 de findings grupate in 5 prioritati (P1 critical -> P5 nice-to-have). Zero schimbari vizibile in UI; toate fix-urile sunt strict interne sau pe shape-ul email-urilor (un kind de alerta lipsea din mapa de label-uri pe email-urile per-alerta — aparea ca text raw 'termen_dupa_solutie' in subiect). Robustete crescuta pe atomicitate audit / migratii cu sidecar / partial success in multi-institutie / boot fail-loud / drift detector kind-uri.",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Eticheta corecta in subiectul email-ului per alerta noua",
        content:
          "Cand v2.15.0 a adaugat kind-ul Termen nou dupa solutie, mapa cu denumirile prietenoase din modulul de email per-alerta nu a fost actualizata. Pana acum, alertele de tip amanare ajungeau in subiectul email-ului cu textul tehnic 'termen_dupa_solutie' in loc de 'Termen nou dupa solutie'. Acum mapa este tipizata strict pe lista oficiala a kind-urilor — daca cineva mai uita sa adauge un label nou la introducerea unui kind, compilatorul refuza sa porneasca.",
      },
      {
        title: "Audit log si actiunea de business sunt acum atomic legate",
        content:
          "Operatiile de marcat alerta ca citita / necitita / inchisa scriau in DB intai randul actualizat si apoi audit log-ul (in tranzactii separate). Daca a doua scriere esua (de exemplu disc plin), audit-ul ramanea incomplet desi alerta era deja modificata. Acum ambele se fac in aceeasi tranzactie: ori se intampla amandoua, ori niciuna. Nu poti ramane cu o stare in care UI-ul arata o alerta inchisa fara o urma in audit log.",
      },
      {
        title: "Eveniment audit nou: monitoring.alert.emitted",
        content:
          "Pana acum, cand o monitorizare detecta o schimbare si genera o alerta noua, inserarea in DB nu lasa nicio urma in audit log. Acum, fiecare alerta proaspata (insert real, nu dedup hit) scrie un audit cu kind-ul, severitatea, jobId, runId si dedupKey. Pentru deploy-ul web cu mai multi utilizatori, asta inseamna ca poti reconstitui exact cand a fost vazuta o schimbare, fara sa te bazezi doar pe coloana created_at din tabelul de alerte.",
      },
      {
        title: "Backup la migratii include si fisierele WAL/SHM",
        content:
          "Cand se face backup automat inainte de o migratie de schema, copia includea pana acum doar fisierul .db principal. Daca aplicatia ruleaza in mod WAL (write-ahead log), tranzactii recente puteau fi in fisierele -wal si -shm care nu erau backupuite. Acum copia include si aceste sidecars (cand exista) — backup-ul e o oglinda completa a starii la momentul rularii.",
      },
      {
        title: "Monitorizare nume — succes partial cand cateva instante esueaza",
        content:
          "Cand monitorizarea unui nume e scopata pe mai multe instante (ex: tribunale specifice in loc de toate), pana acum un singur esec SOAP la una din instante facea sa esueze tot job-ul cu eroare. Acum, daca cel putin o instanta raspunde cu succes, job-ul continua cu rezultatele acelora; doar cand TOATE esueaza alerta de eroare e generata. Practic: un downtime izolat la un tribunal nu mai impiedica detectarea schimbarilor la altele.",
      },
      {
        title: "Boot fail-loud cand fisierul DB e corupt sau inaccesibil",
        content:
          "La pornirea aplicatiei, daca probe-ul read-only de detectie migratii pendinte arunca o eroare, pana acum se considera ca nu sunt migratii noi (fail-open) si se sarea backup-ul automat. Asta era exact scenariul cu cel mai mare risc: un DB corupt deschis fara backup prealabil. Acum, orice esec la probe e considerat ca exista migratii pendinte (fail-closed) — backup-ul se face oricum, chiar daca e potential inutil. Costul unui backup in plus e neglijabil; costul unui backup ratat la un DB corupt e ireversibil.",
      },
      {
        title: "Robustete crescuta la concurenta SQLite (busy_timeout)",
        content:
          "Toate conexiunile DB asteapta acum pana la 5 secunde cand intalnesc un alt scriitor (in loc sa esueze imediat cu SQLITE_BUSY). Pe desktop single-user impactul e teoretic; pentru deploy-ul web cu multiple workers / mai multe tab-uri / mai multe device-uri, garantia e ca operatiile scurte (mark seen, dismiss) nu mai pica sub locking aleator de la procesul de backup.",
      },
      {
        title: "Toast la esec marcare automata ca citita",
        content:
          "Cand apesi pe Dosare dintr-o alerta, marcarea ca citita ruleaza in fundal (fara sa intarzie navigarea — comportament v2.16.0). Daca request-ul esua silent, alerta ramanea in inboxul de necitite. Acum, in caz de esec, apare un toast in romana ('Marcarea alertei ca citita a esuat: ...') ca sa stii ca trebuie sa o marchezi manual. Navigarea ramane fire-and-forget — nu blochezi user-ul daca network-ul e lent.",
      },
      {
        title: "Detector automat pentru drift intre kind-uri backend si frontend",
        content:
          "Backend-ul si frontend-ul declara separat lista cu kind-urile de alerte (12 kind-uri valide). Daca cineva adauga un kind doar intr-o parte, ambele tsc trec (fiecare verifica pe propria definitie), dar la runtime kind-ul nou nu apare in dropdown sau nu primeste label. Un test backend nou citeste fisierul frontend ca text, extrage union-ul cu regex si compara seturile — daca apare un kind doar pe o parte, testul cade in CI inainte de release.",
      },
      {
        title: "Acoperire suplimentara pe regression tests",
        content:
          "+8 teste backend total (4 pentru drift detector kind-uri, 2 pentru audit row scris la insert real / nu la dedup hit, 2 pentru partial success multi-institutie in monitorizarea nume). Total: 819 teste backend (de la 811 in v2.16.1), 86 teste frontend.",
      },
    ],
  },
  {
    version: "v2.16.1",
    date: "5 Mai 2026",
    subtitle:
      "Sesiune de intarire interna dupa v2.16.0 care absoarbe integral observatiile facute de revizia automata a codului (un risc critic de validare, doua blocaje operationale si patru intariri defensive). Zero schimbari vizibile in interfata: aplicatia se comporta exact la fel pentru utilizator. Imbunatatirile sunt strict interne — un zid de aparare in plus impotriva regresiilor pe drumul catre lansarea variantei web.",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Validarea filtrelor de alerte unificata pe o singura sursa",
        content:
          "Lista cu tipurile de alerte recunoscute (12 kind-uri, 3 severitati, 3 tipuri de monitorizare) era duplicata in patru locuri diferite din cod — fiecare loc o avea hardcodata separat. La adaugarea kind-ului Termen nou dupa solutie in v2.15.0, trei dintre cele patru au fost actualizate manual; al patrulea ar fi blocat silent filtrul cand kind-ul nou ar fi ajuns intr-un body al unui request. Acum toate locurile importa o singura constanta partajata: adaugarea unui kind nou se face intr-un singur fisier si toate validatorele se actualizeaza automat la compilare.",
      },
      {
        title: "Inchide toate respecta acum o ordine deterministica",
        content:
          "Cand alegi sa inchizi toate alertele care match-uiesc filtrele active si numarul total depaseste 10.000 (cap intern de siguranta), aplicatia inchide acum cele mai recente 10.000 in primul rand (sortare descrescatoare dupa data crearii). Pana acum, in cazul rar in care depaseai cap-ul, alertele alese pentru inchidere erau intr-o ordine arbitrara dictata de stocarea interna SQLite — devenea greu de explicat ce 10.000 din 50.000 erau afectate. Comportamentul nou se aliniaza cu ordinea afisata in inboxul Alerte (cele mai noi sus).",
      },
      {
        title: "Backup automat inainte de orice rebuild de schema DB",
        content:
          "La pornirea aplicatiei, daca exista o noua migratie de structura DB care urmeaza sa ruleze (de exemplu rebuild de tabel pentru schimbarea unei reguli CHECK), se face acum automat un backup SQLite numit schema-upgrade inainte de a aplica migratia. Pana acum, aceasta protectie era explicita doar in handler-ul vechi al unei migratii din 2026-04, iar migratia adaugata in v2.15.0 (pentru kind-ul Termen nou dupa solutie) nu avea backup explicit. Daca o rulare partiala lasa DB-ul intr-o stare nedorita, ai acum mereu un .bak la dispozitie pentru recuperare manuala — fara sa fii nevoit sa-ti reamintesti sa-l faci tu inainte de update. Acoperirea include si DB-urile vechi (utilizatori care vin de pe versiuni v2.0.10 si anterioare): la primul boot post-upgrade, intregul lant de migrari ruleaza pe schema veche si scrie automat un backup la inceput.",
      },
      {
        title: "Robustete impotriva curselor concurente la marcarea Necitit",
        content:
          "Operatia de re-marcare a unei alerte ca necitita (introdusa in v2.16.0 ca toggle pe butonul Citit) ruleaza acum intr-o tranzactie atomica. Pe desktop (single-user) impactul e teoretic, dar pentru deploy-ul web viitor (mai multe tab-uri / mai multe device-uri pe acelasi cont) garantia e ca nu vezi vreodata o stare partiala unde alerta apare in lista deschise dar nu inca actualizata in inbox.",
      },
      {
        title: "Acoperire suplimentara pe regression tests",
        content:
          "Doua teste noi verifica explicit ca filtrul kind=termen_dupa_solutie e acceptat atat de listarea Alerte (GET) cat si de inchiderea in masa (POST dismiss-bulk). Daca cineva sterge accidental un kind din lista partajata, testele cad in CI inainte ca regresia sa ajunga in productie. Total: 811 teste backend (de la 809 in v2.16.0), 86 teste frontend.",
      },
    ],
  },
  {
    version: "v2.16.0",
    date: "5 Mai 2026",
    subtitle:
      'Patru ajustari de UX dupa primele alerte "Termen nou dupa solutie" vizualizate in fereastra Electron: eticheta KPI Monitorizare aliniata cu cea din Dashboard (Monitorizari active in loc de Joburi active), butonul Citita devine togglable (poti sa marchezi din nou ca necitita), butonul Dosare marcheaza implicit alerta ca citita (deschiderea dosarului = acknowledgement), data in titlul alertei amanare devine "04.05.2026" in loc de "2026-05-04T00:00:00", iar textul solutiei reapare in detail (era prezent doar pe vechea alerta separata).',
    icon: <Sparkles className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
    sections: [
      {
        title: "Alerte - butonul Citita acum e togglable",
        content:
          'In dreptul fiecarei alerte, butonul Citita afiseaza "Citit" cand alerta e necitita (icon ochi deschis). La click se marcheaza ca citita - acelasi comportament ca pana acum. Daca apesi din nou pe acelasi buton, eticheta se schimba in "Necitit" (icon ochi taiat) si alerta revine la starea de necitita. Folositor cand vrei sa o lasi vizibila in inboxul de necitite ca sa revii la ea mai tarziu.',
      },
      {
        title: "Alerte - butonul Dosare marcheaza implicit alerta ca citita",
        content:
          "Cand apesi pe butonul Dosare dintr-o alerta, deschiderea dosarului in lista Dosare se considera implicit acknowledgement: alerta se marcheaza automat ca citita in fundal (fara sa intarzie navigarea). Daca vrei sa o lasi necitita dupa ce ai vazut dosarul, foloseste toggle-ul Citit/Necitit dupa intoarcere.",
      },
      {
        title: "Alerte - Termen nou dupa solutie afiseaza acum data umanizata si textul solutiei",
        content:
          'Titlul alertei compuse "Termen nou dupa solutie" arata acum datele in format romanesc (04.05.2026 -> 19.05.2026) in loc de format ISO (2026-05-04T00:00:00 -> 2026-05-19). In detail apare explicit "Solutie pe <data>", "Termen nou <data>", "Complet" si "Solutie" (textul deciziei luate la termenul anterior), plus un callout cu numarul documentului, data pronuntarii si sumarul, daca PortalJust le returneaza. Inainte aceste date erau ascunse in JSON-ul alertei dar nu apareau in UI.',
      },
      {
        title: "Monitorizare - KPI redenumit Monitorizari active",
        content:
          'Cardul de header din pagina Monitorizare afisa "Joburi active (N)" desi pe pagina Dashboard acelasi numar e etichetat "Monitorizari active". Acum ambele locuri folosesc aceeasi denumire (Monitorizari active), ca sa fie clar ca este vorba de aceleasi monitorizari pe care le configurezi din formularul de Adauga monitorizare.',
      },
    ],
  },
  {
    version: "v2.15.0",
    date: "5 Mai 2026",
    subtitle:
      'Sweep peste v2.14.1 care rezolva o problema raportata pe inboxul Alerte: cand un dosar primea o solutie SI un termen nou pe acelasi complet (cazul tipic de amanare), inboxul afisa doua alerte separate ("Solutie publicata" + "Termen nou") care confundau cititorul. Acum cele doua se contopesc intr-o singura alerta noua "Termen nou dupa solutie" cu detail combinat (de la solutia publicata, la noul termen), pastrand toate informatiile originale.',
    icon: <Bell className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Alerte - kind nou Termen nou dupa solutie (amanare)",
        content:
          'Cand PortalJust publica o solutie pe un complet si in acelasi timp programeaza un termen nou pentru acelasi complet (cazul tipic de amanare), generam acum o singura alerta compusa cu severitate info: "Termen nou dupa solutie" cu detail "de la <solutia publicata, sumar, numar document, data pronuntare> la <data, ora, complet noul termen>". Inboxul devine mai usor de citit - un eveniment, o alerta. Filtrarea standard (severitate, search pe dosar, interval) functioneaza la fel. Re-tick-uri pe acelasi snapshot dupa merge nu produc alerte noi (idempotent prin dedup key stabil).',
      },
      {
        title: "Cum se decide merge-ul",
        content:
          'Pentru fiecare sedinta noua aparuta in fereastra de tick, scheduler-ul cauta in pending solutiile detectate la inceputul aceluiasi tick care imparta acelasi (stadiu procesual, complet). Daca exista una si singur una, cele doua se contopesc. Daca termenul nou matchuieste o sedinta veche disparuta (pure reschedule), are prioritate alerta clasica "Termen modificat". Daca settings-ul tau dezactiveaza emiterea unora dintre alerte (notify_on_solution sau notify_on_new_termen), restul rezultatelor revin la comportamentul standard - solutie singulara sau termen singular.',
      },
    ],
  },
  {
    version: "v2.14.1",
    date: "5 Mai 2026",
    subtitle:
      'Patch peste v2.14.0 care creste hard cap-ul intern al timeout-ului SOAP de la 45s la 60s. Driver: pattern-ul empiric observat pe job 1215 in productie (BANCA COMERCIALA ROMANA SA, ~1000 dosare in PortalJust): ~50% rata de esec, toate esecurile la fix 45000ms duration cu "operation was aborted due to timeout", in timp ce rularile reusite aterizau la 40-44s. PortalJust serializeaza payload-uri mari (sute de Dosar elements per nume) aproape de pragul de 45s; nu e PortalJust jos, e quirk de volum. 60s da 33% margine fara sa schimbe budget-ul scheduler-ului (10min/run ramane).',
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "SOAP timeout PortalJust - 45s -> 60s",
        content:
          "Constanta SOAP_TIMEOUT_MS din backend/src/soap.ts crescuta de la 45000 la 60000 (singurul hard cap intern aplicat pe fetch-urile SOAP catre portalquery.just.ro). Joburile name_soap care matcheaza nume cu sute de dosare (BCR, banci mari, autoritati publice) ar trebui sa nu mai timeoutuiasca aproape sistematic. Daca tot mai apar timeouts dupa 60s, pattern-ul e diferit (PortalJust degraded vs. payload mare) si trebuie investigat separat.",
      },
      {
        title: "Cum a fost diagnosticat (transparenta)",
        content:
          'Script ad-hoc scripts/diag-bcr.cjs a interogat DB-ul productie de la %APPDATA%/legal-dashboard/legal-dashboard.db pentru job 1215 si a dump-uit ultimele 10 runs. Snapshot: 2575/40s ok, 1956/44s ok, 1955/45s err, 1948/45s err, 1933/45s err, 1303/13s ok, 1285/45s err. Toate esecurile la fix 45000ms duration cu error_code: SOAP_FAIL si error_message: "operation was aborted due to timeout" - semnatura clara de timeout intern, nu de network failure.',
      },
    ],
  },
  {
    version: "v2.14.0",
    date: "5 Mai 2026",
    subtitle:
      'Release minor peste v2.13.1. Livreaza bulk dismiss pe pagina Alerte (Inchide selectia / Inchide toate, cap 10k) si rezolva root cause-ul toast-ului "Eroare necunoscuta" care aparea la rapid-click pe Inchide (rate-limit-ul intorcea body malformat care nu matchuia envelope-ul standard).',
    icon: <Bell className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Alerte - bulk dismiss (Inchide selectia / Inchide toate)",
        content:
          'Pagina Alerte are acum doua butoane noi in toolbar: "Inchide selectia" cand exista randuri bifate, sau "Inchide toate" cand nu e nimic selectat. "Inchide toate" inchide toate alertele care matchuiesc filtrele active (jobKind/q/kind/severity/onlyUnread/from/to), cu cap 10k randuri (peste, primesti eroare cu numarul total). Operatia este idempotenta - alertele deja inchise nu sunt afectate. Modal de confirmare cu numarul exact de alerte care vor fi inchise inainte sa apesi.',
      },
      {
        title: 'Fix "Eroare necunoscuta" la rapid-click Inchide',
        content:
          'Cand apasai rapid butonul Inchide pe alerte, toast-ul rosu spunea generic "Eroare necunoscuta" in loc de mesaj util. Cauza: rate-limit-ul (HTTP 429 "prea multe cereri intr-un interval scurt") intorcea pana la v2.13.1 un body malformat ("{ error: \'<string>\' }" in loc de envelope-ul standard "{ data, error: { code, message }, requestId }"), iar parser-ul de pe frontend nu reusea sa extraga mesajul si fall-back-uia la "Eroare necunoscuta". Acum primesti mesajul real: "Prea multe cereri. Incercati din nou in cateva momente."',
      },
    ],
  },
  {
    version: "v2.13.1",
    date: "5 Mai 2026",
    subtitle:
      'Patch peste v2.13.0 care strange capetele libere semnalate dupa lansarea export-ului de alerte: 4 kind-uri ascunse din dropdown-ul Alerte (sunt inerte in starea curenta a UI-ului), strip al sufixului /aN pentru link-urile portal.just.ro (SharePoint indexer-ul nu retine asociatii), hyperlink clickabil pe coloana "Numar Dosar" / "Tinta" in PDF-urile Dosare/Termene/Monitorizare, si Monitorizare export care pagineaza prin toate paginile cand nu exista selectie.',
    icon: <Sparkles className="h-5 w-5" />,
    borderColor: "border-l-cyan-500",
    badgeClass: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
    sections: [
      {
        title: "Alerte - 4 kind-uri ascunse din dropdown",
        content:
          'Dropdown-ul "Tip alerta" exclude acum 4 tipuri inerte in starea curenta a UI-ului: "Relevant acum" si "Nu mai este relevant" (cer alert_config.stadii sau .categorii setate per job, dar formularul de Monitorizare nu le expune, deci tranzitia nu se declanseaza), "Aviz modificat" (rezervat pentru runner-ul RNPM neimplementat), si "Dosar disparut" (gated de notify_on_dosar_disappeared cu default false fara toggle in UI). Alertele istorice cu aceste kind-uri isi pastreaza label-ul in badge - doar dropdown-ul de filtrare le ascunde.',
      },
      {
        title: "Link-uri portal.just.ro - strip /aN suffix",
        content:
          "Link-ul catre portal.just.ro din alerte/export/PDF strip-uieste sufixul /a, /a1, /a2... ca search-ul SharePoint sa returneze pagina parinte. SharePoint indexer-ul nu retine sufixele de dosar asociat, asa ca cautarea pe parintele 1234/5/2025 returneaza pagina care contine link-uri spre toate asociatii lui (utilizatorul gaseste de acolo dosarul cautat).",
      },
      {
        title: "PDF - hyperlinks pe coloana Numar Dosar / Tinta",
        content:
          "Exporturile PDF din Cautare Dosare, Termene si Monitorizare au acum link clickabil pe coloana Numar Dosar / Tinta (text albastru ca user-ul sa vada vizual ca celula e clickabila). Pattern-ul reia ce s-a livrat in v2.13.0 pentru export-ul de alerte: side-band Map<rowIndex, url> + didDrawCell care apeleaza doc.link la dimensiunea celulei. La Monitorizare, link-ul se aplica doar pentru job-urile dosar_soap si name_soap (aviz_rnpm necesita alta sursa).",
      },
      {
        title: "Monitorizare export - toate paginile cand nu e selectie",
        content:
          'Cand utilizatorul apasa Excel sau PDF fara nicio selectie pe pagina Monitorizare, exportul nu mai e limitat la randurile vizibile pe pagina curenta - pagineaza prin toate paginile (cu filtrele kind/q active aplicate) pana acopera totalul. Cand exista selectie, exportul ramane limitat la randurile bifate (ca inainte). Tooltip-urile s-au schimbat din "vizibile" in "toate cele N joburi (toate paginile)".',
      },
    ],
  },
  {
    version: "v2.13.0",
    date: "5 Mai 2026",
    subtitle:
      "Release minor peste v2.12.1. Livreaza cele doua capabilitati cerute pe pagina Alerte: (1) export Excel/PDF cu link direct catre dosarele identificate (selectie / filtre curente / interval, cap 10k randuri), si (2) raport zilnic pe email cu toate alertele din ziua precedenta. Migration nou (0015) adauga 2 coloane in owner_email_settings, fara breaking changes pe contractele existente.",
    icon: <FileSpreadsheet className="h-5 w-5" />,
    borderColor: "border-l-cyan-500",
    badgeClass: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
    sections: [
      {
        title: "Export alerte - Excel + PDF cu link portal.just.ro",
        content:
          "Pagina Alerte capata buton Exporta + modal cu radio Excel/PDF si radio Selectie / Filtre curente / Interval. Fiecare rand de raport contine numarul dosarului ca hyperlink live catre portal.just.ro/SitePages/cautare.aspx?k=... (slash-ul si diacriticele sunt encoded corect). PDF-ul respecta hyperlink-ul prin pdfmake. Filename: alerte_N_dd-mm-yyyy.xlsx / .pdf.",
      },
      {
        title: "Export - 3 moduri (selectie / filtre / interval) cap 10k",
        content:
          "POST /api/v1/alerts/export accepta mode: ids (selectia checkboxurilor, max 10k), filters (filtrele curente din UI - severitate, kind, jobKind, q, unread, includeDismissed, from/to), sau range (interval [from, to] ISO). Cand totalul depaseste 10k, ruta returneaza 413 cu details.total ca utilizatorul sa restraga filtrul. Selectia cross-owner returneaza doar randurile owner-ului curent (audit + WHERE owner_id = ?).",
      },
      {
        title: "Raport zilnic email (web only) - flag in Setari",
        content:
          'Setari -> Notificari email primeste checkbox nou "Trimite raport zilnic la 09:00" controlat de field nou dailyReportEnabled. Pe desktop, optiunea e vizibila dar fara efect (SMTP nu e configurabil); pe web, scheduler-ul ruleaza la fiecare 5 minute si fires email-ul la ora locala 09:00 (configurabila via DAILY_REPORT_HOUR env) pentru fiecare owner cu flag activ si address valida.',
      },
      {
        title: "Raport - fereastra ziua precedenta + dedup + retry",
        content:
          "Email-ul include doar alertele cu created_at in fereastra [yesterday 00:00 local, today 00:00 local). Subiect: [Legal Dashboard] Raport zilnic dd.mm.yyyy - N alerta/alerte. Body grupat pe severitate (critic -> warning -> info), cu link portal.just.ro per dosar si em-dash placeholder cand numarul dosarului lipseste. Dedup via last_daily_report_sent_for: o singura zi nu primeste raport dublu chiar daca scheduler-ul ruleaza de mai multe ori. Retry best-effort: pe failure, flag-ul NU se updateaza, deci ziua urmatoare se reincearca cu fereastra noua.",
      },
      {
        title: "Migration 0015 + audit trail",
        content:
          "0015_daily_report_settings.up.sql adauga in owner_email_settings: daily_report_enabled INTEGER NOT NULL DEFAULT 0 (independent de enabled - utilizatorul poate primi per-alert imediat dar NU raport zilnic, sau invers) + last_daily_report_sent_for TEXT NULL (formatul YYYY-MM-DD local). Audit emis: email.daily_report.sent (ok cu subject + rowCount) sau email.daily_report.failed (error cu reason si message daca a fost exceptie).",
      },
    ],
  },
  {
    version: "v2.12.1",
    date: "4 Mai 2026",
    subtitle:
      "Patch peste v2.12.0 care raspunde la trei probleme operationale ridicate pe import-ul bulk de monitorizare: limita statica de 300 randuri vizibile, mesaje de validare opace (warn / respins fara motiv clar), si alerta source_error generica cand un nume monitorizat depaseste limitele PortalJust. Niciun migration, niciun schema change, niciun contract HTTP/IPC modificat.",
    icon: <Sparkles className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Bulk import - preview integral cu paginare 100/pagina",
        content:
          "Limita statica de 300 randuri vizibile inlocuita cu paginare server-style identica cu pagina principala (default 100/pagina, optiuni 25 / 50 / 100 / 250). Toate randurile parse-uite raman in state si sunt accesibile la commit; vizibilitatea in tabel e doar paginata. Reset automat al paginii la schimbarea filtrului sau la cancel.",
      },
      {
        title: "Bulk import - control selectie rand cu rand",
        content:
          'Coloana noua "Actiune" cu buton Exclude/Include per rand (icoana X / Plus). Randurile excluse afiseaza strikethrough + badge "exclus" si NU contribuie la commit. Linga dropdown-ul de filtru, checkbox "Exclude warn-urile automat" scoate in masa toate randurile cu validation === "warn" (badge "auto-exclus"). Counter-ul de commit reflecta numarul efectiv de joburi care vor fi create dupa toate filtrele.',
      },
      {
        title: "Bulk import - legenda statusuri + nota dedup",
        content:
          "Legenda colapsabila explica explicit ce inseamna ok / warn / respins si clarifica deduplicarea automata: duplicat la import = NU se creeaza job duplicat (constraint UNIQUE owner_id + target_hash + kind). Contorul reflecta doar joburile unice care intra in DB.",
      },
      {
        title: "Validare nume - mesaje humanizate cu motiv si actiune",
        content:
          'classifyRawName din nameListParser rescris cu mesaje romanesti complete care explica motivul si actiunea recomandata. Exemple: "Nume lipsa - completeaza coloana \'nume\' sau cnp/cui pentru a putea cauta automat" (vs. cod tehnic vechi); "Duplicat - apare prima oara la randul X (NU se va crea job duplicat: deduplicare automata la import)".',
      },
      {
        title: "Warn nou - nume prea lung pentru PortalJust",
        content:
          'Regula noua nume_lung (warn) declansata cand numele normalizat depaseste 100 caractere SAU 12 cuvinte. Calibrata empiric pe limita PortalJust (~107 chars / ~13 cuvinte la nume multi-cuvant). Mesajul: "Nume lung pentru PortalJust - depaseste limita empirica si poate produce esecuri repetate. Considera scurtarea numelui sau cauta dupa CUI/CNP." Apare la preview inainte de commit, deci utilizatorul poate decide sa excluda randul sau sa scurteze.',
      },
      {
        title: "Alerta source_error contextualizata pentru nume lungi",
        content:
          'Cand un job name_soap esueaza repetat cu SOAP_FAIL pe un nume care depaseste limitele empirice PortalJust, alerta source_error (5 esecuri consecutive) primeste probable_cause: nume_prea_lung_pentru_portaljust si titlu specific "Nume prea lung pentru PortalJust". Detail-ul JSON include nameNormalized, length, wordCount. Utilizatorul vede direct in inbox ca PortalJust nu e jos, ci numele monitorizat trebuie scurtat.',
      },
    ],
  },
  {
    version: "v2.12.0",
    date: "4 Mai 2026",
    subtitle:
      "Release minor peste v2.11.0. Patru seam-uri MIN-VIABLE pentru a separa boundary-urile (HTTP / persistenta / fanout extern) fara sa introducem outbox tables sau DI containers, plus un fix de paginare la timeline-ul Dashboard cand cursorul cade pe boundary intre surse. Comportament observabil neschimbat, dar contract-ul intern al API-ului este mai usor de migrat catre web (per-source over-fetch + composite cursor).",
    icon: <Layers className="h-5 w-5" />,
    borderColor: "border-l-indigo-500",
    badgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
    sections: [
      {
        title: "AlertEventService - seam pentru fanout email + SSE",
        content:
          "Toate insert-urile de monitoring alerts merg acum prin services/alerts/alertEventService.ts. Service-ul scrie alerta in DB, apoi defera fanout-ul (email dispatcher + SSE broadcast) prin queueMicrotask asa ca SQLite write lock-ul nu se mai tine peste IO extern. La shutdown, drainEmailDispatches(2_000) blocheaza pana queue-ul SMTP e gol. Test boundary nou cu vi.mock pe ../email/mailer.ts.",
      },
      {
        title: "Command service - executeCreateMonitoringJob framework-free",
        content:
          "POST /api/v1/monitoring/jobs deleaga acum la services/monitoring/createMonitoringJobService.ts. Service-ul primeste input-ul deja parsat de Zod la boundary-ul HTTP plus un callback writeAudit, returneaza un union de outcomes (created / duplicate / invalid). Hono ramane doar la nivel de route; logica de business e decuplata si mock-abila.",
      },
      {
        title: "useMonitoringJobs - hook React cu abort + debounce",
        content:
          "Pagina Monitorizare delegeaza acum la hooks/useMonitoringJobs.ts pentru fetch-uri (cu AbortController pe unmount + flush sincron pe debounce search). Reduce footprint-ul componentei principale fara sa schimbe contract-ul UI.",
      },
      {
        title: "Module notifications - SSE + native notifications izolate",
        content:
          "Logica de notificari (subscriber set, broadcast, native Electron toast) extrasa intr-un modul dedicat. Pus in spatele unui port simplu ca sa permita un swap server-side push (SSE / WebSocket) cand mutam backend-ul pe web.",
      },
      {
        title: "Dashboard timeline - fix paginare composite cursor",
        content:
          "GET /api/v1/dashboard/activity/timeline pierdea un eveniment per pagina cand cursorul cadea exact pe ts-ul partajat intre surse (alerts/runs/audit). Cauza: per-source LIMIT nu compensa boundary-ul filtrat post-merge. Fix: fetchLimit = inclusive ? limit + 1 : limit. Compozite-ID-urile fiind unice, +1 e suficient sa pastram bugetul de slice.",
      },
      {
        title: "Tests - 744 backend (+16 noi) / 73 frontend",
        content:
          "+3 in services/alerts/alertEventService.test.ts (nou — fanout via queueMicrotask, mock SMTP, drain in afterEach). +13 distribuite intre routes/rnpm.owner-isolation.test.ts (nou, 11 owner-isolation pe rute RNPM care lucreaza pe DB partajata) si routes/dashboard.test.ts (compound cursor disambiguation absorbit din v2.11.0 deep-review). tsc backend + frontend clean, biome clean.",
      },
      {
        title: "Versionare + Docs",
        content:
          "Bump 2.11.0 → 2.12.0 in 3 manifests + package-lock.json. CHANGELOG.md, README.md, STATUS.md, SESSION-HANDOFF.md, CLAUDE.md, EXECUTION-ROADMAP.md actualizate.",
      },
    ],
  },
  {
    version: "v2.11.0",
    date: "4 Mai 2026",
    subtitle:
      "Release minor peste v2.10.8. Inchidem primul lot din review-ul extern: PII real (un dump RNPM cu CUI/denumire) scos din git, CVE HIGH nodemailer DoS si CVE moderate Anthropic SDK fix-uite, plus inchiderea bridge-ului web-readiness pentru RNPM (owner propagation, admin guard, AUTH_MODE=web gate). Pe desktop comportamentul ramane neschimbat.",
    icon: <Shield className="h-5 w-5" />,
    borderColor: "border-l-rose-500",
    badgeClass: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
    sections: [
      {
        title: "Securitate - dump RNPM scos din git + .gitignore",
        content:
          "Un dump RNPM real (CUI 39029401, denumire INSTANT FACTORING IFN, identificator J40/3635/2018) era trackuit in git la backend/rnpm-dumps/. L-am scos din index cu git rm --cached si am adaugat pattern-ul backend/rnpm-dumps/ in .gitignore ca sa nu se mai recommiteze. Fisierul ramane local pentru referinta; istoricul git inca il pastreaza, dar repository-ul este privat si blast-radius-ul ramane mic.",
      },
      {
        title: "Securitate - bump nodemailer + Anthropic SDK",
        content:
          "nodemailer ^6.9.13 → ^7.0.13 acopera CVE HIGH GHSA-rcmh-qjqh-p98v (DoS via addressparser recursiv) si CVE moderate GHSA-mm7p-fcc7-pg87 (interpretation conflict pe domenii). @anthropic-ai/sdk ^0.90.0 → ^0.92.0 inchide CVE moderate GHSA-p7fg-763f-g4gf (Insecure Default File Permissions in Local Filesystem Memory Tool — nu il folosim, dar aplicam fix-ul ca recomandat). xlsx@0.18.5 ramane risc acceptat: HIGH Prototype Pollution + ReDoS fara fix upstream, folosit doar in template-ul de bulk import.",
      },
      {
        title: "Backend - RNPM owner propagation end-to-end (closure #1)",
        content:
          "routes/rnpm.ts inlocuieste cele trei hardcodari ownerId='local' (inflight map pe /search + /bulk si argumentul executeBulkSearch) cu getOwnerId(c). executeSearch primeste acum ownerId explicit ca searchId si aviz-urile noi sa fie scrise sub owner-ul real. Pe desktop fallback ramane local; in web mode izoleaza tenants la nivel de cache si DB.",
      },
      {
        title: "Backend - admin guard pe rute globale RNPM (closure #2)",
        content:
          "requireRole('admin') montat pe DELETE /saved/all, POST /compact, GET /backups, DELETE /backups, POST /backups/restore, POST /open-db-folder, POST /open-backups-folder. Pe desktop user-ul local e admin via 0006_admin_roles bootstrap, deci comportament neschimbat. In web mode, wipe global / compact / backup ops sunt accesibile doar admin-ilor.",
      },
      {
        title: "Backend - AUTH_MODE=web gate pe captchaKey body (closure #12)",
        content:
          "Helper-ul rejectCaptchaKeyInWebMode(c) returneaza 501 cu mesaj romanesc pe POST /search, /bulk, /captcha/balance cand AUTH_MODE=web. Browserul nu trebuie sa puna cheia in body (localStorage / DevTools fetch); per-user server-side key storage ramane TBD pentru un release viitor.",
      },
      {
        title: "Tests - 728 backend (+7 noi) / 73 frontend",
        content:
          "Adaugate in routes/rnpm.contract.test.ts: 3 teste pentru gate-ul AUTH_MODE=web (501 pe /search, /bulk, /captcha/balance) + 4 teste pentru admin guard defense-in-depth (403 pe /saved/all, /compact, GET/DELETE /backups dupa demote-ul user-ului local la role=user). Test setup promoveaza user-ul local la admin via updateUserRole pentru rutele admin-gated.",
      },
      {
        title: "Build script + Docs",
        content:
          "scripts/build-server.js: ZIP output rebrand portaljust-server-${version}.zip → legal-dashboard-server-${version}.zip; titlul console + README.txt aliniate la branding. CHANGELOG.md, STATUS.md, README.md, SESSION-HANDOFF.md, EXECUTION-ROADMAP.md, CLAUDE.md actualizate. Versionare bump la 2.11.0 in toate cele 3 manifests + package-lock.json.",
      },
    ],
  },
  {
    version: "v2.10.8",
    date: "4 Mai 2026",
    subtitle:
      "Patch CI-only peste v2.10.7. Workflow-urile de packaging (Windows + macOS) ruleaza acum type-check + teste inainte sa construiasca binarele, iar artifact name-urile includ ref + run_id ca sa nu existe overwrite-uri intre run-uri concurente.",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "CI - test gate inainte de packaging",
        content:
          "Workflow-urile build-windows.yml si build-mac.yml ruleaza acum, intre npm ci si packaging, 4 step-uri noi: Backend type-check (tsc --noEmit -p backend/tsconfig.json), Backend tests (npm test --workspace=backend -- --run), Frontend type-check (cd frontend && tsc --noEmit), Frontend tests (cd frontend && npm test -- --run). Ordinea este importanta: gate-ul ruleaza cat timp better-sqlite3 are prebuild-ul Node, inainte ca rebuild:electron (Windows) sau electron-builder npmRebuild (Mac) sa flipeze ABI-ul pe Electron.",
      },
      {
        title: "CI - artifact naming cu ref + run_id",
        content:
          "Numele fixe legal-dashboard-windows si legal-dashboard-mac inlocuite cu pattern legal-dashboard-{platform}-${ref}-run${run_id}. Pentru tag pushes (v2.10.8) numele devine de exemplu legal-dashboard-windows-v2.10.8-run<id>; pentru workflow_dispatch include numele branch-ului. Eviti overwrite-uri silentioase intre run-uri concurente sau re-run-uri in aceeasi fereastra de retentie de 14 zile.",
      },
      {
        title: "Documentatie",
        content:
          "Toate sectiunile Defer separat / De facut pe viitor / Backlog tehnic minor referitoare la workflow-urile de packaging au fost scoase din SESSION-HANDOFF.md, EXECUTION-ROADMAP.md, README.md, STATUS.md si CLAUDE.md. CHANGELOG.md primeste entry-ul v2.10.8.",
      },
    ],
  },
  {
    version: "v2.10.7",
    date: "3 Mai 2026",
    subtitle:
      "Patch UX Monitorizare: titlul tabelului Joburi active afiseaza totalul real de joburi active, nu doar randurile incarcate pe pagina curenta.",
    icon: <FileSpreadsheet className="h-5 w-5" />,
    borderColor: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    sections: [
      {
        title: "Monitorizare - total real in header",
        content:
          "CardHeader-ul din Monitorizare foloseste acum totalul paginat returnat de backend pentru Joburi active (de exemplu 616), nu jobs.length (100 cand pagina curenta are pageSize 100). Textul Selectia opereaza doar pe pagina vizibila ramane sursa clara pentru cate randuri sunt incarcate/selectabile pe pagina.",
      },
      {
        title: "Export - clarificare pagina vizibila",
        content:
          "Tooltip-urile Excel/PDF spun explicit ca exportul fara selectie acopera toate joburile vizibile, nu intregul total paginat. Comportamentul ramane neschimbat; fix-ul este de claritate UI.",
      },
      {
        title: "Documentatie - backlog inchis",
        content:
          "CODEX-BACKLOG.md ramane document istoric: Task B/C sunt livrate in v2.10.5, Task A este eliminat din scope din v2.10.6, iar findings-urile de workflow metadata raman deferate pentru o sesiune separata. v2.10.7 nu schimba workflow-urile finale.",
      },
    ],
  },
  {
    version: "v2.10.6",
    date: "3 Mai 2026",
    subtitle:
      "Patch hardening peste v2.10.5, fara comportament nou. Absoarbe integral findings-urile review-ului (frontend hooks + accesibilitate tastatura WAI-ARIA, backend defense-in-depth pe LIKE in admin paths). Sterge un script tactic vechi si scoate Task A din backlog.",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
    sections: [
      {
        title: "Frontend - useDebouncedValue cu callback flush",
        content:
          "Hook-ul useDebouncedValue rescris cu tuple [value, flush]. Callback-ul flush(next) permite resetarea sincrona la apasari de buton (clear-X / Reset filter), asa ca debounced state-ul nu mai fluture printr-un val intermediar inainte sa ajunga la zero. Folosit in Alerts.tsx si Monitorizare.tsx.",
      },
      {
        title: "Frontend - JobKindTabs cu navigatie tastatura WAI-ARIA",
        content:
          "Tab-bar-ul Toate / Dosare / Nume primeste navigatie completa: ArrowLeft / ArrowRight cu wrap, Home / End jump la primul / ultimul tab, roving tabindex (tabIndex={active ? 0 : -1}) ca doar tab-ul activ sa fie focusabil prin Tab. Tipul handler-ului corectat la KeyboardEvent<HTMLButtonElement>.",
      },
      {
        title: "Backend - escapeLikeMeta + ESCAPE in admin paths",
        content:
          "Helper escapeLikeMeta(s) extras in util/textNormalize.ts ca utilitate reutilizabila pentru orice path care trece input user prin LIKE ? ESCAPE '\\\\'. JSDoc @example documenteaza explicit contractul (omiterea ESCAPE lasa \\ literal si re-enable-uieste % / _ ca wildcards). auditRepository.listAuditEvents si userRepository.listUsers folosesc acum escapeLikeMeta + ESCAPE — defense-in-depth pe admin paths.",
      },
      {
        title: "Cleanup",
        content:
          "Script-ul scripts/seed-test-alerts.cjs sters (era o utilitate tactica fara scop continuu). Task A din CODEX-BACKLOG.md (editare job monitorizare) scos integral din backlog si din memoria persistenta.",
      },
      {
        title: "Tests",
        content:
          "Backend: nou util/textNormalize.test.ts (11 teste pentru stripDiacritics, buildRnpmLikePattern cu wildcards %, _, \\, stripDiacriticsDeep) + 3 wildcard tests in repository-isolation.test.ts pentru getAvize. 721/721 backend (de la 703, +18). Frontend: noi useDebouncedValue.test.ts, JobKindTabs.test.tsx, alertsApi.test.ts. 73/73 frontend.",
      },
    ],
  },
  {
    version: "v2.10.5",
    date: "3 Mai 2026",
    subtitle:
      "Patch UX Dashboard + Alerte: KPI-ul de monitorizari este umanizat, iar pagina Alerte primeste tab-bar Toate / Dosare / Nume plus cautare dupa targetul jobului. Filtrele vechi raman neschimbate si se combina cu cele noi.",
    icon: <Bell className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Dashboard - KPI Monitorizari active",
        content:
          "Cardul vechi Joburi active devine Monitorizari active, iar sublinia tehnica X dosar_soap, Y name_soap devine X Dosare, Y Nume. Schimbarea este strict de label, fara impact pe contractul /api/v1/dashboard/summary.",
      },
      {
        title: "Alerte - tab-bar sursa job + search",
        content:
          "Pagina Alerte primeste tab-bar Toate / Dosare / Nume si input de cautare cu debounce 300ms. Search-ul cauta in targetul jobului: numar_dosar pentru dosar_soap si name_normalized pentru name_soap. Select-ul existent pe tipul evenimentului, severitatea, Necitite/Inchise si intervalul de date raman neschimbate.",
      },
      {
        title: "Backend - GET /api/v1/alerts?jobKind=...&q=...",
        content:
          "AlertListQuerySchema accepta jobKind si q. listAlerts filtreaza pe monitoring_jobs prin LEFT JOIN, foloseste rnpm_norm() pentru match case-insensitive si fara diacritice, escape-uieste meta-caracterele LIKE si include acelasi JOIN in COUNT ca totalul paginat sa fie corect.",
      },
      {
        title: "Tests",
        content:
          "5 teste noi in alerts.test.ts: jobKind, q pe numar_dosar, q pe name_normalized cu/fara diacritice, wildcard % literal si q + jobKind AND-ed corect. 703 teste backend asteptate.",
      },
    ],
  },
  {
    version: "v2.10.4",
    date: "3 Mai 2026",
    subtitle:
      "Patch UX Monitorizare — filtre kind (Toate / Dosare / Nume) + search box pe lista de monitorizari. Cautarea e diacritic-insensitive si case-insensitive (la fel ca in Cautare Dosare): query cu diacritice matcheaza valori fara diacritice si invers. Modulele Cautare Dosare si Termene & Calendar raman intacte.",
    icon: <Sparkles className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Frontend - tab-bar Toate / Dosare / Nume + search input",
        content:
          'Pagina Monitorizare primeste deasupra tabelului un tab-bar de 3 butoane (Toate / Dosare / Nume) si un input de cautare cu icon X pentru clear. Filtrul de tip ascunde cealalta categorie (de ex. Dosare ascunde toate jobs name_soap), iar input-ul filtreaza dupa numar dosar sau dupa nume. Counter discret "{total} rezultate" afisat doar cand exista filtre active. Empty state contextualizat: cand filtrele aplicate nu au rezultat, se afiseaza un mesaj cu link "Reseteaza filtrele" in loc de mesajul vechi de "niciun job activ".',
      },
      {
        title: "Frontend - debounce 300ms + reset paginatie pe schimbare filtru",
        content:
          "Search input-ul foloseste un debouncedQuery cu delay 300ms ca sa evite request spam la fiecare keystroke. Schimbarea kindFilter sau a debouncedQuery reseteaza automat pagina la 0, altfel utilizatorul aplica un filtru pe pagina 7 si vede gol pana la recovery-ul de retro-decrementare.",
      },
      {
        title: "Backend - GET /api/v1/monitoring/jobs?q=...",
        content:
          'JobListQuerySchema capata field q (trim + max 100 chars). listJobs adauga WHERE OR pe trei json_extract-uri: target_json.numar_dosar (dosar_soap), name_normalized (name_soap), identificator (placeholder aviz_rnpm). Match-ul foloseste rnpm_norm() pe coloane (strip diacritice + lowercase) si LIKE %...% cu meta-caractere %, _, \\ escapate cu \\ ESCAPE — input "50%" nu degenereaza in wildcard SQL. Comportamentul reproduce semantica Cautare Dosare: query cu diacritice matcheaza valori fara diacritice si invers.',
      },
      {
        title: "Backend - fail-closed pe target = doar sufix legal",
        content:
          'dosarMatchesAllNameTokens(targetCore=[]) returneaza acum false (fail-closed) in loc de true: un target compus exclusiv din sufixe legale ("SRL", "S.R.L.", "SRL LLC") nu mai trece tot ce returneaza PortalJust ca pseudo-pozitiv. Cazul e marginal (input-ul UPPERCASE + min 2 chars il blocheaza la /commit), dar pasul ramane defense-in-depth.',
      },
      {
        title: "Tests",
        content:
          "3 teste noi de schema (q trim, gol post-trim respins, > 100 chars respins) + 4 teste de integrare (q matches numar_dosar, q cu diacritice matches valoare fara diacritice in DB, q + kind AND-ed corect, wildcard % escapat la match literal) + 1 test runner pe fail-closed sufix legal. 698 teste backend (zero regresii).",
      },
    ],
  },
  {
    version: "v2.10.3",
    date: "3 Mai 2026",
    subtitle:
      "Patch UX Monitorizare + filtru strict word match name_soap. Paginare server-side pe pagina Monitorizare (10/25/50/100 joburi/pagina) inlocuieste limita statica de 100; buton Anuleaza pe import bulk; uniformizare UPPERCASE pe toate caile de input (XLSX, CSV, manual). Backend: nameSoapRunner filtreaza false-pozitivele PortalJust cerand TOATE cuvintele numelui in aceeasi parte; suffix-urile legale (SRL/SA/etc.) sunt ignorate la match indiferent de forma (S.R.L. ≡ SRL).",
    icon: <Sparkles className="h-5 w-5" />,
    borderColor: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    sections: [
      {
        title: "Frontend - paginare server-side pe Monitorizare",
        content:
          'Pagina Monitorizare afisa pana acum maxim 100 joburi cu un banner static "Sunt cel putin 100 joburi vizibile (din 617 total)". Acum tabelul are paginare standard cu state page/pageSize, TablePagination randat sub tabel, optiuni 10/25/50/100/pagina (cap-ul 100 matches limita backend JobListQuerySchema). Recovery automat la pagina goala dupa delete (decrement page daca jobs.length=0 si total>0 si page>0).',
      },
      {
        title: "Frontend - buton Anuleaza pe import bulk",
        content:
          "MonitoringBulkImportCard primeste un buton Anuleaza (cu icon X, variant outline) langa Confirma import. Click reseteaza preview/dosar rows/error/title/filter + goleste fileInput, fara confirmare suplimentara — flow-ul e non-destructive (preview-ul nu inseamna inca commit in DB).",
      },
      {
        title: "Frontend + backend - normalizare UPPERCASE pe import",
        content:
          'Numele de monitorizare se stocheaza acum UNIFORM in UPPERCASE indiferent de calea de input. PortalJust SOAP CautareDosare e case-insensitive pe numeParte, deci match-ul nu se schimba; uniformitatea elimina vizual amestecul "AMBKEVEN SRL" + "global learning logistics srl" din tabel. nameListParser.normalizeName (backend) face .toUpperCase() — defense-in-depth pe orice path care intra prin validare. monitoringBulkTemplate.ts (parser XLSX/CSV) si MonitoringAddForm.tsx (form manual) uppercaseaza la sursa. Datele vechi raman lowercase (fara migratie destructiva); randurile noi importate sunt UPPERCASE.',
      },
      {
        title: "Backend - filtru strict word match name_soap",
        content:
          'PortalJust SOAP CautareDosare returneaza dosare pe match substring pe oricare dintre cuvintele din numeParte ("GLOBAL LEARNING LOGISTICS" prinde si "GLOBAL LOGISTICS SA"). nameSoapRunner aplica acum un filtru post-fetch: un dosar e pastrat doar daca exista o parte (dosar.parti[i].nume) ai carei tokeni contin TOATE tokenii numelui monitorizat. Match-ul e strict pe egalitate de tokeni (nu substring), case-insensitive, fara diacritice. Caracterul & e promovat ca token de sine statator: "ABC&XYZ" si "ABC & XYZ" se echivaleaza la nivel de token.',
      },
      {
        title: "Backend - exceptie suffix legal",
        content:
          'Suffix-urile legale (SRL, SA, SCA, SNC, SCS, PFA, IF pentru RO + LLC, LTD, INC pentru entitati intl) sunt eliminate de la coada listei de tokeni inainte de comparare, indiferent de forma (SRL, S.R.L., S.R.L, SRL.). Target "GLOBAL LEARNING LOGISTICS" matcheaza parte "GLOBAL LEARNING LOGISTICS SRL"; target "X SRL" matcheaza parte "X"; variatiile S.R.L. vs SRL nu mai produc false-negative.',
      },
      {
        title: "Tests",
        content:
          "7 teste noi in nameSoapRunner.test.ts (tokenize &, strip diacritice, all-words required, multi-party match, parti goale → false, runner-level filter, & literal). 3 teste actualizate in nameListParser.test.ts pe output UPPERCASE. 690 teste backend total (zero regresii).",
      },
    ],
  },
  {
    version: "v2.10.2",
    date: "3 Mai 2026",
    subtitle:
      "Patch UX peste v2.10.1 (frontend-only, zero backend): coloana Detalii din tabelul Monitorizare se afiseaza doar cand cel putin un job are continut de aratat; panourile Analiza AI din Cautare Dosare sunt inlocuite cu un banner discret cand nicio cheie API (Anthropic / OpenAI / Google) nu este configurata, iar la salvarea primei chei panourile reapar automat.",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-purple-500",
    badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    sections: [
      {
        title: "Frontend - tabel Monitorizare adaptiv",
        content:
          "Helper-ul showDetailsColumn calculat o singura data per render verifica daca exista cel putin un job name_soap cu scope restrans (getNameSoapInstitutie(job).length > 0). Header-ul DETALII si celula corespunzatoare se randeaza condiional, deci utilizatorii care monitorizeaza doar dosare (cazul tipic desktop) nu mai vad o coloana goala.",
      },
      {
        title: "Frontend - panourile AI inlocuite cu banner pana la prima cheie",
        content:
          'DosareAiAnalysisPanel verifica ai.hasAnyKey la nivel de top: cand niciuna dintre cheile Anthropic / OpenAI / Google nu este configurata, in locul celor doua panouri colapsate (Analiza AI + Analiza AI Avansata) randeaza un banner discret cu border dashed, icon Bot si textul "Analize AI (single + multi-agent) disponibile dupa configurarea unei chei API in Setari API". Astfel, utilizatorii noi afla ca exista feature-ul si stiu unde sa configureze cheia, fara sa vada doua butoane colapsate inutile. Cand prima cheie este salvata, panourile reapar automat.',
      },
      {
        title: "Backend",
        content: "Zero modificari backend. Patch frontend-only, zero schema, zero migration.",
      },
    ],
  },
  {
    version: "v2.10.1",
    date: "3 Mai 2026",
    subtitle:
      "PR-11 review hardening: 14 fixuri tehnice peste v2.10.0 (SMTP timeouts, queue concurency cap, drain la shutdown, audit pe send_failed, cooldown pe /test, focus trap pe modal Detalii). Filtrul de severitate ramane neaplicat — design intentionat pentru v2.10.x.",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Backend - SMTP reliability",
        content:
          "Mailer-ul cache-uieste promise-ul transport-ului (nu transport-ul rezolvat), deci doua dispatch-uri concurente nu mai construiesc doua connection pool-uri. Timeout-uri SMTP explicite (10s connect, 5s greeting, 15s socket) ca un relay hung sa nu pin-uiasca dispatch-ul. SMTP_PORT in afara intervalului 1..65535 sau NaN forteaza mailer-ul off cu log clar.",
      },
      {
        title: "Backend - dispatcher cu queue + drain",
        content:
          "Dispatcher-ul ruleaza acum pe queue FIFO cu MAX_CONCURRENT=1: un burst de alerte nu mai spawn-uieste multe sendMail() in paralel pe acelasi SMTP relay (Gmail = 100/zi, O365 = 30/min). Short-circuit pe isMailerConfigured() inainte de SELECT pe owner_email_settings. Audit email.dispatch.failed pe send_failed sau exceptii — outage-ul SMTP silent devine vizibil pe trail. Graceful shutdown apeleaza drainEmailDispatches(5s) inainte sa inchida DB-ul.",
      },
      {
        title: "Backend - rute /email-settings",
        content:
          "PUT /email-settings face minSeverity optional in body si pastreaza valoarea stocata cand field-ul lipseste (era silent overwrite cu default). POST /email-settings/test are cooldown 60s/owner cu 429 + Retry-After si audit outcome=denied reason=cooldown — relay-ul SMTP nu mai poate fi spammed dintr-un click loop pe butonul Trimite test.",
      },
      {
        title: "Frontend - a11y modal Detalii instante",
        content:
          "Modal-ul Detalii (introdus in v2.10.0) capteaza acum focus-ul pe butonul de inchidere la deschidere si restaureaza focus-ul precedent la inchidere. ESC inchide modal-ul; pe butoanele de inchidere apare focus-visible:ring pentru navigatia tastatura.",
      },
      {
        title: "CI",
        content:
          "Workflow-ul Docker Build ruleaza acum tsc --noEmit pe backend si vitest pe backend inainte de docker build. Local nu se pot rula testele backend cand Electron a recompilat better-sqlite3 pentru ABI-ul lui — CI-ul cu Node 22 prebuild ABI-correct inchide gap-ul.",
      },
      {
        title: "Tests",
        content:
          "4 teste noi in alertEmailDispatcher.test.ts: short-circuit cand mailer-ul nu e configurat, audit pe send_failed, drainEmailDispatches resolva dupa settle, pendingDispatchCountForTests semnaleaza inflight.",
      },
    ],
  },
  {
    version: "v2.10.0",
    date: "3 Mai 2026",
    subtitle:
      "PR-11 Email notifiers: alertele de monitorizare pot fi trimise si prin SMTP, pe langa inbox-ul /alerte, badge-ul rosu, SSE si notificarile native. Canalul email este optional, default OFF si izolat de insert-ul alertei.",
    icon: <Mail className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
    sections: [
      {
        title: "Backend - setari email owner-scoped",
        content:
          "Migration 0014_email_settings adauga tabela owner_email_settings cu enabled, to_address si min_severity. min_severity ramane metadata compatibila cu schema alertelor, dar email-ul nu filtreaza dupa severitate. Repository-ul nou ownerEmailSettingsRepository pastreaza izolarea pe owner, normalizeaza adresa si lasa default-ul OFF.",
      },
      {
        title: "Backend - mailer SMTP provider-agnostic",
        content:
          "services/email/mailer.ts foloseste nodemailer si citeste doar SMTP_* din env. Daca SMTP lipseste, aplicatia porneste normal si mailer-ul ramane disabled. HTML-ul emailului escape-uieste payload-ul alertei, iar text body ramane fallback plain.",
      },
      {
        title: "Backend - hook izolat pe alerta noua",
        content:
          "insertAlert trimite email doar cand randul este nou, prin queueMicrotask separat de SSE. Dispatcher-ul verifica enabled si destinatarul; orice eroare SMTP este logata si nu sparge insert-ul, inbox-ul sau broadcast-ul live.",
      },
      {
        title: "Frontend - panou Notificari email",
        content:
          "Dialogul de configurare include acum EmailSettingsPanel: checkbox activare, adresa email, status SMTP, buton Salveaza si buton Trimite test. Cand este activ, canalul email trimite toate alertele noi de monitorizare. Testul este disponibil doar cand SMTP este configurat si exista destinatar salvat.",
      },
      {
        title: "Frontend - polish Monitorizare (coloana Detalii + modal instante)",
        content:
          "Coloana Tip a fost inlocuita cu coloana Detalii care afiseaza un buton circular Info doar pentru joburile name_soap cu scope restrans la o lista de instante. Click pe pictograma deschide un modal cu lista instantelor monitorizate (label uman din catalog, iconita Building2 per item, inchidere prin click in afara, ESC sau X). Numele lung pentru name_soap face acum break-words si se aliniaza cu butonul Dosare la dreapta, deci layout-ul nu se mai rupe nici cand sidebar-ul este collapsed. Exportul Monitorizare (Excel + PDF) suffix-eaza tinta name_soap cu lista instantelor sau cu Toate instantele cand scope-ul este universal.",
      },
      {
        title: "Electron - taskbar Windows: AUMID dev separat de packaged",
        content:
          "Dev si packaged folosesc acum AUMID-uri distincte (ro.legaldashboard.dev vs ro.legaldashboard.app), ca instalatorul NSIS si sesiunile electron:dev sa nu mai imparta scurtatura sau icon-ul. Shortcut-ul de dev este rescris cand exista deja, iar mainWindow.setIcon este apelat explicit dupa creare ca Windows sa lege fereastra de icon-ul corect. Helper nou launch-electron-dev.cjs cloneaza electron.exe in Legal Dashboard Dev.exe si patch-uieste metadata cu rcedit (icon + ProductName + FileDescription) inainte de launch.",
      },
      {
        title: "Tests",
        content:
          "Adaugate 34 teste backend pentru owner settings, mailer, dispatcher si rutele /me/email-settings, plus 5 teste frontend pentru helperii panoului email.",
      },
    ],
  },
  {
    version: "v2.9.2",
    date: "3 Mai 2026",
    subtitle:
      "Patch notificari native: alertele de monitorizare pastreaza inbox-ul si badge-ul din aplicatie, dar canalul Windows/macOS are acum status citibil, buton de test si gating defensiv cand sistemul de operare blocheaza toast-urile.",
    icon: <Bell className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Electron - status nativ Windows/macOS",
        content:
          "electron/main.js expune IPC nou notification:getStatus care intoarce platform, supported, state, canNotify si reason. Pe Windows foloseste optional windows-notification-state, iar pe macOS optional macos-notification-state. Daca modulul nativ lipseste sau OS-ul nu poate fi interogat, statusul devine unknown si alertele interne raman functionale.",
      },
      {
        title: "Electron - notificare test + gating defensiv",
        content:
          "notification:test trimite o notificare manuala de verificare. notification:show verifica statusul OS inainte de afisare si suprima toast-ul cand Windows/macOS raporteaza explicit ca notificarile sunt blocate. Dedup-ul pe tag si limitele title/body/tag raman pastrate.",
      },
      {
        title: "Frontend - panou Notificari sistem",
        content:
          "Dialogul de configurare chei API include acum un panou Notificari sistem cu status, refresh si buton Test. Mesajul clarifica faptul ca alertele raman in aplicatie chiar daca sistemul nativ nu poate afisa toast-ul.",
      },
      {
        title: "Frontend - useAlertsStream hardening",
        content:
          "Hook-ul care consuma /api/v1/alerts/stream construieste payload-ul notificarii prin helper testabil, cache-uieste statusul nativ 60s si pastreaza fallback-ul Web Notification API pentru modul browser. Alertele read/dismissed nu declanseaza notificari native, iar alert_enriched ramane fara toast.",
      },
      {
        title: "Tests",
        content:
          "Adaugat useAlertsStream.test.ts pentru payload, trunchiere body si gating pe status OS. Validari: test frontend nou, backend type-check si frontend type-check curate.",
      },
    ],
  },
  {
    version: "v2.9.1",
    date: "2 Mai 2026",
    subtitle:
      "Patch UX post-feedback: eliminata sectiunea 'Activitate recenta' (timeline-ul cu 'Run ok / dosar_soap', durate in secunde si event-uri de audit) din pagina Dashboard. Continutul era prea tehnic pentru utilizatori non-tehnici si redundant cu pagina dedicata /alerte (care are filtre, paginatie completa si context dosar enrichment). Charts-urile zilnice raman vizibile, KPI strip-ul afiseaza in continuare numarul de alerte necitite cu badge in sidebar.",
    icon: <Sparkles className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Frontend - Timeline eliminat din pagina Dashboard",
        content:
          "Componenta Timeline (introdusa in PR-B v2.8.0) randa o lista descrescatoare cu evenimente din 3 surse: alerte, rulari de monitorizare si intrari de audit. Liniile dominate de 'Run ok (dosar_soap) - 2.6s - 0 alerte noi - 2h in urma' nu aduceau valoare pentru utilizatorii care nu citesc log-uri de runner; alertele propriu-zise erau diluate in feed-ul tehnic. Importul si render-ul lui <Timeline /> au fost scoase din pages/Dashboard.tsx; fisierul componentei ramane in arbore (poate fi reactivat ulterior pentru un panou administrativ separat). Pagina Dashboard ramane cu KpiStrip, QuickActions, LastDosareCard, LastRnpmCard, Charts, Informatii API + Versiune.",
      },
      {
        title: "Backend - endpoint /api/v1/dashboard/timeline pastrat (necitit)",
        content:
          "Endpoint-ul ramane montat ca sa nu sparga clientii externi (ex. test app, integrari viitoare). Niciun apel din UI nu il mai foloseste dupa scoaterea componentei. Cand un panou administrativ va avea nevoie de feed-ul detaliat, componenta + endpoint-ul sunt deja gata si testate.",
      },
      {
        title: "De ce s-a luat decizia",
        content:
          "Audienta principala a aplicatiei sunt avocati si paralegali, nu operatori de sistem. Pagina Dashboard trebuie sa raspunda la 'ce trebuie sa fac astazi' (alerte unseen, dosare cu termen apropiat, KPI-uri), nu 'cum a mers ultima rulare a scheduler-ului'. Detaliile operationale raman disponibile pentru audit prin pagina /admin/audit (rezervata role-ului admin) si prin pagina /alerte unde alertele sunt enrichuite cu context dosar (numar dosar, instanta, complet, solutie).",
      },
      {
        title: "Tests - 645/645 verzi",
        content:
          "Niciun test backend modificat (timeline endpoint-ul ramane functional + acoperit). Frontend type-check curat dupa scoaterea importului. Re-build complet frontend + electron rebuild pentru ABI better-sqlite3.",
      },
    ],
  },
  {
    version: "v2.9.0",
    date: "2 Mai 2026",
    subtitle:
      "PR-C din sprintul de Dashboard redesign (3 din 3, ULTIMUL): activeaza Quick Action 'Export raport' care era disabled din PR-A v2.7.0. Modal cu picker range (7d/30d) + format (XLSX/PDF) genereaza raport agregat printr-un endpoint nou /api/v1/dashboard/report (snapshot atomic owner-scoped + withMaintenanceRead) si construieste fisierul off-main-thread in Web Worker (3 sheets XLSX: Sumar / Activitate zilnica / Cronologie; PDF landscape A4 cu aceleasi 3 sectiuni). Sprint Dashboard redesign incheiat.",
    icon: <FileSpreadsheet className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Backend - GET /api/v1/dashboard/report cu range 7d|30d",
        content:
          "Endpoint nou owner-scoped (via getOwnerId) wrapped in withMaintenanceRead, snapshot atomic ca sa coexiste cu backup/restore. Validare range: 400 invalid_range daca lipseste sau nu e 7d/30d. Returneaza payload {range, since, until, summary, charts, timeline, generatedAt}. summary reuseste blocurile readJobsBlock/readAlertsBlock/readRunsBlock/readAiBlock din PR-A v2.7.0. charts reuseste agregarile zilnice din PR-B v2.8.0 (UTC-day grid via utcDayStart). timeline merge-uieste 3 surse pe fereastra [since, until] cu cap REPORT_TIMELINE_LIMIT=500 per sursa; truncated=true daca oricare sursa atinge cap-ul.",
      },
      {
        title: "Backend - dashboardActivityRepository extins cu 3 helperi InRange",
        content:
          "Helperi noi listAlertsInRange / listFinalizedRunsInRange / listCuratedAuditInRange in backend/src/db/dashboardActivityRepository.ts. Window inchis (ts >= since AND ts <= until), ordonate (ts, id) DESC, cap parametric prin limit. Reuseste CURATED_AUDIT_ACTIONS allowlist + outcome != 'ok' catch-all definite in PR-B v2.8.0. Pattern identic cu helperii Before existenti din PR-B (LEFT JOIN pe monitoring_jobs pentru context job_kind/job_target).",
      },
      {
        title: "Frontend - lib/export-report.ts: builders XLSX + PDF (file nou)",
        content:
          "buildReportXlsx(payload) intoarce 3 sheets: Sumar (13 randuri KPI: jobs/alerts/runs/ai); Activitate zilnica (9 coloane: data + alerts + runs ok/error/timeout/aborted/total + ai cost/calls); Cronologie (5 coloane: data, kind, severity, titlu, detail JSON serializat 800ch cap). Paleta partajata cu lib/export.ts: BLUE_DARK titlu, BLUE_MAIN header, ROW_ALT/WHITE alternativ, sanitizeFormulaCells pe formula injection guard. buildReportPdf(payload) construieste jsPDF landscape A4 helvetica cu 3 sectiuni (Sumar 3 col, Activitate zilnica 9 col, Cronologie pe pagina noua 4 col). stripDiacritics pe text Romana. Footer 'Pagina N'. Italic note daca truncated=true. Filename pattern raport_dashboard_<range>_<dataRO>.<ext>.",
      },
      {
        title: "Frontend - export.worker.ts: dispatch reportXlsx + reportPdf",
        content:
          "ExportJob union din lib/export.ts extins cu {kind: 'reportXlsx', data: DashboardReportPayload} si {kind: 'reportPdf', data: DashboardReportPayload}. Orchestratorii noi exportReportXlsx(payload) + exportReportPdf(payload) posteaza job-ul catre Worker; rezultatul se descarca prin triggerDownload. Build-ul off main thread asigura UI responsive pe ranges 30d cu sute de evenimente.",
      },
      {
        title: "Frontend - ReportExportModal (file nou) + QuickActions wiring",
        content:
          "components/dashboard/ReportExportModal.tsx parent-controlled (open/onClose, NU context provider) ca sa pastreze form state intern. State range default 7d, format default xlsx, busy, error. useRef AbortController pentru cancellation, useEffect reset state la open, ESC handler cand nu e busy, cleanup aborts pe unmount. handleGenerate apeleaza dashboardApi.report({range, signal}) -> ramifica catre exportReportXlsx/exportReportPdf -> inchide la success. Accesibil: role='dialog', aria-modal, aria-labelledby='report-export-title', aria-label='Inchide' pe X. Segmented controls pentru range si format cu active-state styling. components/dashboard/QuickActions.tsx: butonul 'Export raport' devine <button onClick> care deschide modalul (era disabled cu tooltip 'Disponibil in v2.9.0' din PR-A v2.7.0); cele 5 butoane cu rute raman <Link>.",
      },
      {
        title: "Frontend - dashboardApi extins cu metoda report",
        content:
          "lib/dashboardApi.ts: tipuri noi exportate ReportTimelineBlock + DashboardReportPayload. Metoda noua dashboardApi.report({range?, signal?}) reuseste apiFetch + unwrapMonitoring. lib/api.ts re-exports extinse cu noile tipuri ca import-urile sa ramana centrate prin barrel.",
      },
      {
        title: "Tests - 645/645 verzi",
        content:
          "Suite backend la 645 teste verzi (640 baseline din v2.8.0 + 5 noi in routes/dashboard.test.ts): envelope + empty state owner-scoped cand DB-ul e gol; 400 invalid_range pe range absent / invalid; 30d grid cu 30 entries in charts; timeline merge cu 1 alert + 1 run + 1 audit verifica order DESC (ts DESC, id DESC tiebreak); owner isolation pe charts+timeline (alice vs bob). Type-check backend + frontend curat pe fisierele atinse.",
      },
      {
        title: "Sprint Dashboard redesign incheiat",
        content:
          "PR-A v2.7.0 (KPI strip + Quick Actions cu Export raport disabled), PR-B v2.8.0 (timeline cursor-paginated + 3 charts daily 7d/30d, eliminata sectiunea statica 'Tipuri de Procese Disponibile'), PR-C v2.9.0 (Export raport functional). Urmator sprint planificat: PR-10 -> PR-12 server-side sessions + Google SSO + cutover web complet.",
      },
    ],
  },
  {
    version: "v2.8.0",
    date: "2 Mai 2026",
    subtitle:
      "PR-B din sprintul de Dashboard redesign (2 din 3): Timeline cu paginatie cursor (alerte + runs finalizate + audit curat) + Charts cu segmented control 7d/30d (alerte/zi, runs/zi pe status, cost AI/zi). Eliminata sectiunea 'Tipuri de Procese Disponibile' (chips statice fara valoare operationala) ca sa faca loc Charts + Timeline.",
    icon: <Activity className="h-5 w-5" />,
    borderColor: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    sections: [
      {
        title: "Backend - GET /api/v1/dashboard/timeline cu paginatie cursor",
        content:
          "Endpoint owner-scoped (via getOwnerId) wrapped in withMaintenanceRead. Merge 3 surse pe owner: alerts (toate, severitate directa), monitoring_runs (doar finalizate, status mapat: ok=info / error=critical / timeout=warning / aborted=info), audit_log (CURATED_AUDIT_ACTIONS allowlist + outcome != 'ok' catch-all). Cursor format 'ts|id' cu strict less-than ('<') pe (ts, id) ca sa permita progress stabil chiar pe evenimente cu acelasi ms. Limit clamped [1, 100], default 30. Returneaza envelope v1 cu items[] sortate ts DESC tiebreak id DESC + nextCursor null cand stack-ul e gol.",
      },
      {
        title: "Backend - GET /api/v1/dashboard/charts cu range 7d|30d",
        content:
          "Endpoint owner-scoped care returneaza 3 serii daily backfilled (zero-filled days, fara gap-uri vizuale): alerts (count/zi) bar amber, runs (ok+error+timeout+aborted/zi) bar stacked, ai (costUsd+calls+tokens/zi) area sky cu gradient. Grid pe UTC days via utcDayStart(now, days-1) pentru consistenta cu AIUsagePanel din PR-7. Aggregari prin substr(ts, 1, 10) ca day key. Closed lower bound (ts >= since) pentru convention compat cu PR-7.",
      },
      {
        title: "Backend - repository nou backend/src/db/dashboardActivityRepository.ts",
        content:
          "Helperi: listAlertsBefore (cursor query alerts), listFinalizedRunsBefore (cursor query runs cu ended_at NOT NULL), listCuratedAuditBefore (cursor query audit_log cu allowlist OR outcome != 'ok'), aggregateAlertsByDayInRange + aggregateFinalizedRunsByDayAndStatusInRange (charts daily). CURATED_AUDIT_ACTIONS exportat: auth.denied, monitoring.job.deleted, monitoring.name_list.committed, admin.users.*, aviz.delete_*, backup.delete_all, backup.restore, search.delete. Toate folosesc strict '<' pe (ts, id) cu prepared statements.",
      },
      {
        title: "Frontend - componenta Timeline cu paginatie cursor",
        content:
          "Componenta noua frontend/src/components/dashboard/Timeline.tsx cu PAGE_SIZE=30. Map KIND_META (alert=Bell amber, run=Activity verde, audit=Shield slate). Map SEVERITY_BG (info/warning/critical -> bg colored stripes). Helperi formatTs (DD.MM.YYYY HH:MM), relativeTime ('acum 2h'), eventSubline (sub-text per kind). Click pe alert -> /alerte (React Router Link). useEffect cu setInterval(60_000) ca relativeTime sa tick-uiasca live. AbortController per cerere (initial + loadMore) cu cleanup pe unmount. Dedup defensive pe id ca sa nu se dublneasca evenimente la boundary cursor.",
      },
      {
        title: "Frontend - componenta Charts cu segmented control 7d/30d",
        content:
          "Componenta noua frontend/src/components/dashboard/Charts.tsx cu RANGE_OPTIONS=[7d, 30d]. State range default 7d, segmented control pe header. 3 ResponsiveContainer wrap (Recharts BarChart amber pentru alerte, BarChart stacked pentru runs cu legenda culori from chart-colors.ts: runOk verde / runError rosu / runTimeout portocaliu / runAborted violet, AreaChart sky cu gradient pentru cost AI). Tooltip-uri dedicate per chart. Helper formatDateLabel UTC-anchored (new Date('YYYY-MM-DDT00:00:00Z') + timeZone:'UTC') ca sa nu shifteze ziua pe utilizatori in alte timezone-uri. isEmpty helper -> empty state cand toate seriile sunt 0.",
      },
      {
        title: "Frontend - integrare Dashboard.tsx + paleta noua chart-colors.ts",
        content:
          "Eliminat array-ul tipuriProces (7 chips statice) si blocul de render aferent ('Tipuri de Procese Disponibile'). Plasate <Charts /> + <Timeline /> intre LastRnpmCard si blocul 'API Info + Version'. Paleta extinsa in lib/chart-colors.ts cu alerts (#f59e0b), runOk (#22c55e), runError (#ef4444), runTimeout (#f97316), runAborted (#a855f7).",
      },
      {
        title: "Frontend - dashboardApi extins cu timeline + charts",
        content:
          "frontend/src/lib/dashboardApi.ts: tipuri noi exportate TimelineEvent / TimelinePayload / ChartsRange / ChartsAlertsPoint / ChartsRunsPoint / ChartsAiPoint / ChartsPayload. Metode noi dashboardApi.timeline({cursor?, limit?, signal?}) si dashboardApi.charts({range?, signal?}). lib/api.ts re-exports extinse cu noile tipuri ca import-urile sa ramana centrate prin barrel.",
      },
      {
        title: "Tests - 640/640 verzi",
        content:
          "Suite backend la 640 teste verzi (591 baseline din v2.7.0 + 49 noi pentru timeline cursor pagination, charts daily aggregation, owner isolation pe ambele endpoint-uri, cursor strict less-than tiebreak, audit allowlist + outcome catch-all, run status mapping). Pattern Hono test app cu x-test-owner middleware + requestIdContext reuzat din PR-A. Type-check backend + frontend + biome curat pe fisierele atinse.",
      },
    ],
  },
  {
    version: "v2.7.1",
    date: "2 Mai 2026",
    subtitle:
      "Patch UX: icon Legal Dashboard apare corect in taskbar Windows si in dev mode (npm run electron:dev), nu doar pe build-ul NSIS instalat. Helper nou ensureDevTaskbarShortcut() creeaza per-user 'Legal Dashboard (Dev).lnk' in Start Menu cu AUMID + icon.ico, ca Windows sa rezolve corect icon-ul taskbar-ului.",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-slate-500",
    badgeClass: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400",
    sections: [
      {
        title: "Electron - shortcut Start Menu auto-generat in dev mode",
        content:
          "Helper nou ensureDevTaskbarShortcut() apelat in app.whenReady(). Skip pe pachetele NSIS (app.isPackaged) si pe non-Windows. Creeaza per-user 'Legal Dashboard (Dev).lnk' in %APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs cu target=process.execPath, args=projectRoot, icon=build/icon.ico, appUserModelId='ro.legaldashboard.app'. Idempotent: skip daca shortcut-ul exista deja. Erorile sunt try/catch + console.warn (nu blocheaza boot-ul).",
      },
      {
        title: "De ce e nevoie de shortcut",
        content:
          "Windows leaga AUMID-ul declarat de app.setAppUserModelId(...) la icon-ul declarat in shortcut-ul Start Menu cu acelasi AUMID. Fara shortcut, taskbar-ul foloseste icon-ul executabil-ului (electron.exe), nu icon-ul aplicatiei. Pe build-ul NSIS, electron-builder genereaza shortcut-ul automat la install — dev mode nu trecea prin acel flow, deci shortcut-ul nu exista.",
      },
      {
        title: "Operational",
        content:
          "Primul npm run electron:dev dupa update creeaza shortcut-ul si apoi taskbar-ul afiseaza icon-ul corect (poate fi nevoie de restart Explorer la prima rulare daca Windows cache-uieste icon-ul vechi). Restart-urile ulterioare reuseaza shortcut-ul existent. Build NSIS neafectat, zero teste noi (boot-time helper, fara regresie pe paths existente).",
      },
    ],
  },
  {
    version: "Refactor 11 stagii (post-v2.7.0)",
    date: "2 Mai 2026",
    subtitle:
      "Sweep intern de refactorizare livrat in 11 commit-uri secventiale dupa tag-ul v2.7.0 si inainte de PR-B v2.8.0. Zero schimbare functionala vizibila pentru utilizator (toate cele 42 teste frontend + 630 teste backend de la momentul respectiv au ramas verzi); scopul a fost reducerea LOC-ului din fisierele monolitice si separarea responsabilitatilor pentru a putea livra rapid PR-B + PR-C peste o baza curata. Niciun bump de semver pentru ca nu s-a schimbat contractul public — doar organizarea interna a codului.",
    icon: <Layers className="h-5 w-5" />,
    borderColor: "border-l-purple-500",
    badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    sections: [
      {
        title: "Stage 0-1 - infrastructura de teste pentru caracterizare",
        content:
          "Wired vitest + jsdom pe workspace-ul frontend (era doar pe backend). Adaugat suite de teste de caracterizare pentru rute si componente atinse de stagiile urmatoare (lib/api, monitoring repository, alerts route), ca sa avem un safety net peste comportamentul existent inainte de mutari mari. Aceste teste raman in arbore si captureaza contractele actuale.",
      },
      {
        title: "Stage 2a-2c - logging structurat + repository moves",
        content:
          "2a: structured logging in loadMoreSSE silent catches (lib/api.ts) — erorile SSE nu mai sunt inghitite tacit. 2b: jobExistsForAnyOwner mutat din rute monitoring catre repository-ul de joburi (separare clean: rutele nu mai cunosc structura tabelei). 2c: helper classifyRawName extras din nameListParser intr-o functie pura testabila independent.",
      },
      {
        title: "Stage 3-5 - extractii frontend pentru pagini dense",
        content:
          "Stage 3: buildAlertContext extras din pages/Alerts.tsx in lib/alert-context.tsx (~250 LOC mutati). Stage 4: MonitoringBulkImportCard extras din pages/Monitorizare.tsx (~400 LOC mutati intr-o componenta autonoma cu props clare). Stage 5: deduplicat formatDateTime + formatCadence in lib/datetime-formatters.ts (eliminat ~3 copii ale acelorasi helperi).",
      },
      {
        title: "Stage 7 - lib/export.ts spart in trei",
        content:
          "lib/export.ts a scazut de la 1400 LOC la 698 LOC (50% mai mic). Extracted: lib/pdf-helpers.ts (29 LOC) cu MIME_PDF + stripDiacritics + ExportResult partajate; lib/export-analysis.ts (243 LOC) cu buildAnalysisPdf; lib/export-manual.ts (463 LOC) cu buildManualPdf si cele 14 sectiuni de manual. Worker-ul de export importa din modulele noi; build-urile XLSX raman in export.ts (impart excel-helpers).",
      },
      {
        title: "Stage 8 - lib/api.ts spart per domeniu (barrel pattern)",
        content:
          "lib/api.ts a scazut de la 762 LOC la ~370 LOC. Extracted: lib/monitoringApi.ts (joburi + name lists), lib/adminApi.ts (me + admin + audit + quota), lib/dashboardApi.ts (summary). Path-ul de import @/lib/api functioneaza in continuare: api.ts re-exporta simbolurile mutate pentru retro-compat cu toate paginile, hook-urile si testele. Helper nou apiFetch() (thin wrapper peste fetch global) — toate modulele per-domeniu trec prin el, ca in viitor sa putem injecta cross-cutting concerns (auth header, request-id, web-mode origin pin) intr-un singur loc.",
      },
      {
        title: "Stage 9 - useAlertsStream extras din AppShell",
        content:
          "~130 LOC de plumbing EventSource (refs, reconnect backoff, handler-e alert + alert_enriched, gating pentru notificari desktop, refresh server-truth pe unread) mutati din App.tsx intr-un hook nou hooks/useAlertsStream. Hook-ul expune {unreadAlerts, streamVersion, refreshUnreadAlerts} si traieste langa singurul lui consumer. App.tsx: -130 / +2.",
      },
      {
        title: "Stage 10 - monitoringAlertsEnrichment extras backend",
        content:
          "enrichSolutieAlertsForJob (~180 LOC) plus subsistemul alert_enriched (AlertEnrichmentPayload/Listener types, addAlertEnrichmentListener, removeAlertEnrichmentListener, notifyAlertEnriched, map per-owner cu Set) mutate din monitoringAlertsRepository.ts intr-un modul propriu. Repository-ul scade de la 704 la ~485 LOC si ramane focusat pe row CRUD; subsistemul de enrichment (logica F4-F7 pentru backfill solutie_sumar / numar_document / data_pronuntare / instanta / stadiu pe alertele existente) primeste o casa autonoma langa SSE fanout-ul pe care il detine.",
      },
      {
        title: "Sweep final + doc reconciliation",
        content:
          "Cleanup post-refactor: cn() helper aplicat pe sase locuri unde foloseam template-literal conditional className (MonitoringBulkImportCard, Monitorizare); paralelizare chunked Promise.all (CHUNK=5) pentru bulk commit dosar; documentatie inline pentru pattern-ul cursor-pagination din /api/v1/rnpm/searches (deviere documentata fata de regula 'offset pe listari principale'). CLAUDE.md 'Structura Proiect' refresh-uita sa reflecte fisierele noi (lib/monitoringApi etc., lib/dashboardApi, hooks/useAlertsStream, db/monitoringAlertsEnrichment). SESSION-HANDOFF corectat — claim-ul ca 'dashboardApi e inline in api.ts' a devenit fals dupa Stage 8 si a fost rescris.",
      },
      {
        title: "Verificare",
        content:
          "Toate stagiile au fost merge-uite secvential cu suite-le verzi: 42/42 frontend + 630/630 backend la momentul respectiv. Type-check + biome pe fisierele atinse curat. Retro-compat pastrata: niciun consumer extern (pagini, hook-uri, teste) nu a trebuit modificat in afara de Stage 4 (un singur import schimbat in Monitorizare.tsx).",
      },
    ],
  },
  {
    version: "v2.7.0",
    date: "2 Mai 2026",
    subtitle:
      "PR-A din sprintul de Dashboard redesign (1 din 3): endpoint nou /api/v1/dashboard/summary owner-scoped + KPI strip cu 4 carduri (Joburi, Alerte, Runs 24h, Cost AI) + Quick Actions cu 6 butoane deasupra LastDosareCard, polling 30s",
    icon: <Activity className="h-5 w-5" />,
    borderColor: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    sections: [
      {
        title: "Backend - endpoint nou /api/v1/dashboard/summary",
        content:
          "Read-only aggregation owner-scoped (via getOwnerId), wrapped in withMaintenanceRead ca sa coexiste cu backup/restore. Returneaza envelope v1 cu 4 blocuri: jobs.active + jobs.byKind {dosar_soap, name_soap}; alerts.unseen + alerts.last24h; runs {ok, error, timeout, total} cu status 'aborted' foldat in bucket 'error' si runs 'running' excluse din totals; ai {costUsd, calls, tokens} pentru ultimele 24h cu closed lower bound si conversie cost_usd_milli/1000. Plus generatedAt timestamp. Zero schema change, zero migration.",
      },
      {
        title: "Frontend - KPI strip cu 4 carduri responsive",
        content:
          "Componenta KpiStrip noua afiseaza cele 4 metrici esentiale cu iconite distinctive: Joburi active (ListChecks albastru, sub-text 'X dosare, Y subiecti'), Alerte (Bell amber, sub-text 'X necitite / Y in 24h'), Runs 24h (Activity verde, sub-text 'X ok / Y err / Z timeout'), Cost AI 24h (Sparkles violet, sub-text 'X calls, Y tokens'). Grid responsive: stacked pe mobile, 2 col pe tablet, 4 col pe desktop. Loading state cu Loader2 spinner pe fiecare card. Eroare inline destructive cand fetch-ul esueaza. Helperi formatUsd (sub-cent precision) si formatTokens (k/M).",
      },
      {
        title: "Frontend - Quick Actions cu 6 butoane",
        content:
          "Componenta QuickActions noua sub KPI strip cu 6 butoane in grid (2 col mobile -> 3 col tablet -> 6 col desktop): 'Cauta dosar' (/dosare), 'Monitorizare' (/monitorizare), 'RNPM' (/rnpm), 'Alerte' (/alerte), 'Termene' (/termene), 'Export raport' (FileDown, disabled cu tooltip 'Disponibil in v2.9.0 (PR-C)'). Navigare via react-router Link, fara JavaScript imperative.",
      },
      {
        title: "Frontend - integrare Dashboard.tsx cu polling 30s",
        content:
          "KpiStrip si QuickActions plasate deasupra LastDosareCard in pages/Dashboard.tsx. State summary/summaryLoading/summaryError + summaryAbortRef. useEffect cu fetchSummary async (AbortController per request, AbortError ignorat, MonitoringApiError extras la mesaj) + setInterval 30s + cleanup pe unmount. Polling-ul nu blocheaza UI-ul si se aborteaza corect cand utilizatorul navigheaza inainte de raspuns.",
      },
      {
        title: "Frontend - dashboardApi.summary in lib/api.ts",
        content:
          "Surface noua dashboardApi.summary(signal?) adaugata in frontend/src/lib/api.ts (NU intr-un fisier separat) ca sa nu loveasca hook-ul block-renderer-fetch.mjs care interzice raw fetch in afara lib/api.ts sau lib/rnpmApi.ts. Reuseste unwrapMonitoring si MonitoringApiError. Interfete exportate: DashboardSummary, DashboardJobsBlock, DashboardAlertsBlock, DashboardRunsBlock, DashboardAiBlock.",
      },
      {
        title: "Tests - 591 pass (553 PR-A + 38 PR-9 noi)",
        content:
          "PR-A: 7 teste in routes/dashboard.test.ts (envelope v1 + empty state, jobs.byKind filtru active, alerts windowing, runs bucketing, AI 24h aggregation, owner isolation 2 tenants). PR-9: 38 teste in auth/jwt.test.ts, auth/config.test.ts, middleware/owner.test.ts, middleware/rate-limit.test.ts, routes/auth.test.ts (JWT validare iss+aud, missing/invalid token, account_inactive, rate-limit predicate fix, auth.denied audit, cookie secure flag in productie, pre-auth bucket, dashboard aborted bucket separat). Backend tsc verde, frontend tsc verde, biome verde, npm run build verde, smoke desktop boot OK (/api/v1/me + /api/v1/dashboard/summary + /api/v1/alerts/stream toate 200).",
      },
      {
        title: "PR-9 Backend - Auth pluggable seam (desktop noop / web JWT)",
        content:
          "Codex livreaza in paralel cu PR-A: AuthProvider interface cu DesktopAuthProvider (returneaza identitatea local/local 1:1) si WebJwtAuthProvider (cere Bearer token sau cookie legal_dashboard_session, valideaza HS256 cu jose, verifica issuer + audience, valideaza userul in DB cu status active). Codes interne JWT (jwt_expired, jwt_invalid_audience, jwt_invalid_issuer, jwt_invalid_signature, jwt_malformed) sunt logate via console.warn; raspunsul public foloseste 'unauthorized' ca sa nu leak-uiasca detalii catre atacatori. Mesajele auth sunt traduse in romana, raspunsurile folosesc envelope-ul standard fail() cu requestId.",
      },
      {
        title: "PR-9 Middleware - ownerContext + audit auth.denied",
        content:
          "Middleware ownerContext apeleaza provider-ul curent si seteaza ownerId/actorId/authUser pe context. Pe orice respingere de auth (401/403): apeleaza recordAudit(null, 'auth.denied', { ownerId: null, actorId: null, outcome: 'denied', targetKind: 'http_request', targetId: c.req.path, ip, userAgent, detail: { requestId, method, code, status } }) wrapped in try/catch (audit failure nu blocheaza raspunsul). Rate-limit pre-auth predicat fix: releasePreAuthAttempt(key) se apeleaza doar pe 2xx (era inversat - decrementa counter pe ne-2xx, ceea ce nega scopul). Mesaj tradus: 'Prea multe cereri neautentificate'.",
      },
      {
        title: "PR-9 Config - JWT issuer/audience required + cookie secure in productie",
        content:
          "validateAuthConfig() arunca daca JWT_ISSUER sau JWT_AUDIENCE lipsesc in web mode (preventie de cross-product token replay). Helper firstNonEmpty() accepta atat LEGAL_DASHBOARD_* cat si nume neprefixate (env compatibility). isAuthCookieSecureDisabled() arunca eroare la boot daca AUTH_COOKIE_SECURE=0 in productie (doar warn in dev). Rute auth: POST /api/v1/auth/login returneaza 501 not_implemented cu pointer catre PR-10 (SSO se livreaza in cutover-ul web real); POST /api/v1/auth/logout sterge cookie-ul de sesiune.",
      },
      {
        title: "PR-9 Migration 0013 - index pentru queries 24h",
        content:
          "Migration 0013_idx_runs_owner_ended cu up/down: CREATE INDEX IF NOT EXISTS idx_runs_owner_ended ON monitoring_runs(owner_id, ended_at DESC) WHERE ended_at IS NOT NULL. Index partial pentru queries de stats (24h windows in dashboard summary), evita scanare full table cand ai mii de runs istorice.",
      },
      {
        title: "Dashboard runs.aborted ca bucket separat (post-review fix)",
        content:
          "Inainte de Tier 2 hardening, KpiStrip arata 'X ok / X erori / X timeout' cu run-urile abortate manual foldate in 'erori' - era pierdere semantica. Acum schema RunsBlock are camp nou aborted: number, monitoringRunsRepository face query separat, KpiStrip arata 'X ok / X erori / X timeout / X oprite' cu tooltip explicativ ce inseamna fiecare bucket.",
      },
      {
        title: "Sprint Dashboard redesign (1 din 3) + PR-9 mergeat",
        content:
          "PR-A v2.7.0 livreaza KPI strip + Quick Actions. PR-9 v2.7.0 livreaza auth seam-ul. Ambele mergeate impreuna in main 2026-05-02 (commits c74a77e PR-A squashed + 61580a4 PR-9 audit pack + 579ce7b Tier 1+2 review hardening), tag v2.7.0 push-uit pe origin. Urmatorii pasi: PR-B v2.8.0 (timeline activitate + charts), PR-C v2.9.0 (rapoarte exportabile). Butonul 'Export raport' din QuickActions ramane disabled pana la PR-C. PR-10..PR-12 raman in viitor pentru cutover-ul web complet (Google SSO + Litestream + Docker deploy).",
      },
    ],
  },
  {
    version: "v2.6.8",
    date: "1 Mai 2026",
    subtitle:
      "Review-driven hardening peste v2.6.7 - fix HTML a11y pe cardul de bulk import, derivare CADENCE_COL_LETTER din HEADERS, eroare clara la header lipsa in parser, corectare claim stale despre xlsx in docs",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Frontend - HTML button nesting fix (Monitorizare bulk import)",
        content:
          "Cardul 'Adaugare bulk din fisier' din /monitorizare folosea <button> ca wrapper peste <CardHeader> (div) si <CardTitle> (h3). HTML interzice block-elemente in <button> - markup invalid, comportament a11y inconsistent intre browsere. Handler-ul (toggle deschide/inchide) muta acum direct pe <CardHeader> cu role='button', tabIndex=0, onClick si onKeyDown care intercepteaza Enter si Space cu preventDefault. aria-expanded si aria-controls pastrate. Adaugat focus-visible:ring-2 focus-visible:ring-ring pentru focus vizibil la tastatura.",
      },
      {
        title: "Frontend - derivare CADENCE_COL_LETTER din HEADERS",
        content:
          "In monitoringBulkTemplate.ts literalul 'C' inlocuit cu colIndexToLetter(HEADERS.indexOf('cadence_sec')). Helper nou colIndexToLetter (0-based -> A, B, ..., Z, AA, ...) baza 26. Boot-time guard cand cadence_sec lipseste din HEADERS. Reordonarea coloanelor in HEADERS nu mai poate sa desincronizeze silent dropdown-ul OOXML <dataValidation sqref='...'> injectat cu fflate.",
      },
      {
        title: "Frontend - eroare vizibila pentru fisier bulk fara header recunoscut",
        content:
          "parseBulkFile push-uieste in invalid[] o intrare cu mesaj clar 'Header lipsa: fisierul nu contine niciuna dintre coloanele recunoscute (numar_dosar, nume, name_normalized, denumire). Descarca template-ul si reincearca.' cand findHeaderRow esueaza. Anterior: silent return cu valid=[] si invalid=[], utilizatorul nu primea niciun semnal de eroare.",
      },
      {
        title: "Docs - corectare claim stale despre xlsx@0.18.5",
        content:
          "SESSION-HANDOFF.md sectiunea 'Probleme/riscuri ramase' spunea 'xlsx@0.18.5 ramane risc acceptat temporar...' - invalid post-v2.6.4. Rescris: post-v2.6.4 nameListParser.ts ruleaza pe exceljs@^4.4.0, xlsx mutat in devDependencies, ramane folosit doar tranzitiv pe path-ul write-only prin xlsx-js-style si in fixturile de test.",
      },
      {
        title: "Style commitment - structured-section pe entries noi",
        content:
          "Pe future CHANGELOG / STATUS / ROADMAP / SESSION-HANDOFF entries, sectiunile vor fi structurate cu sub-headere bold (Frontend, Backend, Tests, etc.) in loc de paragrafe monolitice. Entries istorice nu se retrofiteaza - costul de mentenanta depaseste beneficiul.",
      },
      {
        title: "Tests - 546 pass (neschimbate)",
        content:
          "Patch frontend + un fisier MD. Zero modificari pe backend, repo, scheduler. Suita backend de 546 teste ramane neschimbata fata de v2.6.7. tsc --noEmit (frontend) verde, npm run build complet in 15.64s fara erori.",
      },
    ],
  },
  {
    version: "v2.6.7",
    date: "1 Mai 2026",
    subtitle:
      "Export Monitorizare Excel + PDF cu paritate Dosare/Termene - butoane in CardHeader, builderii noi reuseaza paleta de stiluri existenta, Web Worker dispatch",
    icon: <FileSpreadsheet className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
    sections: [
      {
        title: "Monitorizare - butoane Excel + PDF in CardHeader",
        content:
          "Pagina /monitorizare primeste paritate completa cu /dosare si /termene la export. Doua butoane noi (Excel + PDF) adaugate in CardHeader-ul 'Joburi active', vizibile cand exista cel putin un job. State partajat exporting cu Loader2 spin pe butonul activ; ambele butoane raman dezactivate in timpul generarii. Cand utilizatorul are joburi selectate (checkbox-uri), exportul acopera doar selectia, cu suffix (N) pe label - altfel exporta toate joburile vizibile. Pattern identic cu DosareTable si TermeneTable.",
      },
      {
        title: "Excel - design identic cu Termene/Dosare",
        content:
          "Builderul nou buildMonitoringXlsx reuseaza paleta de stiluri din aplicatie: titlu 'PORTALJUST DASHBOARD - MONITORIZARE' BLUE_DARK 13 bold alb merged peste 8 coloane, subtitlu cu data si numar joburi, header BLUE_MAIN bold alb, randuri alternate ROW_ALT/WHITE font 10. Cele 8 coloane: #, Tinta, Tip, Cadenta, Ultima rulare, Urmatoarea verif., Status, Note. Latimi 5/30/12/10/18/18/16/30 ch. Formula-injection guard sanitizeFormulaCells aplicat pre-write (prefix ' pe celule care incep cu =+-@\\t\\r). Filename: monitorizare_<tinta>.xlsx pentru un singur job sau monitorizare_<dataRO>.xlsx pentru export multiplu - consecvent cu dosare_*/termene_*.",
      },
      {
        title: "PDF - landscape A4 cu acelasi look",
        content:
          "Builderul nou buildMonitoringPdf foloseste jsPDF + jspdf-autotable in landscape A4 cu fontul helvetica, header [37,99,235] (albastru) cu text alb, randuri alternate [245,247,250], dimensiuni font/padding identice cu PDF-urile Termene/Dosare. Coloana Tinta apare cellWidth 50 fontStyle bold pentru lectura rapida. Footer 'Pagina N' centrat pe fiecare pagina. stripDiacritics pe text (jsPDF default font nu suporta diacritice).",
      },
      {
        title: "Web Worker dispatch - UI ramane responsiv",
        content:
          "ExportJob discriminated union extins cu kind 'monitoringXlsx' si 'monitoringPdf'. Worker-ul export.worker.ts primeste cele doua case-uri noi in switch si trimite buffer-ul inapoi cu transferable. Build-ul efectiv (xlsx-js-style + jspdf) ruleaza off main thread - spinner-ul React ramane fluid pana la salvare chiar si pe runs cu sute de joburi. Pattern identic cu RNPM, AI si Manual.",
      },
      {
        title: "Tests - 546 pass (neschimbate)",
        content:
          "Patch frontend-only additive. Zero modificari pe backend, repo sau scheduler. Suita backend de 546 teste ramane neschimbata fata de v2.6.4..v2.6.6.",
      },
    ],
  },
  {
    version: "v2.6.6",
    date: "1 Mai 2026",
    subtitle:
      "Patch UX Monitorizare - name_soap parity (buton Dosare + target bold + label 'Nume') + swap coloane Ultima rulare / Urmatoarea verif.",
    icon: <Sparkles className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
    sections: [
      {
        title: "Monitorizare - buton Dosare pe randuri name_soap",
        content:
          "Randurile cu kind 'name_soap' (subiectii din bulk import) randeaza acum target-ul (numele subiectului) font-bold urmat de butonul 'Dosare' cu icon Eye, identic vizual cu randurile dosar_soap. Click pe buton declanseaza auto-search in tab-ul Dosare prin acelasi flow pendingSearch existent, doar ca filtrul se aplica pe campul 'Nume parte' in loc de 'Numar dosar'. Pattern consecvent: orice TINTA din inbox-ul de monitorizare ofera o scurtatura catre cautarea in-app.",
      },
      {
        title: "Monitorizare - 'Subiect' redenumit 'Nume' in coloana TIP",
        content:
          "Label-ul afisat in coloana TIP pentru joburile name_soap schimba 'Subiect' in 'Nume', consecvent cu formularul de adaugare (foloseste 'nume') si cu coloana 'nume' din template-ul XLSX (v2.6.5). Restul kind-urilor raman neschimbate (dosar_soap -> 'Dosar', aviz_rnpm -> 'Aviz RNPM').",
      },
      {
        title: "Monitorizare - swap coloane 'Ultima rulare' / 'Urmatoarea verif.'",
        content:
          "Ordinea coloanelor in tabelul de joburi devine 'Ultima rulare -> Urmatoarea verif.' (era invers). Citirea naturala in cazul unui inbox de monitorizare este 'ce s-a intamplat ultima oara, apoi cand verific din nou' - coloana cu fapte (last_run_at) inainte de cea cu predictia (next_run_at). Swap-ul atinge atat header-ul cat si celulele, fara modificari la datele din API.",
      },
      {
        title: "Tests - 546 pass (neschimbate)",
        content:
          "Modificarile sunt strict frontend (label + render path + ordine coloane). Suita backend de 546 teste ramane neschimbata fata de v2.6.5.",
      },
    ],
  },
  {
    version: "v2.6.5",
    date: "1 Mai 2026",
    subtitle:
      "Patch UX Monitorizare - TINTA bold, bulk import collapsible + descriere non-tehnica, template XLSX restilizat la nivelul exporturilor, nota inline italic sub TINTA",
    icon: <Sparkles className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
    sections: [
      {
        title: "Monitorizare - TINTA bold",
        content:
          "Link-ul cu numarul dosarului din coloana TINTA (joburi dosar_soap) trece de pe font-medium pe font-bold. Numarul devine prima ancora vizuala din rand, consecvent cu pattern-ul 'primary action surface' din inbox-ul Alerte.",
      },
      {
        title: "Monitorizare - card bulk import collapsible",
        content:
          "Cardul 'Adaugare bulk din fisier' nu mai ocupa permanent jumatate din pagina. Header-ul devine clickable cu icon ChevronDown/ChevronRight; CardContent randat condional (default colapsat). Descrierea trece de pe gri pal pe negru pentru lizibilitate, iar textul tehnic se rescrie in romana simpla: descarca template -> completeaza -> incarca, fara nume de coloane.",
      },
      {
        title: "Monitorizare - template XLSX restilizat",
        content:
          "Template-ul bulk descarcat din pagina foloseste acum acelasi limbaj vizual ca toate celelalte exporturi Excel din aplicatie: titlu BLUE_DARK merged peste coloane (centrat, bold alb 13), header BLUE_MAIN cu border-bottom 1D4ED8 si wrapText, randuri alternate ROW_ALT/WHITE, font 10 plain. Latimi recalibrate (16/28/12/18/30 ch). Dropdown-ul de cadenta ramane functional pe range-ul C5:C1004 (post-process OOXML cu fflate). Fisierele bulk vechi (header pe primul rand, fara titlu/stats) raman compatibile - parser-ul detecteaza header-ul dinamic in primele 20 randuri.",
      },
      {
        title: "Monitorizare - note inline sub TINTA",
        content:
          "Field-ul 'Note' din formularul de adaugare era write-only - colectat in UI, persistent in DB, dar niciodata vizibil in tabel. Patch-ul afiseaza nota inline sub link+buton in aceeasi celula TINTA pe randurile cu notes populat (text mic italic gri, truncate la 420px cu tooltip integral pe hover). Randurile fara nota raman compacte - randare conditionata, fara coloana noua si fara spatiu mort.",
      },
      {
        title: "Tests - 546 pass (neschimbate)",
        content:
          "Modificarile sunt strict frontend (UI styling + un singur helper de parse). Suita backend de 546 teste ramane neschimbata fata de v2.6.4.",
      },
    ],
  },
  {
    version: "v2.6.4",
    date: "1 Mai 2026",
    subtitle:
      "Patch - audit hardening (multi-agent review) finalizat: DELETE in-flight, enrichment relaxed, SSE alert_enriched, bulk delete atomic, metrici precise, xlsx -> exceljs, fail-closed remote",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Monitorizare - DELETE blocheaza job-urile in-flight (F1)",
        content:
          "DELETE monitoring job verifica acum scheduler-ul in-flight si returneaza 409 daca jobul ruleaza activ; previne erori RUNNER_THREW cand userul sterge un job in timpul unui SOAP call.",
      },
      {
        title: "Securitate - xlsx -> exceljs migration (F3)",
        content:
          "Backend-ul migrat de pe `xlsx@0.18.5` (CVE Prototype Pollution + ReDoS, fara fix upstream) pe `exceljs@^4.4.0` pentru parser-ul de fisiere uploaded. parseNameList devine async, cu safety belt 30s timeout pe parse. xlsx mutat in devDependencies (folosit doar de fixture-uri de test). xlsx-js-style ramane neschimbat pe path-ul de export (write-only, nu primeste input atacator).",
      },
      {
        title: "Securitate - remote bind fail-closed + originGuard (F2)",
        content:
          "LEGAL_DASHBOARD_ALLOW_REMOTE=1 sau HOST non-loopback REFUZA pornirea (exit 1) pana cand operatorul confirma explicit ack-ul LEGAL_DASHBOARD_ACK_NO_AUTH=i-understand-no-auth-yet. Cu ack prezent, middleware-ul originGuard pe /api/* blocheaza requesturi state-changing (POST/PUT/PATCH/DELETE) cu Origin/Referer mismatch fata de Host pentru caller-i non-loopback (403 csrf_origin_mismatch). Loopback (desktop la el insusi) trece liber.",
      },
      {
        title: "Alerte - enrichment relaxed + SSE alert_enriched (F4+F5+F6+F7)",
        content:
          "enrichSolutieAlertsForJob proceseaza max 200 alerte/tick, filtreaza created_at >= now-7days si foloseste match relaxat (trim + fallback pe data/ora/complet) pentru a nu bloca backfill-ul hotararii. SSE eveniment nou `alert_enriched` notifica clientii cand o alerta veche primeste textul hotararii fara refresh manual.",
      },
      {
        title: "Monitorizare - bulk delete atomic + metrici precise (F9+F10)",
        content:
          "Ruta noua `POST /jobs/bulk-delete` proceseaza atomic stergerile, raporteaza `deleted_ids` / `inflight_ids` / `not_found_ids`; frontend-ul pastreaza selectia esuata pentru retry. `alerts_created` reflecta doar inserturile reale (insertAlert returneaza `{row, inserted}`); coloana noua `monitoring_runs.alerts_patched` (migration 0012) contorizeaza separat enrichment-urile in-place.",
      },
      {
        title: "Tests - 546 pass (era 524 in v2.6.3)",
        content:
          "10 P0 enrichment + 1 runner integration end-to-end + 7 originGuard + 1 alerts_patched repo + 3 nameListParser xlsx malformed/oversized.",
      },
    ],
  },
  {
    version: "v2.6.3",
    date: "30 Aprilie 2026",
    subtitle: "Patch - UX Monitorizare TINTA + cadenta non-standard onesta + paginare Alerte unificata",
    icon: <Activity className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Monitorizare - coloana TINTA cu link PortalJust + buton cautare",
        content:
          "In tabelul de joburi, numarul dosarului e acum link extern catre portal.just.ro plus un buton mic Search care declanseaza auto-search in lista Dosare (acelasi pattern ca in inbox-ul Alerte).",
        bullets: [
          '<a target="_blank"> catre portal.just.ro/SitePages/cautare.aspx?k=<numar> via getPortalJustUrl helper, cu icon ExternalLink 12px.',
          'Buton 24x24 cu icon Search langa numar -> onOpenDosar(numar) -> handleHistoryClick("dosare", { numarDosar }) -> pendingSearch -> tab Dosare cu auto-search.',
          "Aplicabil doar joburilor dosar_soap (numar canonic care intra in URL). name_soap / aviz_rnpm raman plain text.",
        ],
      },
      {
        title: "Monitorizare - dropdown cadenta onest pentru valori non-standard",
        content:
          'Dropdown-ul nu mai minte: cand cadence_sec din DB nu e in {4h, 8h, 12h, 24h}, prepende un option "<valoare> (custom)" cu border amber, in loc sa afiseze fals "4h".',
        bullets: [
          'Bug investigat empiric: job 1234/180/2024 (smoke-hardening leftover) avea cadence_sec=600 (10min) in DB; UI afisa silent "4h" iar runner-ul folosea valoarea reala -> next_run = last_run + 10min, nu + 4h.',
          "Fix: cand !CADENCE_OPTIONS.some(o => o.sec === job.cadence_sec), prepende <option value={job.cadence_sec}>{formatCadence(job.cadence_sec)} (custom)</option> si seteaza select.value la valoarea reala.",
          "Border + text amber (border-amber-500 text-amber-700) ca avertisment vizual; tooltip explica cum sa normalizezi.",
          "Backend Zod accepta min(600).max(86400) deci dropdown-ul reflecta acum corect realitatea fara a constrange backend-ul.",
        ],
      },
      {
        title: "Alerte - paginare unificata cu restul aplicatiei",
        content:
          "Inbox-ul de alerte foloseste acum componenta partajata TablePagination (la fel ca Cautare Dosare / RNPM / Termene), cu page-size selector + numere de pagina + input de salt.",
        bullets: [
          "TablePagination wrappata in <Card> ca dimensiunile zonei sa match-uiasca exact restul tabelelor.",
          "Page intern 0-indexed (componenta) cu conversie +1 la apelul backend (1-indexed).",
          "pageSize devine state controlat (default 25) cu reset la pagina 0 cand se schimba.",
          "Filtrele (kind / severity / from / to / onlyUnread / includeDismissed) reseteaza pagina la 0.",
        ],
      },
      {
        title: "Alerte - card zoom -1px aditional pe scara",
        content: "Cardul de alerta scade cu inca un pixel pe toata scara slider-ului fata de v2.6.2.",
        bullets: [
          "alertCardZoom = (fontSize.value - 3) / fontSize.value (era - 2). La pozitiile slider (16/18/20/22) zoom-ul devine 81.3% / 83.3% / 85% / 86.4%.",
          "useFontSize ramane neschimbat - doar coeficientul cardului.",
        ],
      },
      {
        title: "Validari",
        content:
          "Type-check curat, smoke desktop confirma comportamentul, 524 teste backend neschimbate (modificarile sunt strict frontend + prop-passing).",
        bullets: [
          "npx tsc --noEmit (frontend) clean.",
          'Smoke: TINTA dosar_soap deschide portal.just.ro + butonul Search navigheaza in Dosare; dropdown afiseaza "10min (custom)" cu amber pe job-ul cu cadenta non-standard; selectia "4h" normalizeaza la 14400 dupa refresh; paginare Alerte identica vizual cu Cautare Dosare; zoom card reactiv la slider.',
        ],
      },
    ],
  },
  {
    version: "v2.6.2",
    date: "30 Aprilie 2026",
    subtitle: "Patch - UX inbox alerte (card scaling + dosar link extern + solutie completa)",
    icon: <Bell className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Frontend - card scaling reactiv",
        content:
          "Cardul de alerta se scaleaza dinamic 2px sub slider-ul de fonturi, pastrand UI-ul aerisit fara sa modifice scala globala.",
        bullets: [
          "Hook useFontSize re-folosit; alertCardZoom = (fontSize.value - 2) / fontSize.value aplicat ca CSS zoom pe CardContent.",
          "Re-render reactiv pe schimbarea sliderului (Mic/Normal/Mare/Extra) - cardul ramane mereu cu o treapta mai mic, fara hardcode pe Tailwind classes.",
          "Font + padding + gap se scaleaza proportional via zoom (Chromium-supported in Electron), nu doar font-size.",
        ],
      },
      {
        title: "Frontend - dosar link extern + buton corect",
        content:
          "Numarul dosarului din header e link extern catre PortalJust, iar butonul cauta in lista locala Dosare.",
        bullets: [
          '<a target="_blank"> catre portal.just.ro/SitePages/cautare.aspx?k=<numar> via getPortalJustUrl helper - whitelist .just.ro deja activ in setWindowOpenHandler + shell.openExternal.',
          "Buton renamed Cauta in app cu icon Eye + title Deschide ... in lista Dosare; mecanismul pendingSearch din App.tsx ramane intact.",
          "Tooltip pe link-ul de dosar: Deschide <numar> pe portal.just.ro.",
        ],
      },
      {
        title: "Backend + frontend - solutie_aparuta cu hotararea integrala",
        content:
          "Alertele de tip solutie_aparuta arata acum textul integral al hotararii (nr. document + data pronuntare + sumar) in loc de solutia scurta.",
        bullets: [
          "dosarSoapRunner emite solutie_sumar / numar_document / data_pronuntare in detail (campurile erau deja parsate de soap.ts dar neutilizate).",
          "Frontend afiseaza Hotarare: <numar_document> · <data_pronuntare> + Solutie completa: <solutie_sumar> ca facts dedicati.",
          "Cheile sunt incluse in setul consumed pentru a nu duplica in Detalii suplimentare.",
        ],
      },
      {
        title: "Backend - JOIN pentru alerte pre-enrichment",
        content:
          "Alertele vechi (create inainte de v2.6.1) primesc numar_dosar via LEFT JOIN pe monitoring_jobs.target_json, fara backfill destructiv.",
        bullets: [
          "listAlerts: SELECT a.*, j.target_json AS job_target_json, j.kind AS job_kind FROM monitoring_alerts a LEFT JOIN monitoring_jobs j ON j.id = a.job_id AND j.owner_id = a.owner_id.",
          "owner_id check defensiv pe JOIN; toate WHERE clauses qualified cu alias-ul a (kind / source exista pe ambele tabele).",
          "MonitoringAlert types extinse in alertsApi.ts cu job_target_json + job_kind optionali.",
          "buildAlertContext: parseaza job_target_json ca fallback pentru numar_dosar cand detail.numar_dosar lipseste.",
        ],
      },
      {
        title: "Frontend - Detalii suplimentare cu valori",
        content:
          "Sectiunea fallback afiseaza acum chei + valori humanizate (JSON-stringificate, scurtate la 200ch) in loc de o lista plata de chei.",
        bullets: [
          "humanizeKey: snake_case -> Title case; stringifyFallbackValue: primitive sau JSON.stringify, drop pe null/empty/array gol.",
          "Render <dl> 2-col cu chei muted + valori in monospace, text-xs ca sa nu invadeze cardul.",
        ],
      },
      {
        title: "UX cleanup",
        content:
          "Linia tehnica Job #N · Run #M · Dedup: ... a fost scoasa din card - era zgomot UX vizibil end-userilor; ramane disponibil in Backoffice/audit.",
      },
      {
        title: "Validari",
        content:
          "524/524 teste backend (toMatchObject partial-match in dosarSoap.test.ts si monitoringAlertsRepository.test.ts - safe sa adaugam campuri). Type-check backend + frontend clean. Smoke desktop confirma scaling reactiv + link extern + solutie integrala.",
      },
    ],
  },
  {
    version: "v2.6.1",
    date: "30 Aprilie 2026",
    subtitle: "Patch - alerte cu context dosar + identitate Windows",
    icon: <Bell className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Alerte - context complet pe fiecare notificare",
        content:
          "Inboxul Alerte si notificarile native arata acum dosarul, instanta si data formatata; un buton dedicat declanseaza cautarea in Dosare.",
        bullets: [
          "Backend: dosarSoapRunner injecteaza numar_dosar (din job target), instanta si stadiu (din SOAP curent) in detail-ul fiecarei alerte; nameSoapRunner injecteaza name_normalized.",
          "Frontend: detail-ul afiseaza Dosar (font-mono), Data sedintei (dd.mm.yyyy din ISO), Ora, Complet, Solutie, Stadiu, Categorie ca perechi label/value.",
          "termen_changed arata explicit De la / La cu ora respectiva; stadiu_changed / categorie_changed arata Schimbare: from -> to.",
          "Buton Cauta dosar (cand numar_dosar e prezent) navigheaza in Dosare cu auto-search prin mecanismul existent pendingSearch.",
        ],
      },
      {
        title: "Electron - identitate Windows",
        content:
          'Apel app.setAppUserModelId("ro.legaldashboard.app") inainte de orice fereastra, ca Windows sa asocieze procesul cu icon-ul real.',
        bullets: [
          "Fix: taskbar-ul in dev nu mai arata icon-ul default Atom-Electron; native notifications nu mai sunt atribuite electron.app.Electron.",
          "appId din electron-builder e identic, deci pe install NSIS pictograma ramane consistenta cu pictograma dev.",
        ],
      },
      {
        title: "Validare",
        content:
          "524/524 teste backend (testele existente folosesc partial-match pentru detail, deci nu erau afectate). Type-check backend si frontend clean. Smoke desktop confirma alerte cu numar_dosar + buton functional + icon corect.",
      },
    ],
  },
  {
    version: "v2.6.0",
    date: "30 Aprilie 2026",
    subtitle: "PR-8 - admin pages + roles guard",
    icon: <UsersIcon className="h-5 w-5" />,
    borderColor: "border-l-indigo-500",
    badgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
    sections: [
      {
        title: "Backend - guard de rol + suprafete admin",
        content:
          "Middleware nou requireRole(...allowed) si rute /api/v1/me + /api/v1/admin/* gated, pregatite pentru cutoverul web din PR-9.",
        bullets: [
          "requireRole(...): 401 cand userul nu exista, 403 cand statusul nu e active sau rolul nu e in allowlist; fiecare refuz scrie audit auth.denied cu reason si required.",
          "GET /api/v1/me: profilul callerului in envelope v1 (id, email, role, status, createdAt, lastLoginAt).",
          "GET /admin/users (paginare + search/role/status), GET /admin/users/:id, PATCH role/status, GET /admin/audit (since closed-lower / until open-upper), GET/PUT/DELETE /admin/users/:id/quota.",
          "Migration 0011_user_quota_overrides: PK (user_id, feature), daily_limit_usd_milli >= 0, ON DELETE CASCADE pe user.",
        ],
      },
      {
        title: "Backend - guardrails irreversibile",
        content: "Doua refuzuri 409 prevenirea blocarii adminului de a iesi singur din sistem.",
        bullets: [
          "last_admin: PATCH /admin/users/:id/role refuza self-demotion cand callerul ar ramane zero administratori activi; audit admin.users.demote_blocked pe esec.",
          "self_deactivation: PATCH /admin/users/:id/status refuza un caller care isi schimba propriul status in non-active; audit admin.users.update_status doar pe succes.",
          "Toate write-urile (role, status, quota upsert/delete) scriu audit cu before/after in detail_json. Read-urile NU scriu audit pentru a evita poluarea.",
        ],
      },
      {
        title: "Frontend - hook + componente shared",
        content:
          "useCurrentUser fetch-uieste /me la mount (AbortController + retry via tick); AdminGate randeaza 403 pentru non-admini.",
        bullets: [
          "Hook useCurrentUser: { user, loading, error, refresh } - folosit de Sidebar (decide afisarea sectiunii Administrare) si AdminGate (gating client-side).",
          "AdminGate: ecran 403 cu mesaj romanesc cand user?.role !== admin. Pur cosmetic - serverul re-verifica rolul pe fiecare call /api/v1/admin/*.",
          "Sidebar: cand rolul e admin, afiseaza sectiunea Administrare cu trei iteme (Utilizatori, Audit, Cote). Iconite identice in modul collapsed.",
          "lib/api.ts: tipuri MeProfile / AdminUser / AuditEvent / QuotaOverride si helperi me.get + admin.{listUsers, getUser, updateRole, updateStatus, listAudit, listQuota, upsertQuota, deleteQuota}.",
        ],
      },
      {
        title: "Frontend - pagini admin",
        content: "Trei pagini noi sub /admin/*, fiecare wrapped in AdminGate.",
        bullets: [
          "/admin/users: tabel paginat cu inline select pentru rol si status, confirmari prin useConfirm, refresh /me automat dupa schimbare proprie de rol.",
          "/admin/audit: tabel cu rand expandabil per eveniment - timestamp, action, outcome, owner/actor/target, IP plus detail_json pretty-printed la expansiune.",
          "/admin/quota: workflow in doua etape - cauta utilizator, vezi/edit-eaza override-urile lui. Limitele in USD (3 zecimale), salvate ca milli-USD.",
        ],
      },
      {
        title: "Validare",
        content:
          "524/524 teste backend (de la 440 in v2.5.1, +84 noi). Type-check backend si frontend clean. Smoke test end-to-end pe /me, gate, /admin/users, /admin/audit?since, quota PUT/GET, self-demote 409.",
      },
    ],
  },
  {
    version: "v2.5.1",
    date: "30 Aprilie 2026",
    subtitle: "Hotfix PR-7 - hardening post multi-review",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Aliniere fereastra de timp + retention",
        content: "Fix corectitudine pe seria daily si totalurile 30 zile, plus retention automat pentru ai_usage.",
        bullets: [
          "Toate query-urile pe fereastra de timp folosesc acum ts >= ? (closed lower bound) - fix off-by-one pentru randuri care aterizeaza exact la since.",
          "summary30d aliniat la aceeasi fereastra UTC-midnight ca seria daily (era now − 30×24h, mismatched cu bucket-urile zilnice).",
          "Handler /api/v1/ai-usage/summary wrapped in withMaintenanceRead pentru cooperare cu daily backup writer.",
          "Functie noua purgeOldAiUsage(90) in scheduler-ul zilnic alaturi de purgeOldRuns, cu try/catch independent.",
        ],
      },
      {
        title: "Cancellation + shutdown safety",
        content: "Multi-agent flow nu mai lasa siblings idle si DB-ul nu mai poate fi redeschis post-shutdown.",
        bullets: [
          "Multi-agent: analystsAbort AbortController shared - un analist esuat anuleaza sibling-ul, evita 180s timeout idle.",
          "signal? AbortSignal propagat in callAnthropic, callOpenAI, callGoogle si callModel; compus cu timeout intern via AbortSignal.any.",
          "markShuttingDown() latch one-way: getDb() arunca daca este apelat post-shutdown - previne late recordAiUsageSafely microtasks de a redeschide DB-ul.",
          "Token extraction din SDK error objects: usageInput/usageOutput sunt acum populate din e.usage cand SDK-ul arunca dar a contorizat partial.",
        ],
      },
      {
        title: "Safety + observability",
        content: "Logging structurat + clamps defensive ca log-ul sa ramana curat la valori out-of-range.",
        bullets: [
          "httpStatus clamped la [100,599] sau null cand SDK-ul intoarce o valoare in afara intervalului HTTP standard.",
          "Price-table miss warn one-shot (JSON structurat) cu dedup pe provider+model - fara spam in log la modelele noi fara pret.",
          "Insert-failure log structurat single-line JSON (action: ai_usage.persist_failed).",
          "Insert SQLite deferred via queueMicrotask ca sa iasa de pe response hot path al call-ului SDK.",
        ],
      },
      {
        title: "Frontend - timezone + cancellation + transparenta",
        content:
          "Etichetele zilei coincid acum cu bucket-urile UTC din backend si refresh-ul anuleaza request-ul anterior.",
        bullets: [
          "Fix timezone bug pe seria daily: new Date(`${value}T00:00:00Z`) + timeZone: UTC in formatDateLabel.",
          "inflightRef AbortController in AIUsagePanel - refresh re-fire anuleaza request-ul anterior in loc sa lase doua request-uri in zbor.",
          "Caption Informativ etichetat explicit in panel: pe desktop nu exista quota enforce, costurile efective sunt facturate de provider.",
        ],
      },
      {
        title: "Validare",
        content:
          "440/440 teste backend (de la 432, +8 din hardening pass). Type-check backend si frontend clean. Biome lint/format clean. Sequence npm rebuild better-sqlite3 → npm test → npm run rebuild:electron completata.",
      },
    ],
  },
  {
    version: "v2.5.0",
    date: "30 Aprilie 2026",
    subtitle: "PR-7 - AI usage tracking + quota visibility",
    icon: <BrainCircuit className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
    sections: [
      {
        title: "Usage AI persistent",
        content:
          "Fiecare call real catre Claude, OpenAI sau Gemini lasa acum un row owner-scoped in ai_usage, fara sa schimbe prompturile sau flow-ul de analiza.",
        bullets: [
          "Migration 0010_ai_usage adauga provider, model, input/output tokens, cost_usd_milli, http_status, was_aborted, request_id si feature.",
          "withAiLogging persista usage dupa call SDK; NO_API_KEY nu este contorizat fiindca nu porneste niciun call extern.",
          "Analiza multi-agent scrie cate un row per call real: analist 1, analist 2 si judge daca ajunge la faza judge.",
          "Costurile sunt estimate ca integer milli-USD, cu fallback safe la 0 cand lipseste modelul sau token usage.",
        ],
      },
      {
        title: "Panou AI Usage",
        content: "Setari API include acum vizibilitate pe costul AI pentru userul curent.",
        bullets: [
          "GET /api/v1/ai-usage/summary returneaza cost 24h, cost 30 zile si serie daily last 30 days.",
          "Panoul afiseaza carduri de cost, grafic Recharts, tokeni input/output, cost mediu per apel si stari loading/error/empty.",
        ],
      },
      {
        title: "Validare",
        content:
          "432/432 teste backend trecute, backend/frontend typecheck clean, build productie trecut. better-sqlite3 a fost reconstruit pentru Node inainte de Vitest si readus pe ABI Electron dupa teste.",
      },
    ],
  },
  {
    version: "v2.4.2",
    date: "30 Aprilie 2026",
    subtitle: "Hotfix PR-6 - hardening post full-review",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Hardening backend alerte",
        content:
          "Refinari peste v2.4.1 dupa multi-agent review pe suprafata alertelor. Fara feature noi, doar corectitudine si izolare.",
        bullets: [
          "SSE heartbeat la 25s + retry: 3000 ca EventSource sa reconecteze deterministic indiferent de browser.",
          "recordAudit pe seen, dismissed si pe noul seen-bulk - doar pe success path, ca sa nu ofere informatie de existenta cross-tenant pe 404.",
          "bodyLimit dedicat pe rutele de mutatie (4 KiB pe PATCH-uri, 8 KiB pe seen-bulk).",
          "Cap 5 stream-uri SSE per owner; clientii peste cap primesc un frame final cu codul too_many_streams in loc de drop silent.",
          "POST /api/v1/alerts/seen-bulk inlocuieste N PATCH-uri cu un singur UPDATE tranzactional.",
          "insertAlert acum complet tranzactional; notifyNewAlert e deferred prin queueMicrotask ca listenerii SSE sa nu mai ruleze sub SQLite write lock.",
        ],
      },
      {
        title: "Frontend - bug-fixes vizibile",
        content: "Doua probleme observabile au fost reparate plus cateva sterse din lipsa de utilitate.",
        bullets: [
          'Fix bug timezone in filtrele de data: pentru un user UTC+3 selectarea zilei "30 Apr" rata 3 ore de alerte din ziua respectiva. Filtrele construiesc acum fereastra in local time corect.',
          "markVisibleSeen pleaca prin endpoint-ul nou seen-bulk; fallback Promise.allSettled pe per-id daca bulk-ul esueaza, in loc de loop sequential abandonat la prima eroare.",
          "Notificarile native sunt suprimate cand fereastra e focused (focus + visibility) - elimina double-feedback cand user-ul deja se uita la app.",
          "Counter unread devine server-truth pe fiecare event: scos optimistic increment care racing cu refresh-ul.",
        ],
      },
      {
        title: "Notificari Electron - dedup",
        content:
          "Payload-ul desktopApi.showNotification accepta acum tag (optional). Main process tine un Map<tag, Notification> cu cap 100 si inchide notificarea anterioara cu acelasi tag inainte de a o arata pe cea noua, ca sa nu se acumuleze duplicate la SSE replay.",
      },
      {
        title: "Validare",
        content:
          "Type-check si biome clean. Smoke test live Electron: boot OK, scheduler running, /health + /api/v1/alerts + /alerts/stream + /monitoring/jobs toate 200. Vitest amanat pentru fereastra urmatoare de rebuild (better-sqlite3 ABI mismatch intre Electron si Node tester).",
      },
    ],
  },
  {
    version: "v2.4.1",
    date: "30 Aprilie 2026",
    subtitle: "PR-6 - Alerte UI + notificari desktop",
    icon: <Bell className="h-5 w-5" />,
    borderColor: "border-l-rose-500",
    badgeClass: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
    sections: [
      {
        title: "Inbox Alerte",
        content:
          "Alertele produse de monitorizare au acum pagina dedicata, cu lista paginata, filtre si actiuni clare.",
        bullets: [
          "Filtre dupa tip, severitate, interval, doar necitite si includere alerte inchise.",
          "Actiuni pe alerta: marcheaza citit si inchide/dismiss.",
          "Detaliile JSON sunt parsate defensiv si afisate compact, fara crash pe payload-uri vechi.",
        ],
      },
      {
        title: "Live badge + stream",
        content:
          "Sidebar-ul afiseaza numarul de alerte necitite, actualizat prin stream live si refresh automat la reconectare.",
        bullets: [
          "SSE pe /api/v1/alerts/stream cu cleanup la unmount si reconnect cu backoff.",
          "Badge-ul numeric rosu apare langa Alerte in sidebar expandat si peste clopotel in modul colapsat.",
          "Badge-ul scade dupa mark read/dismiss.",
          "Fallback-ul la refresh pastreaza UI-ul corect daca stream-ul cade temporar.",
        ],
      },
      {
        title: "Notificari Electron",
        content: "Alertele noi trimit notificare nativa din Electron main process prin IPC ingust.",
        bullets: [
          "Renderer-ul cheama desktopApi.showNotification, iar main process foloseste new Notification.",
          "Fallback Web Notification ramane doar pentru dev/web.",
          "Input-ul notificarii este capat ca dimensiune in main process.",
        ],
      },
      {
        title: "Backend API",
        content: "Rute owner-scoped pentru inbox: GET /api/v1/alerts, PATCH seen/dismissed si stream SSE.",
      },
    ],
  },
  {
    version: "v2.4.0",
    date: "29 Aprilie 2026",
    subtitle: "PR-5 - bulk name lists + name_soap monitoring",
    icon: <FileSpreadsheet className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Monitorizare bulk",
        content:
          "Monitorizare accepta acum fisiere XLSX/CSV mixte: randurile cu numar_dosar creeaza joburi dosar_soap, iar randurile cu nume intra in flow-ul name_soap cu preview si commit.",
        bullets: [
          "Template XLSX cu numar_dosar, nume, cadence_sec si notes; coloana cadence_sec are dropdown 4h/8h/12h/24h.",
          "Generatorul XLSX a fost reparat pentru Excel: dataValidations este scris in ordinea OOXML corecta, fara repair prompt.",
          "Pentru bulk dosar, contorul adaugate/existente foloseste statusul HTTP 201/200, nu o euristica pe timestamp.",
        ],
      },
      {
        title: "Name lists + runner name_soap",
        content:
          "Backend-ul salveaza listele importate, pastreaza lineage catre joburile create si ruleaza interogari SOAP dupa subiect pentru alerte pe dosare nou aparute sau schimbate.",
        bullets: [
          "Preview/commit stateless cu re-validare server-side si capuri stricte pentru fisiere XLSX/CSV.",
          "Auto-create jobs proceseaza maximum 100 joburi pe tranzactie si continua idempotent la retry.",
          "Runner-ul name_soap emite alerte pentru dosare noi, stadiu/categorie schimbate si intrare/iesire din relevanta.",
        ],
      },
      {
        title: "Post-review hardening",
        content: "Race-urile semnalate in review au fost inchise local, fara schimbare de arhitectura.",
        bullets: [
          "createList muta duplicate-check-ul in tranzactie BEGIN IMMEDIATE.",
          "archiveList face blocking-jobs check si update-ul archived_at atomic.",
          "xlsx@0.18.5 ramane risc acceptat temporar, mitigat prin limite stricte si documentat pentru migrare ulterioara.",
        ],
      },
      {
        title: "Validare",
        content:
          "Backend 416/416 teste, build productie trecut, CI docker-build verde, smoke Electron desktop si Excel open pentru template XLSX.",
      },
    ],
  },
  {
    version: "v2.3.0",
    date: "29 Aprilie 2026",
    subtitle: "Audit remediation — Patch v2.3.0 + UX export",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-violet-500",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
    sections: [
      {
        title: "Hardening reliability — backup, shutdown, finalize",
        content:
          "Audit-ul intern din 29 aprilie a generat un set de patch-uri convergente catre robustete operationala in modul desktop si pregatire pentru cutover web. Niciuna dintre schimbari nu cere migrare manuala — la prima pornire dupa update, baza de date se aliniaza singura.",
        bullets: [
          "Backup zilnic recurent — pana acum singurul backup automat era cel de la pornirea aplicatiei. Acum un setInterval la 24h declanseaza backup-ul si pe sesiuni lungi de tinut deschis (firme care nu inchid Electron-ul peste noapte).",
          "Restore SQLite — pe restore, un PRAGMA integrity_check valideaza fisierul inainte sa-l promoveze; sidecar-urile WAL/SHM sunt sterse cu detection a erorilor non-ENOENT (nu mai trec in tacere peste un disk full).",
          "Graceful shutdown — la SIGTERM/SIGINT, serverul HTTP face drain explicit cu timeout 30s inainte de oprirea scheduler-ului si inchiderea DB-ului. Nu mai pierde request-uri in curs daca Electron e inchis cu Quit.",
          'Finalize state-guarded + index unic — un singur run "running" simultan per job de monitoring, garantat la nivel de DB (idx_one_running_per_job, migration 0005). Daca scheduler-ul ar reseta in timpul unei executii, recovery-ul nu mai poate produce duplicate.',
        ],
      },
      {
        title: "RNPM in maintenance lock + audit complet",
        content:
          "Loop-ul de persistenta din executeSearch (write-urile in DB ale rezultatelor RNPM) ruleaza acum sub withMaintenanceRead — la fel ca runner-ul SOAP de dosare. Inseamna ca un backup care intra in maintenance mode nu mai blocheaza scrierile la jumatate.",
        bullets: [
          "Write-urile DB intra in lock; fetch-ul HTTP catre rnpm.ro NU — nu prelungim lock-ul cu latenta de retea.",
          "Toate cele 3 rute destructive RNPM au audit (POST /saved/delete-batch, DELETE /saved/:id, DELETE /searches/:id) — nicio stergere fara urma.",
          "Cross-tenant searchId — executeSearch verifica searchRepository.belongsToOwner inainte de a accepta existingSearchId, prevenind reutilizarea cross-user a unui search vechi.",
        ],
      },
      {
        title: "Migration runner — self-heal bidirectional pe line endings",
        content:
          "Runner-ul de migrari calculeaza acum hash-ul SQL normalizat (CRLF→LF + BOM scos) ca sa fie stabil intre Windows si Linux. Self-heal-ul match in ambele directii: DB-uri vechi care au stocat hash-ul pe bytes raw (CRLF inclus) si DB-uri stocate pe varianta CRLF cand fisierul curent e LF. Drift real (continut SQL chiar diferit) arunca in continuare. Plus .gitattributes forteaza eol=lf pe fisierele de migrare.",
        bullets: [
          "Boot-uri pe Windows nu mai esueaza cu hash mismatch dupa un git checkout cu autocrlf activ — indiferent de directia conversiei.",
          "Observability: result.selfHealed[] expune versiunile auto-vindecate; schema.ts loggeaza fiecare boot cu remediere.",
          "MIGRATIONS_STRICT=1 dezactiveaza self-heal in CI — orice mismatch arunca, util pentru a prinde drift accidental inainte de release.",
        ],
      },
      {
        title: "Export — Web Worker pentru toate fluxurile (RNPM + AI + Manual)",
        content:
          "Generarea XLSX si PDF s-a mutat integral in Web Worker — RNPM avize, Dosare/Termene, panoul de analiza AI si Manualul aplicatiei. Pe sute/mii de avize, UI-ul nu mai ingheata; main thread-ul ramane disponibil pentru rendering. Butoanele afiseaza spinner imediat la apasare (in locul iconitei Download), feedback vizual instant ca fisierul se genereaza. Catch-block pe orice esec — daca worker-ul pica, butonul revine la starea initiala in loc sa ramana blocat.",
        bullets: [
          "Build-ul XLSX (cu styling per cell + hyperlink-uri navigabile) si PDF (jsPDF + autotable) e tot pe acelasi cod, doar mutat in worker.",
          "ArrayBuffer transferat zero-copy intre worker si main thread.",
          'Vite worker.format="es" permite code-splitting (xlsx + jspdf chunk-uri lazy), pastrand bundle-ul principal sub 400 KB.',
        ],
      },
      {
        title: "Dependinte — bump-uri de securitate",
        content:
          "Stack-ul de export a primit bump-uri majore. dompurify ≥3.4.1, jspdf ≥4.2.1 (cu jspdf-autotable 5.0.7 compatibil), aliniate cu auditul de securitate intern din aprilie.",
      },
    ],
  },
  {
    version: "v2.2.0",
    date: "29 Aprilie 2026",
    subtitle: "PR-4 — monitoring scheduler + dosar_soap runner + Tier 2-6 hardening",
    icon: <Activity className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Scheduler activ — joburile incep sa se execute automat",
        content:
          'PR-3 a livrat schema + UI-ul de monitorizare; PR-4 aduce inima sistemului: scheduler-ul. Tick la 60 secunde, claim_limit 25 joburi/tick, runner separat per kind — la momentul livrarii, kind-ul "dosar_soap" e implementat (interogheaza PortalJust prin SOAP). Adaugarea unui dosar la monitorizare cu cadenta 10 minute / 1 ora / 6 ore / 24 ore inseamna acum verificari reale, nu doar marcarea jobului.',
        bullets: [
          "Claim atomic via UPDATE...RETURNING cu WHERE next_run_at <= now() — doi scheduleri pe aceeasi DB (rare, dar posibil) nu pick-uiesc acelasi job de doua ori.",
          "Backoff exponential pe esecuri SOAP cu jitter — daca PortalJust e jos, retry-urile nu il bombardeaza din nou la fiecare tick.",
          'Recovery la pornire — runs lasate in starea "running" la oprire brusca sunt finalizate cu status="aborted" la primul boot, fara double-spending.',
          "Kill switch operational — MONITORING_DISABLED_KINDS=dosar_soap,name_soap exclude tipurile listate din claim, fara modificari in DB. Util cand un kind cauzeaza probleme si vrei sa il opresti instant.",
        ],
      },
      {
        title: "Detectie schimbari + alerte deduplicate",
        content:
          'Snapshot-urile sunt salvate cu hash determinist si comparate cu ultimul snapshot "verde". Diff-ul detecteaza adaugari/stergeri/modificari de termene si genereaza alerte in monitoring_alerts cu dedup_key — daca un termen e schimbat de cinci ori la rand, primesti o alerta cumulativa, nu cinci.',
        bullets: [
          "Sedinta key include stadiul (Apel/Fond/Recurs) — schimbarea instantei produce alerta separata, nu o suprascrie tacut.",
          'Backfill snapshot la primul rul al jobului — al doilea run e prima ocazie de comparat, deci nu se trimite alerta "Adaugat" pentru toata starea initiala.',
          "monitoring_runs purjate zilnic la 90 zile (history nu creste indefinit).",
        ],
      },
      {
        title: "Hardening Tier 2-6 — review absorbit pre-merge",
        content:
          "Bundle-ul cu PR-4 a trecut printr-un review intern in 6 tier-uri (Tier 1 = correctness, Tier 2-3 = race conditions, Tier 4 = concurrency, Tier 5-6 = polish + observability). 18 issue-uri trakate au fost rezolvate inainte de merge — printre cele mai relevante: idempotenta pe execute SOAP, CRLF safe in payload-uri, getOwnerId reused peste tot, audit log atomic in tx, observability cu request-id propagation.",
        bullets: [
          "333 teste backend verde (de la 192 in v2.1.0) — 141 noi acopera scheduler claim race, recovery boot, dosar_soap end-to-end cu fixture SOAP, alert dedup, retention cleanup.",
          "Type-check + biome + smoke launch pe Windows verificate inainte de merge.",
        ],
      },
    ],
  },
  {
    version: "v2.1.0",
    date: "27 Aprilie 2026",
    subtitle: "PR-3 — monitorizare automata: schema + API + UI",
    icon: <Activity className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: 'Tab nou "Monitorizare" — adauga dosare urmarite automat',
        content:
          'Noua sectiune din sidebar permite adaugarea unui dosar pentru verificare recurenta. Selectezi cadenta (10 minute, 1 ora, 6 ore sau 24 ore) si dosarul intra in coada. La fel, in pagina Cautare Dosare, in panoul detaliat al fiecarui dosar gasesti acum butonul "Monitorizeaza schimbari" — un click si dosarul e in lista de monitorizare, fara sa duplici cautari.',
        bullets: [
          'Idempotent la double-click: doua click-uri rapide pe acelasi dosar nu creeaza doua joburi — feedback inline iti spune "Adaugat" sau "Deja monitorizat".',
          "Pauza / reia / sterge — fiecare job poate fi pus in pauza temporar fara a-l pierde, sau sters cu confirmare.",
          "Toate joburile sunt scope-uite per user — pregatit pentru modul web (PR-9) cand mai multi utilizatori vor folosi aceeasi instanta.",
        ],
      },
      {
        title: "Schema robusta cu hash determinist + dedup pe alerte",
        content:
          "Migrarea 0003 introduce 4 tabele noi: monitoring_jobs (joburi), monitoring_snapshots (rezultate brute), monitoring_alerts (alerte deduped) si monitoring_runs (audit per executie). Hashing-ul tintei foloseste JSON canonic (chei sortate, fara whitespace) astfel incat acelasi dosar sa produca acelasi hash indiferent de ordinea cimpurilor in payload — previne duplicate logice silentioase.",
        bullets: [
          "Index partial pe (next_run_at) WHERE active=1 — scheduler-ul (PR-4) selecteaza joburile due fara full scan, ramane rapid si la mii de joburi.",
          "Cheia de sedinta include stadiul (Apel/Fond/etc.) — fix critic fata de proiectele noastre anterioare unde aceeasi data + ora pe doua stadii diferite cauzau coliziuni de identificare.",
          "monitoring_alerts are UNIQUE pe (job_id, dedup_key) — un termen schimbat nu te bombardeaza cu alerte la fiecare verificare.",
        ],
      },
      {
        title: "API versionat + audit complet pe mutatii",
        content:
          "Noua suprafata /api/v1/monitoring/jobs are envelope standard {data, error?, requestId}. Fiecare request primeste un request-id (echo-uit pe header si in body) — daca o operatie esueaza, copiezi un singur id si serverul iti arata exact ce s-a intimplat. Toate adaugarile / modificarile / stergerile se inregistreaza in audit_log (introdus in PR-2) — pe desktop e mostly invisible, dar in modul web devine baza pentru un panel admin.",
        bullets: [
          "Cross-user isolation verificata in tests: GET/PATCH/DELETE pe un job al altui user returneaza 404 (nu 403, ca sa nu deconspire existenta).",
          "POST cu client_request_id duplicat → 200 si jobul existent (idempotenta opt-in pentru retry-uri de retea).",
          "Validare Zod stricta pe payload: chei in plus, kind necunoscut, numar de dosar prost formatat → 422 cu detalii care ajung in UI.",
        ],
      },
      {
        title: "Stadiu si ce urmeaza",
        content:
          "Scheduler-ul automat (workerul care chiar interogheaza PortalJust) ramane planificat pentru PR-4. In aceasta versiune poti adauga / sterge / pune in pauza joburi — verificarile efective se vor relua automat cu urmatoarea actualizare. Tot UI-ul si API-ul sunt insa gata. Pe desktop, modulul e activ implicit (MONITORING_ENABLED=1 din electron/main.js); setand MONITORING_ENABLED=0 in mediu, ruta devine inerta — kill switch in caz de problema.",
      },
      {
        title: "Verificare",
        content:
          "192 teste backend verde (de la 99): 93 noi acopera canonical JSON hash, sedinta key cross-cosmetic-drift, Zod schemas (discriminated union, .strict() reject, refine non-empty, institutie sort+dedup), repository idempotency, owner isolation end-to-end, audit writes pe mutatii (verificat tx atomic), request-id propagation, malformed JSON / unknown kind / numar invalid -> 4xx-uri corecte. Type-check + biome + smoke launch trecute. Bonus: post-review hardening (4 valuri remediere) absorbit pre-merge — schema fix strftime ISO Z, cadence default 14400, atomic audit + recompute next_run_at la PATCH, parseSqliteUtc defensive helper.",
      },
    ],
  },
  {
    version: "v2.0.13",
    date: "27 Aprilie 2026",
    subtitle: "PR-2 — fundatie auth (shadow) + audit log",
    icon: <Lock className="h-5 w-5" />,
    borderColor: "border-l-violet-500",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
    sections: [
      {
        title: 'Tabele auth introduse ca "schela" (users / user_sessions)',
        content:
          'Pregatim infrastructura pentru modul web (login Google Workspace, planificat in PR-9) fara sa schimbam comportamentul desktop. Pe instalare locala ramane un singur user sintetic — "local" — la fel ca pana acum.',
        bullets: [
          "Migrare 0002_users_sessions_audit.up.sql ruleaza la primul boot si insereaza un singur rand in users (id='local'). Niciun login, niciun ecran nou.",
          "user_sessions exista pentru viitorul modul web (refresh tokens server-side); pe desktop ramane gol.",
          "PR-9 va popula real users cand pornim varianta server — atunci toate rutele care folosesc owner_id (introdus in PR-1) trec automat la id-ul user-ului autentificat, fara rescriere.",
        ],
      },
      {
        title: "Audit log scriabil — recordAudit()",
        content:
          "Tabela audit_log accepta evenimente pe orice mutatie sensibila (creare/stergere job monitorizare, import lista, request AI). Helperul scrie owner_id, IP, user-agent automat din contextul Hono. Pe desktop e mostly silent — devine vizibil in PR-3+ cand monitorizarea va incepe sa scrie aici.",
        bullets: [
          "Indexuri (owner_id, ts DESC) si (actor_id, ts DESC) pentru read scope-uit per user / per actor (relevant in modul web cand un admin actioneaza pentru alt tenant).",
          "outcome ∈ {ok, denied, error}; detail_json captureaza payload-ul concret cu fallback safe la BigInt sau circular refs.",
        ],
      },
      {
        title: "Verificare",
        content:
          "99 teste backend verde (de la 85): 13 noi pe schema 0002 + recordAudit + getAuditEvents end-to-end prin Hono. Smoke pe DB-ul live: migration-ul ruleaza o singura data, restul DB-ului intact, frontend si rutele existente functioneaza identic.",
      },
    ],
  },
  {
    version: "v2.0.12",
    date: "27 Aprilie 2026",
    subtitle: "PR-1 — getOwnerId helper + 5 fixuri scurgere intre owneri",
    icon: <Shield className="h-5 w-5" />,
    borderColor: "border-l-rose-500",
    badgeClass: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
    sections: [
      {
        title: "Seam pentru viitoarea autentificare web",
        content:
          'Toate rutele citesc acum owner_id-ul curent printr-un singur helper (c.get("ownerId")). Pe desktop e hardcoded "local"; in PR-9 va fi inlocuit cu id-ul user-ului din JWT — zero refactor pe rute, doar implementarea helper-ului se schimba.',
      },
      {
        title: "Inchidere a 5 cai latente prin care un user ar fi putut vedea date altui user",
        content:
          "loadAvizChildren (creditori / debitori / bunuri / istoric) cerea copiii doar dupa aviz_id, fara constraint pe owner_id. Daca s-ar fi produs vreodata un FK breach (bug de migrare, restore partial), randul user-ului B ar fi ajuns la user-ul A. Toate cele 4 query-uri cer acum AND owner_id = ? si pasa explicit aviz.owner_id. Sub-clauzele EXISTS din getAvize sunt si ele filtrate pe owner_id.",
      },
      {
        title: "Test de regresie pentru izolare",
        content:
          'Suite-ul nou repository-isolation.test.ts forjeaza copii cu owner_id mismatch (raw INSERT) si verifica ca nicio metoda din avizRepository nu-i returneaza. 8 teste noi → 85 in total. Pe desktop comportamentul e identic — singurul owner_id activ ramane "local".',
      },
    ],
  },
  {
    version: "v2.0.11",
    date: "27 Aprilie 2026",
    subtitle: "PR-0 — framework de migrari versionate",
    icon: <Layers className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "_schema_versions + runner ordonat",
        content:
          "De acum incolo orice modificare de schema (tabel nou, coloana noua, index nou) e versionata intr-un fisier 0001_*.up.sql, 0002_*.up.sql, ... cu hash sha256 stocat in DB. La boot, runner-ul aplica doar fisierele neinregistrate, ordonat numeric, in tranzactii separate. Drift detection: daca un fisier deja aplicat e modificat dupa, boot-ul se opreste cu eroare clara.",
      },
      {
        title: "Backfill pentru DB-uri legacy (v2.0.10 si mai vechi)",
        content:
          "La prima rulare pe o instalare existenta, runner-ul detecteaza ca DB-ul are deja schema rnpm_* si insereaza o intrare sentinel (1, '__backfilled_v1__') in loc sa execute baseline-ul (ar fi crapat pe CREATE TABLE duplicat). Path-ul vechi de ALTER idempotent ramane intact — zero schimbari functionale pentru utilizator.",
      },
      {
        title: "Verificare",
        content:
          "77 teste backend verde (de la 62): 15 noi pe runner (fresh DB, idempotency, gap detection, drift, downgrade guard). Smoke pe DB-ul live (~189 avize, 104 MB): boot 1 backfill sentinel + boot 2 silent — zero data loss.",
      },
    ],
  },
  {
    version: "v2.0.10",
    date: "26 Aprilie 2026",
    subtitle: "Hardening — AI logging extension + backup maintenance lock + safeStorage trim",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
    sections: [
      {
        title: "Observability AI extinsa — httpStatus + token usage + isTimeoutOrAbort",
        content:
          "Log-ul JSON ai_call captureaza acum metadata fina pe fiecare apel catre Claude / GPT / Gemini. Permite cost tracking real (token counts) si rata de erori split pe HTTP status.",
        bullets: [
          'Helper isTimeoutOrAbort(e) detecteaza timeout/abort inclusiv pe subclase SDK (Anthropic / OpenAI APIUserAbortError / APIConnectionTimeoutError) care nu seteaza e.name = TimeoutError. Inainte branch-ul errorType: "timeout" era practic dead pentru aceste cazuri.',
          "withAiLogging primeste { value, meta } din provider-ul interior; usageInput / usageOutput populate din message.usage (Anthropic), response.usage (OpenAI), result.response.usageMetadata (Google).",
          "Pe path-ul de eroare, e.status (cand exista — APIError SDK) e capturat ca httpStatus, ca dashboard-urile sa poata splita 4xx/5xx vs network/abort.",
        ],
      },
      {
        title: "Backup/restore — maintenance lock + WAL truncate pre-snapshot",
        content:
          "Doua hardening-uri pe path-ul de backup/restore: serializarea operatiilor de mentenanta si captura corecta a frame-urilor WAL inainte de close.",
        bullets: [
          "withMaintenanceLock (promise chain in-process) serializeaza restoreFromBackup cu runDailyBackup. Pe desktop fara concurenta in practica, dar scheduler-ul putea teoretic interleave-ui cu un restore care inchide DB-ul mid-db.backup() -> destinatie corupta. Web-mode va inlocui cu row-lock.",
          "Pre-restore snapshot face PRAGMA wal_checkpoint(TRUNCATE) inainte de closeDb(). Fara checkpoint, snapshot-ul prindea doar fisierul .db si pierdea frame-urile WAL necommitate -> rollback silent incomplete.",
          'logBackupEvent (single-line JSON, ts auto) inlocuieste console.log ad-hoc; daily_backup_failed distinge stage: "mkdir" vs "backup"; sterge sidecar -wal/-shm cu logging non-ENOENT (EBUSY de la AV pe Windows nu mai e silentios).',
        ],
      },
      {
        title: "Frontend safeStorage — defensive trim in setKeys",
        content:
          "Inchide o gap subtila pe path-ul de migrare legacy: deobfuscate putea propaga whitespace din intrari vechi localStorage in safeStorage encrypted, iar cererile cu whitespace in cheia API esueaza cu 401.",
        bullets: [
          "useApiKey.setKeys() aplica acum .trim() pe fiecare cheie inainte de persist; setKey individual deja trima. Fixul aliniaza path-ul bulk cu cel single.",
        ],
      },
      {
        title: "RNPM gcode caching — investigatie inchisa (negativa)",
        content:
          "Test empiric: RNPM respinge reuse-ul gcode-ului intre cautari cu parametri diferiti. Captcha-per-query ramane cost intrinsec la API-level.",
        bullets: [
          'Spike in RnpmSearch.tsx care threading existingGcode din runSearch precedent a generat in backend phase: "search_retry" (gap 16.4s, captcha re-solve), nu phase: "search" direct.',
          "Pagination intra-search (loadNextBatch) reuseaza gcode-ul corect; path-ul existent ramane valid.",
          "Mitigari posibile pe viitor: provider mai rapid (CapSolver vs 2Captcha - deja setting), race mode (deja suportat), pre-warm captcha speculativ (necesita API discovery).",
        ],
      },
      {
        title: "Verificare",
        content:
          "Backend typecheck curat, 62/62 teste backend verde (include teste noi pe withMaintenanceLock + WAL checkpoint si pe isTimeoutOrAbort), frontend typecheck curat.",
      },
    ],
  },
  {
    version: "v2.0.9",
    date: "26 Aprilie 2026",
    subtitle: "Faza 10 medium close-out — restore correctness, AI logging, Docker CI",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Restore correctness — async path + WAL/SHM ordering",
        content:
          "Inchidere finala a Faza 10 medium-priority pe restoreFromBackup. Functia ramane integral asincrona si elimina o fereastra de race in care DB-ul nou putea fi pereche cu sidecar-uri stale.",
        bullets: [
          "fs.existsSync inlocuit cu await fsPromises.access(dbPath) + flag dbExists. Event loop-ul nu mai blocheaza pe stat-uri lente (de ex. fisier scanat de antivirus).",
          "unlink(-wal) si unlink(-shm) ruleaza inainte de rename(tmpPath, dbPath). Inainte exista o fereastra in care better-sqlite3 putea face lazy open peste combinatia DB nou + sidecar-uri vechi (silent corruption la primul query).",
        ],
      },
      {
        title: "Observability — log structurat pentru apelurile AI",
        content:
          "Apelurile catre Claude / GPT / Gemini emit acum un singur rand JSON cu provider, model, latenta si status. Util pentru ops, cost tracking grosier si debugging la spike-uri sau timeout-uri.",
        bullets: [
          'Helper withAiLogging imbraca callAnthropic / callOpenAI / callGoogle si emite { action: "ai_call", provider, model, latencyMs, status, errorType?, ts }.',
          'TimeoutError si AbortError sunt normalizate la errorType: "timeout" ca log scrapers sa nu trebuiasca sa special-case-uieze ambele.',
          "Tabela audit_log persistenta ramane scope Faza 5 (compliance).",
        ],
      },
      {
        title: "Docker CI smoke test",
        content:
          "Imaginea Docker e validata acum la fiecare push pe main si la fiecare PR care atinge Dockerfile / lockfile / backend / frontend. Regresiile in build-ul Alpine/musl al modulului nativ sunt prinse inainte de release.",
        bullets: [
          ".github/workflows/docker-build.yml ruleaza docker build + smoke test node + smoke test /health (poll 60s).",
          "Containerul primeste HOST=0.0.0.0 + LEGAL_DASHBOARD_ALLOW_REMOTE=1 ca portul 3002 sa fie reachable din host (loopback-ul containerului e izolat).",
          "Esuarea oricarui pas dump-eaza docker logs pentru triage direct din run-ul GitHub Actions.",
        ],
      },
      {
        title: "Verificare",
        content:
          "Backend typecheck curat, 55/55 teste backend verde, frontend typecheck curat, GitHub Actions Docker Build run 24955410182 verde in 2m20s cu /health 200 OK in containerul produs.",
      },
    ],
  },
  {
    version: "v2.0.8",
    date: "26 Aprilie 2026",
    subtitle: "Hardening + release packaging — Docker, ZIP server, backup atomicity",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Backend hardening — backup, restore, env si SOAP cancel",
        content:
          "Dupa tag-ul v2.0.7 am inchis fixurile high-priority din Faza 10 si packaging-ul minim de release. v2.0.8 nu schimba workflow-ul UI al aplicatiei; intareste backup-ul, anularea SOAP si livrarea Docker/ZIP.",
        bullets: [
          "backend/.env.example nu mai include NODE_ENV=development; dev mode se activeaza explicit din shell, nu prin template-ul copiat in deploy.",
          "cautareDosare accepta { signal } si combina signal-ul extern cu timeout-ul SOAP intern, astfel incat disconnect-ul clientului anuleaza fetch-ul in zbor.",
          "Backup-ul zilnic scrie intai in .db.tmp si face rename atomic; orphan tmp-urile Legal Dashboard sunt curatate la urmatorul run.",
          "restoreFromBackup emite log JSON structurat cu action/source/preRestore/ts pentru audit operational.",
        ],
      },
      {
        title: "Teste backup atomicity",
        content:
          "Coverage-ul backend pentru backup a fost extins ca protectie de regresie pentru backup atomic si retention pools.",
        bullets: [
          "backup.test.ts verifica stergerea orphan legal-dashboard.*.db.tmp si pastreaza tmp-urile care nu apartin aplicatiei.",
          "listBackupsWithMeta expune doar backup-uri finalizate .db, nu fisiere de staging .db.tmp.",
          "Retention-ul este verificat separat pentru daily / pre-restore / pre-migration pools (7/5/5), prevenind starvation reciproca.",
        ],
      },
      {
        title: "Release packaging — Docker si ZIP server",
        content:
          "Pachetele de server sunt mai reproductibile si mai sigure pentru deploy: Docker foloseste lockfile, iar ZIP-ul bare-metal instaleaza runtime deps pe platforma tinta.",
        bullets: [
          "Dockerfile foloseste package-lock.json + npm ci --workspace=backend --omit=dev --build-from-source, in loc de npm install fara lockfile.",
          "Dockerfile si docker-compose au start-period/start_period=120s pe healthcheck pentru boot-uri lente cu prewarm/migrari DB.",
          "dist:server include package-lock.json si manifestele workspace; start.sh/start.bat instaleaza deps la prima pornire daca lipseste better-sqlite3.",
          "Script nou npm run rebuild:electron pentru alternanta Node ABI ↔ Electron ABI a modulului nativ better-sqlite3.",
        ],
      },
      {
        title: "Verificare",
        content:
          "Backend typecheck curat, 55/55 teste backend verde, build complet si dist:server generate cu succes. Electron a fost reconstruit pentru ABI-ul sau si repornit cu /health 200.",
      },
    ],
  },
  {
    version: "v2.0.7",
    date: "26 Aprilie 2026",
    subtitle: "RNPM tab-state UX fix — rezultate si categorie pastrate corect",
    icon: <MousePointerClick className="h-5 w-5" />,
    borderColor: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    sections: [
      {
        title: "RNPM — rezultate scoped pe categoria de cautare",
        content:
          "Rezultatele unei cautari RNPM nu mai raman vizibile cand utilizatorul schimba categoria interna a formularului (ex. din Aviz de ipoteca mobiliara in Fiducie / Aviz specific). Tabelul, erorile si actiunile de incarcare sunt afisate doar pentru categoria in care rezultatul a fost obtinut.",
        bullets: [
          "RnpmSearchForm notifica pagina parinte cand categoria activa se schimba.",
          "RnpmSearch.tsx calculeaza visibleResult / visibleError pe baza perechii activeSearchType === lastType.",
          "Butoanele Incarca tot / Opreste incarcarea si progress bar-ul folosesc rezultatul vizibil, nu state-ul global vechi.",
        ],
      },
      {
        title: "RNPM — revenire corecta intre Cautare / Bulk / Baza locala",
        content:
          "Cand utilizatorul pleaca din tabul principal Cautare catre Bulk sau Baza locala si revine, formularul RNPM ramane pe categoria dintre cele 5 unde era inainte. Nu mai revine implicit pe primul tab si nu mai ascunde rezultatul cautarii anterioare.",
        bullets: [
          "Sectiunea Cautare ramane montata si este doar ascunsa prin clasa hidden, la fel ca Baza locala.",
          "State-ul intern al formularului (categoria activa, campurile completate, rezultat vizibil) supravietuieste navigarii intre cele 3 taburi principale.",
          "RnpmSearchForm sincronizeaza categoria activa cu pagina parinte la mount si la fiecare schimbare de categorie.",
        ],
      },
      {
        title: "Verificare",
        content:
          "Build complet rulat dupa schimbare: frontend TypeScript + Vite si bundle-ul Electron/backend au trecut. Aplicatia Electron a fost repornita, /health raspunde ok, iar endpoint-ul /api/rnpm/saved raspunde cu date.",
      },
    ],
  },
  {
    version: "v2.0.6",
    date: "19 Aprilie 2026",
    subtitle: "SOAP XML entity decoding + consolidare CodeRabbit findings in HARDENING Faza 7",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "SOAP parser — decodare entitati XML (correctness user-facing)",
        content:
          "Numele partilor si campurile text venite de la PortalJust (ex. 'S.C. X & Co. SRL' sau nume cu apostrof) aparea cu literal &amp; / &apos; in tabele, modal detalii, export XLSX si promptul AI. Cauza: parser-ul regex din backend/src/soap.ts nu decoda entitatile XML. DOMPurify neutraliza orice risc de injectie, deci nu a fost vulnerabilitate — doar output vizibil gresit. Fix aplicat la leaf fields in parseDosar (nu la extractFirst/extractAll — evita tag-uri fantoma in XML nested).",
        bullets: [
          "Helper nou decodeXmlEntities(s) — ordine: numeric hex → numeric zecimal → named (lt/gt/quot/apos) → amp LAST (sa nu dublu-decodeze &amp;lt;)",
          "Campuri decodate: obiect, institutie, departament, categorieCaz, stadiuProcesual, parti[].nume, parti[].calitateParte, sedinte[].solutie/solutieSumar/complet/documentSedinta",
          "Campuri ne-atinse (format strict): numar, data, ora, numarDocument, dataPronuntare — nu contin entitati prin natura datelor",
          "5 teste noi (4 unit + 1 integration parseDosar): total 24 → 29 verde",
        ],
      },
      {
        title: "HARDENING — Faza 7: consolidare CodeRabbit findings 19.04.2026",
        content:
          "Auditul CodeRabbit a scos 4 Critical + 7 Important. Fiecare verificat manual vs cod (fisier:linie concrete), sintetizat in HARDENING.md Faza 7 ca punch-list actionabil. Un finding (I1, dublu validateAiBody in ai.ts) verificat direct si respins ca false positive — un singur apel exista la L106, liniile precedente sunt existence guards. Fisierul intermediar CODERABBIT-FINDINGS-2026-04-19.md eliminat; context-ul ramane self-contained in Faza 7.",
        bullets: [
          "Blockers web-deploy (~3h, inainte de ALLOW_REMOTE sau Docker push): C1 SOAP fanout cap pe GET /api/dosare+termene · C2 rate-limit fail-closed pe IP irezolvabil · C3 Dockerfile non-root + no .env baked · C4 docker-compose loopback bind + port-fix · I2 CORS gate pe NODE_ENV",
          "Pre-monitorizare Watched Dosare (~4h): I4 splash pre-VACUUM · I5 enum validation pe searchType · I6 rateLimitMap cleanup pe interval unref · I7 any → unknown + narrowing in ai.ts",
          "Suggestions opportunistic (~2h): json:any in api.ts, README GPU flag, log orphan solve-id captcha, comentariu User-Agent RNPM, pinning test validateParamsDepth, debounce cleanupOrphanDescrieri",
          "Done azi (I3): decodeXmlEntities — detaliat in sectiunea de mai sus",
        ],
      },
      {
        title: "De ce aceasta versiune acum",
        content:
          "Doua borne apropiate: tranzitia web (cand ridicam LEGAL_DASHBOARD_ALLOW_REMOTE sau distribuim Docker image) si modulul Watched Dosare cu auto-sync (Pilon B din roadmap). Ambele reuseaza exact codul atins de findings — e mai ieftin sa ai punch-list-ul scris inainte de implementare decat sa-l inventezi la momentul critic.",
      },
    ],
  },
  {
    version: "v2.0.5",
    date: "19 Aprilie 2026",
    subtitle: "Backend god-file split + audit remediation + RNPM UX + dark bar nativ",
    icon: <Rocket className="h-5 w-5" />,
    borderColor: "border-l-violet-500",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
    sections: [
      {
        title: "Backend — ultimul god-file spart (index.ts 1214 → 133 linii)",
        content:
          "Audit-ul intern a identificat backend/src/index.ts ca ultimul fisier monolitic mare din proiect (bootstrap + middleware + rate limiting + SOAP + AI + static serving + lifecycle). Sesiunea P3 a splitat totul in module cu responsabilitate unica, pastrand comportamentul observabil identic.",
        bullets: [
          "routes/dosare.ts (204 linii) — SOAP PortalJust search endpoints",
          "routes/termene.ts (236 linii) — termene by instanta + istoric",
          "routes/ai.ts (182 linii) — multi-provider AI proxy (Claude / OpenAI / Gemini)",
          "services/ai.ts (219 linii) — provider clients + cost calculators",
          "services/batch-dosare.ts (186 linii) — batch analysis orchestration cu AbortSignal",
          "middleware/rate-limit.ts (40 linii) — real-IP rate limiter extras din index",
          "middleware/static-frontend.ts (64 linii) — static serving cu path-traversal guard intact",
          "util/validation.ts — validare shared request payloads",
          "index.ts ramane doar bootstrap: CSP, CORS, mount routers, loopback-guard, prewarm, shutdown",
        ],
      },
      {
        title: "Audit remediation — raport intern + findings inchise",
        content:
          "Review tehnic complet (legal-dashboard-review-report.md) cu scope pe code quality + security + componente. Parte din problemele raportate anterior au fost deja rezolvate si confirmate explicit in audit ca inchise; cele active raman documentate pentru faze ulterioare.",
        bullets: [
          "[INCHIS] Static path traversal — middleware/static-frontend.ts foloseste path.relative + decodeURIComponent defensiv",
          "[INCHIS] Logging RNPM sensibil — rnpmSearchService logheaza doar type/page/field-names, nu valori PII",
          "[INCHIS] TermeneTable selection drift — chei stabile de selectie + dedup in loadMore cu aceeasi semantica",
          "[INCHIS] God-files DosareTable / RnpmSearchForm / backend index — toate splitate (DosareTable + RnpmSearchForm in v2.0.4, backend in v2.0.5)",
          "[ACTIV P1] useApiKey fallback localStorage pentru web mode — ramane de rezolvat inainte de tranzitia la web (elimina fallback-ul, AI doar cu chei server-side)",
          "[ACTIV P1] Dependente vulnerabile — dompurify / jspdf / xlsx trebuie upgrade (faza de dependency hardening)",
          "[ACTIV P2] Modal standardization — useDialog nu e folosit uniform; plan: DialogShell comun pentru toate modalurile",
          "[ACTIV P3] Hono stack — hono + @hono/node-server raman in urma fata de advisories curente",
        ],
      },
      {
        title: "Changelog — export PDF",
        content:
          'Butonul nou „Export PDF" din pagina Changelog genereaza un document portrait A4 cu tot istoricul (versiune + data + subtitlu + sectiuni + bulleturi) pentru cine vrea sa-l citeasca in afara aplicatiei.',
        bullets: [
          "frontend/src/lib/changelog-pdf.ts — jsPDF dynamic import, auto page-break, page numbering, strip diacritics pentru compatibilitate Helvetica",
          'Button dedicat in Changelog.tsx (Download icon) cu stare „Se genereaza..." pe durata randarii',
          "Fisier salvat ca legal-dashboard-changelog-v<VERSION>.pdf — VERSION injectat din __APP_VERSION__ (single source of truth din root package.json)",
        ],
      },
      {
        title: "Electron — title bar + menu bar nativ urmeaza tema app-ului",
        content:
          "In dark mode, bara nativa Windows ramanea light (title bar + menu bar Fisier/Editare/Vizualizare/...). Fix prin sync explicit catre nativeTheme pe fiecare toggle.",
        bullets: [
          "main.js — import nativeTheme + ipcMain.handle(\"window:setTheme\") care seteaza nativeTheme.themeSource in 'dark' | 'light' | 'system'",
          "preload.js — expune window.desktopApi.setWindowTheme(theme) via contextBridge (suprafata IPC ramane minima + tipata)",
          "useTheme hook — apeleaza setWindowTheme in useEffect-ul existent, fire-and-forget; pe web (fara desktopApi) noop",
          "Windows 11 aplica tema dark pe title bar + controlele din meniul nativ; flicker minim la boot inainte de prima IPC din renderer",
        ],
      },
      {
        title: 'RNPM — auto-loop „Incarca tot" (pe modelul cautarii de dosare)',
        content:
          'Butonul „Incarca mai multe" devenea tedios pentru cautari cu sute/mii de rezultate. Inlocuit cu buton unic „Incarca tot" care face auto-loop pe batch-uri de 25 pana cand utilizatorul opreste sau se termina paginile RNPM.',
        bullets: [
          "useEffect re-declanseaza loadNextBatch() dupa fiecare batch completat, pana cand nextRnpmPage devine null",
          'Buton single (Start / Opreste incarcarea) cu contor „X din TOTAL" in text — paritate vizuala cu cautarea de dosare',
          "Bara de progres albastra langa buton — se umple procentual pe masura ce documents.length / total creste",
          "Stop duplicat suprimat in timpul auto-load-ului (prop nou suppressStop pe RnpmSearchForm) — o singura sursa de adevar pentru oprire",
          "Datele deja aduse raman accesibile in tabel in timpul auto-load-ului (scroll, filtru, click detaliu functioneaza neintrerupt)",
        ],
      },
      {
        title: "RNPM Detalii — tab Bunuri: lag eliminat pentru avize cu 1000+ items",
        content:
          "Modal-ul de detalii bloca ~800ms la primul click pe tabul Bunuri cand avizul avea mii de bunuri (test real: 1730). Fix cu 3 linii CSS, fara virtualization.",
        bullets: [
          'style={{ contentVisibility: "auto", containIntrinsicSize: "auto 150px" }} pe fiecare card bun',
          "Chromium decide singur ce iese din viewport si skip-uieste rendering-ul — click-to-render din ~800ms → imperceptibil",
          "Zero dependente noi — regula confirmata ca default-ul pentru liste mari viitoare in renderer (preferat fata de virtualization libs)",
        ],
      },
      {
        title: "Sterge baza — acum elibereaza efectiv spatiul pe disc",
        content:
          'Dupa „Sterge baza" contoarele aratau 0 avize dar fisierul ramanea la ~112 MB. SQLite DELETE marcheaza doar pagini libere intern — nu returneaza spatiul pe disc fara VACUUM. Acum endpoint-ul ruleaza compact dupa stergere.',
        bullets: [
          "DELETE /api/rnpm/saved/all apeleaza compactDb() dupa deleteAllAvize — VACUUM + PRAGMA wal_checkpoint(TRUNCATE)",
          "Fisierul .db revine la dimensiunea schemei dupa click; panoul Info baza locala reflecta corect eliberarea",
          "Best-effort: esecul VACUUM logheaza warning, stergerea randurilor nu e blocata",
        ],
      },
      {
        title: "Observabilitate — HTTP 499 pentru user-abort pe RNPM search",
        content:
          "Abortul clientului (buton Stop / Opreste incarcarea) rezulta anterior in log 500 pe backend — indistinct de erorile reale. Schimbat la 499 (Client Closed Request, conventia nginx) pentru triage curat.",
        bullets: [
          'console.log „[rnpm/search] aborted by client" ramane pentru observabilitate',
          "UI-ul nu vede 499: fetch-ul este aruncat cu AbortError inainte de primirea raspunsului (suprimat via ctl.signal.aborted)",
          "Statisticile 500 devin curate — reflecta doar esec real (captcha, upstream down, parse fail)",
        ],
      },
      {
        title: "Verificare",
        content:
          'npx tsc --noEmit — clean pe ambele workspace-uri. Verificare manuala in Electron: auto-load pe cautari cu 200+ rezultate (Stop la mijloc + reluare), „Sterge baza" cu observare dimensiune fisier .db inainte/dupa, abort in mijlocul batch-ului (backend scrie 499 in logs, UI ramane curat).',
      },
    ],
  },
  {
    version: "v2.0.4",
    date: "19 Aprilie 2026",
    subtitle: "Refactor structural major + polish formular RNPM",
    icon: <Wrench className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Splituri de componente (pre-conditie web transition + testabilitate)",
        content:
          "Componentele care crescusera peste 500-800 linii prin acumulare au fost sparte in parti dedicate cu responsabilitate unica. Comportament observabil neschimbat (verificat in browser), dar review si testare locala devin posibile. Pregatire pentru rescrieri incrementale viitoare.",
        bullets: [
          "DosareTable (1063 → ~450 linii): extrase dosare-ai-config.ts (AI_MODELS, JUDGE_MODELS_LIST, PROVIDER_LABELS, model cost), dosare-table-highlight.tsx (highlight helpers AI output), dosare-table-helpers.ts (utilitare generice), dosare-ai-analysis-panel.tsx (panou single + multi-agent cu DOMPurify). Paginarea reutilizeaza table-pagination.tsx",
          "RnpmSearchForm (863 → ~590 linii): extrase rnpm-form-constants.ts (CATEGORIES, TIP_AVIZ_BY_CATEGORY, DESTINATIE_IPOTECI/INSCRIERII, BUN_ALT_TIP_CATEGORII), rnpm-form-hooks.ts (useText, useSiSauField, usePJField, usePFField), rnpm-form-fields.tsx (SiSauToggle, PJPFToggle, PJBlock, PFBlock, PartyFieldset, VehiculFieldset, DestinatieSelect, CollapsibleFieldset)",
          "Sidebar: extrase sidebar-footer.tsx + sidebar-history-entry.tsx",
          "MetricsPanel: sub-componentele de rendering in metrics-panel-parts.tsx",
          "Dashboard: dashboard-modals.tsx + dashboard-summary-cards.tsx",
          "Manual: continutul (mii de linii text) in manual-content.tsx; pagina pastreaza doar orchestrarea",
          "Changelog: toate version entries mutate in data/changelog-entries.tsx; pagina ramane pur render layer",
          "TermeneTable: row-ul extins in termene-table-detail-row.tsx",
        ],
      },
      {
        title: "RNPM — formular search polish (paritate cu site + reducere clutter)",
        content:
          "Ajustari pe formularul de cautare RNPM pentru paritate cu site-ul oficial si pentru a reduce scroll-ul initial:",
        bullets: [
          "Creditor PF primeste camp Prenume (exista deja la Debitor PF; paritate completa cu formularul RNPM)",
          "PFBlock rearanjat cu grid 1fr_1fr_auto: rand 1 = Nume + Prenume + toggle SI/SAU, rand 2 = CNP (full width col 1) + toggle SI/SAU sub primul. Toggle-urile SI/SAU stivuite vertical la dreapta — CNP vizibil pe toate 13 cifre, aestetica aliniata",
          "Vehicul (bun garantat) si Bun (alt tip) & Tert cedat devin zone colapsabile (nou CollapsibleFieldset cu chevron + defaultOpen=false) — formularul initial are scroll redus, campurile raman accesibile la un click",
          "Legend alignment fix: in fieldset-uri imbricate folosim ml-* pe <legend> in loc de pl-* — pl-* lasa un stub de border vizibil la stanga (aparent discontinuu), ml-* muta legend-ul intreg si border-ul ramane continuu pana la text",
        ],
      },
      {
        title: "RNPM — bulk stats refresh imediat",
        content:
          "RnpmBulkSearch primeste prop onItemSaved?: () => void, invocat la fiecare item cu phase='done' + resultCount>0. Parent-ul RnpmSearch.tsx incrementeaza savedRefreshKey → RnpmSavedStats re-fetch-uieste contoarele. Inainte, contoarele nu se actualizau decat dupa delete manual sau restart tab.",
      },
      {
        title: "Adaugiri",
        content:
          "RnpmRestoreModal.tsx — modal dedicat pentru restore backup DB (listing + confirm destructiv); a absorbit logica care era inlinata in RnpmSavedStats.",
      },
      {
        title: "Verificare",
        content:
          "npx tsc --noEmit — clean pe ambele workspace-uri. Manual in Electron: toate categoriile RNPM (ipoteci / fiducii / specifice / creante / obligatiuni), toggle PJ/PF, toggle SI/SAU, submit + stop + reset, alignment zone colapsabile.",
      },
    ],
  },
  {
    version: "v2.0.3",
    date: "18 Aprilie 2026",
    subtitle: "Performanta RNPM + backup zilnic + restore + dashboard persistent + rafinari UI",
    icon: <Sparkles className="h-5 w-5" />,
    borderColor: "border-l-sky-500",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
    sections: [
      {
        title: "Mini-lag eliminat la intrarea pe tab + deschiderea avizelor",
        content:
          "Sesiune dedicata fluiditatii UI. Diagnosticul a aratat ca problema nu era viteza query-urilor, ci (a) componenta se demonta la tab switch si (b) fiecare click pe aviz facea round-trip + 5 query-uri repository. Trei interventii complementare:",
        bullets: [
          "RnpmSavedData ramane montata la tab switch (conditional render inlocuit cu class='hidden') — tab-ul Baza locala redevine instant, fara re-fetch, cu filtrele + pagina + scroll-ul pastrate",
          "Cache in-memory pentru detaliul avizului (avizDetailCache, TTL 60s) — re-deschiderea aceluiasi aviz e instant; cache invalidat automat la delete (single / batch / all)",
          "Prewarm SQLite page cache la bootstrap backend (getAvize({limit:1}) + getAvizStats() dupa serve) — prima interactiune nu mai plateste cold-start pe disc",
        ],
      },
      {
        title: "Backup zilnic automat al bazei locale",
        content:
          "Cu mii de avize persistate, pierderea fisierului .db e costisitoare. Aplicatia genereaza acum backup automat la pornire, cu rotatie:",
        bullets: [
          "Foloseste better-sqlite3 online backup API (db.backup) — sigur cu WAL, fara checkpoint sau exclusive lock",
          "Nume standard: legal-dashboard.YYYY-MM-DD.db in <userData>/backups/",
          "Skip daca ultimul backup e sub 24h vechime; rotatie automata la 7 fisiere (sortare lexicografica = cronologica)",
          "Best-effort — orice esec logheaza warning si lasa app-ul sa porneasca normal",
        ],
      },
      {
        title: "Dialog de confirmare stilizat (inlocuieste pop-up-urile native Chromium)",
        content:
          "Ferestrele window.confirm() native aratau strain fata de restul UI-ului. Aplicatia are acum un dialog unificat, consistent cu celelalte modale:",
        bullets: [
          "Componenta ConfirmProvider + hook useConfirm() (Promise-based) in frontend/src/components/ui/confirm-dialog.tsx",
          "Icon AlertTriangle + buton rosu pentru actiuni destructive; keyboard Escape=cancel, Enter=confirm; click-outside cancel; auto-focus pe confirm",
          "4 call-site-uri migrate: sterge aviz individual, batch delete, sterge toate avizele, warning CUI invalid",
        ],
      },
      {
        title: "Info baza locala — management backups si relabel butoane",
        content: "Zona de actiuni din modalul 'Info baza locala' reorganizata:",
        bullets: [
          "Buton nou Backups (icon Archive) — deschide <userData>/backups/ in File Explorer",
          "Buton nou Sterge back-up (rosu) — sterge toate fisierele de backup; urmatorul se genereaza la urmatoarea pornire a app-ului",
          "Relabel: 'Deschide folder' → 'Folder baza', 'Sterge tot' → 'Sterge baza' (pentru claritate)",
          "Sterge back-up + Sterge baza grupate impreuna spre dreapta; toate confirmarile trec prin noul dialog stilizat",
        ],
      },
      {
        title: "Fix UI conex — DosareTable timeline sedinte",
        content:
          "Efect secundar al font-scale bump din sesiunea anterioara: data '19.01.2026' era taiata, iar cercul-marker nu se alinia vertical cu linia. Ajustata latimea coloanei, pozitia marker-ului si spacing-ul vertical pentru noua scara.",
      },
      {
        title: "Bugfix — paginare goala dupa aplicare filtre",
        content:
          "La aplicarea unui filtru care reducea numarul de pagini, tabela ramanea goala pentru ca page depasea noul totalPages. DosareTable + TermeneTable primesc un useEffect care clampeaza page la max(1, totalPages) cand datele filtrate se schimba.",
      },
      {
        title: "TermeneTable — chei stabile pentru selectie",
        content:
          "Inainte, state-ul de selectie folosea index-ul rand-ului drept cheie, asa ca la sortare/filtrare selectiile 'sareau' pe alte randuri. Acum cheia e compusa din identificatori reali (institutie + departament + numar + ora + complet), stabila prin orice reordonare.",
      },
      {
        title: "RnpmDetailModal — identificator aviz in header",
        content:
          "Identificatorul avizului apare acum in header-ul modalului 'Detalii Aviz', fara font-mono si aliniat baseline — userul il vede fara sa scrolleze pana la randul de detalii.",
      },
      {
        title: "Dashboard — persistenta 'Ultima Cautare' pentru dosare",
        content:
          "Dupa restart, cardul 'Dosare' nu mai dispare din dashboard. Persistam doar meta (numar dosare + categorii + institutii) + params-ul ultimei cautari (nu intregul dataset). Click pe card → navigheaza la pagina dosare si re-triggereaza cautarea automat cu params-ul stocat.",
      },
      {
        title: "Restore baza locala din backup",
        content:
          "In modalul 'Info baza locala' — buton nou 'Restaurare' intre 'Backups' si 'Sterge back-up'. Deschide un dialog cu lista de backups (nume + marime + data), cu confirm destructiv inainte de aplicare:",
        bullets: [
          "Snapshot preventiv automat al DB-ului curent in legal-dashboard.pre-restore-<ISO>.db — userul poate rolla back manual daca restore-ul nu e ce se astepta",
          "Close DB handle inainte de overwrite (Windows blocheaza fisierele deschise); unlink al sidecar-urilor WAL/SHM dupa overwrite (ar corupe deschiderea noii DB)",
          "Validare stricta a numelui fisierului cu regex + check path traversal — niciun fisier din afara folder-ului backups/ nu poate fi selectat",
        ],
      },
      {
        title: "Info baza locala — aliniere 'Cale:' + modal largit",
        content:
          "Modalul 'Info baza locala' lat cu un pas (max-w-xl → max-w-2xl) ca sa incapa cai lungi fara break. 'Cale:' + calea + butonul copy inlinate intr-un singur rand cu aliniere fixata (font-mono are metrici diferite de sans — translate-y-[2px] corecteaza restul).",
      },
      {
        title: "Dependency hygiene",
        content:
          "Bump dompurify (patch securitate XSS sanitizer) + bump @anthropic-ai/sdk pentru sync cu release-urile upstream. npm audit — 0 vulnerabilitati la nivel repo.",
      },
    ],
  },
  {
    version: "v2.0.2",
    date: "17 Aprilie 2026",
    subtitle: "Audit de securitate — hardening Electron + backend + chei in OS keystore",
    icon: <Lock className="h-5 w-5" />,
    borderColor: "border-l-amber-500",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    sections: [
      {
        title: "Cheile API migrate in OS keystore (Electron safeStorage)",
        content:
          "Inainte, cheile Anthropic / OpenAI / Google / 2Captcha / CapSolver erau obfuscate cu btoa+reverse in localStorage — reversibil in cateva secunde. Acum, pe desktop, cheile trec prin Electron safeStorage (DPAPI pe Windows, Keychain pe macOS, libsecret pe Linux):",
        bullets: [
          "preload.js dedicat expune doar 3 metode via contextBridge: encryptKeys / decryptKeys / isEncryptionAvailable. Renderer-ul nu mai are acces la ipcRenderer direct",
          "IPC handler in main.js cu limite dure: plaintext max 8 KiB, ciphertext base64 max 16 KiB — previne payload-uri abuzive",
          "Migrare automata la primul boot dupa upgrade: blob-ul vechi 'portaljust-api-keys' se decripteaza, se re-cripteaza prin OS keystore in 'portaljust-api-keys-enc', iar blob-ul vechi se sterge",
          "Pe web (fara desktopApi) ramane fallback-ul de obfuscare — e documentat explicit ca NU e control de securitate, e doar anti-screenshot casual",
        ],
      },
      {
        title: "Hardening Electron",
        content: "Cresterea defense-in-depth pe procesul principal:",
        bullets: [
          "Single-instance lock (app.requestSingleInstanceLock) — previne doua Electron-uri simultane care se bat pe acelasi fisier SQLite si corup baza; a doua lansare focuseaza fereastra existenta",
          "webSecurity: true, sandbox: true, contextIsolation: true explicite in webPreferences — nu mai depindem de default-urile framework-ului",
          "DevTools activate doar in dev (IS_DEV = NODE_ENV !== 'production'); meniul 'Instrumente dezvoltator' dispare complet din build-ul de productie",
          "Verificare identitate /health la boot — daca alt proces asculta pe portul 3002, aplicatia refuza sa se conecteze (nu doar ca primeste 200 OK)",
        ],
      },
      {
        title: "Hardening backend",
        content:
          "Server-ul Hono primeste mai multe controale aliniate la threat-model-ul desktop + potential LAN deploy:",
        bullets: [
          "CSP explicit pe toate raspunsurile: default-src 'self', script-src 'self', object-src 'none', frame-ancestors 'none', base-uri 'self' — inclusiv in modul server standalone, nu doar in Electron",
          "Rate limiter cheie pe IP-ul real al socket-ului (getConnInfo.remote.address), nu pe X-Forwarded-For care era spoofable printr-un simplu header",
          "Bind pe 127.0.0.1 garantat: HOST=0.0.0.0 (sau orice alt non-loopback) este IGNORAT si se afiseaza warning, decat daca operatorul seteaza explicit LEGAL_DASHBOARD_ALLOW_REMOTE=1 — previne expunere accidentala in LAN",
          "MAX_SOAP_FANOUT=500 pe /api/dosare/load-more si /api/termene/load-more — previne amplificare unde un POST legitim declanseaza mii de cereri SOAP upstream",
          "TRUNCATE_SOLUTIE redus de la 10000 la 5000 caractere — bounded token spend + surface mai mic pentru prompt injection",
          "AI keys env-first: daca ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_AI_KEY sunt setate in env, au precedenta asupra cheilor din body (critic pentru deployment ca serviciu)",
        ],
      },
      {
        title: "Fix XLSX formula injection la export",
        content:
          "Celulele de tip string care incepeau cu = + - @ Tab sau CR erau interpretate de Excel ca formule. Daca un atacator injecta '=HYPERLINK(...)' intr-un camp (ex: nume parte), user-ul deschidea fisierul si formula se executa. Fix:",
        bullets: [
          "Helper sanitizeFormulaCells aplicat pe toate sheet-urile generate din frontend/src/lib/export.ts si rnpmExport.ts",
          "Celulele care incep cu caracter declansator primesc prefix ' (apostrof) — Excel/LibreOffice le afiseaza literal ca text, nu le evalueaza",
          "Acopera export-urile Dosare, Sedinte, Termene, Avize, Creditori, Debitori, Bunuri, Istoric",
        ],
      },
      {
        title: "Documentatie",
        content: "Threat model si configurare documentate la radacina repo-ului pentru operatori si cititori viitori:",
        bullets: [
          "SECURITY.md — what's in scope (single-instance, safeStorage, CSP, real-IP rate limit, HOST whitelist, SOAP cap, formula escape), what's out of scope (malware pe acelasi user OS, supply-chain, binar nesemnat Windows, LAN-mode fara auth, SOAP upstream HTTP la portalquery.just.ro)",
          "backend/.env.example — documenteaza clar env-precedence-over-body pentru cheile AI, opt-in-ul LEGAL_DASHBOARD_ALLOW_REMOTE si nota corecta despre persistenta cheilor (safeStorage pe desktop, obfuscare pe web — NU in SQLite cum scria inainte eronat)",
        ],
      },
    ],
  },
  {
    version: "v2.0.1",
    date: "17 Aprilie 2026",
    subtitle: "Stop RNPM cap-coada + filtru interval data + rafinari UI",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-rose-500",
    badgeClass: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
    sections: [
      {
        title: "Butonul Stop RNPM functioneaza cap-coada (abort chain complet)",
        content:
          "Pana acum, click pe Stop in tab-ul Cautare RNPM ascundea UI-ul dar cautarea continua in background si se persistau avize nedorite. Acum Stop intrerupe efectiv tot lantul — captcha, fetch RNPM, fetch detalii, persist SQLite:",
        bullets: [
          "AbortSignal propagat UI → fetch → backend (Hono c.req.raw.signal) → toate fetch-urile outbound catre RNPM (search + 4 parts + istoric)",
          "Captcha solver: 2Captcha via Promise.race cu cleanup listener, CapSolver verifica signal la fiecare poll (sub 2s latenta la abort in loc de 60-120s)",
          "Skip persist: fetch-urile deja rezolvate inainte de abort nu mai scriu in SQLite — baza locala ramane neatinsa daca userul opreste cautarea",
          "Fix final: butonul Stop auto-submita form-ul din cauza React 18 DOM node reuse (ternar cu acelasi <Button> → morph type='button' → type='submit' intre click si commit). Rezolvat cu key distincte pe cele doua butoane → unmount + mount",
          "Validat manual in Electron: un singur request abortat in ~2s, zero avize persistate, Console curat",
        ],
      },
      {
        title: "Baza locala — filtru interval date + migratii",
        content: "Filtrele pe tab-ul Baza locala extinse cu interval de date; migrari idempotente pe SQLite:",
        bullets: [
          "Filtru data: doua <input type='date'> (de la / pana la) cu reset. Coloana data stocata 'dd.mm.yyyy' (format RNPM) → conversia in ISO se face in SQL via substr()",
          "rnpm_bunuri.referinte_json: coloana noua (ALTER TABLE idempotent). Stocheaza array JSON de referinte (constituitor / tert) — deblocheaza BunRefRow in modalul detaliu cu culori distincte (sky pentru constituitor, amber pentru tert)",
          "deleteAllAvize tranzactional: sterge atat rnpm_avize (CASCADE pe creditori/debitori/bunuri/istoric) cat si rnpm_searches intr-o singura tranzactie",
          "getAvizeByIds bulk fetch (max 500 ids) — pregatire pentru export batch PDF/Excel",
        ],
      },
      {
        title: "Rafinari UI modul RNPM",
        content: "Mici imbunatatiri de UX pe toate cele trei tab-uri:",
        bullets: [
          "RnpmDetailModal: 5 tab-uri navigabile (General / Creditori / Debitori / Bunuri / Istoric) cu count badge per tab si scroll smooth la tab-switch",
          "RnpmSavedData: badge verde/gri activ/inactiv + dubla confirmare la 'Sterge tot' (actiune ireversibila)",
          "RnpmBulkSearch: feedback vizual per item (Loader2 → CheckCircle2 / XCircle), estimare durata + cost afisate inainte de start, hard limit 100 per batch cu warning pe depasire",
          "Categoria 5 (Aviz de ipoteca - obligatiuni ipotecare) cu formular complet: Agent PJ/PF + Emitent PJ + descriere bun garantie — chei confirmate prin captura Network pe site-ul oficial",
        ],
      },
      {
        title: "Verificare",
        content: "Build curat si teste verzi:",
        bullets: [
          "npx tsc --noEmit (frontend + backend) — clean",
          "npx vitest run — 24/24 verde",
          "Reproducere manuala in Electron: Stop, obligatiuni search, filtru data range, Sterge tot — toate OK",
        ],
      },
    ],
  },
  {
    version: "v2.0.0",
    date: "16 Aprilie 2026",
    subtitle: "Legal Dashboard — rebranding din PortalJust App + modul nou RNPM",
    icon: <Rocket className="h-5 w-5" />,
    borderColor: "border-l-violet-500",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
    sections: [
      {
        title: "Rebranding — Legal Dashboard",
        content:
          "Aplicatia a fost rebrand-uita din PortalJust App in Legal Dashboard pentru a reflecta scope-ul extins (cautare dosare PortalJust + cautare avize RNPM):",
        bullets: [
          "Nume aplicatie schimbat in Legal Dashboard (titlu fereastra, installer, shortcut, PDF exports, manual)",
          "AppId schimbat in ro.legaldashboard.app, baza de date locala in userData/legal-dashboard.db",
          "Istoric RNPM separat de istoricul PortalJust (localStorage cheie noua)",
          "Versiunea bumped la v2.0.0 pentru continuitate cu PortalJust v1.4.4-ai (ultima versiune sub vechea denumire ramane vizibila mai jos in changelog)",
        ],
      },
      {
        title: "Modul nou — Cautare RNPM (Registrul National de Publicitate Mobiliara)",
        content:
          "Tab nou complet in sidebar pentru cautarea avizelor RNPM, cu 3 sub-tab-uri (Cautare / Bulk / Baza locala):",
        bullets: [
          "5 categorii de cautare aliniate la spec-ul oficial: Aviz de ipoteca mobiliara, Fiducie, Aviz specific, Aviz de ipoteca - creante securitizate, Aviz de ipoteca - obligatiuni ipotecare",
          "Formular cu Tipul avizului (18 valori ipoteci, 7 specifice, 7 fiducii), Destinatia inscrierii (14/10 valori), operator SI/SAU pe fiecare camp, toggle PJ/PF unic per parte (Constituitor, Fiduciar, Beneficiar, Parte, Debitor, Creditor)",
          "Captcha rezolvat automat via 2Captcha (~$0.003/captcha); cheia configurabila in dialogul Setari AI alaturi de Anthropic / OpenAI / Google",
          "Modal detaliu cu 5 tab-uri (General, Creditori, Debitori, Bunuri, Istoric); referintele tert/constituitor afisate ca badge-uri colorate (amber = tert, sky = constituitor)",
          "Bulk search cu SSE live progress, estimare timp/cost, buton Abort cu cleanup la unmount (previne waste 2Captcha)",
          "Browse baza locala cu filtrare full-text insensibila la diacritice + cursor 'Incarca mai multe' (cauti 'stefan' → gasesti 'Ștefan' / 'STEFAN')",
          "Eager detail fetch in timpul cautarii (UUID-urile RNPM sunt efemere) — toate detaliile persistate local in 6 tabele noi cu owner_id",
        ],
      },
      {
        title: "Hardening si parity RNPM (16 Aprilie)",
        content: "Trei valuri de fix-uri pe modulul RNPM imediat dupa lansare:",
        bullets: [
          "Form parity completa cu site-ul oficial mj.rnpm.ro (default checkboxes 'Numai active' + 'Nemodificate de alte inscrieri', dropdown destinatii, structuri per categorie)",
          "Eroare clara cand RNPM returneaza > 1500 rezultate (limita oficiala) + re-solve captcha automat pe 410/401/403 (gcode expirat) pentru paginile ulterioare",
          "Body limits pe POST /api/rnpm/* (search 64KB, bulk 512KB), SSE timeout 10 min pe /bulk, validateParamsDepth (depth max 4, string max 500 chars)",
          "Confirm non-blocking cand CUI-ul contine non-digit; mesaje backend (status text) propagate la frontend in loc de 'Eroare server (500)' generic",
        ],
      },
      {
        title: "Audit remediation — 12/12 findings",
        content: "Toate cele 12 findings din auditul intern aplicate; build OK, 24/24 teste verzi:",
        bullets: [
          "Load-more suporta cautari multi-institutie (URLSearchParams.append + c.req.queries; loop serial cu dedup intre institutii)",
          "Butonul Stop opreste real backend-ul (AbortSignal propagat prin batchFetchDosare/subdivideInterval; single-timer abort, fara evenimente done/error la abort)",
          "Boot Electron cu deadline 30s + dialog.showErrorBox la esec backend (polling cu deadline, backendStarted=true doar dupa /health)",
          "setState functional in toate callback-urile load-more (stream-ul nu mai poate suprascrie filtre/state intre batch-uri)",
          "Mesajele HTTP de la backend propagate transparent in lib/api.ts (parse o singura data, fara dublu-throw)",
          "Metricile uniformizate: numarul real de institutii unice + definitii viitor/trecut/azi aliniate cu filtrele paginii",
          "Versiunea unificata pe root + frontend + backend; vite injecteaza __APP_VERSION__ ca single source of truth",
          "Code-split: Changelog/Manual/MetricsPanel/TermeneMetrics lazy + manualChunks named (charts/xlsx/pdf). Bundle main 306 kB (gzip 83 kB), recharts/xlsx/pdf incarcate la cerere",
          "Culori grafice centralizate in lib/chart-colors.ts (CATEGORY_COLORS + CHART_FILLS)",
          "Hook useDialog (Escape close + scroll lock + focus capture/restore) wired in toate dialogurile; role=dialog + aria-modal + aria-labelledby; useId() pentru pairing htmlFor/id pe SearchForm",
          "Vitest in backend: 24/24 verde — intervals.ts (split, range valid/invalid/leap, cross-year, clamp) + soap.ts (XML parsers, namespaced tags, prefix collision, parti/sedinte isolation, diacritics)",
        ],
      },
    ],
  },
  {
    version: "v1.4.4-ai",
    date: "5 Aprilie 2026",
    subtitle: "AI Enabled",
    icon: <FileSpreadsheet className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Export Excel Stilizat",
        content: "Formatare vizuala avansata pentru fisierele Excel exportate (similar cu stilul PDF):",
        bullets: [
          "Titlu dark blue cu text alb, headere colorate albastru, randuri alternante gri/alb",
          "Sheet Sedinte grupat pe dosare cu sectiuni clare si separatori vizuali",
          "Numar dosar bold in lista principala pentru identificare rapida",
          "Rand statistici cu numar dosare/termene si data exportului",
        ],
      },
      {
        title: "Hyperlinks Interne Excel (Bidirectionale)",
        content: "Navigare rapida intre sheet-urile Dosare si Sedinte direct din Excel:",
        bullets: [
          "Dosare → Sedinte: click pe numarul dosarului sare direct la prima sa sedinta",
          "Sedinte → Dosare: headerul fiecarei sectiuni are link inapoi la randul dosarului (↑)",
          "Functioneaza nativ in Microsoft Excel si LibreOffice Calc",
        ],
      },
      {
        title: "Filenames Dinamice la Export",
        content: "Denumirile fisierelor exportate reflect continutul (Excel si PDF):",
        bullets: [
          "1 dosar: dosar_NR-DOSAR.xlsx / dosar_NR-DOSAR.pdf",
          "Multiple dosare: dosare_DD.MM.YYYY.xlsx / dosare_DD.MM.YYYY.pdf",
          "Acelasi comportament pentru termene: termen_NR / termene_DATA",
        ],
      },
      {
        title: "Modele Claude Actualizate & Versiune Server",
        content: "Actualizari de infrastructura:",
        bullets: [
          "Claude Sonnet 4.6, Opus 4.6 si Haiku 4.5 — versiunile curente ale modelelor",
          "Build server deployabil: npm run dist:server genereaza pachet ZIP complet",
          "Dockerfile + docker-compose pentru deployment in container",
        ],
      },
    ],
  },
  {
    version: "v1.4.3-ai",
    date: "3 Aprilie 2026",
    subtitle: "AI Enabled",
    icon: <CalendarSearch className="h-5 w-5" />,
    borderColor: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    sections: [
      {
        title: "Modele Gemini 3.x",
        content: "Actualizare completa a modelelor Google Gemini la seria 3.x:",
        bullets: [
          "Eliminare toate modelele deprecated din seria Gemini 2.5",
          "Modele noi: Gemini 3.1 Flash Lite (Rapid), Gemini 3 Flash (Echilibrat), Gemini 3.1 Pro (Premium)",
          "Gemini 3.1 Pro adaugat ca model judecator in analiza multi-agent",
          "Actualizare model IDs backend la versiunile curente Google AI",
        ],
      },
      {
        title: "Filtrare Date Client-Side (Calendar)",
        content:
          "Schimbarea datelor din Data Start / Data Stop filtreaza rezultatele instant, fara o noua cautare SOAP:",
        bullets: [
          "Functioneaza pe ambele pagini: Cautare Dosare (data dosar) si Termene & Calendar (data sedinta)",
          "Se poate folosi doar Data Start, doar Data Stop, sau ambele simultan",
          "Filtrul se reseteaza automat la o cautare noua sau la apasarea butonului Reseteaza",
        ],
      },
      {
        title: "Timeout Multi-Agent & Dimensionare Dinamica",
        content: "Imbunatatiri de performanta si compatibilitate:",
        bullets: [
          "Timeout multi-agent crescut la 180s (de la 120s) — analize complete pe dosare mari",
          "Fereastra Electron se adapteaza la rezolutia monitorului (85% latime, 90% inaltime)",
          "Respecta Windows DPI scaling nativ (fara zoom suplimentar)",
        ],
      },
    ],
  },
  {
    version: "v1.4.2-ai",
    date: "31 Martie 2026",
    subtitle: "AI Enabled",
    icon: <Layers className="h-5 w-5" />,
    borderColor: "border-l-violet-500",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
    sections: [
      {
        title: "Sectiuni AI Colapsabile",
        content: "Analiza AI si Analiza AI Avansata sunt acum sectiuni colapsabile independente, inchise by default:",
        bullets: [
          "Analiza AI — container propriu cu header, model selectors vizibili, buton si rezultat",
          'Analiza AI Avansata — container separat, independent (redenumit din "Analiza Avansata")',
          "Design unificat: acelasi layout (header cu download + chevron, selectoare model, buton jos)",
          "Descrierea modelului selectat (Rapid/Echilibrat/Premium) afisata langa butoane in ambele sectiuni",
        ],
      },
      {
        title: "Marire Fonturi Globala",
        content: "Fonturi marite cu +1-1.5px in mai multe zone ale aplicatiei:",
        bullets: [
          "Sidebar: label dimensiune text, badge Activ/Neconfigurat",
          "Istoric Cautari: header, nume cautare, rezultate + timp",
          "CalendarView: toate fonturile (card, solutie, solutieSumar, parti, badges)",
        ],
      },
      {
        title: "Consistenta Termene cu Dosare",
        content: "Toate imbunatatirile vizuale din Cautare Dosare aplicate si pe Termene:",
        bullets: [
          "solutieSumar marit la 14.5px (aliniat cu DosareTable)",
          "Party badges marite la text-xs",
          "Fix text concatenat (splitConcatenatedWords) aplicat si pe TermeneTable",
          "Bold rosu pe data, ora si institutie cand randul e expandat",
          "La deschiderea unui termen, cel anterior se inchide automat",
        ],
      },
    ],
  },
  {
    version: "v1.4.1-ai",
    date: "30 Martie 2026",
    subtitle: "AI Enabled",
    icon: <MousePointerClick className="h-5 w-5" />,
    borderColor: "border-l-cyan-500",
    badgeClass: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
    sections: [
      {
        title: "Auto-Scroll la Detalii Dosar",
        content:
          "La expandarea unui rand din tabel, ecranul face scroll automat pentru a afisa sectiunea de detalii. Deosebit de util cand dosarul este la finalul paginii vizibile.",
        bullets: [
          "Functioneaza pe ambele tab-uri: Dosare si Termene",
          "Detectie inteligenta a containerului scrollable",
        ],
      },
      {
        title: "Indicator Vizualizat / Nevizualizat",
        content: "Dosarele si termenele au acum un indicator vizual care arata care au fost deschise si care nu:",
        bullets: [
          "Punct albastru animat (ping) pentru dosarele nevizualizate",
          "Iconita ochi gri pentru cele deja vizualizate (expandate)",
          "Marcare automata la expandarea randului",
          "Persistare in sessionStorage pe durata sesiunii de browser",
        ],
      },
      {
        title: "Butoane Navigare Rapida (Scroll Sus/Jos)",
        content: "Doua butoane floating in coltul din dreapta-jos pentru navigare rapida in pagina:",
        bullets: [
          "Sageata sus — apare cand ai scrollat in jos, duce la meniul de cautare",
          "Sageata jos — apare cand mai ai continut sub ecran",
          "Se actualizeaza automat la incarcarea de continut nou",
          "Functioneaza pe toate paginile (Dashboard, Dosare, Termene)",
        ],
      },
      {
        title: "Fix — Analiza AI Trunchiata pe Dosare Complexe",
        content:
          "Rezolvata problema analizei multi-agent care se oprea inainte de finalizare la dosare cu multe termene detaliate:",
        bullets: [
          "max_tokens crescut de la 3000 la 8000 pe toti providerii (Anthropic, OpenAI, Google)",
          "max_output_tokens setat explicit pe OpenAI si Google (inainte depindeau de default-uri)",
          "Timeout backend crescut: 90s → 120s per apel AI",
          "Timeout frontend crescut: single 120s → 180s, multi-agent 180s → 300s (5 minute)",
        ],
      },
    ],
  },
  {
    version: "v1.4.0-ai",
    date: "29 Martie 2026",
    subtitle: "AI Enabled",
    icon: <ShieldCheck className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Incarca Mai Multe (Load More) — Paginare Extinsa",
        content:
          'API-ul SOAP PortalJust returneaza maxim 1000 rezultate per cerere. Noul buton "Incarca mai multe" scaneaza luna cu luna prin SSE (Server-Sent Events) si gaseste TOATE dosarele/termenele disponibile.',
        bullets: [
          "Backend scaneaza intervale lunare cu subdivizare recursiva daca o luna depaseste 1000 rezultate",
          "Deduplicare server-side — backend-ul primeste dosarele/termenele existente via POST body si trimite doar cele NOI",
          "Merge incremental pe fiecare batch (rezultatele apar in tabel in timp real, fara asteptare)",
          "Progress bar cu numar exact de dosare/termene noi gasite",
          "Stop pastreaza rezultatele partiale (nimic pierdut la oprire)",
          "Functioneaza pe ambele tab-uri: Dosare si Termene",
        ],
      },
      {
        title: "Navigare Persistenta (Always-Mounted)",
        content:
          "Paginile Dosare si Termene raman mereu montate in DOM (ascunse cu display:none cand inactive). Operatiile async (load-more, cautare) supravietuiesc navigarii intre tab-uri.",
        bullets: [
          "Formularul de cautare isi pastreaza starea (campuri completate) la navigare intre tab-uri",
          "Butonul Reseteaza apare corect dupa revenirea pe un tab cu cautare activa",
          "Dashboard-ul se monteaza/demonteaza normal (nu are operatii long-running)",
        ],
      },
      {
        title: "Reset Complet",
        content:
          'Butonul "Reseteaza" sterge acum atat campurile formularului cat si toate rezultatele cautarii anterioare (tabel, metrici, selectii).',
      },
      {
        title: "Analiza Multi-Agent — Documentare Comportament Judecator",
        content: "Documentare completa a modului de functionare al analizei multi-agent cu AI:",
        bullets: [
          "Judecatorul primeste ambele analize in prompt cu delimitatori XML separati",
          "Rolul judecatorului: reconciliaza, sintetizeaza si ofera o analiza finala coerenta, prezentand explicit ce reconcilieri a facut intre cele doua analize",
          "Modele judecator permise: doar Claude Opus 4 si GPT-5.4 (modele premium)",
          "Analizele individuale vizibile in toggle side-by-side",
        ],
      },
      {
        title: "Manual de Utilizare",
        content:
          'Manual complet integrat in aplicatie cu 12 capitole care acopera toate functionalitatile. Accesibil din Dashboard (buton "Manual" langa "Vezi Noutati").',
        bullets: [
          "Cuprins interactiv — click pe capitol navigheaza direct la sectiunea respectiva",
          "Export PDF — buton de descarcare disponibil atat in header cat si la finalul manualului",
          "PDF generat: Portrait A4 cu cover page, cuprins, 12 capitole formatate profesional si footer pe fiecare pagina",
        ],
      },
      {
        title: "Securitate (Audit Complet v1.4.0-ai)",
        content:
          "Audit exhaustiv de securitate pe backend, frontend si Electron cu clasificare pe severitate (Critical, High, Medium):",
        bullets: [
          "DOMPurify pe toate dangerouslySetInnerHTML — protectie XSS din raspunsuri AI",
          "Sanitizare erori API — fara leak chei API sau stack traces catre client",
          "Body size limit: 100KB pe AI, 500KB pe load-more POST",
          "Schema validation pe request body AI si load-more (max 10000 elemente, max 100 chars/element)",
          "JSON.parse wrapped in try-catch dedicat pe toate endpoint-urile",
          "SSE timeout 10 minute + max 120 intervale lunare (protectie DoS)",
          "API keys obfuscate in localStorage (btoa + reverse, nu plaintext)",
          "Rate limiter fix (nu foloseste X-Forwarded-For)",
          "External URL whitelist exact (Array.includes, nu endsWith)",
          "DevTools dezactivate in productie, activabile cu flag --dev-tools",
          "CSP fara data: URI, sandbox + contextIsolation in Electron",
          "Bind localhost only, path traversal protection, XML escape complet",
        ],
      },
    ],
  },
  {
    version: "v1.3.0-ai",
    date: "28 Martie 2026",
    subtitle: "AI Enabled",
    icon: <BrainCircuit className="h-5 w-5" />,
    borderColor: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    sections: [
      {
        title: "Analiza AI Avansata (Multi-Agent)",
        content:
          "Sistem de analiza cu agenti multipli: 2 modele AI analizeaza dosarul in paralel, iar un al 3-lea model (judecator) reconciliaza rezultatele intr-o analiza finala coerenta.",
        bullets: [
          "Selectori model pentru fiecare analist si judecator — nu se poate selecta acelasi model de doua ori",
          "Modele judecator permise: Claude Opus 4 si GPT-5.4 (modele premium)",
          "Vizualizare analize individuale side-by-side (toggle)",
          "Sectiune colapsabila cu configurare inainte de analiza",
        ],
      },
      {
        title: "OpenAI Responses API & Modele Noi",
        content:
          "Migrare completa de la Chat Completions API la noul OpenAI Responses API (client.responses.create). Modele actualizate la ultima generatie.",
        bullets: [
          "GPT-5.4 nano (Rapid) — cel mai rapid model OpenAI",
          "GPT-5.4 mini (Echilibrat) — balans viteza/calitate",
          "GPT-5.4 (Premium) — cel mai capabil model OpenAI",
        ],
      },
      {
        title: "Prompt AI Imbunatatit",
        content:
          "Analiza AI include acum 7 sectiuni structurate, cu doua adaugiri noi: articole de lege relevante (temei juridic) si legaturi cu alte dosare.",
      },
      {
        title: "Export PDF Analize AI",
        content:
          "Export PDF profesional pentru ambele tipuri de analiza (simpla si avansata). Design cu paleta de culori calde, card info dosar, formatare markdown, page breaks inteligente si footer pe fiecare pagina.",
      },
      {
        title: "Securitate (Audit v1.3.0-ai)",
        content: "Audit de securitate pe noile functionalitati multi-agent:",
        bullets: [
          "Prompt injection defense — date dosar in delimitatori XML, truncare campuri (obiect 500, nume parte 100, solutie 200 caractere)",
          "Analize AI incapsulate in delimitatori separati in prompt-ul judecatorului — previne propagarea prompt injection",
          "Rate limiter ponderat — endpoint-ul multi-agent consuma 3 unitati din limita (vs 1 pentru alte endpoint-uri)",
          "Schema validation pe endpoint-ul multi-agent — reutilizare validateAiBody pentru validarea completa a datelor dosar",
        ],
      },
      {
        title: "Documentatie Completa",
        content:
          "DOCUMENTATIE.md — fisier complet cu toata arhitectura, functionalitatile, securitatea, API-ul, tipurile de date si istoricul versiunilor proiectului.",
      },
    ],
  },
  {
    version: "v1.2.1-ai",
    date: "27 Martie 2026",
    subtitle: "AI Enabled",
    icon: <Building2 className="h-5 w-5" />,
    borderColor: "border-l-teal-500",
    badgeClass: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
    sections: [
      {
        title: "Selector Institutii (Multi-Select)",
        content:
          "Selector modal pentru filtrarea pe 246 instante din Romania, parsate din WSDL-ul SOAP al Ministerului Justitiei. Institutiile sunt grupate pe categorii: Curti de Apel (15), Tribunale (42), Tribunale Specializate (1), Tribunale Comerciale (3), Tribunale Militare (5), Curti Militare (1), Judecatorii (179).",
        bullets: [
          "Multi-select cu draft state — selectiile se aplica la inchiderea ferestrei, cu sortare alfabetica",
          'Cautare diacritice-insensitiva (ex: "brasov" gaseste "Brașov")',
          "Chips vizuale pentru selectii, buton de reset, counter de rezultate",
          "Cautare paralela SOAP — cand sunt selectate mai multe institutii, backend-ul face cereri simultane",
        ],
      },
      {
        title: "Filtrare Duala pe Institutii",
        content:
          "Institutiile selectate functioneaza dual: la cautare, query-ul SOAP este trimis doar catre instantele selectate (filtru server-side). Dupa cautare, modificarea selectiei aplica filtru client-side instant pe dosarele deja primite, fara re-interogare.",
      },
      {
        title: "Normalizare Nume Institutii",
        content:
          'Functia centralizeaza de normalizare transforma numele brute din SOAP (ex: "TribunalulSATUMARE") in forma corecta ("Tribunalul Satu Mare"). Aplicata in toate componentele: tabel dosare, tabel termene, metrici, calendar, modal detalii, export.',
      },
      {
        title: "Compatibilitate Diacritice Romanesti",
        content:
          "API-ul SOAP PortalJust foloseste varianta veche a diacriticelor romanesti (ş cu sedila, nu ș cu virgula). Backend-ul converteste automat caracterele moderne in varianta legacy inainte de trimiterea catre SOAP.",
        bullets: [
          'Cautarea cu "Ioan Farcaș", "Ioan Farcaş" sau "Ioan Farcas" returneaza aceleasi rezultate',
          "Analiza rolurilor din MetricsPanel foloseste matching diacritice-insensitiv",
          "Highlight-ul de nume din tabel recunoaste toate variantele de diacritice",
          "Filtrul pe roluri compara diacritice-insensitiv",
        ],
      },
      {
        title: "Securitate (Audit v1.2.1-ai)",
        content: "Audit complet de securitate pe backend, frontend si Electron cu urmatoarele imbunatatiri:",
        bullets: [
          "Limita maxima de 50 institutii per cerere — previne amplificarea cererilor SOAP paralele",
          "Timeout de 60 secunde pe toate apelurile AI (Anthropic, OpenAI, Google) — previne blocarea conexiunilor",
          "Validare body size reala pe /api/ai/analyze — verificare pe textul efectiv, nu pe header-ul Content-Length",
          "Validare chei API — string-uri cu maxim 256 caractere, previne obiecte sau payload-uri mari",
          "encodeURIComponent() pe toate URL-urile portal.just.ro construite din numere de dosar — previne URL injection",
          "Verificare identitate backend la pornire Electron — health check confirma ca raspunsul vine de la PortalJust API, nu de la alt proces pe portul 3001",
          'Validare URL stricta in Electron — shell.openExternal() foloseste new URL() parser si verifica hostname.endsWith(".just.ro")',
          "CSP imbunatatit: object-src 'none' (blocheaza plugin-uri) si frame-ancestors 'none' (previne iframe embedding)",
        ],
      },
    ],
  },
  {
    version: "v1.2.0-ai",
    date: "27 Martie 2026",
    subtitle: "AI Enabled",
    icon: <Sparkles className="h-5 w-5" />,
    borderColor: "border-l-violet-500",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
    sections: [
      {
        title: "Asistenta AI Multi-Provider",
        content:
          "Aceasta versiune introduce analiza inteligenta a dosarelor folosind modele AI de ultima generatie. Cand deschizi detaliile unui dosar, poti solicita o analiza completa care include: rezumatul dosarului, explicatia rolurilor partilor, starea actuala a procesului, istoricul sedintelor si posibilii pasi urmatori.",
        bullets: [
          "Anthropic (Claude): Haiku 4.5 (rapid), Sonnet 4 (echilibrat), Opus 4 (premium)",
          "OpenAI (GPT-5.4): 5.4 nano (rapid), 5.4 mini (echilibrat), GPT-5.4 (premium)",
          "Google (Gemini): Flash 2.0 (rapid), Flash 2.5 (echilibrat), Pro 2.5 (premium)",
        ],
      },
      {
        title: "Selector Model AI",
        content:
          "Selectorul de model este grupat pe provideri cu coduri de culoare (violet pentru Claude, verde pentru GPT, albastru pentru Gemini). Se afiseaza doar modelele pentru care ai configurat o cheie API activa. Analiza include toate sedintele dosarului pentru o interpretare cat mai completa. Dupa generare, analiza poate fi ascunsa/aratata cu un buton toggle, sau regenerata cu un alt model.",
      },
      {
        title: "Configurare Chei API",
        content:
          'Din sidebar ("Setari AI") se deschide un dialog global unde poti introduce cheile API pentru fiecare provider separat. Fiecare provider are propriul camp de input cu indicator de status (Activa/Neconfigurat). Cheile se salveaza doar local pe calculator (in localStorage) si sunt trimise exclusiv catre API-ul corespunzator. Configurarea este optionala — butonul "Mai tarziu" permite utilizarea aplicatiei fara AI. In sidebar apare un indicator: verde cand cel putin o cheie este activa, portocaliu cand nu e configurata nicio cheie.',
      },
      {
        title: "Selectie pentru Export (Dosare & Termene)",
        content:
          'Atat tabelul de dosare cat si cel de termene au acum checkbox pe fiecare rand. Poti selecta individual elementele pe care vrei sa le exporti. Header-ul tabelului contine un checkbox "Select All" care selecteaza/deselecteaza toate elementele de pe pagina curenta. Randurile selectate sunt evidientiate vizual cu fundal violet. Butoanele Excel si PDF arata numarul de elemente selectate (ex: "Excel (3)"). Daca nu selectezi nimic, exportul include toate elementele ca inainte. Butonul "Deselecteaza tot" permite resetarea rapida a selectiei.',
      },
      {
        title: "Export Imbunatatit cu Sedinte",
        content:
          'Exportul Excel genereaza acum 2 sheet-uri: "Dosare" cu informatiile de baza si "Sedinte" cu toate sedintele din toate dosarele exportate (data, ora, complet, solutie, sumar solutie, document sedinta, numar document, data pronuntare). Exportul PDF include o coloana noua "Sedinte" cu rezumatul fiecarei sedinte. Subtitlul documentelor arata numarul total de dosare si sedinte exportate.',
      },
      {
        title: "Selector Rezultate pe Pagina",
        content:
          "In partea de jos a tabelului, langa paginare, se gasesc butoane pentru alegerea numarului de rezultate afisate pe pagina. Pentru dosare: 10, 15, 25, 50, 100 (implicit 15). Pentru termene: 10, 20, 50, 100 (implicit 20). La schimbarea valorii, se revine automat la prima pagina.",
      },
      {
        title: "Meniu Contextual (Click Dreapta)",
        content:
          "In aplicatia desktop (Windows), click dreapta afiseaza un meniu contextual cu optiunile: Copiaza (doar cand exista text selectat), Selecteaza tot si Printeaza. Combinatia Ctrl+C functioneaza nativ pentru copiere.",
      },
      {
        title: "Securitate (Audit v1.2.0-ai)",
        content: "Aceasta versiune include un audit complet de securitate cu urmatoarele imbunatatiri:",
        bullets: [
          "Protectie XSS: Toate zonele care afiseaza raspunsul AI folosesc DOMPurify pentru sanitizarea HTML-ului. Taguri permise strict limitate la <strong>, <em>, <b>, <i> — previne executia de cod malitios din raspunsuri AI",
          "Sanitizare erori API: Mesajele de eroare returnate clientului nu mai contin detalii interne (stack trace, chei API partiale, mesaje SDK). Erorile complete raman doar in log-urile serverului",
          "Sanitizare SOAP Fault: Detaliile tehnice din erorile PortalJust sunt logate server-side, clientul primeste doar un mesaj generic",
          "Validare schema AI: Endpoint-ul /api/ai/analyze valideaza structura completa a cererii (tipuri campuri, format apiKeys, model valid). Limita body: 100KB",
          "Protectie rate limiter: Nu mai foloseste X-Forwarded-For (spoofable). Serverul fiind localhost-only, rate limiting-ul e fix pe adresa locala",
          "Validare date reale: Datele sunt validate ca exista efectiv (ex: 30 februarie este respins). Reject caractere de control si null bytes din toti parametrii",
        ],
      },
      {
        title: "Infrastructura",
        content: "",
        bullets: [
          "Backend multi-provider: endpoint unic /api/ai/analyze cu rutare automata catre SDK-ul corect (Anthropic, OpenAI, Google)",
          "Vite optimizeDeps.include pentru pre-bundling xlsx, jspdf, jspdf-autotable (rezolva problema exportului care nu functiona)",
        ],
      },
    ],
  },
  {
    version: "v1.2.0",
    date: "26 Martie 2026",
    icon: <Palette className="h-5 w-5" />,
    borderColor: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    sections: [
      {
        title: "Build macOS (DMG)",
        content:
          "Suport complet pentru macOS cu Intel si Apple Silicon. GitHub Actions workflow pentru build automat. Fisier DMG cu installer drag-to-Applications. Repository GitHub: github.com/Havocwithin/portaljust-dashboard.",
      },
      {
        title: "Ajustare Dimensiune Font",
        content:
          'Valorile fontului au fost recalibrate: Mic (16px), Normal (18px), Mare (20px), Extra (22px). "Normal" corespunde acum dimensiunii corecte pentru ecrane laptop standard.',
      },
      {
        title: "Iconita Aplicatie",
        content:
          "Iconita cu balanta justitiei este prezenta in installer, taskbar Windows, title bar. Configurata pentru NSIS si adaptata pentru macOS (1024px).",
      },
      {
        title: "Installer fara Drepturi Admin",
        content:
          "Instalarea pe Windows nu mai necesita drepturi de administrator. Se instaleaza in AppData (per-user), nu in Program Files.",
      },
    ],
  },
  {
    version: "v1.1.0",
    date: "26 Martie 2026",
    icon: <Rocket className="h-5 w-5" />,
    borderColor: "border-l-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    sections: [
      {
        title: "Selectie Multipla Roluri",
        content:
          'Badge-urile de rol din "Analiza Parte" suporta selectie multipla. Se pot combina mai multe roluri simultan (ex: "Creditor" + "Parat"). Click repetat pe un rol il deselecteaza.',
      },
      {
        title: "Evidentierea Numelui Cautat",
        content:
          "Cuvintele cautate sunt evidientiate cu galben in numele partilor. Functioneaza independent de ordinea cuvintelor. Aplicat in preview-ul din tabel, sectiunea expandata Parti din Dosare si din Termene. Tooltip pe numele trunchiate.",
      },
      {
        title: "Control Dimensiune Text",
        content:
          "Control de font size in sidebar cu 4 pasi. Butoane A-/A+ cu indicator vizual. Setarea se salveaza in localStorage. Afecteaza toata aplicatia prin Tailwind rem-based scaling.",
      },
      {
        title: "Detalii Expandabile in Termene",
        content:
          "Click pe rand deschide detalii complete: Categorie, Stadiu, Obiect dosar, Solutie completa cu sumar integral, Lista de parti cu badge calitate si highlight.",
      },
      {
        title: "Detalii Expandabile in Calendar",
        content:
          "Numerele de dosar din calendar sunt linkuri catre portal.just.ro. Click pe card deschide dropdown cu solutie si lista parti.",
      },
      {
        title: "Filtre Metrici Termene",
        content:
          '"Total Termene" reseteaza toate filtrele. Cardurile metrici functioneaza ca filtre multiple choice. Filtrele se propaga in cascada: Categorie/Stadiu -> Metrici -> Tabel + Calendar.',
      },
      {
        title: "Filtre Categorie/Stadiu pe Termene",
        content:
          "Filtrele sunt acum functionale pe pagina Termene. Backend-ul transmite categorieCaz, stadiuProcesual, obiect si parti pentru fiecare termen.",
      },
      {
        title: "Corectare Texte Concatenate",
        content:
          "Extins dictionarul de segmentare cu ~50 termeni juridici (INCHEIEREFINALA -> INCHEIERE FINALA, etc.).",
      },
    ],
  },
  {
    version: "v1.0.0",
    date: "25 Martie 2026",
    subtitle: "Lansare Initiala",
    icon: <Shield className="h-5 w-5" />,
    borderColor: "border-l-slate-500",
    badgeClass: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400",
    sections: [
      {
        title: "Functionalitati Principale",
        content: "Conectare la API-ul SOAP PortalJust.ro al Ministerului Justitiei.",
        bullets: [
          "Cautare dosare dupa numar, nume parte, obiect",
          "Cautare termene cu interval de date",
          "Filtre client-side: Categorie Caz, Stadiu Procesual",
          "Vizualizare tabel cu paginatie si vizualizare calendar",
          "Export Excel si PDF",
          "Metrici si statistici cu grafice Recharts",
          "Analiza parte cu roluri si numar aparitii",
          "Tema Dark/Light",
          "Sidebar cu navigare si collapse",
          "Istoric cautari cu stergere individuala",
          "Link-uri catre portal.just.ro",
          "Segmentare automata documente concatenate",
          "Matching nume independent de ordine",
        ],
      },
      {
        title: "Arhitectura",
        content: "",
        bullets: [
          "Frontend: React + TypeScript + Vite + Tailwind CSS + shadcn/ui",
          "Backend: Node.js + Hono (port 3001)",
          "SOAP integration: portalquery.just.ro",
          "Grafice: Recharts",
          "Packaging: Electron + electron-builder",
        ],
      },
      {
        title: "Securitate (Masuri de Baza)",
        content: "Aplicatia a fost construita cu un set complet de masuri de securitate inca de la prima versiune:",
        bullets: [
          "Rate limiting (30 req/min pe endpoint) — previne flood-ul si abuzul API-ului",
          "Input validation — lungime maxima 200 caractere per parametru, validare format date YYYY-MM-DD",
          "Bind localhost only (127.0.0.1) — serverul backend nu este expus in retea, doar aplicatia Electron il poate accesa",
          "Path traversal protection — fisierele statice servite doar din directorul frontend; cererile cu ../ sunt blocate cu HTTP 403",
          "Security headers (Hono secureHeaders) — X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Content-Security-Policy",
          "Escape XML complet pentru SOAP requests — previne XML injection in cererile catre PortalJust",
          "CORS restrictiv — doar originile localhost pe porturile de dezvoltare sunt permise",
          "Fara persistenta API keys in backend — cheile nu sunt stocate pe disc, sunt primite per-request de la client",
        ],
      },
    ],
  },
];
