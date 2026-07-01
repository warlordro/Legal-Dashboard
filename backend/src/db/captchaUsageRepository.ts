// captchaUsageRepository.ts — v2.34.0 P1-4 per-user captcha quota.
//
// Mirrors the rolling-window semantics from `aiUsageRepository.ts` but counts
// rows instead of summing milli-USD. Quota cap (`user_quota_overrides.limit_usd_milli`
// for `feature = 'captcha.rnpm'`) is interpreted as integer count of captcha
// resolutions in the rolling window. Default cap when no override exists comes
// from env `LEGAL_DASHBOARD_DEFAULT_CAPTCHA_QUOTA` (unset = pass-through).
//
// Why mirror `ai_usage` instead of reusing it: ai_usage stores cost in
// `cost_usd_milli` (semantic = USD); captcha tracking needs count semantics +
// a different provider enum + different audit trail. Sharing the same table
// would force interpreting cost_usd_milli=1 as "one captcha" and break the
// AI usage dashboards. Keep the contracts separate.

import { getDb } from "./schema.ts";
import { assertOwnerIdForMutation } from "../util/ownerGuard.ts";

export type CaptchaUsageProvider = "2captcha" | "capsolver";
export type CaptchaUsageSource = "tenant" | "body";

export interface CaptchaUsageRow {
  id: number;
  owner_id: string;
  ts: string;
  provider: CaptchaUsageProvider;
  source: CaptchaUsageSource;
  request_id: string | null;
}

export interface RecordCaptchaUsageInput {
  ownerId: string;
  provider: CaptchaUsageProvider;
  source: CaptchaUsageSource;
  requestId?: string | null;
  ts?: string;
  // PAT (piesa A): leaga randul de tokenul care l-a consumat, pentru plafon
  // per-token (A5.3). NULL/undefined = consum din sesiune JWT/desktop.
  tokenId?: string | null;
}

export function recordCaptchaUsage(input: RecordCaptchaUsageInput): CaptchaUsageRow {
  assertOwnerIdForMutation(input.ownerId, "recordCaptchaUsage");
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO captcha_usage (owner_id, ts, provider, source, request_id, token_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.ownerId,
      input.ts ?? new Date().toISOString(),
      input.provider,
      input.source,
      input.requestId ?? null,
      input.tokenId ?? null
    );
  return db.prepare("SELECT * FROM captcha_usage WHERE id = ?").get(info.lastInsertRowid) as CaptchaUsageRow;
}

// Numar de captcha-uri consumate de un PAT intr-o fereastra rolling (A5.3).
// `captcha_usage.ts` e stocat ISO-Z (recordCaptchaUsage scrie toISOString), deci
// comparatia lexicografica cu strftime(...Z) e corecta — acelasi pattern ca
// countTenantCaptchaUsageInWindow.
export function countTokenCaptchaUsageInWindow(tokenId: string, windowSeconds: number): number {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error("windowSeconds must be a positive number");
  }
  const modifier = `-${Math.floor(windowSeconds)} seconds`;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM captcha_usage
        WHERE token_id = ?
          AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`
    )
    .get(tokenId, modifier) as { n: number };
  return row.n;
}

// Rezervare atomica per-token (A5.3). count-then-insert sub un singur lock
// (BEGIN IMMEDIATE) — nicio fereastra de race intre citirea contorului si insert.
// Returneaza `true` daca a rezervat (a inserat un rand), `false` daca plafonul e
// atins (cap===0 sau used>=cap). Arunca pe esec de tranzactie (ex. SQLITE_BUSY) ->
// caller-ul fail-closes (503), NU accepta peste plafon. SQL raw ramane in db/**
// (review 2026-07-01: mutat din routes/rnpmGuards.ts ca sa respecte repository-only).
export function reserveTokenCaptcha(input: {
  ownerId: string;
  tokenId: string;
  provider: CaptchaUsageProvider;
  requestId?: string | null;
  cap: number;
  windowSeconds: number;
}): boolean {
  let reserved = false;
  getDb()
    .transaction(() => {
      const used = countTokenCaptchaUsageInWindow(input.tokenId, input.windowSeconds);
      if (input.cap === 0 || used >= input.cap) return;
      recordCaptchaUsage({
        ownerId: input.ownerId,
        provider: input.provider,
        source: "tenant",
        requestId: input.requestId ?? null,
        tokenId: input.tokenId,
      });
      reserved = true;
    })
    .immediate();
  return reserved;
}

// Numar de captcha-uri (source='tenant') consumate de owner intr-o fereastra
// rolling. Doar tenant-source intra in cap; BYOK desktop e contorizat separat
// pentru audit dar nu se incarca pe wallet-ul firmei.
export function countTenantCaptchaUsageInWindow(ownerId: string, windowSeconds: number): number {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error("windowSeconds must be a positive number");
  }
  const modifier = `-${Math.floor(windowSeconds)} seconds`;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM captcha_usage
        WHERE owner_id = ?
          AND source = 'tenant'
          AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`
    )
    .get(ownerId, modifier) as { n: number };
  return row.n;
}

// earliest ts in rolling window — pentru Retry-After corect, mirror al
// `earliestAiUsageTsInWindow`.
export function earliestTenantCaptchaTsInWindow(ownerId: string, windowSeconds: number): string | null {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error("windowSeconds must be a positive number");
  }
  const modifier = `-${Math.floor(windowSeconds)} seconds`;
  const row = getDb()
    .prepare(
      `SELECT MIN(ts) AS earliest
         FROM captcha_usage
        WHERE owner_id = ?
          AND source = 'tenant'
          AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`
    )
    .get(ownerId, modifier) as { earliest: string | null };
  return row.earliest ?? null;
}

// Retention purge — mirror al `purgeOldAiUsage`. Global (not owner-scoped):
// older-than-N rows are aged out uniformly.
export function purgeOldCaptchaUsage(retentionDays: number): number {
  const days = Math.max(1, Math.floor(retentionDays));
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const info = getDb().prepare("DELETE FROM captcha_usage WHERE ts < ?").run(cutoff);
  return info.changes;
}
