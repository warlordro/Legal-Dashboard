import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, formatRnpmStorageLimitError, rnpmSearch } from "./rnpmApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rnpmApi storage limit", () => {
  it("pastreaza details in ApiError si produce mesajul cu cifre + actiuni", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: null,
              error: {
                code: "QUOTA_EXCEEDED",
                message: "mesaj server",
                details: { feature: "rnpm.storage", usedBytes: 600 * 1024 * 1024, limitBytes: 500 * 1024 * 1024 },
              },
              requestId: "rid-storage",
            }),
            { status: 429, headers: { "content-type": "application/json" } }
          )
      )
    );

    let caught: unknown;
    try {
      await rnpmSearch("ipoteci", {}, "x".repeat(32));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      status: 429,
      code: "QUOTA_EXCEEDED",
      requestId: "rid-storage",
      details: { feature: "rnpm.storage", usedBytes: 600 * 1024 * 1024, limitBytes: 500 * 1024 * 1024 },
    });
    expect(formatRnpmStorageLimitError(caught)).toBe(
      "Spatiul RNPM alocat este plin (600.0 MB din 500.0 MB). Sterge avize (stergerea pe selectie elibereaza automat spatiul) sau compacteaza din zona RNPM."
    );
  });
});
