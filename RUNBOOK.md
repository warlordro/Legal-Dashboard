# Legal Dashboard - RUNBOOK Operational

**Versiune**: v2.34.0
**Data ultima revizie**: 2026-05-20
**Audienta**: admin firma (ops + IT) responsabil cu rularea aplicatiei.

Runbook centralizat cu procedurile de recovery, rollback si troubleshooting pentru
desktop (Electron) si web mode (Hono backend + frontend SPA). Foloseste-l in
incidente — fiecare sectiune incepe cu simptomul si se termina cu pasii concreti.

---

## 1. Incidente comune — index simptom -> sectiune

| Simptom | Sectiune |
|---------|----------|
| Aplicatia nu porneste / "Backend nu raspunde" | §3 - Boot failure |
| Eroare "database is locked" / SQLite corruption | §4 - DB corruption |
| User-ul vrea sa restaureze un backup vechi | §5 - Restore din backup local |
| DB-ul local pierdut/sters fizic | §6 - Restore din offsite backup |
| TENANT_KEY_ENCRYPTION_SECRET pierdut | §7 - Tenant key loss |
| Bug critic in productie - rollback la versiunea precedenta | §8 - Rollback versiune |
| Captcha cota epuizata pentru toti userii | §9 - Reset cota captcha urgent |
| Web mode - userii nu mai pot loga (JWT issuer/audience) | §10 - JWT key rotation |
| Investigatie post-incident (logs, audit) | §11 - Forensics |
| Boot abortat: "monolitul contine din nou randuri RNPM" | "Monolit restaurat dupa split" (v2.43.0) |
| Boot abortat: "ownerId invalid pentru operatii pe fisiere" | "Owner invalid la split" (v2.43.0) |
| Backup/restore pe datele RNPM ale unui singur user | "Backup si restore per utilizator (RNPM)" |

---

## 2. Pregatire — ce trebuie sa stii inainte de un incident

### 2.1 Locatii fisiere critice

**Desktop (Windows)**:
- DB: `%APPDATA%\Legal Dashboard\legal-dashboard.db`
- Backups locali: `%APPDATA%\Legal Dashboard\backups\` (7 daily + 5 pre-restore + 5 pre-migration)
- Logs Electron: `%APPDATA%\Legal Dashboard\logs\` (rotate 7 zile)
- Settings UI: `%APPDATA%\Legal Dashboard\Local Storage\` (preferinte, ciphertext keys)

**Web mode (server)**:
- DB: `${LEGAL_DASHBOARD_DB_PATH}` (default `./data/legal-dashboard.db`)
- Backups locali: `<dirname(DB)>/backups/`
- Logs container: `docker logs <container>` sau cale mounted
- Tenant key encryption: `TENANT_KEY_ENCRYPTION_SECRET` env (32 bytes base64)

### 2.2 Comenzi de diagnostic rapid

```bash
# Health endpoint - confirma ca procesul raspunde
curl -fsS http://127.0.0.1:3002/health

# SQLite integrity_check - confirma DB intact
sqlite3 /path/to/legal-dashboard.db "PRAGMA integrity_check;"
# Output asteptat: "ok" pe o singura linie

# Listeaza backupurile disponibile
ls -lt /path/to/backups/

# Verifica versiune curenta (web mode)
curl -fsS http://127.0.0.1:3002/health | jq .version
```

### 2.3 Variabile env critice (web mode)

| Variabila | Cand e necesara | Note |
|-----------|-----------------|------|
| `LEGAL_DASHBOARD_AUTH_MODE=web` | Mereu in web mode | Fail-fast la boot daca lipseste |
| `LEGAL_DASHBOARD_JWT_SECRET` | Mereu in web mode | >=32 chars; rotatia invalideaza toate sesiunile |
| `LEGAL_DASHBOARD_JWT_ISSUER` | Mereu in web mode | trebuie sa fie URL absolut (issuer OIDC) |
| `LEGAL_DASHBOARD_JWT_AUDIENCE` | Mereu in web mode | client_id sau identifier resource API |
| `TENANT_KEY_ENCRYPTION_SECRET` | Mereu in web mode | 32 bytes base64; **pierderea inseamna pierderea cheilor API tenant** |
| `LEGAL_DASHBOARD_ALLOW_REMOTE=1` | Cand HOST != loopback | Fail-closed gate; necesita si `LEGAL_DASHBOARD_AUTH_MODE=web` + JWT valid, altfel boot-ul esueaza |
| `LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD` | Recomandat in web mode | Command shell pentru upload (vezi §2.4) |
| `LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA` | Optional | Default cap captcha/zi per user fara override |

### 2.4 Backup offsite — configurare initiala

`LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD` ruleaza shell command-ul cu calea backup-ului
expusa prin env var `LEGAL_DASHBOARD_BACKUP_PATH` (`$LEGAL_DASHBOARD_BACKUP_PATH` pe
POSIX, `%LEGAL_DASHBOARD_BACKUP_PATH%` pe Windows) — NU ca pozitional `$1`/`%1`,
DUPA fiecare daily backup reusit. Hook-ul nu afecteaza succesul backup-ului local
— el e un strat de redundanta.

**Exemple practice**:

```bash
# rclone (recomandat - multi-cloud + retry built-in)
export LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD='rclone copy "$LEGAL_DASHBOARD_BACKUP_PATH" s3:legal-dashboard-backups/$(date +%Y/%m)/'

# AWS S3 direct (necesita aws-cli + credentials configurate)
export LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD='aws s3 cp "$LEGAL_DASHBOARD_BACKUP_PATH" s3://legal-dashboard-backups/$(date +%Y/%m)/'

# Azure Blob
export LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD='az storage blob upload --container-name legal-dashboard --file "$LEGAL_DASHBOARD_BACKUP_PATH" --name "$(date +%Y/%m)/$(basename "$LEGAL_DASHBOARD_BACKUP_PATH")"'

# SCP catre server backup
export LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD='scp "$LEGAL_DASHBOARD_BACKUP_PATH" backups@offsite.firma.ro:/var/backups/legal-dashboard/'

# rsync
export LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD='rsync -av "$LEGAL_DASHBOARD_BACKUP_PATH" backups@offsite.firma.ro:/var/backups/legal-dashboard/'
```

**Timeout**: 10 minute. Daca hook-ul nu termina, e ucis SIGKILL si logat ca failure.
**Logging**: cauta `"action":"offsite_backup"` (success) sau `"action":"offsite_backup_failed"` in stdout.

**Securitate (audit O3)**: valoarea e pasata verbatim catre `sh -c` (POSIX) sau `cmd /c` (Windows), deci e echivalenta cu executie de cod arbitrar la privilegiul user-ului OS sub care ruleaza backend-ul. Seteaz-o doar din env-ul shell/orchestrator de catre operatorul de incredere, niciodata derivata din vreun request sau alt input neverificat, si niciodata commit-uita intr-un `.env` livrat.

**Test inainte de productie**:
```bash
# Forteaza un daily backup manual ca sa verifici hook-ul
# (curl ruta admin sau in Electron: Setari -> Backup -> Daily backup acum)
# Apoi cauta in logs:
journalctl -u legal-dashboard | grep offsite_backup
```

---

## 3. Boot failure — procesul nu porneste

### Simptome
- `npm run electron:dev` exita imediat
- `docker logs ld-container` arata stack trace la pornire
- `/health` raspunde connection refused

### Diagnostic

```bash
# Last 50 lines de logs
docker logs --tail 50 ld-container
# sau pe desktop:
# %APPDATA%\Legal Dashboard\logs\main.log

# Verifica env vars (web mode)
docker exec ld-container env | grep -E "LEGAL_DASHBOARD|JWT|TENANT"
```

### Cauze comune

| Eroare in log | Cauza | Fix |
|---------------|-------|-----|
| `JWT_SECRET must be >= 32 chars` | secret prea scurt | Genereaza: `openssl rand -base64 48`, set env, restart |
| `TENANT_KEY_ENCRYPTION_SECRET decrypt round-trip failed` | secret invalid (nu 32 bytes base64) | Decode test: `echo $TENANT_KEY_ENCRYPTION_SECRET \| base64 -d \| wc -c` trebuie 32 |
| `EADDRINUSE: port 3002` | Alt proces ocupa portul | `netstat -anp \| grep 3002` -> kill PID-ul vechi |
| `ELECTRON_RUN_AS_NODE` TypeError (desktop) | env var leaked din test | `unset ELECTRON_RUN_AS_NODE`, relanseaza |
| `better-sqlite3 ERR_DLOPEN_FAILED` (desktop) | ABI mismatch Node vs Electron | `npx prebuild-install --runtime=electron --target=41.5.0` in `node_modules/better-sqlite3`, apoi relanseaza |
| `SQLite ... unable to open database file` | DB path nu exista / permissions | `chmod 644 $LEGAL_DASHBOARD_DB_PATH` + verifica owner |
| `migrations failed` | Migration ne-aplicata si DB locked | Vezi §4 |

---

## 4. DB corruption / integrity check fail

### Simptome
- `PRAGMA integrity_check` returneaza altceva decat `ok`
- Erori `SqliteError: database disk image is malformed`
- Aplicatia pornest dar listari random ies goale / cu erori

### Diagnostic

```bash
# Confirma corruption
sqlite3 /path/to/legal-dashboard.db "PRAGMA integrity_check;" | head -20

# Verifica WAL/SHM stale (ar trebui sa fie pereche cu DB-ul)
ls -l /path/to/legal-dashboard.db*
```

### Fix

1. **Opreste procesul** (Electron quit / `docker stop ld-container`).
2. **Cauta cel mai recent daily backup curat**:
   ```bash
   ls -lt /path/to/backups/ | head -10
   ```
3. **Verifica integritatea backup-ului inainte sa il folosesti**:
   ```bash
   sqlite3 /path/to/backups/legal-dashboard.2026-05-19.db "PRAGMA integrity_check;"
   # Trebuie sa returneze "ok"
   ```
4. **Restaureaza** — vezi §5.

**ATENTIE**: NU rula procesul peste DB-ul corupt sperand sa "se repare". WAL frames stale pot agrava corruption-ul.

---

## 5. Restore din backup local

### Cand
User-ul vrea sa revina la o zi anterioara, sau dupa o migrare gresita.

### Procedura

**Desktop**:
1. Settings -> Backup & Restore -> alege fisierul -> Restore
2. UI confirma + salveaza un snapshot `pre-restore-<timestamp>` automat
3. Aplicatia repornește automat pe DB-ul nou

**Web mode (server, fara UI)**:
```bash
# Opreste procesul
docker stop ld-container

# Backup defensiv al DB-ului curent (fail-safe daca restore-ul nu reuseste)
cp /path/to/legal-dashboard.db /path/to/legal-dashboard.db.before-manual-restore

# Sterge WAL/SHM stale (CRITIC - altfel WAL stale se merge in DB-ul nou)
rm -f /path/to/legal-dashboard.db-wal /path/to/legal-dashboard.db-shm

# Restaureaza
cp /path/to/backups/legal-dashboard.2026-05-19.db /path/to/legal-dashboard.db

# Verifica integritate inainte sa repornesti
sqlite3 /path/to/legal-dashboard.db "PRAGMA integrity_check;"
# Trebuie "ok"

# Reporneste
docker start ld-container

# Confirma health
curl -fsS http://127.0.0.1:3002/health
```

### Rollback restore (am restaurat ce nu trebuia)

Aplicatia salveaza un `pre-restore-<timestamp>.db` inainte de orice restore.

```bash
docker stop ld-container
rm -f /path/to/legal-dashboard.db-wal /path/to/legal-dashboard.db-shm
cp /path/to/backups/legal-dashboard.pre-restore-2026-05-19T14-23-15-123Z.db /path/to/legal-dashboard.db
sqlite3 /path/to/legal-dashboard.db "PRAGMA integrity_check;"  # trebuie "ok"
docker start ld-container
```

---

## 6. Restore din offsite backup (DB local pierdut)

### Cand
- Hardware failure server
- Disk corruption pe volumul DB
- Ransomware (DB local criptat de atacator)

### Procedura

1. **Identifica cel mai recent backup offsite** (depinde de transport-ul folosit):
   ```bash
   # rclone S3
   rclone ls s3:legal-dashboard-backups/ | sort -k4 | tail -10

   # AWS CLI
   aws s3 ls s3://legal-dashboard-backups/ --recursive | sort | tail -10
   ```

2. **Descarca pe server-ul nou**:
   ```bash
   rclone copy s3:legal-dashboard-backups/2026/05/legal-dashboard.2026-05-19.db /path/to/restored/
   ```

3. **Verifica integritatea**:
   ```bash
   sqlite3 /path/to/restored/legal-dashboard.2026-05-19.db "PRAGMA integrity_check;"
   ```

4. **Plaseaza in DB path** + porneste:
   ```bash
   mkdir -p /path/to/data/
   cp /path/to/restored/legal-dashboard.2026-05-19.db /path/to/data/legal-dashboard.db

   # IMPORTANT: TENANT_KEY_ENCRYPTION_SECRET trebuie sa fie ACELASI ca atunci cand
   # backup-ul a fost facut. Altfel: tenant_api_keys.encrypted_blob nu se mai
   # decripteaza (vezi §7).

   docker run -d --name ld-restored \
     -e LEGAL_DASHBOARD_DB_PATH=/data/legal-dashboard.db \
     -e LEGAL_DASHBOARD_AUTH_MODE=web \
     -e LEGAL_DASHBOARD_JWT_SECRET=$PROD_JWT_SECRET \
     -e LEGAL_DASHBOARD_JWT_ISSUER=$PROD_JWT_ISSUER \
     -e LEGAL_DASHBOARD_JWT_AUDIENCE=$PROD_JWT_AUDIENCE \
     -e TENANT_KEY_ENCRYPTION_SECRET=$PROD_TENANT_KEY_SECRET \
     -v /path/to/data:/data \
     -p 3002:3002 \
     legal-dashboard:vX.Y.Z

   # Wait + health
   sleep 10
   curl -fsS http://127.0.0.1:3002/health
   ```

### Cat de vechi e backup-ul offsite?

Hook-ul ruleaza dupa fiecare daily backup local. RPO (Recovery Point Objective)
maxim: **24h pierdere de date** (intre daily backup-uri).

Daca ai nevoie RPO mai mic, configureaza monitoring + alert pentru lipsa
backup-urilor recente (cauta `"action":"daily_backup"` in logs > 25h vechi).

---

## 7. Tenant key encryption — pierderea TENANT_KEY_ENCRYPTION_SECRET

### Simptom
Web mode boot fail: `decrypt round-trip self-test failed` sau toate cheile tenant
(`/admin/tenant-keys`) raporteaza "decrypt error" la GET.

### Realitate dura
Cheile API tenant (OpenAI, Anthropic, 2Captcha, etc.) sunt criptate AES-256-GCM cu
`TENANT_KEY_ENCRYPTION_SECRET`. Pierderea lui = cheile API sunt **inaccesibile pe
veci** (criptografic, nu doar "pierdute logic"). Nu exista path de recovery.

### Mitigare
1. **Re-genereaza un master secret nou**:
   ```bash
   openssl rand -base64 32
   ```
2. **Sterge toate cheile tenant din DB** (raman blob-uri orphan inaccesibile):
   ```bash
   sqlite3 /path/to/legal-dashboard.db "DELETE FROM tenant_api_keys;"
   ```
3. **Set noul secret in env + restart**.
4. **Admin re-introduce cheile API** in `/admin/tenant-keys`.

### Prevenire — checklist obligatoriu inainte de prod web mode
- [ ] `TENANT_KEY_ENCRYPTION_SECRET` e generat cryptographic-strong (`openssl rand`).
- [ ] Stocat in **secret manager** (HashiCorp Vault / AWS Secrets Manager / Azure Key Vault).
- [ ] **Replicat in 2+ locatii fizice distincte** (secret manager primary + sealed paper backup in safe).
- [ ] Procedura rotire **documentata** si testata (vezi §10).

---

## 8. Rollback la versiune precedenta

### Cand
Bug critic in vX.Y.Z care nu se poate hotfix-ui repede; revenirea la vX.Y.Z-1 e necesara.

### Pre-rollback — verifica compatibility DB

Migration-urile sunt forward-only by default. Inainte de rollback verifica daca
versiunea tinta avea **acelasi `current_migration_version`** ca cea curenta.

```bash
sqlite3 /path/to/legal-dashboard.db "SELECT MAX(version) FROM _schema_versions;"
```

Daca migration-urile sunt diferite intre versiuni: NU rollback la versiunea de cod
fara sa rulezi si `.down.sql`-urile manual. Altfel, schema veche + cod vechi pe
schema noua = behaviour nedefinit.

### Procedura

```bash
# 1. Opreste procesul curent
docker stop ld-container
docker rm ld-container

# 2. Snapshot defensiv al DB-ului curent (rollback la rollback)
cp /path/to/legal-dashboard.db /path/to/legal-dashboard.db.before-rollback-$(date +%Y%m%d%H%M%S)

# 3. Daca versiunea tinta are migration index mai mic, ruleaza .down.sql-urile
# manual (in ordine descrescatoare, una cate una).
# Migration files: backend/src/db/migrations/NNNN_<name>.down.sql

# Exemplu rollback de la migration 0033 -> 0032 (ruleaza cu -bail ca o eroare
# sa opreasca scriptul, nu sa continue pe jumatate):
sqlite3 -bail /path/to/legal-dashboard.db < backend/src/db/migrations/0033_captcha_usage.down.sql
# Din v2.37.1 fiecare .down.sql isi sterge singur randul din _schema_versions.
# Verifica:
sqlite3 /path/to/legal-dashboard.db "SELECT MAX(version) FROM _schema_versions;"

# 4. Porneste versiunea anterioara
docker run -d --name ld-container \
  -e LEGAL_DASHBOARD_DB_PATH=/data/legal-dashboard.db \
  ... (toate env vars-urile productiei)
  -v /path/to/data:/data \
  -p 3002:3002 \
  legal-dashboard:vX.Y.Z-1

# 5. Health check
sleep 10
curl -fsS http://127.0.0.1:3002/health
```

### Rollback specific: migratia 0034 (monitoring kind `iccj`)

Down-ul 0034 reconstruieste `monitoring_jobs` cu CHECK-ul vechi pe 3 kinds si
**esueaza intentionat (fail-loud)** daca mai exista joburi `kind='iccj'`.
Procedura completa:

```bash
# 1. Opreste aplicatia (vezi Procedura, pasul 1) + snapshot defensiv (pasul 2).

# 2. Sterge joburile iccj — CASCADE curata runs/snapshots/alerts aferente:
sqlite3 /path/to/legal-dashboard.db "DELETE FROM monitoring_jobs WHERE kind='iccj';"

# 3. Ruleaza down-ul cu -bail. IMPORTANT: foloseste sqlite3 CLI (foreign_keys
# OFF by default). Tooling cu PRAGMA foreign_keys=ON ar declansa CASCADE-wipe
# pe snapshots/runs/alerts la DROP TABLE monitoring_jobs.
sqlite3 -bail /path/to/legal-dashboard.db < backend/src/db/migrations/0034_iccj_job_kind.down.sql

# 4. Verifica jurnalul de versiuni (down-ul sterge singur randul 34):
sqlite3 /path/to/legal-dashboard.db "SELECT MAX(version) FROM _schema_versions;"  # asteptat: 33

# 5. Instaleaza binarul versiunii anterioare (v2.36.x).
```

### Rollback specific: migratiile 0036-0038 (v2.38.0 -> v2.37.1)

v2.38.0 a adaugat exact trei migratii peste v2.37.1 (0036, 0037, 0038). Migratia
0035 e parte din v2.37.1, deci rollback-ul catre v2.37.1 face down DOAR pe cele
trei migratii v2.38.0 si se opreste la versiunea 35 (binarul v2.37.1 are 0035 pe
disk si l-ar re-aplica la boot daca DB-ul ar cobori sub 35).

Down-run in ordine descrescatoare, una cate una, cu `-bail` per fisier (o eroare
opreste scriptul, nu continua pe jumatate). Dupa fiecare pas confirma
`MAX(version)` din `_schema_versions` (fiecare down isi sterge singur randul).

```bash
# 1. Opreste aplicatia (vezi Procedura, pasul 1) + snapshot defensiv (pasul 2).

# 2. Down 0038 -> 0037 (drop jwt_denylist):
sqlite3 -bail /path/to/legal-dashboard.db < backend/src/db/migrations/0038_jwt_denylist.down.sql
sqlite3 /path/to/legal-dashboard.db "SELECT MAX(version) FROM _schema_versions;"  # asteptat: 37

# 3. Down 0037 -> 0036 (drop coloanele latency_ms/error_type din ai_usage):
sqlite3 -bail /path/to/legal-dashboard.db < backend/src/db/migrations/0037_ai_usage_latency.down.sql
sqlite3 /path/to/legal-dashboard.db "SELECT MAX(version) FROM _schema_versions;"  # asteptat: 36

# 4. Down 0036 -> 0035 (no-op pe date):
sqlite3 -bail /path/to/legal-dashboard.db < backend/src/db/migrations/0036_openrouter_stack_western.down.sql
sqlite3 /path/to/legal-dashboard.db "SELECT MAX(version) FROM _schema_versions;"  # asteptat: 35

# 5. Instaleaza binarul versiunii anterioare (v2.37.1). NU rula down pe 0035 —
#    e parte din v2.37.1; binarul nou il are pe disk si l-ar re-aplica la boot.
```

Atentie la doua down-uri non-reversibile pe date:

`0036` down e no-op pe DATE — coercia `chinese -> western` din up e ireversibila
(nu putem sti care owneri aveau `chinese`). Valorile originale `chinese` sunt
recuperabile DOAR dintr-un backup pre-0036 (vezi hook-ul `schema-upgrade`).

`0038` down face `DROP TABLE jwt_denylist`: tokenele revocate-dar-neexpirate redevin
valide pana isi ating TTL-ul. Daca un logout/revocare era motivat de securitate,
roteste `LEGAL_DASHBOARD_JWT_SECRET` dupa rollback ca sa invalidezi toate tokenele.

### Daca rollback-ul nu mai porneste

Restore-uieste pre-rollback snapshot-ul si raman pe versiunea cu bug pana la
hotfix:
```bash
cp /path/to/legal-dashboard.db.before-rollback-* /path/to/legal-dashboard.db
docker run ... legal-dashboard:vX.Y.Z  # versiunea curenta
```

---

## 9. Reset cota captcha urgent

### Cand
Adminul a configurat un cap captcha prea jos accidental, toti userii sunt 429.

### Diagnostic
```bash
# Vezi cati useri sunt aproape de cap (24h window)
sqlite3 /path/to/legal-dashboard.db "
  SELECT owner_id, COUNT(*) AS used
    FROM captcha_usage
   WHERE source = 'tenant'
     AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-86400 seconds')
   GROUP BY owner_id
   ORDER BY used DESC
   LIMIT 20;
"
```

### Fix rapid

**Optiunea A — ridica cap-ul global** (env, restart):
```bash
export LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA=500
docker restart ld-container
```

**Optiunea B — sterge override-ul stricte din UI**:
- Login as admin -> `/admin/quota` -> deselect users with override `captcha.rnpm`.

**Optiunea C — sterge consumption-ul (NU se recomanda, distorsioneaza audit)**:
```bash
sqlite3 /path/to/legal-dashboard.db "DELETE FROM captcha_usage WHERE owner_id = '<user_id>';"
```

---

## 10. JWT key rotation (web mode)

### Cand
- Suspiciune ca `JWT_SECRET` a fost leaked
- Rotatia planificata (recomandat la fiecare 90 zile)

### Impact
Toate sesiunile active sunt invalidate. Useri vor trebui sa re-loghez.

### Procedura

```bash
# 1. Genereaza secret nou
NEW_SECRET=$(openssl rand -base64 48)
echo "NEW JWT_SECRET (salveaza in vault!): $NEW_SECRET"

# 2. Update in secret manager / env

# 3. Restart procesul
docker stop ld-container
docker run -d ... -e LEGAL_DASHBOARD_JWT_SECRET="$NEW_SECRET" ...

# 4. Smoke test login
# (login flow manual, verifica /health + un endpoint authed)
```

### Rotire fara invalidare sesiuni (advanced)
Necesita JWT cu multiple keys (kid header). Nu e implementat in v2.34.0 — toate
rotatiile invalideaza sesiuni active.

---

## 11. Forensics post-incident

### Audit logs - unde le gasesti

| Sursa | Locatie | Format |
|-------|---------|--------|
| Backend stdout | `docker logs ld-container` | JSON lines per request |
| AI usage | DB tabela `ai_usage` | Owner-scoped, cost in milli-USD |
| Captcha usage | DB tabela `captcha_usage` | v2.34.0+ |
| Tenant key edits | DB tabela `audit_log` | Cine, cand, ce key |
| Admin actions | DB tabela `admin_audit` | Mutations critice |
| RNPM searches | DB tabela `rnpm_searches` | Termen, owner, timing |
| SOAP calls | DB tabela `soap_audit` | Endpoint, owner, status |
| Backup actions | `docker logs` cu `"action":"daily_backup"`, `"restore"`, `"offsite_backup"` | JSON |

### Query-uri utile

```sql
-- Cine a sters ce in ultima ora
SELECT * FROM admin_audit
 WHERE action LIKE 'delete%'
   AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3600 seconds')
 ORDER BY ts DESC;

-- Cine consuma cei mai multi bani AI azi
SELECT owner_id, SUM(cost_usd_milli) / 1000.0 AS usd
  FROM ai_usage
 WHERE ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-86400 seconds')
 GROUP BY owner_id
 ORDER BY usd DESC
 LIMIT 20;

-- Useri cu fail rate ridicat la captcha
SELECT owner_id, provider, COUNT(*) AS attempts
  FROM captcha_usage
 WHERE ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-86400 seconds')
 GROUP BY owner_id, provider
 ORDER BY attempts DESC
 LIMIT 20;
```

### Exporta DB pentru analiza offline

```bash
# Snapshot read-only
sqlite3 /path/to/legal-dashboard.db ".backup /tmp/forensics-$(date +%Y%m%d%H%M%S).db"

# Sau dump SQL plain
sqlite3 /path/to/legal-dashboard.db .dump > /tmp/forensics-dump.sql
```

---

## 12. Roadmap operational - ce **nu** e in v2.34.0

### APM (Sentry / Rollbar)
**Status**: amanat la v2.35.0. Audit-ul P1-8 flagged-uieste lipsa unui APM, dar
integrarea Sentry SDK necesita:
- Cont Sentry / Rollbar / Datadog cumparat de adminul firmei
- Update CSP `connect-src` cu domeniul DSN-ului
- Tunnel mode pentru CSP-strict environments

**Workaround temporar**: monitor pe `docker logs` cu Loki / Promtail / fluent-bit;
filter pe `"level":"error"`. Stdout-ul e structured JSON, deci grep-friendly.

### Multi-region failover
**Status**: nu e in scope pentru single-tenant. DB-ul single SQLite e by design.

### High-availability cluster
**Status**: nu e in scope. Single-instance lock garanteaza un singur writer; HA
necesita switch la Postgres / row-locking — out of scope pentru v2.x.

---

## Anexa A — Comenzi de urgenta (cheat sheet)

```bash
# Health
curl -fsS http://127.0.0.1:3002/health | jq

# Integrity DB
sqlite3 $DB_PATH "PRAGMA integrity_check;"

# Listeaza backupuri locali sortate dupa data
ls -lt $(dirname $DB_PATH)/backups/ | head -20

# Forteaza un daily backup acum (REST API, necesita admin token)
curl -X POST http://127.0.0.1:3002/api/v1/admin/backup/run \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Restart container fara downtime (rolling) - daca ai 2 instante
docker restart ld-container-1
# wait health
docker restart ld-container-2

# Last error in logs
docker logs ld-container 2>&1 | grep -E '"level":"error"' | tail -20

# Sterge un user (orphans relevante)
sqlite3 $DB_PATH "
  DELETE FROM ai_usage WHERE owner_id = '<user_id>';
  DELETE FROM captcha_usage WHERE owner_id = '<user_id>';
  DELETE FROM user_quota_overrides WHERE user_id = '<user_id>';
  DELETE FROM users WHERE id = '<user_id>';
"
```

---

## Anexa B — Contact escalare

| Severitate | Cui ii scrii | Cand |
|------------|---------------|------|
| P0 — productia down | Owner firma + IT lead direct | Imediat |
| P1 — feature critic broken | IT lead | In 1h |
| P2 — user-impact partial | Issue tracker + IT lead | In 24h |
| P3 — cleanup operational | Issue tracker | La sprint planning |

**Issue tracker**: GitHub Issues - https://github.com/<org>/legal-dashboard/issues
**Dev contact**: cdragos@gmail.com

---

## Rollback si pre-flight pentru migratiile v2.42.0 (0040-0042)

**Pre-flight OBLIGATORIU inainte de upgrade pe un tenant web** (migration 0040
adauga index unic case-insensitive pe users.email si BLOCHEAZA boot-ul daca
exista duplicate istorice):

    SELECT lower(email) AS e, COUNT(*) AS n FROM users GROUP BY e HAVING n > 1;

Zero randuri = upgrade sigur. Randuri gasite = rezolva manual duplicatele
(pastreaza contul corect, marcheaza-l pe celalalt cu email placeholder unic)
INAINTE de a porni versiunea noua.

**Rollback = restore din backup, NU reinstalare de build vechi.** Runner-ul de
migratii refuza boot-ul cand DB-ul are versiune de schema mai mare decat
fisierele de pe disc, deci un downgrade de aplicatie dupa 0040-0042 nu porneste.
Procedura corecta: opreste aplicatia, restaureaza
`backups/legal-dashboard.pre-schema-upgrade-*.db` (generat automat inainte de
migrare), apoi porneste versiunea veche.

**0041 down.sql este best-effort, NU inversa fidela**: valorile per-pool
originale (ai.single vs ai.multi) sunt pierdute la consolidare, iar granturile
se duplica pe ambele pool-uri legacy la down. Nu rula down-ul decat daca
backup-ul nu exista; nu rula up dupa down fara sa cureti intai
user_quota_grants.

---

## Split-ul RNPM per utilizator (v2.43.0)

Din v2.43.0 datele RNPM traiesc in fisiere SQLite SEPARATE per utilizator:
`<dataDir>/rnpm/<stem>.db`, unde `stem = ownerId lowercase + "-" + sha256(ownerId)[:10]`
(collision-safe pe filesystem-uri case-insensitive; imun la numele rezervate
Windows). Monolitul `legal-dashboard.db` pastreaza restul (users, auth, quota,
monitoring, audit, fx_rates).

**Ce s-a intamplat la primul boot pe v2.43.0:** splitter-ul one-time
(`backend/src/db/rnpmSplitter.ts`) a rulat automat: preflights fail-closed,
backup pre-split `backups/legal-dashboard.pre-rnpm-split-<stamp>.db` (VACUUM
INTO, verificat cu integrity_check — ACESTA e rollback-ul complet), copiere +
verificare per owner, golirea tabelelor rnpm din monolit, marker durabil
`rnpm/.split-done.json` (`status: "done"`). Log-urile sunt JSON pe stdout cu
`"action":"rnpm_split"`. Boot-urile urmatoare nu mai re-splituiesc.

### Monolit restaurat dupa split (boot abortat fail-closed)

Simptom: boot-ul aborteaza cu `[rnpm_split] split-ul a fost deja finalizat,
dar monolitul contine din nou randuri RNPM`. Cauza: cineva a restaurat un
backup de monolit facut INAINTE de split (care mai contine tabele rnpm
populate), iar splitter-ul refuza sa suprascrie fisierele per-user mai noi.
Doua cai de remediere — alege UNA:

1. **Pastreaza fisierele per-user (recomandat — sunt mai noi):** goleste
   randurile rnpm din monolitul restaurat si reporneste:

   ```sql
   -- sqlite3 legal-dashboard.db
   DELETE FROM rnpm_istoric; DELETE FROM rnpm_bunuri; DELETE FROM rnpm_creditori;
   DELETE FROM rnpm_debitori; DELETE FROM rnpm_avize; DELETE FROM rnpm_searches;
   DELETE FROM rnpm_bunuri_descrieri;
   VACUUM;
   ```

2. **Re-split fortat (vrei datele RNPM DIN backup, pierzi fisierele per-user
   curente):** cu aplicatia OPRITA, sterge fisierele per-user si marker-ul,
   apoi reporneste — splitter-ul reia split-ul din monolitul restaurat:

   ```bash
   rm -rf "<dataDir>/rnpm"    # sterge si .split-done.json
   ```

Acelasi remediu (calea 1 sau 2, dupa caz) se aplica si cand boot-ul aborteaza
cu `marker-ul de split e invalid` sau `resume 'wiping' refuzat` — marker-ul
sau fisierele per-user au fost alterate manual/partial si splitter-ul refuza
fail-closed sa continue. Caz special (doar medii dev, marker pre-fix): daca
mesajul e `resume 'wiping' refuzat: marker 'wiping' fara manifest`, marker-ul
a fost scris de o versiune dinainte de verificarea cu manifest, iar monolitul
e INCA plin (wipe-ul nu rulase) — foloseste calea 2 (sterge `<dataDir>/rnpm`
integral si reporneste; split-ul se reia din monolit). In productie cazul nu
exista: splitter-ul scrie manifestul din v2.43.0.

### Owner invalid la split

Simptom: boot abortat cu `ownerId invalid pentru operatii pe fisiere: ...`.
Un rand din `rnpm_searches`/`rnpm_avize` are `owner_id` in afara pattern-ului
`^[A-Za-z0-9_-]{1,64}$`. Split-ul NU a mutat nimic (preflight). Corecteaza
manual randul in monolit (UPDATE owner_id la id-ul corect al userului din
`users`) si reporneste.

## Backup si restore per utilizator (RNPM, v2.43.0)

- **Jail-uri:** backup-urile RNPM ale unui user stau in
  `<dataDir>/backups/rnpm/<stem>/`, cu prefix `rnpm.`. Pool-uri disjuncte cu
  retentie proprie: `rnpm.YYYY-MM-DD.db` (daily, 7), `rnpm.manual-*.db` (5),
  `rnpm.pre-restore-*.db` (5), `rnpm.pre-<label>-*.db` (pre-migration, 5).
  Monolitul pastreaza pool-urile lui in `backups/` cu prefix `legal-dashboard.`
  (plus pool-ul nou `legal-dashboard.manual-*.db`, retentie 5).
- **Self-service:** userii (rol `user` sau `admin`) isi creeaza backup manual
  ("Creeaza backup acum", cooldown 60s/owner), restaureaza si sterg DOAR
  jail-ul propriu, din modalul "Baza mea RNPM". Adminul poate tinti alt owner
  (`?ownerId=` pe GET/DELETE, `body.ownerId` pe restore) — audit cu
  `targetOwnerId`. Monolitul se administreaza din Setari > Backup
  (`/api/v1/admin/backups`, admin-only).
- **Garduri de concurenta:** restore-ul refuza 409 `SEARCH_ACTIVE` daca ownerul
  are o cautare RNPM in zbor; in timpul restore-ului orice operatie RNPM a
  ownerului primeste 409 `RESTORE_IN_PROGRESS` (latch in `getRnpmDb`).
- **Validare versiune:** un backup RNPM produs de o versiune de schema mai noua
  e respins la restore cu 400 (previne blocarea fisierului pe anti-downgrade).
- **Rollback schema per-user:** chain-ul separat `migrations-rnpm/` are
  `*.down.sql` pentru fiecare migration; pre-migration backup per fisier
  (`rnpm.pre-schema-upgrade-*.db`) se face automat cand exista migrations
  pending pe un fisier existent.

### Offsite backup pe multi-target

`runDailyBackup()` produce acum N+1 fisiere pe noapte (monolit + cate unul per
fisier user de pe disc, cu freshness PER TARGET). `LEGAL_DASHBOARD_BACKUP_OFFSITE_CMD`
este invocat o data PER FISIER proaspat, DUPA eliberarea lock-ului de
maintenance (upload-urile lente nu mai blocheaza scrierile). Sincronizarea
externa (S3/rclone/restic) trebuie sa acopere si `backups/rnpm/**`.

### Igiena fisierelor orfane (conturi sterse)

Stergerea unui cont e soft-delete (randul `users` ramane cu `status='deleted'`,
iar re-adaugarea REACTIVEAZA acelasi id) — fisierul `rnpm/<stem>.db` si jail-ul
`backups/rnpm/<stem>/` raman deliberat pe disc pentru reactivare. ID-urile nu
se reutilizeaza intre persoane diferite (email unic + acelasi rand users), deci
un fisier orfan nu poate fi "capturat" de alt user. Curatarea definitiva e
manuala si doar pentru conturi care sigur nu revin: cu aplicatia oprita (sau
userul inactiv), sterge `rnpm/<stem>.db` (+ `-wal`/`-shm`) si directorul
`backups/rnpm/<stem>/`. Stem-ul unui ownerId se poate calcula cu:
`node -e "const c=require('crypto');const id=process.argv[1];console.log(id.toLowerCase()+'-'+c.createHash('sha256').update(id,'utf8').digest('hex').slice(0,10))" <ownerId>`
