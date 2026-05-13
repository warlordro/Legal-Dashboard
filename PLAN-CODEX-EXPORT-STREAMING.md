# Plan executie Codex - Migrare exporturi server-side streaming

**Autor**: Claude (sesiunea 2026-05-13)
**Executant**: Codex
**Trigger**: RNPM XLSX export pe 148 avizi → Electron main process 4GB peak → AppHangTransient → kill complet (PID 3960/6152/16304/26048, 2026-05-12).

## REGULI STRICTE DE EXECUTIE (NON-NEGOTIABLE)

1. **NU te abate de la plan.** Acest fisier este single source of truth. Daca vezi o problema care cere schimbare fundamentala, OPRESTE-TE si raporteaza inapoi - nu improviza.
2. **NU umbla in fisiere care nu sunt listate explicit la "Fisiere atinse" in faza curenta.** Daca observi cod adiacent care "ar putea fi imbunatatit", IGNORA-L. Refactor-uri colaterale sunt interzise.
3. **NU schimba contractul API.** Endpoint-urile existente isi pastreaza path, metoda, request body, response shape, content-type, content-disposition. Doar implementarea interna se schimba.
4. **NU adauga features noi.** Daca lipseste ceva (validare, error handling, logging) si nu e mentionat explicit aici, NU-l adauga.
5. **NU sterge cod care nu e listat explicit la "Cod eliminat".** Verifica de doua ori inainte sa stergi un helper sau o functie.
6. **Faze secventiale.** Faza 1 → SMOKE TEST → aprobare user → Faza 2 → SMOKE → aprobare → Faza 3. NU lansa Faza 2 pana cand userul nu confirma ca Faza 1 a trecut smoke pe desktop real.
7. **Niciun commit fara biome + tsc + tests + build verde** (vezi `## Validare per faza`).
8. **Mesaje commit in romana fara diacritice.** Conventia repo-ului. Exemplu: `refactor(rnpm): port export XLSX la ExcelJS streaming (faza 1)`.

## Context tehnic (citeste inainte sa incepi)

- Backend ruleaza in-process in Electron main (acelasi V8 isolate ca UI thread). De aceea v2.22.0, desi a mutat build-ul XLSX din renderer Worker pe backend, a transferat OOM-ul de la 2.7GB renderer la 4GB main, nu l-a rezolvat.
- `xlsx-js-style` tine simultan in memorie: (1) cells objects cu styling+hyperlinks, (2) XML serializat ca string, (3) buffer ZIP. Pentru 148 avizi cu ~3000 rows distribuite pe 5 sheet-uri → 4GB peak.
- Solutia este streaming la disk: `exceljs.stream.xlsx.WorkbookWriter` scrie row-by-row la temp file pe disk si serveste ulterior fisierul prin stream catre response. Peak RAM stabil ~200MB indiferent de count.
- `exceljs@^4.4.0` este deja in `backend/package.json` (introdus in v2.6.4 pentru `nameListParser.ts`). NU il reinstala.

## Stare actuala in working tree (necommit)

Fisiere modificate/adaugate care **TREBUIE REFACUTE** sau eliminate:

```
M  backend/package.json                          # xlsx-js-style adaugat - scoate-l
?? backend/src/services/rnpmExportXlsx.ts        # implementare xlsx-js-style - rewrite
?? backend/src/services/rnpmExportXlsx.test.ts   # 6 teste pe xlsx-js-style - porteaza
?? backend/src/util/xlsxHelpers.ts               # helpers xlsx-js-style - elimina majoritatea
M  backend/src/routes/rnpm.ts                    # ruta /saved/export.xlsx - rescrie corpul
```

Frontend (`frontend/src/lib/rnpmApi.ts`, `frontend/src/lib/rnpmExport.ts`) este corect, **NU-l atinge in Faza 1**. Modificarile lui vor veni in Faza 2.

---

## FAZA 1 - RNPM XLSX server-side streaming (~1h15)

### Obiectiv
Rescrie `backend/src/services/rnpmExportXlsx.ts` cu `exceljs.stream.xlsx.WorkbookWriter` astfel incat peak-ul de memorie la export sa fie ~200MB indiferent de count (target validare: 148 avizi pe Electron main fara crash, /health raspunde sub 2s in tot timpul exportului).

### Fisiere atinse (DOAR acestea in Faza 1)

| Fisier | Actiune |
|---|---|
| `backend/package.json` | Sterge `"xlsx-js-style"` din `dependencies`. NU atinge alte deps. |
| `backend/src/services/rnpmExportXlsx.ts` | Rewrite complet cu ExcelJS streaming (vezi schelet mai jos). |
| `backend/src/services/rnpmExportXlsx.test.ts` | Port teste la ExcelJS API (6 teste, vezi sectiunea "Teste"). |
| `backend/src/util/xlsxHelpers.ts` | Pastreaza `todayRo()` + `sanitizeFilename` (muta-l din rnpmExportXlsx.ts daca e nevoie). ELIMINA: `colLetter`, `cellAddr`, `ensureCell`, `sanitizeFormulaCells`, `styleRow`, `styleCell`, `mergeRow`, `styleTitle`, `styleStats`, `styleHeader`, `styleDataCell` (specifice xlsx-js-style). Constantele de culori (`BLUE_DARK`, `BLUE_MAIN`, `BLUE_LIGHT`, `ROW_ALT`, `WHITE`, `TEXT_DARK`, `TEXT_MID`) pot ramane daca sunt folosite in ExcelJS rewrite, altfel elimina-le. |
| `backend/src/routes/rnpm.ts` | Rescrie DOAR corpul handler-ului `POST /saved/export.xlsx` (liniile 846-876 in stare curenta). Ruta, contractul, body parsing, validarea (max 500 ids, searchType, owner scoping prin `getOwnerId`), `getAvizeByIds` raman identice. Schimbi DOAR partea care apeleaza `buildRnpmXlsx` si setarea headers/body raspuns. |

### Fisiere INTERZISE de atins in Faza 1

- Tot `frontend/` (inclusiv `rnpmExport.ts`, `rnpmApi.ts`, `rnpmExport.worker.ts`, `vite.config.ts`)
- Orice serviciu din `backend/src/services/` in afara de `rnpmExportXlsx.ts`
- Orice ruta din `backend/src/routes/` in afara de `rnpm.ts` (si in acela DOAR handler-ul `/saved/export.xlsx`)
- `backend/src/db/**`, `backend/src/auth/**`, `backend/src/middleware/**`
- Migrations DB
- `.github/workflows/`, `Dockerfile`, `electron/**`
- Alte exporturi (`export-analysis.ts`, `export-manual.ts`, `changelog-pdf.ts`, `monitoringBulkTemplate.ts`)

### Contract API (NU schimba)

```
POST /api/v1/rnpm/saved/export.xlsx
Body: { ids: number[]; searchType?: string }
Constrains: max 500 ids, searchType <= 64 chars
Errors:
  400 "JSON invalid" | "Lista id-uri goala" | "Lista id-uri invalida" | "Maxim 500 avize per export"
  404 "Nicio inregistrare gasita"
Success headers:
  Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
  Content-Length: <byte count>
  Content-Disposition: attachment; filename="<safeAscii>"; filename*=UTF-8''<encoded>
  Cache-Control: no-store
Body: binary XLSX
```

### Schelet de implementare (orientativ - adapteaza la nevoie, respecta semantica)

```typescript
// backend/src/services/rnpmExportXlsx.ts
import ExcelJS from "exceljs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AvizFull, ... } from "../db/avizRepository.ts";

export interface RnpmXlsxResult {
  filepath: string;        // path la temp file - caller-ul streamează si sterge
  filename: string;        // nume sugerat pentru Content-Disposition
  mime: string;
  byteLength: number;      // pentru Content-Length
}

export async function buildRnpmXlsx(items: AvizFull[], searchType?: string): Promise<RnpmXlsxResult> {
  const tmpPath = join(tmpdir(), `rnpm-xlsx-${randomUUID()}.xlsx`);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: tmpPath,
    useStyles: true,
    useSharedStrings: false, // mai mic CPU, putin mai mare fisier - bun pentru stream
  });

  // Pre-calculeaza row offsets cross-sheet (logica existenta din versiunea xlsx-js-style)
  // Pre-calculul este OBLIGATORIU pentru ca WorkbookWriter NU permite revenirea
  // la un sheet dupa .commit(). Toate sheet-urile se construiesc secvential.

  // Pentru fiecare sheet:
  //   const ws = workbook.addWorksheet("Avize");
  //   ws.columns = [{ width: 5 }, { width: 30 }, ...];
  //   ws.addRow(["LEGAL DASHBOARD - RNPM ..."]).commit();   // titlu merged
  //   ws.mergeCells(1, 1, 1, COLS);
  //   pe fiecare row: const r = ws.addRow(values); r.eachCell(cell => { cell.font=...; cell.fill=...; cell.alignment=...; }); r.commit();
  //   ws.commit();
  //
  // Hyperlinks cross-sheet (sintaxa ExcelJS, diferita de xlsx-js-style):
  //   cell.value = { hyperlink: "#Bunuri!A5", text: "2026-AV-1" };

  await workbook.commit();
  const stat = await fs.stat(tmpPath);
  return {
    filepath: tmpPath,
    filename: <calculat ca acum>,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    byteLength: stat.size,
  };
}
```

### Sanitizare formula injection (CRITIC - nu omite)

`exceljs` nu are protecția automata. Pentru fiecare valoare string scrisa in celula, daca incepe cu `=`, `+`, `-`, `@`, `\t` sau `\r`, prefixeaza cu `'`:

```typescript
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
function safeCell(v: unknown): unknown {
  if (typeof v === "string" && FORMULA_PREFIX.test(v)) return `'${v}`;
  return v;
}
```

Aplica `safeCell` pe TOATE valorile string inainte de `addRow` sau `cell.value =`. Echivalentul `sanitizeFormulaCells` din xlsx-js-style era post-build; aici trebuie pre-write pentru ca odata commit-uit nu mai poti modifica.

### Handler ruta (corp nou pentru `/saved/export.xlsx`)

```typescript
// in backend/src/routes/rnpm.ts, inlocuieste DOAR partea finala dupa getAvizeByIds:
const result = await buildRnpmXlsx(items, searchTypeStr);
try {
  const stream = createReadStream(result.filepath);
  const safeAscii = result.filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  c.header("Content-Type", result.mime);
  c.header("Content-Length", String(result.byteLength));
  c.header("Content-Disposition", `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
  c.header("Cache-Control", "no-store");
  return c.body(stream as unknown as ReadableStream); // sau converteste explicit Node Readable -> Web ReadableStream daca Hono cere
} finally {
  // Cleanup temp file - dupa ce stream-ul e consumat de response.
  // Foloseste un wrapper care apeleaza fs.unlink dupa "close"/"end" pe stream.
}
```

**Cleanup temp file**: NU lasa fisiere acumulate in `tmpdir`. Sterge dupa send. Strategia recomandata: wrapper `pipeAndCleanup(stream, filepath)` care apeleaza `fs.unlink(filepath).catch(() => {})` pe event-ul `close` al stream-ului. Daca Hono nu expune lifecycle clean pe response stream, alternativa acceptabila: `setTimeout(() => fs.unlink(filepath).catch(() => {}), 60_000)` (ugly dar safe). Documenteaza alegerea in cod cu un comentariu de 1 linie.

### Teste (6 teste portate din versiunea xlsx-js-style)

Citeste `backend/src/services/rnpmExportXlsx.test.ts` (varianta curenta in working tree) si porteaza fiecare test la ExcelJS. Asertiuni minime de pastrat:

1. **Smoke**: build pe 1 aviz cu 1 creditor, 1 debitor, 1 bun → fisier valid, deschis cu `ExcelJS.Workbook.xlsx.readFile()`, contine sheet-urile asteptate (Avize, Creditori, Parti, Bunuri).
2. **Filter `searchType=specifice`**: NU genereaza sheet "Creditori".
3. **Empty children**: aviz fara bunuri/parti → sheet-urile copil sunt absente sau goale (alege convertia consecventa cu vechea implementare).
4. **Formula injection guard**: party.denumire = `"=SUM(A1)"` → celula incepe cu `'`.
5. **Hyperlinks cross-sheet**: aviz cu copii → celula identificator are hyperlink valid `#<Sheet>!A<row>`.
6. **Filename**: 1 aviz → filename = `<identificator_sanitizat>.xlsx`; multiple → `rnpm_<searchType>_<data>.xlsx`.

Teste in plus NU adaugi. Daca vreun test devine inutil/redundant in ExcelJS, marcheaza-l ca atare in comentariu si OPRESTE-TE - raporteaza userului pentru decizie.

**Important pentru test runner**: `await buildRnpmXlsx(...)` returneaza acum `filepath`. In teste, citeste `filepath` cu `ExcelJS.Workbook.xlsx.readFile(filepath)` si sterge fisierul in `afterEach`.

### Validare Faza 1 (toate trebuie verzi inainte de commit)

```bash
# In ordine:
npx biome check --write backend/src/services/rnpmExportXlsx.ts backend/src/services/rnpmExportXlsx.test.ts backend/src/util/xlsxHelpers.ts backend/src/routes/rnpm.ts backend/package.json
npx tsc --noEmit -p backend/tsconfig.json
npm test --workspace=backend -- rnpmExportXlsx
npm test --workspace=backend                  # toate testele backend trec
npm run build                                 # bundle CJS reuseste

# Smoke manual desktop (OBLIGATORIU inainte sa zici "done"):
npm run electron:dev
# - cauta in RNPM o lista cu >= 50 avizi (sau pana la 148 daca ai dataset)
# - apasa Export XLSX
# - monitorizeaza Task Manager: Electron main process NU trebuie sa depaseasca 500MB
# - fisierul descarcat se deschide corect in Excel/LibreOffice
# - hyperlinks intre sheet-uri functioneaza
# - daca user-ul are dataset cu 148 avizi, ruleaza pe el integral
```

**Daca smoke pica** (orice: timeout, OOM, fisier corupt, hyperlinks rupte): OPRESTE, raporteaza userului cu telemetria exacta (memorie peak, ce s-a vazut in DevTools), NU incerca patch-uri pe loc.

### Commit Faza 1

Doar dupa ce TOATE punctele de validare sunt verzi:

```
refactor(rnpm): port export XLSX la ExcelJS streaming (faza 1)

- backend/src/services/rnpmExportXlsx.ts: rewrite cu exceljs.WorkbookWriter
  → scrie row-by-row la temp file pe disk, peak RAM ~200MB indiferent de count
- backend/src/util/xlsxHelpers.ts: pastreaza doar helpers reutilizabili
- backend/src/routes/rnpm.ts: handler stream-uieste temp file + cleanup
- backend/package.json: scoate xlsx-js-style (folosim exceljs deja in deps)
- Teste portate: 6 cazuri (smoke, specifice filter, empty children,
  formula injection, hyperlinks cross-sheet, filename)

Rezolva OOM Electron main 4GB peak pe 148 avizi (telemetry 2026-05-12).
```

**STOP. Cere aprobare user inainte sa pornesti Faza 2.**

---

## FAZA 2 - RNPM PDF server-side streaming (~2h)

**Precondition**: Faza 1 merged + smoke aprobat de user.

### Obiectiv
Muta build-ul RNPM PDF din frontend Web Worker pe backend, cu `pdfkit` streaming page-by-page la temp file pe disk. NU folosi `jspdf` sau `pdfmake` (ambele in-memory).

### Fisiere atinse (DOAR acestea in Faza 2)

| Fisier | Actiune |
|---|---|
| `backend/package.json` | Adauga `"pdfkit"` (latest stable) + `"@types/pdfkit"` (devDependencies). |
| `backend/src/services/rnpmExportPdf.ts` | **Fisier nou.** Serviciu analog cu `rnpmExportXlsx.ts`, dar cu `pdfkit`. Returneaza `{ filepath, filename, mime: "application/pdf", byteLength }`. |
| `backend/src/services/rnpmExportPdf.test.ts` | **Fisier nou.** Teste minime: smoke (1 aviz → PDF non-vid), filter searchType, formula injection NU se aplica (PDF nu are formule), filename. |
| `backend/src/routes/rnpm.ts` | **Adauga** ruta noua `POST /saved/export.pdf` analoaga cu `/saved/export.xlsx` (acelasi limiter `limitExport`, acelasi body schema, acelasi 500-id cap, acelasi `getOwnerId` + `getAvizeByIds`). NU schimba alte rute. |
| `frontend/src/lib/rnpmApi.ts` | **Adauga** functie `rnpmExportPdfBlob(ids, searchType)` analoaga cu `rnpmExportXlsxBlob`. NU schimba functii existente. |
| `frontend/src/lib/rnpmExport.ts` | Modifica DOAR functia `exportRnpmPDF` (sau echivalent) ca sa apeleze backend in loc de Worker. Sterge import-uri/helper-i jspdf+autotable folositi DOAR aici. NU atinge restul exporturilor. |

### Fisiere INTERZISE de atins in Faza 2

- `frontend/src/lib/rnpmExport.worker.ts` (vezi Faza 2.5 - cleanup separat)
- `frontend/vite.config.ts` (cleanup manualChunks vine in Faza 2.5)
- Orice export non-RNPM (`export.ts`, `export-*.ts`, `changelog-pdf.ts`, `monitoringBulkTemplate.ts`)
- Servicii backend non-RNPM
- DB layer, auth, middleware, migrations

### Contract API noua ruta

```
POST /api/v1/rnpm/saved/export.pdf
Body: { ids: number[]; searchType?: string }
Constrains: max 500 ids, searchType <= 64 chars
Success Content-Type: application/pdf
Restul header-elor (Content-Disposition, Content-Length, Cache-Control) identice cu .xlsx.
```

### Detalii pdfkit (orientativ)

`pdfkit` nu are `autoTable` echivalent. Tabelele se construiesc manual cu `doc.text(value, x, y, { width })` + `doc.lineTo` pentru borderi + `doc.moveTo` + `doc.stroke`. Cost ~2h vine de aici. Layout-ul target trebuie sa reproduca structural PDF-ul curent din `rnpmExport.ts` (titlu + stats line + tabel avize cu cele mai importante coloane + sectiuni separate per aviz pentru creditori/parti/bunuri daca PDF curent face asta).

**Streaming corect**:
```typescript
const doc = new PDFDocument({ size: "A4", margin: 36 });
const tmpPath = ...;
doc.pipe(fs.createWriteStream(tmpPath));
// scrie continut
doc.end();
await once(doc, "end"); // sau equivalent pe stream-ul de fisier
```

Pentru fiecare aviz, dupa o pagina cu mult continut, foloseste `doc.addPage()` proactiv ca sa eviti runtime branching pe height calc.

### Faza 2.5 - Cleanup Worker mort (in acelasi PR cu Faza 2)

Dupa ce PDF-ul e mutat pe backend, Web Worker-ul devine dead code. Sterge:

| Fisier | Actiune |
|---|---|
| `frontend/src/lib/rnpmExport.worker.ts` | DELETE. |
| `frontend/vite.config.ts` | In `build.rollupOptions.output.manualChunks`, sterge chunk-ul dedicat worker-ului (daca exista). Verifica `frontend/src/lib/rnpmExport.ts` pentru orice `new Worker(...)` reference si elimina-l. |
| `frontend/package.json` | Daca `jspdf`, `jspdf-autotable`, `xlsx-js-style` mai sunt importate DOAR de cod RNPM care a fost mutat pe backend, scoate-le. **VERIFICA INTAI** ca nu mai sunt folosite in `export.ts` (Faza 3 le va elimina si pe acolo) - daca da, lasa-le. Lipsa orfana = warning Vite la build, deci sigur ai feedback. |

### Validare Faza 2

```bash
npx biome check --write <fisiere atinse>
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
npm test --workspace=backend
cd frontend && npm test -- --run && cd ..
npm run build

# Smoke desktop:
npm run electron:dev
# - export RNPM PDF pe dataset mare (>= 50 avizi)
# - PDF se deschide in viewer, tabel coerent, headere/footere ok
# - Electron main NU depaseste 500MB
```

### Commit Faza 2

```
refactor(rnpm): port export PDF la pdfkit streaming server-side (faza 2)

- backend/src/services/rnpmExportPdf.ts: serviciu nou cu pdfkit streaming
- backend/src/routes/rnpm.ts: ruta noua POST /saved/export.pdf
- frontend/src/lib/rnpmApi.ts: helper rnpmExportPdfBlob
- frontend/src/lib/rnpmExport.ts: exportRnpmPDF apeleaza backend, dropdown worker
- frontend/src/lib/rnpmExport.worker.ts: DELETE (dead code dupa migration)
- frontend/vite.config.ts: cleanup manualChunks
- backend/package.json: + pdfkit + @types/pdfkit
```

**STOP. Cere aprobare user inainte sa pornesti Faza 3.**

---

## FAZA 3 - PortalJust Dosare/Termene + Alerte (~5h, doua substep-uri secventiale)

**Precondition**: Faza 2 merged + smoke aprobat.

Faza 3 are doua substep-uri independente (3a si 3b), fiecare cu propria validare + smoke + commit. Le tratezi secvential: **3a → smoke → commit → STOP pentru aprobare user → 3b → smoke → commit → STOP**.

Substep-urile sunt impreuna sub umbrela "Faza 3" pentru ca au aceeasi justificare arhitecturala (renderer Electron cu lib-uri in-memory pe data-driven scale) si acelasi pattern de migrare (server-side build + stream blob). Sunt separate la nivel de execution pentru ca atingem domenii diferite (PortalJust vs Monitoring), iar bundling-ul intr-un singur commit ar ingreuna review-ul + rollback-ul.

---

### FAZA 3a - PortalJust Dosare/Termene XLSX+PDF server-side (~3h)

**Justificare**: preventiva. NU avem dovada de crash, dar `frontend/src/lib/export.ts` (822 LOC) foloseste exact aceeasi combinatie toxica (`jspdf` + `xlsx-js-style`). 500+ dosare cu termene = potential 2GB+ pe renderer. Acelasi pattern arhitectural ca Faza 1+2.

#### Scope

Migram 4 functii din `frontend/src/lib/export.ts`:

| Functie frontend | Inlocuita cu |
|---|---|
| `buildDosareXlsx` (linia 167) | Backend service `dosareExportXlsx.ts` + ruta `POST /api/v1/dosare/export.xlsx` |
| `buildTermeneXlsx` (linia 359) | Backend service `termeneExportXlsx.ts` + ruta `POST /api/v1/termene/export.xlsx` |
| `buildDosarePdf` (linia 477) | Backend service `dosareExportPdf.ts` + ruta `POST /api/v1/dosare/export.pdf` |
| `buildTermenePdf` (linia 575) | Backend service `termeneExportPdf.ts` + ruta `POST /api/v1/termene/export.pdf` |

#### Fisiere atinse (Faza 3a)

| Fisier | Actiune |
|---|---|
| `backend/src/services/dosareExportXlsx.ts` | NEW. ExcelJS streaming, analog cu rnpmExportXlsx. |
| `backend/src/services/dosareExportPdf.ts` | NEW. pdfkit streaming, analog cu rnpmExportPdf. |
| `backend/src/services/termeneExportXlsx.ts` | NEW. |
| `backend/src/services/termeneExportPdf.ts` | NEW. |
| Teste corespunzatoare `*.test.ts` | NEW pentru fiecare, minimum smoke. |
| `backend/src/routes/dosare.ts` (sau ruta existenta) | Adauga 2 rute noi (xlsx + pdf). Daca nu exista router dedicat, intreaba userul - NU crea fisier nou fara confirmare. |
| `backend/src/routes/termene.ts` (sau echivalent) | Idem. |
| `frontend/src/lib/dosareApi.ts` / `termeneApi.ts` (sau echivalent) | Adauga helper-i blob analogi cu `rnpmExportXlsxBlob`. |
| `frontend/src/lib/export.ts` | Modifica `exportDosareExcel`, `exportTermeneExcel`, `exportDosarePDF`, `exportTermenePDF` (liniile 760-785) sa apeleze backend. **Sterge** `buildDosareXlsx`, `buildTermeneXlsx`, `buildDosarePdf`, `buildTermenePdf` dupa migrare. NU atinge `buildMonitoringXlsx`, `buildMonitoringPdf`, `buildAnalysisPDF`, `buildManualPDF`, `buildReportXlsx`, `buildReportPdf` - acelea raman client-side. |
| `frontend/package.json` | NU scoate inca `jspdf`/`jspdf-autotable`/`xlsx-js-style` - sunt inca folosite de Faza 3b (Alerte) si de exporturi mici care raman client-side. Cleanup-ul deps se face la finalul Faza 3b daca raman fara caller. |

#### Fisiere INTERZISE in Faza 3a

- Tot ce tine de Alerte (export-alerts.ts, AlertsExportModal.tsx, alerts.ts route) - vine in Faza 3b
- Exporturi mici (scale fix cunoscut, raman client-side):
  - `frontend/src/lib/export-analysis.ts` (analiza AI, max ~20 pag)
  - `frontend/src/lib/export-manual.ts` (manual user fix ~50 pag)
  - `frontend/src/lib/changelog-pdf.ts` (~30 versiuni)
  - `frontend/src/lib/monitoringBulkTemplate.ts` (template gol ~5KB)
- `frontend/src/lib/export-report.ts` (Dashboard raport, scale fix 7d/30d)
- DB layer (zero migrations in faza asta)
- Auth, middleware

#### Validare Faza 3a

Identica cu Faza 1+2: biome → tsc both sides → tests both sides → build → smoke desktop pe dataset cu >= 200 dosare si >= 500 termene.

#### Commit Faza 3a

```
refactor(export): port PortalJust dosare+termene XLSX+PDF la backend streaming (faza 3a)

- 4 servicii backend noi (dosare/termene x xlsx/pdf) cu ExcelJS+pdfkit streaming
- 4 rute noi sub /api/v1/{dosare,termene}/export.{xlsx,pdf}
- frontend/src/lib/export.ts: build* eliminate, export* apeleaza backend

Preventiv pentru risc OOM la datasets mari (500+ dosare). Pattern identic cu
faza 1+2 RNPM. Exporturi mici raman client-side.
```

**STOP. Cere aprobare user inainte sa pornesti Faza 3b.**

---

### FAZA 3b - Alerte XLSX+PDF server-side (~2h)

**Precondition**: Faza 3a merged + smoke aprobat.

**Justificare**: scale-ul depinde de count user (dismiss-uri acumulate, 1000+ alerte). Backend deja are `POST /api/v1/alerts/export` care intoarce randuri JSON; build-ul XLSX (`xlsx-js-style`) + PDF (`jspdf-autotable`) ruleaza pe renderer Electron. Acelasi pattern care a explodat la RNPM 148 avizi. Crash nedovedit, dar tehnologic identic.

#### Scope

Migram doua functii din `frontend/src/lib/export-alerts.ts`:

| Functie frontend | Inlocuita cu |
|---|---|
| `buildAlertsXlsx` (linia 57) | Backend service `alertsExportXlsx.ts` + ruta `POST /api/v1/alerts/export.xlsx` |
| `buildAlertsPdf` (linia 153) | Backend service `alertsExportPdf.ts` + ruta `POST /api/v1/alerts/export.pdf` |

Caller-ul `AlertsExportModal.tsx` trece de la flow-ul cu doua pasi (fetch rows JSON → build local) la un singur pas (POST payload → blob).

#### Fisiere atinse (Faza 3b)

| Fisier | Actiune |
|---|---|
| `backend/src/services/alertsExportXlsx.ts` | NEW. ExcelJS streaming. Reutilizeaza logica de decorare existenta (`deriveAlertDigestRow` din backend - verifica unde sta) pentru numarDosar + dosarLink. |
| `backend/src/services/alertsExportXlsx.test.ts` | NEW. Minimum: smoke 1 rand, smoke gol → 404, smoke cu `contextLabel`. |
| `backend/src/services/alertsExportPdf.ts` | NEW. pdfkit streaming. Hyperlink clickabil pe coloana dosar via `doc.link(x, y, w, h, { url })` analog cu varianta jspdf curenta. |
| `backend/src/services/alertsExportPdf.test.ts` | NEW. Minimum: smoke PDF non-vid, header `%PDF`. |
| `backend/src/routes/alerts.ts` | **Adauga** doua rute noi: `POST /export.xlsx` + `POST /export.pdf`. Body schema identica cu `/export` existenta (mode + ids/filters/range, `AlertExportBodySchema`). Same `limitAlertExportBody`, same `ALERT_EXPORT_MAX_ROWS` cap. Daca rows.length === 0 → return 404 cu mesaj clar. NU schimba ruta `/export` existenta - ramane ca legacy / debugging. |
| `frontend/src/lib/alertsApi.ts` | **Adauga** `alertsExportXlsxBlob(payload, signal?)` si `alertsExportPdfBlob(payload, signal?)` analog cu `rnpmExportXlsxBlob`. Reutilizeaza `parseFilenameFromContentDisposition` (muta-l in util shared sau duplica - alegere ta, dar consecvent). NU sterge `exportAlerts` (e folosita de alte caller-uri sau ca legacy debug). |
| `frontend/src/components/AlertsExportModal.tsx` | Modifica DOAR `handleExport` (sau echivalentul): in loc de `alertsApi.exportAlerts(payload) → exportAlertsToFile(format, rows)`, cheama direct `alertsApi.alertsExportXlsxBlob(payload)` sau `alertsExportPdfBlob(payload)` si trigger download. Pastreaza handling-ul abort/error existent. |
| `frontend/src/lib/export-alerts.ts` | Sterge `buildAlertsXlsx`, `buildAlertsPdf`, `exportAlertsToFile`. Pastreaza `AlertExportFormat` type daca mai e folosit de UI. Daca dupa stergere fisierul devine ~10 linii, OK; daca devine gol, sterge complet si curata import-urile in caller. |
| `frontend/src/lib/export-alerts.test.ts` | Sterge testele pe `buildAlertsXlsx` (nu mai exista). Daca fisierul devine gol, sterge complet. |
| `frontend/package.json` | DUPA Faza 3b verifica cu grep daca `xlsx-js-style`, `jspdf`, `jspdf-autotable` mai au caller. Scoate-le din `dependencies` daca raman orfane. ATENTIE: verifica ca `export-analysis.ts`, `export-manual.ts`, `changelog-pdf.ts`, `monitoringBulkTemplate.ts`, `export-report.ts` nu le mai folosesc. Daca le folosesc, lasa-le. |

#### Fisiere INTERZISE in Faza 3b

- `backend/src/routes/alerts.ts` - DOAR adaugi rutele noi, nu modifici nimic existent. Ruta `/export` (JSON rows) ramane intacta ca legacy / sursa de adevar pentru debugging.
- DB layer `monitoring_alerts` schema sau repository - zero modificari.
- `frontend/src/lib/alertsApi.test.ts` - daca testeaza `exportAlerts` (JSON), NU il atinge. Adaugi teste noi pentru `alertsExportXlsxBlob` daca crezi ca e cazul (smoke pe mock fetch), dar nu obligatoriu.
- Exporturi mici (vezi lista Faza 3a)

#### Contract API rute noi

```
POST /api/v1/alerts/export.xlsx
POST /api/v1/alerts/export.pdf
Body: identic cu /api/v1/alerts/export (AlertExportBodySchema - mode + ids/filters/range)
Cap: ALERT_EXPORT_MAX_ROWS (acelasi prag existent in ruta /export)
Erori:
  400 "invalid_body" - body parsing fail
  413 "too_many_rows" - count > ALERT_EXPORT_MAX_ROWS (acelasi mesaj ca /export)
  404 "no_rows" - selectia/filtrele intorc 0 alerte (mesaj clar - inlocuieste check-ul client-side curent din Modal)
Success: identic ca RNPM (Content-Type + Content-Length + Content-Disposition + Cache-Control: no-store)
```

#### Validare Faza 3b

```bash
npx biome check --write <fisiere atinse>
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..
npm test --workspace=backend
cd frontend && npm test -- --run && cd ..
npm run build

# Smoke desktop:
npm run electron:dev
# - Pagina Alerte → Export → XLSX pe selectie ids (1-5 alerte)
# - Export → XLSX pe filters (toate alertele active, 100+ daca exista)
# - Export → PDF idem
# - Verifica: hyperlink Dosar functioneaza (click → portal.just.ro deschide corect dosarul)
# - Electron main NU depaseste 500MB
# - Edge case: filtre care nu intorc nimic → 404 cu mesaj clar, NU crash
```

#### Commit Faza 3b

```
refactor(alerts): port export XLSX+PDF la backend streaming (faza 3b)

- backend/src/services/alertsExportXlsx.ts + alertsExportPdf.ts: streaming
- backend/src/routes/alerts.ts: rute noi POST /export.xlsx + /export.pdf
  (ruta /export ramane intacta ca legacy JSON)
- frontend/src/components/AlertsExportModal.tsx: cheama direct blob backend
- frontend/src/lib/alertsApi.ts: helper-i blob noi
- frontend/src/lib/export-alerts.ts: build*+exportAlertsToFile eliminate
- frontend/package.json: cleanup xlsx-js-style/jspdf/jspdf-autotable daca orfane

Preventiv pentru risc OOM la 1000+ alerte. Pattern identic cu faza 1+2+3a.
Exporturi mici (analiza AI / manual / changelog / monitoring template /
report dashboard) raman client-side.
```

---

## DUPA CELE 3 FAZE - Version bump

Nu bump-ui versiunea automat. Asteapta directiva userului pentru numarul exact (probabil v2.23.0 sau v2.22.1 in functie de scope perceput). Cand vine bump-ul, urmeaza checklist-ul din [CLAUDE.md](CLAUDE.md) - "Checklist bump de versiune" (8 puncte obligatorii + condicionale).

## CE SA FACI DACA APAR PROBLEME

| Situatie | Actiune |
|---|---|
| Biome reformateaza dupa commit | Commit follow-up `style: biome format pass` IMEDIAT, push. NU lasa pe altcineva. |
| Test pica si nu intelegi de ce | OPRESTE. Raporteaza userului output-ul exact al testului + ce ai facut ultima data. NU "improvise fixes". |
| ExcelJS WorkbookWriter arunca eroare la `.commit()` pe sheet | Probabil ai apelat o operatie pe un row deja commited. Verifica ca scrii row-by-row si commit-uiesti DOAR la final. Daca nu rezolvi in 15 min, raporteaza. |
| Cleanup temp file nu functioneaza (fisier ramane in tmpdir) | Documenteaza in comentariu si treci la `setTimeout` fallback. NU bloca livrarea pe problema asta. |
| Apare un fisier care NU e in lista "atinse" pe care ai vrea sa-l modifici | OPRESTE. Intreaba inainte. |
| Userul cere o schimbare in afara planului mid-faza | Acepta cererea, dar marcheaza explicit ca deviation in commit message. |

## CHEAT SHEET FINAL

```
Faza 1 (RNPM XLSX) → smoke → commit → STOP
Faza 2 (RNPM PDF + worker cleanup) → smoke → commit → STOP
Faza 3a (PortalJust dosare+termene) → smoke → commit → STOP
Faza 3b (Alerte) → smoke → commit → STOP
Bump versiune doar la cererea explicita a userului.
```

**Scope explicit OUT (raman client-side):**
- `export-analysis.ts` - analiza AI, ~5-20 pag fix
- `export-manual.ts` - manual user, ~50 pag fix
- `changelog-pdf.ts` - ~30 versiuni fix
- `monitoringBulkTemplate.ts` - template gol ~5KB
- `export-report.ts` - raport dashboard, range fix 7d/30d (max ~210 randuri)

Regula: server-side stream DOAR daca scale-ul depinde de count user (unbounded). Pentru scale fix cunoscut, client-side e safe si mai simplu.

**Nu te abate. Nu refactoriza pe linga. Nu adauga features. Test inainte de commit. Smoke inainte de "done".**
