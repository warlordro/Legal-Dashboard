import { Sparkles, Palette, Rocket, Shield, Building2, BrainCircuit, ShieldCheck, MousePointerClick, Layers, CalendarSearch, FileSpreadsheet, Lock, Wrench, Activity, Bell, Mail, Users as UsersIcon } from "lucide-react";

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
          "Pagina Monitorizare primeste deasupra tabelului un tab-bar de 3 butoane (Toate / Dosare / Nume) si un input de cautare cu icon X pentru clear. Filtrul de tip ascunde cealalta categorie (de ex. Dosare ascunde toate jobs name_soap), iar input-ul filtreaza dupa numar dosar sau dupa nume. Counter discret \"{total} rezultate\" afisat doar cand exista filtre active. Empty state contextualizat: cand filtrele aplicate nu au rezultat, se afiseaza un mesaj cu link \"Reseteaza filtrele\" in loc de mesajul vechi de \"niciun job activ\".",
      },
      {
        title: "Frontend - debounce 300ms + reset paginatie pe schimbare filtru",
        content:
          "Search input-ul foloseste un debouncedQuery cu delay 300ms ca sa evite request spam la fiecare keystroke. Schimbarea kindFilter sau a debouncedQuery reseteaza automat pagina la 0, altfel utilizatorul aplica un filtru pe pagina 7 si vede gol pana la recovery-ul de retro-decrementare.",
      },
      {
        title: "Backend - GET /api/v1/monitoring/jobs?q=...",
        content:
          "JobListQuerySchema capata field q (trim + max 100 chars). listJobs adauga WHERE OR pe trei json_extract-uri: target_json.numar_dosar (dosar_soap), name_normalized (name_soap), identificator (placeholder aviz_rnpm). Match-ul foloseste rnpm_norm() pe coloane (strip diacritice + lowercase) si LIKE %...% cu meta-caractere %, _, \\ escapate cu \\ ESCAPE — input \"50%\" nu degenereaza in wildcard SQL. Comportamentul reproduce semantica Cautare Dosare: query cu diacritice matcheaza valori fara diacritice si invers.",
      },
      {
        title: "Backend - fail-closed pe target = doar sufix legal",
        content:
          "dosarMatchesAllNameTokens(targetCore=[]) returneaza acum false (fail-closed) in loc de true: un target compus exclusiv din sufixe legale (\"SRL\", \"S.R.L.\", \"SRL LLC\") nu mai trece tot ce returneaza PortalJust ca pseudo-pozitiv. Cazul e marginal (input-ul UPPERCASE + min 2 chars il blocheaza la /commit), dar pasul ramane defense-in-depth.",
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
          "Pagina Monitorizare afisa pana acum maxim 100 joburi cu un banner static \"Sunt cel putin 100 joburi vizibile (din 617 total)\". Acum tabelul are paginare standard cu state page/pageSize, TablePagination randat sub tabel, optiuni 10/25/50/100/pagina (cap-ul 100 matches limita backend JobListQuerySchema). Recovery automat la pagina goala dupa delete (decrement page daca jobs.length=0 si total>0 si page>0).",
      },
      {
        title: "Frontend - buton Anuleaza pe import bulk",
        content:
          "MonitoringBulkImportCard primeste un buton Anuleaza (cu icon X, variant outline) langa Confirma import. Click reseteaza preview/dosar rows/error/title/filter + goleste fileInput, fara confirmare suplimentara — flow-ul e non-destructive (preview-ul nu inseamna inca commit in DB).",
      },
      {
        title: "Frontend + backend - normalizare UPPERCASE pe import",
        content:
          "Numele de monitorizare se stocheaza acum UNIFORM in UPPERCASE indiferent de calea de input. PortalJust SOAP CautareDosare e case-insensitive pe numeParte, deci match-ul nu se schimba; uniformitatea elimina vizual amestecul \"AMBKEVEN SRL\" + \"global learning logistics srl\" din tabel. nameListParser.normalizeName (backend) face .toUpperCase() — defense-in-depth pe orice path care intra prin validare. monitoringBulkTemplate.ts (parser XLSX/CSV) si MonitoringAddForm.tsx (form manual) uppercaseaza la sursa. Datele vechi raman lowercase (fara migratie destructiva); randurile noi importate sunt UPPERCASE.",
      },
      {
        title: "Backend - filtru strict word match name_soap",
        content:
          "PortalJust SOAP CautareDosare returneaza dosare pe match substring pe oricare dintre cuvintele din numeParte (\"GLOBAL LEARNING LOGISTICS\" prinde si \"GLOBAL LOGISTICS SA\"). nameSoapRunner aplica acum un filtru post-fetch: un dosar e pastrat doar daca exista o parte (dosar.parti[i].nume) ai carei tokeni contin TOATE tokenii numelui monitorizat. Match-ul e strict pe egalitate de tokeni (nu substring), case-insensitive, fara diacritice. Caracterul & e promovat ca token de sine statator: \"ABC&XYZ\" si \"ABC & XYZ\" se echivaleaza la nivel de token.",
      },
      {
        title: "Backend - exceptie suffix legal",
        content:
          "Suffix-urile legale (SRL, SA, SCA, SNC, SCS, PFA, IF pentru RO + LLC, LTD, INC pentru entitati intl) sunt eliminate de la coada listei de tokeni inainte de comparare, indiferent de forma (SRL, S.R.L., S.R.L, SRL.). Target \"GLOBAL LEARNING LOGISTICS\" matcheaza parte \"GLOBAL LEARNING LOGISTICS SRL\"; target \"X SRL\" matcheaza parte \"X\"; variatiile S.R.L. vs SRL nu mai produc false-negative.",
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
          "DosareAiAnalysisPanel verifica ai.hasAnyKey la nivel de top: cand niciuna dintre cheile Anthropic / OpenAI / Google nu este configurata, in locul celor doua panouri colapsate (Analiza AI + Analiza AI Avansata) randeaza un banner discret cu border dashed, icon Bot si textul \"Analize AI (single + multi-agent) disponibile dupa configurarea unei chei API in Setari API\". Astfel, utilizatorii noi afla ca exista feature-ul si stiu unde sa configureze cheia, fara sa vada doua butoane colapsate inutile. Cand prima cheie este salvata, panourile reapar automat.",
      },
      {
        title: "Backend",
        content:
          "Zero modificari backend. Patch frontend-only, zero schema, zero migration.",
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
    subtitle: "Review-driven hardening peste v2.6.7 - fix HTML a11y pe cardul de bulk import, derivare CADENCE_COL_LETTER din HEADERS, eroare clara la header lipsa in parser, corectare claim stale despre xlsx in docs",
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
    subtitle: "Export Monitorizare Excel + PDF cu paritate Dosare/Termene - butoane in CardHeader, builderii noi reuseaza paleta de stiluri existenta, Web Worker dispatch",
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
    subtitle: "Patch UX Monitorizare - name_soap parity (buton Dosare + target bold + label 'Nume') + swap coloane Ultima rulare / Urmatoarea verif.",
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
    subtitle: "Patch UX Monitorizare - TINTA bold, bulk import collapsible + descriere non-tehnica, template XLSX restilizat la nivelul exporturilor, nota inline italic sub TINTA",
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
    subtitle: "Patch - audit hardening (multi-agent review) finalizat: DELETE in-flight, enrichment relaxed, SSE alert_enriched, bulk delete atomic, metrici precise, xlsx -> exceljs, fail-closed remote",
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
          "<a target=\"_blank\"> catre portal.just.ro/SitePages/cautare.aspx?k=<numar> via getPortalJustUrl helper, cu icon ExternalLink 12px.",
          "Buton 24x24 cu icon Search langa numar -> onOpenDosar(numar) -> handleHistoryClick(\"dosare\", { numarDosar }) -> pendingSearch -> tab Dosare cu auto-search.",
          "Aplicabil doar joburilor dosar_soap (numar canonic care intra in URL). name_soap / aviz_rnpm raman plain text.",
        ],
      },
      {
        title: "Monitorizare - dropdown cadenta onest pentru valori non-standard",
        content:
          "Dropdown-ul nu mai minte: cand cadence_sec din DB nu e in {4h, 8h, 12h, 24h}, prepende un option \"<valoare> (custom)\" cu border amber, in loc sa afiseze fals \"4h\".",
        bullets: [
          "Bug investigat empiric: job 1234/180/2024 (smoke-hardening leftover) avea cadence_sec=600 (10min) in DB; UI afisa silent \"4h\" iar runner-ul folosea valoarea reala -> next_run = last_run + 10min, nu + 4h.",
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
        content:
          "Cardul de alerta scade cu inca un pixel pe toata scara slider-ului fata de v2.6.2.",
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
          "Smoke: TINTA dosar_soap deschide portal.just.ro + butonul Search navigheaza in Dosare; dropdown afiseaza \"10min (custom)\" cu amber pe job-ul cu cadenta non-standard; selectia \"4h\" normalizeaza la 14400 dupa refresh; paginare Alerte identica vizual cu Cautare Dosare; zoom card reactiv la slider.",
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
          "<a target=\"_blank\"> catre portal.just.ro/SitePages/cautare.aspx?k=<numar> via getPortalJustUrl helper - whitelist .just.ro deja activ in setWindowOpenHandler + shell.openExternal.",
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
          "Apel app.setAppUserModelId(\"ro.legaldashboard.app\") inainte de orice fereastra, ca Windows sa asocieze procesul cu icon-ul real.",
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
        content:
          "Doua refuzuri 409 prevenirea blocarii adminului de a iesi singur din sistem.",
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
        content:
          "Trei pagini noi sub /admin/*, fiecare wrapped in AdminGate.",
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
        content:
          "Fix corectitudine pe seria daily si totalurile 30 zile, plus retention automat pentru ai_usage.",
        bullets: [
          "Toate query-urile pe fereastra de timp folosesc acum ts >= ? (closed lower bound) - fix off-by-one pentru randuri care aterizeaza exact la since.",
          "summary30d aliniat la aceeasi fereastra UTC-midnight ca seria daily (era now − 30×24h, mismatched cu bucket-urile zilnice).",
          "Handler /api/v1/ai-usage/summary wrapped in withMaintenanceRead pentru cooperare cu daily backup writer.",
          "Functie noua purgeOldAiUsage(90) in scheduler-ul zilnic alaturi de purgeOldRuns, cu try/catch independent.",
        ],
      },
      {
        title: "Cancellation + shutdown safety",
        content:
          "Multi-agent flow nu mai lasa siblings idle si DB-ul nu mai poate fi redeschis post-shutdown.",
        bullets: [
          "Multi-agent: analystsAbort AbortController shared - un analist esuat anuleaza sibling-ul, evita 180s timeout idle.",
          "signal? AbortSignal propagat in callAnthropic, callOpenAI, callGoogle si callModel; compus cu timeout intern via AbortSignal.any.",
          "markShuttingDown() latch one-way: getDb() arunca daca este apelat post-shutdown - previne late recordAiUsageSafely microtasks de a redeschide DB-ul.",
          "Token extraction din SDK error objects: usageInput/usageOutput sunt acum populate din e.usage cand SDK-ul arunca dar a contorizat partial.",
        ],
      },
      {
        title: "Safety + observability",
        content:
          "Logging structurat + clamps defensive ca log-ul sa ramana curat la valori out-of-range.",
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
        content:
          "Setari API include acum vizibilitate pe costul AI pentru userul curent.",
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
        content:
          "Doua probleme observabile au fost reparate plus cateva sterse din lipsa de utilitate.",
        bullets: [
          "Fix bug timezone in filtrele de data: pentru un user UTC+3 selectarea zilei \"30 Apr\" rata 3 ore de alerte din ziua respectiva. Filtrele construiesc acum fereastra in local time corect.",
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
        content:
          "Alertele noi trimit notificare nativa din Electron main process prin IPC ingust.",
        bullets: [
          "Renderer-ul cheama desktopApi.showNotification, iar main process foloseste new Notification.",
          "Fallback Web Notification ramane doar pentru dev/web.",
          "Input-ul notificarii este capat ca dimensiune in main process.",
        ],
      },
      {
        title: "Backend API",
        content:
          "Rute owner-scoped pentru inbox: GET /api/v1/alerts, PATCH seen/dismissed si stream SSE.",
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
        content:
          "Race-urile semnalate in review au fost inchise local, fara schimbare de arhitectura.",
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
          "Finalize state-guarded + index unic — un singur run \"running\" simultan per job de monitoring, garantat la nivel de DB (idx_one_running_per_job, migration 0005). Daca scheduler-ul ar reseta in timpul unei executii, recovery-ul nu mai poate produce duplicate.",
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
          "Vite worker.format=\"es\" permite code-splitting (xlsx + jspdf chunk-uri lazy), pastrand bundle-ul principal sub 400 KB.",
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
          "PR-3 a livrat schema + UI-ul de monitorizare; PR-4 aduce inima sistemului: scheduler-ul. Tick la 60 secunde, claim_limit 25 joburi/tick, runner separat per kind — la momentul livrarii, kind-ul \"dosar_soap\" e implementat (interogheaza PortalJust prin SOAP). Adaugarea unui dosar la monitorizare cu cadenta 10 minute / 1 ora / 6 ore / 24 ore inseamna acum verificari reale, nu doar marcarea jobului.",
        bullets: [
          "Claim atomic via UPDATE...RETURNING cu WHERE next_run_at <= now() — doi scheduleri pe aceeasi DB (rare, dar posibil) nu pick-uiesc acelasi job de doua ori.",
          "Backoff exponential pe esecuri SOAP cu jitter — daca PortalJust e jos, retry-urile nu il bombardeaza din nou la fiecare tick.",
          "Recovery la pornire — runs lasate in starea \"running\" la oprire brusca sunt finalizate cu status=\"aborted\" la primul boot, fara double-spending.",
          "Kill switch operational — MONITORING_DISABLED_KINDS=dosar_soap,name_soap exclude tipurile listate din claim, fara modificari in DB. Util cand un kind cauzeaza probleme si vrei sa il opresti instant.",
        ],
      },
      {
        title: "Detectie schimbari + alerte deduplicate",
        content:
          "Snapshot-urile sunt salvate cu hash determinist si comparate cu ultimul snapshot \"verde\". Diff-ul detecteaza adaugari/stergeri/modificari de termene si genereaza alerte in monitoring_alerts cu dedup_key — daca un termen e schimbat de cinci ori la rand, primesti o alerta cumulativa, nu cinci.",
        bullets: [
          "Sedinta key include stadiul (Apel/Fond/Recurs) — schimbarea instantei produce alerta separata, nu o suprascrie tacut.",
          "Backfill snapshot la primul rul al jobului — al doilea run e prima ocazie de comparat, deci nu se trimite alerta \"Adaugat\" pentru toata starea initiala.",
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
        title: "Tab nou \"Monitorizare\" — adauga dosare urmarite automat",
        content:
          "Noua sectiune din sidebar permite adaugarea unui dosar pentru verificare recurenta. Selectezi cadenta (10 minute, 1 ora, 6 ore sau 24 ore) si dosarul intra in coada. La fel, in pagina Cautare Dosare, in panoul detaliat al fiecarui dosar gasesti acum butonul \"Monitorizeaza schimbari\" — un click si dosarul e in lista de monitorizare, fara sa duplici cautari.",
        bullets: [
          "Idempotent la double-click: doua click-uri rapide pe acelasi dosar nu creeaza doua joburi — feedback inline iti spune \"Adaugat\" sau \"Deja monitorizat\".",
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
        title: "Tabele auth introduse ca \"schela\" (users / user_sessions)",
        content:
          "Pregatim infrastructura pentru modul web (login Google Workspace, planificat in PR-9) fara sa schimbam comportamentul desktop. Pe instalare locala ramane un singur user sintetic — \"local\" — la fel ca pana acum.",
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
          "Toate rutele citesc acum owner_id-ul curent printr-un singur helper (c.get(\"ownerId\")). Pe desktop e hardcoded \"local\"; in PR-9 va fi inlocuit cu id-ul user-ului din JWT — zero refactor pe rute, doar implementarea helper-ului se schimba.",
      },
      {
        title: "Inchidere a 5 cai latente prin care un user ar fi putut vedea date altui user",
        content:
          "loadAvizChildren (creditori / debitori / bunuri / istoric) cerea copiii doar dupa aviz_id, fara constraint pe owner_id. Daca s-ar fi produs vreodata un FK breach (bug de migrare, restore partial), randul user-ului B ar fi ajuns la user-ul A. Toate cele 4 query-uri cer acum AND owner_id = ? si pasa explicit aviz.owner_id. Sub-clauzele EXISTS din getAvize sunt si ele filtrate pe owner_id.",
      },
      {
        title: "Test de regresie pentru izolare",
        content:
          "Suite-ul nou repository-isolation.test.ts forjeaza copii cu owner_id mismatch (raw INSERT) si verifica ca nicio metoda din avizRepository nu-i returneaza. 8 teste noi → 85 in total. Pe desktop comportamentul e identic — singurul owner_id activ ramane \"local\".",
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
          "Helper isTimeoutOrAbort(e) detecteaza timeout/abort inclusiv pe subclase SDK (Anthropic / OpenAI APIUserAbortError / APIConnectionTimeoutError) care nu seteaza e.name = TimeoutError. Inainte branch-ul errorType: \"timeout\" era practic dead pentru aceste cazuri.",
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
          "logBackupEvent (single-line JSON, ts auto) inlocuieste console.log ad-hoc; daily_backup_failed distinge stage: \"mkdir\" vs \"backup\"; sterge sidecar -wal/-shm cu logging non-ENOENT (EBUSY de la AV pe Windows nu mai e silentios).",
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
          "Spike in RnpmSearch.tsx care threading existingGcode din runSearch precedent a generat in backend phase: \"search_retry\" (gap 16.4s, captcha re-solve), nu phase: \"search\" direct.",
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
          "Helper withAiLogging imbraca callAnthropic / callOpenAI / callGoogle si emite { action: \"ai_call\", provider, model, latencyMs, status, errorType?, ts }.",
          "TimeoutError si AbortError sunt normalizate la errorType: \"timeout\" ca log scrapers sa nu trebuiasca sa special-case-uieze ambele.",
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
          "Butonul nou „Export PDF\" din pagina Changelog genereaza un document portrait A4 cu tot istoricul (versiune + data + subtitlu + sectiuni + bulleturi) pentru cine vrea sa-l citeasca in afara aplicatiei.",
        bullets: [
          "frontend/src/lib/changelog-pdf.ts — jsPDF dynamic import, auto page-break, page numbering, strip diacritics pentru compatibilitate Helvetica",
          "Button dedicat in Changelog.tsx (Download icon) cu stare „Se genereaza...\" pe durata randarii",
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
        title: "RNPM — auto-loop „Incarca tot\" (pe modelul cautarii de dosare)",
        content:
          "Butonul „Incarca mai multe\" devenea tedios pentru cautari cu sute/mii de rezultate. Inlocuit cu buton unic „Incarca tot\" care face auto-loop pe batch-uri de 25 pana cand utilizatorul opreste sau se termina paginile RNPM.",
        bullets: [
          "useEffect re-declanseaza loadNextBatch() dupa fiecare batch completat, pana cand nextRnpmPage devine null",
          "Buton single (Start / Opreste incarcarea) cu contor „X din TOTAL\" in text — paritate vizuala cu cautarea de dosare",
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
          "style={{ contentVisibility: \"auto\", containIntrinsicSize: \"auto 150px\" }} pe fiecare card bun",
          "Chromium decide singur ce iese din viewport si skip-uieste rendering-ul — click-to-render din ~800ms → imperceptibil",
          "Zero dependente noi — regula confirmata ca default-ul pentru liste mari viitoare in renderer (preferat fata de virtualization libs)",
        ],
      },
      {
        title: "Sterge baza — acum elibereaza efectiv spatiul pe disc",
        content:
          "Dupa „Sterge baza\" contoarele aratau 0 avize dar fisierul ramanea la ~112 MB. SQLite DELETE marcheaza doar pagini libere intern — nu returneaza spatiul pe disc fara VACUUM. Acum endpoint-ul ruleaza compact dupa stergere.",
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
          "console.log „[rnpm/search] aborted by client\" ramane pentru observabilitate",
          "UI-ul nu vede 499: fetch-ul este aruncat cu AbortError inainte de primirea raspunsului (suprimat via ctl.signal.aborted)",
          "Statisticile 500 devin curate — reflecta doar esec real (captcha, upstream down, parse fail)",
        ],
      },
      {
        title: "Verificare",
        content:
          "npx tsc --noEmit — clean pe ambele workspace-uri. Verificare manuala in Electron: auto-load pe cautari cu 200+ rezultate (Stop la mijloc + reluare), „Sterge baza\" cu observare dimensiune fisier .db inainte/dupa, abort in mijlocul batch-ului (backend scrie 499 in logs, UI ramane curat).",
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
        content:
          "Zona de actiuni din modalul 'Info baza locala' reorganizata:",
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
        content:
          "Cresterea defense-in-depth pe procesul principal:",
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
        content:
          "Threat model si configurare documentate la radacina repo-ului pentru operatori si cititori viitori:",
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
        content:
          "Filtrele pe tab-ul Baza locala extinse cu interval de date; migrari idempotente pe SQLite:",
        bullets: [
          "Filtru data: doua <input type='date'> (de la / pana la) cu reset. Coloana data stocata 'dd.mm.yyyy' (format RNPM) → conversia in ISO se face in SQL via substr()",
          "rnpm_bunuri.referinte_json: coloana noua (ALTER TABLE idempotent). Stocheaza array JSON de referinte (constituitor / tert) — deblocheaza BunRefRow in modalul detaliu cu culori distincte (sky pentru constituitor, amber pentru tert)",
          "deleteAllAvize tranzactional: sterge atat rnpm_avize (CASCADE pe creditori/debitori/bunuri/istoric) cat si rnpm_searches intr-o singura tranzactie",
          "getAvizeByIds bulk fetch (max 500 ids) — pregatire pentru export batch PDF/Excel",
        ],
      },
      {
        title: "Rafinari UI modul RNPM",
        content:
          "Mici imbunatatiri de UX pe toate cele trei tab-uri:",
        bullets: [
          "RnpmDetailModal: 5 tab-uri navigabile (General / Creditori / Debitori / Bunuri / Istoric) cu count badge per tab si scroll smooth la tab-switch",
          "RnpmSavedData: badge verde/gri activ/inactiv + dubla confirmare la 'Sterge tot' (actiune ireversibila)",
          "RnpmBulkSearch: feedback vizual per item (Loader2 → CheckCircle2 / XCircle), estimare durata + cost afisate inainte de start, hard limit 100 per batch cu warning pe depasire",
          "Categoria 5 (Aviz de ipoteca - obligatiuni ipotecare) cu formular complet: Agent PJ/PF + Emitent PJ + descriere bun garantie — chei confirmate prin captura Network pe site-ul oficial",
        ],
      },
      {
        title: "Verificare",
        content:
          "Build curat si teste verzi:",
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
        content:
          "Trei valuri de fix-uri pe modulul RNPM imediat dupa lansare:",
        bullets: [
          "Form parity completa cu site-ul oficial mj.rnpm.ro (default checkboxes 'Numai active' + 'Nemodificate de alte inscrieri', dropdown destinatii, structuri per categorie)",
          "Eroare clara cand RNPM returneaza > 1500 rezultate (limita oficiala) + re-solve captcha automat pe 410/401/403 (gcode expirat) pentru paginile ulterioare",
          "Body limits pe POST /api/rnpm/* (search 64KB, bulk 512KB), SSE timeout 10 min pe /bulk, validateParamsDepth (depth max 4, string max 500 chars)",
          "Confirm non-blocking cand CUI-ul contine non-digit; mesaje backend (status text) propagate la frontend in loc de 'Eroare server (500)' generic",
        ],
      },
      {
        title: "Audit remediation — 12/12 findings",
        content:
          "Toate cele 12 findings din auditul intern aplicate; build OK, 24/24 teste verzi:",
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
        content:
          "Formatare vizuala avansata pentru fisierele Excel exportate (similar cu stilul PDF):",
        bullets: [
          "Titlu dark blue cu text alb, headere colorate albastru, randuri alternante gri/alb",
          "Sheet Sedinte grupat pe dosare cu sectiuni clare si separatori vizuali",
          "Numar dosar bold in lista principala pentru identificare rapida",
          "Rand statistici cu numar dosare/termene si data exportului",
        ],
      },
      {
        title: "Hyperlinks Interne Excel (Bidirectionale)",
        content:
          "Navigare rapida intre sheet-urile Dosare si Sedinte direct din Excel:",
        bullets: [
          "Dosare → Sedinte: click pe numarul dosarului sare direct la prima sa sedinta",
          "Sedinte → Dosare: headerul fiecarei sectiuni are link inapoi la randul dosarului (↑)",
          "Functioneaza nativ in Microsoft Excel si LibreOffice Calc",
        ],
      },
      {
        title: "Filenames Dinamice la Export",
        content:
          "Denumirile fisierelor exportate reflect continutul (Excel si PDF):",
        bullets: [
          "1 dosar: dosar_NR-DOSAR.xlsx / dosar_NR-DOSAR.pdf",
          "Multiple dosare: dosare_DD.MM.YYYY.xlsx / dosare_DD.MM.YYYY.pdf",
          "Acelasi comportament pentru termene: termen_NR / termene_DATA",
        ],
      },
      {
        title: "Modele Claude Actualizate & Versiune Server",
        content:
          "Actualizari de infrastructura:",
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
        content:
          "Actualizare completa a modelelor Google Gemini la seria 3.x:",
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
        content:
          "Imbunatatiri de performanta si compatibilitate:",
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
        content:
          "Analiza AI si Analiza AI Avansata sunt acum sectiuni colapsabile independente, inchise by default:",
        bullets: [
          "Analiza AI — container propriu cu header, model selectors vizibili, buton si rezultat",
          "Analiza AI Avansata — container separat, independent (redenumit din \"Analiza Avansata\")",
          "Design unificat: acelasi layout (header cu download + chevron, selectoare model, buton jos)",
          "Descrierea modelului selectat (Rapid/Echilibrat/Premium) afisata langa butoane in ambele sectiuni",
        ],
      },
      {
        title: "Marire Fonturi Globala",
        content:
          "Fonturi marite cu +1-1.5px in mai multe zone ale aplicatiei:",
        bullets: [
          "Sidebar: label dimensiune text, badge Activ/Neconfigurat",
          "Istoric Cautari: header, nume cautare, rezultate + timp",
          "CalendarView: toate fonturile (card, solutie, solutieSumar, parti, badges)",
        ],
      },
      {
        title: "Consistenta Termene cu Dosare",
        content:
          "Toate imbunatatirile vizuale din Cautare Dosare aplicate si pe Termene:",
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
        content:
          "Dosarele si termenele au acum un indicator vizual care arata care au fost deschise si care nu:",
        bullets: [
          "Punct albastru animat (ping) pentru dosarele nevizualizate",
          "Iconita ochi gri pentru cele deja vizualizate (expandate)",
          "Marcare automata la expandarea randului",
          "Persistare in sessionStorage pe durata sesiunii de browser",
        ],
      },
      {
        title: "Butoane Navigare Rapida (Scroll Sus/Jos)",
        content:
          "Doua butoane floating in coltul din dreapta-jos pentru navigare rapida in pagina:",
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
          "API-ul SOAP PortalJust returneaza maxim 1000 rezultate per cerere. Noul buton \"Incarca mai multe\" scaneaza luna cu luna prin SSE (Server-Sent Events) si gaseste TOATE dosarele/termenele disponibile.",
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
          "Butonul \"Reseteaza\" sterge acum atat campurile formularului cat si toate rezultatele cautarii anterioare (tabel, metrici, selectii).",
      },
      {
        title: "Analiza Multi-Agent — Documentare Comportament Judecator",
        content:
          "Documentare completa a modului de functionare al analizei multi-agent cu AI:",
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
          "Manual complet integrat in aplicatie cu 12 capitole care acopera toate functionalitatile. Accesibil din Dashboard (buton \"Manual\" langa \"Vezi Noutati\").",
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
        content:
          "Audit de securitate pe noile functionalitati multi-agent:",
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
          "Cautare diacritice-insensitiva (ex: \"brasov\" gaseste \"Brașov\")",
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
          "Functia centralizeaza de normalizare transforma numele brute din SOAP (ex: \"TribunalulSATUMARE\") in forma corecta (\"Tribunalul Satu Mare\"). Aplicata in toate componentele: tabel dosare, tabel termene, metrici, calendar, modal detalii, export.",
      },
      {
        title: "Compatibilitate Diacritice Romanesti",
        content:
          "API-ul SOAP PortalJust foloseste varianta veche a diacriticelor romanesti (ş cu sedila, nu ș cu virgula). Backend-ul converteste automat caracterele moderne in varianta legacy inainte de trimiterea catre SOAP.",
        bullets: [
          "Cautarea cu \"Ioan Farcaș\", \"Ioan Farcaş\" sau \"Ioan Farcas\" returneaza aceleasi rezultate",
          "Analiza rolurilor din MetricsPanel foloseste matching diacritice-insensitiv",
          "Highlight-ul de nume din tabel recunoaste toate variantele de diacritice",
          "Filtrul pe roluri compara diacritice-insensitiv",
        ],
      },
      {
        title: "Securitate (Audit v1.2.1-ai)",
        content:
          "Audit complet de securitate pe backend, frontend si Electron cu urmatoarele imbunatatiri:",
        bullets: [
          "Limita maxima de 50 institutii per cerere — previne amplificarea cererilor SOAP paralele",
          "Timeout de 60 secunde pe toate apelurile AI (Anthropic, OpenAI, Google) — previne blocarea conexiunilor",
          "Validare body size reala pe /api/ai/analyze — verificare pe textul efectiv, nu pe header-ul Content-Length",
          "Validare chei API — string-uri cu maxim 256 caractere, previne obiecte sau payload-uri mari",
          "encodeURIComponent() pe toate URL-urile portal.just.ro construite din numere de dosar — previne URL injection",
          "Verificare identitate backend la pornire Electron — health check confirma ca raspunsul vine de la PortalJust API, nu de la alt proces pe portul 3001",
          "Validare URL stricta in Electron — shell.openExternal() foloseste new URL() parser si verifica hostname.endsWith(\".just.ro\")",
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
        content:
          "Aceasta versiune include un audit complet de securitate cu urmatoarele imbunatatiri:",
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
        content:
          "Conectare la API-ul SOAP PortalJust.ro al Ministerului Justitiei.",
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
        content:
          "Aplicatia a fost construita cu un set complet de masuri de securitate inca de la prima versiune:",
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
