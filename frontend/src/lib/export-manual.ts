// User manual PDF builder. Extracted from lib/export.ts (Stage 7) so the
// ~450 LOC of chapter content + jsPDF layout no longer dominates export.ts.
//
// Loaded by export.worker.ts on demand (`manualPdf` job kind). The orchestrator
// `exportManualPDF` stays in export.ts because all DOM-bound orchestrators
// share `runExportInWorker` there.

import { MIME_PDF, stripDiacritics, type ExportResult } from "./pdf-helpers";

export async function buildManualPdf(): Promise<ExportResult> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = 0;

  const primaryDark: [number, number, number] = [31, 41, 55];
  const textDark: [number, number, number] = [41, 37, 36];
  const textMuted: [number, number, number] = [120, 113, 108];
  const accent: [number, number, number] = [37, 99, 235];
  const borderColor: [number, number, number] = [214, 211, 209];
  const bgLight: [number, number, number] = [250, 250, 249];

  const checkPageBreak = (needed: number) => {
    if (y + needed > pageHeight - 20) {
      doc.addPage();
      y = 18;
    }
  };

  const addWrappedText = (text: string, fontSize: number, style = "normal", color: [number, number, number] = textDark, xOffset = 0, maxW?: number) => {
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", style);
    doc.setTextColor(...color);
    const w = maxW || (contentWidth - xOffset);
    const lines = doc.splitTextToSize(stripDiacritics(text), w);
    const lineHeight = fontSize * 0.42;
    for (const line of lines) {
      checkPageBreak(lineHeight + 2);
      doc.text(line, margin + xOffset, y);
      y += lineHeight;
    }
  };

  const addHeading = (text: string, level: 1 | 2 | 3 = 1) => {
    const sizes = { 1: 14, 2: 11.5, 3: 10 };
    const spacing = { 1: 8, 2: 6, 3: 4 };
    checkPageBreak(spacing[level] + 16);
    y += spacing[level];

    if (level === 1) {
      // Blue accent bar for main sections
      doc.setFillColor(...accent);
      doc.rect(margin, y - 4, 2.5, 7, "F");
    }

    doc.setFontSize(sizes[level]);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...primaryDark);
    doc.text(stripDiacritics(text), level === 1 ? margin + 6 : margin, y);
    y += level === 1 ? 7 : 5;
  };

  const addParagraph = (text: string) => {
    addWrappedText(text, 9.5, "normal", textDark);
    y += 2;
  };

  const addBullet = (text: string, indent = 4) => {
    checkPageBreak(6);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...textMuted);
    doc.text("-", margin + indent, y);
    addWrappedText(text, 9, "normal", textDark, indent + 4);
    y += 1;
  };

  // ========== COVER PAGE ==========
  y = 60;
  doc.setFillColor(...accent);
  doc.rect(margin, y - 2, contentWidth, 1.5, "F");

  y += 12;
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...primaryDark);
  doc.text("Legal Dashboard", margin, y);

  y += 12;
  doc.setFontSize(16);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...textMuted);
  doc.text("Manual de Utilizare", margin, y);

  y += 10;
  doc.setFontSize(11);
  doc.text(`v${__APP_VERSION__}`, margin, y);

  y += 20;
  doc.setFillColor(...bgLight);
  doc.setDrawColor(...borderColor);
  doc.roundedRect(margin, y, contentWidth, 32, 2, 2, "FD");
  y += 8;
  doc.setFontSize(9.5);
  doc.setTextColor(...textDark);
  doc.text(stripDiacritics("Aplicatie desktop si web pentru cautarea si analiza dosarelor"), margin + 6, y);
  y += 5;
  doc.text(stripDiacritics("si termenelor din instantele romanesti prin API-ul public"), margin + 6, y);
  y += 5;
  doc.text(stripDiacritics("al Ministerului Justitiei (portalquery.just.ro)."), margin + 6, y);
  y += 5;
  doc.text(stripDiacritics("Include asistenta AI multi-provider pentru analiza juridica."), margin + 6, y);

  y += 16;
  doc.setFontSize(8);
  doc.setTextColor(...textMuted);
  doc.text(`Generat: ${new Date().toLocaleDateString("ro-RO")}`, margin, y);

  // ========== TABLE OF CONTENTS ==========
  doc.addPage();
  y = 18;
  addHeading("Cuprins", 1);
  y += 2;
  const chapters = [
    "1. Prezentare Generala",
    "2. Pagina Dashboard",
    "3. Cautare Dosare",
    "4. Termene & Calendar",
    "5. Incarca Mai Multe (Load More)",
    "6. Export Excel si PDF",
    "7. Analiza AI",
    "8. Analiza AI Avansata (Multi-Agent)",
    "9. Configurare Chei API",
    "10. Sidebar si Navigare",
    "11. Personalizare (Tema & Font)",
    "12. Securitate si Confidentialitate",
    "13. Monitorizare automata",
    "14. Inbox Alerte",
  ];
  for (const ch of chapters) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...textDark);
    doc.text(stripDiacritics(ch), margin + 6, y);
    y += 6;
  }

  // ========== 1. PREZENTARE GENERALA ==========
  y += 4;
  addHeading("1. Prezentare Generala");
  addParagraph("Legal Dashboard este o aplicatie desktop si web pentru cautarea si analiza dosarelor si termenelor din toate instantele romanesti. Datele sunt obtinute in timp real prin API-ul SOAP public al Ministerului Justitiei (portalquery.just.ro).");

  addHeading("Ce poti face cu aceasta aplicatie:", 2);
  addBullet("Cautare dosare dupa numar, parti implicate, obiect sau institutie");
  addBullet("Cautare termene cu interval de date si filtre avansate");
  addBullet("Vizualizare calendar pentru termene si sedinte");
  addBullet("Export rezultate in Excel (.xlsx) si PDF");
  addBullet("Analiza inteligenta a dosarelor cu AI (Claude, GPT, Gemini)");
  addBullet("Analiza avansata multi-agent cu 2 analisti si un judecator AI");
  addBullet("Filtrare pe 246 instante din Romania (Curti de Apel, Tribunale, Judecatorii)");
  addBullet("Statistici si metrici interactive pentru dosarele gasite");

  addHeading("Platforme disponibile:", 2);
  addBullet("Windows — installer NSIS (nu necesita drepturi de administrator)");
  addBullet("macOS — fisier DMG (Intel si Apple Silicon)");
  addBullet("Web — versiune standalone accesibila din browser");

  addParagraph("Sursa datelor: Toate informatiile despre dosare si termene provin exclusiv din API-ul public al Ministerului Justitiei. Aplicatia nu stocheaza dosare pe server — fiecare cautare interogheaza in timp real baza de date publica.");

  // ========== 2. DASHBOARD ==========
  addHeading("2. Pagina Dashboard");
  addParagraph("Dashboard-ul este pagina principala a aplicatiei si ofera o vedere de ansamblu.");
  addHeading("Elemente afisate:", 2);
  addBullet("Carduri de navigare rapida catre Cautare Dosare si Termene & Calendar");
  addBullet("Rezumatul ultimei cautari (numar dosare, categorii, institutii, parte cautata) — vizibil doar dupa o cautare");
  addBullet("Tipuri de procese disponibile: Penal, Civil, Contencios administrativ si fiscal, Litigii de munca, Faliment, Litigii cu profesionistii, Altele");
  addBullet("Informatii API — endpoint-ul SOAP, metodele disponibile, limita de 1000 rezultate per cerere");
  addBullet("Versiunea aplicatiei cu buton \"Vezi Noutati\" (changelog) si \"Manual\" (acest document)");

  // ========== 3. CAUTARE DOSARE ==========
  addHeading("3. Cautare Dosare");

  addHeading("Campuri de cautare:", 2);
  addBullet("Numar dosar — formatul standard (ex: 27405/245/2025)");
  addBullet("Obiect dosar — text liber pentru obiectul cauzei");
  addBullet("Nume parte — numele unei parti implicate (cautare independenta de ordinea cuvintelor)");
  addBullet("Institutie — selector multi-select cu 246 instante din Romania, grupate pe categorii");
  addBullet("Data de la / Data pana la — interval de date pentru filtrarea rezultatelor");

  addHeading("Selector Institutii:", 2);
  addParagraph("Apasand pe campul \"Institutie\" se deschide un dialog modal cu toate cele 246 instante grupate pe categorii:");
  addBullet("Curti de Apel (15), Tribunale (42), Tribunale Specializate (1)");
  addBullet("Tribunale Comerciale (3), Tribunale Militare (5), Curti Militare (1), Judecatorii (179)");
  addBullet("Cautare rapida cu suport diacritice (\"brasov\" gaseste \"Brasov\")");
  addBullet("Selectie multipla — se pot alege mai multe institutii simultan");
  addBullet("Cautarea se trimite paralel catre toate institutiile selectate");

  addHeading("Filtre client-side (dupa cautare):", 2);
  addParagraph("Dupa primirea rezultatelor, poti filtra suplimentar fara a face o noua cerere:");
  addBullet("Categorii — Penal, Civil, Contencios etc. (selectie multipla)");
  addBullet("Stadii procesuale — Fond, Apel, Recurs etc. (selectie multipla)");
  addBullet("Institutii — modificarea selectiei dupa cautare aplica filtru client-side instant");

  addHeading("Tabelul de rezultate:", 2);
  addBullet("Coloane sortabile: numar dosar, data, institutie (click pe header pentru sortare)");
  addBullet("Paginare cu selector: 10, 15, 25, 50 sau 100 rezultate pe pagina");
  addBullet("Navigare directa la prima/ultima pagina");
  addBullet("Checkbox pe fiecare rand pentru selectie individuala");
  addBullet("Select All selecteaza toate dosarele de pe pagina curenta");
  addBullet("Randurile selectate sunt evidientiate vizual cu fundal violet");

  addHeading("Detalii dosar (rand expandabil):", 2);
  addParagraph("Click pe un rand din tabel deschide detaliile complete:");
  addBullet("Informatii generale: Data, Departament, Categorie, Stadiu (cu badge-uri colorate)");
  addBullet("Obiectul dosarului");
  addBullet("Lista partilor — cu badge calitate (Reclamant, Parat, etc.) si highlight pe numele cautat");
  addBullet("Istoric sedinte — timeline vertical cu data, ora, complet, solutie, document");
  addBullet("Link direct catre dosarul de pe portal.just.ro");
  addBullet("Buton Analiza AI (daca ai cel putin o cheie API configurata)");

  addHeading("Metrici interactive:", 2);
  addParagraph("Deasupra tabelului sunt afisate carduri cu statistici. Click pe un card aplica filtrul corespunzator:");
  addBullet("Total dosare (reseteaza toate filtrele)");
  addBullet("Distributie pe categorii de caz");
  addBullet("Distributie pe stadii procesuale");
  addBullet("Analiza parti — roluri si numar aparitii per parte");

  addHeading("Butonul Reseteaza:", 2);
  addParagraph("Apare in formularul de cautare cand cel putin un camp este completat. La apasare, sterge atat campurile formularului cat si toate rezultatele cautarii anterioare (tabel, metrici, filtre selectate).");

  // ========== 4. TERMENE & CALENDAR ==========
  addHeading("4. Termene & Calendar");

  addHeading("Cautare termene:", 2);
  addParagraph("Formularul de cautare este similar cu cel de la Dosare. Rezultatele sunt termenele de judecata extrase din dosarele gasite.");

  addHeading("Vizualizare duala:", 2);
  addBullet("Tabel — lista cu toate termenele, sortabila si paginata (10, 20, 50, 100 pe pagina)");
  addBullet("Calendar — vizualizare lunara cu termenele plasate pe zilele corespunzatoare");
  addBullet("Comutare intre cele doua vizualizari cu un buton toggle");

  addHeading("Metrici filtrabile:", 2);
  addBullet("Total termene (reseteaza filtrele)");
  addBullet("Termene viitoare (dupa data curenta)");
  addBullet("Termene trecute");
  addBullet("Cu solutie (termene care au o solutie inregistrata)");
  addBullet("Filtrele functioneaza in logica OR — selectia multipla include orice termen care se potriveste cel putin unui filtru");

  addHeading("Detalii termen (rand expandabil):", 2);
  addBullet("Categorie si Stadiu procesual");
  addBullet("Obiectul dosarului");
  addBullet("Solutia completa cu sumarul integral");
  addBullet("Lista de parti cu badge calitate si highlight nume");

  addHeading("Vizualizare Calendar:", 2);
  addBullet("Navigare luna cu luna (inainte/inapoi)");
  addBullet("Termenele apar pe zilele corespunzatoare cu numar dosar si institutie");
  addBullet("Numerele de dosar sunt linkuri directe catre portal.just.ro");
  addBullet("Click pe un card deschide detalii: solutie si lista parti");

  // ========== 5. LOAD MORE ==========
  addHeading("5. Incarca Mai Multe (Load More)");
  addParagraph("API-ul Ministerului Justitiei returneaza maxim 1000 de rezultate per cerere. Daca cautarea ta are mai multe rezultate, butonul \"Incarca mai multe\" iti permite sa le obtii pe toate.");

  addHeading("Cum functioneaza:", 2);
  addBullet("Dupa o cautare initiala care returneaza 1000 de rezultate, apare butonul \"Incarca mai multe\"");
  addBullet("La apasare, aplicatia scaneaza luna cu luna intregul interval de date");
  addBullet("Daca o luna are mai mult de 1000 rezultate, intervalul se subdivide automat in perioade mai mici");
  addBullet("Rezultatele noi apar in tabel in timp real (nu trebuie sa astepti sa se termine scanarea)");
  addBullet("Bara de progres arata cate dosare/termene NOI au fost gasite");

  addHeading("Deduplicare inteligenta:", 2);
  addParagraph("Aplicatia trimite catre server lista dosarelor deja existente, iar serverul returneaza doar dosarele noi. Astfel, nu se descarca de doua ori aceleasi dosare, iar contorul de progres reflecta numarul real de dosare noi gasite.");

  addHeading("Oprire si continuare:", 2);
  addBullet("Butonul STOP opreste scanarea in orice moment");
  addBullet("Toate rezultatele gasite pana la oprire sunt pastrate (nu se pierde nimic)");
  addBullet("Poti naviga intre taburile Dosare si Termene fara sa se opreasca procesul — operatia continua in fundal");
  addBullet("La revenirea pe tab, vei vedea rezultatele actualizate");

  addHeading("Limite de siguranta:", 2);
  addBullet("Maxim 120 intervale lunare per scanare (~10 ani)");
  addBullet("Timeout de 10 minute per sesiune de scanare");

  // ========== 6. EXPORT ==========
  addHeading("6. Export Excel si PDF");

  addHeading("Export Excel (.xlsx):", 2);
  addBullet("Dosare: genereaza 2 foi (sheet-uri) — \"Dosare\" cu informatiile de baza si \"Sedinte\" cu toate sedintele");
  addBullet("Termene: 1 foaie cu 7 coloane (numar dosar, data, ora, institutie, complet, solutie, sumar)");
  addBullet("Coloanele sunt auto-dimensionate pentru lizibilitate");

  addHeading("Export PDF:", 2);
  addBullet("Dosare si Termene: format Landscape A4 cu tabel, header colorat, paginare automata");
  addBullet("Analize AI: format Portrait A4 cu design profesional, formatare markdown, footer pe fiecare pagina");

  addHeading("Export selectiv:", 2);
  addParagraph("Daca ai selectat dosare/termene cu checkbox, butoanele de export arata numarul selectat (ex: \"Excel (3)\") si exporta doar elementele selectate. Daca nu selectezi nimic, se exporta toate rezultatele.");

  // ========== 7. AI ==========
  addHeading("7. Analiza AI");
  addParagraph("Aplicatia ofera analiza inteligenta a dosarelor folosind modele AI de ultima generatie. Pentru a folosi aceasta functie, trebuie sa configurezi cel putin o cheie API (vezi sectiunea 9).");

  addHeading("Cum se foloseste:", 2);
  addBullet("Deschide detaliile unui dosar (click pe rand in tabel)");
  addBullet("Selecteaza modelul AI dorit din dropdown-ul de modele");
  addBullet("Apasa butonul \"Analizeaza cu AI\"");
  addBullet("Analiza se genereaza in cateva secunde si apare sub detaliile dosarului");
  addBullet("Poti regenera analiza cu un alt model sau ascunde/arata rezultatul");

  addHeading("Modele disponibile:", 2);
  addParagraph("Anthropic (Claude): Haiku 4.5 (Rapid), Sonnet 4.6 (Echilibrat), Opus 4.6 (Premium)");
  addParagraph("OpenAI (GPT): GPT-5.4 nano (Rapid), GPT-5.4 mini (Echilibrat), GPT-5.4 (Premium)");
  addParagraph("Google (Gemini): Gemini 3.1 Lite (Rapid), Gemini 3 Flash (Echilibrat), Gemini 3.1 Pro (Premium)");

  addHeading("Structura analizei (7 sectiuni):", 2);
  addBullet("Rezumatul dosarului — descriere sintetica a cauzei");
  addBullet("Explicatia partilor — cine sunt partile si ce rol au");
  addBullet("Starea actuala a procesului — in ce faza se afla");
  addBullet("Istoricul sedintelor — ce s-a intamplat la fiecare sedinta");
  addBullet("Ce ar putea urma — posibilii pasi urmatori");
  addBullet("Temei juridic — articole de lege relevante pentru cauza");
  addBullet("Legaturi cu alte dosare — daca exista conexiuni cu alte cauze");

  addHeading("Export analiza PDF:", 2);
  addParagraph("Dupa generarea analizei, apare un buton de export PDF. Documentul generat include: header cu titlu, card cu informatiile dosarului, continutul analizei cu formatare profesionala si footer pe fiecare pagina.");

  // ========== 8. MULTI-AGENT ==========
  addHeading("8. Analiza AI Avansata (Multi-Agent)");
  addParagraph("Analiza avansata foloseste 3 modele AI simultan pentru o analiza mai completa si verificata.");

  addHeading("Cum functioneaza:", 2);
  addBullet("Selecteaza 2 modele \"Analist\" — acestea analizeaza dosarul independent si in paralel");
  addBullet("Selecteaza 1 model \"Judecator\" — acesta primeste ambele analize si le reconciliaza");
  addBullet("Nu se poate selecta acelasi model de doua ori");
  addBullet("Modelele judecator sunt restrictionate la modele premium: Claude Opus 4.6, GPT-5.4 sau Gemini 3.1 Pro");

  addHeading("Rolul judecatorului AI:", 2);
  addBullet("Primeste datele complete ale dosarului plus cele 2 analize independente");
  addBullet("Verifica afirmatiile analistilor contra datelor originale ale dosarului");
  addBullet("Corecteaza interpretarile gresite si adauga aspecte omise de ambii analisti");
  addBullet("Reconciliaza contradictiile alegand interpretarea sustinuta de datele reale");
  addBullet("Prezinta explicit in analiza finala ce reconcilieri a facut intre cele doua analize");
  addBullet("Rezultatul final este prezentat ca o analiza unitara coerenta");

  addHeading("Vizualizare rezultate:", 2);
  addBullet("Analiza finala a judecatorului este afisata principal");
  addBullet("Toggle \"Vizualizare analize individuale\" — arata cele 2 analize side-by-side");
  addBullet("Export PDF disponibil pentru analiza finala (include mentiunea modelului judecator)");

  // ========== 9. CHEI API ==========
  addHeading("9. Configurare Chei API");
  addParagraph("Pentru a folosi analiza AI, trebuie sa configurezi cel putin o cheie API de la un furnizor AI. Cheile sunt gratuite la inregistrare pentru un volum limitat de cereri.");

  addHeading("Cum se configureaza:", 2);
  addBullet("Apasa pe \"Setari API\" din sidebar (iconita Bot)");
  addBullet("Introdu cheia API pentru furnizorul dorit (Anthropic, OpenAI sau Google)");
  addBullet("Apasa \"Salveaza\" — cheia este stocata local pe calculatorul tau");
  addBullet("Indicatorul din sidebar devine verde cand cel putin o cheie este activa");
  addBullet("Poti configura cheile pentru mai multi furnizori simultan");
  addBullet("Pentru a sterge o cheie, apasa \"Sterge cheia\" sub campul respectiv");

  addHeading("Securitatea cheilor:", 2);
  addBullet("Cheile sunt stocate doar local (in browser-ul aplicatiei), nu pe niciun server extern");
  addBullet("Cheile sunt obfuscate in localStorage (nu sunt stocate ca text simplu)");
  addBullet("La fiecare cerere AI, cheia este trimisa doar catre API-ul furnizorului respectiv");
  addBullet("Cheile persista intre sesiuni — nu trebuie reintroduse la fiecare pornire a aplicatiei");

  addHeading("De unde obtii chei API:", 2);
  addBullet("Anthropic (Claude): console.anthropic.com");
  addBullet("OpenAI (GPT): platform.openai.com");
  addBullet("Google (Gemini): aistudio.google.com");

  // ========== 10. SIDEBAR ==========
  addHeading("10. Sidebar si Navigare");

  addHeading("Meniu de navigare:", 2);
  addBullet("Dashboard — pagina principala cu rezumat si navigare rapida");
  addBullet("Cautare Dosare — formularul si tabelul de dosare");
  addBullet("Termene & Calendar — formularul, tabelul si calendarul de termene");

  addHeading("Istoric cautari:", 2);
  addBullet("Se salveaza automat ultimele 15 cautari efectuate");
  addBullet("Fiecare intrare arata: tipul cautarii (dosare/termene), parametrii, numarul de rezultate, cat timp a trecut");
  addBullet("Click pe o intrare navigheaza automat la pagina corespunzatoare si re-executa cautarea");
  addBullet("Stergere individuala (buton X la hover) sau stergere totala (iconita cos de gunoi)");
  addBullet("In modul sidebar colapsat, istoricul apare intr-un popover la click pe iconita");

  addHeading("Navigare persistenta:", 2);
  addParagraph("Paginile Dosare si Termene raman active in fundal chiar daca navighezi pe alt tab. Aceasta inseamna ca:");
  addBullet("O operatie \"Incarca mai multe\" in curs NU se opreste la navigare");
  addBullet("Campurile completate in formularul de cautare se pastreaza");
  addBullet("Rezultatele cautarii sunt disponibile la revenire, fara a reface cautarea");

  addHeading("Colapsare sidebar:", 2);
  addParagraph("Butonul \"Inchide meniu\" din partea de jos reduce sidebar-ul la 64px, lasand mai mult spatiu pentru continut. In modul colapsat, navigarea si setarile sunt accesibile prin iconite cu tooltip.");

  // ========== 11. PERSONALIZARE ==========
  addHeading("11. Personalizare (Tema & Font)");

  addHeading("Tema vizuala:", 2);
  addBullet("Mod Luminos (Light) si Mod Inchis (Dark) — toggle din sidebar");
  addBullet("Detecteaza automat preferinta sistemului de operare la prima utilizare");
  addBullet("Setarea se salveaza si persista intre sesiuni");

  addHeading("Dimensiune text:", 2);
  addBullet("4 trepte disponibile: Mic (16px), Normal (18px), Mare (20px), Extra (22px)");
  addBullet("Control din sidebar cu butoane A-/A+ si indicator vizual (puncte)");
  addBullet("Afecteaza toata aplicatia (tabel, formulare, butoane, metrici)");
  addBullet("Setarea se salveaza si persista intre sesiuni");

  addHeading("Meniu contextual (click dreapta):", 2);
  addParagraph("In aplicatia desktop, click dreapta afiseaza un meniu cu optiunile:");
  addBullet("Copiaza — doar cand exista text selectat");
  addBullet("Selecteaza tot");
  addBullet("Printeaza");

  // ========== 12. SECURITATE ==========
  addHeading("12. Securitate si Confidentialitate");

  addHeading("Unde sunt datele tale:", 2);
  addBullet("Cheile API sunt stocate doar local pe calculatorul tau (in localStorage, obfuscate)");
  addBullet("Istoricul cautarilor este salvat doar local");
  addBullet("Preferintele (tema, font) sunt salvate doar local");
  addBullet("Nu exista niciun server intermediar — datele merg direct de la calculatorul tau catre API-urile oficiale");
  addBullet("Dosarele si termenele sunt date publice obtinute din API-ul Ministerului Justitiei");

  addHeading("Protectii implementate:", 2);
  addBullet("Validare completa a tuturor datelor de intrare (lungime, format, caractere speciale)");
  addBullet("Protectie XSS (Cross-Site Scripting) pe toate continuturile afisate, inclusiv raspunsurile AI");
  addBullet("Protectie impotriva Prompt Injection — datele dosarelor sunt izolate in prompt-ul AI");
  addBullet("Rate limiting — maxim 30 cereri pe minut pentru prevenirea abuzurilor");
  addBullet("Serverul backend este accesibil doar local (localhost), nu din retea");
  addBullet("Linkurile externe se deschid doar catre domenii portal.just.ro verificate");
  addBullet("Content Security Policy strict in aplicatia desktop");

  addHeading("Analiza AI si confidentialitatea:", 2);
  addParagraph("Cand soliciti o analiza AI, datele dosarului (numar, obiect, parti, sedinte) sunt trimise catre furnizorul AI selectat (Anthropic, OpenAI sau Google). Aceste date sunt publice (provin din API-ul Ministerului Justitiei), dar este important sa stii ca sunt procesate de serverele furnizorului AI conform politicilor lor de confidentialitate.");

  // ========== FOOTER ON ALL PAGES ==========
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...borderColor);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...textMuted);
    doc.text("Legal Dashboard — Manual de Utilizare v1.0.0", margin, pageHeight - 8);
    doc.text(`Pagina ${i} din ${totalPages}`, pageWidth / 2, pageHeight - 8, { align: "center" });
    doc.text(`${new Date().toLocaleDateString("ro-RO")}`, pageWidth - margin, pageHeight - 8, { align: "right" });
  }

  return {
    buffer: doc.output("arraybuffer") as ArrayBuffer,
    filename: "Legal-Dashboard-Manual-v1.0.0.pdf",
    mime: MIME_PDF,
  };
}
