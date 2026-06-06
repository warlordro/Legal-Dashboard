// Live smoke test against www.scj.ro. Skipped unless ICCJ_LIVE=1 so CI never
// depends on the upstream site. Run locally: ICCJ_LIVE=1 npx vitest run iccjClient.live
import { describe, expect, it } from "vitest";
import { fetchIccjDetail, searchIccj, _resetSessionForTests } from "./iccjClient.ts";

const live = process.env.ICCJ_LIVE === "1" ? describe : describe.skip;

live("ICCJ live smoke", () => {
  it("searches by party name and fetches one detail", async () => {
    _resetSessionForTests();
    const res = await searchIccj({ numeParte: "POPESCU" }, { page: 1 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.dosare.length).toBeGreaterThan(0);
    const first = res.dosare[0];
    expect(first.numar).toMatch(/\d+\/\d+\/\d+/);
    expect(first.iccjId).toMatch(/^\d+$/);
    expect(first.source).toBe("iccj");

    const detail = await fetchIccjDetail(first.iccjId);
    expect(detail.numar).toBe(first.numar);
    expect(detail.institutie).toContain("Casatie");
  }, 60_000);

  it("searches by docket number", async () => {
    _resetSessionForTests();
    const res = await searchIccj({ numarDosar: "1085/1/2026" }, { page: 1 });
    expect(res.total).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("returns a real empty for an impossible query (not a false-empty error)", async () => {
    _resetSessionForTests();
    const res = await searchIccj({ numeParte: "zzzqxwv-nonexistent-party-xyz" }, { page: 1 });
    expect(res.total).toBe(0);
    expect(res.dosare).toEqual([]);
  }, 60_000);
});
