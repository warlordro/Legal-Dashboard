# Deploy pe NAS Synology, in spatele Cloudflare Tunnel

Varianta de deploy web fara server public: aplicatia ruleaza pe NAS-ul de
acasa, iar Cloudflare o expune printr-un tunel outbound. Alternativa la
[DEPLOY-SERVER.md](DEPLOY-SERVER.md) (VPS + Caddy + Let's Encrypt).

## De ce pe NAS

`portalquery.just.ro` accepta conexiuni doar de pe retele de ISP consumer.
Masurat: conexiune rezidentiala RO raspunde in ~11 ms, iar 17 noduri de
datacenter (US, DE, NL, PT, BG, HU, MD, UA, RU, BR, IL, IN, IR si un nod din
Bucuresti) primesc `connection timed out` — pachetele sunt aruncate silentios,
fara RST si fara 403. Pe orice VPS, modulul de dosare ar fi inutilizabil.

Stack-ul rezultat:

```
internet → Cloudflare (TLS, WAF, DDoS) → cloudflared → oauth2-proxy (4180) → backend (3002)
```

Fata de `DEPLOY-SERVER.md` dispar Caddy, Let's Encrypt si deschiderea
porturilor 80/443 in router. Autentificarea Google prin oauth2-proxy ramane
obligatorie: e singurul lucru care sta intre internet si datele de dosare.

## 1. Prerechizite

- Container Manager pe DSM 7.2+ (x86; DS925+ e suficient de puternic).
- Un tunel Cloudflare deja functional pe NAS (vezi ghidul din proiectul
  Ro-DataGov MCP, `DEPLOY-SYNOLOGY.md`) sau unul nou.
- Un domeniu in contul Cloudflare.
- Un OAuth Client Google (Web application).

## 2. Fisiere pe NAS

1. Copiaza repo-ul in `docker/legal-dashboard/` (build-ul se face din
   `Dockerfile`-ul de la radacina, deci ai nevoie de `backend/`, `frontend/`,
   `scripts/`, `package.json`).
2. Copiaza `deploy/docker-compose.nas.yml` in radacina folderului, redenumit
   `docker-compose.yml` — Container Manager il cauta cu numele standard.
3. Creeaza subfolderul `data/` (aici sta baza SQLite).
4. Copiaza `deploy/.env.nas.example` ca `.env` in radacina si completeaza-l.

## 3. Google OAuth Client

1. <https://console.cloud.google.com/apis/credentials> → **Create credentials →
   OAuth client ID → Web application**.
2. **Authorized redirect URI**: `https://dashboard.<domeniul-tau>/oauth2/callback`.
3. Client ID + Secret merg in `.env`.
4. Restrange `OAUTH2_PROXY_EMAIL_DOMAINS` la domeniile permise.

## 4. Ruta in tunel

In Cloudflare, pe tunelul existent, **Public Hostname → Add**:

- Subdomain `dashboard`, Domain = domeniul tau
- Type `HTTP`, URL `<IP-LAN-NAS>:4180`

Portul 4180 e oauth2-proxy, nu backend-ul. Rutarea directa spre 3002 ar ocoli
complet autentificarea Google.

## 4b. Ruta pentru API-ul programatic (PAT)

Clientii cu `Authorization: Bearer ld_pat_*` (scripturi, integrari, MCP) nu pot
trece prin oauth2-proxy: orice cerere fara sesiune Google primeste 302 catre
login, deci API-ul din [API.md](API.md) e inaccesibil din afara. Solutia e un
hostname separat, servit de containerul `caddy-pat` (port 4181), care accepta
DOAR cereri cu token opac pe `/api/*` si le trimite direct la backend.

`OAUTH2_PROXY_SKIP_AUTH_ROUTES` nu e o alternativa: cu `PASS_BASIC_AUTH=true`
headerul `Authorization` al clientului nu supravietuieste trecerii prin oauth2-proxy,
iar ruta ar fi deschisa oricarui client, fara filtrul pe token.

In Cloudflare, pe acelasi tunel, **Public Hostname → Add**:

- Subdomain `api-dashboard` (sau alt nume), Domain = domeniul tau
- Type `HTTP`, URL `<IP-LAN-NAS>:4181`

Apoi **Build** in Container Manager, ca sa porneasca serviciul nou.

Verificare (inlocuieste `<token>` cu un PAT real din **Setari → Acces API**):

```bash
# 1. tokenul functioneaza -> 200 cu specul OpenAPI
curl -H "Authorization: Bearer <token>" https://api-dashboard.<domeniu>/api/v1/openapi.json

# 2. token invalid -> 401 invalid_token DE LA BACKEND (nu 302 catre Google).
#    Asta e proba ca ingressul e corect si ca backend-ul ramane poarta.
curl -i -H "Authorization: Bearer ld_pat_invalid" https://api-dashboard.<domeniu>/api/dosare?numarDosar=1/1/2024

# 3. fara header de autorizare -> 404 de la caddy-pat
curl -i https://api-dashboard.<domeniu>/api/dosare

# 4. hostname-ul de browser NU s-a largit -> tot 302 catre Google
curl -i -H "Authorization: Bearer <token>" https://dashboard.<domeniu>/api/dosare?numarDosar=1/1/2024
```

Daca proba 1 da **426**, `X-Forwarded-Proto: https` nu ajunge la backend (verifica
`deploy/Caddyfile.pat`). Daca da **403**, tokenul nu are scope-ul rutei. Ruta RNPM
raspunde **501** pana cand un admin configureaza cheia de captcha la nivel de tenant.

### Ce mai verifici o singura data, la prima instalare

1. **Subnetul retelei Docker.** Backend-ul are incredere in headerele de proxy doar de la
   peers din `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` (implicit `172.16.0.0/12`). Daca
   Container Manager aloca `ld_net` din alt pool, IP-ul real al clientului se pierde si
   rate-limitul plus alerta de IP nou colapseaza pe adresa containerului:
   `docker network inspect <proiect>_ld_net` → daca subnetul e in afara CIDR-ului,
   adauga-l in `.env` la `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR`.
2. **Certificatul Cloudflare.** Certul Universal gratuit acopera un singur nivel sub zona.
   Daca `api-dashboard.<domeniu>` iese pe al doilea nivel, handshake-ul TLS pica si ai
   nevoie de un cert dedicat.
3. **Sintaxa configului**, direct pe NAS, inainte de Build:
   `docker run --rm -v "$PWD/deploy/Caddyfile.pat:/etc/caddy/Caddyfile:ro" caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`

### Risc acceptat: portul 4181 in LAN

Portul 4181 e o intrare de API care nu trece prin poarta Google si nu beneficiaza de
WAF-ul, rate-limitul si filtrul de tara din Cloudflare. Din internet nu se poate ajunge
la el decat prin tunel, dar orice dispozitiv din LAN il atinge direct — si poate trimite
un `CF-Connecting-IP` falsificat, pe care backend-ul il crede (peer-ul e in reteaua de
incredere). Consecinte: ocolirea rate-limitului pre-autentificare (cel per token, 60/min,
ramane) si, cu un token deja furat, suprimarea alertei de IP nou. Daca vrei sa inchizi
si asta, pune o regula de firewall in DSM care lasa pe 4181 doar IP-ul masinii care
ruleaza `cloudflared` (citeste peer-ul real din logurile containerului `caddy-pat`).

## 5. Pornire si primul admin

**Container Manager → Project → Create**, path = folderul aplicatiei, source =
**Use existing docker-compose.yml**, web portal nebifat.

Backend-ul refuza login-ul oricarui email care nu exista deja in tabela
`users`. Provizioneaza primul admin din terminalul containerului:

```bash
SEED_ADMIN_EMAIL=adresa@ta SEED_ADMIN_DISPLAY_NAME="Admin" node scripts/seed-admin.mjs
```

Verificare: `https://dashboard.<domeniu>/health` trebuie sa raspunda
`{"status":"ok"}` doar dupa autentificare, iar `/` sa redirecteze la Google.

## 6. Securitate — ce face Cloudflare si ce nu

Verificat pe documentatia curenta, pentru planul **Free**:

| Protectie | Free | Ce acopera |
|---|---|---|
| DDoS L3/L4 + L7 | da, nemetrat, mereu activ | atacuri volumetrice; nu ajung la conexiunea ta |
| Free Managed Ruleset (WAF) | da, activabil | subset din regulile Cloudflare: vulnerabilitati cu impact mare si larg exploatate (tip Log4j, Shellshock) |
| Reguli custom (firewall) | 5 reguli | filtrare pe tara, path, user agent, metoda |
| Rate limiting | 1 regula, doar pe IP, fereastra 10 s | frenare brute force pe un path |
| Bot Fight Mode | da | boti evidenti; varianta Super e platita |
| Ascunderea IP-ului tau | da, prin tunel | originea nu are IP public, deci nu poate fi scanata direct |

Ce **nu** iti da Cloudflare Free: setul complet de reguli WAF (OWASP core
ruleset e pe Pro+), rate limiting serios (ferestre mai lungi, chei compuse),
si nicio protectie impotriva unui atacator care are deja cont valid.

Configurarea minima recomandata, in ordinea impactului:

1. **Security → WAF → Managed rules**: activeaza Free Managed Ruleset.
2. **Security → WAF → Custom rules**: o regula care blocheaza tot traficul din
   afara Romaniei, daca nu ai utilizatori din strainatate. E cea mai eficienta
   reducere de suprafata, dintr-o singura regula.
3. **Rate limiting**: singura regula disponibila pusa pe `/oauth2/*`, ca sa nu
   se poata itera pe login.
4. **Bot Fight Mode**: pornit.
5. **SSL/TLS → Overview**: modul **Full (strict)** nu e aplicabil aici (tunelul
   nu foloseste TLS spre origine), dar activeaza **Always Use HTTPS** si HSTS.
6. **Cloudflare Access** (Zero Trust, plan Free disponibil — verifica numarul de
   utilizatori inclusi pe pagina de planuri): adauga o a doua poarta, la
   marginea retelei Cloudflare, inainte ca traficul sa ajunga la NAS. Cu Google
   ca IdP, utilizatorii vor autentifica de doua ori (Access + oauth2-proxy),
   deci merita doar daca vrei ca nimic neautentificat sa ajunga vreodata acasa.

Ce ramane in sarcina ta, indiferent de Cloudflare: secretele din `.env`,
provizionarea utilizatorilor, backup-ul bazei si actualizarea imaginilor. Vezi
[SECURITY.md](SECURITY.md) pentru controalele implementate in aplicatie si
[RUNBOOK.md](RUNBOOK.md) pentru operare, incidente si recuperare.

## 7. Intretinere

### Update la o versiune noua

Procedura verificata pe deploy-ul real (v2.44.0, 2026-08-02). Folderul aplicatiei
e `/volume3/docker/legal-dashboard`.

1. **Tag inainte de merge.** Pune un tag pe starea care ruleaza ACUM
   (`git tag -a vX.Y.Z <commit-live> && git push origin vX.Y.Z`), altfel nu ai
   un punct fix la care sa te intorci: rollback-ul inseamna build din acel tag.
2. **Copiaza exact arborele tagat**, nu working tree-ul:

   ```bash
   git archive vX.Y.Z | ssh nas 'tar -x --exclude=docker-compose.yml \
     -C /volume3/docker/legal-dashboard'
   ```

   `--exclude=docker-compose.yml` NU e optional: repo-ul are un
   `docker-compose.yml` la radacina (alt stack), iar pe NAS acel nume e ocupat
   de copia lui `deploy/docker-compose.nas.yml`. Fara exclude il suprascrii si
   strici deploy-ul. `.env` si `data/` nu sunt in arhiva, deci raman neatinse.
3. **Ridica `APP_VERSION` in `.env`.** Compose construieste
   `legal-dashboard:${APP_VERSION}`; daca ramane pe versiunea veche, imaginea
   noua suprascrie tag-ul vechi si numele imaginii de rollback ajunge sa indice
   cod nou.
4. **Stop, apoi Build** in Container Manager (Build, nu Start — altfel porneste
   imaginea veche), si abia apoi porneste stack-ul. Stop-ul inchide SQLite curat.
5. **Verifica versiunea** in sidebar dupa `Ctrl+Shift+R`. Bundle-ul frontend e
   cache-uit in browser, deci fara hard refresh vezi versiunea veche chiar si
   dupa un build corect.

Rollback: build din tag-ul precedent, dupa aceeasi procedura. Verifica intai
daca releaseul aduce migratii — daca nu, baza e compatibila in ambele sensuri si
rollback-ul nu cere restore.

### Diagnostic fara sudo

`docker` de pe NAS cere parola de sudo, deci `docker logs` / `docker ps` nu sunt
disponibile dintr-o sesiune SSH neprivilegiata. Ce ramane observabil:

- boot-ul aplicatiei — scrieri proaspete in `data/legal-dashboard.db-wal`;
- lantul de auth — `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4180/`
  trebuie sa dea `302`;
- rezultatul unei cautari RNPM — `sqlite3` exista pe NAS, iar bazele per user
  din `data/rnpm/*.db` permit comparatia dintre ce a anuntat RNPM si ce s-a
  salvat efectiv:

  ```bash
  sqlite3 -separator '|' "file:$DB?mode=ro" \
    "select s.id, s.total_results,
            (select count(*) from rnpm_avize a where a.search_id = s.id)
     from rnpm_searches s order by s.id desc limit 5;"
  ```

  Randul de cautare se scrie la START, deci un `0` imediat dupa lansare
  inseamna "in curs", nu esec. Asteapta stabilizarea numarului.

### Restul

- **Update (varianta manuala)**: copiaza sursele noi peste folder, apoi
  **Build** in Container Manager. `data/` ramane neatins.
- **Backup**: include `docker/legal-dashboard/data` in Hyper Backup — acolo e
  baza SQLite cu dosarele monitorizate.
- **Rotire secrete**: schimbi valoarea in `.env` si dai Build. Rotirea
  `JWT_SECRET` deconecteaza toti utilizatorii (reintra prin Google).
