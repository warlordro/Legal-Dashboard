import { describe, expect, it } from "vitest";
import { buildAlertContext } from "./alert-context";
import type { MonitoringAlert } from "./alertsApi";

function makeAlert(overrides: Partial<MonitoringAlert>): MonitoringAlert {
  return {
    id: 1,
    owner_id: "local",
    job_id: 1,
    run_id: null,
    kind: "dosar_new",
    severity: "info",
    title: "t",
    detail_json: "{}",
    dedup_key: "k",
    is_new: 1,
    created_at: "2026-06-15T00:00:00.000Z",
    read_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

describe("buildAlertContext — fact formatting (v2.38.0 polish)", () => {
  it("renders latest_sedinta_at as 'Ultima sedinta' (dd.mm.yyyy), not the raw fallback", () => {
    const ctx = buildAlertContext(
      makeAlert({
        kind: "dosar_new",
        job_kind: "name_soap",
        detail_json: JSON.stringify({
          numar_dosar: "2109/3/2023",
          instanta: "Tribunalul Bucuresti",
          latest_sedinta_at: "2026-11-10T00:00:00",
        }),
      })
    );
    expect(ctx.facts.find((f) => f.label === "Ultima sedinta")?.value).toBe("10.11.2026");
    // No raw "Latest sedinta at" leaking into the humanized-key fallback.
    expect(ctx.fallback.some((f) => /sedinta/i.test(f.label))).toBe(false);
  });

  it("suppresses iccj_id from facts and fallback while keeping it for the deep-link", () => {
    const ctx = buildAlertContext(
      makeAlert({
        kind: "dosar_new",
        job_kind: "iccj",
        detail_json: JSON.stringify({
          numar_dosar: "100/1/2026",
          iccj_id: "abc-123",
          instanta: "Inalta Curte",
        }),
      })
    );
    expect(ctx.iccjId).toBe("abc-123"); // still extracted for the scj.ro deep-link
    expect(ctx.facts.some((f) => /iccj/i.test(f.label))).toBe(false);
    expect(ctx.fallback.some((f) => /iccj/i.test(f.label))).toBe(false);
  });

  it("renders sedinteCount as 'Numar sedinte', not the raw 'Sedinte count' fallback", () => {
    const ctx = buildAlertContext(
      makeAlert({
        kind: "dosar_new",
        job_kind: "iccj",
        detail_json: JSON.stringify({ numar_dosar: "100/1/2026", sedinteCount: 4 }),
      })
    );
    expect(ctx.facts.find((f) => f.label === "Numar sedinte")?.value).toBe("4");
    expect(ctx.fallback.some((f) => /sedinte count/i.test(f.label))).toBe(false);
  });

  it("still surfaces genuinely-unknown keys via the humanized fallback", () => {
    const ctx = buildAlertContext(
      makeAlert({
        detail_json: JSON.stringify({ numar_dosar: "1/2/2026", some_extra_field: "value-x" }),
      })
    );
    expect(ctx.fallback.find((f) => f.label === "Some extra field")?.value).toBe("value-x");
  });
});
