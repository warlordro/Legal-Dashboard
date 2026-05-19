# Plan de Implementare: Cluster Validation + External I/O — Legal Dashboard v2.33.0

**Generat**: 2026-05-19
**Target**: `fix/validation-external-io-cluster` → v2.33.0
**Scope**: 4 findings (HIGH-1, MEDIUM-2, MEDIUM-4, MEDIUM-11)
**Estimat total**: ~5h implementare + ~1.5h test/review

---

## Ordine de implementare (dependente)

```
HIGH-1  (streamCap helper + soap.ts wiring)
  |
MEDIUM-2  (RNPM validation flag invert — independent de HIGH-1, poate merge in paralel)
  |
MEDIUM-4  (Google SDK key path audit — independent, fara dependente)
  |
MEDIUM-11 (ECB plausibility band — independent, fara dependente)
```

Rationale: HIGH-1 introduce un fisier nou (`util/streamCap.ts`) pe care testele SOAP il vor importa direct; celelalte 3 finding-uri sunt complet independente si pot merge in orice ordine sau in paralel. Nu exista migration SQL in acest cluster.

---

## HIGH-1 — SOAP body buffering inainte de cap check (OOM risc)

### Problema (verbatim audit)

`backend/src/soap.ts:120-124` apeleaza `await response.text()` **inainte** de a verifica `text.length` impotriva `SOAP_MAX_RESPONSE_BYTES`. Daca PortalJust returneaza un body fara `Content-Length` (chunked) sau cu valoare falsa, intregul payload este materializat in RAM inainte de aruncarea `SoapResponseTooLargeError`. Pe un host server cu 512MB heap si N requesturi concurente, atacatorul poate provoca OOM cu un response forjat.

### Constrangeri

- SOAP cancellation deja existent (AbortSignal extern combinat cu timeout 60s) trebuie pastrat — orice modificare a path-ului fetch trebuie sa propage `signal: combineSignals(signal)`.
- `SOAP_MAX_RESPONSE_BYTES` ramane source of truth (nu inventa noua constanta).
- Cap-ul trebuie aplicat in timpul stream-ului, NU dupa `response.text()`.

### Fix

**Pas 1**: Creeaza `backend/src/util/streamCap.ts` (fisier nou):

```ts
// v2.33.0 — citire HTTP body cu cap aplicat la nivel de stream pentru a preveni
// OOM cand upstream-ul publica chunked encoding fara Content-Length. Cap-ul e
// aplicat dupa fiecare chunk acumulat; abort-ul intrerupe transferul imediat
// (reader.cancel()) si elibereaza socket-ul pentru pool.

export class ResponseTooLargeError extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super(`Response depaseste cap-ul (${bytes} bytes)`);
    this.name = "ResponseTooLargeError";
    this.bytes = bytes;
  }
}

export interface ReadBodyWithCapOptions {
  capBytes: number;
  signal?: AbortSignal;
}

/**
 * Citeste body-ul unui `Response` Fetch ca text, refuzand inca de la primul
 * chunk care depaseste `capBytes`. Daca `signal` e abort-uit in timpul citirii,
 * arunca DOMException("AbortError"). Decoding-ul e UTF-8 streaming (TextDecoder
 * cu stream:true) pentru a evita rebufferirea cumulativa.
 */
export async function readBodyWithCap(
  response: Response,
  { capBytes, signal }: ReadBodyWithCapOptions
): Promise<string> {
  if (signal?.aborted) {
    throw new DOMException("Cerere anulata", "AbortError");
  }

  // Content-Length precheck — daca exista, refuza fara sa atingem socket-ul.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > capBytes) {
    throw new ResponseTooLargeError(declared);
  }

  if (!response.body) {
    // Edge case: response fara body (HEAD-like). Returneaza string gol.
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let accumulated = "";
  let bytesRead = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel("aborted").catch(() => {});
        throw new DOMException("Cerere anulata", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > capBytes) {
        await reader.cancel("response too large").catch(() => {});
        throw new ResponseTooLargeError(bytesRead);
      }
      accumulated += decoder.decode(value, { stream: true });
    }
    accumulated += decoder.decode();
  } finally {
    // reader.releaseLock() nu e necesar — getReader-ul nostru a iesit din scope.
  }

  return accumulated;
}
```

**Pas 2**: Modifica `backend/src/soap.ts` functia `callSoap` (lines 100-134). Inlocuieste blocul de buffering + 2x verificare cu apel la `readBodyWithCap`:

```ts
// import sus, langa alte importuri
import { readBodyWithCap, ResponseTooLargeError } from "./util/streamCap.ts";

async function callSoap(action: string, body: string, signal?: AbortSignal): Promise<string> {
  const envelope = buildEnvelope(action, body);
  const combined = combineSignals(signal);

  const response = await fetch(SOAP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${NS}/${action}"`,
    },
    body: envelope,
    signal: combined,
  });

  let text: string;
  try {
    text = await readBodyWithCap(response, { capBytes: SOAP_MAX_RESPONSE_BYTES, signal: combined });
  } catch (err) {
    if (err instanceof ResponseTooLargeError) {
      console.error(`SOAP response prea mare (streaming): ${err.bytes} bytes (cap ${SOAP_MAX_RESPONSE_BYTES})`);
      throw new SoapResponseTooLargeError(err.bytes);
    }
    throw err;
  }

  if (!response.ok || text.includes("soap:Fault")) {
    const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] ?? "necunoscut";
    console.error("SOAP Fault detalii:", fault);
    throw new Error("Eroare la comunicarea cu serviciul PortalJust.");
  }
  return text;
}
```

**Pas 3**: Pastreaza `SoapResponseTooLargeError` (api publica testata). Sterge cele 2 verificari `text.length > SOAP_MAX_RESPONSE_BYTES` si verificarea pe `content-length` din functia veche — sunt absorbite in `readBodyWithCap`.

### Test plan

**Unit tests** in `backend/src/util/streamCap.test.ts` (fisier nou):

1. `readBodyWithCap` accepta response sub cap → returneaza string-ul.
2. `readBodyWithCap` cu Content-Length > cap → arunca `ResponseTooLargeError` fara sa citeasca stream-ul (verifica ca `body.getReader()` nu a fost apelat).
3. `readBodyWithCap` cu chunked body care depaseste cap → arunca `ResponseTooLargeError` dupa primul chunk care depaseste, cu `bytes >= capBytes + 1`.
4. `readBodyWithCap` cu `signal.aborted = true` la intrare → arunca `DOMException("AbortError")` fara sa atinga body-ul.
5. `readBodyWithCap` cu signal abort-uit la mijlocul citirii → arunca `DOMException("AbortError")` si `reader.cancel()` e apelat (pune un mock pe ReadableStream).

**Integration** in `backend/src/soap.test.ts` (extinde):

6. Mock `fetch` care intoarce response chunked cu 12MB body → `callSoap` arunca `SoapResponseTooLargeError` cu bytes > SOAP_MAX_RESPONSE_BYTES.
7. Mock `fetch` care intoarce 5MB body valid → `callSoap` returneaza string-ul (smoke regression).

### Biome files atinse

```bash
npx biome check --write backend/src/util/streamCap.ts backend/src/util/streamCap.test.ts backend/src/soap.ts backend/src/soap.test.ts
```

### Estimat HIGH-1

~2h (1h cod + 1h teste + run vitest + biome). Risc rupere: redus — `readBodyWithCap` are aceeasi semantica observabila ca `response.text()` pentru body-uri sub cap.

---

## MEDIUM-2 — RNPM runtime validation in fail-open silent mode

### Problema (verbatim audit)

`backend/src/services/rnpmClient.ts:278` verifica `RNPM_RUNTIME_VALIDATION_ENFORCED === "1"` ca **opt-in** pentru a respinge payload-uri RNPM care nu trec validation-ul Zod. In productie standard (env-var lipsa), validation-ul esueaza silent: `console.warn` + return `raw as RnpmSearchResult` — orice schimbare upstream (de la mj.rnpm.ro) trece neobservata pana cand un downstream face cast invalid.

### Constrangeri

- Comportamentul implicit trebuie **inversat** la fail-closed (default = enforce). Daca un upstream rupe schema, primim 502 explicit, nu silent corruption.
- Un opt-out (`DISABLED=1`) trebuie sa ramana disponibil pentru un eventual hotfix in productie cand schema noastra are bug si payload-ul real e corect.
- Boot-ul trebuie sa logheze warning vizibil daca opt-out-ul e activ, plus audit event `rnpm.validation.disabled`.

### Fix

**Pas 1**: Modifica `backend/src/services/rnpmClient.ts:273-282`:

```ts
    const parsed = RnpmSearchResultSchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors = JSON.stringify(parsed.error.flatten().fieldErrors).slice(0, 500);
      console.warn("[rnpm] runtime validation failed pe payload search:", fieldErrors);
      // v2.33.0: inversat la fail-closed. Default = arunca; opt-out doar la
      // hotfix prin RNPM_RUNTIME_VALIDATION_DISABLED=1.
      if (process.env.RNPM_RUNTIME_VALIDATION_DISABLED === "1") {
        return raw as RnpmSearchResult;
      }
      throw new RnpmError("Raspunsul RNPM nu respecta schema asteptata.", 502, undefined, "schema_violation");
    }
    return parsed.data as unknown as RnpmSearchResult;
```

**Pas 2**: La boot, in `backend/src/index.ts` (langa alte boot-time warnings — gaseste blocul existent de env-var checks), adauga:

```ts
if (process.env.RNPM_RUNTIME_VALIDATION_DISABLED === "1") {
  console.warn(
    "[boot] RNPM runtime validation DISABLED via env (RNPM_RUNTIME_VALIDATION_DISABLED=1). " +
      "Schema mismatch din mj.rnpm.ro va fi tolerat silent. Folosit doar pentru hotfix."
  );
  // Audit: marcheaza decizia operationala intr-un rand owner_id NULL (system event).
  recordAudit(null, "rnpm.validation.disabled", {
    metadata: { reason: "env_opt_out", source: "boot" },
  });
}
```

**Pas 3**: Sterge orice referinta la `RNPM_RUNTIME_VALIDATION_ENFORCED` din docs / `.env.example`. Adauga `RNPM_RUNTIME_VALIDATION_DISABLED` cu nota `OPTIONAL — hotfix only`.

### Test plan

**Unit tests** in `backend/src/services/rnpmClient.test.ts` (extinde):

1. Mock `fetch` cu payload invalid + env-var unset → arunca `RnpmError` cu `errorKind: "schema_violation"`.
2. Mock acelasi payload + `RNPM_RUNTIME_VALIDATION_DISABLED=1` (`vi.stubEnv`) → returneaza raw fara throw, log de `console.warn` capturat.
3. Mock payload valid + env-var unset → returneaza parsed.

### Biome files atinse

```bash
npx biome check --write backend/src/services/rnpmClient.ts backend/src/index.ts backend/src/services/rnpmClient.test.ts
```

### Estimat MEDIUM-2

~45 min (10 min cod + 30 min teste + boot smoke).

---

## MEDIUM-4 — Google SDK key in query string (in URL/log)

### Problema (verbatim audit)

`backend/src/services/keyValidation.ts:88-93` foloseste `?key=${encodeURIComponent(value)}` pentru validare API key Google. URL-ul ajunge in:

- Logs HTTP server-side (proxy reverse, anything care logheaza request URL).
- Stack traces ale `fetch` la timeout / connection refused.
- DNS poate sa nu retina query string-ul, dar TLS SNI hostname expune doar host, NU query string — risc redus, dar dac log proxying e activ, query string e leak-uit pe disk.

Google API accepta `x-goog-api-key` header pentru toate endpoint-urile API key public; header-ul nu apare in URL.

### Constrangeri

- Comportamentul observabil al `validateKey({ field: "google", value })` ramane identic — return `Response` din `fetch` cu acelasi semantic (200 = valid, 401/403 = invalid, etc.).
- Nu schimba structura functiei sau signatura.

### Fix

`backend/src/services/keyValidation.ts:88-93` devine:

```ts
  if (field === "google") {
    return fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      method: "GET",
      headers: { "x-goog-api-key": value },
      signal,
    });
  }
```

### Test plan

**Unit tests** in `backend/src/services/keyValidation.test.ts` (extinde):

1. Spy `fetch` cu valid Google response (200) → verifica URL-ul **NU contine** `?key=`, verifica header `x-goog-api-key` egal cu value.
2. Spy `fetch` cu 401 → return-ul propaga response-ul (nu schimbi semantic-ul de validare upstream).

### Biome files atinse

```bash
npx biome check --write backend/src/services/keyValidation.ts backend/src/services/keyValidation.test.ts
```

### Estimat MEDIUM-4

~30 min (5 min cod + 20 min teste).

---

## MEDIUM-11 — ECB rate fara plausibility band

### Problema (verbatim audit)

`backend/src/services/fxFetcher.ts:30-46` (functia `parseEcbFeed`) accepta orice rate `> 0` pentru EUR/USD. Daca ECB publica eronat 0.0001 sau 9999 (a fost si in trecut un incident pe trade currencies exotice), aplicatia primeste un cap absurd in EUR. D14 fail-closed ramane respectat (nu folosim 0.92 fallback), dar valoarea acceptata e folosita imediat in `quotaService.dailyEurUsdRate()`.

### Constrangeri

- Banda de plausibilitate trebuie sa fie configurabila prin env (`FX_PLAUSIBLE_EUR_USD_MIN`, `FX_PLAUSIBLE_EUR_USD_MAX`), cu default 0.5..2.0 (extrem de larg pentru EUR/USD istoric: 0.85..1.60 ultimii 30 ani).
- `FxFetchResult` trebuie sa expuna `reason: "implausible_rate"` + `observedRate` astfel incat dashboard-ul sa afiseze diagnostic clar (nu doar "EUR indisponibil").
- Comportamentul `parseEcbFeed` ramane pur (fara env access in pure-function); validation-ul intra in `fetchEcbDailyRates`.

### Fix

**Pas 1**: Extinde `FxFetchResult`:

```ts
export interface FxFetchResult {
  ok: boolean;
  pair?: "USD/EUR";
  rate?: number;
  rateDate?: string;
  reason?: string;
  observedRate?: number; // populated cand reason === "implausible_rate"
}
```

**Pas 2**: In `fetchEcbDailyRates`, dupa `parseEcbFeed`, adauga plausibility check inainte de `computeUsdToEur` (sub `lines 67-72`):

```ts
    const parsed = parseEcbFeed(xml);
    if (!parsed) {
      return { ok: false, reason: "parse_failed" };
    }

    const minBand = Number(process.env.FX_PLAUSIBLE_EUR_USD_MIN ?? "0.5");
    const maxBand = Number(process.env.FX_PLAUSIBLE_EUR_USD_MAX ?? "2.0");
    if (
      !Number.isFinite(minBand) ||
      !Number.isFinite(maxBand) ||
      parsed.eurUsdRate < minBand ||
      parsed.eurUsdRate > maxBand
    ) {
      console.error(
        `[fx] ECB rate implauzibil: EUR/USD=${parsed.eurUsdRate} (banda [${minBand}, ${maxBand}])`
      );
      return { ok: false, reason: "implausible_rate", observedRate: parsed.eurUsdRate };
    }

    const usdToEur = computeUsdToEur(parsed.eurUsdRate);
    upsertFxRate({ pair: "USD/EUR", rate: usdToEur, rateDate: parsed.rateDate, source: "ecb" });
    return { ok: true, pair: "USD/EUR", rate: usdToEur, rateDate: parsed.rateDate };
```

**Pas 3**: Dashboard / `/api/v1/admin/quota` care expune ultimul status FX trebuie sa includa `reason` + `observedRate` daca exista (verifica `quotaController` sau echivalent — daca path-ul nu expune `FxFetchResult`, e suficient ca log-ul server-side sa fie clar; nu adauga UI nou doar pentru asta).

### Test plan

**Unit tests** in `backend/src/services/fxFetcher.test.ts` (extinde):

1. Mock fetch cu XML valid + rate `0.85` → `ok: true`, fara `reason`.
2. Mock fetch cu XML valid + rate `0.0001` → `ok: false`, `reason: "implausible_rate"`, `observedRate: 0.0001`. Verifica `upsertFxRate` NU a fost apelat.
3. Mock fetch cu XML valid + rate `2.5` (peste max default 2.0) → `ok: false`, `reason: "implausible_rate"`, `observedRate: 2.5`.
4. `FX_PLAUSIBLE_EUR_USD_MAX=3.0` + rate `2.5` → `ok: true` (env override functioneaza).

### Biome files atinse

```bash
npx biome check --write backend/src/services/fxFetcher.ts backend/src/services/fxFetcher.test.ts
```

### Estimat MEDIUM-11

~45 min (15 min cod + 25 min teste).

---

## Checklist pre-push

```bash
# 1. Biome — toate fisierele atinse in cluster
npx biome check --write \
  backend/src/util/streamCap.ts \
  backend/src/util/streamCap.test.ts \
  backend/src/soap.ts \
  backend/src/soap.test.ts \
  backend/src/services/rnpmClient.ts \
  backend/src/services/rnpmClient.test.ts \
  backend/src/index.ts \
  backend/src/services/keyValidation.ts \
  backend/src/services/keyValidation.test.ts \
  backend/src/services/fxFetcher.ts \
  backend/src/services/fxFetcher.test.ts

# 2. Type-check
npx tsc --noEmit -p backend/tsconfig.json

# 3. Build
npm run build

# 4. Tests (backend complet — testele SOAP touch hot path)
npm test --workspace=backend

# 5. Manual smoke (desktop)
#   - Lanseaza electron:dev
#   - Verifica search SOAP normal (nu se rupe pe response sub cap)
#   - Verifica RNPM search (nu se rupe pe payload valid)
#   - Verifica AI key validation Google (Settings -> Validate -> 200 OK)
```

---

## Constrangeri NON-NEGOTIABLE re-confirmate

- `SoapResponseTooLargeError` ramane in API public (testat downstream).
- `RNPM_RUNTIME_VALIDATION_ENFORCED` nu mai are efect dupa v2.33.0 — nu deprecated wrapper, doar removed; release notes mentioneaza explicit.
- D14 fail-closed EUR ramane: orice esec ECB (inclusiv `implausible_rate`) inseamna `ok: false`, UI afiseaza "EUR indisponibil", quota service ramane pe ultima valoare cunoscuta din `fx_rates`.
- Captcha keys / API keys NU se logheaza in audit (boot warning pentru RNPM e doar despre flag-ul de validare, nu despre vreo cheie).

---

## Risk surface

| Modificare | Blast radius | Rollback |
|------------|--------------|----------|
| streamCap helper + soap wiring | SOAP requests (hot path desktop) | revert soap.ts; util/streamCap.ts ramane unused → safe |
| RNPM flag invert | productie web (default fail-closed) | set `RNPM_RUNTIME_VALIDATION_DISABLED=1` |
| Google header swap | only key validation flow | revert single fetch call |
| ECB plausibility band | quota dashboard FX status | set `FX_PLAUSIBLE_EUR_USD_MIN=0`, `FX_PLAUSIBLE_EUR_USD_MAX=999` |

Toate cele 4 sunt rollback-able prin env override, fara redeploy de cod.
