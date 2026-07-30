// Guard de imutabilitate pentru fisierele de migrare.
//
// De ce exista: runnerul stocheaza in `_schema_versions.sha256_up` hash-ul
// fisierului la momentul aplicarii si REFUZA boot-ul daca fisierul se schimba
// ulterior (self-heal-ul acopera doar variatii de line-ending, nu editari reale).
// Pe 2026-07-30 un commit de curatenie a documentatiei a rescris UN comentariu din
// `0001_baseline.up.sql`, ca sa scoata o referinta la un fisier devenit privat.
// Efect: orice instalare existenta — desktop sau serverul din spatele
// oauth2-proxy — intra in crash loop la urmatorul update, cu "hash mismatch for
// 0001_baseline.up.sql", si scrie un backup pre-schema-upgrade la fiecare
// incercare de pornire.
//
// Lista de mai jos ingheata hash-ul normalizat (BOM scos, CRLF -> LF) al fiecarui
// fisier `.up.sql` deja livrat. Daca testul pica, NU actualiza hash-ul: fisierul
// de migrare e imutabil odata aplicat, iar schimbarea trebuie mutata intr-o
// migrare NOUA. Lista se extinde doar cand se adauga o migrare noua.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MONOLITH_HASHES: Record<string, string> = {
  "0001_baseline.up.sql": "6261c7459c7a78cc2beb4613acb2810dde1f8126817b37414ceca1c53fc6b5d3",
  "0002_users_sessions_audit.up.sql": "b701e0d2d31c45ae11d75a88867c790eb80062b88d2b68c5c9d13ce76613ee85",
  "0003_monitoring_core.up.sql": "0dcce259e50aa87fbd2ee1d94df89cd2aecf9d1dcb11a035e3cfab7cc6537e04",
  "0004_runs_fk_on_snapshots_and_alerts.up.sql": "00f6dab029a7b6b1057e36e5db658f451938e9ac5b823de41e7292d455fb9290",
  "0005_one_running_run_per_job.up.sql": "043df7d31e6db6a894050814bad4e734ce760bc3f7321170de9bcb077b3f3d87",
  "0006_name_lists.up.sql": "81d6ab1d120433d6aa837ff3ff16d718c2e64b1ca6787fd8445533588b68fff5",
  "0007_drop_name_kind.up.sql": "e93be6823fb773ee92d4c30dfa66bd7bbc55a7617039ce7128c60ef1ecf667f6",
  "0008_name_soap_alert_kinds.up.sql": "7e6c90e0e4dd8e24fb9a60c18d4c9b2e5125801c2bf9eed03e17f397b9591021",
  "0009_name_list_item_job_options.up.sql": "0b482010af87f8c7e7ebf85c4483142aa4ff2bdcce3def95e4e7aecfee47fdbe",
  "0010_ai_usage.up.sql": "94ba15fe405254f9b2913e27d977ddfb1ba19c16aac7c68692ea8d571d6d5ca4",
  "0011_user_quota_overrides.up.sql": "6364947dcb6d588c0431e98078365611848f4908fbd30d54f7931b38746cc18a",
  "0012_monitoring_runs_alerts_patched.up.sql": "e6a57be538de5f670d92188f93e224812f9998c1ac152abb5efe540aff0adbad",
  "0013_idx_runs_owner_ended.up.sql": "ee7242fa54dce85f5d95714af19dfc728875f9649a3a021065c6cb1a07f0ce33",
  "0014_email_settings.up.sql": "04f26ceeb2c7e7261ad979bd5229fe95e87ee334f9f4d9ef0a79ee797d918fcb",
  "0015_daily_report_settings.up.sql": "2284c41fd694716fcf204a653c585a1648e2acfee5c6f72fcbbf1f4d0f21771c",
  "0016_termen_dupa_solutie_kind.up.sql": "511560fa9d13cdbaa05a112180dd9fafe80505dfba15c15c898aaa43e0cb365f",
  "0017_audit_request_id.up.sql": "067ddcc70421af692fb1e1a0f2d4598954b851a80742168fdce17d6982c5b579",
  "0018_source_partial_kind.up.sql": "14cf5e7bb2a965f8ce72625411164e9316951cb8d3a6ebfbcc78fc1e05328484",
  "0019_idx_monitoring_runs_started_at.up.sql": "549fb9d5558e1bcec7016f1d946e7a8a334f596fef6a1b19cc33358b867297bd",
  "0020_master_switch.up.sql": "3f949fe8fd8dcad7b07821ac8d581a5b5e9cf3b0f3a510c0b5642d69c2996a55",
  "0021_idx_rnpm_avize_owner_search.up.sql": "74a339c13f7337912d227c89c18104a09639e1f472265ae154226e97aa83f628",
  "0022_rnpm_norm_columns.up.sql": "5658983d9c6365fdc4a6dafd26740681d28cfc78d2ad660789319ce799af6e02",
  "0023_owner_ai_settings.up.sql": "e1ecfcf2055f04477b20c7b949bc0de83ad04116a8fbd48b19d1a9aec9cde608",
  "0024_ai_usage_openrouter.up.sql": "7af43cce2f45e0faf0d5224ff87499956dba79fb64d95a5f5d83cad4345a1197",
  "0025_ai_usage_owner_default.up.sql": "2c1a43dd131da941f4337850bced2b16f42f2d1903c20caa7c26a2327cc2c39b",
  "0026_tenant_api_keys.up.sql": "e9f187aa5f6b09a22f1ede383a299f1a2649140e0e63c0704a48831b94acdd7f",
  "0027_user_quota_overrides_extension.up.sql": "b58bc1a83071a5bc221d7d5dbdd88945f6688cb21f67e330b741ea413a198a8c",
  "0028_user_quota_grants.up.sql": "c7dab5815e7b9039195d66e3adfd920d6ddfb0d9b38e368ccfd394efbdc2b289",
  "0029_fx_rates.up.sql": "95045f4c59480fb29af40b21e33c44d13164b64a68f8ece26e3849b3a8c6dc27",
  "0030_budget_notifications.up.sql": "8ba89a31ea71feb67d25a04ecae26f7ffabd0aed96de85c3868e668aaad1b8f6",
  "0031_budget_notifications_retry.up.sql": "4628a63dbb29acdb3c4410c8e876e5cb38bfc54810486499aace154b647db1ae",
  "0032_ai_usage_reservation.up.sql": "ef90dedbf6cb79c2da6865560a786ee6083066ffc52319873b37ebc608111bdd",
  "0033_captcha_usage.up.sql": "fe7c3fa44cf049a5e937a2e1b9956b0f45cddfc313319ea207f4c90d0f55e888",
  "0034_iccj_job_kind.up.sql": "e842302a1313afe554c4229c276bd7b51e17056a7eecf384cf0ab9314e26ebc0",
  "0035_audit_log_ts_index.up.sql": "f0acefa9769fb043aaf0581bc77fcacfd26cebe0c92cb0f68e264bfca66654b8",
  "0036_openrouter_stack_western.up.sql": "ce38efe678bef81a7bfdad6bd14ba502931b60c7e6356af4190eeb061cec930a",
  "0037_ai_usage_latency.up.sql": "50cb7b1ea19a369b001960d791bbf4d4105dbd233a77b3f5d1f83b4d562bcc71",
  "0038_jwt_denylist.up.sql": "a0cf86a5ab27fa47df54593a8bb5107b6fc4de839dd9b20bff2a3f6c1a4faaff",
  "0039_api_tokens.up.sql": "349fa56cc920fa730588e5da0676a14e199968b3b7058a0fc59e84c7e123ad1f",
  "0040_users_email_unique.up.sql": "46328b869150467342df1d1074556018d8a739ba98645c2a0bd2c77cff7a8354",
  "0041_unified_ai_quota.up.sql": "5a4e1e698f6554bacc4dc867dda9a9821882fb5545d2c88f68a87804dcb7b301",
  "0042_grants_expires_utc.up.sql": "f92fe92a5de42d30f50c452fecda17156db2e9cf1e4d15e6ebbe345f947648a5",
};

const RNPM_HASHES: Record<string, string> = {
  "0001_rnpm_baseline.up.sql": "f5d958b5eb7b931bb759e30162b21fe652633f89b7904482692f952248bfb3ec",
};

const BOM = "﻿";

function normalizedHash(fullPath: string): string {
  // Aceeasi normalizare ca in runner.ts: BOM scos, CRLF -> LF.
  const raw = fs.readFileSync(fullPath, "utf8");
  const normalized = (raw.startsWith(BOM) ? raw.slice(1) : raw).split("\r\n").join("\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function checkChain(dir: string, expected: Record<string, string>): void {
  const absDir = path.join(import.meta.dirname, dir);
  const files = fs
    .readdirSync(absDir)
    .filter((name) => name.endsWith(".up.sql"))
    .sort();

  for (const name of files) {
    const frozen = expected[name];
    if (frozen === undefined) continue; // migrare noua: se ingheata la urmatorul release
    expect(normalizedHash(path.join(absDir, name)), `${dir}/${name} a fost modificat dupa ce a fost livrat`).toBe(
      frozen
    );
  }

  // Un fisier livrat nu are voie sa dispara: DB-urile existente il cer la boot.
  for (const name of Object.keys(expected)) {
    expect(files, `${dir}/${name} lipseste`).toContain(name);
  }
}

describe("migrarile livrate sunt imutabile", () => {
  it("chain-ul monolit are hash-urile inghetate", () => {
    checkChain(".", MONOLITH_HASHES);
  });

  it("chain-ul RNPM per-user are hash-urile inghetate", () => {
    checkChain("../migrations-rnpm", RNPM_HASHES);
  });
});
