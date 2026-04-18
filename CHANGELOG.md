# Changelog - Legal Dashboard

Toate modificarile notabile ale acestui proiect sunt documentate in acest fisier.

---

## 18 Aprilie 2026 (sesiune 3) — Fix filtre RNPM: `activ` semantic + `tipInscriere` index

Doua bug-uri la cautarile RNPM descoperite azi:

### 1. Checkbox "Numai active" nu facea nimic — toate avizele veneau marcate active

**Simptom:** User a rulat cautare CUI 37700569 cu "Numai active" debifat si a primit 42 rezultate **toate marcate active**, desi pe site-ul RNPM aceeasi cautare intoarce ~180 rezultate (active + inactive).

**Cauza dubla:**
1. **Endpoint-ul `/api/search/ipoteci` trateaza `{"activ": false}` identic cu `{"activ": true}`** — ambele filtreaza la active-only (criteriu echoat contine "este activ" in ambele cazuri). Singurul mod de a primi active + inactive este sa **omiti cheia `activ` complet** din payload.
2. Parser-ul backend la [backend/src/services/rnpmSearchService.ts:153](backend/src/services/rnpmSearchService.ts#L153) avea `doc.activ = detail.part1?.activ !== false` — cand `part1.activ` era `undefined`/absent, comparatia `undefined !== false` = `true`, deci toate avizele ajungeau marcate active indiferent de realitate.

**Fix:**
- Frontend ([RnpmSearchForm.tsx:749-756](frontend/src/components/rnpm/RnpmSearchForm.tsx#L749-L756)): `onChange` era deja corect (`checked ? true : undefined` → cand debifat, `activ` nu e trimis). Comportamentul asteptat confirmat prin Network capture.
- Backend ([rnpmSearchService.ts:153](backend/src/services/rnpmSearchService.ts#L153)): `if (typeof detail.part1?.activ === "boolean") doc.activ = detail.part1.activ;` — preserva `part1.activ` doar cand e boolean explicit.
- Backend ([rnpmSearchService.ts:289](backend/src/services/rnpmSearchService.ts#L289)): la persist, `activ: typeof part1.activ === "boolean" ? part1.activ : (doc.activ ?? true)`.

**Verificat empiric:** CUI 39029401 fara `activ` → 190 rezultate (mix active + inactive); cu `activ: true` → 146 (doar active). Avizul `2020-05051707599224-CAY` aparut in DB cu `activ=0`.

**Semantica RNPM (documentata acum):**
- `activ` = STAREA avizului (in vigoare vs. expirat/stins).
- `nemodificat` = ISTORIA avizului (atins de acte ulterioare sau nu) — dimensiune ortogonala fata de `activ`.
- Combinatii testate pe CUI 39029401: ambele unset → 190; `nemodificat:true` only → 170; `activ:true` only → 166; ambele true → 146.

### 2. Dropdown "Tipul avizului" pe `specifice` (si celelalte non-ipoteci) — 0 rezultate chiar cu criterii identice cu site-ul

**Simptom:** Cautare specifice + tip "stingere" + CUI 39029401 + nemodificat → 0 in app, 73 pe site.

**Cauza:** RNPM asteapta `tipInscriere.value` ca **index 1-based** in lista tipurilor de aviz din categoria curenta, NU ca label. Request-ul site-ului pentru "stingere" pe specifice: `{"tipInscriere":{"type":"1","value":"3"}}` (pozitia 3 in lista `["aviz initial","modificare","stingere",...]`). Aplicatia trimitea `value: "stingere"` → RNPM il ignora si echoia `Tipul inscrierii este ''` → 0 rezultate.

**Fix** ([RnpmSearchForm.tsx handleSubmit](frontend/src/components/rnpm/RnpmSearchForm.tsx)): la submit, `tipInscriere.value` se converteste din label → index 1-based folosind `TIP_AVIZ_BY_CATEGORY[activeType].indexOf(label) + 1`. Uniform pentru toate cele 5 tipuri (convenția site-ului e identica). State-ul dropdown-ului ramane label pentru UX — conversia e punctuala la submit.

**Verificat empiric:** specifice + tip stingere + CUI 39029401 → 73 rezultate (identic cu site-ul).

### Verificare

- Rebuild frontend + recopiere `dist-frontend` + restart Electron efectuate dupa fiecare fix (fara HMR in Electron).
- Testat manual: ipoteci (CUI 39029401, 37700569) + specifice (CUI 39029401). Celelalte tipuri (fiducii/creante/obligatiuni) — fix-ul tipInscriere e uniform, dar fara CUI-uri de test nu am putut confirma direct.
- Diagnostic console.log-uri adaugate temporar au fost eliminate.

---

## 18 Aprilie 2026 (sesiune 2) — Parser avize specifice + UI/export per-tip + cascade delete + backup button disable

Context: aviz `2021-07221630009133-WUW` (specific, initial) aparea cu tab-uri goale — Creditori/Debitori/Bunuri fara date — desi pe site-ul RNPM avea PJ (`IFN IMPRUMUT EXPRES`), PF (`BUDAN NICU ILIE`) si bun descris ca "fideiusiune". Diagnosticul a aratat ca RNPM returneaza pentru tipul `specifice` un shape diferit fata de `ipoteci`:

- `part2.partiF / part2.partiJ` (in loc de `creditoriF/creditoriJ` + `debitoriF/debitoriJ`); partile au `calitate` + `altaCalitate` (ex: "Altele: Fideiusiune").
- `part3.bunuri` (in loc de `part4.vehicule/mobile/alte`); bunurile au doar `no` + `descriere`.
- `part4 = null` pentru specifice.

### 1. Parser backend — branch pe `searchType === "specifice"`

**Types** ([backend/src/services/rnpmClient.ts](backend/src/services/rnpmClient.ts)):
- `RnpmDetailPartyPF/PJ` — adaugat `calitate` + `altaCalitate`.
- `RnpmDetailPart2` — adaugat `partiF?: RnpmDetailPartyPF[]` + `partiJ?: RnpmDetailPartyPJ[]`.
- `RnpmDetailPart3` — adaugat `bunuri?: RnpmDetailBun[]`.

**Persist** ([backend/src/services/rnpmSearchService.ts](backend/src/services/rnpmSearchService.ts)):
- Helper `formatCalitate(calitate, altaCalitate)` — combina `"Altele: Fideiusiune"` cand `altaCalitate` e prezent; altfel returneaza `calitate` brut.
- Pentru `specifice`: `creditori = []`; `debitori` = `partiF + partiJ` cu `calitate` formatata; `bunuri` = `part3.bunuri` cu `tip_bun: "alt"` si doar `descriere` populat (restul campurilor null). Pentru celelalte tipuri, ramane codul vechi (creditori/debitori/bunuri din buckets-urile originale).

### 2. UI tabs — "Parti" in loc de Creditori/Debitori pentru specifice

**Frontend** ([frontend/src/components/rnpm/RnpmDetailModal.tsx](frontend/src/components/rnpm/RnpmDetailModal.tsx)):
- `isSpecifice = data?.aviz.search_type === "specifice"`.
- Pentru specifice: 4 tab-uri (`General`, `Parti`, `Bunuri`, `Istoric`) — se dropeaza tab-ul "Creditori". Tab-ul "Parti" foloseste bucket-ul `debitori` (unde parser-ul pune partile) cu label schimbat.
- `emptyMsg={isSpecifice ? "Fara parti" : "Fara debitori"}`.

### 3. Export Excel + PDF — etichete per-tip + filename identificator

**Frontend** ([frontend/src/lib/rnpmExport.ts](frontend/src/lib/rnpmExport.ts)):
- `isSpecifice` + `partyLabel2 = isSpecifice ? "Parti" : "Debitori"` calculate o data la export.
- Sheet "Avize" (overview) dropeaza coloana "Creditori" pentru specifice; numerotarea coloanelor pentru link-urile interne (Creditori/Debitori/Bunuri/Istoric) ajustata corespunzator.
- Linia de stats afiseaza `"{N} parti"` in loc de `"{N} creditori + {N} debitori"` pentru specifice.
- Sheet "Creditori" **nu** se mai creeaza pentru specifice (`wsCred = null`); sheet "Debitori" se redenumeste "Parti" via `book_append_sheet(wb, wsDeb, partyLabel2)`.
- PDF: sectiunea "Creditori" se omite pentru specifice; sectiunea "Debitori" apare sub titlul "Parti".
- **Filename identificator:** cand exportul e pentru un singur aviz (`docs.length === 1`), filename-ul devine `<identificator>.xlsx/.pdf` (sanitizat cu `[^A-Za-z0-9._-]+ → _`) in loc de `rnpm_<tip>_<timestamp>`. Valabil pentru toate cele 5 tipuri RNPM, nu doar specifice.

### 4. "Sterge back-up" — disable cand nu exista backup-uri

**Frontend** ([frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx)):
- State nou `backupCount: number | null` (null = neincarcat / eroare la listare → buton activ ca retry affordance).
- `loadBackups()` — apeleaza `rnpmListBackups()` la mount + dupa orice delete; seteaza `backupCount = list.length`.
- Butonul "Sterge back-up" are `disabled={backupCount === 0}` + `title` explicativ + `disabled:opacity-50`. Clasa `ml-auto` pastrata pentru spacing.

### 5. "Sterge baza" cascadeaza la rezultatele din tab "Cautare"

Inainte: `onAfterDeleteAll` bumpa doar `savedRefreshKey` (re-fetch baza locala). Tab-ul "Cautare" pastra in-memory rezultatele vechi care pointau la ID-uri sterse → click pe aviz = 404 pe `rnpmGetAvizDetail`.

**Frontend** ([frontend/src/pages/RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx)):
- Callback-ul pasat la `<RnpmSavedStats onAfterDeleteAll={...}>` reseteaza acum `result`, `error`, `elapsedMs` in plus de refreshKey. Actiunea "Sterge back-up" ramane separata — nu curata rezultatele (backup-urile nu invalideaza DB-ul curent).

### Pending / de continuat

- **fiducii / creante / obligatiuni ipotecare** — parser-ul folosit azi acopera doar ipoteci (default) + specifice. User a ales **Optiunea 1** (astepta sample-uri reale inainte de extindere — fara cod speculativ). La urmatoarea sesiune: rula una-doua cautari reale pentru fiecare tip, captura raspunsul RNPM (parts 1-4 + istoric) si extinde `rnpmSearchService.ts` cu ramuri noi unde shape-ul difera.

### Verificare

- `npx tsc --noEmit` frontend + backend — clean.
- `npm run build` frontend (Vite) — OK; `dist-frontend/` copiat peste.
- Rebuild backend (esbuild via `scripts/build.js`) necesar cand se modifica `backend/src/**` pentru ca `electron:dev` incarca bundle-ul `dist-backend/index.cjs`, nu sursa `.ts`.
- Manual in Electron:
  - Re-cautare aviz specific cu CUI-ul reclamat → tab "Parti" populat cu PJ + PF, tab "Bunuri" cu descrierea "fideiusiune".
  - Export individual aviz specific → xlsx/pdf denumit `<identificator>`; sheet Creditori absent, sheet Parti prezent.
  - "Sterge baza" → tab "Cautare" curatat automat, buton "Sterge back-up" ramane activ (exista backup-uri).
  - "Sterge back-up" → butonul se dezactiveaza dupa delete cand count-ul ajunge la 0.

---

## 18 Aprilie 2026 — Mini-lag RNPM rezolvat + backup zilnic + dialog confirmare stilizat + restore flow + dashboard persistent

Sesiune dedicata **fluiditatii UI** (tab-enter + deschidere aviz), **rezilientei datelor** (backup automat) si **coerentei vizuale** (confirmari native Chromium → dialog stilizat in app).

### 1. Performanta — mini-lag la intrarea pe tab si deschiderea avizelor

Diagnostic: nu era viteza query-urilor, ci (a) unmount/remount al componentei la tab switch si (b) round-trip + 5 query-uri pentru fiecare click pe aviz. Aplicate trei interventii complementare:

**A. Keep-mounted pe RnpmSavedData** ([frontend/src/pages/RnpmSearch.tsx](frontend/src/pages/RnpmSearch.tsx)):
- Inainte: `{tab === "saved" && <RnpmSavedData .../>}` — conditional render = unmount total la fiecare tab-switch, cu re-fetch + re-hidratare state.
- Dupa: `<div className={tab === "saved" ? "" : "hidden"}><RnpmSavedData .../></div>` — componenta ramane montata, state (filtre, pagina, selectie) persistat, re-intrarea pe tab este instant.

**D. Cache in-memory pentru detaliul avizului** ([frontend/src/lib/rnpmApi.ts](frontend/src/lib/rnpmApi.ts)):
- `avizDetailCache: Map<number, { data, expiresAt }>` + `AVIZ_DETAIL_TTL_MS = 60_000`.
- `rnpmGetAvizDetail(id)` verifica cache-ul inainte de fetch; hit-ul evita round-trip-ul + cele 5 query-uri repository-side.
- Invalidare explicita in `rnpmDeleteAviz`, `rnpmDeleteAllSaved`, `rnpmDeleteAvizeBatch` — coherenta garantata cu stergeri.

**E. Prewarm SQLite page cache la bootstrap** ([backend/src/index.ts](backend/src/index.ts)):
- Dupa `serve(...)`: `getAvize({ limit: 1 })` + `getAvizStats()` — fortam o prima atingere a paginilor SQLite care altfel s-ar citi de pe disc la primul request al userului.
- Cold-start dispare din prima interactiune — cache-ul paginilor e deja cald cand userul apasa pe tab.

### 2. Backup zilnic automat al bazei locale

Motivatie: cu mii de avize salvate, pierderea `.db`-ului ar fi costisitoare. Solutie — backup automat la fiecare pornire, cu rotatie.

**Backend** ([backend/src/db/backup.ts](backend/src/db/backup.ts)):
- `runDailyBackup()` — foloseste `better-sqlite3` online backup API (`db.backup(dest)`), sigur cu WAL fara checkpoint sau exclusive lock.
- Nume: `legal-dashboard.YYYY-MM-DD.db` in `<userData>/backups/`.
- Skip daca ultimul backup `<24h` (check pe `mtimeMs` din `fs.stat`).
- Rotatie: sortare lexicografica (= cronologica gratie formatului ISO in nume), pastreaza ultimele 7, sterge restul.
- Best-effort — orice esec logheaza `[backup] failed: ...` si lasa app-ul sa porneasca normal.
- `runDailyBackup()` apelat in [backend/src/index.ts](backend/src/index.ts) dupa prewarm, cu `.catch(...)` ca nu blocheaza bootstrap-ul.

**Endpoints noi** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)):
- `POST /api/rnpm/open-backups-folder` — `shell.openPath(backupsDir)` + `mkdir -p` defensiv (501 daca nu e Electron).
- `DELETE /api/rnpm/backups` — `deleteAllBackups()` (unlink pe toate fisierele care respecta prefix/sufix), returneaza `{ deleted: n }`.

### 3. Dialog de confirmare stilizat (inlocuieste `window.confirm()` nativ)

Motivatie: user a observat ca pop-up-urile native Chromium arata strain fata de restul UI-ului. Creat un dialog unified stilizat cu app-ul.

**Componenta noua** ([frontend/src/components/ui/confirm-dialog.tsx](frontend/src/components/ui/confirm-dialog.tsx)):
- `ConfirmProvider` + `useConfirm()` hook (Promise-based: `await confirm({ message, confirmLabel, cancelLabel, destructive, title })`).
- Icon `AlertTriangle` pentru variantele destructive; buton confirm rosu cand `destructive: true`.
- Keyboard: `Escape` = cancel, `Enter` = confirm. Click-outside = cancel. Auto-focus pe butonul de confirmare.
- `z-[100]`, backdrop-blur, consistent cu restul modalelor din app.
- Wrapper instalat in [frontend/src/App.tsx](frontend/src/App.tsx) sub `BrowserRouter`.

**Call-site-uri migrate** (4):
- [RnpmSavedData.tsx](frontend/src/components/rnpm/RnpmSavedData.tsx) — sterge aviz individual + batch delete.
- [RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx) — sterge toate avizele din baza locala.
- [RnpmSearchForm.tsx](frontend/src/components/rnpm/RnpmSearchForm.tsx) — warning CUI invalid (non-destructive, confirmLabel="Continua").

### 4. "Info baza locala" — management backups + relabel butoane

[frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx) — reorganizare zona de actiuni:
- `[Folder baza]` `[Backups]` ... `[Sterge back-up]` `[Sterge baza]`
- Butonul `Backups` (icon `Archive`) → deschide `<userData>/backups/` in File Explorer.
- Butonul `Sterge back-up` (rosu, outline) → sterge toate fisierele de backup (confirm destructiv); urmatorul backup se genereaza la urmatoarea pornire a app-ului.
- Butonul `Sterge baza` pastreaza comportamentul anterior (fost "Sterge tot"), cu confirm destructiv; confirmarile folosesc toate noul `useConfirm()`.
- Relabel: "Deschide folder" → "Folder baza".

### 5. Fix UI — DosareTable timeline sedinte

Efect secundar al `dd05b05` (font-scale bump): data "19.01.2026" era taiata, iar cercul-marker nu se alinia vertical cu linia.
**Frontend** ([frontend/src/components/DosareTable.tsx](frontend/src/components/DosareTable.tsx)): coloana data `w-[60px]`→`w-[80px]`, marker-ul `left-[72px]`→`left-[92px]`, spacing `mt-1`→`mt-1.5`.

### 6. Bugfix — paginare goala dupa aplicare filtre

Simptom: la aplicarea unui filtru care reducea numarul de pagini, tabela ramanea goala pentru ca `page` depasea noul `totalPages` si slice-ul `filtered.slice((page-1)*pageSize, page*pageSize)` returna `[]`.

**Frontend** ([frontend/src/components/DosareTable.tsx](frontend/src/components/DosareTable.tsx), [frontend/src/components/TermeneTable.tsx](frontend/src/components/TermeneTable.tsx)): `useEffect` care clampeaza `page` la `Math.max(1, totalPages)` cand filtered data se schimba. Dependency array include lungimea datelor filtrate + pageSize.

### 7. TermeneTable — chei stabile pentru selectie (CP-B P2.3)

Inainte: selection state folosea index-ul rand-ului (`${page}-${idx}`) drept cheie. La sortare/filtrare, Set-ul de selectii "se agata" de indici care indicau alte randuri — selectie care pare sa sara.

**Frontend** ([frontend/src/components/TermeneTable.tsx](frontend/src/components/TermeneTable.tsx)): cheie compusa stabila `${institutie}|${departament}|${numar}|${ora}|${complet}` in locul index-ului; helper `rowKey(t)` aplicat peste tot in checkbox handlers, `selectAllFiltered`, export CSV.

### 8. RnpmDetailModal — identificator aviz in header

User vrea sa vada identificatorul avizului fara sa scrolleze pana la randul de detalii.

**Frontend** ([frontend/src/components/rnpm/RnpmDetailModal.tsx](frontend/src/components/rnpm/RnpmDetailModal.tsx)): `<h3>` cu `flex items-baseline gap-2`, "Detalii Aviz" `text-sm font-semibold` + identificator `text-xs font-semibold text-foreground` (fara font-mono — metricile diferite intre sans/mono cauzeaza offset vizual la `items-center`; baseline + acelasi font family rezolva alinierea).

### 9. Dashboard — persistenta "Ultima Cautare" pentru dosare (Optiunea 1)

Inainte: dupa restart, cardul "Dosare" disparea din dashboard chiar daca userul facuse zeci de cautari. RNPM avea deja persistenta; dosare nu.

Decisie: **nu** persistam intregul dataset (prea mare, deja avem istoric local), ci doar meta-count-urile + params-ul ultimei cautari. Click pe card → navigare la pagina dosare + re-trigger search cu params stored (prin pending-search pattern existent).

- **Types** ([frontend/src/types/index.ts](frontend/src/types/index.ts)): `SearchHistoryEntry.meta?: { categoriesCount; institutiiCount }`.
- **Hook** ([frontend/src/hooks/useSearchHistory.ts](frontend/src/hooks/useSearchHistory.ts)): `addEntry(type, params, resultCount, meta?)`.
- **Dosare** ([frontend/src/pages/Dosare.tsx](frontend/src/pages/Dosare.tsx)): `handleSearch` construieste Set-urile pentru categorie + institutie, pasa meta prin `onSearchComplete`.
- **Dashboard** ([frontend/src/pages/Dashboard.tsx](frontend/src/pages/Dashboard.tsx)): daca nu sunt date live, fallback pe `history.find(e => e.type === "dosare")`. Click pe card → `navigate("/dosare")` + (daca e fallback) `onHistoryClick("dosare", params)` pentru refresh.
- **App** ([frontend/src/App.tsx](frontend/src/App.tsx)): passing `history` + `onHistoryClick` la Dashboard.

### 10. Restore baza locala din backup

User: "Cum putem face restore la un backup daca stergem baza principala?". Motivatie — azi un backup corupt sau o stergere accidentala ar fi fatala fara o cale de recuperare in-app.

**Backend** ([backend/src/db/backup.ts](backend/src/db/backup.ts)):
- `listBackupsWithMeta()` — enumera fisierele care respecta prefix/sufix, returneaza `{ name, sizeBytes, mtime }[]`, sortat desc pe mtime.
- `restoreFromBackup(name)` — validare stricta: regex `/^legal-dashboard\.[A-Za-z0-9._-]+\.db$/` + check `/` si `\` (block path traversal).
  - `closeDb()` — necesar pe Windows unde fisierul deschis e blocat.
  - Snapshot preventiv al DB-ului curent in `legal-dashboard.pre-restore-<ISO>.db` (user poate rolla back manual).
  - `copyFile(src, dbPath)`.
  - Unlink `-wal` + `-shm` (sidecar-urile apartin vechii DB; ar corupe deschiderea noii DB).
  - Returneaza `preRestoreName` catre UI.

**API** ([backend/src/routes/rnpm.ts](backend/src/routes/rnpm.ts)): `GET /api/rnpm/backups` + `POST /api/rnpm/backups/restore` (cu `limitSmall`).

**Frontend** ([frontend/src/lib/rnpmApi.ts](frontend/src/lib/rnpmApi.ts)): `rnpmListBackups()` + `rnpmRestoreBackup(name)`.

**UI** ([frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx)): buton "Restaurare" (icon `History`) intre "Backups" si "Sterge back-up". Deschide `RestoreModal` — lista backups (name + size + data), confirm destructiv cu `useConfirm`, afisare success cu `preRestoreName`, reincarca stats + trigger `onRestored` dupa 2.5s pentru re-hidratare.

### 11. Info baza locala — aliniere "Cale:" + modal largit

User: "alinieaza vizual 'Cale' cu scrisul caii efective" + "poti lungi si fereastra putin".

**Frontend** ([frontend/src/components/rnpm/RnpmSavedStats.tsx](frontend/src/components/rnpm/RnpmSavedStats.tsx)):
- Modal `max-w-xl` → `max-w-2xl`.
- "Cale:" row — inlinat intr-un singur `<div className="leading-5">` cu `<span>Cale: </span><span className="font-mono ...">{path}</span><button ...><Copy/></button>`. Butonul de copiere `h-4 w-4 translate-y-[2px]` aliniat vizual cu linia de text (font-mono are metrici diferite de sans — baseline pur nu ajunge, translate-y fixeaza restul).

### 12. Dependency hygiene

- Bump `dompurify` — patch minor de securitate (XSS sanitizer).
- Bump `@anthropic-ai/sdk` — pastram in sync cu release-urile upstream.
- `npm audit` — 0 vulnerabilitati la nivel repo.

### Verificare

- `npx tsc --noEmit` (frontend + backend) — clean.
- `node scripts/build.js` — build complet reproducibil, backend bundle `1.7mb`.
- Reproducere manuala in Electron:
  - Tab-switch intre RNPM → Cautare ↔ Baza locala — instant, fara re-fetch vizibil.
  - Click pe aviz recent → modal apare instant (cache hit).
  - Log backend la pornire: `[backup] saved legal-dashboard.2026-04-18.db`.
  - Fisier prezent in `%APPDATA%/legal-dashboard/backups/`.
  - Delete aviz / Delete all / Sterge back-up / CUI warning — toate afiseaza dialog stilizat, nu pop-up nativ.
  - RNPM → Info baza locala → "Restaurare" → selecteaza backup → confirm → app reincarca cu datele din backup; fisier `legal-dashboard.pre-restore-*.db` aparut in `backups/`.
  - Dashboard dupa restart (fara cautare in sesiunea curenta) — cardul "Dosare" afiseaza ultima cautare persistata; click → navigheaza + re-triggereaza search-ul automat.
  - Aplicare filtru pe pagina 5 dintr-o tabela cu 50 rezultate → `page` clampat la ultima pagina valida, tabela afiseaza randuri.

---

## 17 Aprilie 2026 — Butonul Stop RNPM functioneaza cap-coada (abort chain complet)

Bug raportat: la tab-ul **Cautare RNPM → Cautare**, click pe butonul **Stop** nu oprea efectiv cautarea. UI parea "blocat" (Stop + "Interogare RNPM..." persistau), iar dupa cateva incercari aparea un val de ~25 avize persistate in baza locala fara ca userul sa fi cerut. Investigatia a scos la iveala mai multe probleme in lantul de anulare — rezolvate toate in aceasta sesiune.

### 1. Abort propagat din UI prin fetch pana la backend

Inainte: `rnpmSearch()` + `runSearch()` + `loadNextBatch()` nu aveau `AbortController` deloc. Click pe Stop doar ascundea UI-ul dar fetch-ul continua in background si backend-ul rula pana la capat.

**Frontend** ([frontend/src/lib/rnpmApi.ts:39-52](frontend/src/lib/rnpmApi.ts#L39-L52)):
- `rnpmSearch(...)` accepta acum `signal?: AbortSignal` ca ultim parametru si il pasa la `fetch({ signal })`.

**Frontend** ([frontend/src/pages/RnpmSearch.tsx:61-156](frontend/src/pages/RnpmSearch.tsx#L61-L156)):
- `abortRef: useRef<AbortController | null>` — detine controller-ul cautarii in curs (un singur concurrent).
- `stoppedRef: useRef(false)` — flag sincron (nu state batched) pentru a ignora rezultate parvenite dupa Stop.
- `runSearch()` + `loadNextBatch()`: guard `if (abortRef.current) return` impotriva start-urilor concurente; creeaza controller nou, reseteaza `stoppedRef=false`, pasa `ctl.signal` la `rnpmSearch(...)`; in `finally` elibereaza `abortRef` si flip-uieste loading-ul. Verifica `stoppedRef.current || ctl.signal.aborted` inainte de a comita rezultate in state (nu mai populeaza UI cu rezultate din request abortate).
- `handleStop()` — seteaza `stoppedRef=true`, cheama `abortRef.current?.abort()`, flip `loading=false` + `phase=""`.

**Backend** ([backend/src/routes/rnpm.ts:95,111-114](backend/src/routes/rnpm.ts#L95-L114)):
- `rnpmRouter.post("/search")` pasa `c.req.raw.signal` la `executeSearch({ signal })`. In `catch` recunoaste `DOMException("AbortError")` si returneaza 500 cu mesaj "Cautare oprita" + log `[rnpm/search] aborted by client`.

### 2. Abort propagat in toate fetch-urile outbound

Inainte: chiar daca backend-ul primea abort, fetch-urile catre RNPM (search + detail parts 1-4 + istoric) continuau pana la timeout-ul default al Node fetch.

**Backend** ([backend/src/services/rnpmClient.ts:199-256](backend/src/services/rnpmClient.ts#L199-L256)):
- `RnpmClient.search()`, `fetchPart()`, `fetchIstoric()`, `fetchFullDetail()` — toate accepta `signal?: AbortSignal`.
- `fetchFullDetail()` pasa `signal` la toate cele 5 fetch-uri paralele (parts 1-4 + istoric) via `Promise.all`.

**Backend** ([backend/src/services/rnpmSearchService.ts:38-175](backend/src/services/rnpmSearchService.ts#L38-L175)):
- Helper `throwIfAborted(signal)` folosit la ~6 puncte cheie (inainte/dupa captcha, intre pagini, inainte de batch).
- `input.signal` threaded prin tot orchestratorul: catre `solveRnpmCaptcha`, `client.search`, `client.fetchFullDetail`.
- Retry-urile de captcha pe pagina ramasa (gcode expirat) re-check `throwIfAborted` inainte de re-solve.
- `executeBulkSearch` propaga signal catre fiecare `executeSearch` si iese curat la abort (fara "done"/"error" SSE events).

### 3. Abort ajunge la solver-ul de captcha (2Captcha + CapSolver)

Inainte: SDK-ul `@2captcha/captcha-solver` este blocant (pana la 60s) si nu accepta `AbortSignal`. CapSolver polluia la 2s intervale fara a verifica signal. Click pe Stop in timpul captchei astepta pana la 60-120s inainte sa se elibereze.

**Backend** ([backend/src/services/captchaSolver.ts:28-125](backend/src/services/captchaSolver.ts#L28-L125)):
- `solveWith2Captcha` — `Promise.race([solvePromise, abortPromise])` unde `abortPromise` rejecteaza pe `signal.addEventListener("abort", ...)`. Curatenie listener in `finally { signal.removeEventListener(...) }` ca sa nu tinem referinta dupa ce promise-ul se termina. Comentariu inline explica ca token-ul rezolvat ulterior e pierdut (acceptabil — nu blocam UI-ul 60s).
- `solveWithCapSolver` — fiecare iteratie de polling verifica `if (signal?.aborted) throw new DOMException("Aborted", "AbortError")`. `fetch` primeste si el `signal` (abortare chiar a request-ului HTTP, nu doar pauza dintre polls).
- Fallback 2Captcha (daca CapSolver esueaza) — re-propaga `signal`, re-verifica `signal?.aborted` la intrare si dupa `await`.
- `solveRnpmCaptcha` — orchestreaza ambii provideri, re-verifica `signal` la intrare, intre provideri, si la iesire.

### 4. Skip persist daca fetch-ul a scapat de abort inainte de SQLite

Inainte: `processPage` facea `await client.fetchFullDetail(...)` si imediat `persistAvizWithDetail(...)` sincron in SQLite. Un `Promise.all` cu `concurrency=7` insemna ca daca abort-ul venea in mijlocul batch-ului, fetch-urile deja rezolvate continuau sa persiste → avize partiale in baza locala.

**Backend** ([backend/src/services/rnpmSearchService.ts:140-148](backend/src/services/rnpmSearchService.ts#L140-L148)):
- Dupa `await client.fetchFullDetail(doc.identificator.k, signal)` verificare explicita `if (signal?.aborted) throw new DOMException("Aborted", "AbortError")` inainte de a apela `persistAvizWithDetail`. Fetch-urile care se intorc dupa abort sunt ignorate — SQLite ramane neatinsa.

### 5. Bug final: butonul Stop auto-submita form-ul (React 18 DOM node reuse)

Cu toate fix-urile de mai sus aplicate, Stop tot parea sa nu functioneze. Instrumentare temporara cu `console.log` + `console.trace` in `handleSubmit`, `runSearch`, `handleStop`, ruta `/search` + `executeSearch` a relevat secventa reala:

```
[RNPM handleStop] ENTRY
[RNPM handleStop] abort() called, signal.aborted=true
[RNPM handleStop] setLoading(false) called
[RnpmSearchPage render] {loading: false}
[RnpmSearchForm handleSubmit] FIRED {type:'submit', target:'FORM', isTrusted:true}
[RNPM runSearch] entry
```

`isTrusted: true` + stack trace cu doar cod React intern (rt / dk / pk / hk / Ey / Gb — fara frame aplicativ) dovedea ca browser-ul submita form-ul, nu apelam runSearch direct. Network confirma: 3+ request-uri `/api/rnpm/search` la un singur click pe **Cauta**; primele doua abortate rapid (`[rnpm/search] aborted by client` la ~2s), al treilea completat integral si persistenta 25 avize.

**Cauza**: JSX-ul original reutiliza acelasi DOM node:
```tsx
{loading && onStop ? (
  <Button type="button" onClick={onStop}>Stop</Button>
) : (
  <Button type="submit" disabled={loading}>Cauta</Button>
)}
```
React 18 reconciliation: ambele ternare → acelasi slot → acelasi `<button>` DOM. Secventa:
1. Browser fires `click` pe `<button type="button">` (Stop)
2. React ruleaza `onClick` → `handleStop` → `abort()` + `setLoading(false)` (batched)
3. Handler-ul se termina → React commit batched state → `loading=false` → acelasi `<button>` primeste `type="submit"`
4. Browser continua default action → vede `type="submit"` → **submite form-ul automat**
5. `onSubmit={handleSubmit}` → `runSearch(type, params)` → request nou

**Fix** ([frontend/src/components/rnpm/RnpmSearchForm.tsx:767-780](frontend/src/components/rnpm/RnpmSearchForm.tsx#L767-L780)): `key` distincte pe cele doua butoane forteaza React sa faca **unmount + mount** (noduri DOM diferite), nu **reuse** cu morph de prop:
```tsx
{loading && onStop ? (
  <Button key="rnpm-stop-btn" type="button" onClick={onStop}>Stop</Button>
) : (
  <Button key="rnpm-submit-btn" type="submit" disabled={loading}>Cauta</Button>
)}
```
Butonul Stop e distrus complet cand `loading → false`, iar click-ul in curs nu mai are o destinatie `type="submit"` valida → browser-ul nu mai submite form-ul.

### Verificare finala

- Reproducere manuala: click Cauta → click Stop. UI revine imediat la "Cauta", Console fara `[RnpmSearchForm handleSubmit] FIRED`, Network cu un singur request abortat in ~2s, baza locala neatinsa.
- Stop in timpul captchei: provider-ul primeste abort imediat (2Captcha via Promise.race, CapSolver la urmatorul poll < 2s). Token-ul nu mai e folosit.
- `backend && npx vitest run` — **24/24 verde**.
- `npm run build` — OK (warning preexistent `import.meta` neschimbat).

### Curatenie

Toate log-urile de diagnostic adaugate in timpul investigatiei au fost sterse:
- `RnpmSearch.tsx` — `console.log` din `runSearch`, `handleStop`, render top-level, `useEffect(pendingSearch)`.
- `RnpmSearchForm.tsx` — `console.log` + `console.trace` din `handleSubmit`.
- `rnpmSearchService.ts` — log-uri `[rnpm executeSearch] start/captcha solved`, abort listener, `[rnpm] SKIP persist`, `[rnpm] persist`. Pastrat `[rnpm] search type/page/params` si `[rnpm] result total/criteriu` (preexistente, utile in operational).
- `routes/rnpm.ts` — log `[rnpm/search] ENTRY` + abort listener. Pastrat `[rnpm/search] aborted by client` (preexistent).

### Learnings

- **Abort chain in Electron cu Hono in-process**: `c.req.raw.signal` propaga corect din frontend (via `fetch({signal})`) la backend, cu conditia ca toate nivelurile sa accepte si sa pase `signal` mai departe. O singura veriga lipsa (ex: SDK blocant) gate-uieste intreg lantul.
- **Pattern React 18**: cand un ternar schimba un `<Button>` cu acelasi component type dar `type` (sau alt prop sensibil) diferit, React reutilizeaza DOM-ul. Cand purpose-ul semantic al butonului se schimba (ex: Stop → Submit), foloseste `key` distincte pentru a forta mount/unmount.
- **Promise.race cu abortPromise** e pattern-ul standard pentru a wrap-ui librarii blocante care nu stiu de AbortSignal. Atentie la cleanup-ul listener-ului in `finally`.

---

## 17 Aprilie 2026 — Categorie noua, filtru data, rafinari UI (schimbari absente din PLAN.md v1.0.0)

Sectiune separata pentru a documenta explicit ce **depaseste** scopul `PLAN.md` (4 categorii RNPM, fara filtru de data pe baza locala, fara referinte de persoane pe bunuri). Toate modificarile descrise mai jos au fost validate prin `npx tsc --noEmit` + `npx vitest run` (24/24).

### 1. Categoria 5 — **Aviz de ipoteca - obligatiuni ipotecare** (completa cap-coada)

`PLAN.md` v1.0.0 enumera categoria "obligatiuni" la endpoint-uri si schema, dar stub-ul `RnpmSearchParams` (PLAN.md §"Search Parameters", liniile 114-135) **omite** toate cheile specifice obligatiunilor — la fel cum omite `constituitorPJ`/`fiduciar`/`beneficiarPJ` (fiducii), `reprezentantCreditor`/`debitorJ`/`debitorF`/`creante` (creante specific). Cheile au fost descoperite prin captura Network pe `https://mj.rnpm.ro/#informatii/cautare` si adaugate integral.

**Types** ([frontend/src/types/rnpm.ts:1](frontend/src/types/rnpm.ts#L1), [frontend/src/types/rnpm.ts:37-40](frontend/src/types/rnpm.ts#L37-L40)):
- `RnpmSearchType` extins cu `"obligatiuni"`.
- Chei confirmate prin captura Network: `agentPJ` / `agentPF` / `emitent` (toate PJ) / `bunGarantie.descriere`.

**Backend** ([backend/src/services/rnpmClient.ts:3](backend/src/services/rnpmClient.ts#L3), [backend/src/services/rnpmClient.ts:40-43](backend/src/services/rnpmClient.ts#L40-L43)):
- `VALID_TYPES` (in `routes/rnpm.ts`) si `RnpmSearchType` (in `rnpmClient.ts`) accepta `"obligatiuni"`.
- `RnpmSearchParams` suplimentat cu noile chei — trec transparent prin `executeSearch` → `client.search` fara logica speciala (categoria a cincea foloseste aceeasi ruta SOAP ca restul).

**Form** ([frontend/src/components/rnpm/RnpmSearchForm.tsx:73-76](frontend/src/components/rnpm/RnpmSearchForm.tsx#L73-L76), [frontend/src/components/rnpm/RnpmSearchForm.tsx:310-314](frontend/src/components/rnpm/RnpmSearchForm.tsx#L310-L314), [frontend/src/components/rnpm/RnpmSearchForm.tsx:448-482](frontend/src/components/rnpm/RnpmSearchForm.tsx#L448-L482), [frontend/src/components/rnpm/RnpmSearchForm.tsx:696-707](frontend/src/components/rnpm/RnpmSearchForm.tsx#L696-L707)):
- Dropdown **Tipul avizului** (9 valori, identice cu "creante"): aviz initial, modificare, extindere, reducere, stingere, nulitate, prelungire, reactivare, indreptare a erorii materiale.
- UI: `PartyFieldset` **Agent** (PJ/PF toggle) + `PJBlock` **Emitent** (PJ-only) + `Input` descriere **Creante (bun de garantie)**.
- State: `oblAgentTip`, `oblAgentJ` (usePJField), `oblAgentF` (usePFField), `oblEmitent` (usePJField), `oblBunDescr` (useText). Folosesc aceleasi custom hooks introdusi la refactor-ul CP-15 → zero cod nou de boilerplate.
- Submit: construieste `params.agentPJ` / `params.agentPF` / `params.emitent` / `params.bunGarantie` doar daca user-ul a completat cel putin un subcamp.
- `TIP_LABEL_BY_CATEGORY[obligatiuni] = "Tipul avizului"` (identic cu "specifice"; "ipoteci"/"creante" afiseaza "Tipul inregistrarii", "fiducii" afiseaza "Tipul fiduciei") — reproduc exact label-urile site-ului oficial.

**Validare CUI** ([frontend/src/components/rnpm/RnpmSearchForm.tsx:99-111](frontend/src/components/rnpm/RnpmSearchForm.tsx#L99-L111)):
- Walker `findNonNumericCui` ruleaza pe params-ul **deja construit** (post-filtru per categorie activa), deci acopera automat `agentPJ.CUI` + `emitent.CUI` din noua categorie — fara cod nou de validare per camp.

**Bulk** ([frontend/src/components/rnpm/RnpmBulkSearch.tsx:14](frontend/src/components/rnpm/RnpmBulkSearch.tsx#L14)):
- Categoria apare in dropdown-ul **Categorie** al tab-ului Bulk. Rolurile FieldKey suportate (debitor/creditor PJ/PF) raman aplicabile dar nu acopera `agent`/`emitent` — limitarea e acceptata: bulk-ul proceseaza liste de CUI/CNP pe cea mai folosita cautare (debitor/creditor); pentru obligatiuni ipotecare volumul justifica cautari individuale din tab-ul Cautare.

**Saved (baza locala)** ([frontend/src/components/rnpm/RnpmSavedData.tsx:15](frontend/src/components/rnpm/RnpmSavedData.tsx#L15)):
- Filtru pe categorie include `obligatiuni`. Schema `rnpm_avize.search_type` e `TEXT` → accepta orice valoare, nu necesita migrare.

### 2. Baza locala — filtre + integritate (modificari absente din PLAN.md)

`PLAN.md` specifica doar cautare libera + filtru pe `activ`. In aceasta sesiune + sesiunile precedente s-au adaugat:

**Filtru interval data** ([backend/src/db/avizRepository.ts:274-284](backend/src/db/avizRepository.ts#L274-L284), [frontend/src/components/rnpm/RnpmSavedData.tsx:90-113](frontend/src/components/rnpm/RnpmSavedData.tsx#L90-L113)):
- Backend: coloana `data` e stocata ca **"dd.mm.yyyy"** (format RNPM nativ). Filtru converteste in SQL prin `substr()` la ISO (yyyy-mm-dd) ca string-urile sa fie comparabile lexicografic:
  ```sql
  substr(a.data,7,4)||'-'||substr(a.data,4,2)||'-'||substr(a.data,1,2) >= ?
  ```
  Pretul e o scanare in plus (nu exista index pe expresia `substr`) dar volumul bazei locale e `< 50K` avize per user → acceptabil.
- Frontend: doua `<Input type="date">` (`dataStart` / `dataStop`) cu buton **reset** care sterge ambele. `onClick={showPicker?.()}` pentru UX — clic deschide picker-ul nativ. Filtrul ruleaza automat la `useEffect` dependency (`[searchType, activOnly, dataStart, dataStop, refreshKey]`).
- `GetAvizeOptions.dataStart`/`dataStop` sunt string-uri ISO ("yyyy-mm-dd") — contractul vine direct din `<input type="date">`.

**Migrare `referinte_json` pe `rnpm_bunuri`** ([backend/src/db/schema.ts:149-153](backend/src/db/schema.ts#L149-L153), [backend/src/db/avizRepository.ts:199-206](backend/src/db/avizRepository.ts#L199-L206)):
- Coloana `TEXT NOT NULL DEFAULT (json_array())` NU s-a putut folosi (SQLite nu accepta expresii non-constante ca DEFAULT). Pattern idempotent:
  ```ts
  const cols = db.prepare(`PRAGMA table_info(rnpm_bunuri)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "referinte_json")) {
    db.exec(`ALTER TABLE rnpm_bunuri ADD COLUMN referinte_json TEXT`);
  }
  ```
- Citeste `NULL` pentru randuri preexistente (fara referinte); scrie `JSON.stringify(referinte)` doar cand array-ul e ne-gol (economie de spatiu — majoritatea bunurilor n-au referinte).
- Parse defensive in `loadAvizChildren` cu try/catch → `[]` pe JSON invalid (defense-in-depth impotriva corupere WAL).
- Unlock: `RnpmDetailModal > Bunuri > BunRefRow` poate afisa Constituitor (badge sky) vs Tert cedat (badge amber) — feature absent in PLAN.md.

**Scalar SQLite `rnpm_norm` (diacritic-insensitive search)** ([backend/src/db/schema.ts:22-24](backend/src/db/schema.ts#L22-L24)) — deja documentat in sesiunea 3 din 16 Aprilie; mentionat aici ca referinta pentru cititorul viitor care vede schema.

**`deleteAllAvize` tranzactional** ([backend/src/db/avizRepository.ts:316-325](backend/src/db/avizRepository.ts#L316-L325)):
- PLAN.md prevede doar `deleteAviz(id)`. UI "Sterge tot" avea nevoie de:
  - Stergere `rnpm_avize` pe owner scope → CASCADE auto pe `rnpm_creditori` / `rnpm_debitori` / `rnpm_bunuri` / `rnpm_istoric` (toate au `ON DELETE CASCADE`).
  - Stergere **explicita** `rnpm_searches` (metadata istoric cautari) — `rnpm_avize.search_id` are `ON DELETE SET NULL`, deci searches **nu** cad in cascada.
  - Tranzactie pentru atomicitate: daca una esueaza, ambele raman intacte.
- Return `number` (count avize sterse) pentru a putea afisa in UI.

**Bulk fetch `getAvizeByIds`** ([backend/src/db/avizRepository.ts:327-335](backend/src/db/avizRepository.ts#L327-L335)):
- `IN (...)` placeholders dinamici + `loadAvizChildren` per rand → suport pentru **export PDF/Excel** (ruta `/api/rnpm/saved/export` accepta max 500 id-uri per request, aliniat cu `EXPORT_BODY_LIMIT` 64KB de la audit-readiness).

### 3. Frontend — rafinari UX (non-abort)

**`RnpmDetailModal` cu 5 tab-uri navigate**:
- Tab-uri: General / Creditori / Debitori / Bunuri / Istoric. Count badge pe fiecare (ex: "Bunuri (3)") cand exista date.
- `requestAnimationFrame` + `window.scrollBy` pe tab-switch → la overflow, tab-ul selectat ramane vizibil fara salt brut.
- `BunRefRow` (sub-componenta) afiseaza `Constituitor` (sky-600) vs `Tert` (amber-600) cu toate atributele de identificare (CUI/CNP/sediu/localitate/tara) intr-un layout 2-col dens.
- Click pe backdrop inchide modala; click pe continut il blocheaza (`e.stopPropagation`).

**`RnpmSavedData` badge-uri active/inactiv**:
- Coloana "Stare" cu `Badge className="bg-green-500"` (activ) sau `bg-gray-400` (inactiv) — aliniat cu `activ INTEGER DEFAULT 1` din schema.
- Dubla confirmare `confirm()` pentru **Sterge tot** ("Actiunea nu poate fi anulata.") inainte de a apela `deleteAllAvize` — protectie minima impotriva click-urilor accidentale intr-un flux ireversibil.
- Cursor paginat: buton **Incarca mai multe** disparut automat la `nextCursor == null`.

**`RnpmBulkSearch` feedback per-item**:
- Icon per phase: `Loader2` (captcha/search/details) → `CheckCircle2` verde (done) → `XCircle` rosu (error).
- Contor `done + errors / total` + breakdown "X OK / Y erori" in header.
- Estimare **duration** (25s/item × count) + **cost** (~$0.003/item 2Captcha) afisate inainte de start.
- Hard limit `MAX_BATCH=100` — valorile peste sunt taiate si marcate cu warning amber ("primele 100 vor fi procesate").

### 4. Validare completa

- `npx tsc --noEmit` (frontend + backend) — clean.
- `npx vitest run` (backend) — **24/24 verde**, 256ms.
- Reproducere manuala **in Electron**: obligatiuni ipotecare search complet (agent PJ CUI + emitent CUI + bun descriere), rezultate vizibile in tabel, persistenta confirmata in baza locala, filtru data range pe tab "Baza locala" intoarce rezultate corecte, "Sterge tot" + confirmare goleste atat `rnpm_avize` cat si `rnpm_searches`.

### Scope separation vs PLAN.md

PLAN.md v1.0.0 ramane specificatia **initiala** (4 categorii, filtru basic, fara referinte bunuri). Acest CHANGELOG documenteaza **delta-ul** implementat peste — fara a rescrie PLAN.md (istoric inghetat). Urmatoarea revizie a PLAN.md (v1.1.0 sau v2.0.0) ar trebui sa incorporeze:
- Categoria 5 (obligatiuni ipotecare) cu payload-ul ei exact.
- Filtru `dataStart`/`dataStop` pe baza locala.
- Referinte `constituitor`/`tert` pe bunuri (`referinte_json`).
- Diacritic-insensitive search (`rnpm_norm`).

---

## 16 Aprilie 2026 (sesiunea 4) — Audit remediation (Round Next + Round 2 + Round 3)

Toate cele 12 findings din `AUDIT-LEGAL-DASHBOARD.md` aplicate. Build frontend OK, backend `vitest run` 24/24 verde.

### Round Next — fluxuri load-more + boot Electron (P1)
- **F2** — `load-more` suporta multi-institutie. `frontend/src/lib/api.ts::loadMoreSSE` accepta `string[]` si serializeaza prin `URLSearchParams.append`; `backend/src/index.ts` foloseste `c.req.queries("institutie") ?? []`, valideaza `MAX_INSTITUTII=50` + per-institutie. Loop serial pe institutie cu dedup intre institutii pe `existingNumere` Set; `totalUnits = institutionList.length * intervals.length`; prefix `[institutie]` in `currentInterval`.
- **F3** — Buton **Stop** propaga abort la backend. `batchFetchDosare` + `subdivideInterval` accepta `signal?: AbortSignal` si verifica la fiecare iteratie/chunk; ruta wired la `c.req.raw.signal` (pattern `routes/rnpm.ts:141`); single timeout seteaza `timedOut=true` si cheama `abortController.abort()`. Daca `aborted` → nu se emit evenimente "done"/"error" (silent close).
- **F4** — Boot Electron cu deadline + dialog. `electron/main.js`: `STARTUP_TIMEOUT_MS=30000`, `HEALTH_POLL_INTERVAL_MS=200`. `require()` backend in try/catch cu reject explicit; polling cu deadline (nu retry infinit); `backendStarted=true` doar dupa confirmare `/health`; helper `showStartupErrorAndQuit()` foloseste `dialog.showErrorBox` + `app.quit()`.

### Round 2 — state, erori, metrici, versiuni (P2/P3)
- **F5** — Updates `load-more` cu `setState` functional. `Dosare.tsx` + `Termene.tsx`: `onStateChange` tipat `React.Dispatch<React.SetStateAction<...>>`; toate update-urile in callback-uri folosesc `(prev) => ({...prev, ...})` (onBatch, final pass, catch error branch). Stream-ul nu mai poate suprascrie filtre/state aparute intre batch-uri.
- **F7** — Erorile HTTP propagate transparent. `frontend/src/lib/api.ts`: `await res.text()` o singura data, parse JSON in try/catch separat, propagat `serverMessage ?? "Eroare la incarcarea extinsa."` — fara dublu-throw in acelasi try.
- **F11** — Metrici uniformizate. `MetricsPanel.tsx`: `institutiiCounts` separat in `totalInstitutii` (Object.keys.length, afisat ca cifra reala) + `topInstitutii` (slice 0..5). `TermeneMetrics.tsx`: single `useMemo` cu `today.setHours(0,0,0,0)` aliniat la `filterByMetrics()` din `Termene.tsx` (definitie unica `viitor` / `trecut` / `azi`).
- **F12** — Versiunea unificata. `package.json` root → `1.4.4-ai`; `frontend/package.json` name → `legal-dashboard-frontend`; `backend/package.json` name → `legal-dashboard-backend`. `frontend/vite.config.ts` injecteaza `__APP_VERSION__` din `../package.json` (single source of truth); `frontend/src/vite-env.d.ts` declara constanta; `Dashboard.tsx` consuma `__APP_VERSION__`.

### Round 3 — performance, theming, a11y, tests (P2)
- **F8** — Code-splitting. `Dashboard.tsx`: `Changelog` + `Manual` lazy via `React.lazy` cu `<Suspense>`; `exportManualPDF` dynamic-import in handler (jspdf+xlsx out of Dashboard chunk). `Dosare.tsx` + `Termene.tsx`: `MetricsPanel` + `TermeneMetrics` lazy (recharts out of initial). `vite.config.ts`: `manualChunks` named pentru `charts` (recharts), `xlsx`, `pdf` (jspdf+jspdf-autotable). Bundle main: **306 kB** (gzip 83 kB); `charts` 517 kB doar la prima cautare cu rezultate; `xlsx`/`pdf` doar pe export.
- **F10** — Culori grafice centralizate. `frontend/src/lib/chart-colors.ts` (nou) exporta `CATEGORY_COLORS` (Penal/Civil/Contencios/Litigii munca/Faliment/Profesionisti/Altele), `CATEGORY_FALLBACK`, `CHART_FILLS` (primary/accent/termene). `MetricsPanel.tsx` + `TermeneMetrics.tsx` consuma constantele. Recharts cere literale CSS pentru fill — re-themeing chart palette intr-un singur loc.
- **F6** — Accesibilitate dialoguri + form. `frontend/src/hooks/useDialog.ts` (nou) — Escape close, body scroll lock, focus capture pe mount, restore focus pe unmount. Wired in: Dashboard `Changelog`/`Manual` modals, `App.tsx` API key dialog, `InstitutieSelect` overlay. Toate cu `role="dialog"` + `aria-modal="true"` + `aria-labelledby` + `tabIndex={-1}` + butonul X cu `aria-label`. `SearchForm.tsx` foloseste `useId()` pentru pairing `htmlFor`/`id` pe `numarDosar`/`numeParte`/`obiectDosar`/`dataStart`/`dataStop`. WCAG 1.3.1, 2.1.1, 2.4.3, 4.1.2 acoperite.
- **F9** — Test coverage minimum. Vitest instalat in backend (`devDependencies`, script `npm test`). `intervals.test.ts` (12 cases): generateMonthlyIntervals (range valid/invalid/leap/cross-year/clamp), splitInterval (no overlap/no gap, edge case 2-day), defaultDateRange (7y window). `soap.test.ts` (12 cases): `toLegacyDiacritics`, `extractFirst`/`extractAll` (namespaced tags, self-closing ignore, prefix collision `data` vs `dataStop`), `parseDosar` (top-level fields, parti, sedinte isolation, fallback `categorieCaz`/`categorieCazNume`, missing sections). Helpers `extractFirst`/`extractAll`/`parseDosar`/`toLegacyDiacritics` exportate explicit pentru testabilitate. Total: **24/24 verde**.

### Verificare finala
- `frontend && npx tsc --noEmit` — clean.
- `frontend && npm run build` — OK; warning preexistent `import.meta` neschimbat.
- `backend && npm test` — 24/24 verde, 256ms.

---

## 16 Aprilie 2026 (sesiunea 3) — Normalizare text RNPM (scope: RNPM only)

Trei imbunatatiri din spec-ul RNPM "Mentiuni esentiale", cu scope explicit pe fluxurile RNPM. Cautarea Dosare si Termene (PortalJust, SOAP) ramane neatinsa.

### Backend
- `backend/src/util/textNormalize.ts` (nou) — `stripDiacritics(s)` + `stripDiacriticsDeep<T>(value)`. Pattern NFD + drop U+0300..036F.
- `services/rnpmSearchService.ts::executeSearch`: `stripDiacriticsDeep` aplicat pe `restParams` **doar** pentru payload-ul trimis la `client.search(...)`. `input.params` ramane neatins, deci `rnpm_searches.params_json` pastreaza textul original cu diacritice (istoricul cautarilor afiseaza exact ce a tastat userul). `/search` si `/bulk` trec prin acelasi drum, deci comportamentul e simetric. `captchaKey` / `type` / `gcode` nu sunt atinse.
- `db/schema.ts`: inregistrat scalar SQLite `rnpm_norm(x) = lower(stripDiacritics(x))` via `db.function(...)`, `deterministic: true`, per-connection.
- `db/avizRepository.ts::getAvize()`: filtrul `searchText` foloseste `rnpm_norm(col) LIKE ? ESCAPE '\'` pe 9 coloane (`identificator`, `tip`, `utilizator_autorizat`, creditor `denumire`/`cod`/`cnp`, debitor `denumire`/`cod`/`cnp`). Parametrul e normalizat o singura data in JS (`stripDiacritics(q).toLowerCase()`) si meta-caracterele LIKE (`%`, `_`, `\`) sunt escape-uite pentru a fi tratate literal — user tasteaza "a%b" si gaseste literal "a%b", nu orice contine "a". User tasteaza "stefan" → gaseste "Ștefan" / "STEFAN" in baza locala.

### Frontend
- `RnpmSearchForm.tsx`: helper `findNonNumericCui(obj)` walk pe params-ul construit dupa filtrul per-activeType. Daca `CUI.value` contine non-digit → `window.confirm("Atentie: CUI ... contine caractere non-numerice. Continui cautarea?")` non-blocking. Astfel nu valideaza CUI-uri stocate in state dar apartinand unui tab inactiv.

### Scope isolation
- `getDb()` e folosit EXCLUSIV de `avizRepository.ts` + `searchRepository.ts` (ambele RNPM).
- `stripDiacriticsDeep` importat EXCLUSIV in `routes/rnpm.ts`.
- PortalJust Dosare + Termene nu trec prin SQLite locala si nu trec prin `/api/rnpm/*`.

---

## 16 Aprilie 2026 (sesiunea 2) — Hardening post-audit

Remediere findings audit-readiness + CLAUDE.md conventions. Fara schimbari de comportament user-facing; toate defense-in-depth.

### Backend
- `hono/body-limit` pe POST `/api/rnpm/*`: `/search` 64KB, `/bulk` 512KB, `/saved/export` 64KB, `/captcha/balance` 4KB → 413 la depasire (F-1).
- `/bulk` SSE timeout 10 min via `setTimeout` pe `AbortController` (F-2) — stream-ul nu mai poate ramane blocat indefinit.
- `validateParamsDepth` — walk recursiv care respinge params cu adancime > 4 sau string-uri > 500 chars (W-1).
- `defaultRnpmClient` — singleton exportat din `rnpmClient.ts`; `executeSearch` / `executeBulkSearch` / ruta `/bulk` folosesc instanta partajata in loc de `new RnpmClient()` per call (CP-B5).

### Frontend
- `RnpmBulkSearch`: `useEffect` cleanup care face `abortCtl.abort()` la unmount — previne waste 2Captcha daca userul paraseste tab-ul in timpul unui bulk (CP-E1).
- `lib/rnpmApi.ts`: SSE reader wrap in try/finally cu `reader.cancel()` pentru eliberare pe abort/error abrupt (CQ-6).

### Electron
- `ALLOWED_EXTERNAL_DOMAINS` extins cu `mj.rnpm.ro`, `www.rnpm.ro` (W-2).

### Onboarding
- `backend/.env.example` — lista completa variabile + nota 2Captcha (se configureaza in UI) (CQ-8).

### Refactor (CP-15)
- `RnpmSearchForm.tsx` restructurat pe hooks + sub-componente: introduse `useText` / `useSiSauField` / `usePJField` / `usePFField` pentru a grupa starea per-entitate; introduse `PJBlock` / `PFBlock` / `PartyFieldset` / `VehiculFieldset` / `DestinatieSelect` pentru a elimina duplicarea JSX. `useState` direct in component: 40+ → 11. Logica de submit pastrata exact (toate particularitatile per-categorie comentate inline).

---

## 16 Aprilie 2026 — RNPM form parity cu site-ul oficial

Aliniere completa a formularului `RnpmSearchForm` la specificatia oficiala RNPM (`https://mj.rnpm.ro/#informatii/cautare`) si la payload-urile reale capturate din Network tab.

### Formular cautare
- Categoriile au denumirile exacte din spec (Aviz de ipoteca mobiliara / Fiducie / Aviz specific / Aviz de ipoteca - creante securitizate / Aviz de ipoteca - obligatiuni ipotecare).
- **Tipul avizului** — dropdown per categorie (18 valori ipoteci, 7 specifice, 7 fiducii).
- **Destinatia inscrierii** — dropdown la specifice (14 valori) si la ipoteca (10 valori).
- **SI/SAU** pe operatorul fiecarui camp `SiSau` (CUI, CNP, RegCom, Prenume, Serie sasiu/motor, Nr inmatriculare, tip aviz, destinatie).
- **Default checkboxes**: `Numai active` + `Nemodificate de alte inscrieri` bifate implicit, conform spec.
- **Toggle PJ/PF unic per parte** ("Persoana Juridica" / "Persoana Fizica") cu campuri condiționate (CUI vs CNP).
- Structura noua per categorie:
  - **Fiducie**: Constituitor (PJ/PF) / Fiduciar (PJ) / Beneficiar (PJ/PF) / Vehicul.
  - **Aviz specific**: Destinatie + Parte (PJ/PF) + Bun (descriere).
  - **Creante securitizate**: Reprezentant Creditor (PJ) + Debitor (PJ/PF) + Bun (descriere).

### Backend
- `RnpmSearchParams` extins cu: `constituitorPJ/PF`, `fiduciar`, `beneficiarPJ/PF`, `parteJ/parteF`, `bunA.descriere`, `reprezentantCreditor`, `debitorJ`, `debitorF`, `creante.descriere`.
- `RnpmDetailBun` extins cu `constituitoriF/J` (referinte numerice catre debitori) si `tertiF/J` (entitati complete).
- `executeSearch` arunca eroare clara cand `total > 1500` (limita RNPM): _"RNPM a returnat N rezultate (limita 1500). Restrange criteriile de cautare."_
- Re-solve captcha automat pe `410/401/403` (gcode expirat) pentru paginile ulterioare ale aceleiasi cautari.

### Persistenta detalii
- `rnpm_bunuri.referinte_json` — coloana noua (migratie idempotenta) cu referintele tert/constituitor per bun.
- Modalul de detaliu afiseaza referintele ca badge-uri colorate (amber = tert, sky = constituitor).

### Erori UI
- Mesaj backend (status text) propagat la frontend in loc de "Eroare server (500)" generic.
- Auto-scroll la panoul de detaliu cand se selecteaza un aviz (centru viewport).

### Documentatie
- `STATUS.md` extins cu sectiune "Update 2026-04-16" + sectiune "Ramas de facut" (Obligatiuni, Tert cedat la ipoteca, Bun mobil atasat imobilului, Bun "Alt tip"/imobil la fiducie, validari input).

---

## v2.0.0 — 15 Aprilie 2026 (Legal Dashboard Launch — rebranding din PortalJust App)

Aplicatia a fost rebrand-uita din **PortalJust App v1.4.4-ai** in **Legal Dashboard v2.0.0**. Versiunea bumped la 2.0.0 pentru continuitate cu istoricul PortalJust (entry-urile v1.4.4-ai si mai vechi raman vizibile mai jos sub vechea denumire). PortalJust ramane aplicatie separata, neatinsa. Legal Dashboard = tot ce avea PortalJust + tab nou **Cautare RNPM** (Registrul National de Publicitate Mobiliara).

### Rebranding
- Nume aplicatie: "Legal Dashboard" (titlu fereastra, installer, shortcut, PDF exports, manual)
- AppId: `ro.legaldashboard.app`
- DB path: `userData/legal-dashboard.db` (env `LEGAL_DASHBOARD_DB_PATH`)
- Istoric RNPM separat de istoricul PortalJust (localStorage `legal-dashboard-rnpm-history`)
- Referintele la `portal.just.ro` pastrate ca "PortalJust" (sursa externa de date)

### RNPM — Backend
- SQLite: 6 tabele noi (`rnpm_searches`, `rnpm_avize`, `rnpm_creditori`, `rnpm_debitori`, `rnpm_bunuri`, `rnpm_istoric`) cu `owner_id` si index-uri adecvate
- Repositories: `searchRepository`, `avizRepository` (upsert idempotent pe UNIQUE(owner_id, identificator), cursor pagination)
- `captchaSolver` peste `@2captcha/captcha-solver` (SDK oficial 2Captcha) — sitekey RNPM hardcodat, erori RO
- `rnpmClient` — search + 4 parti detaliu + istoric; batch de 5 requests concurent
- `rnpmSearchService` — orchestreaza captcha -> search -> fetch eager detalii -> persist (tranzactie)
- Endpoint-uri Hono la `/api/rnpm`: `POST /search`, `POST /bulk` (SSE), `GET/DELETE /saved`, `GET /saved/:id`, `POST /saved/export`, `GET/DELETE /searches`, `POST /captcha/balance`

### RNPM — Frontend
- Tab nou **Cautare RNPM** in sidebar cu 3 sub-tab-uri: Cautare / Bulk / Baza locala
- Formular cautare cu 5 categorii (ipoteci, fiducii, specifice, creante, obligatiuni) + filtre debitor/creditor PJ+PF + vehicule
- Tabel rezultate cu paginare + selectie multipla
- Modal detaliu cu 5 tab-uri (General, Creditori, Debitori, Bunuri, Istoric)
- Bulk search cu SSE live progress, estimare timp/cost, Abort
- Browse baza locala cu filtrare full-text + cursor "Incarca mai multe"
- `useRnpmHistory` — istoric separat (max 15 intrari)
- Sectiune "Istoric RNPM" separata in sidebar

### Setari AI — Card nou 2Captcha
- Al 4-lea card in dialogul "Setari AI" alaturi de Anthropic / OpenAI / Google
- Cheie stocata obfuscata in localStorage (btoa + reverse) alaturi de celelalte
- Necesara exclusiv pentru tab-ul RNPM (~$0.003/captcha)

### Eager detail fetch
- UUID-urile RNPM sunt efemere — detaliile complete (parti 1-4 + istoric) sunt aduse in timpul cautarii si persistate local, eliminand round-trip-ul la browse ulterior

---

## v1.4.4-ai — 5 Aprilie 2026 (AI Enabled)

### Export — Excel Stilizat cu Formatare Avansata
- **xlsx-js-style** ca dependenta (drop-in replacement pentru xlsx cu suport styling la nivel de celula)
- **Titlu dark blue** — rand de titlu cu fundal albastru inchis, text alb, bold, merge pe toate coloanele
- **Rand statistici** — numar dosare/termene si data exportului, fond gri deschis
- **Headere colorate** — fundal albastru, text alb, bold, aliniere centrata (similar cu stilul PDF)
- **Randuri alternante** — gri deschis pe randurile pare, alb pe cele impare, text negru clar
- **Numar dosar bold** — evidentierea numerelor de dosar in lista principala
- **Sheet Sedinte grupat** — sectiuni clare per dosar cu header colorat, separate de un rand gol

### Export — Hyperlinks Interne Excel (Bidirectionale)
- **Dosare → Sedinte**: numarul dosarului din sheet-ul Dosare are hyperlink direct catre prima sedinta a dosarului din sheet-ul Sedinte
- **Sedinte → Dosare**: headerul fiecarei sectiuni de dosar din sheet-ul Sedinte are hyperlink inapoi catre randul dosarului din sheet-ul Dosare (indicat cu ↑)
- Navigare rapida intre cele doua sheet-uri fara scroll manual

### Export — Filenames Dinamice
- **1 dosar exportat**: fisierul se numeste `dosar_NR-DOSAR.xlsx` / `dosar_NR-DOSAR.pdf` (numarul dosarului in denumire)
- **Multiple dosare**: `dosare_DD.MM.YYYY.xlsx` / `dosare_DD.MM.YYYY.pdf` (data exportului)
- **Acelasi comportament pentru termene**: `termen_NR-DOSAR.ext` / `termene_DD.MM.YYYY.ext`
- Caracterele invalide pentru fisiere din numarul dosarului sunt inlocuite cu `-`

### AI — Actualizare Modele Claude
- **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — modelul Echilibrat
- **Claude Opus 4.6** (`claude-opus-4-6`) — modelul Premium si judecator multi-agent
- **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) — modelul Rapid
- Actualizare label-uri in interfata: "Sonnet 4" → "Sonnet 4.6", "Opus 4" → "Opus 4.6"

### Server — Versiune Deployabila
- **Build server** (`npm run dist:server`) — pachet ZIP complet pentru deployment direct pe server
- Backend bundlat cu esbuild (toate dependentele incluse intr-un singur fisier CJS)
- Frontend compilat ca fisiere statice, servite de backend in production
- Dockerfile + docker-compose.yml pentru deployment in container
- `.env.example` cu toate variabilele de configurare

---

## v1.4.3-ai — 3 Aprilie 2026 (AI Enabled)

### AI — Modele Gemini 3.x
- **Eliminare completa modele Gemini 2.5** — toate modelele deprecated din seria 2.5 au fost scoase
- **Modele noi Gemini 3.x**: Gemini 3.1 Flash Lite (Rapid), Gemini 3 Flash (Echilibrat), Gemini 3.1 Pro (Premium)
- **Gemini 3.1 Pro ca model judecator** — adaugat in lista modelelor permise pentru analiza multi-agent (alaturi de Claude Opus 4 si GPT-5.4)
- Actualizare model IDs backend: gemini-3.1-flash-lite-preview, gemini-3-flash-preview, gemini-3.1-pro-preview

### UX — Filtrare Date Client-Side (Calendar)
- **Filtrare instant pe rezultatele deja incarcate** — schimbarea datelor din Data Start / Data Stop filtreaza dosarele si termenele in timp real, fara o noua cautare SOAP
- Functioneaza pe ambele pagini: Cautare Dosare (filtreaza dupa data dosar) si Termene & Calendar (filtreaza dupa data sedinta)
- Se poate folosi doar Data Start, doar Data Stop, sau ambele simultan
- Filtrul se reseteaza automat la o cautare noua sau la apasarea butonului Reseteaza

### Performance — Timeout Multi-Agent
- **Timeout multi-agent crescut la 180s** (de la 120s) — permite analize complete pe dosare mari cu modele premium
- Timeout-ul e propagat separat prin lantul de apeluri `callModel → callAnthropic/callOpenAI/callGoogle`

### Desktop — Dimensionare Dinamica Fereastra
- **Fereastra Electron se adapteaza la rezolutia monitorului** — 85% din latimea si 90% din inaltimea work area
- Limite min/max: minim 900x600, maxim 1800x1100
- Respecta Windows DPI scaling nativ (fara zoom suplimentar)

---

## v1.4.2-ai — 31 Martie 2026 (AI Enabled)

### UX — Sectiuni AI Colapsabile
- **Analiză AI** (analiza simpla) este acum o sectiune colapsabila proprie cu header, model selectors direct vizibili, buton analiza si rezultat — totul intr-un singur container
- **Analiză AI Avansată** (multi-agent) este o sectiune colapsabila separata, independenta
- Ambele sectiuni pornesc **inchise by default** — se deschid doar la cererea utilizatorului
- Design unificat: ambele sectiuni au acelasi layout (header cu download + chevron, selectoare model, buton jos)
- Redenumire: "Analiză Avansată" → "Analiză AI Avansată"
- Descrierea modelului selectat (Rapid/Echilibrat/Premium) afisata langa butoanele de model in ambele sectiuni

### UX — Marire Fonturi Globala
- **Sidebar**: "Normal" label 11px → 12px, badge "Activ"/"Neconfigurat" 10px → 11px
- **Istoric Cautari**: header 11px → 12px, nume cautare 12px → 13px, rezultate + timp 10px → 11px
- **CalendarView**: toate fonturile marite cu +1.5px (card, solutie, solutieSumar 14.5px, parti, badges)

### UX — Consistenta Termene cu Dosare
- **solutieSumar** in TermeneTable: 13px → 14.5px (aliniat cu DosareTable)
- **Party badges** in TermeneTable: text-[10px] → text-xs (aliniat cu DosareTable)
- **splitConcatenatedWords** aplicat si pe TermeneTable (fix text concatenat tip "INCHEIEREINDREPTAR...")
- **Functii comune** (splitConcatenatedWords, formatDocumentSedinta) mutate in utils.ts (shared)
- **Bold rosu** pe data, ora si institutie cand randul e expandat (la fel ca in DosareTable)
- **Collapse anterior** — la deschiderea unui termen, cel anterior se inchide automat (la fel ca in DosareTable)

### AI — Descriere Model Selectat in Multi-Agent
- Fiecare row de model (Analist 1, Analist 2, Judecator) afiseaza acum descrierea modelului selectat (Rapid/Echilibrat/Premium) langa butoane
- Adaugat `desc` pe JUDGE_MODELS_LIST (Premium pentru Opus 4 si GPT-5.4)

---

## v1.4.1-ai — 30 Martie 2026 (AI Enabled)

### UX — Auto-Scroll la Detalii Dosar
- La expandarea unui rand din tabel, ecranul face scroll automat pentru a afisa sectiunea de detalii
- Deosebit de util cand dosarul este la finalul paginii vizibile
- Functioneaza pe ambele tab-uri: Dosare si Termene
- Detectie inteligenta a containerului scrollable (getBoundingClientRect + scrollable parent traversal)

### UX — Indicator Vizualizat / Nevizualizat
- Punct albastru animat (ping) langa numarul dosarelor/termenelor nevizualizate
- Iconita ochi gri pentru cele deja vizualizate (expandate)
- Marcare automata la expandarea randului
- Persistare in sessionStorage pe durata sesiunii de browser
- Functioneaza pe ambele tab-uri: Dosare si Termene

### UX — Butoane Navigare Rapida (Scroll Sus/Jos)
- Doua butoane floating in coltul din dreapta-jos al ecranului
- Sageata sus — apare cand ai scrollat >300px in jos, duce la meniul de cautare
- Sageata jos — apare cand mai ai >300px pana la finalul paginii
- Se actualizeaza automat la incarcarea de continut nou (ResizeObserver)
- Functioneaza pe toate paginile (Dashboard, Dosare, Termene)

### AI — Fix Analiza Trunchiata pe Dosare Complexe
- **max_tokens crescut de la 3000 la 8000** pe toti providerii (Anthropic, OpenAI, Google)
- **max_output_tokens setat explicit** pe OpenAI (Responses API) si Google (Gemini) — inainte depindeau de default-uri
- **Timeout backend crescut**: 90s → 120s per apel AI — safety net pentru dosare mari
- **Timeout frontend crescut**: single 120s → 180s, multi-agent 180s → 300s (5 minute)
- Rezolva problema analizei multi-agent care se oprea la dosare cu multe termene stufoase

---

## v1.4.0-ai — 29 Martie 2026 (AI Enabled)

### Paginare Extinsa (Load More)
- **Incarca mai multe** — cand SOAP API returneaza limita de 1.000 rezultate, butonul "Incarca mai multe" scaneaza luna cu luna pentru a aduce toate rezultatele
- Bara de progres in timp real: "Luna X din Y — Z dosare/termene noi gasite"
- Buton **Stop** (rosu) permite oprirea cautarii si pastrarea rezultatelor partiale deja primite
- Backend-ul primeste lista dosarelor existente (POST body) si trimite doar dosare **NOI** — fara re-scanare redundanta
- Subdivizare recursiva: daca o luna depaseste 1.000, se imparte in jumatati (max adancime 2)
- Chunking SSE: batch-uri de max 50 elemente per event pentru a evita pierderea in proxy buffers
- Functioneaza pe ambele tab-uri: Cautare Dosare si Termene
- Merge incremental pe fiecare batch — totalul afisat in progress reflecta numarul unic real
- Delay 150ms intre request-uri SOAP pentru a nu suprasolicita portalquery.just.ro
- Date range implicit 3 ani inapoi cand nu sunt specificate date

### Navigare Persistenta intre Tab-uri
- Componentele Dosare si Termene raman montate in DOM cand navighezi intre tab-uri (display:none)
- Operatiile async (load-more, cautare) **supravietuiesc** navigarii — nu se pierd la schimbarea tab-ului
- Doar butonul Stop opreste o cautare in progress, nu navigarea
- Campurile formularului, numele cautat si butonul Reseteaza se pastreaza corect la navigarea inapoi

### Buton Reseteaza Imbunatatit
- Reseteaza sterge complet: campuri formular, rezultate cautare, filtre, metrici, starea load-more
- Pagina revine la starea initiala (fara rezultate)

### Analiza Multi-Agent AI — Documentare Functionare
- **Rolul judecatorului** (nedocumentat anterior): judecatorul primeste datele complete ale dosarului + cele 2 analize separate
  - Unde ambele analize sunt de acord → preia direct concluzia comuna
  - Unde difera, se contrazic sau sunt vagi → verifica in datele originale ale dosarului
  - Produce analiza finala unitara + sectiune "Revizuire si reconciliere" cu diferentele gasite si cum le-a rezolvat
- Modele judecator permise: Claude Opus 4 si GPT-5.4
- Prompt analist: 7 sectiuni (Rezumat, Explicatie parti, Starea actuala, Istoric sedinte, Ce ar putea urma, Temei juridic, Legaturi cu alte dosare)

### Securitate (Audit Complet + Hardening)

#### CRITICAL — Fixate
- **Validare POST body pe load-more**: array `existing` limitat la max 10.000 elemente, max 100 caractere/element, tipuri verificate — previne DoS prin epuizare memorie
- **Schema validation pe POST body**: structura JSON validata complet (obiect, array de string-uri) — body malformat returneaza 400 cu mesaj clar, nu silent fail
- **JSON.parse protejat**: try-catch dedicat pe toate endpoint-urile AI — body invalid returneaza "JSON invalid." in loc de exceptie neprinsa

#### HIGH — Fixate
- **SSE timeout + limita intervale**: max 10 minute per stream, max 120 intervale lunare (~10 ani) — previne resource exhaustion
- **Chei API obfuscate in localStorage**: stocare cu btoa + reverse (nu plaintext citibil) — migrare automata de la formatul vechi
- **External URL whitelist exact**: `portal.just.ro`, `www.just.ro`, `portalquery.just.ro` — `.endsWith()` inlocuit cu `.includes()` pentru a preveni bypass-ul cu domenii similare (ex: `attacker-just.ro`)
- **DevTools dezactivate in productie**: `devTools: false` cand `NODE_ENV === "production"` — activabile cu flag `--dev-tools` pentru dezvoltatori

#### MEDIUM — Fixate
- **`enableRemoteModule: false`** explicit in Electron webPreferences
- **CSP restrictionat**: `data:` URI eliminat din `img-src` si `font-src` (aplicatia nu foloseste data: URI)

#### Riscuri Acceptate (documentate)
- SOAP HTTP: portalquery.just.ro nu ofera HTTPS — date publice, fara autentificare
- XML regex parsing: functioneaza corect cu formatul fix al Ministerului Justitiei, nu necesita parser dedicat

### Manual de Utilizare
- Manual complet integrat in aplicatie cu **12 capitole** care acopera toate functionalitatile
- Accesibil din Dashboard (buton "Manual" langa "Vezi Noutati"), deschis ca modal full-screen
- **Cuprins interactiv** — click pe capitol navigheaza direct la sectiunea respectiva (scroll smooth in containerul modal)
- **Export PDF** — buton de descarcare disponibil atat in header cat si la finalul manualului
- PDF generat: Portrait A4 cu cover page, cuprins, 12 capitole formatate profesional si footer pe fiecare pagina
- Capitole: Prezentare Generala, Dashboard, Cautare Dosare, Termene & Calendar, Load More, Export, Analiza AI, Multi-Agent, Chei API, Sidebar, Personalizare, Securitate

### Lizibilitate Text Imbunatatita
- Textul din Manual si Changelog schimbat de la gri (`text-muted-foreground`) la negru (`text-foreground`)
- Aplicat pe: paragrafe, bullet-uri, cuprins, subtitluri, footer, date versiuni

### Tehnic
- Load-more endpoints schimbate de la GET la POST (numerele dosarelor existente nu mai incap in URL)
- `backend/src/intervals.ts` — modul nou pentru generare intervale lunare si subdivizare
- Vite proxy cu timeout 600s pentru SSE endpoints
- `parseExistingFromBody()` — functie centralizata de validare body cu limite de securitate
- `AppShell` component cu `useLocation()` pentru routing persistent
- SearchForm accepta `defaultParams` si `onReset` props
- `lastSearchParams` salvat in starea parintelui (App.tsx) pentru persistenta intre navigari
- `onBatch` callback in `loadMoreSSE()` pentru merge incremental

---

## v1.3.0-ai — 28 Martie 2026 (AI Enabled)

### Analiza AI Avansata (Multi-Agent)
- Sistem multi-agent: 2 analisti AI analizeaza dosarul in paralel, un al 3-lea model (judecator) reconciliaza rezultatele
- Judecatorul primeste datele complete ale dosarului + cele 2 analize — verifica afirmatiile contra datelor reale, corecteaza interpretari gresite si adauga aspecte omise
- Modele judecator permise: Claude Opus 4 si GPT-5.4
- Sectiune colapsabila cu selectori model pentru fiecare analist si judecator
- Vizualizare analize individuale (toggle side-by-side)
- Endpoint nou: `POST /api/ai/analyze-multi`

### OpenAI Responses API & Modele Noi
- Migrare de la Chat Completions API la noul Responses API (`client.responses.create()`)
- Modele actualizate: GPT-5.4 nano (Rapid), GPT-5.4 mini (Echilibrat), GPT-5.4 (Premium)

### Prompt AI Imbunatatit
- Adaugat sectiuni noi in analiza: "Temei juridic (articole de lege relevante)" si "Legaturi cu alte dosare"
- Selectori model stivuiti vertical (layout imbunatatit)
- Afisare tip model (Rapid/Echilibrat/Premium) pe fiecare rand de provider in selectorul AI

### Export PDF Analize AI
- Export PDF pentru analiza simpla si avansata
- Design profesional: header minimal, card info dosar, formatare markdown
- Page breaks inteligente (titlul sectiunii nu ramane singur pe pagina)
- Paleta culori calde (warm gray/stone), footer pe fiecare pagina

### Securitate (Audit v1.3.0-ai)
- Prompt injection defense: date dosar in `<dosar_data>` delimiters, truncare campuri (obiect 500, nume parte 200, solutie 10000 chars)
- Analize AI in `<analiza_1>`/`<analiza_2>` delimiters in prompt-ul judecatorului
- Rate limiter ponderat: endpoint multi-agent consuma 3 unitati (vs 1 pentru alte endpoint-uri)
- Schema validation pe endpoint multi-agent (reutilizare `validateAiBody`)

### Performanta AI
- Apeluri directe fara extended thinking/reasoning — viteza optima pe toate modelele
- Timeout backend: 90s per apel AI
- Timeout frontend fetch: 120s (analiza simpla), 180s (multi-agent)
- `max_tokens` Anthropic: 3000 (suficient pt output real ~800-1500 tokens)
- Toate sedintele dosarului se trimit integral catre AI (fara limitare)
- Truncare campuri ajustata: obiect 500, nume parte 200, solutie 10000 caractere
- Fix macOS: guard `app.isReady()` pe `activate` + flag `backendStarted`

### Documentatie
- DOCUMENTATIE.md — documentatie completa a proiectului (arhitectura, functionalitati, securitate, API, tipuri date)

---

## [1.2.1-ai] - 2026-03-27 — AI Enabled

### Functionalitati Noi

#### Selector Institutii (Multi-Select)
- Selector modal pentru filtrarea pe **246 instante** din Romania (parsate din WSDL-ul SOAP)
- Grupare pe categorii: Curți de Apel (15), Tribunale (42), Tribunale Specializate (1), Tribunale Comerciale (3), Tribunale Militare (5), Curți Militare (1), Judecătorii (179)
- **Multi-select** cu draft state — selectiile se aplica la inchiderea ferestrei, cu sortare alfabetica
- Cautare diacritice-insensitiva (ex: "brasov" gaseste "Brașov")
- Chips vizuale pentru selectii, buton de reset, counter de rezultate
- **Cautare paralela SOAP** — cand sunt selectate mai multe institutii, backend-ul face `Promise.all` pe toate

#### Filtrare Client-Side pe Institutii
- Pipeline de filtrare extins: Institutii → Categorii → Stadii → Roluri
- Filtrarea se aplica pe dosarele deja extrase (fara re-interogare SOAP)

### Imbunatatiri

#### Normalizare Nume Institutii
- Functia `normalizeInstitutie()` centralizeaza — transforma "TribunalulSATUMARE" in "Tribunalul Satu Mare"
- Cache-based lookup cu strip diacritice pentru matching robust
- Aplicata in toate componentele: DosareTable, TermeneTable, MetricsPanel, CalendarView, DosarModal, export

#### Compatibilitate Diacritice Romanesti
- **Backend SOAP**: conversie automata ș(U+0219)→ş(U+015F) si ț(U+021B)→ţ(U+0163) — API-ul PortalJust accepta doar varianta legacy cu sedila
- Cautarea cu "Ioan Farcaș", "Ioan Farcaş" sau "Ioan Farcas" returneaza aceleasi rezultate
- **Analiza Parte (MetricsPanel)**: matching diacritice-insensitiv pentru contorizarea rolurilor
- **Highlight nume (DosareTable)**: regex cu variante diacritice — "farcas" face highlight pe "FARCAŞ"/"FĂRCAȘ"
- **Filtru roluri (Dosare)**: comparare diacritice-insensitiva intre numele cautat si parti
- **Selector institutii**: cautare fara diacritice gaseste rezultate cu diacritice

#### API Multi-Institutie
- Backend accepta parametrul `institutie` ca array (`?institutie=X&institutie=Y`)
- Frontend trimite array prin `URLSearchParams.append()`
- `c.req.queries("institutie")` in Hono pentru parsarea array-urilor

### Securitate (Audit v1.2.1-ai)

#### Protectie Amplificare Cereri SOAP
- Limita maxima de **50 institutii** per cerere — previne trimiterea de sute de cereri SOAP paralele printr-un singur request
- Toate valorile din array-ul `institutie` sunt validate individual (lungime, caractere de control)

#### Timeout pe Apeluri AI
- Toate apelurile catre providerii AI (Anthropic, OpenAI, Google) au acum timeout de **60 secunde**
- Previne blocarea conexiunilor HTTP cand un provider AI nu raspunde

#### Validare Body Size Reala
- Verificarea dimensiunii cererii `/api/ai/analyze` se face pe body-ul real, nu doar pe header-ul `Content-Length` (care poate fi omis sau falsificat)

#### Validare Chei API
- Valorile din `apiKeys` sunt validate ca string-uri cu lungime maxima de 256 caractere
- Previne trimiterea de obiecte sau string-uri foarte lungi ca chei API

#### Protectie URL Injection
- `encodeURIComponent()` aplicat pe toate URL-urile portal.just.ro construite din numere de dosar
- Previne injectarea de parametri URL prin caractere speciale in numerele de dosar

#### Verificare Identitate Backend (Electron)
- Health check-ul la pornire verifica acum ca raspunsul contine `service: "PortalJust API"`
- Previne port hijacking — daca alt proces ocupa portul 3001, aplicatia nu va incarca continut strain

#### Validare URL Stricta (Electron)
- `shell.openExternal()` foloseste acum `new URL()` pentru parsare si verifica `hostname.endsWith(".just.ro")`
- Previne bypass prin URL-uri de forma `https://portal.just.ro.evil.com`

#### CSP Imbunatatit (Electron)
- Adaugat `object-src 'none'` — blocheaza plugin-uri si embeds
- Adaugat `frame-ancestors 'none'` — previne incadrarea aplicatiei in iframe-uri

### Infrastructura
- `frontend/src/lib/institutii.ts` — fisier centralizat cu date institutii, grupuri si normalizare
- `frontend/src/components/InstitutieSelect.tsx` — componenta modal multi-select
- `toLegacyDiacritics()` in `backend/src/soap.ts` pentru compatibilitate Unicode SOAP
- `stripDiacritics()` aplicat consistent in toate componentele frontend cu matching de text

---

## [1.2.0-ai] - 2026-03-27 — AI Enabled

### Functionalitati Noi

#### Asistenta AI Multi-Provider
- Analiza AI integrata pentru interpretarea dosarelor din detalii expandate
- Suport pentru **3 provideri AI**:
  - **Anthropic** (Claude): Haiku 4.5, Sonnet 4, Opus 4
  - **OpenAI** (GPT-4): 4o mini, GPT-4o, GPT-4.1
  - **Google** (Gemini): Flash 2.0, Flash 2.5, Pro 2.5
- Selector de model grupat pe provideri cu coduri de culoare (violet/emerald/blue)
- Se afiseaza doar modelele pentru care exista cheie API activa
- Analiza completa: rezumat, explicatie parti, stare actuala, istoric sedinte, pasi urmatori
- Toate sedintele dosarului sunt incluse in analiza (nu doar ultimele 10)
- Buton toggle pentru ascundere/aratare analiza AI dupa generare
- Buton "Re-analizează" pentru regenerare cu alt model

#### Configurare Chei API
- Dialog global "Configurare Chei API" accesibil din sidebar ("Setari AI")
- Inputuri separate per provider cu status indicator (Activa/Neconfigurat)
- Posibilitate de stergere individuala a cheilor
- Cheile se salveaza doar local (localStorage) — nu sunt trimise nicaieri in afara de API-ul respectiv
- Optiunea "Mai tarziu" — configurarea nu este obligatorie
- Migrare automata de la formatul vechi (cheie unica) la multi-provider
- Indicator status in sidebar: verde (Activ) sau portocaliu (Neconfigurat)

#### Selectie pentru Export (Dosare & Termene)
- Checkbox pe fiecare rand din tabelele **Dosare** si **Termene**
- Checkbox "Select All" in header (selecteaza/deselecteaza pagina curenta)
- Evidentierea vizuala a randurilor selectate (fundal violet)
- Butoanele Excel/PDF arata numarul de elemente selectate
- Daca nu e selectat nimic, se exporta toate elementele (comportament implicit)
- Buton "Deselecteaza tot" pentru reset rapid

#### Export Imbunatatit cu Sedinte
- **Excel**: 2 sheet-uri — "Dosare" + "Sedinte" (toate sedintele cu data, ora, complet, solutie, sumar, document, numar document, data pronuntare)
- **PDF**: coloana noua "Sedinte" cu rezumatul fiecarei sedinte (data, ora, solutia si sumarul)
- Subtitlu cu numar total de dosare si sedinte

#### Selector Rezultate pe Pagina
- Butoane pentru alegerea numarului de rezultate per pagina
- Dosare: 10, 15, 25, 50, 100 (default: 15)
- Termene: 10, 20, 50, 100 (default: 20)
- Se reseteaza automat la pagina 1 cand se schimba

#### Meniu Contextual Electron (Click Dreapta)
- **Copiaza** — apare doar cand exista text selectat
- **Selecteaza tot** — selecteaza tot textul din pagina
- **Printeaza...** — deschide dialogul de printare Windows
- Ctrl+C functioneaza nativ pentru copiere

### Securitate (Audit v1.2.0-ai)

#### Protectie XSS pe Analiza AI
- Toate zonele care afiseaza raspunsul AI folosesc acum **DOMPurify** pentru sanitizarea HTML-ului
- Taguri permise strict limitate la `<strong>`, `<em>`, `<b>`, `<i>` — restul sunt eliminate automat
- Previne executia de cod malitios daca un model AI ar returna HTML/JavaScript in raspuns

#### Sanitizare Erori API
- Mesajele de eroare returnate clientului nu mai contin detalii interne (stack trace, chei API partiale, mesaje SDK)
- Erorile sunt logate complet server-side pentru debugging, dar clientul primeste doar un mesaj generic
- Mesajele SOAP Fault de la PortalJust sunt si ele sanitizate — detaliile tehnice raman doar in log

#### Validare Schema AI Request
- Endpoint-ul `/api/ai/analyze` valideaza acum structura completa a body-ului: tipuri campuri dosar, format apiKeys, model valid
- Limita de dimensiune body: **100KB** — cererile mai mari sunt respinse cu HTTP 413
- Campurile dosarului sunt validate individual (string, array unde trebuie)

#### Protectie Rate Limiter
- Rate limiterul nu mai foloseste header-ul `X-Forwarded-For` (spoofable) pentru identificarea clientilor
- Serverul fiind bind pe localhost, toate cererile vin de la aceeasi adresa — rate limiting-ul protejeaza impotriva flood-ului local

#### Validare Date Imbunatatita
- Validarea datelor (dataStart, dataStop) verifica acum ca data este **reala** (ex: 2024-02-30 este respins, nu doar formatul YYYY-MM-DD)
- Reject caractere de control si null bytes din toti parametrii de input

### Infrastructura
- Backend multi-provider: endpoint unic `/api/ai/analyze` cu rutare automata catre SDK-ul corect
- SDK-uri instalate: `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`
- Vite `optimizeDeps.include` pentru pre-bundling `xlsx`, `jspdf`, `jspdf-autotable`
- dotenv cu `override: true` pentru incarcarea corecta a variabilelor de mediu

---

## [1.2.0] - 2026-03-26

### Imbunatatiri

#### Build macOS (DMG)
- Adaugat suport complet pentru **macOS** (Intel + Apple Silicon)
- GitHub Actions workflow pentru build automat pe macOS
- Fisier DMG cu drag-to-Applications installer
- Repository GitHub: github.com/Havocwithin/portaljust-dashboard

#### Ajustare Dimensiune Font
- Recalibrat valorile fontului: Mic (16px), Normal (18px), Mare (20px), Extra (22px)
- "Normal" corespunde acum dimensiunii corecte pentru ecrane laptop standard
- Rezolvat problema fontului prea mic pe rezolutii mari

#### Iconita Aplicatie
- Iconita cu balanta justitiei prezenta peste tot: installer, taskbar Windows, title bar
- Configurata pentru NSIS (installer/uninstaller icons)
- Adaptata pentru macOS (icon 1024px)

#### Installer fara Drepturi Admin
- Instalarea pe Windows nu mai necesita drepturi de administrator
- Se instaleaza in AppData (per-user), nu in Program Files
- `allowElevation: false` previne prompt-ul UAC

---

## [1.1.0] - 2026-03-26

### Functionalitati Noi

#### Selectie Multipla Roluri (Analiza Parte)
- Badge-urile de rol din sectiunea "Analiza Parte" suporta acum **selectie multipla**
- Se pot combina mai multe roluri simultan (ex: "Creditor" + "Parat" + "Reclamant")
- Mesaj dinamic: "1 filtru activ" / "3 filtre active"
- Click repetat pe un rol il deselecteaza

#### Evidentierea Numelui Cautat (Highlight)
- Cuvintele cautate sunt evidientiate cu **galben** in numele partilor
- Functioneaza independent de ordinea cuvintelor ("instant factoring" evidentiaza "INSTANT" si "FACTORING" separat)
- Aplicat in:
  - Preview-ul din randul tabelului Dosare (primele 2 parti)
  - Sectiunea expandata Parti din Dosare
  - Sectiunea expandata Parti din Termene
- Tooltip (hover) pe numele trunchiate pentru vizualizarea numelui complet

#### Control Dimensiune Text
- Adaugat control de font size in sidebar (4 pasi: Mic 14px, Normal 16px, Mare 18px, Extra 20px)
- Sidebar expandat: butoane A-/A+ cu indicator vizual (4 puncte)
- Sidebar collapsed: iconita "A" cu ciclu prin pasi la click
- Setarea se salveaza in localStorage - persistenta intre sesiuni
- Afecteaza toata aplicatia (Tailwind rem-based scaling)

#### Detalii Expandabile in Tabelul Termene
- Click pe rand deschide/inchide detalii complete
- Informatii afisate: Categorie, Stadiu, Obiect dosar
- Solutie completa (titlu + sumar integral, text lizibil)
- Lista de parti cu badge calitate + nume cu highlight
- Sageata vizuala (chevron) indica expandabilitatea

#### Detalii Expandabile in Calendar
- Numerele de dosar din calendar sunt acum **linkuri** catre portal.just.ro
- Click pe card deschide dropdown cu:
  - Solutie completa (titlu + sumar)
  - Lista de parti cu badge calitate
- Sageata vizuala indica expandabilitatea

#### Filtre Metrici Termene (Carduri Clickabile)
- Cardurile "Termene Viitoare", "Termene Trecute", "Cu Solutie" functioneaza ca **filtre multiple choice**
- Card activ: ring albastru + iconita inversata
- "Total Termene" reseteaza toate filtrele la click
- Filtrele se propaga in cascada: Categorie/Stadiu -> Metrici -> Tabel + Calendar
- Se reseteza automat la cautare noua

#### Filtre Categorie/Stadiu pe Termene
- Filtrele Categorie Caz si Stadiu Procesual sunt acum **functionale** pe pagina Termene
- Backend-ul transmite acum `categorieCaz`, `stadiuProcesual`, `obiect` si `parti` pentru fiecare termen
- Filtrare client-side identica cu cea de pe Dosare
- Metricile reflecta datele filtrate de categorie/stadiu

### Imbunatatiri

#### Corectare Texte Concatenate (Documente Sedinta)
- Extins dictionarul de segmentare cu ~50 termeni juridici noi
- Rezolvate cazuri precum:
  - "INCHEIEREFINALA" -> "INCHEIERE FINALA"
  - "DEZINVESTIREFINALA" -> "DEZINVESTIRE FINALA"
  - "INCHEIERECAMERAPRELIMINARA" -> "INCHEIERE CAMERA PRELIMINARA"
  - "HOTARAREDEFINITIVA" -> "HOTARARE DEFINITIVA"
  - "SENTINTAPENALA" -> "SENTINTA PENALA"
- Categorii adaugate: actiuni procesuale, calificative, locuri/contexte, participanti, prepozitii

#### Consistenta Interfata
- Stilul solutiei din detalii Termene aliniat cu cel din Dosare
- Badge-ul albastru de marcare parte eliminat (pastrat doar highlight-ul galben pe nume)

### Infrastructura

#### Date Complete pentru Termene
- API-ul `/api/termene` returneaza acum informatii complete din dosar:
  - `categorieCaz` - categoria dosarului
  - `stadiuProcesual` - stadiul procesual
  - `obiect` - obiectul dosarului
  - `parti[]` - lista completa de parti (nume + calitate)
- Tipul TypeScript `Termen` actualizat cu campurile noi

---

## [1.0.0] - 2026-03-25

### Lansare Initiala

#### Functionalitati Principale
- Conectare la API-ul SOAP PortalJust.ro (Ministerul Justitiei)
- Cautare dosare dupa: numar dosar, nume parte, obiect dosar
- Cautare termene cu date start/stop
- Filtre client-side: Categorie Caz, Stadiu Procesual
- Vizualizare tabel cu paginatie (20 elemente/pagina)
- Vizualizare calendar pentru termene
- Export Excel si PDF
- Metrici si statistici (grafice Recharts)
- Analiza parte cu roluri si numar aparitii
- Sectiuni de metrici collapsabile (Ascunde/Arata)
- Tema Dark/Light cu persistenta
- Sidebar cu navigare si collapse
- Istoric cautari (max 15, localStorage, stergere individuala)
- Popover istoric pentru sidebar collapsed
- Link-uri directe catre portal.just.ro
- Segmentare automata documente concatenate (INCHEIEREDESEDINTA -> INCHEIERE DE SEDINTA)
- Matching nume independent de ordine (Florin Duduianu = DUDUIANU FLORIN)

#### Arhitectura
- Frontend: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- Backend: Node.js + Hono (port 3001)
- SOAP integration: portalquery.just.ro/query.asmx
- Grafice: Recharts (PieChart, BarChart)
- Packaging: Electron + electron-builder (NSIS installer, fara admin)

#### Securitate (Masuri de Baza)
- **Rate limiting** (30 req/min pe endpoint) — previne flood-ul si abuzul API-ului
- **Input validation** — lungime maxima 200 caractere per parametru, validare format date YYYY-MM-DD
- **Bind localhost only** (127.0.0.1) — serverul backend nu este expus in retea, doar aplicatia Electron il poate accesa
- **Path traversal protection** — fisierele statice servite doar din directorul frontend; cererile cu `../` sau cai absolute sunt blocate cu HTTP 403
- **Security headers** (Hono secureHeaders) — X-Content-Type-Options: nosniff, X-Frame-Options: DENY, X-XSS-Protection, Content-Security-Policy
- **Escape XML complet** pentru SOAP requests — toate inputurile utilizatorului sunt escaped inainte de a fi trimise catre PortalJust (previne XML injection)
- **CORS restrictiv** — doar originile localhost pe porturile de dezvoltare (5173, 4173) sunt permise; orice alta origine este blocata
- **Fara persistenta API keys in backend** — cheile nu sunt stocate pe disc de catre server, sunt primite per-request de la client
