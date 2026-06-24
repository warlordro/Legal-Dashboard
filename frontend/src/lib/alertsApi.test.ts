import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alertsApi } from "./alertsApi";

// Capture the URL passed to fetch and respond with the minimal envelope shape
// the unwrap helper expects. We only care about how the list params translate
// to the query string — not about the response body.

let lastCalledUrl: string | null = null;

function envelopeOk(): Response {
  const body = JSON.stringify({
    data: { rows: [], total: 0, page: 1, pageSize: 25, unread: 0 },
    requestId: "test-req-id",
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  lastCalledUrl = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      lastCalledUrl = url;
      return envelopeOk();
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function params(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx === -1 ? "" : url.slice(idx + 1));
}

describe("alertsApi.list URL construction", () => {
  it("trims surrounding whitespace from `q` before encoding", async () => {
    await alertsApi.list({ q: "   abc   " });
    expect(params(lastCalledUrl!).get("q")).toBe("abc");
  });

  it("omits the `q` parameter when it trims to empty", async () => {
    await alertsApi.list({ q: "   " });
    expect(params(lastCalledUrl!).has("q")).toBe(false);
  });

  it("omits `q` when undefined", async () => {
    await alertsApi.list({});
    expect(params(lastCalledUrl!).has("q")).toBe(false);
  });

  it("omits `kind` and `jobKind` when set to 'all'", async () => {
    await alertsApi.list({ kind: "all", jobKind: "all" });
    expect(params(lastCalledUrl!).has("kind")).toBe(false);
    expect(params(lastCalledUrl!).has("jobKind")).toBe(false);
  });

  it("forwards a concrete `jobKind` filter as-is", async () => {
    await alertsApi.list({ jobKind: "dosar_soap" });
    expect(params(lastCalledUrl!).get("jobKind")).toBe("dosar_soap");
  });

  it("forwards aviz_rnpm even though the UI tab strip doesn't surface it", async () => {
    // The state in Alerts.tsx is now narrowed to JobKindFilter (no aviz_rnpm),
    // but the network type still permits it for future use. Documenting the
    // current contract so any narrowing here is a deliberate choice.
    await alertsApi.list({ jobKind: "aviz_rnpm" });
    expect(params(lastCalledUrl!).get("jobKind")).toBe("aviz_rnpm");
  });

  it("encodes pagination + filters together", async () => {
    await alertsApi.list({
      page: 2,
      pageSize: 50,
      severity: "warning",
      onlyUnread: true,
      includeDismissed: false,
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-03T23:59:59.999Z",
    });
    const p = params(lastCalledUrl!);
    expect(p.get("page")).toBe("2");
    expect(p.get("pageSize")).toBe("50");
    expect(p.get("severity")).toBe("warning");
    expect(p.get("onlyUnread")).toBe("true");
    expect(p.get("includeDismissed")).toBe("false");
    expect(p.get("from")).toBe("2026-05-01T00:00:00.000Z");
    expect(p.get("to")).toBe("2026-05-03T23:59:59.999Z");
  });

  it("hits the bare path with no querystring when called with no params", async () => {
    await alertsApi.list();
    expect(lastCalledUrl).toBe("/api/v1/alerts");
  });
});

describe("alertsApi.exportAlerts", () => {
  let lastInit: RequestInit | undefined;

  beforeEach(() => {
    lastInit = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        lastCalledUrl = url;
        lastInit = init;
        return new Response(
          JSON.stringify({
            data: { rows: [], count: 0 },
            requestId: "req",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );
  });

  it("POSTs ids payload as JSON to /export", async () => {
    await alertsApi.exportAlerts({ mode: "ids", ids: [1, 2, 3] });
    expect(lastCalledUrl).toBe("/api/v1/alerts/export");
    expect(lastInit?.method).toBe("POST");
    expect(JSON.parse(lastInit?.body as string)).toEqual({
      mode: "ids",
      ids: [1, 2, 3],
    });
  });

  it("POSTs filters payload, omitting empty filter object only when caller does", async () => {
    await alertsApi.exportAlerts({
      mode: "filters",
      filters: { severity: "warning", q: "abc" },
    });
    const body = JSON.parse(lastInit?.body as string) as {
      mode: string;
      filters: { severity: string; q: string };
    };
    expect(body.mode).toBe("filters");
    expect(body.filters.severity).toBe("warning");
    expect(body.filters.q).toBe("abc");
  });

  it("POSTs range payload with both ISO bounds", async () => {
    await alertsApi.exportAlerts({
      mode: "range",
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-30T23:59:59.999Z",
    });
    expect(JSON.parse(lastInit?.body as string)).toEqual({
      mode: "range",
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-30T23:59:59.999Z",
    });
  });
});

describe("alertsApi.dismissBulk", () => {
  let lastInit: RequestInit | undefined;

  beforeEach(() => {
    lastInit = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        lastCalledUrl = url;
        lastInit = init;
        return new Response(
          JSON.stringify({
            data: { dismissedCount: 0, alreadyDismissedCount: 0, totalMatched: 0 },
            requestId: "req",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );
  });

  it("POSTs ids payload as JSON to /dismiss-bulk", async () => {
    await alertsApi.dismissBulk({ mode: "ids", ids: [10, 11, 12] });
    expect(lastCalledUrl).toBe("/api/v1/alerts/dismiss-bulk");
    expect(lastInit?.method).toBe("POST");
    expect(JSON.parse(lastInit?.body as string)).toEqual({
      mode: "ids",
      ids: [10, 11, 12],
    });
  });

  it("POSTs filters payload mirroring the list filter shape", async () => {
    await alertsApi.dismissBulk({
      mode: "filters",
      filters: { severity: "warning", q: "abc", onlyUnread: true },
    });
    const body = JSON.parse(lastInit?.body as string) as {
      mode: string;
      filters: { severity: string; q: string; onlyUnread: boolean };
    };
    expect(body.mode).toBe("filters");
    expect(body.filters.severity).toBe("warning");
    expect(body.filters.q).toBe("abc");
    expect(body.filters.onlyUnread).toBe(true);
  });

  it("supports empty filters payload (close every visible alert under no extra filter)", async () => {
    await alertsApi.dismissBulk({ mode: "filters" });
    expect(JSON.parse(lastInit?.body as string)).toEqual({ mode: "filters" });
  });
});
