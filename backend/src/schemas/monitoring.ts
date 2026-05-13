// Zod schemas for monitoring routes — single source of truth for payload shape.
//
// Why Zod instead of `CHECK json_valid(...)` in DDL: SQLite's json_valid only
// asserts well-formed JSON, not field-level shape. Drift in stored JSON would
// then need a one-shot migration to fix; with Zod-at-route, we keep the column
// permissive (TEXT) and validate on the way in. PLAN-monitoring-webmode.md
// §2.2 header documents this decision.
//
// Discriminated unions on `kind` give us:
//   - one `JobCreateBody` with target validated per-kind
//   - clean error issues path: `{ path: ['target', 'numar_dosar'], code, msg }`
//
// PR-4 will add SnapshotPayloadSchema + AlertDetailSchema once the diff
// engine lands; intentionally absent here so the schema surface only covers
// what PR-3 routes actually accept.

import { z } from "zod";

// --- numar_dosar canonicalization ----------------------------------------
// PortalJust expects the format "<n>/<court>/<year>[/auxiliar]" (e.g.
// "1234/180/2024" or "1887/99/2022/a12"). We allow trailing /letterDigit
// suffixes (cazuri colaterale) but reject anything outside ASCII digits +
// slashes + alphanumeric suffix to keep target_hash collision-free.
const NUMAR_DOSAR_RE = /^\d{1,7}\/\d{1,5}\/\d{4}(?:\/[A-Za-z0-9]+)?$/;

const TargetDosarSoap = z
  .object({
    numar_dosar: z
      .string()
      .trim()
      .min(5)
      .max(64)
      .regex(NUMAR_DOSAR_RE, "Format invalid (asteptat: 1234/180/2024 sau 1234/180/2024/a12)"),
  })
  .strict();

const TargetNameSoap = z
  .object({
    name_normalized: z.string().trim().min(2).max(200),
    // Array of institutie codes (matches Cautare Dosare multi-select semantics).
    // PR-6 runner will iterate per institutie. Empty/missing = search across all.
    //
    // Order + duplicates do NOT affect the user's intent — searching {A, B} is
    // identical to {B, A} or {A, B, A}. We dedup + sort here so target_hash is
    // stable across cosmetic reorderings of the input array; otherwise the same
    // logical watch would mint two `monitoring_jobs` rows.
    //
    // PF/PJ (name_kind) was dropped before PR-6 lands: PortalJust SOAP
    // CautareDosare takes only `numeParte` as raw string and has no entity-type
    // parameter (see backend/src/soap.ts:186), so two jobs differing only in
    // name_kind would emit identical queries. Keeping PF/PJ in target_hash
    // would silently double the SOAP load with zero behavioral benefit.
    institutie: z
      .array(z.string().trim().min(2).max(200))
      .max(20)
      .transform((arr) => Array.from(new Set(arr)).sort())
      .optional(),
  })
  .strict();

const TargetAvizRnpm = z
  .object({
    identificator: z.string().trim().min(1).max(200),
  })
  .strict();

// Alert configuration per job — borrowed semantics from HARDENING.md L296-309
// (notify_days_before, notify_on_*). Defaults applied via .default() so the
// stored JSON always has explicit values; reader-side decode is robust.
export const AlertConfigSchema = z
  .object({
    notify_days_before: z.array(z.number().int().min(0).max(365)).max(10).default([14, 7, 3, 1]),
    notify_on_new_termen: z.boolean().default(true),
    notify_on_solution: z.boolean().default(true),
    notify_on_dosar_disappeared: z.boolean().default(false),
    stadii: z.array(z.string().min(1).max(64)).max(20).optional(),
    categorii: z.array(z.string().min(1).max(64)).max(20).optional(),
    email_to: z.string().email().max(254).optional(),
  })
  .strict();

export type AlertConfig = z.infer<typeof AlertConfigSchema>;

// --- create / update bodies ----------------------------------------------

const JobCreateBaseFields = {
  cadence_sec: z.number().int().min(600).max(86400).default(14400),
  // Zod 4 types `.default()` against the OUTPUT shape, which here lists every
  // alert-config field as required. Inner fields all have their own defaults,
  // so AlertConfigSchema.parse({}) returns the populated object — wrap that in
  // a thunk to satisfy the type-checker without losing the empty-input ergonomic.
  alert_config: AlertConfigSchema.default(() => AlertConfigSchema.parse({})),
  notes: z.string().max(200, "Notita maxim 200 caractere").optional(),
  client_request_id: z.string().min(1).max(128).optional(),
};

export const JobCreateBodySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("dosar_soap"),
      target: TargetDosarSoap,
      ...JobCreateBaseFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("name_soap"),
      target: TargetNameSoap,
      ...JobCreateBaseFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal("aviz_rnpm"),
      target: TargetAvizRnpm,
      ...JobCreateBaseFields,
    })
    .strict(),
]);

export type JobCreateBody = z.infer<typeof JobCreateBodySchema>;
export type JobKind = JobCreateBody["kind"];
export type JobTarget = JobCreateBody["target"];

// PATCH only allows safe field changes — kind/target are immutable so the
// target_hash UNIQUE constraint can't be bypassed by mutating the target of
// an existing job (would orphan snapshots/alerts otherwise).
export const JobUpdateBodySchema = z
  .object({
    cadence_sec: z.number().int().min(600).max(86400).optional(),
    active: z.boolean().optional(),
    paused_until: z.iso.datetime().nullable().optional(),
    alert_config: AlertConfigSchema.partial().optional(),
    notes: z.string().max(200, "Notita maxim 200 caractere").nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Cel putin un camp trebuie modificat",
  });

export type JobUpdateBody = z.infer<typeof JobUpdateBodySchema>;

// Query string for GET /jobs — pagination + optional kind/active/q filters.
// `q` (free-text search) face match diacritic-insensitive case-insensitive pe:
//   - target_json.numar_dosar (dosar_soap)
//   - target_json.name_normalized (name_soap)
//   - target_json.identificator (aviz_rnpm — placeholder pana la PR-aviz)
// Limita 100 char ca sa nu generam LIKE patterns absurde.
export const JobListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    kind: z.enum(["dosar_soap", "name_soap", "aviz_rnpm"]).optional(),
    active: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type JobListQuery = z.infer<typeof JobListQuerySchema>;

// Per-owner master switch payload (Faza B). PUT /api/v1/monitoring/master-switch
// accepta strict { enabled: boolean } — orice alta cheie respinsa cu 400
// invalid_body. Route handler-ul mapeaza pe setMonitoringEnabled si scrie audit
// log DOAR cand changed=true.
export const MasterSwitchBodySchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export type MasterSwitchBody = z.infer<typeof MasterSwitchBodySchema>;
