# Deploy Legal Dashboard pe server cu Google OAuth2

Ghid practic pentru a expune Legal Dashboard ca aplicatie web publica, cu autentificare prin contul Google al utilizatorului. Stack-ul folosit este:

```
internet  →  Caddy (TLS Let's Encrypt)  →  oauth2-proxy (Google OAuth)  →  Legal Dashboard backend (HS256 JWT)
```

Toate fisierele de configurare sunt in directorul `deploy/`.

## 1. Prerequisite

  - Server Linux cu Docker Engine si Docker Compose v2 (`docker compose version` returneaza 2.x).
  - Un nume de domeniu cu DNS A/AAAA care pointeaza catre IP-ul public al serverului. Exemplu: `dashboard.firma.ro`.
  - Acces SSH cu drepturi sa rulezi `docker compose`.
  - Cont Google Cloud cu un OAuth Client (Web application) configurat — vezi pasul 3.
  - Port 80 si 443 deschise in firewall (Let's Encrypt HTTP-01 challenge are nevoie de 80).

## 2. Clonare si pregatire fisiere

```bash
git clone https://github.com/Wisedeluxe/Legal-Dashboard.git
cd Legal-Dashboard
cp deploy/.env.prod.example deploy/.env.prod
```

Editeaza `deploy/.env.prod` urmand instructiunile din comentariile fisierului. Genereaza secretele pe host (NU in container):

```bash
# >=32 caractere, folosit pentru JWT-ul backend
openssl rand -base64 48
# Bridge oauth2-proxy ↔ backend (>=32 caractere)
openssl rand -base64 48
# 32 bytes raw, folosit pentru AES-256-GCM la tenant keys
openssl rand -base64 32
# Cookie secret pentru oauth2-proxy (32 bytes URL-safe base64)
python3 -c 'import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

`deploy/.env.prod` NU este versionat (este in `.gitignore`). Pastreaza o copie offline intr-un password manager.

## 3. Google Cloud OAuth Client

  1. Mergi la <https://console.cloud.google.com/apis/credentials>.
  2. Creeaza proiect daca nu exista; activeaza "Google+ API" sau "Google Identity Services".
  3. Configureaza ecran consent OAuth (intern / extern, in functie de Workspace).
  4. Apasa **Create credentials → OAuth client ID → Web application**.
  5. **Authorized redirect URIs**: `https://DOMAIN/oauth2/callback` (inlocuieste `DOMAIN`).
  6. Salveaza Client ID + Client Secret in `deploy/.env.prod` la `GOOGLE_CLIENT_ID` si `GOOGLE_CLIENT_SECRET`.
  7. Restrange `OAUTH2_PROXY_EMAIL_DOMAINS` la domeniul Workspace-ului tau (ex: `firma.ro`) — fara restrictie, oricine cu cont Google poate ajunge la pagina de login (chiar daca nu are user provisionat).

## 4. Boot stack

```bash
cd deploy
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f docker-compose.prod.yml ps
```

La primul boot Caddy genereaza certificatul Let's Encrypt automat. Daca DNS-ul nu rezolva inca, ai 1-2 minute de erori in `docker compose logs caddy`; lasa-l sa retry.

Verifica `/health`:

```bash
curl -sS https://DOMAIN/health
# {"status":"ok","service":"legal-dashboard"}
```

## 5. Provisioneaza primul admin

Backend-ul refuza login-ul oricarui email care nu este deja in tabela `users`. La primul deploy provisionezi adminul cu scriptul `scripts/seed-admin.mjs`:

```bash
docker compose -f docker-compose.prod.yml exec \
  -e SEED_ADMIN_EMAIL=admin@firma.ro \
  -e SEED_ADMIN_DISPLAY_NAME="Admin Principal" \
  backend node scripts/seed-admin.mjs
# {"action":"created","userId":"...","email":"admin@firma.ro"}
```

Scriptul este idempotent: rulat de doua ori cu acelasi email returneaza `already_admin` fara modificari.

## 6. Primul login

  1. Deschide `https://DOMAIN/` in browser.
  2. oauth2-proxy te redirecteaza la consent screen Google. Aproba accesul.
  3. Dupa callback, frontend-ul cheama automat `POST /api/v1/auth/oauth2/sync` (bridge) care minteste JWT-ul nostru HS256 si seteaza cookie-ul `legal_dashboard_session`. Bridge-ul valideaza secretul comun primit ca parola in `Authorization: Basic` (setat de oauth2-proxy prin `basic-auth-password`) si citeste identitatea din `X-Forwarded-Email` (setat de `pass-user-headers`).
  4. Esti redirectionat in dashboard cu rol admin.

Pentru utilizatori suplimentari, foloseste UI-ul `/admin/users` (PR-8) sau ruleaza scriptul cu `SEED_ADMIN_EMAIL` schimbat.

## 7. Backup

Volumul `ld_data` contine baza SQLite. Backup minim:

```bash
# Snapshot consistent (foloseste pragma backup, nu cp pe WAL)
docker compose -f docker-compose.prod.yml exec backend \
  sh -c 'sqlite3 /data/legal-dashboard.db ".backup /data/backup-$(date +%F).db"'
# Apoi copiaza inafara containerului
docker cp $(docker compose -f docker-compose.prod.yml ps -q backend):/data/backup-$(date +%F).db ./backups/
```

Backup-ul intern automat al backend-ului scrie la `backups/` in interiorul volumului `ld_data` (daily backup, retention 7 zile). Sincronizeaza folderul `/data/backups` periodic cu un storage extern (S3, rclone, restic).

Din v2.43.0, volumul `ld_data` contine si `rnpm/` (fisierele SQLite per utilizator pentru datele RNPM) plus `backups/rnpm/<stem>/` (jail-urile de backup per utilizator). Daily backup-ul intern acopera automat si fisierele per user (freshness per target); sincronizarea offsite trebuie sa acopere TOT `/data/backups` (inclusiv subdirectoarele `rnpm/`), iar snapshot-ul manual de mai sus acopera doar monolitul — pentru un backup complet copiaza si `/data/rnpm/`.

## 8. Update la versiune noua

```bash
git pull
docker compose -f deploy/docker-compose.prod.yml build backend
docker compose -f deploy/docker-compose.prod.yml up -d backend
```

Rolling deploy: compose recreeaza doar containerul `backend`; oauth2-proxy + Caddy raman. Sesiunile JWT raman valide; daca rotezi `JWT_SECRET`, toti userii vor fi re-sync-uiti la urmatorul request prin bridge.

**Upgrade la v2.40.1 de pe un volum `ld_data` creat de o imagine pre-v2.40.1:** imaginile vechi nu contineau directorul `/data`, deci Docker a initializat volumul cu ownership `root`. Imaginea noua creeaza `/data` cu ownership `app`, dar Docker copiaza ownership-ul in volum DOAR la prima initializare (volum gol) — un volum existent ramane root-owned si backend-ul non-root pica cu EACCES la deschiderea DB-ului. Remediere one-time inainte de `up -d`:

```bash
docker compose -f deploy/docker-compose.prod.yml run --rm --user root backend chown -R app:app /data
```

Pentru rutele API RNPM, configureaza timeout-ul end-to-end al Caddy,
oauth2-proxy si al oricarui layer Traefik/Cloudflare la minimum 60s.
Autocompact-ul SQLite dupa stergeri este sincron si poate dura mai multe
secunde pe o baza apropiata de limita implicita de 750 MB.

## 9. Rotire secrete

  - **JWT_SECRET**: rotire forteaza re-sync prin oauth2-proxy. Update `.env.prod`, `docker compose up -d backend`. Userii vad re-redirect transparent.
  - **PROXY_BRIDGE_SECRET**: trebuie schimbat simultan pe backend + oauth2-proxy. Update `.env.prod`, apoi `docker compose up -d backend oauth2-proxy`. Pana cand ambele se restarteaza, sync-ul esueaza cu 403.
  - **OAUTH2_PROXY_COOKIE_SECRET**: invalideaza sesiunile oauth2-proxy. Userii fac login Google din nou.
  - **TENANT_KEY_SECRET**: NU rota fara plan de migrare. Pierderea valorii face chei tenant nedecriptabile.

## 10. Operational kill-switches

In `.env.prod`:

  - `MONITORING_DISABLED_KINDS=dosar_soap,name_soap` opreste claim-ul pe tipuri de job-uri fara modificari DB.
  - SMTP partial config dezactiveaza mailer-ul cu warning; lipsa completa = mailer disabled silent.

## 11. Platforme build-from-git (Dokploy, Coolify, CapRover)

Din v2.40.1, `Dockerfile`-ul compileaza singur `dist-backend` + `dist-frontend` intr-un stage de build — `docker build` functioneaza direct pe un git clone curat, fara `npm run build` local in prealabil. Pe Dokploy si platforme similare:

  - **Build**: foloseste build type "Dockerfile" cu context radacina repo-ului. Nu e nevoie de niciun pas de pre-compilare.
  - **Persistenta DB (obligatoriu)**: monteaza un volum persistent la `/data` si seteaza `LEGAL_DASHBOARD_DB_PATH=/data/legal-dashboard.db`. Fara volum, baza de date traieste in filesystem-ul containerului si DISPARE la fiecare redeploy. Directorul `/data` exista deja in imagine cu ownership corect pentru userul non-root `app`.
  - **Env obligatorii pentru web mode**: aceleasi ca in `deploy/docker-compose.prod.yml` — `HOST=0.0.0.0`, `LEGAL_DASHBOARD_ALLOW_REMOTE=1`, `LEGAL_DASHBOARD_AUTH_MODE=web`, `LEGAL_DASHBOARD_JWT_SECRET/ISSUER/AUDIENCE`, `TENANT_KEY_ENCRYPTION_SECRET`, `LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET`.
  - **Auth**: daca platforma are propriul reverse proxy (Traefik etc.), ruleaza oauth2-proxy ca serviciu separat in fata backend-ului, configurat cu `basic-auth-password` + `pass-basic-auth` + `pass-user-headers` (vezi `deploy/docker-compose.prod.yml` pentru env-urile exacte). Orice alt proxy de autentificare trebuie sa livreze bridge-ului secretul (Basic Auth sau `X-Proxy-Auth`) si emailul (`X-Forwarded-Email` sau `X-Auth-Request-Email`) si sa strip-uiasca aceste header-e de pe request-urile clientilor.

## 12. Troubleshooting

  - **Caddy nu obtine cert**: verifica DNS public (`dig DOMAIN`), porturile 80/443 deschise, `docker compose logs caddy`. Foloseste `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` in Caddyfile cat timp testezi pentru a evita rate limit-ul Let's Encrypt.
  - **`/health` returneaza 503**: backend inca prewarms. Healthcheck-ul are `start_period=120s`. Daca persista, `docker compose logs backend` arata erorile (cel mai des: secret JWT < 32 chars, TENANT_KEY_SECRET invalid base64, DB locked).
  - **Login Google reuseste, dar dashboard arata 403**: emailul nu e in `users`. Ruleaza `seed-admin.mjs` cu emailul respectiv si refresh.
  - **`docker compose logs oauth2-proxy` arata "invalid redirect URL"**: `OAUTH2_PROXY_REDIRECT_URL` din compose nu se potriveste cu URI-ul autorizat in Google Cloud Console. Verifica scheme (https), domeniul exact si `/oauth2/callback`.
  - **403 forbidden la `/api/v1/auth/oauth2/sync`**: shared secret-ul din `.env.prod` (`PROXY_BRIDGE_SECRET`) este diferit intre backend si oauth2-proxy. Ambele containere trebuie sa citeasca acelasi `.env.prod`; restart oauth2-proxy si backend simultan dupa orice modificare. Daca rulezi alt proxy decat stack-ul din `deploy/`, verifica sa trimita upstream secretul ca parola Basic Auth (`Authorization: Basic base64(user:secret)`) sau ca header `X-Proxy-Auth`, plus emailul in `X-Forwarded-Email` sau `X-Auth-Request-Email`.
  - **400 missing_identity la `/api/v1/auth/oauth2/sync`**: proxy-ul nu trimite emailul upstream. Pe oauth2-proxy legacy config activeaza `pass-user-headers` (trimite `X-Forwarded-Email`); `set-xauthrequest` NU ajuta — acela seteaza header-e de raspuns pentru nginx auth_request, nu header-e catre upstream.

## 13. Ingress PAT (API programatic v2.40.0) prin fata publica

Din v2.40.1, `deploy/Caddyfile` are o ruta dedicata pentru clientii programatici: request-urile cu `Authorization: Bearer ld_pat_*` pe `/api/*` (cu exceptia `/api/v1/auth/*`) sunt proxy-ate DIRECT la backend, ocolind oauth2-proxy — care altfel ar redirecta request-urile fara sesiune Google la login si ar suprascrie `Authorization` cu Basic-ul de bridge. Cum functioneaza:

  - **Matching strict**: doar forma canonica `Authorization: Bearer ld_pat_...` (B mare, un singur spatiu) intra pe ruta directa. Variantele (`bearer` lowercase, tab) cad in fluxul oauth2-proxy si primesc redirect la Google — fail-safe, dar deconcertant pentru clienti; foloseste forma canonica (vezi API.md).
  - **Securitatea ramane in backend**: dispatch PAT doar din header-ul Bearer (niciodata din cookie), validare per-request in DB (revocare instanta), gate default-deny pe `(metoda, path, scope)`, rate-limit per token, gate HTTPS (`x-forwarded-proto`), audit + alerta email la IP nou.
  - **Strip-uri security-critical pe ruta directa**: Caddy strip-uieste `Cookie`, `X-Proxy-Auth`, `X-Forwarded-Email`, `X-Auth-Request-Email`, `X-Forwarded-User` — nimic identity-shaped de la client nu ajunge la backend, iar `not path /api/v1/auth/*` tine traficul PAT complet departe de bridge-ul oauth2 sync.
  - **IP-ul real al clientului** ajunge la backend prin `X-Forwarded-For`/`X-Real-IP` cu `{remote_host}` (IP fara port) — rate-limit-ul per client si alerta "IP nou" per token functioneaza si pe ruta directa. Presupunere: Caddy e PRIMUL hop public. Daca pui un CDN/load balancer in fata lui Caddy, `{remote_host}` devine IP-ul CDN-ului — adauga `servers { trusted_proxies ... }` in blocul global din Caddyfile si inlocuieste `{remote_host}` cu `{client_ip}`.
  - **Verificare**: `BASE_URL=https://DOMAIN scripts/smoke-deploy.sh` include proba de ingress PAT (401 asteptat pe token invalid; 302 = ruta lipseste). `deploy/Caddyfile` e validat si in CI (`docker-build.yml`).

Avertisment neschimbat: NU seta `OAUTH2_PROXY_PASS_AUTHORIZATION_HEADER=true` — ar emite doua valori `Authorization` catre backend pe fluxul browser (Bearer id-token Google + Basic) si ar strica bridge-ul; fix-ul corect e exact aceasta rutare in Caddy, nu pass-through-ul din oauth2-proxy.

## 14. Constrangeri de securitate

  - Backend-ul NU foloseste `ports:` in compose, doar `expose:`. Daca cineva il publica direct, oricine cu un client HTTP poate trimite header-ele de identitate (`X-Forwarded-Email` / `X-Auth-Request-Email`) direct la bridge. Singura protectie ramasa in acel scenariu este shared secret-ul `PROXY_BRIDGE_SECRET` (validat inainte de orice header de identitate) — pastreaza-l rotativ si NU il loga.
  - **`LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` este obligatoriu operational in spatele unui proxy** (v2.43.0): gardurile care depind de identitatea peer-ului (rate limiter per IP, originGuard pe mutatii cross-LAN) folosesc `X-Forwarded-For` DOAR daca peer-ul TCP intra in acest CIDR. Nesetat, toate cererile au ca peer IP-ul containerului de proxy — un singur bucket de rate-limit pentru toti utilizatorii si protectie CSRF dependenta exclusiv de cookie-ul SameSite=Strict. Seteaza CIDR-ul retelei Docker a proxy-ului (ex. `172.20.0.0/16`); backend-ul logheaza la boot warn-ul structurat `proxy.trusted_cidr.missing` cand lipseste in web mode.
  - oauth2-proxy NU forwardeaza tokenul Google catre backend (`PASS_AUTHORIZATION_HEADER=false`, `PASS_ACCESS_TOKEN=false`). Asa, tokenurile Google nu intra niciodata in DB-ul nostru.
  - Cookie-urile sunt HttpOnly + Secure + SameSite=Strict. Frontend-ul nu poate citi JWT-ul din JavaScript.
  - Audit log-ul backend-ului inregistreaza login-uri prin `auth.oauth2.sync` cu `targetId=user.id`, dar fara plaintext-ul email (doar hash SHA-256 pe refuzuri).
  - LAN binding pentru `HOST=0.0.0.0` cere TOATE trei preconditiile, altfel boot-ul esueaza fatal: (1) `LEGAL_DASHBOARD_ALLOW_REMOTE=1`, (2) `LEGAL_DASHBOARD_AUTH_MODE=web`, (3) config JWT valid (`LEGAL_DASHBOARD_JWT_SECRET` >=32 chars + `LEGAL_DASHBOARD_JWT_ISSUER` + `LEGAL_DASHBOARD_JWT_AUDIENCE`). Un bind non-loopback fara `auth_mode=web` reseteaza forterea la `127.0.0.1` / opreste boot-ul. Acesta ramane gate-ul oficial; schimbarea lui necesita revizuire de securitate.

Pentru intrebari sau bug-uri: vezi [SECURITY.md](SECURITY.md) si [CHANGELOG.md](CHANGELOG.md) entry-ul v2.31.0.
