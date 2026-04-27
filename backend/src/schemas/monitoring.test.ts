// Schema validation tests — happy paths + reject paths for every shape that
// hits the route layer. If any of these fail, untrusted JSON could land in the
// DB and the reader-side .safeParse() in PR-4 onward would have to soft-fail
// to keep the page rendering, which would mask real shape drift.

import { describe, expect, it } from "vitest";
import {
  AlertConfigSchema,
  JobCreateBodySchema,
  JobListQuerySchema,
  JobUpdateBodySchema,
} from "./monitoring.ts";

describe("AlertConfigSchema", () => {
  it("applies defaults when empty", () => {
    const out = AlertConfigSchema.parse({});
    expect(out.notify_days_before).toEqual([14, 7, 3, 1]);
    expect(out.notify_on_new_termen).toBe(true);
    expect(out.notify_on_solution).toBe(true);
    expect(out.notify_on_dosar_disappeared).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const r = AlertConfigSchema.safeParse({ rogue_key: 1 });
    expect(r.success).toBe(false);
  });

  it("rejects non-integer days", () => {
    const r = AlertConfigSchema.safeParse({ notify_days_before: [1.5] });
    expect(r.success).toBe(false);
  });

  it("rejects email_to with invalid format", () => {
    const r = AlertConfigSchema.safeParse({ email_to: "not-an-email" });
    expect(r.success).toBe(false);
  });

  it("accepts valid full config", () => {
    const r = AlertConfigSchema.safeParse({
      notify_days_before: [7, 1],
      notify_on_new_termen: false,
      stadii: ["Apel", "Recurs"],
      email_to: "user@example.com",
    });
    expect(r.success).toBe(true);
  });
});

describe("JobCreateBodySchema — dosar_soap", () => {
  const validBase = {
    kind: "dosar_soap" as const,
    target: { numar_dosar: "1234/180/2024" },
  };

  it("accepts canonical numar_dosar", () => {
    const r = JobCreateBodySchema.safeParse(validBase);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cadence_sec).toBe(14400);
    }
  });

  it("accepts numar_dosar with letter+digit suffix", () => {
    const r = JobCreateBodySchema.safeParse({
      kind: "dosar_soap",
      target: { numar_dosar: "1887/99/2022/a12" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects malformed numar_dosar", () => {
    for (const bad of ["1234", "abc/def/ghi", "1234/180/24", "1234-180-2024", ""]) {
      const r = JobCreateBodySchema.safeParse({
        kind: "dosar_soap",
        target: { numar_dosar: bad },
      });
      expect(r.success, `should reject "${bad}"`).toBe(false);
    }
  });

  it("rejects cadence_sec below 600s", () => {
    const r = JobCreateBodySchema.safeParse({ ...validBase, cadence_sec: 60 });
    expect(r.success).toBe(false);
  });

  it("rejects cadence_sec above 86400s", () => {
    const r = JobCreateBodySchema.safeParse({ ...validBase, cadence_sec: 90000 });
    expect(r.success).toBe(false);
  });

  it("rejects unknown top-level keys (strict)", () => {
    const r = JobCreateBodySchema.safeParse({ ...validBase, evil: 1 });
    expect(r.success).toBe(false);
  });

  it("rejects target with extra keys", () => {
    const r = JobCreateBodySchema.safeParse({
      kind: "dosar_soap",
      target: { numar_dosar: "1234/180/2024", evil: 1 },
    });
    expect(r.success).toBe(false);
  });

  it("trims numar_dosar whitespace", () => {
    const r = JobCreateBodySchema.safeParse({
      kind: "dosar_soap",
      target: { numar_dosar: "  1234/180/2024  " },
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.kind === "dosar_soap") {
      expect(r.data.target.numar_dosar).toBe("1234/180/2024");
    }
  });
});

describe("JobCreateBodySchema — name_soap", () => {
  it("accepts valid name", () => {
    const r = JobCreateBodySchema.safeParse({
      kind: "name_soap",
      target: { name_normalized: "popescu ion", name_kind: "fizic" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid name_kind", () => {
    const r = JobCreateBodySchema.safeParse({
      kind: "name_soap",
      target: { name_normalized: "popescu ion", name_kind: "other" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects too-short name", () => {
    const r = JobCreateBodySchema.safeParse({
      kind: "name_soap",
      target: { name_normalized: "x", name_kind: "fizic" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts institutie array", () => {
    const r = JobCreateBodySchema.safeParse({
      kind: "name_soap",
      target: {
        name_normalized: "popescu ion",
        name_kind: "fizic",
        institutie: ["CurteadeApelBUCURESTI", "TribunalulBucuresti"],
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects institutie as plain string (must be array)", () => {
    const r = JobCreateBodySchema.safeParse({
      kind: "name_soap",
      target: {
        name_normalized: "popescu ion",
        name_kind: "fizic",
        institutie: "Tribunalul Bucuresti",
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects institutie array with too many entries", () => {
    const r = JobCreateBodySchema.safeParse({
      kind: "name_soap",
      target: {
        name_normalized: "popescu ion",
        name_kind: "fizic",
        institutie: Array(21).fill("X").map((x, i) => `${x}${i}`),
      },
    });
    expect(r.success).toBe(false);
  });
});

describe("JobCreateBodySchema — aviz_rnpm", () => {
  it("accepts valid identificator", () => {
    const r = JobCreateBodySchema.safeParse({
      kind: "aviz_rnpm",
      target: { identificator: "AV-2024-00001" },
    });
    expect(r.success).toBe(true);
  });
});

describe("JobCreateBodySchema — discriminated kind", () => {
  it("rejects unknown kind", () => {
    const r = JobCreateBodySchema.safeParse({
      kind: "rogue",
      target: { numar_dosar: "1234/180/2024" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects mismatched target shape per kind", () => {
    // dosar_soap with name_soap-style target
    const r = JobCreateBodySchema.safeParse({
      kind: "dosar_soap",
      target: { name_normalized: "popescu", name_kind: "fizic" },
    });
    expect(r.success).toBe(false);
  });
});

describe("JobUpdateBodySchema", () => {
  it("rejects empty body", () => {
    const r = JobUpdateBodySchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts cadence_sec change", () => {
    const r = JobUpdateBodySchema.safeParse({ cadence_sec: 1800 });
    expect(r.success).toBe(true);
  });

  it("accepts paused_until ISO string", () => {
    const r = JobUpdateBodySchema.safeParse({ paused_until: "2026-05-01T00:00:00Z" });
    expect(r.success).toBe(true);
  });

  it("accepts paused_until null (unpause)", () => {
    const r = JobUpdateBodySchema.safeParse({ paused_until: null });
    expect(r.success).toBe(true);
  });

  it("rejects kind change (immutable)", () => {
    const r = JobUpdateBodySchema.safeParse({ kind: "name_soap" });
    expect(r.success).toBe(false);
  });

  it("rejects target change (immutable)", () => {
    const r = JobUpdateBodySchema.safeParse({ target: { numar_dosar: "x" } });
    expect(r.success).toBe(false);
  });
});

describe("JobListQuerySchema", () => {
  it("applies pagination defaults", () => {
    const r = JobListQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
  });

  it("coerces string numerics", () => {
    const r = JobListQuerySchema.parse({ page: "2", pageSize: "50" });
    expect(r.page).toBe(2);
    expect(r.pageSize).toBe(50);
  });

  it("rejects pageSize > 100", () => {
    const r = JobListQuerySchema.safeParse({ pageSize: "500" });
    expect(r.success).toBe(false);
  });

  it("transforms active=true into boolean", () => {
    const r = JobListQuerySchema.parse({ active: "true" });
    expect(r.active).toBe(true);
  });
});
