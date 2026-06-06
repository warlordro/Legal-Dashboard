import { describe, expect, it } from "vitest";
import { canonicalSha256 } from "../util/canonicalJson.ts";
import { targetForHash } from "./monitoringJobsRepository.ts";

// F4: an ICCJ job's dedup identity (target_hash) must NOT depend on the optional
// `iccj_id` (volatile metadata) nor on scj.ro's trailing `*`/`**` markers — otherwise the
// SAME dosar could be watched twice (once id-less, once with id) under different hashes.
describe("targetForHash (F4 - iccj dedup identity)", () => {
  it("hashes iccj jobs by numar_dosar only, ignoring iccj_id and trailing markers", () => {
    const a = canonicalSha256(targetForHash("iccj", { numar_dosar: "1783/1/2023" }));
    const withId = canonicalSha256(targetForHash("iccj", { numar_dosar: "1783/1/2023", iccj_id: "100000000356301" }));
    const withMarker = canonicalSha256(targetForHash("iccj", { numar_dosar: "1783/1/2023*" }));
    expect(withId).toBe(a); // optional iccj_id excluded from the hash
    expect(withMarker).toBe(a); // trailing `*` marker normalized off
  });

  it("distinguishes different dosare", () => {
    const a = canonicalSha256(targetForHash("iccj", { numar_dosar: "1783/1/2023" }));
    const b = canonicalSha256(targetForHash("iccj", { numar_dosar: "1784/1/2023" }));
    expect(a).not.toBe(b);
  });

  it("leaves non-iccj targets untouched (identity)", () => {
    const t = { numar_dosar: "1/2/2024", extra: "x" };
    expect(targetForHash("dosar_soap", t)).toBe(t);
  });
});
