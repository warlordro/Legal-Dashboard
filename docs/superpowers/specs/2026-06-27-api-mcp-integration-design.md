# API programatic + MCP — Design piesa A (FINAL, rev. 2 post review adversarial)

**Status:** spec final pentru **piesa A** (fundatia API + PAT). Design aprobat 2026-06-28; rev. 2 incorporeaza review-ul adversarial multi-model (5 modele + sinteza Opus 4.8).
**Data:** 2026-06-27 (draft) → 2026-06-28 (finalizat + review adversarial).
**Urmatorul pas:** skill `writing-plans` → plan de implementare. Userul face dispatch-ul de implementare catre Codex.

Piesa B (MCP stdio) si piesa C (MCP remote + OAuth 2.1) au spec-uri separate, ulterioare. Acest fisier acopera DOAR piesa A.

---

## 1. Obiectiv

Expune capabilitatile aplicatiei (cautare dosare+termene, ICCJ, RNPM) catre un **mediu AI extern** (Claude Desktop, Claude.ai, ChatGPT) prin **MCP**, plus un **API standalone reutilizabil** pentru alte integrari (MCP fiind primul consumator).

## 2. Decizii blocate (confirmate cu userul)

Deployment: **web hosted, multi-user** (`auth_mode=web`, Google SSO via oauth2-proxy).

Capabilitati expuse: **dosare+termene, ICCJ, RNPM**. Monitorizare/alerte EXCLUSE. Doar citire/query, fara scriere.

Mod de conectare: **ambele** — connector remote (OAuth) pentru Claude.ai/ChatGPT SI MCP local stdio (PAT) pentru Claude Desktop.

Mecanism auth pentru API: **PAT opac + scopes**.

Secventiere: spec doar pentru **piesa A** acum; livram **A + B** primele; **C** e spec separat ulterior.

**Decizii de design piesa A (2026-06-28):**
- Scopes: **3** (`dosare` incl. termene, `iccj`, `rnpm`).
- Expirare token: **optionala in UI** (default fara expirare; user-ul poate alege 30/90/365 zile pentru tokenuri sensibile).
- Model de acces PAT: **default-deny** + **read-only la nivel de metoda** (PAT ajunge DOAR pe rute (metoda, path) explicit allowlistate).
- Export (Excel/PDF): **exclus** din PAT; plus **page size plafonat server-side** (anti "export mascat").
- Captcha RNPM per-token: **nelimitat din start** + **plafon optional** per-token (camp la creare); contorizare **atomica** cand plafonul e setat.
- ICCJ: **circuit-breaker cu contorizare separata pe clasa de apelant** (UI/monitoring/PAT) + limita per-token; fara cap global de rata.
- Load-more & rezultate (A5.6): dosare = auto in stratul MCP pana la `MAX_SOAP_FANOUT` (cel mult un prompt catre user peste), cu `exactMatch` + `calitate` per parte; RNPM = **complet automat pana la plafon, fara confirmare** (rol = debitor/creditor, fara identificare de parte).
- Audit: **da** — jurnal append-only creare/folosire/revocare token (IP + user-agent).
- Protectii anti-scurgere: **buton "revoca toate"**, **alerta la folosire din IP/device nou**, expirare optionala (mai sus). FARA re-auth/step-up la creare (decizie user).
- Adrese API: **documentam caile existente** (fara redenumire sub `/v1/`).

## 3. Descoperiri cheie in cod (grounding)

**RNPM in web mode NU mai e blocat.** `resolveCaptchaKeyForRoute` ([rnpmGuards.ts:192](../../../backend/src/routes/rnpmGuards.ts#L192)) foloseste cheia captcha tenant (v2.30.0) + cota per-user `captcha.rnpm` (v2.34.0). 501 doar daca nicio cheie tenant. RNPM e doar inca un tool call.

**Cusatura auth.** [authProvider.ts:60](../../../backend/src/auth/authProvider.ts#L60) `WebJwtAuthProvider`: `readRequestToken` citeste Bearer **sau** cookie; rezolva `ownerId = user.id`. PAT se plugheaza prin dispatch pe prefix; derivarea `owner_id` ramane identica. **Verificare obligatorie la implementare (A8):** enumera toti pasii de owner/role/session resolution pe calea JWT si confirma ca PAT-ul ii replica pe toti (nu doar `getUserById` + `status`).

**Fara login first-party.** `/auth/login` → 501; JWT web mintit de `/auth/oauth2/sync` sau `/auth/refresh`. MCP nu poate face dansul OAuth interactiv → are nevoie de PAT (A) / AS (C).

**Montare rute** [index.ts:314-348](../../../backend/src/index.ts#L314-L348): cele 3 domenii + `/api/ai`, `/api/v1/me`, `/api/v1/dashboard`, `/api/v1/monitoring`, `/api/v1/alerts`, `/api/v1/name-lists`, `/api/v1/admin` — toate sub aceeasi auth globala. De aici default-deny (A5.0).

**Rate limiter** [rate-limit.ts:51](../../../backend/src/middleware/rate-limit.ts#L51): Map in-memory `ip|ownerId`, 120/min, cu sweep. **`preAuthRateLimit`** (IP-only, 60/min, [rate-limit.ts:133](../../../backend/src/middleware/rate-limit.ts#L133)) ruleaza inainte de auth si opreste flood-urile cu token invalid INAINTE de lookup DB — acopera partial DoS-ul "SHA-256 + DB per request invalid". Per-token (A5.2) se aplica DUPA rezolvarea PAT.

**originGuard** [originGuard.ts:41](../../../backend/src/middleware/originGuard.ts#L41): respinge POST/PUT/PATCH/DELETE non-loopback fara Origin/Referer egal cu Host. Bypass-ul PAT trebuie pe **auth PAT reusit**, nu pe prezenta header-ului (A5.1).

**Captcha quota** [rnpmGuards.ts:92-133](../../../backend/src/routes/rnpmGuards.ts#L92-L133): per-`ownerId` in `captcha_usage`, rolling window, record-and-accept (overcount, niciodata undercount). Per-token (A5.3) extinde cu `token_id` + contorizare atomica cand plafonul e setat.

**ICCJ client** [iccjClient.ts](../../../backend/src/services/iccj/iccjClient.ts): concurrency caps per-search + session single-flight, dar **niciun throttle/breaker global** intre apelanti. De aici A5.4.

**Email infra** exista (`owner_email_settings`, mailer pentru alerte monitoring) → reutilizat pentru alerta de IP/device nou (A6).

CORS dev-only; productie same-origin.

## 4. Decomposition (3 piese)

**Piesa A — Fundatia: API programatic + PAT** (acest spec).
**Piesa B — Server MCP stdio** (adaptor subtire peste API, PAT in config). Fast-follow.
**Piesa C — MCP remote (Streamable HTTP) + OAuth 2.1.** Authorization Server complet (RFC 8414/7591/PKCE). Grosul proiectului. Spec separat.

## 5. Controale anti-abuz (rezumat; detaliu in A5)

Lentila: *ce poate face un token scurs?* (atenuat acum de expirarea optionala, dar tot tratat ca permanent in worst-case). Controale: default-deny + read-only pe metoda (A5.0), originGuard bypass pe auth reusit (A5.1), rate-limit per-token (A5.2), plafon captcha optional + atomic (A5.3), ICCJ breaker per-clasa-apelant (A5.4), page-size cap server-side (A5.5). Plus audit log + alerta IP nou + revoke-all (A6).

## 6. Design piesa A — TRANSA 1

**A1. Scop.** API via PAT pentru 3 domenii de citire, doar web mode. Desktop ZERO impact (calea PAT activa doar cand `getAuthMode()==="web"`; rute montate conditionat la boot, nu doar gate-uite per-request — A8).

**A2. Model token + stocare.** Tabela `api_tokens` (migration 0039), `owner_id` = userul detinator:
`id` (uuid) · `owner_id` · `name` · `token_hash` (SHA-256 hex, indexat) · `token_prefix` (afisare DOAR inceput, ex. `ld_pat_AbCd…`, fara coada) · `scopes` (TEXT CSV, dar **parsat in set cu membership exact** la enforcement, niciodata `.includes()` pe string) · `captcha_daily_cap` (INTEGER nullable; A5.3) · `created_at` · `expires_at` (nullable; setabil din UI la 30/90/365 sau null) · `last_used_at` (nullable, throttled ~60s) · `last_used_ip` (nullable) · `last_used_ua` (nullable) · `revoked_at` (nullable).
Format token: `ld_pat_` + 32 bytes base64url (256-bit), afisat o singura data. Hash SHA-256 (confirmat suficient de panel — brute-force offline infezabil pe 256-bit; bcrypt inutil). Repository nou `apiTokenRepository.ts` (SQL raw doar in `db/`).

Tabela audit `api_token_audit_events` (append-only): `id` · `token_id` · `owner_id` · `actor` (session user / "system") · `event` (`create`|`revoke`|`use`) · `route` · `scope` · `ip` · `user_agent` · `result` · `created_at`. Retentie ~90 zile (purge zilnic, ca `monitoring_runs`).

**A3. Cusatura auth.** Dispatch pe prefix: `ld_pat_` → cale PAT; altfel JWT (neschimbat). Cale PAT: `sha256(token)` → lookup → `revoked_at IS NULL` + `expires_at` neexpirat → `getUserById(owner_id)` → `status="active"` → `AuthenticatedContext { ownerId, tokenScopes, tokenId }`. Validare DB per-request **fara cache pozitiv** (revoke instant — confirmat corect de panel). Erori cu **timing constant-ish** + mesaj generic 401 (anti-enumerare). Contract: invalid/revocat/expirat → **401 `invalid_token`**; token valid fara scope / ruta nepermisa → **403 `insufficient_scope`/`pat_route_forbidden`**. Pe `use`, scrie throttled `last_used_at/ip/ua` + event audit (prima folosire/zi sau esantion).

**A4. Scope + metoda (read-only enforcement).** `PAT_CAPABILITIES` = allowlist explicit de tuple `(method, pathPrefix, scope)` — single source of truth pentru gate. PAT-ul ajunge DOAR pe GET + cele cateva POST-uri de cautare verificate (CORECTIE post-review: **RNPM search e POST; ICCJ search (dosare-iccj/termene-iccj) e GET**; dosare/termene GET). Orice handler care accepta scriere (POST/PUT/PATCH/DELETE ne-allowlistat) sub cele 3 prefixe → respins pentru PAT, chiar daca path-ul se potriveste. `tokenScopes` undefined (JWT/desktop) → permite; definit → trebuie sa contina scope-ul. Allowlist-ul se revizuieste la fiecare ruta noua.

## 7. Design piesa A — TRANSA 2

### A5. Controale anti-abuz

**A5.0 — Default-deny pentru PAT, cu matching corect pe granita de segment.** [CRITICAL fix din review] `/api/dosare` e prefix textual al lui `/api/dosare-iccj` → un `startsWith` naiv ar lasa un token `dosare` sa atinga ICCJ si ar auto-admite orice `/api/dosare-*` viitor. Matching pe **granita de segment**: `path === prefix || path.startsWith(prefix + "/")`. Gate global dupa auth, pe **path-ul canonic normalizat al lui Hono** (`c.req.path`); **respinge slash/dot-segmente encodate** (`%2F`, `%2e`, `..`, trailing slash ambiguu, case) INAINTE de authz. PAT (`tokenId` setat) + nicio capabilitate `(method, prefix, scope)` matchuita → **403 `pat_route_forbidden`**. JWT/desktop trec neatins. Test de acoperire: fiecare ruta × fiecare scope, plus `/api/dosare` vs `/api/dosare-iccj`, `%2F`, `..`, trailing slash, mixed case.

**A5.1 — originGuard bypass pe auth PAT reusit (NU pe prezenta header-ului).** [fix conflict din review] Bypass-ul se aplica DOAR dupa ce auth a reusit cu un `tokenId` valid, nu pe simpla prezenta a `Authorization: Bearer`. Bearer invalid → **401 imediat, FARA fallback pe cookie** (altfel `Bearer garbage` + cookie ambient ar reintroduce CSRF). Cookie-ul JWT ramane origin-checked. Test regresie: `Authorization: Bearer garbage` + cookie valid → respins. Assert: CORS dev nu permite niciodata `Authorization` cross-origin cu credentials.

**A5.2 — Rate limit per-token.** Map separat cheie `tok|<tokenId>`, plafon mai strans decat per-user, doar pe calea PAT (dupa rezolvare). Configurabil prin env. Flood-urile cu token invalid sunt deja oprite de `preAuthRateLimit` (IP) inainte de lookup DB.

**A5.3 — Captcha RNPM: nelimitat default + plafon optional per-token, contorizare atomica.** Default = fara plafon separat; mosteneste bugetul per-user `captcha.rnpm`. `captcha_daily_cap` (nullable) pe `api_tokens`: setat = cap rolling 24h SUB bugetul per-user. Cand e setat, enforcement **atomic** (race fix din review): `BEGIN IMMEDIATE` → `count(token_id, window) < cap` → insert conditional, stari reserved→charged→failed (nu "count-then-accept"). `token_id` nullable pe `captcha_usage`. Risc rezidual asumat de user: fara plafon + fara buget per-user + token scurs = drenare pana la revoke (mitigat de revoke instant, alerta IP nou, audit). Doc: interactiunea buget partajat web+PAT (un PAT scurs poate bloca si RNPM-ul legitim al owner-ului — self-DoS acceptat).

**A5.4 — ICCJ: circuit-breaker cu contorizare separata pe clasa de apelant.** [fix DoS din review] Breaker global wrap pe `searchIccj`/`fetchIccjDetail`/`searchSedinteIccj`, dar **contorizarea erorilor e separata pe clasa (UI / monitoring / PAT)** sau erorile induse de PAT au pondere mai mica — un PAT in bucla NU mai poate tranti breaker-ul pentru UI+monitoring. Limita ICCJ per-token calibrata explicit SUB pragul 429 al scj.ro. Half-open = **single-flight probe cu jitter controlat de sistem**, nu de cererile atacatorului. Prioritate UI/monitoring peste PAT. Fara cap global de rata.

**A5.5 — Page-size / query-complexity cap server-side.** [anti "export mascat" din review] Un PAT nu poate cere `limit=1000000` ca sa goleasca DB-ul ocolind decizia "fara export". Max page size impus server-side (ignora override-ul clientului), plus caps de complexitate/interval de date unde se aplica.

**A5.6 — Paginare, load-more & imbogatire rezultate.** Server stateless: fiecare cautare intoarce un bloc marginit + `total`, `hasMore` (sau cursor / `nextRnpmPage`), niciodata auto-bucla nemarginita pe server. „Load more" NU e portat ca SSE (stream-ul `dosareRouter.post("/load-more")` nu se potriveste cu MCP request/response); pentru PAT exista cautare sincrona care intoarce un bloc + metadate, iar continuarea se face prin re-apel cu cursor/pagina.

Comportament decis (2026-06-28), implementat in stratul MCP (piesa B) peste API:
- **Dosare**: load-more **automat** (AI-ul continua singur) pana la `MAX_SOAP_FANOUT` (institutii × intervale); peste prag, cel mult **un singur prompt** catre user. Raspuns imbogatit: `exactMatch` (potrivire exacta pe numar dosar SAU pe nume parte normalizat dot/case — vezi `stripSearchDots`, [[project_portaljust_search_semantics]]) + `calitate` per parte (reclamant/parat/inculpat/...), derivat din `calitateParte` deja parsat in [soap.ts:193-195](../../../backend/src/soap.ts#L193-L195) — fara fetch suplimentar.
- **RNPM**: load-more **complet automat pana la plafon, FARA sa intrebe**. Plafonul efectiv = `captcha_daily_cap` daca e setat pe token (429 la depasire), altfel plafonul natural per-cautare (RNPM `startRnpmPage<=500` / `pagesTotal`, [rnpm.ts:226](../../../backend/src/routes/rnpm.ts#L226)) + ritmul impus de rate-limit-ul per-token. Rol = dimensiunea de cautare **debitor/creditor**; fara identificare de calitate parte.

**Risc rezidual compus (asumat de user):** token fara `captcha_daily_cap` + auto-spend fara confirmare = o cautare RNPM mare poate consuma tacit captcha pana la plafonul natural. Mitigat de: rate-limit per-token (paceaza rafala), plafon optional la creare, buget per-user `captcha.rnpm`, audit + alerta IP nou, revoke instant.

**Decizii adiacente (folosite peste tot).** Body-size limit pe rutele PAT (4-16KB, ca pattern-ul existent) + read timeout. HTTPS-only pentru PAT in productie (respinge PAT peste non-TLS). Redactare `Authorization` din loguri/proxy (logheaza doar `token_prefix`/`tokenId` mascat). `Cache-Control: no-store` pe raspunsurile PAT (date juridice nu trebuie cache-uite de intermediari/LLM context store). Validare token DB per-request fara cache pozitiv → revoke instant. Revocare: pe raspunsuri scurte request/response efectul e imediat; PAT nu atinge rute SSE (monitoring exclus), deci fara streaming de terminat.

### A6. Rute + UI management tokenuri

Toate **doar session-auth**, cu guard explicit care respinge PAT-uri (`tokenId` definit → 403 `pat_cannot_manage_tokens`; confirmat corect de panel).

`POST /api/v1/tokens` — creare. Body validat cu schema stricta: `name` (lungime/charset), `scopes` (subset nevid din `{dosare,iccj,rnpm}`, fara duplicate), `captchaDailyCap?` (integer `0..tenantMax` sau null), `expiresInDays?` (`30|90|365|null`). Raspuns: secretul **o singura data** + metadata. Fara re-auth (decizie user).

`GET /api/v1/tokens` — listare owner-scoped, fara secrete: `id, name, scopes, tokenPrefix, createdAt, expiresAt, lastUsedAt, lastUsedIp, captchaDailyCap`.

`DELETE /api/v1/tokens/:id` — revoke owner-scoped, instant. Eveniment audit.

`POST /api/v1/tokens/revoke-all` — buton de panica: revoca toate tokenurile active ale owner-ului. Eveniment audit.

**Alerta IP/device nou:** la un eveniment `use`, daca audit-ul NU contine o folosire anterioara a acestui token din acelasi IP (sau (ip,ua)), trimite email prin infra existenta (`owner_email_settings`/mailer). Audit-ul e sursa detectiei.

Frontend: sectiune "Acces API" in Setari — lista tokenuri (cu ultima folosire + IP), buton creare (modal cu secret afisat o data + copy; campuri optionale "expira in" si "max captcha/zi"), buton revocare per rand, buton "revoca toate".

### A7. Suprafata API + documentatie

Adresele de citire raman cele existente (documentam, NU redenumim). Livrabile:
`/api/v1/openapi.json` — OpenAPI 3.1: cele 3 domenii + rutele de tokenuri, cu (metoda, scope) per ruta.
`API.md` — ghid: obtinere PAT, folosire (`Authorization: Bearer`, HTTPS-only), scopes, exemple request/response, **paginare/load-more** (parametri de continuare + `total`/`hasMore`/`nextRnpmPage`; semantica auto din A5.6), **campuri imbogatite** (`exactMatch` + `calitate` parte la dosare; `debitor/creditor` la RNPM), coduri eroare (`invalid_token` 401, `insufficient_scope`/`pat_route_forbidden` 403, `rate_limited` 429, `quota_exceeded` 429).

### A8. Teste (unit + integration)

hash/verify token; dispatch pe prefix; **default-deny segment-boundary** (`/api/dosare` vs `/api/dosare-iccj`; `%2F`/`..`/trailing slash/case → 403; PAT pe `/api/ai`,`/api/v1/monitoring`,`/api/v1/alerts` → 403; coverage ruta×scope); **read-only pe metoda** (POST de scriere sub prefix → 403); scope enforcement (set membership, nu substring); revocare → 401 imediat (fara cache); revoke-all; expirare (token expirat → 401); per-token rate limit; **plafon captcha atomic** (concurenta nu depaseste cap-ul; gol → doar buget per-user); **breaker ICCJ per-clasa** (PAT nu pica breaker-ul pentru UI/monitoring; half-open single-flight); page-size cap; **paginare/load-more** (bloc marginit + `total`/`hasMore`; cursor/`nextRnpmPage` continua corect; RNPM auto pana la `captcha_daily_cap` → 429 la depasire, fara prompt); **imbogatire** (`exactMatch` pe numar/nume normalizat; `calitate` parte la dosare; debitor/creditor la RNPM); `owner_id` + **paritate completa owner-resolution PAT vs JWT**; originGuard (Bearer valid POST trece; `Bearer garbage`+cookie → respins; cookie POST cross-origin → respins); PAT nu poate manageria tokenuri; audit events scrise pe create/revoke/use; alerta IP nou; HTTPS-only; redactare loguri; `no-store`; timing constant-ish; desktop ZERO impact (rute montate conditionat la boot).

### A9. Out of scope explicit

Piesa B; piesa C; monitorizare/scriere via API; export via PAT; store rate-limit/breaker partajat multi-instanta (in-memory per-instanta OK pentru deploy single-instance SQLite — **constrangere arhitecturala documentata**; reevaluare A5.2/A5.4 la orice scalare orizontala); redenumirea cailor sub `/v1/`; re-auth/step-up la creare token.

## 8. Review adversarial (2026-06-28)

Panel multi-model via `review-panel` (Opus 4.8, GPT-5.5, Kimi K2.7, GLM-5.2, Qwen3.7-max) + sinteza Opus. Raw salvat in `tool-results/`. Verdict: "block pana la 5 HIGH/CRITICAL".

**Incorporate (fix in spec):** segment-boundary matching (CRITICAL, A5.0); read-only pe metoda (A4/A5.0); ICCJ breaker per-clasa (A5.4); captcha atomic (A5.3); originGuard pe auth reusit (A5.1); page-size cap (A5.5); audit log (A2/A6) [decizie user: DA]; expirare optionala (A2/A6) [decizie user]; revoke-all + alerta IP nou (A6) [decizie user]; body-size, HTTPS-only, redactare loguri, no-store, 401/403 contract, prefix doar inceput, scopes ca set, timing constant, input validation, paritate owner-resolution, coverage tests (A5/A7/A8).

**Confirmat suficient de panel (nu schimbam):** SHA-256 fara bcrypt; revoke fara cache pozitiv; PAT respins pe rutele de management.

**Decizie user contra recomandarii panelului:** captcha **nelimitat din start** (panel recomanda default conservator). Risc financiar rezidual asumat explicit; mitigat de plafon optional + revoke + alerta IP + audit.

**Deferat (low / piesa viitoare):** store partajat multi-instanta (A9, doar la scalare); re-auth la creare (decizie user: nu).

## 9. Urmatorii pasi

1. User revede rev. 2 a spec-ului.
2. La aprobare → skill `writing-plans` pentru planul de implementare.
3. User face dispatch-ul catre Codex (branch tinta de stabilit; migration 0039 + tabela audit).
