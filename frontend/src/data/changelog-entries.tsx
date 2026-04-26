import { Sparkles, Palette, Rocket, Shield, Building2, BrainCircuit, ShieldCheck, MousePointerClick, Layers, CalendarSearch, FileSpreadsheet, Lock, Wrench } from "lucide-react";

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
