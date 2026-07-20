# HANDOFF — Audit Codex + human testing multi-user + push GitLab (sesiune 2026-07-12/13, noapte)

**Branch:** `feat/v2.43.0-rnpm-split` · **HEAD:** `6923792` · **PUSHUIT pe GitLab 2026-07-13** (branch nou, 25 commits peste `a9630b9`; tracking setat). Nimic pe `main` (Dokploy neatins). Versiunea ramane **v2.43.0**, data actualizata la 13 iulie (release nelansat inca — totul se consolideaza sub el).

## 1. Ce s-a livrat in sesiunea asta (toate cu gate verde)

1. **`c47a6dd` — autocompact + limite stocare RNPM (implementat de Codex, DIRECT in IDE — nu prin codex-companion).** Ambele faze intr-un commit (37 fisiere, ~2500 linii, fara migrations — reuse `user_quota_overrides` feature `rnpm.storage`, MB in `limit_usd_milli`). Codex si-a scos singur pass-through-urile din docker-compose (interdictia Dokploy) si si-a gasit singur gap-ul de recheck pe paginile interne.
2. **`653c10e` — fixurile auditului meu** (4 agenti paraleli + gate independent): recheck in-run pe `/search` iesea 500 in loc de 429 cu cifre (catch-ul local nu rethrow-uia `RNPM_STORAGE_LIMIT`); bulk/split/nested nu se opreau la primul refuz de limita (pana la 199 recheck-uri inutile pe lock-ul global; acum fail-fast + `STORAGE_STOP_MSG` pe itemele ramase + fara `captchasUsed` fals pre-captcha). TDD strict, 4 teste RED intai.
3. **`25af0e7` — limita implicita 500 → 750 MB** (decizie user; plafonul jail-ului de backup ramane 500). ATENTIE: assert-ul din `adminRnpm.test.ts` ratat initial, prins de gate-ul pre-push si fixat in `6923792`.
4. **`c814d92` — cardul admin Stocare RNPM ascunde implicit userii stersi/suspendati fara date** (checkbox "Arata si userii stersi sau suspendati fara date (N)"; cei care ocupa spatiu raman mereu vizibili).
5. **`cbf8ac1` — dedup in lista de rezultate RNPM dupa identificator** (`lib/rnpmDedup.ts` + wiring in `RnpmSearch.tsx`): RNPM pagineaza instabil sub sarcina (150-175 randuri livrate la total real 144, verificat live) — contorul nu mai poate depasi totalul. DB-ul era mereu curat (dedup by identificator la persistare, verificat 144/144 la toti userii).
6. **`c724506` + `cd304b7` + `6923792`** — planurile Rev.3 + promptul Codex comise; changelog in-app + CHANGELOG.md + campuri versiune (CLAUDE/STATUS/DOCUMENTATIE/SESSION-HANDOFF) actualizate la 13 iulie; fixul de test.

## 2. Human testing (validari live, in audit log)

- **Autocompact:** delete-batch 80 avize → `rnpm.autocompact` ok, **freedBytes 108.572.672 (~103.5 MB) in 118ms**. `aviz.delete_all` (169) → `compacted:true`.
- **Limita:** override 50 MB pe user@local.test → card admin rosu "55.4 MB / 50.0 MB"; override sters → revine la default (audit `admin.users.quota_delete` feature rnpm.storage).
- **4 useri paraleli** (admin + user + user2/user3 pe proxy-uri noi): 4 cautari simultane, zero erori interne, zero contention pe maintenance lock (search 0.7-2.6s constant), provisioning lazy per user ok (fisierele au aparut la prima cautare).
- **Constatari RNPM upstream:** throttling agresiv la volum paralel de pe acelasi IP (detalii 11s → 90s/batch, apoi refuz `410 Gone` pe cautari noi — se ridica singur dupa pauza; schimbarea IP-ului ajuta); paginare instabila (repeta randuri intre pagini). Captcha: 2Captcha a castigat aproape toate race-urile (5-15s), CapSolver lent (27-48s) dar si-a revenit spre final; dashboard-ul CapSolver arata ca race-urile pierdute SE TAXEAZA (~$0.0008) — risc acceptat documentat.

## 3. URMATORUL PAS aprobat (neinceput)

**Buton "Sterge baza" per user in cardul Stocare RNPM** (stergerea bazei VII, simetric cu "Sterge backup-urile") — DECIZIE USER 2026-07-13, in loc de cleanup automat la stergerea contului. Capcane la implementare: inchide handle-ul din registry INAINTE de unlink (Windows nu sterge fisiere deschise — vezi pattern-ul compact/restore), maintenance write lock + latch restore + 409 pe search activ, audit cross-owner ca la compact (`resolveBackupOwner`), confirmare destructiva cu dimensiune, TDD. Estimare 1-2h.

## 4. Backlog pre-lansare web (din audit + testing, ordonat dupa impact)

1. **Shard maintenance lock per owner** — azi global: compactarea unui user tine in asteptare guard-urile altora (secunde, rar; nesimtit la 4 useri in test, dar amplificabil la multi-tenant real).
2. **Ritm global politicos catre RNPM** — 4+ sesiuni paralele de pe un IP declanseaza apararea lor (410). Pe server toti userii ies din acelasi IP.
3. **Pas obligatoriu de deploy:** audit useri peste limita via `GET /api/v1/admin/rnpm/usage` + override-uri preventive INAINTE de cutover (block imediat fara grace).
4. **Mesaj prietenos pe refuzuri upstream** (azi `Eroare RNPM search (410): {"error":""}` brut in UI).
5. LOW-uri neaplicate din audit: `enospc` dead-code pe worker boundary (SqliteError SQLITE_FULL nu traverseaza cu `code`), checkpoint PASSIVE probabil no-op pe reclaim (TRUNCATE?), dublare sync/async in `backupPrune`, `/usage` non-atomic pe rand, test lipsa override-sters-revine-la-default pe `getRnpmStorageLimitBytes`.
6. Optimizare stocare "C" (drop `_norm` pe bunuri, ~50% economie) — NEaprobata, backlog. UI global default limit editabil din admin — idee discutata, neaprobata formal.

## 5. Mediul de test (RULEAZA la finalul sesiunii)

- dev-web-local pe build-ul HEAD: backend **PID 34112** (3002), proxy-admin **40464** (3003/127.0.0.1), proxy-user **29716** (3004/localhost), **proxy-user2 PID 192** (3005, user2@local.test → `http://user2.localhost:3005`), **proxy-user3 PID 5152** (3006, user3@local.test → `http://user3.localhost:3006`). Oprire: `Stop-Process -Id 34112,40464,29716,192,5152 -Force`.
- Truc cookie-jar: `*.localhost` rezolva spre 127.0.0.1 cu jar separat per nume — asa ruleaza 4 identitati simultan fara ciocniri de sesiune. Proxy-urile extra se pornesc manual cu `DEV_WEB_PROXY_SECRET` (din `.dev-web-local.secrets.json`, cheia `proxySecret`) + `DEV_WEB_PROXY_EMAIL/PORT`.
- Useri in DB: admin@local.test (admin), user@local.test, user2@local.test, user3@local.test (creati in Utilizatori), local@desktop, cdragos@gmail.com (Sters). Fisiere RNPM de test: ~150-190 MB pe mai multi useri (cautari ipoteci cu avize-portofoliu de mii de bunuri — CUI 39029401, 144 rezultate).
- better-sqlite3 pe ABI **Node**. Inainte de smoke Electron: `npm run rebuild:electron`; inapoi la teste Node: `npm rebuild better-sqlite3`.

## 6. Capcane invatate in sesiunea asta

1. **Python `io.open` text-mode pe Windows scrie CRLF** — la editari de fisiere repo, foloseste binary mode sau normalizeaza inapoi la LF (biome pica pe CRLF; git afiseaza warning dar normalizeaza la commit).
2. **`npm run check | grep ; echo $?` minte** — exit code-ul e al grep-ului. Pentru verdict real: `npm run check > log 2>&1; echo $?`. Gate-ul pre-push a prins exact asa un test ratat la bump-ul 750.
3. La schimbari de constante (500→750), cauta si formele calculate (`500 * 1024 * 1024`), nu doar literalele text.
4. Codex in IDE (nu companion): niciun job log de urmarit — monitorizeaza prin git (commits noi) + mtime pe fisiere + procese (vitest/node).
5. Zgomotul de monitor: perdantii race-ului de captcha emit `ERR ... aborted` — exclude-i din filtre (`grep -v 'operation was aborted'`).
