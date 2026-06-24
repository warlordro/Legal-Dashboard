-- 0006_name_lists.up.sql — bulk import surface pentru `name_soap` (PR-5).
--
-- Background. PR-3 a definit kind='name_soap' in monitoring_jobs.kind CHECK,
-- dar pana acum singura cale de a crea un astfel de job era POST /jobs cu un
-- target manual. Workflow-ul real (ANAF, registru consilieri) este un upload
-- de XLSX/CSV cu zeci-sute de nume; PR-5 adauga acel surface.
--
-- Doua tabele si un FK invers pe monitoring_jobs:
--
--   * name_lists       — meta-document. UNIQUE(owner_id, source_sha256) face
--                        re-uploadul aceluiasi fisier idempotent (utila la
--                        retry post-restore).
--   * name_list_items  — un rand pe nume parsat. validation IN ('ok','warn',
--                        'rejected') captureaza preview-ul; doar rinduri 'ok'
--                        sau 'warn' devin joburi (vezi flow §5.2 in PLAN).
--   * monitoring_jobs.name_list_id — FK invers care permite jump direct din
--                        UI "lista #42 are 137 joburi" si suport pentru
--                        archived_at-cascade explicit (RESTRICT, NU CASCADE).
--
-- Decizii cheie.
--
--   * `name_kind` CHECK lista doar 'fizic'/'juridic' — aliniat cu zod
--     TargetNameSoap.name_kind enum (backend/src/schemas/monitoring.ts:40).
--     Specul PLAN-monitoring-webmode.md §2.3 mentiona si 'unknown', dar runner
--     name_soap nu poate construi un target valid din 'unknown' (zod refuza).
--     Parser-ul din PR-5 default-uieste la 'fizic' cu validation='warn' cand
--     userul omite tipul; alternativa ar fi sa duplicam enum-ul Zod si DB ar
--     suporta o valoare pe care alta cale n-o accepta.
--
--   * FK pe `name_list_items.list_id` este `ON DELETE RESTRICT` (NU CASCADE).
--     Spec §2.3 banner Constatare adversiala #6: o stergere CASCADE a unei
--     liste cu joburi active orfana run-urile/snapshot-urile/alertele asociate
--     fara avertisment. RESTRICT forteaza ordinul archive-job → archive-list →
--     delete-list. `archived_at` pe name_lists ofera soft-delete-ul UI-ului.
--
--   * FK pe `monitoring_jobs.name_list_id` simetric — RESTRICT ca sa
--     pastreze invariantul (nu poti sterge lista cat exista joburi care o
--     refera). Coloana e nullable ca sa nu rupa joburile existente
--     (dosar_soap, aviz_rnpm, name_soap pre-PR-5 create manual).
--
--   * `total_rows` / `valid_rows` materializate pe name_lists ca sa evitam
--     un COUNT join pe fiecare load al UI-ului (lista mare cu paginare).
--     Repository-ul este single writer si le mentine sincronizat la commit.
--
--   * Index pe `(owner_id, list_id)` pe items — match exact pe filtrul UI-
--     ului "items pentru lista X". Index pe `(owner_id, name_normalized)` —
--     suport pentru dedup intra-tenant ("am mai monitorizat numele ASTA?").
--
-- SQLite specifics.
--
--   * `ALTER TABLE ... ADD COLUMN ... REFERENCES ...` sub foreign_keys=ON
--     este permis doar cand coloana noua are NULL default; omitem DEFAULT.
--     Pattern oglindit din 0004_runs_fk_on_snapshots_and_alerts.up.sql.
--   * `datetime('now')` UTC-aware — alinia cu rest of schema (0003 foloseste
--     strftime cu fractii; 0006 foloseste varianta scurta pentru ca aceste
--     timestamp-uri sunt informationale, nu participa la diff math).

CREATE TABLE name_lists (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        TEXT NOT NULL,
  title           TEXT NOT NULL,
  source_filename TEXT,
  source_sha256   TEXT NOT NULL,
  total_rows      INTEGER NOT NULL DEFAULT 0,
  valid_rows      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at     TEXT,
  UNIQUE(owner_id, source_sha256)
);
CREATE INDEX idx_name_lists_owner ON name_lists(owner_id, created_at DESC);

CREATE TABLE name_list_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id          TEXT NOT NULL,
  list_id           INTEGER NOT NULL REFERENCES name_lists(id) ON DELETE RESTRICT,
  name_kind         TEXT NOT NULL CHECK(name_kind IN ('fizic','juridic')),
  name_raw          TEXT NOT NULL,
  name_normalized   TEXT NOT NULL,
  cnp               TEXT,
  cui               TEXT,
  validation        TEXT NOT NULL DEFAULT 'ok'
                    CHECK(validation IN ('ok','warn','rejected')),
  validation_msg    TEXT,
  monitoring_job_id INTEGER REFERENCES monitoring_jobs(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_nli_owner_list ON name_list_items(owner_id, list_id);
CREATE INDEX idx_nli_norm ON name_list_items(owner_id, name_normalized);
CREATE INDEX idx_nli_job ON name_list_items(monitoring_job_id) WHERE monitoring_job_id IS NOT NULL;

-- FK invers pe monitoring_jobs. Nullable ca sa nu rupa joburile existente.
ALTER TABLE monitoring_jobs
  ADD COLUMN name_list_id INTEGER REFERENCES name_lists(id) ON DELETE RESTRICT;

CREATE INDEX idx_mj_name_list ON monitoring_jobs(name_list_id) WHERE name_list_id IS NOT NULL;
