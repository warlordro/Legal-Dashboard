# Acceptance test - PR-8 v2.6.0 (admin pages + roles guard)

**Data**: 2026-04-30
**Versiune**: v2.6.0
**Scop**: cheklist de acceptanta end-to-end pentru PR-8 (backend roles guard + UI
admin). Acopera: middleware `requireRole`, `GET /api/v1/me`,
`/api/v1/admin/{users, audit, users/:id/quota}`, migration `0011`, sidebar
conditional, `AdminGate`, cele trei pagini admin (Users / Audit / Quota),
guardrails `last_admin` 409 si `self_deactivation` 409.

Toate scenariile s-au validat local prin `curl` + smoke desktop. Cele cu nivel
**A** (automat) sunt acoperite de teste vitest sau type-check; cele cu nivel
**M** (manual) trebuie reluate la fiecare release.

---

## Pre-conditii

- backend pornit (`npm run electron:dev` sau `npm run dev:backend` pentru curl).
- DB seedata cu user `local` (rol initial `user`). Migrarea `0011` aplicata.
- Pentru fluxurile admin: promovare temporara `UPDATE users SET role='admin'
  WHERE id='local';` direct in SQLite. PR-9 va expune un mecanism mai
  prietenos.

---

## 1. Migration `0011_user_quota_overrides` (A)

- [x] `npm test --workspace=backend` ruleaza fara eroare 524/524 teste,
      inclusiv `userQuotaRepository.test.ts` (13 cazuri).
- [x] `npx tsc --noEmit -p backend/tsconfig.json` clean.
- [x] PRAGMA `foreign_keys=ON` (deja prezent in bootstrap) - DELETE pe `users`
      curata override-urile din `user_quota_overrides` (test repository).
- [x] PK compus `(user_id, feature)` previne duplicatele.

## 2. `requireRole(...allowed)` (A + M)

- [x] **A**: 10 cazuri vitest (`requireRole.test.ts`) - 401 fara user, 401
      `user_not_found`, 401 `user_inactive` (suspended/deleted), 403
      `role_mismatch`, 200 cand rol in lista, audit `auth.denied`/`outcome`
      `denied` cu reason corect.
- [x] **M**: lansare app cu user `local` rol `user` -> sidebar nu arata
      sectiunea "Administrare" (verifica vizual).
- [x] **M**: `UPDATE users SET role='admin'` -> reload Electron -> sidebar
      "Administrare" devine vizibil cu Users/Audit/Cote.

## 3. `GET /api/v1/me` (A + M)

- [x] **A**: cazuri vitest pentru `meRouter` returneaza envelope v1
      `{ data: { id, email, displayName, role, status }, requestId }`.
- [x] **M curl**: `curl http://127.0.0.1:3002/api/v1/me` -> 200 cu profil.
- [x] **M**: dupa `UPDATE` rol, urmatorul refresh `/me` reflecta noul rol.

## 4. `/api/v1/admin/users` listing si detail (A + M)

- [x] **A**: vitest acopera filtre `role`, `status`, `search` (email +
      displayName), paginare `limit`/`offset`, sortare `created_at desc`.
- [x] **M curl admin**: `GET /api/v1/admin/users?limit=50` -> 200 cu pagina.
- [x] **M curl admin**: `GET /api/v1/admin/users?role=admin` -> filtreaza.
- [x] **M curl non-admin**: 403 `role_mismatch`, audit `auth.denied`.
- [x] **M curl admin**: `GET /api/v1/admin/users/local` -> 200 cu detail
      (include quota overrides serializate inline).

## 5. `/api/v1/admin/users/:id/role` (A + M)

- [x] **A**: vitest pentru update valid, validare role enum, guard
      `last_admin` 409, audit `before`/`after`.
- [x] **M curl admin (other user)**: `PATCH ... { role: 'admin' }` -> 200,
      audit `admin.user.role.changed`.
- [x] **M curl self-demote ultimul admin**: `PATCH /admin/users/local { role:
      'user' }` -> 409 cu cod `last_admin` si mesaj romanesc "Nu poti...".
- [x] **M UI**: pe `/admin/users` schimba rolul propriu cand e singurul admin
      -> alerta romaneasca, fara update; check `useCurrentUser` ramane admin.
- [x] **M UI**: schimba rolul altui user -> dropdown reflecta valoarea noua.

## 6. `/api/v1/admin/users/:id/status` (A + M)

- [x] **A**: vitest pentru update valid, guard `self_deactivation` 409 cand
      caller propriul `id` si `status != 'active'`.
- [x] **M curl admin**: `PATCH ... { status: 'suspended' }` (alt user) -> 200.
- [x] **M curl self**: `PATCH /admin/users/local { status: 'suspended' }` ->
      409 `self_deactivation`.
- [x] **M UI**: pe `/admin/users` selecteaza `Suspendat` pe propriul user ->
      alerta romaneasca, fara update.

## 7. `/api/v1/admin/users/:id/quota` (A + M)

- [x] **A**: vitest acopera GET listing, PUT upsert (insert + update), DELETE
      idempotent.
- [x] **M curl admin**: `GET .../local/quota` -> 200 cu lista override.
- [x] **M curl admin**: `PUT .../local/quota/ai_calls_per_day { limit:
      1000 }` -> 200, audit `admin.quota.upserted`.
- [x] **M curl admin**: `DELETE .../local/quota/ai_calls_per_day` -> 204.
- [x] **M curl admin**: re-`DELETE` -> 204 idempotent.
- [x] **M UI**: pe `/admin/quota` cauta user -> seteaza override -> apare in
      lista; sterge cu confirm dialog.

## 8. `/api/v1/admin/audit` (A + M)

- [x] **A**: vitest `auditRepository.test.ts` (12 cazuri noi) acopera filtre
      ownerId, actorId, action, actionLike, targetKind, targetId, outcome,
      since (closed lower), until (open upper), limit clamp 1..500, offset.
- [x] **A**: listing nu emite audit secundar (read-only).
- [x] **M curl admin**: `GET /api/v1/admin/audit?since=2026-04-30T00:00:00.000Z&limit=50`
      -> 200, prima inregistrare ts >= 2026-04-30T00:00:00.000Z.
- [x] **M curl admin**: `GET .../audit?actionLike=admin.user.role`
      -> filtreaza prin `LIKE`.
- [x] **M UI**: pe `/admin/audit` selectare data `from` -> request paseaza
      `since` la `00:00:00 local` convertit in ISO; expand row arata
      `detail_json` formatat + `userAgent`.

## 9. Sidebar conditional (M)

- [x] User cu rol `user` -> nicio sectiune "Administrare".
- [x] User cu rol `admin` -> sectiune cu icon `ShieldCheck` + 3 NavLink-uri.
- [x] Toggling collapsed pastreaza vizibilitatea iconitelor in sidebar admin.
- [x] After `PATCH /admin/users/local { role: 'user' }` (alt admin): refresh
      pagina -> sidebar reactualizeaza prin `useCurrentUser`.

## 10. `AdminGate` (A + M)

- [x] **M**: navigheaza `/admin/users` cu user `user` -> mesaj "403 - Acces
      interzis" si CTA spre `/dashboard`.
- [x] **M**: in timpul `loading` afiseaza placeholder "Verific
      permisiunile...".
- [x] **M**: dupa promovare la admin, retrycu reload -> pagina e accesibila.

## 11. Build + ABI (M)

- [x] `npm rebuild better-sqlite3` (Node ABI) -> `npm test --workspace=backend`
      -> 524/524 OK.
- [x] `npm run rebuild:electron` (Electron ABI) -> `npm run electron:dev`
      lanseaza fara eroare `NODE_MODULE_VERSION` mismatch.
- [x] `cd frontend && npx tsc --noEmit` clean.

## 12. Audit trail (A + M)

Actiunile noi care **trebuie** sa apara in `audit_log`:
- `auth.denied` (outcome `denied`, reason `user_not_found` |
  `user_inactive` | `role_mismatch`)
- `admin.user.role.changed`
- `admin.user.status.changed`
- `admin.quota.upserted`
- `admin.quota.deleted`

Pentru fiecare actiune writes:
- [x] `before` si `after` in `detail_json` (test repository).
- [x] `actor_id` = caller, `target_id` = userul afectat.

---

## Limitari cunoscute (informativ)

- **Self-promote bypass desktop**: pana la PR-9, promovarea la admin se face
  manual prin SQLite. Acesta este workflow tehnic acceptat pentru sprintul
  curent.
- **`useCurrentUser` se apeleaza din mai multe locuri** (Sidebar + AdminGate
  per pagina admin). Pe desktop call-ul e local si rapid. Daca devine vizibil
  in load tests pe web mode, va fi lifted in context shared.
- **Quota e informativa pe desktop** (bypass real). Enforce remote ramane
  pentru PR-9+.

---

## Commits relevante

(de completat la merge in `main`)

- backend middleware + rute admin: `<commit hash>`
- frontend admin pages + AdminGate + sidebar: `<commit hash>`
- migration `0011_user_quota_overrides`: `<commit hash>`
- bump 2.6.0 + sync docs: `<commit hash>`

---

## Verdict

**Status PR-8**: PASS (toate scenariile A automate verzi, scenariile M
verificate manual local).

**Risc residual la merge**: niciun blocker. Tag `v2.6.0` se poate publica
imediat dupa push origin si dupa retest manual final pe desktop in
post-tag.
