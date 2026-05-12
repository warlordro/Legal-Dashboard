// Tests for name_lists / name_list_items repository (PR-5).
//
// Contract:
//   - createList writes a row + N items in one transaction; total_rows /
//     valid_rows materialized counters match the input
//   - createList replay (same owner_id + source_sha256) returns existing list
//     unchanged, no duplicate items inserted
//   - getListById / getListItems are owner-scoped (cross-owner returns null /
//     empty)
//   - listLists filters out archived rows by default
//   - linkItemToJob is idempotent (no overwrite of an existing link)
//   - archiveList refuses while monitoring_jobs reference the list (RESTRICT
//     guard surfaced as blockingJobs count, NOT a thrown FK error)
//   - getCommittableItems returns ok + warn unlinked items only (rejected and
//     already-linked items excluded)

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  archiveList,
  createList,
  getCommittableItems,
  getListById,
  linkItemToJob,
  listItems,
  listLists,
  type CreateListItemInput,
} from "./nameListsRepository.ts";
import { closeDb, getDb } from "./schema.ts";

const OWNER = "local";
const OTHER_OWNER = "alt";

let tmpRoot: string;

function mkItem(overrides: Partial<CreateListItemInput> = {}): CreateListItemInput {
  return {
    nameRaw: "Ion Popescu",
    nameNormalized: "ion popescu",
    cnp: "1900101226789",
    cui: null,
    validation: "ok",
    validationMsg: null,
    ...overrides,
  };
}

function seedJob(ownerId: string, nameListId: number | null): number {
  const db = getDb();
  // target_hash trebuie sa fie unic per (owner_id, target_hash, kind);
  // folosim Math.random() doar in tests ca sa evitam coliziuni cand testele
  // creaza mai multe joburi pe aceeasi lista.
  const targetHash = `h-${Math.random().toString(36).slice(2)}`;
  const info = db
    .prepare(
      `INSERT INTO monitoring_jobs
         (owner_id, kind, target_json, target_hash, cadence_sec,
          alert_config_json, next_run_at, name_list_id)
       VALUES (?, 'name_soap', '{}', ?, 14400, '{}',
               '2026-04-30T12:00:00.000Z', ?)`
    )
    .run(ownerId, targetHash, nameListId);
  return info.lastInsertRowid as number;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-namelist-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  // Touch + close so initSchema runs against a real file.
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("createList", () => {
  it("writes a list row + items and materializes total_rows / valid_rows", () => {
    const items = [
      mkItem({ nameRaw: "A" }),
      mkItem({ nameRaw: "B", validation: "warn" }),
      mkItem({ nameRaw: "C", validation: "rejected", validationMsg: "gol" }),
    ];
    const result = createList({
      ownerId: OWNER,
      title: "ANAF martie",
      sourceFilename: "anaf.xlsx",
      sourceSha256: "deadbeef",
      items,
    });

    expect(result.duplicate).toBe(false);
    expect(result.list.total_rows).toBe(3);
    // ok + warn count, rejected exclus.
    expect(result.list.valid_rows).toBe(2);
    expect(result.list.archived_at).toBeNull();

    const persisted = listItems({
      ownerId: OWNER,
      listId: result.list.id,
      page: 1,
      pageSize: 100,
    });
    expect(persisted.total).toBe(3);
    expect(persisted.rows.map((r) => r.name_raw)).toEqual(["A", "B", "C"]);
    expect(persisted.rows[2]?.validation).toBe("rejected");
    expect(persisted.rows[2]?.validation_msg).toBe("gol");
  });

  it("replays on (owner_id, source_sha256) without inserting items twice", () => {
    const first = createList({
      ownerId: OWNER,
      title: "x",
      sourceFilename: null,
      sourceSha256: "sha-1",
      items: [mkItem({ nameRaw: "Ana" }), mkItem({ nameRaw: "Bogdan" })],
    });
    const second = createList({
      ownerId: OWNER,
      title: "x (retry)",
      sourceFilename: null,
      sourceSha256: "sha-1",
      items: [mkItem({ nameRaw: "Cornel" })],
    });

    expect(second.duplicate).toBe(true);
    expect(second.list.id).toBe(first.list.id);
    expect(second.list.title).toBe("x"); // titlu original neschimbat

    const persisted = listItems({
      ownerId: OWNER,
      listId: first.list.id,
      page: 1,
      pageSize: 100,
    });
    // Doar items-ul din primul upload trebuie sa existe.
    expect(persisted.total).toBe(2);
    expect(persisted.rows.map((r) => r.name_raw)).toEqual(["Ana", "Bogdan"]);
  });

  it("supports same source_sha256 across distinct owners", () => {
    const a = createList({
      ownerId: OWNER,
      title: "lista A",
      sourceFilename: null,
      sourceSha256: "shared-sha",
      items: [mkItem()],
    });
    const b = createList({
      ownerId: OTHER_OWNER,
      title: "lista B",
      sourceFilename: null,
      sourceSha256: "shared-sha",
      items: [mkItem()],
    });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(false);
    expect(a.list.id).not.toBe(b.list.id);
  });

  it("accepts an empty items array (preview-only flow)", () => {
    const result = createList({
      ownerId: OWNER,
      title: "fisier gol",
      sourceFilename: null,
      sourceSha256: "empty",
      items: [],
    });
    expect(result.list.total_rows).toBe(0);
    expect(result.list.valid_rows).toBe(0);
    const persisted = listItems({
      ownerId: OWNER,
      listId: result.list.id,
      page: 1,
      pageSize: 100,
    });
    expect(persisted.total).toBe(0);
  });
});

describe("getListById", () => {
  it("scopes by owner_id", () => {
    const created = createList({
      ownerId: OWNER,
      title: "x",
      sourceFilename: null,
      sourceSha256: "s1",
      items: [mkItem()],
    });
    expect(getListById(OWNER, created.list.id)?.id).toBe(created.list.id);
    expect(getListById(OTHER_OWNER, created.list.id)).toBeNull();
  });
});

describe("listLists", () => {
  it("excludes archived by default; includes when includeArchived=true", () => {
    const a = createList({
      ownerId: OWNER,
      title: "active",
      sourceFilename: null,
      sourceSha256: "s-a",
      items: [],
    });
    const b = createList({
      ownerId: OWNER,
      title: "old",
      sourceFilename: null,
      sourceSha256: "s-b",
      items: [],
    });
    archiveList(OWNER, b.list.id);

    const def = listLists({ ownerId: OWNER, page: 1, pageSize: 10 });
    expect(def.rows.map((r) => r.id)).toEqual([a.list.id]);

    const incl = listLists({
      ownerId: OWNER,
      page: 1,
      pageSize: 10,
      includeArchived: true,
    });
    expect(incl.rows.map((r) => r.id).sort()).toEqual([a.list.id, b.list.id].sort());
  });

  it("paginates", () => {
    for (let i = 0; i < 5; i++) {
      createList({
        ownerId: OWNER,
        title: `L${i}`,
        sourceFilename: null,
        sourceSha256: `s${i}`,
        items: [],
      });
    }
    const p1 = listLists({ ownerId: OWNER, page: 1, pageSize: 2 });
    const p2 = listLists({ ownerId: OWNER, page: 2, pageSize: 2 });
    expect(p1.total).toBe(5);
    expect(p1.rows).toHaveLength(2);
    expect(p2.rows).toHaveLength(2);
    // Order: created_at DESC → ultimul insert apare primul.
    expect(p1.rows[0]?.title).toBe("L4");
  });
});

describe("listItems", () => {
  it("filters by validation status", () => {
    const created = createList({
      ownerId: OWNER,
      title: "mixed",
      sourceFilename: null,
      sourceSha256: "mix",
      items: [
        mkItem({ nameRaw: "ok-1" }),
        mkItem({ nameRaw: "warn-1", validation: "warn" }),
        mkItem({ nameRaw: "rej-1", validation: "rejected" }),
      ],
    });
    const okOnly = listItems({
      ownerId: OWNER,
      listId: created.list.id,
      page: 1,
      pageSize: 100,
      validation: "ok",
    });
    expect(okOnly.rows.map((r) => r.name_raw)).toEqual(["ok-1"]);
  });
});

describe("linkItemToJob", () => {
  it("links once and is idempotent on retry", () => {
    const created = createList({
      ownerId: OWNER,
      title: "x",
      sourceFilename: null,
      sourceSha256: "lnk",
      items: [mkItem({ nameRaw: "A" })],
    });
    const itemId = listItems({
      ownerId: OWNER,
      listId: created.list.id,
      page: 1,
      pageSize: 1,
    }).rows[0]!.id;
    const jobId = seedJob(OWNER, created.list.id);

    const first = linkItemToJob(OWNER, itemId, jobId);
    expect(first).toBe(true);

    const otherJobId = seedJob(OWNER, created.list.id);
    const second = linkItemToJob(OWNER, itemId, otherJobId);
    expect(second).toBe(false); // existing link nu se rescrie

    const item = listItems({
      ownerId: OWNER,
      listId: created.list.id,
      page: 1,
      pageSize: 1,
    }).rows[0]!;
    expect(item.monitoring_job_id).toBe(jobId); // primul linker castiga
  });
});

describe("getCommittableItems", () => {
  it("returns ok + warn items that are not yet linked", () => {
    const created = createList({
      ownerId: OWNER,
      title: "x",
      sourceFilename: null,
      sourceSha256: "comm",
      items: [
        mkItem({ nameRaw: "ok" }),
        mkItem({ nameRaw: "warn", validation: "warn" }),
        mkItem({ nameRaw: "rej", validation: "rejected" }),
      ],
    });

    const before = getCommittableItems(OWNER, created.list.id);
    expect(before.map((r) => r.name_raw)).toEqual(["ok", "warn"]);

    // Link primul item; el dispare din committable.
    const jobId = seedJob(OWNER, created.list.id);
    linkItemToJob(OWNER, before[0]!.id, jobId);
    const after = getCommittableItems(OWNER, created.list.id);
    expect(after.map((r) => r.name_raw)).toEqual(["warn"]);
  });
});

describe("archiveList", () => {
  it("archives when no jobs reference the list", () => {
    const created = createList({
      ownerId: OWNER,
      title: "x",
      sourceFilename: null,
      sourceSha256: "arch",
      items: [],
    });
    const result = archiveList(OWNER, created.list.id);
    expect(result.archived).toBe(true);
    expect(result.blockingJobs).toBe(0);

    const list = getListById(OWNER, created.list.id);
    expect(list?.archived_at).not.toBeNull();
  });

  it("refuses with blockingJobs count when a job references the list", () => {
    const created = createList({
      ownerId: OWNER,
      title: "x",
      sourceFilename: null,
      sourceSha256: "blk",
      items: [],
    });
    seedJob(OWNER, created.list.id);
    seedJob(OWNER, created.list.id);

    const result = archiveList(OWNER, created.list.id);
    expect(result.archived).toBe(false);
    expect(result.blockingJobs).toBe(2);

    const list = getListById(OWNER, created.list.id);
    expect(list?.archived_at).toBeNull();
  });

  it("is owner-scoped", () => {
    const created = createList({
      ownerId: OWNER,
      title: "x",
      sourceFilename: null,
      sourceSha256: "scope",
      items: [],
    });
    const result = archiveList(OTHER_OWNER, created.list.id);
    expect(result.archived).toBe(false);
    const list = getListById(OWNER, created.list.id);
    expect(list?.archived_at).toBeNull();
  });
});

describe("FK ON DELETE RESTRICT", () => {
  it("blocks DELETE on name_lists while items exist", () => {
    const created = createList({
      ownerId: OWNER,
      title: "x",
      sourceFilename: null,
      sourceSha256: "del-restrict",
      items: [mkItem()],
    });
    const db = getDb();
    expect(() => db.prepare(`DELETE FROM name_lists WHERE id = ?`).run(created.list.id)).toThrow(/FOREIGN KEY/);
  });

  it("blocks DELETE on name_lists while monitoring_jobs reference it", () => {
    const created = createList({
      ownerId: OWNER,
      title: "x",
      sourceFilename: null,
      sourceSha256: "del-jobs",
      items: [],
    });
    seedJob(OWNER, created.list.id);
    const db = getDb();
    expect(() => db.prepare(`DELETE FROM name_lists WHERE id = ?`).run(created.list.id)).toThrow(/FOREIGN KEY/);
  });
});
