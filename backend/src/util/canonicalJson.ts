// Deterministic JSON serialization for hash-stable identity keys.
//
// PR-3 uses this to compute `monitoring_jobs.target_hash` so that two clients
// requesting the same logical target — same fields, different key insertion
// order, accidental whitespace differences — collide on the same UNIQUE
// constraint and the second one becomes a no-op via idempotent insert.
//
// Contract:
//   - Object keys are sorted lexicographically at every depth.
//   - No whitespace in output (JSON.stringify with no `space` arg).
//   - Strings are NOT lowercased / diacritic-stripped here. The caller is
//     responsible for normalizing semantic-equivalence fields BEFORE handing
//     them in (kind-specific: numar_dosar canonicalization, name fold, etc.)
//     because the rules differ per `kind` and don't belong in a shared util.
//   - Arrays preserve order — order IS semantically meaningful for arrays in
//     this codebase (e.g., `notify_days_before: [14,7,3,1]`).
//   - undefined values are dropped (matching JSON.stringify); null is kept.
//
// NOT an external API contract — only used to derive deterministic hashes.

import { createHash } from "crypto";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    const v = obj[k];
    if (v === undefined) continue;
    out[k] = canonicalize(v);
  }
  return out;
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
