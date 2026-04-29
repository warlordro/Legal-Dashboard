// Zod schemas for /api/v1/name-lists routes (PR-5 commit 3/6).
//
// Two payloads:
//   - POST /preview      → multipart/form-data (file) — validated by route, NOT here
//   - POST /             → JSON: { title, sourceFilename?, sourceSha256, items[],
//                                  autoCreateJobs?, maxJobs? }
//
// Defense-in-depth: clientul trimite items raw {nameRaw, cnp?, cui?} —
// fara validation/validationMsg/nameNormalized. Serverul re-deriva tot via
// validateRawItems(). UI poate afisa preview-ul cu validation flags-urile sale,
// dar la /commit acele flag-uri sunt ignorate.

import { z } from "zod";

import {
  MAX_NAME_LEN,
  MAX_ROWS,
} from "../services/nameListParser.ts";

// Per-item cap pe nameRaw: 200 chars (acelasi ca parser). Chiar daca cap-ul
// pe array e MAX_ROWS=50000, fara cap pe item-ul individual un payload de
// 50000 × 5KB = 250MB ar trece de body limit-ul de 15MB doar daca request-ul
// nu e batchuit; punem un cap conservativ ca al doilea zid.
const MAX_NAME_RAW_LEN_PER_ITEM = MAX_NAME_LEN;

// CNP / CUI — valori reale au max 13 (CNP) respectiv ~10 (CUI). Punem 32
// pentru a tolera prefixe ("RO123..."), spatii, etc., fara sa permitem buffere
// uriase pe campuri auxiliare.
const MAX_ID_FIELD_LEN = 32;

export const RawNameItemSchema = z
  .object({
    nameRaw: z.string().min(1).max(MAX_NAME_RAW_LEN_PER_ITEM),
    cnp: z.string().max(MAX_ID_FIELD_LEN).nullable().optional(),
    cui: z.string().max(MAX_ID_FIELD_LEN).nullable().optional(),
    cadenceSec: z.number().int().min(600).max(86400).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export type RawNameItemInput = z.infer<typeof RawNameItemSchema>;

// sha256 hex — 64 caractere, [0-9a-f]. Server-ul re-deriva sha256-ul din
// items? NU: sha256-ul vine din fisierul original (preview). Trust model:
// e doar dedup key per (owner_id), UNIQUE constraint impiedica un atacator
// sa "ocupe" un sha256 al altui owner. Pe acelasi owner, daca trimit acelasi
// sha256 dar items diferite, replay path returneaza lista veche → no harm.
const SHA256_RE = /^[0-9a-f]{64}$/;

// Cap-ul de 100 jobs/tx vine din advisor: tranzactia cu BEGIN IMMEDIATE
// blocheaza writers concurrenti, deci o vrem scurta. Un user cu 1000 nume
// face 10 calluri secventiale (clientul poate trimite din nou cu
// autoCreateJobs=true, getCommittableItems filtreaza monitoring_job_id IS
// NULL → batchuirea naturala).
const MAX_JOBS_PER_COMMIT = 100;

export const CommitListBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    sourceFilename: z.string().max(255).nullable().optional(),
    sourceSha256: z.string().regex(SHA256_RE, "sha256 hex invalid (asteptat 64 chars [0-9a-f])"),
    items: z.array(RawNameItemSchema).min(1).max(MAX_ROWS),
    // Cand true, dupa createList serverul creeaza monitoring_jobs pentru
    // primele maxJobs items eligibile (ok+warn, nelegate inca de un job).
    // Cand false sau lipsa: lista se creeaza fara joburi; userul poate ulterior
    // re-trimite request-ul (idempotent prin sha256 → duplicate=true) cu
    // autoCreateJobs=true, sau separat printr-un endpoint dedicat (commit 5).
    autoCreateJobs: z.boolean().default(false),
    maxJobs: z
      .number()
      .int()
      .min(1)
      .max(MAX_JOBS_PER_COMMIT)
      .default(MAX_JOBS_PER_COMMIT),
  })
  .strict();

export type CommitListBody = z.infer<typeof CommitListBodySchema>;

export { MAX_JOBS_PER_COMMIT };
