# BASELINE-DELTA — audit main GitLab vs. prerechizite v2.41/v2.42

**Data auditului**: 2026-07-06. **Commit auditat**: `6f326e4` (main).
**Referinta**: GHID-IMPLEMENTARE-GITLAB-v2.41-v2.42.md, Sectiunea 2.0 (MR 0).

Metodologie: sondele A-F au fost rulate DINAMIC pe un backend local pornit in mod web
(`NODE_ENV=production`, DB izolata in afara repo-ului, secrete generate din RNG criptografic,
admin seed-uit cu `scripts/seed-admin.mjs`), plus verificare statica pe cod unde sonda o cere.

## Rezultatele sondelor

| # | Capabilitate | Verdict | Dovada |
|---|--------------|---------|--------|
| A | Nucleu web auth (AUTH_MODE=web, ownerContext fail-closed, JWT) | PREZENT | `GET /api/v1/me` fara cookie → 401 envelope `{data:null, error:{code:"unauthorized"}, requestId}` |
| B | JWT `jti` + denylist (migration 0038) | PREZENT | `MAX(version)=39` in `_schema_versions`; tabela `jwt_denylist` exista |
| C | Chei tenant criptate + rute admin/keys | PREZENT | `GET /api/v1/admin/keys` cu Bearer admin → 200 cu inventar complet (anthropic/openai/google/openrouter/twocaptcha/capsolver + captcha provider/mode); `PUT /keys/anthropic` cu cheie falsa → 422 `INVALID_KEY` (validare live la provider — comportament corect) |
| D | Subsistem PAT (v2.40.0, migration 0039) | PREZENT SI FUNCTIONAL | `POST /api/v1/tokens` (admin) → 201 cu secret `ld_pat_...` afisat o data; PAT scope `rnpm`: `GET /api/rnpm/saved` → 200; `GET /api/dosare` → 403 `INSUFFICIENT_SCOPE`; `GET /api/v1/tokens` cu PAT → 403 `PAT_CANNOT_MANAGE_TOKENS`; `GET /api/v1/admin/keys` cu PAT → 403 `PAT_ROUTE_FORBIDDEN`; `ApiAccessPanel.tsx` exista in frontend |
| E | Bridge oauth2-proxy (`POST /api/v1/auth/oauth2/sync`) | PREZENT, cu delta de contract (vezi mai jos) | Basic + `X-Forwarded-Email` → 200 + `Set-Cookie: legal_dashboard_session=...`; include fix-urile recente de productie (Basic auth `--pass-basic-auth`, fallback `X-Forwarded-Email`) |
| F | Rate limiting pre-auth + per-owner, secureHeaders, LAN bind opt-in | PREZENT | `backend/src/index.ts`: `preAuthRateLimit` + `rateLimit` + `secureHeaders` + lant PAT interleaved (patUsageAudit → patSecurity → rateLimit → patCapabilityGate); LAN bind gardat pe `LEGAL_DASHBOARD_ALLOW_REMOTE=1` |

Suplimentar (fundatia MR 3, verificata pentru ca planul Etapei 1 se sprijina pe ea):
`GET /api/v1/me/key-status` exista si intoarce EXACT contractul din ghid:
`{authMode:"web", tenantKeysConfigured:{anthropic,openai,google,openrouter,captcha}}`.

**Concluzie generala**: main-ul GitLab ESTE la v2.40.0 complet (sync `update/v2.40.0-from-cezar-build`
plus hotfix-urile Dokploy/oauth2-proxy). Niciun STOP; nu e nevoie de portari masive.
Sondele au gasit un singur delta de contract de portat (0a) si o cauza probabila,
operationala (nu de cod), pentru raportul "PAT-urile nu merg" (vezi mai jos).

## Delta 0a — bridge: identitate fail-closed pe headere conflictuale (DE PORTAT)

`backend/src/routes/auth.ts` (linia ~227) citeste azi:
`x-auth-request-email` cu prioritate, `x-forwarded-email` ca fallback, fara nicio
verificare de conflict. Contractul din ghid (2.0.2, pct. 4) cere:

1. prioritate inversata: `x-forwarded-email` e headerul REAL trimis de oauth2-proxy
   (`--pass-user-headers`); `x-auth-request-email` ramane acceptat ca fallback;
2. fail-closed pe ambiguitate: daca AMBELE headere sosesc cu valori diferite →
   400 `missing_identity` + audit reason `conflicting_identity_headers`.

Portat in acest MR (commit separat 0a), cu teste. Nota din ghid ramane valabila:
lookup-ul pe email brut trim/lowercase se muta pe `canonicalizeEmail` partajat abia in MR 5.

## Constatare operationala — cauza probabila pentru "PAT-urile nu functioneaza pe GitLab"

Codul PAT e complet functional local. DAR: `patSecurity` (backend/src/middleware/patSecurity.ts)
respinge cu **426 `PAT_ROUTE_FORBIDDEN` "PAT necesita HTTPS."** orice request PAT cand
`NODE_ENV=production` si headerul `x-forwarded-proto` nu e exact `https`
(escape hatch: `LEGAL_DASHBOARD_PAT_ALLOW_HTTP=1`).

Reprodus local: PAT valid, ruta in scope → 426 fara `x-forwarded-proto: https`;
aceeasi cerere cu headerul setat → 200.

Asta e EXACT clasa de problema din cele doua hotfix-uri recente de productie
(headere care nu supravietuiesc lantului Traefik → oauth2-proxy → backend:
`X-Proxy-Auth` niciodata injectat, `X-Auth-Request-Email` niciodata forward-uit).
Ipoteza: pe deploy-ul Dokploy, requesturile PAT ajung la backend fara
`x-forwarded-proto: https` (sau nu ajung deloc, dacă oauth2-proxy nu are skip-auth
pe calea Bearer), deci primesc 426/401 desi tokenul e valid.

**Actiune**: verificare pe deploy (audit_log: cauta `pat` cu outcome denied si status 426),
NU modificare de cod in acest sprint — infra e out-of-scope (Regula 0.1). Daca se confirma,
fixul e de configurare proxy (forward `X-Forwarded-Proto`) sau, ca ultima solutie,
`LEGAL_DASHBOARD_PAT_ALLOW_HTTP=1` in env-ul backend-ului (TLS-ul ramane garantat la edge).

## Ce lipseste si e planificat oricum (nu blocheaza MR 0)

| Lipsa | Acoperit de |
|-------|-------------|
| `scripts/dev-web-proxy.mjs` + `scripts/dev-web-local.ps1` (mediu local web) | MR 1 |
| Tot scope-ul v2.41.0 (layout web, chei tenant in frontend, UX cote) | MR 2-4 |
| Tot scope-ul v2.42.0 (users management, /setari, pool "ai", consum, audit xlsx, Sonnet 5, UX nivel 1+2; migratiile 0040/0041/0042) | MR 5-12 |

## Mediu de verificare folosit

Backend `dist-backend/index.cjs` pornit cu: `LEGAL_DASHBOARD_AUTH_MODE=web`,
`LEGAL_DASHBOARD_JWT_SECRET/ISSUER/AUDIENCE`, `LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET`
(48 bytes RNG), `TENANT_KEY_ENCRYPTION_SECRET` (base64, exact 32 bytes),
`LEGAL_DASHBOARD_DB_PATH` pe DB temporara din afara repo-ului, port 3002.
Migratiile 0001-0039 au rulat curat la boot. Probele HTTP au lovit backend-ul direct
(fara proxy), cu secretul Basic si headerele de identitate trimise manual —
echivalentul functional al oauth2-proxy pentru scopul sondelor.
