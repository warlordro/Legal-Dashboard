import { BookOpen, Download, Search, CalendarDays, BarChart3, FileSpreadsheet, FileText, Brain, Shield, Settings, Monitor, MousePointerClick, ArrowUpDown, Filter, CheckSquare, Loader2, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface ManualSectionProps {
  id: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function Section({ id, icon, title, children }: ManualSectionProps) {
  return (
    <Card id={id} className="border-l-4 border-l-primary/40 scroll-mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed text-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="font-semibold text-foreground">{title}</h4>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1 pl-4">
      {items.map((item, i) => (
        <li key={i} className="list-disc marker:text-muted-foreground/50">
          {item}
        </li>
      ))}
    </ul>
  );
}

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  );
}

interface ManualProps {
  onDownloadPdf?: () => void;
  isDownloading?: boolean;
}

export default function Manual({ onDownloadPdf, isDownloading }: ManualProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Manual de Utilizare</h1>
            <p className="text-sm text-foreground">
              Ghid complet pentru toate functiile aplicatiei Legal Dashboard
            </p>
          </div>
        </div>
        {onDownloadPdf && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            onClick={onDownloadPdf}
            disabled={isDownloading}
          >
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isDownloading ? "Se genereaza..." : "Descarca PDF"}
          </Button>
        )}
      </div>

      {/* Table of Contents */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider text-foreground">Cuprins</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1 sm:grid-cols-2 text-sm">
            {[
              { label: "1. Prezentare Generala", id: "prezentare" },
              { label: "2. Pagina Dashboard", id: "dashboard" },
              { label: "3. Cautare Dosare", id: "dosare" },
              { label: "4. Termene & Calendar", id: "termene" },
              { label: "5. Modul RNPM (Publicitate Mobiliara)", id: "rnpm" },
              { label: "6. Incarca Mai Multe (Load More)", id: "loadmore" },
              { label: "7. Export Excel si PDF", id: "export" },
              { label: "8. Analiza AI", id: "ai" },
              { label: "9. Analiza AI Avansata (Multi-Agent)", id: "ai-multi" },
              { label: "10. Configurare Chei API", id: "chei-api" },
              { label: "11. Sidebar si Navigare", id: "sidebar" },
              { label: "12. Personalizare (Tema & Font)", id: "personalizare" },
              { label: "13. Securitate si Confidentialitate", id: "securitate" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className="text-left text-foreground py-0.5 hover:text-primary hover:underline transition-colors cursor-pointer"
                onClick={() => {
                  const el = document.getElementById(item.id);
                  if (!el) return;
                  let parent = el.parentElement;
                  while (parent) {
                    const style = getComputedStyle(parent);
                    if ((style.overflowY === "auto" || style.overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
                      const elRect = el.getBoundingClientRect();
                      const parentRect = parent.getBoundingClientRect();
                      parent.scrollTo({ top: parent.scrollTop + (elRect.top - parentRect.top) - 16, behavior: "smooth" });
                      return;
                    }
                    parent = parent.parentElement;
                  }
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 1. Prezentare Generala */}
      <Section id="prezentare" icon={<Monitor className="h-5 w-5 text-primary" />} title="1. Prezentare Generala">
        <p>
          <strong className="text-foreground">Legal Dashboard</strong> este o aplicatie desktop si web pentru cautarea si analiza dosarelor
          si termenelor din toate instantele romanesti. Datele sunt obtinute in timp real prin API-ul SOAP public al
          Ministerului Justitiei (<code className="text-foreground">portalquery.just.ro</code>).
        </p>
        <SubSection title="Ce poti face cu aceasta aplicatie:">
          <BulletList items={[
            "Cautare dosare dupa numar, parti implicate, obiect sau institutie",
            "Cautare termene cu interval de date si filtre avansate",
            "Vizualizare calendar pentru termene si sedinte",
            "Export rezultate in Excel (.xlsx) si PDF",
            "Analiza inteligenta a dosarelor cu AI (Claude, GPT, Gemini)",
            "Analiza avansata multi-agent cu 2 analisti si un judecator AI",
            "Filtrare pe 246 instante din Romania (Curti de Apel, Tribunale, Judecatorii)",
            "Statistici si metrici interactive pentru dosarele gasite",
          ]} />
        </SubSection>
        <SubSection title="Platforme disponibile:">
          <BulletList items={[
            "Windows — installer NSIS (nu necesita drepturi de administrator)",
            "macOS — fisier DMG (Intel si Apple Silicon)",
            "Web — versiune standalone accesibila din browser",
          ]} />
        </SubSection>
        <p>
          <strong className="text-foreground">Sursa datelor:</strong> Toate informatiile despre dosare si termene provin exclusiv
          din API-ul public al Ministerului Justitiei. Aplicatia nu stocheaza dosare pe server — fiecare cautare
          interogheaza in timp real baza de date publica.
        </p>
      </Section>

      {/* 2. Dashboard */}
      <Section id="dashboard" icon={<BarChart3 className="h-5 w-5 text-blue-500" />} title="2. Pagina Dashboard">
        <p>
          Dashboard-ul este pagina principala a aplicatiei si ofera o vedere de ansamblu.
        </p>
        <SubSection title="Elemente afisate:">
          <BulletList items={[
            "Carduri de navigare rapida catre Cautare Dosare si Termene & Calendar",
            "Rezumatul ultimei cautari (numar dosare, categorii, institutii, parte cautata) — vizibil doar dupa o cautare",
            "Tipuri de procese disponibile: Penal, Civil, Contencios administrativ si fiscal, Litigii de munca, Faliment, Litigii cu profesionistii, Altele",
            "Informatii API — endpoint-ul SOAP, metodele disponibile, limita de 1000 rezultate per cerere",
            "Versiunea aplicatiei cu buton \"Vezi Noutati\" (changelog complet) si \"Manual\" (acest document)",
          ]} />
        </SubSection>
      </Section>

      {/* 3. Cautare Dosare */}
      <Section id="dosare" icon={<Search className="h-5 w-5 text-blue-500" />} title="3. Cautare Dosare">
        <SubSection title="Campuri de cautare:">
          <BulletList items={[
            "Numar dosar — formatul standard (ex: 27405/245/2025)",
            "Obiect dosar — text liber pentru obiectul cauzei",
            "Nume parte — numele unei parti implicate (cautare independenta de ordinea cuvintelor)",
            "Institutie — selector multi-select cu 246 instante din Romania, grupate pe categorii",
            "Data de la / Data pana la — interval de date pentru filtrarea rezultatelor",
          ]} />
        </SubSection>

        <SubSection title="Selector Institutii:">
          <p>Apasand pe campul \"Institutie\" se deschide un dialog modal cu toate cele 246 instante grupate pe categorii:</p>
          <BulletList items={[
            "Curti de Apel (15), Tribunale (42), Tribunale Specializate (1)",
            "Tribunale Comerciale (3), Tribunale Militare (5), Curti Militare (1), Judecatorii (179)",
            "Cautare rapida cu suport diacritice (\"brasov\" gaseste \"Brasov\")",
            "Selectie multipla — se pot alege mai multe institutii simultan",
            "Cautarea se trimite paralel catre toate institutiile selectate",
          ]} />
        </SubSection>

        <SubSection title="Filtre client-side (dupa cautare):">
          <p>Dupa primirea rezultatelor, poti filtra suplimentar fara a face o noua cerere:</p>
          <BulletList items={[
            "Categorii — Penal, Civil, Contencios etc. (selectie multipla)",
            "Stadii procesuale — Fond, Apel, Recurs etc. (selectie multipla)",
            "Institutii — modificarea selectiei dupa cautare aplica filtru client-side instant",
          ]} />
        </SubSection>

        <SubSection title="Tabelul de rezultate:">
          <BulletList items={[
            "Coloane sortabile: numar dosar, data, institutie (click pe header pentru sortare)",
            "Paginare cu selector: 10, 15, 25, 50 sau 100 rezultate pe pagina",
            "Navigare directa la prima/ultima pagina",
            "Checkbox pe fiecare rand pentru selectie individuala",
            "Select All selecteaza toate dosarele de pe pagina curenta",
            "Randurile selectate sunt evidientiate vizual cu fundal violet",
          ]} />
        </SubSection>

        <SubSection title="Detalii dosar (rand expandabil):">
          <p>Click pe un rand din tabel deschide detaliile complete:</p>
          <BulletList items={[
            "Informatii generale: Data, Departament, Categorie, Stadiu (cu badge-uri colorate)",
            "Obiectul dosarului",
            "Lista partilor — cu badge calitate (Reclamant, Parat, etc.) si highlight pe numele cautat",
            "Istoric sedinte — timeline vertical cu data, ora, complet, solutie, document",
            "Link direct catre dosarul de pe portal.just.ro",
            "Buton Analiza AI (daca ai cel putin o cheie API configurata)",
          ]} />
        </SubSection>

        <SubSection title="Metrici interactive:">
          <p>Deasupra tabelului sunt afisate carduri cu statistici. Click pe un card aplica filtrul corespunzator:</p>
          <BulletList items={[
            "Total dosare (reseteaza toate filtrele)",
            "Distributie pe categorii de caz",
            "Distributie pe stadii procesuale",
            "Analiza parti — roluri si numar aparitii per parte",
          ]} />
        </SubSection>

        <SubSection title="Butonul Reseteaza:">
          <p>
            Apare in formularul de cautare cand cel putin un camp este completat. La apasare, sterge atat campurile
            formularului cat si toate rezultatele cautarii anterioare (tabel, metrici, filtre selectate).
          </p>
        </SubSection>
      </Section>

      {/* 4. Termene & Calendar */}
      <Section id="termene" icon={<CalendarDays className="h-5 w-5 text-purple-500" />} title="4. Termene & Calendar">
        <SubSection title="Cautare termene:">
          <p>Formularul de cautare este similar cu cel de la Dosare. Rezultatele sunt termenele de judecata extrase din dosarele gasite.</p>
        </SubSection>

        <SubSection title="Vizualizare duala:">
          <BulletList items={[
            "Tabel — lista cu toate termenele, sortabila si paginata (10, 20, 50, 100 pe pagina)",
            "Calendar — vizualizare lunara cu termenele plasate pe zilele corespunzatoare",
            "Comutare intre cele doua vizualizari cu un buton toggle",
          ]} />
        </SubSection>

        <SubSection title="Metrici filtrabile:">
          <BulletList items={[
            "Total termene (reseteaza filtrele)",
            "Termene viitoare (dupa data curenta)",
            "Termene trecute",
            "Cu solutie (termene care au o solutie inregistrata)",
            "Filtrele functioneaza in logica OR — selectia multipla include orice termen care se potriveste cel putin unui filtru",
          ]} />
        </SubSection>

        <SubSection title="Detalii termen (rand expandabil):">
          <BulletList items={[
            "Categorie si Stadiu procesual",
            "Obiectul dosarului",
            "Solutia completa cu sumarul integral",
            "Lista de parti cu badge calitate si highlight nume",
          ]} />
        </SubSection>

        <SubSection title="Vizualizare Calendar:">
          <BulletList items={[
            "Navigare luna cu luna (inainte/inapoi)",
            "Termenele apar pe zilele corespunzatoare cu numar dosar si institutie",
            "Numerele de dosar sunt linkuri directe catre portal.just.ro",
            "Click pe un card deschide detalii: solutie si lista parti",
          ]} />
        </SubSection>
      </Section>

      {/* 5. RNPM */}
      <Section id="rnpm" icon={<Database className="h-5 w-5 text-rose-500" />} title="5. Modul RNPM (Publicitate Mobiliara)">
        <p>
          Modulul <strong className="text-foreground">RNPM</strong> (Registrul National de Publicitate Mobiliara) permite cautarea,
          vizualizarea si arhivarea avizelor de ipoteca mobiliara, fiducie si avizelor specifice direct din registrul oficial
          <code className="text-foreground"> mj.rnpm.ro</code>. Se acceseaza din sidebar cu tab-ul <strong className="text-foreground">Cautare RNPM</strong>.
        </p>

        <SubSection title="Sub-taburi disponibile:">
          <BulletList items={[
            "Cautare — formularul principal pentru o singura cautare (sync, rezultate afisate imediat in tabel)",
            "Bulk — incarca un fisier cu mai multe identificatori (pana la 100) si executa toate cautarile la rand cu progres live",
            "Baza locala — browse peste toate avizele deja salvate local in SQLite (filtrare, cautare, export, sters)",
          ]} />
        </SubSection>

        <SubSection title="Categorii de cautare (aliniate la site-ul oficial):">
          <BulletList items={[
            "Aviz de ipoteca mobiliara — tipul cel mai comun; 18 tipuri specifice (initial, modificator, de prelungire, etc.)",
            "Fiducie — 7 tipuri specifice (constituitor, fiduciar, beneficiar)",
            "Aviz specific — 7 tipuri (ex: aviz de sechestru, aviz de executare)",
            "Aviz de ipoteca — creante securitizate",
            "Aviz de ipoteca — obligatiuni ipotecare (cu formular Agent PJ/PF + Emitent PJ + descriere bun garantie)",
          ]} />
        </SubSection>

        <SubSection title="Campurile formularului:">
          <BulletList items={[
            "Tipul avizului — dropdown cu valorile aplicabile categoriei selectate",
            "Destinatia inscrierii — dropdown (14 valori pentru ipoteca, 10 pentru specific)",
            "Operator SI / SAU per camp — combinarea criteriilor in logica AND sau OR",
            "Toggle PJ / PF — unic per rol (Constituitor, Fiduciar, Beneficiar, Parte, Debitor, Creditor); formularul se adapteaza (CUI pentru PJ, CNP pentru PF)",
            "Checkbox-uri default active: 'Numai active', 'Nemodificate de alte inscrieri' (aliniate cu default-urile site-ului oficial)",
          ]} />
        </SubSection>

        <SubSection title="Captcha (obligatoriu pe site-ul RNPM):">
          <p>
            RNPM foloseste reCAPTCHA v2 pe toate cautarile. Aplicatia rezolva captcha-ul automat prin doi furnizori externi platiti
            (aproximativ $0.003 per captcha):
          </p>
          <BulletList items={[
            "2Captcha — furnizor default; cheie obtinuta de la 2captcha.com",
            "CapSolver — alternativa; cheie obtinuta de la capsolver.com",
            "Mod sequential (default) — aplicatia foloseste doar furnizorul selectat",
            "Mod race — daca ai ambele chei, aplicatia trimite captcha-ul la ambii furnizori simultan si il accepta pe primul care raspunde (latenta minima, cost dublu)",
            "Cheia se configureaza in dialogul Setari AI, alaturi de cheile Anthropic / OpenAI / Google",
            "Pe desktop, cheia este criptata cu OS keystore (DPAPI / Keychain / libsecret) prin Electron safeStorage",
          ]} />
        </SubSection>

        <SubSection title="Modal detaliu aviz (5 tab-uri):">
          <p>Click pe un rand din tabelul de rezultate deschide un modal cu toate datele avizului:</p>
          <BulletList items={[
            "General — numar inregistrare, data, categorie, tip, destinatie, descriere publica",
            "Creditori — lista beneficiarilor cu CUI/CNP si denumire",
            "Debitori — lista constituitorilor / debitorilor cu CUI/CNP si denumire",
            "Bunuri — bunurile inregistrate ca garantie; pentru fiecare bun, badge-uri colorate pentru referinte (sky = constituitor, amber = tert)",
            "Istoric — modificari succesive asupra avizului (prelungiri, cesiuni, radieri)",
            "Badge cu count per tab pentru identificare rapida a datelor disponibile",
          ]} />
        </SubSection>

        <SubSection title="Bulk search — cautare in serie:">
          <BulletList items={[
            "Incarca un fisier cu lista de identificatori (CUI, CNP, nume) — pana la 100 per batch",
            "Estimare timp si cost afisata inainte de start (aprox 15-25s per item in functie de reCAPTCHA)",
            "Progres live via SSE: contor rezolvat / total, status per item (Loader2 → CheckCircle2 pentru succes, XCircle pentru eroare)",
            "Buton Abort cu cleanup complet — intrerupe captcha solver, fetch-urile RNPM in curs si persist-ul SQLite in acelasi moment",
            "Timeout hard pe sesiune: 10 minute per batch",
          ]} />
        </SubSection>

        <SubSection title="Baza locala (SQLite):">
          <p>
            Toate avizele cautate sunt persistate local in 6 tabele (rnpm_avize, rnpm_creditori, rnpm_debitori, rnpm_bunuri,
            rnpm_istoric, rnpm_searches) cu coloana owner_id pentru izolare multi-user viitor. Motivatie: UUID-urile RNPM sunt
            efemere (expira in cateva minute), asa ca detaliile se preiau <strong className="text-foreground">in timpul</strong> cautarii si se salveaza imediat.
          </p>
          <BulletList items={[
            "Filtrare full-text insensibila la diacritice — cautand 'stefan' gasesti 'Ștefan' / 'ȘTEFAN' / 'STEFAN'",
            "Filtru interval de date (data inscrierii) — doua campuri 'de la' / 'pana la'",
            "Badge verde (Activ) / gri (Inactiv) per aviz",
            "Cursor 'Incarca mai multe' — paginare progresiva, fara sa incarci mii de randuri deodata",
            "Sterge tot — buton cu dubla confirmare (operatie ireversibila care sterge si toate tabelele related prin CASCADE)",
          ]} />
        </SubSection>

        <SubSection title="Export RNPM:">
          <BulletList items={[
            "Excel (.xlsx) cu 5 sheet-uri separate: Avize, Creditori, Debitori, Bunuri, Istoric",
            "Toate celulele text care incep cu = + - @ Tab sau CR sunt prefixate cu apostrof (protectie formula injection)",
            "Coloanele auto-dimensionate pentru lizibilitate",
          ]} />
        </SubSection>

        <SubSection title="Butonul Stop:">
          <p>
            Butonul <strong className="text-foreground">Stop</strong> intrerupe efectiv intregul lant: captcha solver, fetch-urile catre RNPM (search si detalii)
            si persist-ul SQLite. Abort-ul este instant (sub 2s latenta) si fetch-urile deja in curs <strong className="text-foreground">nu mai scriu in baza</strong> dupa
            apasarea Stop — baza ramane neatinsa daca opresti o cautare.
          </p>
        </SubSection>

        <SubSection title="Limite si costuri:">
          <BulletList items={[
            "Maxim 1500 rezultate per cautare (limita oficiala RNPM) — la depasire, aplicatia afiseaza eroare clara",
            "Bulk: max 100 items per batch",
            "Captcha cost: ~$0.003 per rezolvare (2Captcha sau CapSolver)",
            "Aplicatia nu stocheaza niciodata cheia captcha pe server — e pastrata exclusiv local, in OS keystore (desktop) sau localStorage (web)",
          ]} />
        </SubSection>
      </Section>

      {/* 6. Load More */}
      <Section id="loadmore" icon={<Loader2 className="h-5 w-5 text-emerald-500" />} title="6. Incarca Mai Multe (Load More)">
        <p>
          API-ul Ministerului Justitiei returneaza maxim <strong className="text-foreground">1000 de rezultate</strong> per cerere. Daca cautarea
          ta are mai multe rezultate, butonul <strong className="text-foreground">\"Incarca mai multe\"</strong> iti permite sa le obtii pe toate.
        </p>

        <SubSection title="Cum functioneaza:">
          <BulletList items={[
            "Dupa o cautare initiala care returneaza 1000 de rezultate, apare butonul \"Incarca mai multe\"",
            "La apasare, aplicatia scaneaza luna cu luna intregul interval de date",
            "Daca o luna are mai mult de 1000 rezultate, intervalul se subdivide automat in perioade mai mici",
            "Rezultatele noi apar in tabel in timp real (nu trebuie sa astepti sa se termine scanarea)",
            "Bara de progres arata cate dosare/termene NOI au fost gasite",
          ]} />
        </SubSection>

        <SubSection title="Deduplicare inteligenta:">
          <p>
            Aplicatia trimite catre server lista dosarelor deja existente, iar serverul returneaza <strong className="text-foreground">doar
            dosarele noi</strong>. Astfel, nu se descarca de doua ori aceleasi dosare, iar contorul de progres reflecta
            numarul real de dosare noi gasite.
          </p>
        </SubSection>

        <SubSection title="Oprire si continuare:">
          <BulletList items={[
            "Butonul STOP opreste scanarea in orice moment",
            "Toate rezultatele gasite pana la oprire sunt pastrate (nu se pierde nimic)",
            "Poti naviga intre taburile Dosare si Termene fara sa se opreasca procesul — operatia continua in fundal",
            "La revenirea pe tab, vei vedea rezultatele actualizate",
          ]} />
        </SubSection>

        <SubSection title="Limite de siguranta:">
          <BulletList items={[
            "Maxim 120 intervale lunare per scanare (~10 ani)",
            "Timeout de 10 minute per sesiune de scanare",
          ]} />
        </SubSection>
      </Section>

      {/* 6. Export */}
      <Section id="export" icon={<FileSpreadsheet className="h-5 w-5 text-green-500" />} title="7. Export Excel si PDF">
        <SubSection title="Export Excel (.xlsx):">
          <BulletList items={[
            "Dosare: genereaza 2 foi (sheet-uri) — \"Dosare\" cu informatiile de baza si \"Sedinte\" cu toate sedintele",
            "Termene: 1 foaie cu 7 coloane (numar dosar, data, ora, institutie, complet, solutie, sumar)",
            "Coloanele sunt auto-dimensionate pentru lizibilitate",
          ]} />
        </SubSection>

        <SubSection title="Export PDF:">
          <BulletList items={[
            "Dosare si Termene: format Landscape A4 cu tabel, header colorat, paginare automata",
            "Analize AI: format Portrait A4 cu design profesional, formatare markdown, footer pe fiecare pagina",
          ]} />
        </SubSection>

        <SubSection title="Export selectiv:">
          <p>
            Daca ai selectat dosare/termene cu checkbox, butoanele de export arata numarul selectat (ex: "Excel (3)") si
            exporta doar elementele selectate. Daca nu selectezi nimic, se exporta toate rezultatele.
          </p>
        </SubSection>
      </Section>

      {/* 7. AI Simpla */}
      <Section id="ai" icon={<Brain className="h-5 w-5 text-violet-500" />} title="8. Analiza AI">
        <p>
          Aplicatia ofera analiza inteligenta a dosarelor folosind modele AI de ultima generatie. Pentru a folosi
          aceasta functie, trebuie sa configurezi cel putin o cheie API (vezi sectiunea 9).
        </p>

        <SubSection title="Cum se foloseste:">
          <BulletList items={[
            "Deschide detaliile unui dosar (click pe rand in tabel)",
            "Selecteaza modelul AI dorit din dropdown-ul de modele",
            "Apasa butonul \"Analizeaza cu AI\"",
            "Analiza se genereaza in cateva secunde si apare sub detaliile dosarului",
            "Poti regenera analiza cu un alt model sau ascunde/arata rezultatul",
          ]} />
        </SubSection>

        <SubSection title="Modele disponibile:">
          <div className="space-y-2">
            <p><Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400">Anthropic (Claude)</Badge></p>
            <BulletList items={[
              "Claude Haiku 4.5 — Rapid (cea mai rapida analiza)",
              "Claude Sonnet 4.6 — Echilibrat (balans viteza/calitate)",
              "Claude Opus 4.6 — Premium (cel mai detaliat)",
            ]} />
            <p><Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">OpenAI (GPT)</Badge></p>
            <BulletList items={[
              "GPT-5.4 nano — Rapid",
              "GPT-5.4 mini — Echilibrat",
              "GPT-5.4 — Premium",
            ]} />
            <p><Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Google (Gemini)</Badge></p>
            <BulletList items={[
              "Gemini Flash 2.0 — Rapid",
              "Gemini Flash 2.5 — Echilibrat",
              "Gemini Pro 2.5 — Premium",
            ]} />
          </div>
        </SubSection>

        <SubSection title="Structura analizei (7 sectiuni):">
          <BulletList items={[
            "Rezumatul dosarului — descriere sintetica a cauzei",
            "Explicatia partilor — cine sunt partile si ce rol au",
            "Starea actuala a procesului — in ce faza se afla",
            "Istoricul sedintelor — ce s-a intamplat la fiecare sedinta",
            "Ce ar putea urma — posibilii pasi urmatori",
            "Temei juridic — articole de lege relevante pentru cauza",
            "Legaturi cu alte dosare — daca exista conexiuni cu alte cauze",
          ]} />
        </SubSection>

        <SubSection title="Export analiza PDF:">
          <p>
            Dupa generarea analizei, apare un buton de export PDF. Documentul generat include: header cu titlu,
            card cu informatiile dosarului, continutul analizei cu formatare profesionala si footer pe fiecare pagina.
          </p>
        </SubSection>
      </Section>

      {/* 8. AI Multi-Agent */}
      <Section id="ai-multi" icon={<Brain className="h-5 w-5 text-amber-500" />} title="9. Analiza AI Avansata (Multi-Agent)">
        <p>
          Analiza avansata foloseste <strong className="text-foreground">3 modele AI simultan</strong> pentru o analiza mai completa si verificata.
        </p>

        <SubSection title="Cum functioneaza:">
          <BulletList items={[
            "Selecteaza 2 modele \"Analist\" — acestea analizeaza dosarul independent si in paralel",
            "Selecteaza 1 model \"Judecator\" — acesta primeste ambele analize si le reconciliaza",
            "Nu se poate selecta acelasi model de doua ori",
            "Modelele judecator sunt restrictionate la modele premium: Claude Opus 4.6, GPT-5.4 sau Gemini 3.1 Pro",
          ]} />
        </SubSection>

        <SubSection title="Rolul judecatorului AI:">
          <BulletList items={[
            "Primeste datele complete ale dosarului plus cele 2 analize independente",
            "Verifica afirmatiile analistilor contra datelor originale ale dosarului",
            "Corecteaza interpretarile gresite si adauga aspecte omise de ambii analisti",
            "Reconciliaza contradictiile alegand interpretarea sustinuta de datele reale",
            "Prezinta explicit in analiza finala ce reconcilieri a facut intre cele doua analize",
            "Rezultatul final este prezentat ca o analiza unitara coerenta",
          ]} />
        </SubSection>

        <SubSection title="Vizualizare rezultate:">
          <BulletList items={[
            "Analiza finala a judecatorului este afisata principal",
            "Toggle \"Vizualizare analize individuale\" — arata cele 2 analize side-by-side",
            "Export PDF disponibil pentru analiza finala (include mentiunea modelului judecator)",
          ]} />
        </SubSection>
      </Section>

      {/* 9. Chei API */}
      <Section id="chei-api" icon={<Settings className="h-5 w-5 text-gray-500" />} title="10. Configurare Chei API">
        <p>
          Pentru a folosi analiza AI, trebuie sa configurezi cel putin o cheie API de la un furnizor AI.
          Cheile sunt <strong className="text-foreground">gratuite la inregistrare</strong> pentru un volum limitat de cereri.
        </p>

        <SubSection title="Cum se configureaza:">
          <BulletList items={[
            "Apasa pe \"Setari API\" din sidebar (iconita Bot)",
            "Introdu cheia API pentru furnizorul dorit (Anthropic, OpenAI sau Google)",
            "Apasa \"Salveaza\" — cheia este stocata local pe calculatorul tau",
            "Indicatorul din sidebar devine verde cand cel putin o cheie este activa",
            "Poti configura cheile pentru mai multi furnizori simultan",
            "Pentru a sterge o cheie, apasa \"Sterge cheia\" sub campul respectiv",
          ]} />
        </SubSection>

        <SubSection title="Securitatea cheilor:">
          <BulletList items={[
            "Cheile sunt stocate doar local (in browser-ul aplicatiei), nu pe niciun server extern",
            "Cheile sunt obfuscate in localStorage (nu sunt stocate ca text simplu)",
            "La fiecare cerere AI, cheia este trimisa doar catre API-ul furnizorului respectiv",
            "Cheile persista intre sesiuni — nu trebuie reintroduse la fiecare pornire a aplicatiei",
          ]} />
        </SubSection>

        <SubSection title="De unde obtii chei API:">
          <BulletList items={[
            "Anthropic (Claude): console.anthropic.com",
            "OpenAI (GPT): platform.openai.com",
            "Google (Gemini): aistudio.google.com",
          ]} />
        </SubSection>
      </Section>

      {/* 10. Sidebar */}
      <Section id="sidebar" icon={<MousePointerClick className="h-5 w-5 text-indigo-500" />} title="11. Sidebar si Navigare">
        <SubSection title="Meniu de navigare:">
          <BulletList items={[
            "Dashboard — pagina principala cu rezumat si navigare rapida",
            "Cautare Dosare — formularul si tabelul de dosare",
            "Termene & Calendar — formularul, tabelul si calendarul de termene",
          ]} />
        </SubSection>

        <SubSection title="Istoric cautari:">
          <BulletList items={[
            "Se salveaza automat ultimele 15 cautari efectuate",
            "Fiecare intrare arata: tipul cautarii (dosare/termene), parametrii, numarul de rezultate, cat timp a trecut",
            "Click pe o intrare navigheaza automat la pagina corespunzatoare si re-executa cautarea",
            "Stergere individuala (buton X la hover) sau stergere totala (iconita cos de gunoi)",
            "In modul sidebar colapsat, istoricul apare intr-un popover la click pe iconita",
          ]} />
        </SubSection>

        <SubSection title="Navigare persistenta:">
          <p>
            Paginile Dosare si Termene raman active in fundal chiar daca navighezi pe alt tab.
            Aceasta inseamna ca:
          </p>
          <BulletList items={[
            "O operatie \"Incarca mai multe\" in curs NU se opreste la navigare",
            "Campurile completate in formularul de cautare se pastreaza",
            "Rezultatele cautarii sunt disponibile la revenire, fara a reface cautarea",
          ]} />
        </SubSection>

        <SubSection title="Colapsare sidebar:">
          <p>
            Butonul \"Inchide meniu\" din partea de jos reduce sidebar-ul la 64px, lasand mai mult spatiu pentru continut.
            In modul colapsat, navigarea si setarile sunt accesibile prin iconite cu tooltip.
          </p>
        </SubSection>
      </Section>

      {/* 11. Personalizare */}
      <Section id="personalizare" icon={<ArrowUpDown className="h-5 w-5 text-orange-500" />} title="12. Personalizare (Tema & Font)">
        <SubSection title="Tema vizuala:">
          <BulletList items={[
            "Mod Luminos (Light) si Mod Inchis (Dark) — toggle din sidebar",
            "Detecteaza automat preferinta sistemului de operare la prima utilizare",
            "Setarea se salveaza si persista intre sesiuni",
          ]} />
        </SubSection>

        <SubSection title="Dimensiune text:">
          <BulletList items={[
            "4 trepte disponibile: Mic (16px), Normal (18px), Mare (20px), Extra (22px)",
            "Control din sidebar cu butoane A-/A+ si indicator vizual (puncte)",
            "Afecteaza toata aplicatia (tabel, formulare, butoane, metrici)",
            "Setarea se salveaza si persista intre sesiuni",
          ]} />
        </SubSection>

        <SubSection title="Meniu contextual (click dreapta):">
          <p>In aplicatia desktop, click dreapta afiseaza un meniu cu optiunile:</p>
          <BulletList items={[
            "Copiaza — doar cand exista text selectat",
            "Selecteaza tot",
            "Printeaza",
          ]} />
        </SubSection>
      </Section>

      {/* 12. Securitate */}
      <Section id="securitate" icon={<Shield className="h-5 w-5 text-red-500" />} title="13. Securitate si Confidentialitate">
        <SubSection title="Unde sunt datele tale:">
          <BulletList items={[
            "Cheile API (Anthropic / OpenAI / Google / 2Captcha / CapSolver) sunt stocate in OS keystore pe desktop — DPAPI pe Windows, Keychain pe macOS, libsecret pe Linux — prin Electron safeStorage. Ciphertext-ul ajunge in localStorage; plaintext-ul nu atinge niciodata disk-ul",
            "Pe web (fara desktop keystore) cheile sunt obfuscate reversibil in localStorage — nu e control real de securitate, e doar anti-screenshot casual",
            "Istoricul cautarilor si preferintele (tema, font) — doar in localStorage local",
            "Avizele RNPM si dosarele cautate sunt salvate in SQLite local (%APPDATA%/legal-dashboard/legal-dashboard.db)",
            "Nu exista niciun server intermediar — datele merg direct de la calculatorul tau catre API-urile oficiale (just.ro, mj.rnpm.ro, furnizorii AI, 2Captcha / CapSolver)",
          ]} />
        </SubSection>

        <SubSection title="Protectii implementate (desktop):">
          <BulletList items={[
            "Single-instance lock — doua Electron-uri simultane nu se pot lansa si corupe baza SQLite; a doua lansare focuseaza fereastra existenta",
            "sandbox + contextIsolation + preload.js cu suprafata minima expusa (doar encryptKeys / decryptKeys / isEncryptionAvailable)",
            "DevTools dezactivate in productie; activabile doar cu NODE_ENV=development",
            "Verificare identitate backend la boot — daca alt proces asculta pe port, aplicatia refuza conexiunea",
            "CSP strict in Electron (default-src 'self', object-src 'none', frame-ancestors 'none')",
            "Navigare si popup-uri blocate; shell.openExternal doar catre whitelist exact (portal.just.ro, www.just.ro, portalquery.just.ro, mj.rnpm.ro, www.rnpm.ro) peste HTTPS",
          ]} />
        </SubSection>

        <SubSection title="Protectii implementate (backend):">
          <BulletList items={[
            "Bind pe 127.0.0.1 garantat — HOST=0.0.0.0 este ignorat decat daca setezi explicit LEGAL_DASHBOARD_ALLOW_REMOTE=1 (opt-in pentru deployment LAN)",
            "Rate limiter pe IP-ul real al socket-ului (nu pe X-Forwarded-For spoofable)",
            "CSP explicit pe toate raspunsurile server-ului, nu doar in Electron",
            "MAX_SOAP_FANOUT=500 pe load-more — previne amplificare cerere unica in mii de cereri SOAP",
            "Validare completa a datelor de intrare (lungime, format, caractere de control / null bytes respinse)",
            "Protectie XSS cu DOMPurify pe toate raspunsurile AI afisate",
            "Protectie prompt injection — datele dosarelor in delimitatori XML, campuri truncate (obiect 500, nume parte 100, solutie 5000)",
            "Protectie formula injection la export Excel — celulele text care incep cu = + - @ Tab sau CR primesc prefix apostrof (tratate ca text, nu formula)",
          ]} />
        </SubSection>

        <SubSection title="Ce NU protejam explicit:">
          <BulletList items={[
            "Malware care ruleaza sub acelasi user OS — safeStorage decripteaza transparent pentru user-ul curent; aparare e la nivel de OS (antivirus, cont cu drepturi limitate)",
            "Supply-chain (npm packages compromise) — dependintele sunt trust-uite la install time",
            "Binar Windows nesemnat — SmartScreen va avertiza la prima lansare pentru fisiere descarcate; intern / pe USB nu e afectat",
            "LAN-mode fara autentificare — daca rulezi cu LEGAL_DASHBOARD_ALLOW_REMOTE=1 fara reverse-proxy + TLS + auth, oricine din retea poate accesa backend-ul",
          ]} />
          <p className="text-xs text-muted-foreground">
            Detalii complete in fisierul <code className="text-foreground">SECURITY.md</code> de la radacina proiectului.
          </p>
        </SubSection>

        <SubSection title="Analiza AI si confidentialitatea:">
          <p>
            Cand soliciti o analiza AI, datele dosarului (numar, obiect, parti, sedinte) sunt trimise catre
            furnizorul AI selectat (Anthropic, OpenAI sau Google). Aceste date sunt publice (provin din API-ul
            Ministerului Justitiei), dar este important sa stii ca sunt procesate de serverele furnizorului AI conform
            politicilor lor de confidentialitate.
          </p>
        </SubSection>
      </Section>

      {/* Footer with second download button */}
      <div className="text-center text-xs text-foreground pt-4 pb-8 border-t border-border space-y-3">
        {onDownloadPdf && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onDownloadPdf}
            disabled={isDownloading}
          >
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isDownloading ? "Se genereaza..." : "Descarca Manual PDF"}
          </Button>
        )}
        <p>Legal Dashboard — Manual de Utilizare v{__APP_VERSION__}</p>
        <p>Datele sunt furnizate de API-ul public al Ministerului Justitiei (portalquery.just.ro) si Registrul National de Publicitate Mobiliara (mj.rnpm.ro)</p>
      </div>
    </div>
  );
}
