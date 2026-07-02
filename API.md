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

**Forma canonica a header-ului (importanta pe stack-ul de referinta):** exact `Authorization: Bearer ld_pat_...` —
`Bearer` cu B mare si UN singur spatiu ASCII. Pe deploy-ul de referinta (Caddy + oauth2-proxy, v2.40.1+),
ruta directa de ingress face match pe prefixul exact al valorii; variantele (`bearer` lowercase, tab,
spatii multiple) cad in fluxul de login browser si primesc **302 redirect catre Google**, nu 401.
Daca primesti 302 in loc de raspuns JSON: verifica forma header-ului si ca serverul ruleaza v2.40.1+
(ruta `@pat` din `deploy/Caddyfile`).

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
- **`/api/rnpm/saved`**: obiect paginat brut.
- **`/api/rnpm/search`**: rol = dimensiunea de cautare **debitor/creditor**.
- **Rutele `/api/v1/*` care folosesc `ok()`/`fail()`** (token-management + celelalte v1 cu envelope)
  garanteaza `{ data, error: { code, message }, requestId }`. **Exceptii in `/api/v1/*`:**
  `GET /api/v1/openapi.json` intoarce specul OpenAPI brut (NU envelope), iar rutele de export
  (`/api/v1/dosare/export.xlsx` etc.) intorc binar/stream — deci „`/api/v1/*` = envelope" NU e universal.

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
