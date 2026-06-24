// Equality guard for the INTENTIONALLY duplicated ICCJ docket normalization
// (CODEX-REVIEW LOW; meta-review: the dup is deliberate — the repository layer
// must not import from services). The regex lives twice:
//   - services/monitoring/iccjFetchCurrent.ts: exported `normalizeIccjNumar`
//   - db/monitoringJobsRepository.ts: inlined inside `targetForHash` (no
//     standalone fn, so we drive it through targetForHash and read back
//     numar_dosar).
// This test locks the two copies to identical behavior: if either side edits
// the lookahead / trim, the assertions below diverge and fail. We do NOT
// remove the duplication.
import { describe, expect, it } from "vitest";
import { targetForHash } from "../../db/monitoringJobsRepository.ts";
import { normalizeIccjNumar } from "./iccjFetchCurrent.ts";

// The repo copy normalizes numar_dosar inside targetForHash for kind "iccj".
function repoNormalize(s: string): string {
  return (targetForHash("iccj", { numar_dosar: s }) as { numar_dosar: string }).numar_dosar;
}

// Inputs chosen to exercise the lookahead specifically — generic case/space
// shuffling is inert for this regex, so the discriminating cases are the
// asterisk anchors (trailing, mid-string-before-slash) and, crucially, an
// asterisk that must be PRESERVED (not before `/` or end-of-string). The
// `expected` column pins the known-correct output so the guard also catches an
// edit that turns BOTH copies into no-ops.
const CASES: Array<{ input: string; expected: string }> = [
  { input: "1085/1/2026", expected: "1085/1/2026" },
  { input: "1783/1/2023*", expected: "1783/1/2023" },
  { input: "1783/1/2023**", expected: "1783/1/2023" },
  { input: "1859/107/2009**/a3.1", expected: "1859/107/2009/a3.1" },
  { input: "12*34", expected: "12*34" }, // asterisk mid-token MUST survive
  { input: "  1783/1/2023  ", expected: "1783/1/2023" },
  { input: "1783/1/2023*  ", expected: "1783/1/2023" },
  { input: "  ", expected: "" },
  { input: "", expected: "" },
  { input: "1085/1/2026/A3.1", expected: "1085/1/2026/A3.1" },
];

describe("normalizeIccjNumar equality guard (service vs repository copy)", () => {
  for (const { input, expected } of CASES) {
    it(`identical normalization for ${JSON.stringify(input)}`, () => {
      const service = normalizeIccjNumar(input);
      const repo = repoNormalize(input);
      expect(service).toBe(repo); // two copies must never diverge
      expect(service).toBe(expected); // and both must match the pinned value
    });
  }
});
