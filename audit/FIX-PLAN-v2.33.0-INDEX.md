# Plan de Fix - v2.33.0 Security Hardening

**Sursa**: audit/AUDIT-PACK-SECURITY-DEEP-2026-05-19.md (22 findings)
**Target version**: v2.33.0 (CRITICAL + HIGH bundle) -> v2.34.0 (MEDIUM bundle)
**Data**: 2026-05-19
**Metodologie**: 4 agenti Claude specializati paraleli + advisor extern

---

## 1) Cuprins pe clustere

| Cluster | Fisier | Findings | Estimat | Branch sugerat |
|---------|--------|----------|---------|----------------|
| Quota + Budget | [FIX-PLAN-CLUSTER-QUOTA-BUDGET.md](FIX-PLAN-CLUSTER-QUOTA-BUDGET.md) | CRITICAL-1, HIGH-4, MEDIUM-1, MEDIUM-3, MEDIUM-8, MEDIUM-9, LOW-3 | ~15h | `feat/quota-budget-hardening` |
| Deployment + Topology | [FIX-PLAN-CLUSTER-DEPLOYMENT-TOPOLOGY.md](FIX-PLAN-CLUSTER-DEPLOYMENT-TOPOLOGY.md) | HIGH-2, HIGH-3, MEDIUM-5, MEDIUM-10 | ~5.5h | `fix/security-deployment-topology` |
| Validation + External I/O | [FIX-PLAN-CLUSTER-VALIDATION-IO.md](FIX-PLAN-CLUSTER-VALIDATION-IO.md) | HIGH-1, MEDIUM-2, MEDIUM-4, MEDIUM-11 | ~5h | `fix/validation-external-io-cluster` |
| Audit Trail | [FIX-PLAN-CLUSTER-AUDIT-TRAIL.md](FIX-PLAN-CLUSTER-AUDIT-TRAIL.md) | HIGH-5, MEDIUM-6, MEDIUM-7, LOW-1, LOW-2 | ~3.5h | `fix/audit-trail-completeness` |
| **TOTAL** | - | **18 findings cu plan** | **~29h** | 4 PRs paralele |

**LOW-4 si LOW-5** (dependency tracking): fara fix imediat, doar tracking. Vezi sectiunea 5.

---

## 2) Ordine dispatch recomandata catre Codex

Cele 4 clustere sunt **independente** (nu se ating intre ele la nivel de fisier critic). Pot fi dispach-uite paralel ca 4 PR-uri separate. Daca dispatch-ul serial e preferat (un singur Codex turn la a data), ordinea:

1. **Audit Trail** (cel mai izolat, 3.5h, low risk) - PR-A
2. **Validation + External I/O** (5h, low risk, doar fail-closed paths) - PR-B
3. **Deployment + Topology** (5.5h, infra + middleware) - PR-C
4. **Quota + Budget** (15h, cel mai complex, atinge hot path) - PR-D

Rationale serial: aplica cel mai mic blast radius primul, observa stabilitate, apoi avanseaza la urmatorul.

---

## 3) Constrangeri NON-NEGOTIABLE pentru toate clusterele

(Din CLAUDE.md + .claude/CLAUDE.md + memorie)

- Repository-only DB access: SQL raw doar in `backend/src/db/**`
- `owner_id` pe toate tabelele (DEFAULT 'local')
- Desktop ZERO impact: quotaGuard no-op cand `getAuthMode() !== "web"`
- Audit log NU primeste plaintext (doar last4, hadPrevious, field, validationSkipped)
- Master key NEVER logged; captcha key values NEVER in audit log
- D14 fail-closed EUR (no 0.92 fallback)
- D15 rolling seconds locked
- D16 banner auto-clear only
- LAN bind opt-in (LEGAL_DASHBOARD_ALLOW_REMOTE=1)
- Web-mode 501 gate ramane pe rejectCaptchaKeyInWebMode
- Manual FX rate entry forbidden, doar auto-fetch ECB
- Biome obligatoriu inainte de push

---

## 4) Checklist pre-push per cluster

Aplicabil la fiecare PR:

```bash
# 1. Biome write pe fisierele atinse (lista in fiecare cluster)
npx biome check --write <files>

# 2. Type-check
npx tsc --noEmit -p backend/tsconfig.json
cd frontend && npx tsc --noEmit && cd ..

# 3. Build
npm run build

# 4. Tests
npm test --workspace=backend
cd frontend && npm test -- --run && cd ..

# 5. Bump versiune dupa toate 4 clustere mergeate -> v2.33.0
# Update: package.json (root+backend+frontend), package-lock.json,
# frontend/src/data/changelog-entries.tsx, CHANGELOG.md, README.md,
# SESSION-HANDOFF.md, STATUS.md, DOCUMENTATIE.md, SECURITY.md, HARDENING.md
```

---

## 5) Findings fara plan de fix imediat

| Finding | Motiv | Tracking |
|---------|-------|----------|
| LOW-4 (`@google/generative-ai` maintenance-mode) | Cand Google migreaza oficial la `@google/genai`, replace. Acum: zero CVE-uri. | Backlog |
| LOW-5 (`@2captcha/captcha-solver` transitive `node-fetch`) | Lock-uit deja in package-lock.json. Zero CVE-uri active. | Backlog |

Aceste 2 nu blocheaza nicio versiune; recomandare = quarterly review.

---

## 6) Mapping finding -> cluster -> fisier de planificare

| Finding | Sev | Cluster | Loc plan |
|---------|-----|---------|----------|
| CRITICAL-1 quota race | CRITICAL | Quota+Budget | Section "CRITICAL-1" |
| HIGH-1 SOAP streaming | HIGH | Validation+IO | Section "HIGH-1" |
| HIGH-2 backup lock | HIGH | Deployment | Section "HIGH-2" |
| HIGH-3 rate-limit collapse | HIGH | Deployment | Section "HIGH-3" |
| HIGH-4 SMTP retry budget | HIGH | Quota+Budget | Section "Batch HIGH-4+MEDIUM-8+LOW-3" |
| HIGH-5 system.boot audit | HIGH | Audit Trail | Section "TASK 4" |
| MEDIUM-1 feature enum | MEDIUM | Quota+Budget | Section "MEDIUM-1" |
| MEDIUM-2 RNPM validation | MEDIUM | Validation+IO | Section "MEDIUM-2" |
| MEDIUM-3 LIMIT 200 | MEDIUM | Quota+Budget | Section "MEDIUM-3" |
| MEDIUM-4 Google header | MEDIUM | Validation+IO | Section "MEDIUM-4" |
| MEDIUM-5 Caddy strip header | MEDIUM | Deployment | Section "MEDIUM-5" |
| MEDIUM-6 SMTP error sanitize | MEDIUM | Audit Trail | Section "TASK 2" |
| MEDIUM-7 auth.logout audit | MEDIUM | Audit Trail | Section "TASK 6" |
| MEDIUM-8 warning cooldown | MEDIUM | Quota+Budget | Section "Batch HIGH-4+MEDIUM-8+LOW-3" |
| MEDIUM-9 grant expires cap | MEDIUM | Quota+Budget | Section "MEDIUM-9" |
| MEDIUM-10 docker digest pin | MEDIUM | Deployment | Section "MEDIUM-10" |
| MEDIUM-11 FX plausibility | MEDIUM | Validation+IO | Section "MEDIUM-11" |
| LOW-1 grant reason truncate | LOW | Audit Trail | Section "TASK 3" |
| LOW-2 audit.viewed audit | LOW | Audit Trail | Section "TASK 7" |
| LOW-3 budget.warning.fired audit | LOW | Quota+Budget | Section "Batch HIGH-4+MEDIUM-8+LOW-3" |
| LOW-4 @google/generative-ai | LOW | (backlog) | Sectiune 5 |
| LOW-5 node-fetch transitive | LOW | (backlog) | Sectiune 5 |

---

## 7) Estimat global

| Faza | Findings | Estimat | Target version |
|------|----------|---------|----------------|
| Sprint imediat (blocheaza web cutover) | CRITICAL-1 + 5 HIGH | ~12-16h | v2.33.0 |
| Sprint pre-first-users | 11 MEDIUM | ~10-12h | v2.34.0 |
| Cleanup oportunistic | 3 LOW (LOW-1/2/3 deja in v2.33.0) | ~2h | post-cutover |
| **Total** | **18 findings cu plan complet** | **~24-30h** | - |

**Note**: LOW-1, LOW-2 si LOW-3 sunt incluse in clusterul lor natural (Audit Trail si Quota+Budget) - rezolvate odata cu HIGH-urile, fara cost suplimentar real.

---

## 8) Pasi de dispatch catre Codex (per cluster)

Pentru fiecare cluster, user-ul (Cezar) face urmatorii pasi:

1. Deschide noul terminal Codex
2. Trimite mesaj: `Implementeaza planul din audit/FIX-PLAN-CLUSTER-<NAME>.md exact. Branch: <branch>. Commit + push + gh pr create cand termini.`
3. Asteapta PR-ul, review pe GitHub
4. Merge cand testele trec

Per memoria `feedback_codex_opens_prs`: Codex face commit + push + `gh pr create`; user-ul aproba si face merge.
Per memoria `feedback_user_dispatches_codex`: dispatch-ul catre Codex il face user-ul, NU Claude.

---

**Status**: Plan ready for dispatch.
**Validation**: 4 agenti Claude specializati + 1 advisor Codex live review.
