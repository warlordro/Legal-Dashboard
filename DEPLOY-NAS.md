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

> **Stare pe deploymentul curent (verificat 2026-08-15):** ruta e deja instalata si
> functionala pe `api-dashboard.<domeniu>` — hostname configurat in tunel, CNAME proxied,
> `caddy-pat` pornit. Probele 2, 3 si 6 de mai jos trec din exterior. Sectiunea ramane
> scrisa ca procedura de instalare, pentru un stack nou sau pentru reconstructie.

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

# 4. bridge-ul de identitate NU e atins de calea PAT -> 404 (exclusie security-critical)
curl -i -X POST -H "Authorization: Bearer <token>" https://api-dashboard.<domeniu>/api/v1/auth/oauth2/sync

# 5. token valid pe o ruta din afara capabilitatilor -> 403, nu 200
curl -i -X POST -H "Authorization: Bearer <token>" https://api-dashboard.<domeniu>/api/rnpm/compact

# 6. hostname-ul de browser NU s-a largit -> tot 302 catre Google
curl -i -H "Authorization: Bearer <token>" https://dashboard.<domeniu>/api/dosare?numarDosar=1/1/2024

# 7. cautare RNPM reala -> 200 (nu 501, nu 403, nu 429); corpul cererii e in openapi.json
```

Interpretarea codurilor: **426** = `X-Forwarded-Proto: https` nu ajunge la backend (verifica
`deploy/Caddyfile.pat`); **403** = tokenul nu are scope-ul rutei; **429** = cota de captcha
atinsa (cea per user sau `captchaDailyCap` per token); **501** = cheia de captcha nu e
configurata la nivel de tenant; **302** = cererea a nimerit tot poarta Google; **404 peste
tot** = matcher-ul `@pat` nu a prins.

Doua capcane de diagnostic, ambele prin design:

- `/health` raspunde **404** pe hostname-ul de API. Monitorul de uptime ramane pe hostname-ul
  de browser.
- Matcher-ul compara `Bearer` **case-sensitive**: un client care trimite `bearer ld_pat_…` cu
  litera mica primeste 404, fara niciun mesaj. Verificat empiric. Scrie-l in nota de integrare
  data clientilor, sau treci matcher-ul pe `header_regexp` daca vrei sa fie tolerant.

### Recomandat dupa upgrade-ul la oauth2-proxy 7.15.x: `OAUTH2_PROXY_TRUSTED_PROXY_IPS`

v7.15.2 a introdus `--trusted-proxy-ip`, si odata cu el o problema pe care versiunea veche
o avea tacut: cand `OAUTH2_PROXY_REVERSE_PROXY` e `true` iar optiunea asta lipseste,
proxy-ul are incredere in headerele `X-Forwarded-*` primite de la **orice** sursa
(`0.0.0.0/0`) si scrie un avertisment la pornire — deci vei vedea acel warning in loguri
dupa upgrade, e asteptat, nu un defect de configuratie.

Conteaza aici pentru ca portul 4180 e publicat pe toate interfetele LAN: orice dispozitiv
din retea il atinge direct si poate falsifica headerele care decid ce adresa i se atribuie
cererii. Ca sa inchizi: afla ce sursa vede efectiv oauth2-proxy pentru traficul venit prin
tunel (`docker logs <container_oauth2-proxy>`, campul de client IP pe o cerere reala), apoi
adauga in `.env`:

```
OAUTH2_PROXY_TRUSTED_PROXY_IPS=<IP sau CIDR-ul sursei reale>
```

Nu ghici valoarea: una gresita face ca loginul sa se construiasca pe schema si adresa
gresita si te poate bloca in afara aplicatiei. Seteaz-o, reporneste doar oauth2-proxy si
verifica imediat un login complet.

### `APP_VERSION` e obligatoriu de la v2.45.0

Compose-urile aveau un default tacut (`${APP_VERSION:-2.43.3}`), care ramanea in urma la
fiecare release si eticheta imaginea noua cu o versiune veche — tag-ul mintea la rollback
si la audit. Acum variabila e ceruta explicit (`${APP_VERSION:?...}`): daca lipseste din
`.env`, orice comanda `docker compose` se opreste cu un mesaj clar in loc sa construiasca
o imagine gresit etichetata. Seteaza-o la versiunea pe care o deployezi.

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
e `/volume3/docker/legal-dashboard`. In pasii de mai jos `$VECHE` = versiunea
care ruleaza ACUM, `$NOUA` = versiunea pe care o instalezi.

1. **Tag pe starea live, inainte de merge.** Fara el nu ai un punct fix la care
   sa te intorci, pentru ca rollback-ul inseamna build din acel tag:

   ```bash
   git tag -a "$VECHE" <commit-care-ruleaza-acum> && git push origin "$VECHE"
   ```

2. **Backup inainte de orice atingere a deploy-ului.** Din Setari > Backup
   (admin) sau prin copierea lui `data/` cu aplicatia OPRITA. Nu te baza pe
   "releaseul nu are migratii" ca motiv sa sari peste: absenta unei migratii de
   schema nu garanteaza ca versiunea noua nu scrie date pe care cea veche le
   citeste altfel. Backup-ul e conditia care face rollback-ul sigur, nu migratia.

3. **Pregateste arborele nou LANGA cel viu, apoi schimba-le.** Extragerea direct
   peste folderul live lasa un arbore pe jumatate actualizat daca transferul
   pica la mijloc:

   ```bash
   NAS=/volume3/docker/legal-dashboard
   git archive "$NOUA" | ssh nas "mkdir -p $NAS.new && tar -x -C $NAS.new"
   # pastreaza starea locala care NU vine din git
   ssh nas "cp -a $NAS/.env $NAS.new/ && cp -a $NAS/docker-compose.yml $NAS.new/             && mv $NAS/data $NAS.new/data             && mv $NAS $NAS.old-$VECHE && mv $NAS.new $NAS"
   ```

   `docker-compose.yml` se copiaza din vechi, NU din arhiva: repo-ul are un
   `docker-compose.yml` la radacina (alt stack), iar pe NAS acel nume e ocupat de
   copia lui `deploy/docker-compose.nas.yml`. Daca il iei din arhiva, strici
   deploy-ul. Daca `deploy/docker-compose.nas.yml` s-a schimbat in releaseul nou,
   copiaza-l explicit si compara cu cel vechi inainte de Build.

   `$NAS.old-$VECHE` ramane pe disc ca plasa; sterge-l dupa ce noua versiune e
   confirmata.

4. **Ridica `APP_VERSION` in `.env`.** Compose construieste
   `legal-dashboard:${APP_VERSION}`; daca ramane pe versiunea veche, imaginea
   noua suprascrie tag-ul vechi si numele imaginii de rollback ajunge sa indice
   cod nou.

5. **Stop, apoi Build** in Container Manager (Build, nu Start — altfel porneste
   imaginea veche), si abia apoi porneste stack-ul. Stop-ul inchide SQLite curat.

6. **Verifica ce ruleaza efectiv** (vezi mai jos: `system.boot` din `audit_log`),
   apoi versiunea din sidebar dupa `Ctrl+Shift+R`. Bundle-ul frontend e cache-uit
   in browser, deci fara hard refresh vezi versiunea veche chiar si dupa un build
   corect.

Rollback: aceeasi procedura, cu `$NOUA` = tag-ul precedent (sau porneste
`$NAS.old-$VECHE`, daca inca exista). Daca versiunea noua a scris date, restaureaza
si backup-ul de la pasul 2.

### Diagnostic fara sudo

`docker` de pe NAS cere parola de sudo, deci `docker logs` / `docker ps` nu sunt
disponibile dintr-o sesiune SSH neprivilegiata. Ce ramane observabil:

- **Ce versiune ruleaza si cand a pornit** — sursa de adevar, nu inferenta:

  ```bash
  MONO=/volume3/docker/legal-dashboard/data/legal-dashboard.db
  sqlite3 -separator ' | ' "file:$MONO?mode=ro"     "select ts, action, json_extract(detail_json,'$.version')
       from audit_log
      where action in ('system.boot','system.shutdown')
      order by id desc limit 5;"
  ```

  Nu folosi activitatea din `*.db-wal` ca semnal de boot: WAL-ul e atins si de
  checkpoint-uri sau de scrieri obisnuite, deci nu distinge o repornire de
  trafic normal.

- **Lantul de auth** — `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4180/`
  trebuie sa dea `302`. Atentie: `302` vine de la oauth2-proxy si spune DOAR ca
  proxy-ul e sus; containerul aplicatiei poate fi cazut in spatele lui. Pentru
  sanatatea aplicatiei foloseste `system.boot` de mai sus sau `/health`
  autentificat din browser.

- **Rezultatul unei cautari RNPM** — `sqlite3` exista pe NAS, iar bazele per user
  din `data/rnpm/*.db` permit comparatia dintre ce a anuntat RNPM si ce s-a
  salvat efectiv:

  ```bash
  DB=/volume3/docker/legal-dashboard/data/rnpm/<uuid>-<stem>.db
  sqlite3 -separator ' | ' "file:$DB?mode=ro"     "select s.id, s.total_results,
            (select count(*) from rnpm_avize a where a.search_id = s.id)
     from rnpm_searches s order by s.id desc limit 5;"
  ```

  Randul de cautare se scrie la START, deci un `0` imediat dupa lansare inseamna
  "in curs", nu esec. Asteapta stabilizarea numarului.

### Restul

- **Backup**: include `docker/legal-dashboard/data` in Hyper Backup — acolo e
  baza SQLite cu dosarele monitorizate.
- **Rotire secrete**: schimbi valoarea in `.env` si dai Build. Rotirea
  `JWT_SECRET` deconecteaza toti utilizatorii (reintra prin Google).
