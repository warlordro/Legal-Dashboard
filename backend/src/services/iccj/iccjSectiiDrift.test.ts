// Drift detector — backend ICCJ_SECTII_IDS must stay in lockstep with the
// frontend ICCJ_SECTII list.
//
// Why this exists: backend/src/services/iccj/iccjSectiiIds.ts validates the
// Department id filter, but the canonical list (id + label) lives in
// frontend/src/lib/iccjSectii.ts. The two files are maintained separately
// (each type-checks against its own definition), so a sectie added or removed
// on one side without the other slips through tsc and only surfaces as a
// rejected filter or a missing dropdown option. ICCJ_SECTII is a runtime const
// array, so we import it directly (cross-workspace, by relative path) and
// assert set equality of its `value` ids against the backend allowlist.

import { describe, expect, it } from "vitest";

import { ICCJ_SECTII } from "../../../../frontend/src/lib/iccjSectii.ts";
import { ICCJ_SECTII_IDS } from "./iccjSectiiIds.ts";

describe("ICCJ sectii drift detector — backend allowlist vs frontend list", () => {
  it("ICCJ_SECTII_IDS matches frontend ICCJ_SECTII ids exactly", () => {
    const frontend = new Set(ICCJ_SECTII.map((s) => s.value));
    const backend = new Set<string>(ICCJ_SECTII_IDS);
    expect(frontend).toEqual(backend);
  });
});
