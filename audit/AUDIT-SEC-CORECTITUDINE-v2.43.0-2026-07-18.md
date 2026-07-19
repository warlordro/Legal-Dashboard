# Raport de audit — Legal Dashboard IF (v2.43.0)

**Tip:** audit de securitate + corectitudine, adversarial, pe cod (white-box). **Data:** 2026-07-18.
**Scope:** `backend/`, `electron/`, `frontend/src/`, `scripts/`, root configs (Dockerfile, compose, CI), `.github/workflows/`.
**Metoda:** recon + threat model, sweep-uri paralele pe module, fiecare finding verificat manual pe cod (file:line) inainte de raportare. Zero fisiere modificate.

## 1. Sumar executiv

Postura generala este **neobisnuit de buna**: parametrizare SQL peste tot (269 de `.prepare()` verificate, zero concatenare cu input), auth fail-closed (JWT HS256 pinned, timing-safe, denylist pe `jti`), owner-scoping consecvent pe toate repository-urile (inclusiv JOIN-uri), jail-uri de path cu regex ancorat + hash, CSP strict, sandbox Electron maxim, CI cu actions pin-uite pe SHA, imagini Docker pin-uite pe digest, secrete doar din env, fara fallback la plaintext pentru chei. **Zero Critical, zero High.** Cele 2 Medium de securitate: **CSRF clasic pe backend-ul de loopback din modul desktop** (rute mutante fara `requireDesktopHeader` si fara verificare de Content-Type) si **Electron 41 la coada ferestrei de suport** pentru un renderer care afiseaza continut scrape-uit de pe site-uri terte.

Top 3 de reparat primul: **(1)** SEC-01 — acopera toate rutele POST mutante cu `requireDesktopHeader` in desktop mode sau valideaza `Content-Type: application/json` la boundary; **(2)** SEC-02 — planifica upgrade Electron 41 → 43 inainte sa iasa din suport; **(3)** BUG-02 — inchide bypass-ul limitei de stocare RNPM pe fluxul de continuare `gcode`.

Cea mai mare slabiciune sistemica: **modelul de incredere loopback** — `originGuard` face bypass total pe loopback, `requireDesktopHeader` e aplicat selectiv (doar pe "POST-uri admin body-less"), iar handler-ele nu verifica Content-Type, deci premisele din comentariul de design ("JSON POST-urile declanseaza preflight") nu se aplica la `text/plain` cu body JSON.

## 2. Tabel de findings (sortat pe severitate)

| ID | Titlu | Severitate | Incredere | Categorie (CWE) | Locatie |
|---|---|---|---|---|---|
| SEC-01 | CSRF pe desktop prin simple-POST pe rute JSON fara desktop-header | **Medium** | Confirmed | CWE-352 (CSRF) | `backend/src/middleware/originGuard.ts:52-56`, `routes/monitoring.ts:143,457`, `routes/alerts.ts:230`, `routes/nameLists.ts:345`, `routes/me.ts:301`, `routes/admin.ts:255,346` |
| SEC-02 | Electron 41.5.0 — la coada ferestrei de suport (curent: 43.x) | **Medium** | Likely | CWE-1104 (unmaintained components) | `package.json:118` |
| BUG-01 | `buildAlertsPdf` fara try/catch → tmp file + stream leak la eroare | **Medium** | Confirmed | CWE-772 (missing release) | `backend/src/services/alertsExportPdf.ts:171-187` |
| BUG-02 | Limita de stocare RNPM ocolita integral pe fluxul `gcode` (continuare) | **Medium** | Confirmed | CWE-770 (allocation w/o limits) | `backend/src/routes/rnpm.ts:243-246`, `services/rnpmSearchService.ts:365` |
| SEC-03 | `xlsx-js-style` (abandonat, SheetJS 0.18 frozen) parseaza uploaduri in renderer | Low | Confirmed | CWE-1104 | `frontend/src/lib/monitoringBulkTemplate.ts:318-322` |
| SEC-04 | Toate fetch-urile outbound urmaresc redirecturi; `x-api-key`/`x-goog-api-key` nu sunt strip-uite cross-origin | Low | Confirmed | CWE-601 / CWE-200 | `backend/src/soap.ts:124`, `services/keyValidation.ts:77,91` |
| SEC-05 | Log forging: `<faultstring>` SOAP (controlabil de MITM) scris raw in logs | Low | Confirmed | CWE-117 (log injection) | `backend/src/soap.ts:146-148` |
| SEC-06 | `decodeXmlEntities` arunca `RangeError` pe char refs > U+10FFFF (DoS per-request) | Low | Confirmed | CWE-20 (improper input validation) | `backend/src/soap.ts:159-168` |
| SEC-07 | `rnpmClient` — singurul client upstream fara cap de dimensiune pe raspuns | Low | Confirmed | CWE-770 | `backend/src/services/rnpmClient.ts:287,308,331` |
| SEC-08 | IPC `notification:*` fara sender-check (inconsistent cu `isTrustedIpcSender`) | Low | Confirmed | CWE-862 (missing authorization) | `electron/notifications.js:212-224` |
| SEC-09 | Fara plafon per-owner pe numarul de joburi de monitorizare | Low | Confirmed | CWE-770 | `backend/src/services/monitoring/commands/createMonitoringJob.ts:44-88` |
| SEC-10 | Fara handler `will-redirect` (mirror pentru `will-navigate`) | Info | Confirmed | hardening | `electron/main.js:438-454` |
| SEC-11 | Placeholder JWT >32 chars trece validarea de boot daca e copiat verbatim | Info | Confirmed | CWE-798 adj. | `docker-compose.web.example.yml:49` |
| SEC-12 | `uuid <11.1.1` via `exceljs` (npm audit, moderat, GHSA-w5hq-g745-h8pq) | Info | Likely | CWE-1104 | `backend/package.json` (via lockfile) |
| SEC-13 | Drift de versiuni in deploy templates; domeniu real in comentariu commit | Info | Confirmed | operational | `deploy/.env.prod.example:87`, `docker-compose.yml:32,82` |
| BUG-03 | `runJobNow`: unique-index violation → 500 in loc de 409 `in_flight` | Low | Confirmed | CWE-754 (improper error check) | `services/monitoring/scheduler.ts:272-291`, `routes/monitoring.ts:486-501` |
| BUG-04 | Retry-ul daily report nu poate trece de hour-gate → raport pierdut silent | Low | Confirmed | CWE-697 (incorrect comparison) | `services/email/dailyReportScheduler.ts:157` |
| BUG-05 | `rnpmSplitter`: handle readonly monolit leaked daca `new Database(tmp)` arunca | Low | Confirmed | CWE-772 | `backend/src/db/rnpmSplitter.ts:356-357` |
| BUG-06 | Loop de paginare RNPM pe `pagesTotal` nevalidat → hang + dublu consum captcha | Low | Possible | CWE-400 | `services/rnpmSearchService.ts:363`, `services/rnpmClient.ts:212-220` |
| BUG-07 | `finishWriteStream`: unlink pe Windows cu stream inca deschis → orfani in tmp | Low | Possible | CWE-459 (incomplete cleanup) | `backend/src/util/pdfStream.ts:9-21` |
| BUG-08 | Timer 75s de shutdown fara `clearTimeout`/`unref` | Low | Possible | CWE-459 | `electron/main.js:101-107` |
| BUG-09 | Filtrul strict name_soap fara fingerprint → fals flood `dosar_disappeared` la upgrade | Low | Possible | CWE-1188 adj. | `services/monitoring/nameSoapRunner.ts:283-300`, `diff/nameSoap.ts:302-318` |
| BUG-10 | Manualul in-app afirma (fals) ca cheile web sunt "obfuscate in localStorage" | Info | Confirmed | documentation | `frontend/src/pages/manual-content.tsx:727` |

## 3. Findings detaliate

### SEC-01 · CSRF pe desktop prin simple-POST cross-origin · **Medium** · Confirmed

**Categorie / CWE / OWASP:** CWE-352; OWASP A01:2021 (Broken Access Control).

**Locatii:** `backend/src/middleware/originGuard.ts:52-56`; rute expuse: `backend/src/routes/monitoring.ts:143` (POST `/api/v1/monitoring/jobs`), `backend/src/routes/monitoring.ts:457` (POST `/jobs/:id/run`), `backend/src/routes/alerts.ts:230` (POST `/api/v1/alerts/seen-bulk`), `backend/src/routes/nameLists.ts:345-346` (POST `/api/v1/name-lists` + `/commit`, creeaza pana la 100 joburi/request), `backend/src/routes/me.ts:301` (email test), `backend/src/routes/admin.ts:255,346` (create user / import — in desktop userul `local` e auto-promovat admin, `backend/src/index.ts:541-543`), plus exporturile POST CPU-bound (`alerts.ts:380,639,646`, `rnpm.ts:1333,1350,1389`, `dosare.ts:92`, `termene.ts:98`).

**Descriere.** `requireDesktopHeader` exista exact pentru acest atac (comentariul sau din `requireDesktopHeader.ts:4-18` il descrie corect), dar e aplicat **doar** pe "POST-uri admin body-less", pe premisa documentata ca "POST-urile cu body JSON declanseaza preflight prin `Content-Type: application/json`" (`requireDesktopHeader.ts:26-28`). Premisa e falsa server-side: nimic nu impune Content-Type. `readLimitedJsonBody` (`monitoring.ts:47-82`) face `c.req.text()` + `JSON.parse`; `c.req.json()` (Hono, pe `alerts.ts:234`) parseaza indiferent de Content-Type.

**Dovada:**

```ts
// originGuard.ts:52-56 — bypass total pe loopback, Origin ignorat
const remoteAddr = readClientIp(c);
if (isLoopbackAddress(remoteAddr)) {
  await next();
  return;
}
```

```ts
// monitoring.ts:143 — fara requireDesktopHeader; body citit ca text + JSON.parse
monitoringRouter.post("/jobs", limitMonitoringBody, async (c) => {
  const ownerId = getOwnerId(c);
  const bodyResult = await readLimitedJsonBody(c);   // zero verificare Content-Type
```

**Flux / scenariu de exploatare.** Victima are aplicatia Electron pornita (backend pe `127.0.0.1:3002`, `auth_mode=desktop` → `ownerId="local"` fara niciun token) si deschide in orice browser o pagina ostila. Pagina executa:

```js
fetch("http://127.0.0.1:3002/api/v1/monitoring/jobs", {
  method: "POST",
  body: JSON.stringify({ kind: "dosar_soap", target: { numar_dosar: "1/2026", institutii: ["TRIBUNALUL_BUCURESTI"] }, cadence_seconds: 600 })
  // fara Content-Type explicit => browserul pune text/plain => "simple request", FARA preflight
});
```

Requestul trece de `ownerContext` (desktop = fara auth), de `originGuard` (peer loopback → pass-through), ajunge la handler cu body JSON valid → job creat. Consecinte concrete: (a) **sarcina sustinuta pe portalquery.just.ro de pe IP-ul victimei** — pana la 100 joburi per request prin `name-lists/commit`, fiecare cu cadenta minima 600s, riscand throttling/banarea IP-ului victimei pe portal (rau real pentru un avocat care depinde de el); (b) `POST /jobs/:id/run` cu id-uri secventiale → rulari imediate; (c) `POST /alerts/seen-bulk` (≤100 id-uri/call) → **marcarea alertelor ca vazute — victima poate rata un termen de judecata** (impact pe integritate, nu doar zgomot); (d) exporturi XLSX/PDF repetate → CPU (better-sqlite3 e sincron, blocheaza event loop-ul). Nu exista furt de date: SOP blocheaza citirea raspunsului.

**Nuanta de exploatabilitate (onesta):** Chrome Private Network Access, unde e aplicat, constrange paginile **https**; un atacator poate servi pagina pe plain http si ocoleste. Firefox/Safari nu implementeaza PNA. Rutele PATCH/PUT/DELETE nu sunt afectate (metode non-simple → preflight esueaza, CORS fiind dev-only, verificat `index.ts:140-151`).

**Impact:** integritate si disponibilitate locala; cel mai rau caz practic = alerte de termen ascunse + IP-ul victimei banat pe PortalJust.

**Remediere.** Varianta minimala (recomandata): aplica `requireDesktopHeader` pe **toate** mutatiile in desktop mode, nu selectiv — cel mai simplu ca middleware global in `index.ts` pe `app.use("/api/*", ...)` cand `getAuthMode()==="desktop"`. Plus intarire structurala: respinge JSON parse-at din Content-Type non-JSON.

```ts
// pattern aplicabil peste tot — enforce la boundary:
async function readLimitedJsonBody(c: Context) {
  const ct = c.req.header("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) {
    return { ok: false as const, response: c.json(fail("unsupported_media_type", "Content-Type JSON necesar", c), 415) };
  }
  // ... restul neschimbat
}
```

Defense-in-depth suplimentar: in `originGuard`, pentru calleri loopback, daca headerul `Origin` este **prezent** si nu corespunde `Host` (cu exceptie origin-urilor dev 5173/4173 cand `NODE_ENV!=="production"`), respinge — astfel pastrezi dev-ul functional dar blochezi orice pagina cross-origin chiar si pe loopback.

---

### SEC-02 · Electron 41.5.0 la coada ferestrei de suport · **Medium** · Likely

**Categorie / CWE:** CWE-1104 (Use of Unmaintained Third Party Components); OWASP A06:2021.

**Locatie:** `package.json:118` — `"electron": "^41.5.0"` (lockfile pin: 41.5.0).

**Descriere.** Politica Electron de suport acopera aproximativ ultimele 3 majore stabile; ultima versiune publicata este 43.x (raportat din registry npm — **de re-verificat manual** inainte de planificare). `^41.5.0` trage doar patch-uri 41.x; cand 41 iese din fereastra, renderer-ul (care afiseaza date scrape-uite de pe portal.just.ro, scj.ro, mj.rnpm.ro — continut pe jumatate hostil) nu mai primeste backport-uri de securitate Chromium/V8.

**Scenariu:** un n-day de renderer (V8/Chromium) devine exploatabil prin continut randat; mitigarile existente (sandbox, contextIsolation, CSP `script-src 'self'`, fara navigare externa, `will-navigate` strict — toate verificate la `electron/main.js:385-454`) reduc severitatea, dar currency-ul Chromium ramane controlul numarul 1 pentru aceasta suprafata.

**Remediere:** planifica upgrade-ul 41 → 42 → 43 (cu `npm run rebuild:electron` + re-test smoke `npm run electron:dev`); pastreaza Dependabot (deja activ) dar ridica prioritatea pe `electron`. Nu e urgenta — e un milestone.

---

### BUG-01 · `buildAlertsPdf`: tmp file + WriteStream leak la orice eroare · **Medium** · Confirmed

**Categorie / CWE:** CWE-772 (Missing Release of Resource); corectitudine/robustete.

**Locatie:** `backend/src/services/alertsExportPdf.ts:171-187`.

**Descriere.** Singurul export-builder fara try/catch. Toti ceilalti curata la eroare: `rnpmExportPdf.ts:314-318` (`catch { doc.destroy(); output.destroy(); await fs.unlink(tmpPath).catch(()=>{}); }`), iar builderii XLSX folosesc flag-ul `committed` + unlink.

**Dovada:**

```ts
export async function buildAlertsPdf(rows: AlertExportDecoratedRow[], contextLabel?: string) {
  const tmpPath = join(tmpdir(), `alerts-pdf-${randomUUID()}.pdf`);
  const stream = createWriteStream(tmpPath);
  const doc = new PDFDocument({ ... });
  doc.pipe(stream);
  // ... drawTable(doc, rows, 82, 1);  // poate arunca pe glyph-uri necodificabile WinAnsi
  doc.end();
  await finishWriteStream(stream, tmpPath);
  const stat = await fs.stat(tmpPath);  // poate esua (AV quarantine, EMFILE)
  return { filepath: tmpPath, ... };
}
```

**Scenariu de esec:** titlul/detaliile alertelor provin din texte de solutie PortalJust (unicode arbitrar). Un glyph necodificabil in Helvetica WinAnsi (emoji) sau un `fs.stat` esuat lasa `alerts-pdf-*.pdf` pe disk permanent si stream-ul nedistrus; fiecare retry al userului adauga un orfan; raspunsul e 500.

**Remediere:**

```ts
export async function buildAlertsPdf(rows, contextLabel?) {
  const tmpPath = join(tmpdir(), `alerts-pdf-${randomUUID()}.pdf`);
  const stream = createWriteStream(tmpPath);
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, autoFirstPage: true });
  doc.pipe(stream);
  try {
    // ... tot corpul existent (title/header/drawTable) ...
    doc.end();
    await finishWriteStream(stream, tmpPath);
    const stat = await fs.stat(tmpPath);
    return { filepath: tmpPath /*, ... */ };
  } catch (err) {
    doc.destroy();
    stream.destroy();
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
```

(Paritate exacta cu `rnpmExportPdf.ts:314-318`.)

---

### BUG-02 · Limita de stocare RNPM ocolita pe fluxul `gcode` · **Medium** · Confirmed

**Categorie / CWE:** CWE-770; business-logic (control de fairness multi-tenant).

**Locatii:** `backend/src/routes/rnpm.ts:243-246` si `backend/src/services/rnpmSearchService.ts:365`.

**Dovada:**

```ts
// routes/rnpm.ts:243-246 — admission check sarit cand exista gcode
const previewGcode = (parsedBody as { gcode?: unknown }).gcode;
if (!(typeof previewGcode === "string" && previewGcode.length > 0)) {
  await assertRnpmStorageWithinLimit(ownerId);
}
```

```ts
// rnpmSearchService.ts:363-365 — re-check-ul per pagina e si el conditionat
while (allDocs.length < batchSize && rnpmPage <= pagesTotal) {
  throwIfAborted(signal);
  if (!existingGcode) await input.storageLimitCheck?.(ownerId);
```

**Scenariu:** un owner aflat la/peste plafon (`LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB`, default 750MB) continua sa adune avize la infinit prin paginarea "Incarca mai multe" (fiecare batch ≤200 avize cu detalii complete). Cautarile fresh sunt corect refuzate peste cap; continuarea nu re-verifica niciodata. In web multi-tenant asta anuleaza controlul de fairness per tenant; logica "second chance" WAL-checkpoint din `measureRnpmStorage` nu se exercita deloc pe aceasta cale.

**Remediere:** aplica check-ul si pe continuare, dar cu prag de oprire, nu de admisie (ca sa nu blochezi userul la jumatatea unei serii legitime):

```ts
// rnpmSearchService.ts:365 — inlocuieste conditia:
await input.storageLimitCheck?.(ownerId);   // la fiecare pagina, indiferent de existingGcode
```

daca `storageLimitCheck` arunca peste cap, opreste loop-ul si intoarce rezultatele acumulate (partial), nu 500 — sau muta check-ul la momentul `saveAvizFull` (per salvare, fail-closed).

---

### SEC-03 · `xlsx-js-style` (abandonat) parseaza uploaduri in renderer · Low · Confirmed

**Locatie:** `frontend/src/lib/monitoringBulkTemplate.ts:318-322`.

**Descriere.** `parseBulkFile()` ruleaza `XLSX.read()` pe fisiere XLSX arbitrare alese de user (preview bulk-import), in renderer. `xlsx-js-style@1.2.0` e nemaintainat (~2022) si ingheata arborele SheetJS Community 0.18.x (cu advisory-uri publice ne-patch-uite pe npm: clase prototype-pollution si ReDoS). Mitigare partiala existenta: cap pe `!ref` declarat inainte de `sheet_to_json` (`:331-348`) — dar `XLSX.read()` insusi parseaza tot fisierul. Server-side, parserul autoritativ e `exceljs@4.4.0` (maintainat) — `nameListParser.ts:40`. Changelog-ul intern inca afirma "write-only, nu primeste input atacator" — nu mai e adevarat. Blast radius limitat de sandbox + CSP `script-src 'self'`; renderer-ul detine insa cheile API in clar in memorie pe durata sesiunii.

**Remediere:** muta preview parsing pe backend (calea exceljs exista deja) sau inlocuieste parserul client; actualizeaza si changelog-ul.

---

### SEC-04 · Redirect-following pe toti clientii outbound; chei ne-strip-uite · Low · Confirmed

**Locatii:** `backend/src/soap.ts:124` (POST plaintext HTTP catre portalquery), `backend/src/services/keyValidation.ts:75-93`, plus `iccjClient.ts:463,536,605,737`, `captchaSolver.ts:122`, `fxFetcher.ts:79`, `rnpmClient.ts:277-331`.

**Descriere.** Niciun client nu seteaza `redirect: "manual"`; undici urmareste pana la 20 de redirecturi cross-origin. Doua consecinte: (a) un MITM pe HTTP-ul SOAP poate raspunde cu `307` + `Location` arbitrar → POST-ul cu envelope-ul (numere de dosar / nume de parti) e retrimis catre host-ul ales de atacator (sensibilitate mica — date publice — dar ies din perimetru); (b) la redirect cross-origin, undici strip-uieste doar `Authorization` — **`x-api-key` (Anthropic, `:77`) si `x-goog-api-key` (Google, `:91`) raman** si ar fura cheia tenantului catre target-ul redirectului. Cazul (b) cere ca providerul legit HTTPS sa emita el insusi un redirect catre un host ostil (compromitere provider / open redirect la provider) — probabilitate mica, de aceea Low.

**Remediere:** `redirect: "manual"` pe punctele cu chei (`keyValidation.ts`) + pe `soap.ts`, tratarea 3xx ca eroare; sau validarea host-ului final dupa fetch (`new URL(res.url).hostname` in whitelist).

---

### SEC-05 · Log forging prin SOAP `<faultstring>` · Low · Confirmed

**Locatie:** `backend/src/soap.ts:146-148`.

```ts
const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] ?? "necunoscut";
console.error("SOAP Fault detalii:", fault);
```

**Flux:** raspuns SOAP (plaintext HTTP → MITM il controleaza integral) → `fault` → stdout, fara cap de lungime si fara strip de `\n`/ANSI. Atacatorul poate forja linii de log sau injecta escape sequences in pipeline-urile de log. Nu ajunge la client (mesajul aruncat e generic).

**Fix:** `fault.slice(0, 500).replace(/[\x00-\x1f\x7f]/g, " ")`.

---

### SEC-06 · `RangeError` DoS in `decodeXmlEntities` · Low · Confirmed

**Locatie:** `backend/src/soap.ts:159-168`.

```ts
.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
```

**Flux:** `&#x110000;` (sau orice > U+10FFFF) din raspunsul SOAP → `String.fromCodePoint` arunca `RangeError`. Neajuns de maparea de erori a lui `callSoap` (nu e `SoapResponseTooLargeError`); prins generic: 500 pe ruta interactiva, `fail_streak++` in runner-ul de monitoring. Un MITM persistent poate tine un dosar monitorizat in streak de erori indefinit sau poate intoarce 500 la fiecare cautare.

**Fix:**

```ts
const safeCodePoint = (n: number) => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\uFFFD");
// .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(Number.parseInt(hex, 16)))
// .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
```

---

### SEC-07 · `rnpmClient` fara cap de dimensiune pe raspuns · Low · Confirmed

**Locatie:** `backend/src/services/rnpmClient.ts:287,308,331` — trei `await res.json()` nelimitate. SOAP are cap 50MB (`SOAP_MAX_RESPONSE_BYTES` + `readResponseTextWithCap`), ICCJ are cap (`ICCJ_MAX_RESPONSE_BYTES`, default 20MB); RNPM — nimic. Un raspuns anormal (bug upstream pe HTTPS, nu MITM) poate consuma memoria procesului.

**Fix:** refoloseste `readResponseTextWithCap` + `JSON.parse`, paritate cu ceilalti clienti.

---

### SEC-08 · IPC `notification:*` fara sender-check · Low · Confirmed

**Locatie:** `electron/notifications.js:212-224` vs guard-ul `isTrustedIpcSender` din `electron/main.js:299-301` (aplicat pe toate cele 4 canale safeStorage/theme).

```js
ipcMain.handle("notification:show", (_event, payload) => showNativeNotification(payload)); // _event ignorat
```

Validarea payload-ului e buna (title ≤120 obligatoriu, body ≤500, tag ≤200, silent coerced). Exploatabil doar dintr-un al doilea webContents — care nu poate fi creat (`setWindowOpenHandler` deny-all) — sau post-compromitere renderer.

**Fix (5 linii):** aplica `isTrustedIpcSender(event)` pe cele 3 handle-uri `notification:*`.

---

### SEC-09 · Fara plafon per-owner pe joburile de monitorizare · Low · Confirmed

**Locatie:** `backend/src/services/monitoring/commands/createMonitoringJob.ts:44-88` — insert transactional curat, dar fara nicio verificare de count. Un user autentificat (sau vectorul SEC-01 pe desktop) poate crea mii de joburi la 120 req/min; scheduler-ul clameaza 50/tick la 60s → ~50 fetch-uri SOAP/ICCJ/min la infinit; `monitoring_runs/snapshots/alerts` cresc per job (retentia purge-uie pe varsta, nu pe volum). Mitigari existente: cadenta minima 600s, kill-switches operationale.

**Fix:** quota pe feature `monitoring.jobs` in tabela de override-uri existenta (verificare in `executeCreateMonitoringJob` inainte de insert: `SELECT COUNT(*) ... WHERE owner_id=?`).

---

### SEC-10 · Fara handler `will-redirect` · Info · Confirmed

`electron/main.js:438-454`: `will-navigate` nu se declanseaza pe redirecturi server-side 3xx; `will-redirect` nu e tratat. Neexploatabil azi (niciun handler din backend nu emite 30x — verificat prin grep), dar orice viitor OAuth-flow/open-redirect ocoles­te allowlist-ul. **Fix:** copiaza logica `will-navigate` intr-un handler `will-redirect`.

### SEC-11 · Placeholder JWT >32 chars · Info · Confirmed

`docker-compose.web.example.yml:49`: `"REPLACE_WITH_32_PLUS_CHAR_SECRET_FROM_SECRET_MGR"` are 49 chars > 32 → trece `requireJwtSecret` daca e copiat verbatim. **Fix:** placeholder <32 chars (esueaza fail-closed la boot).

### SEC-12 · `uuid <11.1.1` via `exceljs` · Info · Likely

`npm audit --omit=dev` (rulat in ziua auditului, output real): `uuid <11.1.1` via `exceljs` — GHSA-w5hq-g745-h8pq (missing buffer bounds check in v3/v5/v6 cu `buf`), moderat; exploatabil doar daca exceljs apeleaza uuid cu buffer propriu (rar). Rezolvare la urmatorul upgrade exceljs.

### SEC-13 · Drift de versiuni in deploy; domeniu real in comentariu · Info · Confirmed

`APP_VERSION` default in deploy templates: 2.35.0 (`deploy/.env.prod.example:87`) / 2.38.0 (`docker-compose.yml:82`) / 2.39.0 (`deploy/docker-compose.prod.yml:84`) vs release 2.43.0 → operatorul care copiaza defaulturile deploy-uie o imagine stale. Plus `docker-compose.yml:32` mentioneaza domeniul real `instantfactoring.com` intr-un comentariu commit (divulgare usoara, nu secret).

---

### BUG-03 · `runJobNow`: 500 in loc de 409 pe unique-index · Low · Confirmed

**Locatii:** `backend/src/services/monitoring/scheduler.ts:272-291` + `backend/src/routes/monitoring.ts:486-501`. Tick-ul clameaza jobul (INSERT `running` comis in `claimDueJobs`), dar `inflight.set` se face o microtask mai tarziu; un `POST /jobs/:id/run` in fereastra trece de ambele check-uri `inflight.has`, iar `insertRunning` loveste indexul partial unic `idx_one_running_per_job` → `SQLITE_CONSTRAINT_UNIQUE` nu se mapeaza la `in_flight`/`not_running` → 500 generic + audit `outcome=error` inselator. Indexul previne corect dubla rulare (fara corupere) — e doar clasificare gresita.

**Fix:** in catch-ul rutei, mapeaza `SQLITE_CONSTRAINT_UNIQUE` la `409 in_flight` (sau prinde codul in `runJobNow` si seteaza `err.code="in_flight"`).

### BUG-04 · Retry daily report blocat de hour-gate · Low · Confirmed

**Locatie:** `backend/src/services/email/dailyReportScheduler.ts:157` (`if (now.getHours() !== configuredHour) return baseResult;`). Backoff-ul +5/+15/+45 min (`:43-44`) nu poate traversa granita orei: prima incercare esuata la 09:50 programeaza retry la 10:05, dar din 10:00 gate-ul intoarce early → incercarile 2-3 nu ruleaza niciodata; entry-ul e sters a doua zi ca stale → raportul zilei se pierde silent (un singur rand de audit `email.daily_report.failed`, ramura `retry_exhausted` neatinsa). Caz adjacent (Possible): ora configurata = ora sarita la DST (ex. 03:00 la spring-forward Romania) → gate inchis toata ziua.

**Fix:** gate-ul sa permita si cazul "avem retry datorat azi" (`if (now.getHours() !== configuredHour && !dueRetry) return`).

### BUG-05 · `rnpmSplitter`: handle monolit leaked · Low · Confirmed

**Locatie:** `backend/src/db/rnpmSplitter.ts:356-357` — `const src = openMonoSourceReadonly(); const target = new Database(tmpPath);` in afara try-ului; daca al doilea arunca (disk full/AV), `src` ramane deschis. Impact practic mic (boot-ul esueaza fail-closed oricum), dar pe Windows poate bloca tranzient recovery manual pe `legal-dashboard.db`.

**Fix:** deschide target-ul primul sau muta in try/finally.

### BUG-06 · Loop paginare pe `pagesTotal` nevalidat · Low · Possible

**Locatii:** `services/rnpmSearchService.ts:363` + `services/rnpmClient.ts:212-220` (schema zod are doar `int().nonnegative()`, fara `.max()`). Payload patologic (mii de pagini goale) → loop fara progres pana la disconnect client; dupa expirarea dedup-ului (`INFLIGHT_TTL_SEARCH_MS`), un retry porneste o a doua cautare identica concurent → dublu consum captcha (dedup-ul aviz-level previne duplicarea datelor).

**Fix:** clamp `pagesTotal = Math.min(pagesTotal, 100)` si progres-guard in loop.

### BUG-07 · `finishWriteStream`: unlink pe Windows cu stream deschis · Low · Possible

**Locatie:** `backend/src/util/pdfStream.ts:9-21`: la 'error', `unlink` fara `stream.destroy()` intai; pe Windows unlink pe handle deschis → EPERM inghitit de `.catch(()=>{})` → orfani tmp.

**Fix:** `stream.destroy()` inainte de unlink.

### BUG-08 · Timer 75s de shutdown fara cleanup · Low · Possible

**Locatie:** `electron/main.js:101-107`: `setTimeout` 75s fara `clearTimeout`/`unref` dupa drain rapid. Igiena; watchdog-ul din acelasi repo face `unref()` — inconsistenta pare accidentala.

### BUG-09 · Filtrul strict name_soap fara fingerprint · Low · Possible

**Locatii:** `nameSoapRunner.ts:283-300` + `diff/nameSoap.ts:302-318`: filtrul strict token-based nu are echivalentul `filterFingerprint` din dosar_soap; o schimbare de semantica la upgrade (`tokenizeNameForMatch`, `LEGAL_SUFFIX_TOKENS`) produce fals flood `dosar_disappeared` pe toate joburile name_soap (dedup anchor fresh per baseline). Poarta `version>=2` exista, dar nimic nu forteaza bump-ul la schimbarea filtrului.

**Fix:** serializeaza un hash al regulilor de filtrare in snapshot, ca la dosar_soap.

### BUG-10 · Documentatie in-app depasita · Info · Confirmed

`frontend/src/pages/manual-content.tsx:727` sustine ca in web mode cheile sunt "obfuscate reversibil in localStorage" — fapt: `useApiKey.ts:151-156` refuza persistarea complet in lipsa safeStorage, iar legacy-urile obfuscate sunt sterse (`:108-114`). Codul e **mai strict** decat documentatia; corecteaza textul manualului (si `lib/export-manual.ts:407,470`).

---

## 4. Plan de remediere prioritizat

**Quick wins (ore, risc minim):**

1. SEC-01: `requireDesktopHeader` global pe `/api/*` in desktop mode + enforce Content-Type JSON in `readLimitedJsonBody` si wrapper-ul de `c.req.json()`. Test: un `fetch` text/plain cross-origin primeste 403/415.
2. BUG-01: try/catch + destroy/unlink in `buildAlertsPdf` (paritate cu `rnpmExportPdf`).
3. SEC-05 + SEC-06: sanitizare faultstring + clamp code-point in `soap.ts` (10 linii, cu teste pe `&#x110000;` si `&#4294967295;`).
4. SEC-08 + SEC-10 + BUG-08 + BUG-05: sender-check IPC, handler `will-redirect`, `unref` timer, try/finally in splitter — fiecare ≤5 linii.
5. SEC-11: scurteaza placeholder-ul JWT sub 32 chars.

**Fixuri medii (1-2 zile):**

6. BUG-02: re-check storage pe calea `gcode` (cu oprire gratioasa la cap).
7. SEC-09: quota per-owner pe joburi monitoring, refolosind infrastructura de quota existenta.
8. SEC-04: `redirect: "manual"` pe `keyValidation.ts` + `soap.ts`; SEC-07: cap dimensiune in `rnpmClient`.
9. BUG-03, BUG-04, BUG-06, BUG-07: clasificare erori, hour-gate cu retry-due, clamp `pagesTotal`, destroy-inainte-de-unlink.
10. SEC-03: muta preview-ul bulk XLSX pe backend (exceljs exista deja server-side) sau inlocuieste parser-ul client.

**Strategic (sprint separat):**

11. SEC-02: upgrade Electron 41 → 43 cu smoke `electron:dev` pe Windows + macOS.
12. SEC-12: urmareste fixul `uuid` la upgrade-ul exceljs; BUG-09: fingerprint de filtru in snapshot-urile name_soap; BUG-10: repara manualul.

## 5. Acoperire si limitari

**Fisiere/zone revizuite:** tot `backend/src` (toate cele 17 fisiere de rute, toate repository-urile din `db/`, toate middleware-urile, serviciile — inclusiv scheduler-ul monitoring, cei 3 runneri + diff-urile, backup/restore/prune, splitter RNPM, captcha, AI, email, fx, exporturi XLSX/PDF), `electron/` integral (main.js 606 linii, preload, notifications, watchdog), `frontend/src` (sweep complet: 224 fisiere), CI (toate cele 4 workflow-uri + dependabot), `scripts/` integral, Dockerfile + ambele compose + `deploy/`, `.env.example`-uri, `.gitignore` vs `git ls-files` (713 fisiere tracked; **zero secrete/DB-uri commit-uite** — `.dev-web-local.secrets.json` e untracked, verificat).

**Categorii verificate si gasite curate (cu dovada):** SQL injection (toate cele 269 `.prepare()`; singurele interpolari sunt whitelist-uri constante; LIKE cu `escapeLikeMeta` + `ESCAPE '\\'` peste tot); command injection (`child_process` doar in tooling build cu argumente constante; `LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD` e shell verbatim **operator-only, documentat** — risc acceptat constient); XXE (zero parser XML — regex-only, billion-laughs inert); XSS (singurul `dangerouslySetInnerHTML` din repo e `SanitizedHtml.tsx` cu DOMPurify ALLOWED_TAGS=`strong/em/b/i`, ALLOWED_ATTR=`[]`); open redirect / `javascript:` URLs (builderi scheme-pinned cu `encodeURIComponent`); path traversal (regex `^[A-Za-z0-9_-]{1,64}$` + stem hash pe RNPM files, `rnpmDb.ts:20-37`; jail-uri backup cu `path.resolve` prefix check); prototype pollution (zero `Object.assign` pe input; mass-assignment absent structural); secrete in cod/logs (logger-ul HTTP logheaza doar pathname, `index.ts:100-115`; audit hash-uieste emailurile); authN/authZ/IDOR (JWT pinned HS256 + timing-safe + denylist; PAT 256-bit + SHA-256 + revoke instant + gate default-deny pe scope-uri read-only; toate `:id` cu `WHERE id=? AND owner_id=?` si 404 uniform; admin cu `requireRole` + protectie last-admin tranzactionala); CSRF web mode (SameSite=Strict + originGuard pe non-loopback — corect); CSRF desktop — **vezi SEC-01**; crypto (AES-256-GCM cu IV random pentru tenant keys, `tenantKeyCrypto.ts`; safeStorage fara fallback plaintext); CI/CD (fara `pull_request_target`, actions pe SHA, fara interpolare `github.event` in `run:`, least-privilege tokens); Docker (non-root, digest-pin, `npm ci`, fara `.env` baked, backend `expose`-only).

**Module optionale:** A (regulated) — nu manipuleaza bani; captcha/AI au quota tranzactionala (BEGIN IMMEDIATE, verificata); audit trail existent; PII (nume parti) minimizata in logs. B (LLM) — prompt injection posibila prin date PortalJust/scj.ro in prompturi (inerent designului), dar output-ul trece prin DOMPurify strict si **nu exista tool-use**; nota de privacy: datele dosarelor (nume parti) pleaca catre providerii AI la BYOK-ul userului — alegere constienta a userului, dar merita mentionat in manual.

**Ce NU am putut evalua:** (1) comportamentul runtime real al deploy-ului Dokploy/Traefik (config static verificat, nu am atacat perimetrul live); (2) "latest Electron = 43.x" — raportat din registry npm, de re-verificat la momentul planificarii; (3) exploatabilitatea exacta a PNA in versiunile curente de browser (ambele cazuri prezentate in SEC-01); (4) BUG-06..09 au trigger dependent de upstream/timing — marcate `Possible` onest; (5) nu am rulat suita de teste (`npm run check`) — audit static; niciun fisier nu a fost modificat.

**Verdict:** cod matur, cu disciplina de securitate vizibila in fiecare strat. Cele doua Medium (SEC-01, SEC-02) si BUG-01/02 sunt reparabile intr-un sprint; nimic nu blocheaza release-ul curent, dar SEC-01 ar trebui inchis inainte de orice crestere a suprafetei de rute desktop.
