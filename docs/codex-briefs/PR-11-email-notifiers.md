# Codex Brief — PR-11 Email notifiers

> **Cui se adreseaza**: agent Codex (GPT-5.x). Self-contained — nu necesita
> context din conversatia care l-a generat.
>
> **Versiune brief**: 1.0 (2026-05-03)
> **Autor**: Cezar + Claude Opus 4.7
> **Estimare effort**: ~90 min agent capabil, ~3-4h human review/smoke.
> **Bump asteptat**: `2.10.0` (minor — feature noua).

---

> **Nota implementare 2026-05-03**: in timpul review-ului UX s-a eliminat
> pragul de severitate din UI si din dispatcher. Email-ul este deja limitat la
> `monitoring_alerts`; cand canalul este activ, se trimit toate alertele noi de
> monitorizare. `min_severity` ramane in schema/API doar ca metadata
> compatibila cu modelul alertelor si cu brief-ul initial.

---

## 1. Context proiect (citeste in aceasta ordine)

Inainte sa scrii o singura linie de cod, parcurge:

| # | Fisier | De ce |
|---|---|---|
| 1 | `README.md` | Ce face Legal Dashboard, cum se ruleaza local |
| 2 | `CLAUDE.md` | Norme proiect: Romana fara diacritice, repo pattern, owner-scoped, audit on writes, CP/CQ checkpoints |
| 3 | `EXECUTION-ROADMAP.md` L335-347 | Spec original PR-11 (folosit ca punct de plecare; brief-ul asta il extinde) |
| 4 | `EXECUTION-ROADMAP.md` Decision log #11 | Decizia 2026-05-03: PR-10 + PR-12 eliminate. NU implementa NIMIC din ele. |
| 5 | `backend/src/db/monitoringAlertsRepository.ts` L140-258 | Seam-ul `notifyNewAlert` + `insertAlert` — punctul de hook al email-ului |
| 6 | `backend/src/services/monitoring/dosarSoapRunner.ts` | Cum sunt construite alertele (kind, severity, target_json, detail_json) |
| 7 | `backend/src/db/migrations/0011_user_quota_overrides.up.sql` + `.down.sql` | Pattern migration cu rollback safe |
| 8 | `backend/src/db/userQuotaRepository.ts` + `.test.ts` | Pattern repository + vitest |
| 9 | `backend/src/routes/me.ts` + `.test.ts` | Pattern rute owner-scoped, audit envelope |
| 10 | `frontend/src/components/NotificationStatusPanel.tsx` (v2.9.2) | Pattern UI panel in `ApiKeyDialog` |
| 11 | `frontend/src/lib/dashboardApi.ts` (Stage 8 split) | Pattern api client cu `apiFetch` wrapper |
| 12 | `SECURITY.md` | Threat model + protectii active (escape, body limits, etc.) |

---

## 2. Scop si non-scop

### Scop
Cand monitoring scheduler insereaza o alerta noua (via `insertAlert`), trimite
si un email pe langa SSE broadcast + native OS notification (deja existente).
Email functioneaza in ambele moduri:

- **Desktop (azi)**: single user (`owner_id='local'`), config in `.env` + DB.
- **Web (PR-11 → cutover viitor)**: per-user setting in `owner_email_settings`.

Cod scris o data, ruleaza in ambele moduri fara modificari.

### Non-scop (eliminat explicit)

| | De ce |
|---|---|
| Cloud-specific SDK (AWS SES, SendGrid, Resend native) | Nodemailer e provider-agnostic; userul alege SMTP |
| Schimbari pe schema alertelor existente | PR-11 doar consuma alerte; nu modifica fluxul |
| UI nou pe `/alerte` | Pagina ramane neschimbata; email e canal paralel |
| Cron / digest zilnic | Doar immediate per alert. Daily digest = PR viitor optional |
| Retry / backoff pe send | Email failure → log si continui. Alerta ramane in DB. |
| GDPR delete (PR-12 GDPR) | **Eliminat (decision #11)** — nu suntem firma de avocatura |
| Hash-chain audit log (PR-12 hash-chain) | **Eliminat (decision #11)** — single user theatre |
| Litestream + cloud backup (PR-10) | **Eliminat (decision #11)** — backup zilnic local suficient |

---

## 3. Arhitectura asteptata

```
┌─────────────────────────────┐
│ scheduler tick              │
│  (dosarSoapRunner /         │
│   nameSoapRunner)           │
└──────────────┬──────────────┘
               │ insertAlert(input)
               ▼
┌─────────────────────────────┐
│ monitoringAlertsRepository  │
│  insertAlert (UPSERT)       │
│   → row inserted/dedupedeed │
└──────────────┬──────────────┘
               │ queueMicrotask (defer to free hot path)
               ├──────────────►  notifyNewAlert(row)         [SSE existent]
               ├──────────────►  electron native notif       [v2.9.2 existent]
               └──────────────►  sendAlertEmailIfEnabled(row) [PR-11 NOU]
                                          │
                                          ▼
                                  alertEmailDispatcher
                                          │
                                          ├── settings = getEmailSettings(row.owner_id)
                                          ├── if !settings.enabled → return
                                          ├── if severityRank(row) < settings.minSeverity → return
                                          ├── if !settings.toAddress → return
                                          └── mailer.sendAlertEmail(row, settings)
                                                    │
                                                    └── nodemailer.transport.sendMail(...)
                                                          (try/catch isolated; failure → log only)
```

**Garantii**:
- Email failure NU sparge alert insert.
- Email failure NU sparge SSE broadcast.
- SMTP env vars lipsa → mailer este "disabled", boot-ul nu cade, dar log
  one-shot la prima incercare de send.
- `enabled=0` (default) → zero email-uri.
- Per-owner isolation pentru web mode (alta sesiune → alta config → alt to_address).

---

## 4. Tasks pe componente

### 4.1 Dependinte (`backend/package.json`)
- `dependencies`: `"nodemailer": "^6.9.13"` (sau ultima 6.x stabila).
- `devDependencies`: `"@types/nodemailer": "^6.4.15"`.
- Run `npm install` ca lockfile-ul sa se regenereze (commit-eaza separat
  `package-lock.json`).

### 4.2 Migration `0014_email_settings`

`backend/src/db/migrations/0014_email_settings.up.sql`:
```sql
-- 0014_email_settings.up.sql — per-owner email notification preferences (PR-11).
--
-- Default OFF: userul activeaza explicit din UI sau .env. Pattern conservator
-- (la fel ca alte feature-uri opt-in: AI usage tracking, quota overrides).
--
-- owner_id PRIMARY KEY (NU FK catre users) — desktop ramane pe 'local',
-- web mode lege la JWT-derived user id. PR-9 nu a impus FK pe alte tabele
-- per-owner; pastram aceeasi convenie aici.
--
-- min_severity CHECK aliniat cu monitoring_alerts.severity CHECK (vezi 0003).
-- Daca CHECK-ul de acolo se schimba, schimba si aici.

CREATE TABLE owner_email_settings (
  owner_id      TEXT PRIMARY KEY,
  enabled       INTEGER NOT NULL DEFAULT 0
                CHECK(enabled IN (0,1)),
  to_address    TEXT,
  min_severity  TEXT NOT NULL DEFAULT 'warning'
                CHECK(min_severity IN ('info','warning','critical')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`.down.sql`:
```sql
DROP TABLE owner_email_settings;
```

**Test reversibilitate**: cu un seed (insert un row), ruleaza
`migrate down` → `migrate up`. Tabela trebuie recreata, datele se pierd
(asteptat — drop + recreate). Documenteaza in commit message.

### 4.3 Repository `ownerEmailSettingsRepository.ts`

`backend/src/db/ownerEmailSettingsRepository.ts`:

```typescript
// Public surface
export interface EmailSettings {
  ownerId: string;
  enabled: boolean;
  toAddress: string | null;
  minSeverity: "info" | "warning" | "critical";
  createdAt: string;
  updatedAt: string;
}

export interface UpsertEmailSettingsInput {
  enabled: boolean;
  toAddress: string | null;
  minSeverity: "info" | "warning" | "critical";
}

export function getEmailSettings(ownerId: string): EmailSettings | null;
export function upsertEmailSettings(ownerId: string, input: UpsertEmailSettingsInput): EmailSettings;
```

**Implementare**:
- Named prepared statements module-level (vezi `userQuotaRepository.ts` L40+).
- `INSERT ... ON CONFLICT(owner_id) DO UPDATE SET ... RETURNING *`.
- `updated_at` set explicit la `datetime('now')` in update branch (NU trigger).
- Convertor row→domain (snake_case → camelCase) la limita repo-ului.
- `enabled`: integer in DB → boolean in domain.
- `toAddress` validat la repo: trim + length cap 320 (RFC 5321). Daca string
  gol post-trim, salveaza NULL.

**Tests** in `ownerEmailSettingsRepository.test.ts` (4-6 cazuri):
1. `getEmailSettings` pentru owner inexistent → `null`.
2. `upsertEmailSettings` insert nou → returneaza row complet cu defaults.
3. `upsertEmailSettings` update peste existent → row updated, `created_at`
   pastrat, `updated_at` schimbat.
4. Owner isolation: insert pe `local`, get pe `other` → `null`.
5. Trim + cap pe `to_address`.
6. CHECK constraint pe `min_severity` invalid → throw (sau zod la layer-ul de
   sus blocheaza, dar testam si DB-ul).

### 4.4 Mailer service `services/email/mailer.ts`

`backend/src/services/email/mailer.ts`:

```typescript
import type { Transporter } from "nodemailer";
import type { MonitoringAlertRow } from "../../db/monitoringAlertsRepository.ts";
import type { EmailSettings } from "../../db/ownerEmailSettingsRepository.ts";

let cachedTransport: Transporter | null = null;
let mailerStatusLogged = false;

interface MailerConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

function readMailerConfig(): MailerConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number.parseInt(process.env.SMTP_PORT ?? "", 10);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM?.trim();
  const secureEnv = process.env.SMTP_SECURE?.trim().toLowerCase();
  if (!host || !Number.isFinite(port) || !user || !pass || !from) return null;
  const secure = secureEnv === "true" ? true : secureEnv === "false" ? false : port === 465;
  return { host, port, user, pass, from, secure };
}

export function isMailerConfigured(): boolean {
  return readMailerConfig() !== null;
}

async function getTransport(): Promise<Transporter | null> {
  if (cachedTransport) return cachedTransport;
  const config = readMailerConfig();
  if (!config) {
    if (!mailerStatusLogged) {
      console.info("[email] disabled (SMTP_* env vars not configured)");
      mailerStatusLogged = true;
    }
    return null;
  }
  const nodemailer = await import("nodemailer");
  cachedTransport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });
  return cachedTransport;
}

export async function sendAlertEmail(
  alert: MonitoringAlertRow,
  settings: EmailSettings,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const transport = await getTransport();
  if (!transport) return { ok: false, reason: "mailer_disabled" };
  if (!settings.toAddress) return { ok: false, reason: "no_recipient" };
  const config = readMailerConfig()!;
  try {
    await transport.sendMail({
      from: config.from,
      to: settings.toAddress,
      subject: buildSubject(alert),
      html: buildHtmlBody(alert),
      text: buildTextBody(alert),
    });
    return { ok: true };
  } catch (err) {
    console.error("[email] sendAlertEmail failed", err);
    return { ok: false, reason: "send_failed" };
  }
}

export async function sendTestEmail(
  toAddress: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Similar: foloseste transport-ul + content fix de test
}

// Builders pure (testabile separat)
export function buildSubject(alert: MonitoringAlertRow): string;
export function buildHtmlBody(alert: MonitoringAlertRow): string;
export function buildTextBody(alert: MonitoringAlertRow): string;
```

**Reguli builders**:
- Subject pattern: `[Legal Dashboard] <severity_ro>: <kind_ro>` — ex.
  `[Legal Dashboard] Critic: Solutie aparuta`.
- Mapping severity → ro: `info`→`Info`, `warning`→`Avertisment`, `critical`→`Critic`.
- Mapping kind → ro: `dosar_new`→`Dosar nou`, `termen_new`→`Termen nou`,
  `termen_changed`→`Termen modificat`, `solutie_aparuta`→`Solutie aparuta`,
  `dosar_disappeared`→`Dosar disparut`, `aviz_changed`→`Aviz modificat`,
  `source_error`→`Eroare sursa`.
- HTML body: minimal — `<h2>{subject}</h2><p>Detalii:</p><pre>{detail
  pretty-printed}</pre><p>Vezi in aplicatie: <a href="legal-dashboard://alerts/{id}">deschide</a></p>`.
  Escape `target_json` + `detail_json` cu `escapeHtml` simplu (NU
  innerHtml direct). Daca exista sanitize-html in deps, foloseste-l.
- Text body: fallback plain — fara tag-uri, doar key: value pe randuri.
- NU include `body { font-family: ... }` etc — keep it minimal, gmail/outlook
  inlineaza.
- Romana fara diacritice peste tot.

**Tests** in `mailer.test.ts` (8-10 cazuri):
1. `readMailerConfig` cu env complete → returneaza config.
2. `readMailerConfig` cu un env lipsa → `null`.
3. `isMailerConfigured` reflecta corect.
4. `buildSubject` pentru fiecare combinatie severity × kind (snapshot test ok).
5. `buildHtmlBody` escape pe payload cu `<script>`.
6. `buildTextBody` lipseste tag-uri HTML.
7. `sendAlertEmail` cu mailer disabled → `{ok: false, reason: "mailer_disabled"}`.
8. `sendAlertEmail` cu transport care arunca → `{ok: false, reason: "send_failed"}`,
   eroarea NU se propaga.
9. `sendAlertEmail` cu success → transport.sendMail apelat cu argumentele asteptate.
10. `sendTestEmail` similar.

Mock `nodemailer.createTransport` cu `vi.mock` — nu se face network real in
teste.

### 4.5 Dispatcher `services/email/alertEmailDispatcher.ts`

```typescript
import type { MonitoringAlertRow } from "../../db/monitoringAlertsRepository.ts";
import { getEmailSettings } from "../../db/ownerEmailSettingsRepository.ts";
import { sendAlertEmail } from "./mailer.ts";

const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

export async function dispatchAlertEmail(alert: MonitoringAlertRow): Promise<void> {
  try {
    const settings = getEmailSettings(alert.owner_id);
    if (!settings || !settings.enabled || !settings.toAddress) return;
    const alertRank = SEVERITY_RANK[alert.severity] ?? 0;
    const minRank = SEVERITY_RANK[settings.minSeverity] ?? 1;
    if (alertRank < minRank) return;
    await sendAlertEmail(alert, settings);
  } catch (err) {
    console.error("[email] dispatchAlertEmail isolated failure", err);
  }
}
```

**Hook in repo**: in `monitoringAlertsRepository.ts`, modifica L258:
```typescript
// Before:
queueMicrotask(() => notifyNewAlert(row));

// After:
queueMicrotask(() => notifyNewAlert(row));
queueMicrotask(() => {
  void dispatchAlertEmail(row);
});
```

**De ce `void`**: dispatch returneaza Promise, dar in queueMicrotask context
nu vrem un unhandled rejection daca cineva uita try/catch. Functia
dispatchAlertEmail are deja try/catch, dar `void` face explicit ca nu
asteptam.

**Tests** in `alertEmailDispatcher.test.ts` (5-7 cazuri):
1. Owner fara settings → no-op (mailer.sendAlertEmail NU apelat).
2. Settings cu enabled=0 → no-op.
3. Settings cu toAddress=null → no-op.
4. Severity sub minSeverity → no-op (ex: alert info, settings warning).
5. Toate conditiile met → mailer apelat.
6. mailer arunca → eroarea izolata, NU propagata.
7. Severity necunoscut → tratata ca rank 0 (info).

### 4.6 Rute `/api/v1/me/email-settings*`

In `backend/src/routes/me.ts` (NU router nou — settings sunt per-user):

```typescript
const emailSettingsBodySchema = z.object({
  enabled: z.boolean(),
  toAddress: z.string().email().max(320).nullable(),
  minSeverity: z.enum(["info", "warning", "critical"]),
});

me.get("/email-settings", (c) => {
  const ownerId = getOwnerId(c);
  const settings = getEmailSettings(ownerId);
  return c.json(envelope(settings ?? defaultEmailSettingsFor(ownerId)));
});

me.put("/email-settings", zValidator("json", emailSettingsBodySchema), async (c) => {
  const ownerId = getOwnerId(c);
  const before = getEmailSettings(ownerId);
  const input = c.req.valid("json");
  // Validation: enabled=true cere toAddress non-null
  if (input.enabled && !input.toAddress) {
    return c.json(envelopeError("missing_to_address", "to_address required when enabled"), 400);
  }
  const after = upsertEmailSettings(ownerId, input);
  recordAudit({ action: "me.email_settings.update", ownerId, before, after, /* ... */ });
  return c.json(envelope(after));
});

me.post("/email-settings/test", async (c) => {
  const ownerId = getOwnerId(c);
  const settings = getEmailSettings(ownerId);
  if (!settings?.toAddress) {
    return c.json(envelopeError("missing_to_address", "salveaza intai o adresa"), 400);
  }
  if (!isMailerConfigured()) {
    return c.json(envelopeError("mailer_disabled", "SMTP_* env vars not configured"), 503);
  }
  const result = await sendTestEmail(settings.toAddress);
  recordAudit({
    action: "me.email_settings.test",
    ownerId,
    outcome: result.ok ? "ok" : "error",
    /* ... */
  });
  return c.json(envelope(result));
});
```

**Tests** in `routes/me.test.ts` (8-10 cazuri noi):
1. GET pentru owner nou → returneaza defaults (enabled=false).
2. GET pentru owner cu settings salvate → returneaza row salvat.
3. PUT cu valid body → 200 + audit `me.email_settings.update` cu `before/after`.
4. PUT cu enabled=true + toAddress=null → 400 `missing_to_address`.
5. PUT cu toAddress invalid email → 400 (zod).
6. PUT cu minSeverity invalid → 400 (zod).
7. POST /test fara settings salvate → 400 `missing_to_address`.
8. POST /test cu mailer disabled (env vars unset in test) → 503 `mailer_disabled`.
9. POST /test cu mailer mocked success → 200 + audit `me.email_settings.test`
   outcome=ok.
10. POST /test cu mailer mocked failure → 200 (envelope contine `ok:false`)
   + audit outcome=error.
11. Owner isolation: PUT pe owner A, GET pe owner B → defaults (nu vede A).

### 4.7 Frontend — `EmailSettingsPanel.tsx`

`frontend/src/components/EmailSettingsPanel.tsx`:

UI mockup conceptual:
```
┌─ Notificari pe email ──────────────────────────┐
│ Primesti alertele de monitorizare si pe email. │
│                                                 │
│ [✓] Activeaza notificarile pe email             │
│                                                 │
│ Adresa email: [____________________]            │
│                                                 │
│ Severitate minima: ( ) Info                     │
│                    (•) Avertisment              │
│                    ( ) Critic                   │
│                                                 │
│ [ Salveaza ]  [ Trimite test ]                  │
│                                                 │
│ ⓘ Statusul SMTP: configurat / neconfigurat      │
└─────────────────────────────────────────────────┘
```

Comportament:
- Initial: `useEffect` apel `meApi.emailSettings.get()` → seed state.
- "Salveaza": disabled cand nu sunt schimbari neconfirmate.
- "Trimite test": disabled cand `!isMailerConfigured` (info din `/me/email-settings`
  raspuns extins SAU dintr-un alt endpoint `/me/email-status`). Recomand sa
  extinzi raspunsul GET cu `mailerConfigured: bool` (provider info, NU SMTP
  credentials).
- Loading state pe Save + Test (Loader2 pe button).
- Toast/inline message pe success / error.
- ESC: nimic special (nu e modal).

Plasare: in `ApiKeyDialog.tsx`, langa `<NotificationStatusPanel />`.

**Tests** in `EmailSettingsPanel.test.tsx` (3-5 cazuri):
1. Render initial face GET, populeaza form-ul.
2. Click Save trimite PUT cu state-ul curent.
3. Click Test trimite POST si afiseaza outcome.
4. Mailer neconfigurat → buton Test disabled cu tooltip.
5. Validare client: enabled=true + toAddress gol → buton Save disabled.

### 4.8 API client `lib/meApi.ts`

Verifica daca `frontend/src/lib/meApi.ts` exista (Stage 8 a spart `lib/api.ts`
per domeniu). Daca nu, creeaza-l urmand pattern-ul `dashboardApi.ts`:

```typescript
import { apiFetch } from "./api-fetch.ts"; // sau ce wrapper e in Stage 8

export interface EmailSettingsResponse {
  ownerId: string;
  enabled: boolean;
  toAddress: string | null;
  minSeverity: "info" | "warning" | "critical";
  mailerConfigured: boolean;
}

export const meApi = {
  // ... existent
  emailSettings: {
    get: (signal?: AbortSignal) =>
      apiFetch<EmailSettingsResponse>("/api/v1/me/email-settings", { signal }),
    put: (input: UpsertEmailSettingsInput, signal?: AbortSignal) =>
      apiFetch<EmailSettingsResponse>("/api/v1/me/email-settings", {
        method: "PUT",
        body: JSON.stringify(input),
        signal,
      }),
    test: (signal?: AbortSignal) =>
      apiFetch<{ ok: boolean; reason?: string }>(
        "/api/v1/me/email-settings/test",
        { method: "POST", signal },
      ),
  },
};
```

Re-export prin `lib/api.ts` (barrel) ca alte componente sa importe din locul
canonic.

### 4.9 Documentatie

#### `.env.example` (root sau backend, unde e canonic — verifica)
```
# PR-11 — Email notifiers (optional, OFF cand lipsesc)
SMTP_HOST=          # OPTIONAL — ex: smtp.gmail.com, smtp-relay.gmail.com, smtp.resend.com
SMTP_PORT=          # OPTIONAL — 465 (SSL) sau 587 (STARTTLS)
SMTP_USER=          # OPTIONAL — username SMTP
SMTP_PASS=          # OPTIONAL — App Password Gmail / API key Resend (NU parola contului real)
SMTP_FROM=          # OPTIONAL — adresa From, ex: alerts@example.com
SMTP_SECURE=        # OPTIONAL — "true" pe 465, "false" pe 587 (autodetect daca lipseste)
```

#### `CHANGELOG.md`
Intrare noua `## v2.10.0 — 2026-XX-XX — PR-11 Email notifiers`. Stil
identic cu v2.9.2. Sectiuni `**Backend:**`, `**Frontend:**`, `**Docs:**`,
`**Tests:**`.

#### `frontend/src/data/changelog-entries.tsx`
Intrare noua cu icon `Mail` + culoare `sky` (NU rosu, nu critical). Text in
Romana fara diacritice. Format identic cu v2.9.2.

#### `CLAUDE.md`
- Bump versiune curenta sus.
- Intrare in lista PR-uri sprint cu structura `**Backend:** / **Frontend:** /
  **Tests:**`.
- Adauga `SMTP_*` in lista env vars relevante.

#### `SESSION-HANDOFF.md`
- Sectiune noua `## v2.10.0 — PR-11 Email notifiers` la inceput (deasupra
  v2.9.2).
- Documenteaza decizii de design ne-evidente:
  - De ce nodemailer si nu provider-specific SDK
  - De ce per-owner `owner_email_settings` si nu global
  - De ce hook in `queueMicrotask` si nu `await` in hot path

#### `EXECUTION-ROADMAP.md`
- Bifeaza tasks PR-11 din lista sprintului (L335-347).
- Updateaza status header sus cu "+ PR-11 v2.10.0 Email notifiers".

#### `package.json` (3 fisiere: root, backend/, frontend/) + `package-lock.json`
Bump `2.9.2` → `2.10.0`. Verifica cu `Grep` pe versiunea veche ca nu ai uitat
nicio mentiune (vezi feedback memory `version_bump_docs`).

---

## 5. Definition of Done

- [ ] `npm test --workspace=backend` toate verzi (baseline 645 + minim 25 noi).
- [ ] `npm test --workspace=frontend` toate verzi (baseline 45 + minim 5 noi).
- [ ] `npx tsc --noEmit -p backend/tsconfig.json` zero errori.
- [ ] `cd frontend && npx tsc --noEmit` zero errori.
- [ ] `npx biome check` clean.
- [ ] Migration 0014 reversibila — testata up→down→up local.
- [ ] Cu `SMTP_*` env vars setate la un Gmail App Password real (config-ezi
      local DOAR pentru smoke; NU commitezi `.env`), `POST /me/email-settings/test`
      ajunge in inbox in <30s. Documenteaza in commit message ce provider ai
      folosit (Gmail / Resend / etc).
- [ ] Cu `SMTP_*` lipsa, app-ul boot-eaza fara warning ca "configurare invalida".
      Doar log.info one-shot la prima incercare de send.
- [ ] Cu `enabled=0` (default), alertele noi NU genereaza email (verifica via
      mock spy in vitest + smoke manual prin trigger de alert).
- [ ] O eroare de send (ex: SMTP timeout / auth failure) NU sparge alert insert
      si NU sparge SSE broadcast (test cu mock care arunca).
- [ ] `.env.example` documenteaza toate variabile noi (CP-2 audit conform).
- [ ] In-app changelog show-uieste v2.10.0 dupa rebuild Electron.
- [ ] Smoke desktop final: app pornita, login (local), seteaza email in UI,
      trimite test, primit in inbox.

## 6. Reguli absolute

1. **Limba**: NU folosi alta limba decat Romana fara diacritice in mesaje
   user-facing. Comentarii cod pot fi in engleza sau romana — pastreaza
   stilul fisierului existent. Subject email + body — Romana fara diacritice.
2. **Repo pattern**: NU pune SQL raw in afara `backend/src/db/**`. Rute
   folosesc DOAR functii din repository.
3. **Teste**: NU mock-ui DB — foloseste sqlite in-memory (pattern existent in
   suite-uri, `setUpTestDb()` helper sau echivalent).
4. **Retry**: NU adauga retry/backoff pe send email. Daca esueaza o data, log
   si gata. Alerta ramane in DB; userul vede in `/alerte`.
5. **Comportament existent**: NU schimba SSE / OS notifications. Email e
   strict ADAUGA, nu inlocuieste.
6. **Security**:
   - Escape `target_json` + `detail_json` in HTML body. NU `innerHTML` raw.
   - SMTP credentials DOAR din env, niciodata in cod / git history.
   - `to_address` valid email (zod) si trim + length cap.
7. **Owner isolation**: TOATE rutele owner-scoped via `getOwnerId(c)`. NU
   accept query param de owner. Web mode foloseste JWT-derived id; desktop
   ramane `'local'`.
8. **Audit**: TOATE writes (`PUT /email-settings`, `POST /email-settings/test`)
   genereaza `recordAudit` cu envelope before/after sau outcome.
9. **Commits**:
   - Mici, atomice. Un commit per stage:
     1. `feat(email): add nodemailer dep + 0014 migration`
     2. `feat(email): add ownerEmailSettings repository`
     3. `feat(email): add nodemailer-based mailer service`
     4. `feat(email): wire dispatcher into alert insert hot path`
     5. `feat(email): expose /me/email-settings routes`
     6. `feat(email): add EmailSettingsPanel UI`
     7. `chore(release): v2.10.0 + changelog + roadmap`
   - Mesajele commit in engleza, conventional format.
   - NU `--no-verify`. NU `--amend` peste commit-uri push-uite.
10. **Final**: rebase pe main curat, NU squash. Vrem istoric pe stages.

## 7. Output asteptat

La final, raporteaza:

### A. Lista fisiere
- Noi (cu LOC aproximat)
- Modificate (cu LOC schimbate)

### B. Test report
```
$ npm test --workspace=backend
... (ultimele 30 linii)
Tests  XXX passed (XXX)

$ npm test --workspace=frontend
... (ultimele 30 linii)
Tests  XX passed (XX)
```

### C. Diff stat
```
$ git diff --stat main..HEAD
... (output complet)
```

### D. Smoke manual
- Provider folosit pentru smoke: ___________ (Gmail / Resend / etc)
- Adresa destinatie: _____________________
- Numar email-uri primite in inbox: 3 (1 test + 2 din alerte mock-uite)
- Latenta medie send→inbox: ___ secunde

### E. TODO ramase (daca exista)
- Lista cu TODO-uri intentionate cu motivare clara (ex: "daily digest e PR
  separat, nu in scope acum").

---

## 8. Daca te blochezi

| Problema | Ce sa faci |
|---|---|
| Nu gasesti `apiFetch` wrapper sau Stage 8 split | Citeste `frontend/src/lib/dashboardApi.ts` ca referinta vie |
| Nu intelegi `getOwnerId` / `recordAudit` semantica | Citeste `backend/src/middleware/owner.ts` + `backend/src/db/auditRepository.ts` |
| Nu gasesti pattern de envelope error | Cauta `envelopeError` in `backend/src` cu Grep |
| Nu sti ce migration framework foloseste proiectul | `backend/src/db/migrations/runner.ts` (sau cum se cheama) |
| Nodemailer cere ESM/CJS confuzie | Backend e bundled CJS prin esbuild — verifica `scripts/build.js`. `nodemailer` are dual-mode si suporta ambele |
| `.env.example` e in `backend/` sau in root? | Verifica empiric cu Glob `**/.env.example` |
| Bump versiune in `frontend/src/data/changelog-entries.tsx` cum se randeaza? | Citeste un entry existent (ex v2.9.2) si copy-paste structura |

Daca ramai blocat pe ceva care necesita decizie de design, **NU presupune** —
deschide un comentariu TODO + raporteaza in output. Nu inventa convenii noi.

---

**End of brief.**
