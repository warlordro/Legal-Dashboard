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
[SECURITY.md](SECURITY.md) si [HARDENING.md](HARDENING.md) pentru controalele
implementate in aplicatie.

## 7. Intretinere

- **Update**: copiaza sursele noi peste folder, **incrementeaza `APP_VERSION`**
  in `.env`, apoi **Build** in Container Manager. `data/` ramane neatins.

  Bump-ul de versiune nu e cosmetic: `image:` din compose foloseste
  `APP_VERSION` ca tag, iar Container Manager sare peste build daca imaginea cu
  acel tag exista deja - reporneste containerul vechi si pare ca a reusit.
  Verificare ca noul cod ruleaza, din terminalul containerului:
  `grep -c <un-sir-nou-din-cod> /app/dist-backend/index.cjs`.
- **Backup**: include `docker/legal-dashboard/data` in Hyper Backup — acolo e
  baza SQLite cu dosarele monitorizate.
- **Rotire secrete**: schimbi valoarea in `.env` si dai Build. Rotirea
  `JWT_SECRET` deconecteaza toti utilizatorii (reintra prin Google).
