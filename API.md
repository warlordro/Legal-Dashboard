# API programatic — Personal Access Token (PAT)

Suprafata API doar-citire pentru **dosare + termene (PortalJust)**, **ICCJ (scj.ro)** si **RNPM**,
folosibila din afara aplicatiei (scripturi, integrari, server MCP). Disponibila **doar in web mode**
(`LEGAL_DASHBOARD_AUTH_MODE=web`); pe desktop suprafata PAT nu e montata.

Specificatia masina-lizibila: **`GET /api/v1/openapi.json`** (OpenAPI 3.1; reachable cu un PAT).

## 1. Obtinerea unui token

UI: **Setari → Acces API → Creeaza token**. Alegi un nume, unul sau mai multe *scopes* si, optional,
o expirare (30/90/365 zile) si un plafon zilnic de captcha. **Secretul (`ld_pat_...`) e afisat o
singura data** — copiaza-l pe loc; nu mai poate fi recuperat (in DB se pastreaza doar hash-ul SHA-256).

Managementul tokenurilor (`/api/v1/tokens*`) e **session-only**: un PAT nu poate crea/lista/revoca
tokenuri (403 `PAT_CANNOT_MANAGE_TOKENS`).

## 2. Folosire

```bash
curl -H "Authorization: Bearer ld_pat_XXXXXXXX..." \
  "https://<host>/api/dosare?numarDosar=4821/3/2024"
```

**HTTPS-only in productie:** o cerere PAT peste HTTP (fara `x-forwarded-proto: https` de la reverse-proxy)
e respinsa cu **426**. Raspunsurile PAT au `Cache-Control: no-store`. Header-ul `Authorization` nu apare
in loguri (logger-ul scrie doar method/path/status).

## 3. Scopes

| Scope    | Acopera                                             | Rute                                                        |
|----------|-----------------------------------------------------|-------------------------------------------------------------|
| `dosare` | Cautare dosare + termene PortalJust                 | `GET /api/dosare`, `GET /api/termene`                       |
| `iccj`   | Cautare dosare + termene ICCJ (scj.ro)              | `GET /api/dosare-iccj`, `GET /api/termene-iccj`             |
| `rnpm`   | Cautare + listare RNPM                              | `POST /api/rnpm/search`, `GET /api/rnpm/saved`              |

Model **default-deny + read-only pe metoda**: un PAT ajunge DOAR pe tuple `(metoda, path, scope)` de mai
sus; orice altceva (inclusiv `/api/ai`, `/api/v1/me`, `/api/v1/admin`, `/api/v1/monitoring`) → **403**.

**Prerechizit scope `rnpm` (PAT-006):** necesita o cheie captcha configurata de admin la nivel de tenant;
altfel rutele RNPM raspund **501 `CAPTCHA_NOT_CONFIGURED`**.

## 4. Paginare — PER ENDPOINT (nu un `page` generic)

- **ICCJ** (`/api/dosare-iccj`, `/api/termene-iccj`): `?page=N` (1–20).
- **RNPM** (`POST /api/rnpm/search`): `startRnpmPage` in body → `nextRnpmPage` in raspuns.
- **Dosare / termene PortalJust**: fara paginare (rezultatul e marginit upstream).
- Listele au `pageSize` plafonat server-side la **200** (un `pageSize` mai mare e clampat, nu respins).

## 5. Forme de raspuns — PER RUTA (important)

Suprafata mixa doua contracte; ramifica pe **status HTTP** + `Retry-After` (uniforme) si citeste `error`
ca `string | { code, message }`:

- **Rute legacy** (`/api/dosare`, `/api/termene`, ICCJ search): succes `{ data, total[, page] }`;
  eroare **`{ error: "<string>" }`** (fara `code`/`requestId`), INCLUSIV pe 503-ul breaker-ului ICCJ.
  Nota OpenAPI: descrierile de raspuns din `openapi.json` (ex. `ICCJ_UNAVAILABLE` pe 503) sunt coduri
  INDICATIVE pentru consumator; corpul REAL pe rutele ICCJ ramane forma legacy `{ error }`, nu envelope-ul.
- **`/api/dosare`** e imbogatit: `{ data, total, exactMatch }`. `exactMatch` e **doar pe numar dosar**
  (match pe nume normalizat e deferat); `parti[].calitateParte` da rolul (reclamant/parat/...).
  Optional apare si `failedInstitutii: string[]` (token-uri de instanta): raspuns 200 cu rezultate
  PARTIALE — instantele listate nu au raspuns si dosarele lor lipsesc din `data`. Cand campul e
  prezent, `total` NU mai garanteaza completitudine (inainte de v2.43.1 acest caz era eroare 500).
  La **doua sau mai multe institutii** selectate, rezultatele sunt deduplicate pe cheia
  `institutie|numar` (schimbare minora fata de concatenarea istorica a raspunsurilor per instanta).
  `exactMatch` e garantat DOAR cand `failedInstitutii` lipseste: un dosar cu numar exact poate
  exista intr-o instanta picata, deci `exactMatch=false` pe raspuns partial nu inseamna absenta certa.
- **`/api/rnpm/saved`**: obiect paginat brut.
- **`/api/rnpm/search`**: rol = dimensiunea de cautare **debitor/creditor**. Implicit raspunsul contine
  lista (`documents`) plus `avizIds` (id-ul din baza pentru fiecare document, `null` unde detaliile nu au
  putut fi aduse) si `detailsFailed`. Cu **`includeDetails: true`** in corpul cererii apare in plus
  **`details[]`** — avizele complete, in **exact aceeasi forma** ca `GET /api/rnpm/saved/{id}`, deci un
  singur parser pentru ambele rute. Detalii in §5b.
- **Rutele `/api/v1/*` care folosesc `ok()`/`fail()`** (token-management + celelalte v1 cu envelope)
  garanteaza `{ data, error: { code, message }, requestId }`. **Exceptii in `/api/v1/*`:**
  `GET /api/v1/openapi.json` intoarce specul OpenAPI brut (NU envelope), iar rutele de export
  (`/api/v1/dosare/export.xlsx` etc.) intorc binar/stream — deci „`/api/v1/*` = envelope" NU e universal.

## 5b. RNPM `POST /api/rnpm/search` — detalii in raspuns si chei de filtrare

### `includeDetails` (din v2.46.0)

Implicit, raspunsul cautarii da doar lista si id-urile; detaliile fiecarui aviz se luau apoi una cate una
prin `GET /api/rnpm/saved/{id}`. Trimite **`"includeDetails": true`** in corpul cererii ca sa le primesti pe
toate dintr-un singur raspuns.

| Aspect | Comportament |
|--------|--------------|
| Activare | **Strict `true` boolean.** `"true"` ca text, `1`, sau campul absent NU activeaza nimic. |
| Fara camp | Raspunsul e **identic** cu cel dinainte de v2.46.0 — `details` nici nu apare. |
| Forma `details[]` | Fiecare element e **exact** obiectul dat de `GET /api/rnpm/saved/{id}`: `{ aviz, creditori, debitori, bunuri, istoric }`. Un singur parser acopera ambele rute. |
| Corelare | **Fa-o pe `aviz.id` contra valorilor din `avizIds`** — asta e mereu corect. NU corela pe pozitie: `details` contine fiecare aviz **o singura data**, iar acelasi aviz poate aparea de doua ori in `avizIds` (registrul poate livra acelasi identificator in doua randuri, si atunci ambele trimit la acelasi rand din baza). Pozitiile ies decalate fara niciun semnal. |
| Ordine | Urmeaza prima aparitie in `avizIds`, adica ordinea documentelor — nu ordinea bazei. |
| Avize fara detalii | **Lipsesc** din `details` (nu apar ca `null`). `details.length` poate fi mai mic decat `documents.length`. Cele care au esuat la aducerea din registru sunt listate in `detailsFailed`; un id prezent in `avizIds` dar absent din `details` **fara** intrare corespunzatoare in `detailsFailed` inseamna ca avizul nu mai era in baza la momentul citirii (sters sau restaurare intre timp) — ia-l cu `GET /api/rnpm/saved/{id}`. |
| Zero avize salvate | `details` e lista goala `[]`, nu camp absent. |
| Esec la citire | `details` **lipseste** din raspuns, restul campurilor raman intacte, statusul ramane 200. Ia detaliile prin `GET /api/rnpm/saved/{id}`. Absenta campului dupa ce l-ai cerut = exact acest caz. |
| Cost | **Zero cereri noi catre RNPM, zero captcha in plus.** Detaliile sunt deja aduse si salvate in timpul cautarii; se citesc din baza locala. |
| Marime | ~4,3 KB per aviz cu detalii complete. La `batchSize` maxim (200) raspunsul ajunge pe la ~860 KB — nu exista plafon server-side pe raspuns si nici trunchiere tacuta. |

Se aplica si pe transportul in flux (`Accept: text/event-stream`): acelasi corp, livrat in evenimentul
`result`. **Doar pe `/api/rnpm/search`** — `/api/rnpm/bulk` si `/api/rnpm/search-split` ignora campul.

### Chei de filtrare pe rol — scrierea conteaza

Cheile din `params` sunt copiate dupa cele ale registrului RNPM, deci **majusculele nu sunt uniforme**.
O cheie scrisa gresit e **ignorata in tacere**: filtrul nu se aplica, raspunsul contine tot, si nu primesti
niciun avertisment. Verifica scrierea caracter cu caracter.

| Rol | Cheia exacta | Subcampuri |
|-----|--------------|------------|
| Creditor persoana juridica | `creditorPJ` | `denumire`, `regCom` (**`r` mic**), `CUI` |
| Creditor persoana fizica | `CreditorPF` (**`C` mare**) | `nume`, `prenume`, `CNP` |
| Debitor persoana juridica | `debitorPJ` | `denumire`, `RegCom` (**`R` mare**), `CUI` |
| Debitor persoana fizica | `debitorPF` (**`d` mic**) | `nume`, `prenume`, `CNP` |

Semnul ca filtrul a fost aplicat: numarul de rezultate scade fata de aceeasi cautare fara filtru.

## 6. Coduri de eroare

| Status | Cod / forma                                        | Cand                                                            |
|--------|----------------------------------------------------|----------------------------------------------------------------|
| 401    | `invalid_token` (**lowercase**, house style)       | Token invalid/revocat/expirat sau user inactiv                 |
| 403    | `PAT_ROUTE_FORBIDDEN` / `INSUFFICIENT_SCOPE`       | Ruta/metoda nepermisa, sau scope lipsa                         |
| 403    | `PAT_CANNOT_MANAGE_TOKENS`                          | PAT pe rutele `/api/v1/tokens*`                                |
| 426    | —                                                  | PAT peste non-HTTPS in productie                               |
| 429    | `rate_limited` / `QUOTA_EXCEEDED` (+ `Retry-After`)| Rate-limit per-token sau plafon captcha atins                  |
| 501    | `CAPTCHA_NOT_CONFIGURED`                            | Scope `rnpm` fara cheie captcha tenant                         |
| 503    | `ICCJ_UNAVAILABLE` (`{ error }`) / captcha-retry   | Circuit-breaker ICCJ deschis / rezervare captcha indisponibila |

Nota: 401 e lowercase by design (`AuthenticationError`); 403/429 sunt uppercase (`ErrorCodes`) — split intentionat.

## 7. Igiena tokenurilor

Revoca imediat un token compromis din **Setari → Acces API** (efect instant — validare DB per-request,
fara cache). Butonul **„Revoca toate"** revoca tot. La folosire dintr-un **IP nou** primesti un email de
alerta (daca ai o adresa configurata in Setari email).
