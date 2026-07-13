// E4 (audit v2.43.0): retentia audit_log + ai_usage (90d) rula DOAR in
// scheduler-ul de monitoring; cu MONITORING_ENABLED=0 tabelele cresteau
// nelimitat. Helper testabil, apelat de un timer zilnic din index.ts in
// AMBELE moduri (desktop + web). Cu scheduler-ul pornit devine duplicat
// zilnic idempotent (DELETE pe fereastra de timp) — inofensiv.
// try/catch SEPARAT per repository (contract identic cu scheduler-ul):
// eroarea unui purge nu are voie sa-l sara pe celalalt.

import { purgeOldAuditLog } from "../db/auditRepository.ts";
import { purgeOldAiUsage } from "../db/aiUsageRepository.ts";

export const RETENTION_DAYS = 90;

export function runRetentionPurge(): { aiUsageDeleted: number; auditDeleted: number; errors: string[] } {
  const errors: string[] = [];
  let aiUsageDeleted = 0;
  let auditDeleted = 0;
  try {
    aiUsageDeleted = purgeOldAiUsage(RETENTION_DAYS);
    if (aiUsageDeleted > 0) {
      console.log(
        JSON.stringify({
          action: "ai_usage.purged",
          source: "standalone_interval",
          deleted_count: aiUsageDeleted,
          retention_days: RETENTION_DAYS,
          ts: new Date().toISOString(),
        })
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`ai_usage: ${msg}`);
    console.error("[retention] purgeOldAiUsage threw, continuing", { error: msg });
  }
  try {
    auditDeleted = purgeOldAuditLog(RETENTION_DAYS);
    if (auditDeleted > 0) {
      console.log(
        JSON.stringify({
          action: "audit_log.purged",
          source: "standalone_interval",
          deleted_count: auditDeleted,
          retention_days: RETENTION_DAYS,
          ts: new Date().toISOString(),
        })
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`audit_log: ${msg}`);
    console.error("[retention] purgeOldAuditLog threw, continuing", { error: msg });
  }
  return { aiUsageDeleted, auditDeleted, errors };
}
