import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Sparkles, Palette, Rocket, Shield, Building2, BrainCircuit, ShieldCheck, MousePointerClick, Layers, CalendarSearch, FileSpreadsheet } from "lucide-react";

interface ChangeSection {
  title: string;
  content: string;
  bullets?: string[];
}

interface VersionEntry {
  version: string;
  date: string;
  subtitle?: string;
  icon: React.ReactNode;
  borderColor: string;
  badgeClass: string;
  sections: ChangeSection[];
}

const versions: VersionEntry[] = [
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

export default function Changelog() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Page Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ScrollText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Changelog</h1>
            <p className="text-sm text-foreground">
              Istoricul complet al modificarilor si imbunatatirilor aduse aplicatiei
            </p>
          </div>
        </div>
      </div>

      {/* Version Cards */}
      <div className="space-y-6">
        {versions.map((v) => (
          <Card key={v.version} className={`border-l-4 ${v.borderColor}`}>
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className={v.badgeClass}>
                  {v.icon}
                  <span className="ml-1.5 text-sm font-bold">{v.version}</span>
                </Badge>
                <span className="text-sm text-foreground">{v.date}</span>
                {v.subtitle && (
                  <Badge variant="outline" className="font-medium">
                    {v.subtitle}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {v.sections.map((section, idx) => (
                <div key={idx}>
                  <h3 className="mb-1.5 text-base font-semibold text-foreground">
                    {section.title}
                  </h3>
                  {section.content && (
                    <p className="text-sm leading-relaxed text-foreground">
                      {section.content}
                    </p>
                  )}
                  {section.bullets && (
                    <ul className="mt-2 space-y-1 pl-4">
                      {section.bullets.map((bullet, bIdx) => (
                        <li
                          key={bIdx}
                          className="list-disc text-sm leading-relaxed text-foreground marker:text-foreground/50"
                        >
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
