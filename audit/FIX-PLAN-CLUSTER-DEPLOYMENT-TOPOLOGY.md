# Plan de Implementare: Cluster Deployment + Topology — Legal Dashboard v2.33.0

**Generat**: 2026-05-19
**Target**: `fix/security-deployment-topology` -> v2.33.0
**Scope**: 4 findings (HIGH-2, HIGH-3, MEDIUM-5, MEDIUM-10)
**Estimat total**: ~5.5h implementare + ~1h test/review

---

## Ordine de implementare (dependente)

```
HIGH-2  (backend/src/db/instanceLock.ts -- fisier NOU, boot gate cross-process)
   |
HIGH-3  (backend/src/util/proxyIp.ts -- fisier NOU; wire in rate-limit.ts + originGuard.ts)
   |
MEDIUM-5  (deploy/Caddyfile -- strip headere sensibile; independent in acelasi branch)
   |
MEDIUM-10  (deploy/docker-compose.prod.yml digest pinning + infra/docker-digests.md)
```

Rationale: HIGH-2 si HIGH-3 sunt fisiere backend TypeScript care trebuie sa treaca `tsc --noEmit` impreuna inainte de commit. MEDIUM-5 si MEDIUM-10 sunt config pur (Caddyfile + compose YAML) fara dependente pe backend; pot fi aplicate in orice ordine dupa HIGH-2/HIGH-3.

---

## HIGH-2 -- SQLite cross-process lock fragility

**Estimat**: 2.5h | **Regresie desktop**: ZERO -- lockfile se scrie in acelasi `dataDir` ca DB-ul; comportamentul este identic pe desktop si Docker. Env var `LEGAL_DASHBOARD_FORCE_BOOT=1` este default-OFF (safe).

### Problema

`backend/src/db/backup.ts:15` declara `maintenanceLock = new RWLock()` -- un mutex pur in-process. Acesta coordoneaza scheduler-ul de backup cu restore-ul in interiorul unui singur proces Node. Problema este la nivel cross-process: daca operatorul scaleaza accidental serviciul `backend` la 2 replici Docker care monteaza acelasi volum `/data`, ambele vor deschide `legal-dashboard.db` simultan in WAL mode. Backup-ul zilnic foloseste `db.backup()` care necesita absenta altui writer activ -- doua replici concurente duc la corupere snapshot sau pierdere de date la restore. Un crash hard (OOM kill, `kill -9`) nu curata niciun indicator, deci nu exista detectie post-crash.

**Nota importanta de scop**: `backend/src/db/instanceLock.ts` este un fisier **NOU**. `backup.ts` si `maintenanceLock` raman neatinse -- ele rezolva un alt nivel de problema (coordonare in-process scheduler vs. backup). Cele doua mecanisme sunt complementare:

| Nivel | Mecanism | Rezolva |
|-------|----------|---------|
| Cross-process / cross-container | `instanceLock.ts` lockfile PID+hostname | Doua copii Node pe acelasi `/data` |
| In-process (scheduler vs. backup) | `maintenanceLock` RWLock in backup.ts | Tick monitoring concurrent cu backup daily |

### Fix

**Pas 1**: Creeaza `backend/src/db/instanceLock.ts`:

```ts
// v2.33.0 - cross-process boot gate pe acelasi data directory.
// Scrie un lockfile `.instance.lock` cu PID + hostname + heartbeat la pornire.
// La urmatorul boot pe acelasi dataDir, daca lockfile-ul exista:
//   - daca PID-ul mai exista in OS si heartbeat-ul e proaspat (<3*HEARTBEAT_MS),
//     refuza boot-ul (exit 1) cu mesaj clar.
//   - daca PID-ul e mort sau heartbeat-ul e stale, reclama lockfile-ul si
//     emite audit `instance.lock.reclaimed`.
// Env override: LEGAL_DASHBOARD_FORCE_BOOT=1 sare verificarile (DOAR pentru
// disaster recovery; nu lasa in deployment normal).
//
// Why hostname + PID: PID-ul singur nu e unic intre containere (PID 1 in
// container A == PID 1 in container B). Hostname-ul docker-compose este unic
// per replica -- combinatia PID+hostname identifica un proces specific.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { join } from "node:path";
import { recordAudit } from "./auditRepository.ts";

const HEARTBEAT_MS = 5_000;
const STALE_FACTOR = 3;

interface LockRecord {
  pid: number;
  hostname: string;
  startedAt: number;
  heartbeatAt: number;
  version?: string;
}

function lockPath(dataDir: string): string {
  return join(dataDir, ".instance.lock");
}

function readLock(dataDir: string): LockRecord | null {
  const path = lockPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as LockRecord;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.hostname !== "string" ||
      typeof parsed.heartbeatAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function processAlive(pid: number, sameHost: boolean): boolean {
  // Cross-host: nu putem verifica PID-ul remote; assume alive doar daca
  // heartbeat-ul e proaspat (caller-ul decide).
  if (!sameHost) return true;
  try {
    // process.kill(pid, 0) NU trimite semnal; doar verifica existenta.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process. EPERM = exista dar nu avem permisiune (alive).
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function acquireInstanceLock(dataDir: string, appVersion?: string): void {
  if (process.env.LEGAL_DASHBOARD_FORCE_BOOT === "1") {
    console.warn(
      "[instanceLock] LEGAL_DASHBOARD_FORCE_BOOT=1 -- boot fortat fara verificare lockfile."
    );
    writeLock(dataDir, appVersion);
    startHeartbeat(dataDir, appVersion);
    return;
  }

  const existing = readLock(dataDir);
  if (existing) {
    const sameHost = existing.hostname === osHostname();
    const heartbeatAge = Date.now() - existing.heartbeatAt;
    const stale = heartbeatAge > STALE_FACTOR * HEARTBEAT_MS;
    const alive = sameHost ? processAlive(existing.pid, true) : !stale;

    if (alive && !stale) {
      console.error(
        `[instanceLock] Alt proces detine lockfile-ul: pid=${existing.pid} host=${existing.hostname} ` +
          `heartbeat acum ${heartbeatAge}ms. Refuz boot. ` +
          `Daca proces precedent e mort, sterge ${lockPath(dataDir)} sau ` +
          `seteaza LEGAL_DASHBOARD_FORCE_BOOT=1.`
      );
      process.exit(1);
    }

    // Stale sau dead -> reclaim cu audit
    recordAudit(null, "instance.lock.reclaimed", {
      metadata: {
        previousPid: existing.pid,
        previousHostname: existing.hostname,
        previousHeartbeatAgeMs: heartbeatAge,
        stale,
        sameHost,
      },
    });
    try {
      unlinkSync(lockPath(dataDir));
    } catch {
      // best-effort -- writeLock overwrite va merge oricum
    }
  }

  writeLock(dataDir, appVersion);
  startHeartbeat(dataDir, appVersion);
}

function writeLock(dataDir: string, appVersion?: string): void {
  const record: LockRecord = {
    pid: process.pid,
    hostname: osHostname(),
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    version: appVersion,
  };
  writeFileSync(lockPath(dataDir), JSON.stringify(record), "utf-8");
}

let heartbeatTimer: NodeJS.Timeout | null = null;

function startHeartbeat(dataDir: string, appVersion?: string): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    try {
      const current = readLock(dataDir);
      if (!current || current.pid !== process.pid) return; // alt proces a reclamat
      writeLock(dataDir, appVersion); // refresh heartbeatAt
    } catch {
      // best-effort -- nu rupe procesul daca disk-ul are probleme tranzitorii
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref(); // nu tine event loop-ul

  // Cleanup la exit normal
  const cleanup = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    try {
      const current = readLock(dataDir);
      if (current && current.pid === process.pid) {
        unlinkSync(lockPath(dataDir));
      }
    } catch {
      // best-effort
    }
  };
  process.once("exit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}
```

**Pas 2**: Wire in boot. In `backend/src/index.ts` la pornire (dupa rezolvarea `dataDir` si inainte de a deschide DB-ul):

```ts
import { acquireInstanceLock } from "./db/instanceLock.ts";
import { APP_VERSION } from "./version.ts"; // sau echivalent

// inainte de orice import care deschide DB-ul:
acquireInstanceLock(dataDir, APP_VERSION);
```

**Pas 3**: In Electron `electron/main.js`, ruleaza inainte de `requestSingleInstanceLock()` (sau combine cu el — Electron lock-ul ramane single-user, instanceLock ramane cross-DB-directory).

### Test plan

**Unit tests** `backend/src/db/instanceLock.test.ts`:

1. Lockfile lipsa + boot normal → scrie lockfile cu PID curent + hostname.
2. Lockfile prezent + PID curent → refresh heartbeat (test ca `writeLock` e apelat la interval).
3. Lockfile prezent cu PID diferit + heartbeat proaspat + same host + process alive → `process.exit(1)` (mock `process.exit`).
4. Lockfile prezent cu PID mort + same host → reclaim + audit `instance.lock.reclaimed`.
5. Lockfile prezent cu hostname diferit + heartbeat stale → reclaim + audit.
6. `LEGAL_DASHBOARD_FORCE_BOOT=1` → ignora lockfile-ul, scrie peste.

**Integration** (manual smoke pe desktop):

7. Porneste app, verifica `.instance.lock` aparuta in `dataDir`.
8. Porneste un al doilea proces backend pe acelasi dataDir → al doilea face exit 1 cu mesaj clar.
9. Kill -9 procesul 1, asteapta 16s (3 * 5s heartbeat), porneste din nou → reclaim cu audit row vizibil.

### Biome files atinse

```bash
npx biome check --write backend/src/db/instanceLock.ts backend/src/db/instanceLock.test.ts backend/src/index.ts
```

### Risc rollback

Daca lockfile-ul cauzeaza false-positive in productie (NFS bug, race in container restart), `LEGAL_DASHBOARD_FORCE_BOOT=1` skip-uieste verificarea fara rebuild.

---

## HIGH-3 -- Rate-limit collapse pe IP-ul proxy-ului

**Estimat**: 1.5h | **Regresie desktop**: ZERO -- in absenta `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR`, `getClientIp(c)` returneaza `getConnInfo(c).remote.address` (comportament identic cu actualul).

### Problema

`backend/src/middleware/rate-limit.ts:33` foloseste `getConnInfo(c).remote.address` ca cheie de rate-limit. In productie Docker, **toate** request-urile vin de la oauth2-proxy (acelasi IP intern docker network). Asta colapseaza rate-limit-ul la un singur bucket global -- 100 req/min pe tot tenant-ul nu e per-user, e per-deployment. Acelasi pattern e in `originGuard.ts:53` pentru loopback bypass (mai putin grav, dar acelasi defect logic).

### Constrangeri

- Header X-Forwarded-For e spoofable in lipsa unui guard. Solutia este sa accepti X-Forwarded-For **doar daca** TCP peer e in lista `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` (CIDR list).
- IPv6-mapped-v4 (`::ffff:127.0.0.1`) trebuie normalizat la `127.0.0.1` pentru comparatii cu CIDR-uri v4.
- Comportamentul desktop ramane neschimbat: in lipsa env var, ramane pe TCP peer.

### Fix

**Pas 1**: Creeaza `backend/src/util/proxyIp.ts`:

```ts
// v2.33.0 -- detectie IP client real in spatele unui proxy de incredere.
//
// Defaultul (env var lipsa) este sigur: foloseste TCP peer-ul.
// Daca LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR e setat ca CSV de CIDR-uri (ex
// "10.0.0.0/8,172.16.0.0/12"), atunci pentru request-uri venite din acele
// CIDR-uri citim primul IP din X-Forwarded-For. Pentru orice altceva ignoram
// header-ul (defensiva impotriva spoofing).

import { BlockList, isIPv4, isIPv6 } from "node:net";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

function buildBlockList(cidrs: string): BlockList {
  const list = new BlockList();
  for (const raw of cidrs.split(",")) {
    const cidr = raw.trim();
    if (!cidr) continue;
    const [addr, maskStr] = cidr.split("/");
    if (!addr) continue;
    const family = isIPv4(addr) ? "ipv4" : isIPv6(addr) ? "ipv6" : null;
    if (!family) {
      console.warn(`[proxyIp] CIDR invalid ignorat: ${cidr}`);
      continue;
    }
    const mask = maskStr ? Number(maskStr) : family === "ipv4" ? 32 : 128;
    if (!Number.isFinite(mask)) {
      console.warn(`[proxyIp] mask invalida ignorata: ${cidr}`);
      continue;
    }
    try {
      list.addSubnet(addr, mask, family);
    } catch (err) {
      console.warn(`[proxyIp] addSubnet failed pentru ${cidr}:`, err);
    }
  }
  return list;
}

let trustedProxies: BlockList | null = null;
let trustedProxiesEnvSnapshot: string | undefined;

function getTrustedProxies(): BlockList | null {
  const env = process.env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR;
  if (env !== trustedProxiesEnvSnapshot) {
    trustedProxiesEnvSnapshot = env;
    trustedProxies = env ? buildBlockList(env) : null;
  }
  return trustedProxies;
}

// IPv6-mapped IPv4 -> IPv4 dotted-quad
function normalize(addr: string): string {
  if (addr.startsWith("::ffff:")) {
    const v4 = addr.slice(7);
    if (isIPv4(v4)) return v4;
  }
  return addr;
}

function checkTrusted(list: BlockList, addr: string): boolean {
  if (isIPv4(addr)) return list.check(addr, "ipv4");
  if (isIPv6(addr)) return list.check(addr, "ipv6");
  return false;
}

/**
 * Returneaza IP-ul client real:
 *   - Daca exista trusted proxy CIDR si TCP peer e in CIDR -> primul X-Forwarded-For
 *   - Altfel -> TCP peer (normalized)
 *   - Returneaza "" daca nu se poate determina.
 */
export function getClientIp(c: Context): string {
  const peer = getConnInfo(c).remote.address;
  if (!peer) return "";
  const normalizedPeer = normalize(peer);

  const list = getTrustedProxies();
  if (!list) return normalizedPeer;
  if (!checkTrusted(list, normalizedPeer)) return normalizedPeer;

  const xff = c.req.header("x-forwarded-for");
  if (!xff) return normalizedPeer;

  // First IP in XFF = original client. Trusted-proxy chain logic complete
  // (single hop) ar fi peste scope. Daca exista 2+ proxies, opereaza-i pe toti
  // sub acelasi CIDR si traverseaza.
  const candidates = xff.split(",").map((s) => s.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (!checkTrusted(list, normalized)) {
      return normalized;
    }
  }
  // Toate IP-urile din XFF sunt in trusted CIDR -> primul (cel mai aproape de
  // client). Edge case: setup-uri foarte exotice cu multiple proxies in acelasi
  // subnet.
  return normalize(candidates[0] ?? normalizedPeer);
}

// Exportat pentru teste
export function _resetCacheForTests(): void {
  trustedProxies = null;
  trustedProxiesEnvSnapshot = undefined;
}
```

**Pas 2**: Wire in `backend/src/middleware/rate-limit.ts:33`:

```ts
import { getClientIp } from "../util/proxyIp.ts";

// ...
const ip = getClientIp(c);
if (!ip) {
  return fail(c, 503, "origin_unavailable", "Origine indisponibila.");
}
```

(restul `rateLimit` ramane identic — bucket-ul devine corect per client real)

**Pas 3**: Wire in `backend/src/middleware/originGuard.ts:53`:

```ts
import { getClientIp } from "../util/proxyIp.ts";

// ...
const remoteAddr = getClientIp(c);
if (LOOPBACK_ADDRESSES.has(remoteAddr)) {
  await next();
  return;
}
```

**Pas 4**: Update `deploy/.env.prod.example` cu:

```
# IP CIDRs trusted to set X-Forwarded-For. In docker-compose stack default este
# bridge network 172.16.0.0/12. Daca rulezi behind un alt L7 (Cloudflare,
# fastly), include si CIDR-ul lor (NU folosi 0.0.0.0/0 — spoofable).
LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR=172.16.0.0/12,10.0.0.0/8
```

### Test plan

**Unit tests** `backend/src/util/proxyIp.test.ts`:

1. Env var lipsa + TCP peer `1.2.3.4` → returneaza `1.2.3.4`.
2. Env var lipsa + XFF `5.6.7.8` + TCP peer `1.2.3.4` → returneaza `1.2.3.4` (XFF ignorat).
3. Env `10.0.0.0/8` + TCP peer `10.0.0.5` + XFF `5.6.7.8` → returneaza `5.6.7.8`.
4. Env `10.0.0.0/8` + TCP peer `192.168.1.1` + XFF `5.6.7.8` → returneaza `192.168.1.1` (peer untrusted, XFF ignorat).
5. Env `10.0.0.0/8` + TCP peer `::ffff:10.0.0.5` + XFF `5.6.7.8` → returneaza `5.6.7.8` (normalizare IPv6-mapped).
6. Env `10.0.0.0/8` + TCP peer `10.0.0.5` + XFF `5.6.7.8, 10.0.0.1` → returneaza `5.6.7.8` (primul untrusted).
7. CIDR invalid in env (`bogus,10.0.0.0/8`) → ignora bogusul, accepta restul (verifica `console.warn`).

**Integration** in `rate-limit.test.ts`:

8. Mock 2 request-uri din IP-uri diferite via XFF (ambele cu TCP peer trusted) → 2 buckets separate.

### Biome files atinse

```bash
npx biome check --write \
  backend/src/util/proxyIp.ts \
  backend/src/util/proxyIp.test.ts \
  backend/src/middleware/rate-limit.ts \
  backend/src/middleware/originGuard.ts \
  deploy/.env.prod.example
```

### Risc rollback

Daca XFF parsing introduce regresii (ex. un proxy nou trimite IPv6 zone-id `fe80::1%eth0`), `unset LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` rezolva instant fara redeploy.

---

## MEDIUM-5 -- Caddy nu strip-uieste header-e de auth de la client

**Estimat**: 30 min | **Regresie desktop**: N/A (Caddyfile e doar server).

### Problema

Daca un client trimite `X-Proxy-Auth: <ghicire>` sau `X-Auth-Request-Email: admin@x.com` direct prin clientul HTTPS, Caddy NU strip-uieste headerele inainte de a forward-a la oauth2-proxy. oauth2-proxy reinjecteaza propriile valori, dar daca el e ocolit accidental (config drift) sau daca atacatorul gaseste un endpoint care nu trece prin oauth2-proxy, header-ul de impersonare ajunge la backend.

Defense-in-depth: stripeaza headerele de auth la edge (Caddy), inainte ca traffic-ul sa ajunga la oauth2-proxy.

### Fix

Modifica `deploy/Caddyfile` blocul `reverse_proxy oauth2-proxy:4180`:

```caddyfile
	reverse_proxy oauth2-proxy:4180 {
		header_up Host {host}
		header_up X-Real-IP {remote}
		header_up X-Forwarded-For {remote}
		header_up X-Forwarded-Proto {scheme}

		# Defense-in-depth (v2.33.0): refuza orice header de impersonare
		# venit de la client. oauth2-proxy reinjecteaza valorile corecte din
		# sesiune. Daca un client trimite vreodata aceste headere, le stergem
		# inainte sa atinga oauth2-proxy sau backend-ul.
		header_up -X-Proxy-Auth
		header_up -X-Auth-Request-Email
		header_up -X-Auth-Request-User
		header_up -X-Auth-Request-Groups
		header_up -X-Auth-Request-Access-Token
		header_up -X-Auth-Request-Preferred-Username
		header_up -X-Forwarded-User
		header_up -X-Forwarded-Email
		header_up -X-Forwarded-Groups
		header_up -X-Forwarded-Preferred-Username
		header_up -X-Forwarded-Access-Token
	}
```

### Test plan

**Smoke manual** post-deploy:

1. `curl -H "X-Auth-Request-Email: foo@bar" https://${DOMAIN}/api/v1/auth/oauth2/sync` → 401/403 (oauth2-proxy nu vede header-ul, deci nu-l propaga).
2. Verifica `docker compose logs caddy | grep X-Auth-Request-Email` → nu apare (Caddy nu primeste header-ul mai departe).
3. Login normal Google OAuth → functioneaza (oauth2-proxy seteaza headerele dupa sesiunea reala).

### Biome files atinse

```bash
# Nu e fisier JavaScript, Biome nu se aplica.
```

### Risc rollback

Daca o integrare interna foloseste vreunul din headerele stripite, sterge linia specifica din Caddyfile + `docker compose restart caddy`.

---

## MEDIUM-10 -- Docker image-uri pinuite doar pe tag

**Estimat**: 1h | **Regresie**: ZERO -- digest-pin e doar mai strict, nu schimba semantica.

### Problema

`deploy/docker-compose.prod.yml:19, 38` foloseste tag-uri Docker (`caddy:2.8-alpine`, `quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine`). Tag-urile sunt re-publicabile -- daca un atacator obtine credentialele registrului sau daca admin-ul repinge accidental tag-ul cu un build modificat, deploy-ul urmator ia imaginea schimbata fara cunostinta. Digest-pin (`@sha256:...`) garanteaza ca un image identificat este exact byte-ul publicat la momentul T.

### Fix

**Pas 1**: Obtine digest-urile curente pentru fiecare imagine. Ruleaza local **inainte de PR**:

```bash
docker pull caddy:2.8-alpine
docker inspect caddy:2.8-alpine --format '{{index .RepoDigests 0}}'
# Exemplu output: caddy@sha256:abcd1234...

docker pull quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine
docker inspect quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine --format '{{index .RepoDigests 0}}'
```

**Pas 2**: Modifica `deploy/docker-compose.prod.yml`:

```yaml
  caddy:
    # v2.33.0 digest-pinned. Tag-ul + digest-ul sunt ambele explicite pentru
    # citire usoara; doar digest-ul conteaza pentru pull. Refresh digest la
    # fiecare bump de tag (vezi infra/docker-digests.md).
    image: caddy:2.8-alpine@sha256:<DIGEST_AICI>
    # ...

  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.7.1-alpine@sha256:<DIGEST_AICI>
    # ...
```

**Pas 3**: Creeaza `infra/docker-digests.md` (fisier nou) cu procedura de refresh:

```markdown
# Docker image digest pinning

`deploy/docker-compose.prod.yml` foloseste image digest-pin (`tag@sha256:...`)
pentru caddy si oauth2-proxy. Tag-urile pot fi re-pushate de upstream;
digest-ul nu.

## Refresh dupa bump de tag

```bash
# 1. Pull tag-ul nou
docker pull caddy:2.9-alpine

# 2. Obtine digest-ul
docker inspect caddy:2.9-alpine --format '{{index .RepoDigests 0}}'

# 3. Update docker-compose.prod.yml cu noul digest

# 4. Rebuild + restart stack
docker compose -f deploy/docker-compose.prod.yml pull caddy
docker compose -f deploy/docker-compose.prod.yml up -d caddy
```

## Trail de schimbari

| Data | Imagine | Tag | Digest (prefix) | Motiv |
|------|---------|-----|-----------------|-------|
| 2026-05-19 | caddy | 2.8-alpine | sha256:<TBD> | Initial pinning (v2.33.0) |
| 2026-05-19 | oauth2-proxy | v7.7.1-alpine | sha256:<TBD> | Initial pinning (v2.33.0) |
```

**Pas 4**: Verifica CI: daca exista un job care builds + push backend-ul cu tag versioned, NU schimba acum (backend-ul are tag = `${APP_VERSION}` care e local-built, deci re-push e controlat de noi).

### Test plan

**Smoke** post-deploy:

1. `docker compose -f deploy/docker-compose.prod.yml pull` → verifica ca digestul publicat matches.
2. `docker compose up -d` → stack porneste.
3. `curl https://${DOMAIN}/health` → 200 OK.

### Biome files atinse

```bash
# Nu e fisier JavaScript, Biome nu se aplica.
```

### Risc rollback

Daca digest-ul publicat este retras (rar, dar posibil), schimba `@sha256:xxx` cu `:tag` simplu si rebuild. Documenteaza in `infra/docker-digests.md`.

---

## Checklist pre-push

```bash
# 1. Biome
npx biome check --write \
  backend/src/db/instanceLock.ts \
  backend/src/db/instanceLock.test.ts \
  backend/src/util/proxyIp.ts \
  backend/src/util/proxyIp.test.ts \
  backend/src/middleware/rate-limit.ts \
  backend/src/middleware/originGuard.ts \
  backend/src/index.ts

# 2. Type-check
npx tsc --noEmit -p backend/tsconfig.json

# 3. Build
npm run build

# 4. Tests backend
npm test --workspace=backend

# 5. Manual smoke
#   - Lanseaza electron:dev -> verifica .instance.lock se scrie in dataDir
#   - Porneste a doua instanta backend pe acelasi dataDir -> verifica exit 1
#   - Setup local: LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR=127.0.0.1/32 + XFF header
#     in curl -> verifica logul `rate-limit` opereaza pe IP-ul XFF
```

---

## Constrangeri NON-NEGOTIABLE re-confirmate

- Repository-only DB access: instanceLock.ts foloseste `fs` direct + audit prin `recordAudit` (nu SQL raw inafara `db/`).
- `recordAudit(null, ...)` cu owner NULL este permis pentru system events (vezi auditRepository L111-112 comment).
- Desktop ZERO impact: `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` lipsa + `LEGAL_DASHBOARD_FORCE_BOOT` lipsa = comportament identic cu v2.32.0.
- LAN bind opt-in (`LEGAL_DASHBOARD_ALLOW_REMOTE=1`) ramane neatins.
- Caddyfile schimbarea e pur defensive-in-depth — oauth2-proxy ramane single source of truth pentru auth headers.

---

## Risk surface

| Modificare | Blast radius | Rollback |
|------------|--------------|----------|
| `instanceLock.ts` boot gate | Boot procesual (desktop + Docker) | `LEGAL_DASHBOARD_FORCE_BOOT=1` |
| `proxyIp.ts` + wire | Rate-limit + originGuard pe productie web | unset `LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR` |
| Caddyfile strip headers | Doar productie web behind Caddy | revert Caddyfile + `docker compose restart caddy` |
| Docker digest pin | Pull cu digest exact | revert la `:tag` simplu si rebuild |

Toate 4 sunt rollback-able fara redeploy de cod backend.
