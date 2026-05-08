// v2.20.2: Route-level tests pentru emisia audit `rnpm.cap_hit` din
// POST /api/v1/rnpm/search-split. Acoperim:
//   E1. Shape detail corect (gapByReason, blockedLabels flatten tier-1+tier-2,
//       searchType prezent, criteriu absent — fix Grupul A).
//   E2. recordAudit care arunca nu omoara success-ul SSE (fix A1).
//   E3. No-emit cand nu exista cap (upstreamTotal === total si zero blocked).
//   E4. gapByReason aritmetic: pentru status="partial" s.gap >> derivat
//       (subTotal - count) pentru ca tier-2 a recuperat parte din rezultate.

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fsPromises from "fs/promises";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IMPORTANT: vi.mock se hoist-uieste deasupra import-urilor. Mockul
// `executeSplitSearch` trebuie sa fie un vi.fn() asa ca per-test putem
// configura .mockResolvedValueOnce(...) cu shape specific. Pastram restul
// exporturilor via importActual ca rnpmRouter sa primeasca tipurile corecte.
vi.mock("../services/rnpmSearchService.ts", async () => {
  const actual = await vi.importActual<typeof import("../services/rnpmSearchService.ts")>(
    "../services/rnpmSearchService.ts",
  );
  return {
    ...actual,
    executeSplitSearch: vi.fn(),
  };
});

import { rnpmRouter } from "./rnpm.ts";
import { executeSplitSearch } from "../services/rnpmSearchService.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { updateUserRole } from "../db/userRepository.ts";
import * as auditRepository from "../db/auditRepository.ts";
import type {
  SplitSearchInput,
  SplitSearchResult,
  SplitSearchProgress,
} from "../services/rnpmSearchService.ts";

const executeSplitSearchMock = vi.mocked(executeSplitSearch);

let tmpRoot: string;

function buildApp() {
  const app = new Hono();
  app.route("/api/v1/rnpm", rnpmRouter);
  return app;
}

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-rnpm-split-route-"));
  const dbPath = path.join(tmpRoot, "legal-dashboard.db");
  process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
  const seed = new Database(dbPath);
  seed.close();
  getDb();
  updateUserRole("local", "admin");
  executeSplitSearchMock.mockReset();
});

afterEach(async () => {
  closeDb();
  delete process.env.LEGAL_DASHBOARD_DB_PATH;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function buildSplitResult(overrides: Partial<SplitSearchResult> = {}): SplitSearchResult {
  return {
    searchId: 1,
    documents: [],
    avizIds: [],
    total: 0,
    upstreamTotal: 0,
    criteriu: "PII-NU-VREM-IN-AUDIT",
    pagesTotal: 0,
    pageSize: 25,
    currentPage: 0,
    detailsFailed: [],
    splitStats: [],
    captchasUsed: 0,
    ...overrides,
  };
}

async function consumeSSE(res: Response): Promise<string> {
  // SSE intern in Hono se scrie ca text/event-stream. Pentru teste e suficient
  // sa asteptam pana cand stream-ul s-a inchis si returnam tot textul.
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  buf += decoder.decode();
  return buf;
}

const POST_BODY = {
  type: "ipoteci",
  baseParams: { numeProprietar: "ACME" },
  subTypeLabels: ["IPOTECA MOBILIARA"],
  captchaKey: "0123456789abcdef",
  captchaProvider: "2captcha",
};

async function runSplit(): Promise<{ res: Response; body: string }> {
  const res = await buildApp().request("/api/v1/rnpm/search-split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(POST_BODY),
  });
  const body = await consumeSSE(res);
  return { res, body };
}

function getCapHitRow(): { detail_json: string; target_id: string | null; outcome: string } | undefined {
  return getDb()
    .prepare(
      "SELECT detail_json, target_id, outcome FROM audit_log WHERE action = 'rnpm.cap_hit' ORDER BY id DESC LIMIT 1",
    )
    .get() as { detail_json: string; target_id: string | null; outcome: string } | undefined;
}

describe("POST /api/v1/rnpm/search-split — audit rnpm.cap_hit", () => {
  it("E1: emits canonical detail (no criteriu PII, searchType present, gapByReason populated, tier-1+tier-2 flatten)", async () => {
    executeSplitSearchMock.mockImplementationOnce(
      async (
        _input: SplitSearchInput,
        _onProgress: (p: SplitSearchProgress) => void,
      ): Promise<SplitSearchResult> =>
        buildSplitResult({
          searchId: 42,
          total: 100,
          upstreamTotal: 1700,
          splitStats: [
            // Tier-1 partial (a triggered nested) — s.gap explicit, plus nested cu o destinatie blocata.
            {
              label: "ASUPRA CREANTELOR",
              status: "partial",
              count: 500,
              subTotal: 1500,
              gap: 200, // 1500 - SUM(nested.subTotal) = 200 (residual_unclassified)
              gapReason: "residual_unclassified",
              nested: [
                { label: "AGRICULTURA", status: "ok", count: 400, subTotal: 400 },
                { label: "INDUSTRIE", status: "blocked", count: 0, subTotal: 200, gapReason: "silent_refusal" },
                { label: "COMERT", status: "ok", count: 100, subTotal: 100 },
              ],
            },
            // Tier-1 blocked terminal_cap (no nested possible).
            {
              label: "DREPTUL DE OPTIUNE",
              status: "blocked",
              count: 0,
              subTotal: 200,
              gapReason: "terminal_cap",
            },
          ],
        }),
    );

    const { res } = await runSplit();
    expect(res.status).toBe(200);

    const row = getCapHitRow();
    expect(row).toBeDefined();
    expect(row!.target_id).toBe("42");
    expect(row!.outcome).toBe("ok");

    const detail = JSON.parse(row!.detail_json) as {
      searchType: string;
      criteriu?: unknown;
      upstreamTotal: number;
      recovered: number;
      gap: number;
      gapByReason: Record<string, number>;
      blockedLabels: Array<{ label: string; status: string; gapReason?: string }>;
      blockedLabelsTruncated: boolean;
    };

    // GDPR: criteriu (CUI/CNP/nume) NU trebuie prezent in audit detail.
    expect(detail.criteriu).toBeUndefined();
    expect(detail.searchType).toBe("ipoteci");
    expect(detail.upstreamTotal).toBe(1700);
    expect(detail.recovered).toBe(100);
    expect(detail.gap).toBe(1600);

    // gapByReason: tier-1 contribuie cu s.gap (200 residual) + tier-1 terminal (200);
    // tier-2 nested contribuie cu silent_refusal (200 dintr-o singura destinatie blocata).
    expect(detail.gapByReason).toEqual({
      residual_unclassified: 200,
      terminal_cap: 200,
      silent_refusal: 200,
    });

    // blockedLabels include tier-1 (status partial+blocked) plus prefix "tier1 > tier2"
    // pentru destinatia blocata.
    const labels = detail.blockedLabels.map((l) => l.label);
    expect(labels).toContain("ASUPRA CREANTELOR");
    expect(labels).toContain("DREPTUL DE OPTIUNE");
    expect(labels).toContain("ASUPRA CREANTELOR > INDUSTRIE");
    // OK destinations NU se loga in blockedLabels.
    expect(labels).not.toContain("ASUPRA CREANTELOR > AGRICULTURA");
    expect(labels).not.toContain("ASUPRA CREANTELOR > COMERT");

    expect(detail.blockedLabelsTruncated).toBe(false);
  });

  it("E2: recordAudit failure does NOT abort SSE — complete event still emits", async () => {
    executeSplitSearchMock.mockImplementationOnce(
      async (): Promise<SplitSearchResult> =>
        buildSplitResult({
          searchId: 7,
          total: 0,
          upstreamTotal: 100,
          splitStats: [
            {
              label: "X", status: "blocked", count: 0, subTotal: 100, gapReason: "terminal_cap",
            },
          ],
        }),
    );
    const recordAuditSpy = vi.spyOn(auditRepository, "recordAudit").mockImplementation(() => {
      throw new Error("simulated audit_log INSERT failure");
    });

    const { res, body } = await runSplit();
    expect(res.status).toBe(200);
    // SSE complete event a fost trimis (nu error event).
    expect(body).toContain("event: complete");
    expect(body).not.toContain("event: error");
    expect(recordAuditSpy).toHaveBeenCalled();

    recordAuditSpy.mockRestore();
  });

  it("E3: no audit emit when there is no cap (upstreamTotal === total, no blocked)", async () => {
    executeSplitSearchMock.mockImplementationOnce(
      async (): Promise<SplitSearchResult> =>
        buildSplitResult({
          searchId: 99,
          total: 50,
          upstreamTotal: 50,
          splitStats: [
            { label: "A", status: "ok", count: 25, subTotal: 25 },
            { label: "B", status: "ok", count: 25, subTotal: 25 },
          ],
        }),
    );

    const { res } = await runSplit();
    expect(res.status).toBe(200);
    expect(getCapHitRow()).toBeUndefined();
  });

  it("E4: gapByReason for partial uses s.gap (not subTotal - count) to avoid double-count of tier-2 recovered rows", async () => {
    executeSplitSearchMock.mockImplementationOnce(
      async (): Promise<SplitSearchResult> =>
        buildSplitResult({
          searchId: 11,
          total: 800,
          upstreamTotal: 1500,
          splitStats: [
            {
              // Caz patologic: count=800 (tier-2 a recuperat 800), subTotal=1500.
              // (subTotal - count) = 700; dar s.gap = 100 (residual real dupa tier-2).
              label: "CREANTE",
              status: "partial",
              count: 800,
              subTotal: 1500,
              gap: 100,
              gapReason: "residual_unclassified",
              nested: [
                { label: "X", status: "ok", count: 800, subTotal: 1400 },
              ],
            },
          ],
        }),
    );

    const { res } = await runSplit();
    expect(res.status).toBe(200);
    const row = getCapHitRow();
    expect(row).toBeDefined();
    const detail = JSON.parse(row!.detail_json) as { gapByReason: Record<string, number> };
    // 100 = s.gap, NU 700 = (1500 - 800).
    expect(detail.gapByReason).toEqual({ residual_unclassified: 100 });
  });
});
